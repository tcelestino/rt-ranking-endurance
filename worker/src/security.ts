import type { Context, MiddlewareHandler } from 'hono';

const ROBOTS_TAG = 'noindex, nofollow, noarchive';
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Subconjunto do binding RateLimit (sem importar env.ts: usa tipos do Workers, ausentes no tsconfig que checa tests/)
type Limiter = { limit(options: { key: string }): Promise<{ success: boolean }> };

// O host do Frontend API do Clerk vem codificado na publishable key (pk_test_<base64>, com "$" no fim).
// Mesma extração de backoffice/public/app.js.
export function clerkFrontendHost(publishableKey: string): string {
  return atob(publishableKey.split('_')[2]).slice(0, -1);
}

function contentSecurityPolicy(clerkHost: string): string {
  return [
    "default-src 'self'",
    // Chart.js (jsDelivr) e Clerk JS/UI, servidos pelo Frontend API do Clerk
    `script-src 'self' https://cdn.jsdelivr.net https://${clerkHost}`,
    // O Clerk injeta estilos inline (o app em si não tem <style> inline)
    "style-src 'self' 'unsafe-inline'",
    // Chamadas do Clerk Frontend API; o resto vai para a própria origem
    `connect-src 'self' https://${clerkHost}`,
    // Avatares do Clerk e ícones data:
    "img-src 'self' data: https://img.clerk.com",
    // Clerk usa web workers criados via blob:
    "worker-src 'self' blob:",
    // Cloudflare Turnstile (proteção contra bots do Clerk) renderiza em iframe
    'frame-src https://challenges.cloudflare.com',
    // Impede que a página seja embutida em outros sites (clickjacking)
    "frame-ancestors 'none'",
    // Sem <base>: evita reescrita de URLs relativas por injeção
    "base-uri 'none'",
    // Formulários só enviam para a própria origem
    "form-action 'self'",
  ].join('; ');
}

function applyHeaders(set: (name: string, value: string) => void, path: string, csp: string): void {
  set('X-Robots-Tag', ROBOTS_TAG);
  set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  set('X-Content-Type-Options', 'nosniff');
  set('Referrer-Policy', 'no-referrer');
  set('Content-Security-Policy', csp);
  if (path.includes('/api/')) set('Cache-Control', 'no-store');
}

// Headers em toda resposta. Definidos antes do handler (valem para respostas do onError) e reaplicados
// depois, para cobrir respostas que substituem a resposta corrente (ex.: 404, assets).
export function securityHeaders<B extends object>(clerkHost: (env: B) => string): MiddlewareHandler<{ Bindings: B }> {
  return async (c, next) => {
    const csp = contentSecurityPolicy(clerkHost(c.env));
    const path = c.req.path;
    applyHeaders((name, value) => c.header(name, value), path, csp);
    await next();
    applyHeaders((name, value) => c.res.headers.set(name, value), path, csp);
  };
}

type Resolver<B> = string | ((env: B, c: Context) => string);

// Defesa contra CSRF: em métodos mutáveis exige Origin igual ao permitido (ausente também é rejeitado).
export function requireSameOrigin<B extends object>(allowedOrigin: Resolver<B>): MiddlewareHandler<{ Bindings: B }> {
  return async (c, next) => {
    if (MUTATING_METHODS.has(c.req.method)) {
      const allowed = typeof allowedOrigin === 'function' ? allowedOrigin(c.env, c) : allowedOrigin;
      if (c.req.header('origin') !== allowed) return c.json({ error: 'Origem não permitida' }, 403);
    }
    await next();
  };
}

// Rate limit por IP (binding RATE_LIMITER). Sem o header usa uma chave única compartilhada.
export function rateLimit<B extends { RATE_LIMITER: Limiter }>(): MiddlewareHandler<{ Bindings: B }> {
  return async (c, next) => {
    const key = c.req.header('cf-connecting-ip') ?? 'unknown';
    const { success } = await c.env.RATE_LIMITER.limit({ key });
    if (!success) return c.json({ error: 'Muitas requisições. Tente novamente em instantes.' }, 429);
    await next();
  };
}

// Limita o corpo pelo Content-Length. Em POST/PUT/PATCH sem Content-Length (ex.: chunked) responde 411,
// pois o tamanho não poderia ser verificado antes de ler o corpo; acima do limite responde 413.
export function limitBody(maxBytes: number): MiddlewareHandler {
  return async (c, next) => {
    const length = c.req.header('content-length');
    if (length === undefined) {
      if (['POST', 'PUT', 'PATCH'].includes(c.req.method)) {
        return c.json({ error: 'Content-Length obrigatório' }, 411);
      }
    } else if (!(Number(length) <= maxBytes)) {
      return c.json({ error: 'Corpo da requisição muito grande' }, 413);
    }
    await next();
  };
}
