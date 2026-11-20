import type { Context, MiddlewareHandler } from 'hono';
import { logError } from './logger';

const ROBOTS_TAG = 'noindex, nofollow, noarchive';
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Subconjunto do binding RateLimit (sem importar env.ts: usa tipos do Workers, ausentes no tsconfig que checa tests/)
type Limiter = { limit(options: { key: string }): Promise<{ success: boolean }> };

// O host do Frontend API do Clerk vem codificado na publishable key (pk_test_<base64>, com "$" no fim).
// Mesma extração de backoffice/public/app.js.
// Falha com erro descritivo (sem ecoar a chave) se a chave for inválida ou o host tiver caracteres que
// poderiam injetar diretivas na CSP (";", espaço etc.).
export function clerkFrontendHost(publishableKey: string): string {
  const encoded = publishableKey.split('_')[2];
  let host: string;
  try {
    host = atob(encoded).slice(0, -1);
  } catch {
    throw new Error('CLERK_PUBLISHABLE_KEY inválida: não foi possível decodificar o host do Clerk');
  }
  if (!/^[a-z0-9.-]+$/i.test(host))
    throw new Error('CLERK_PUBLISHABLE_KEY inválida: host do Clerk com caracteres inesperados');
  return host;
}

function contentSecurityPolicy(clerkHost: string): string {
  return [
    "default-src 'self'",
    // Chart.js só na versão exata carregada por app.js (prefixo de caminho termina em "/"), Clerk JS/UI
    // servidos pelo Frontend API do Clerk e o script do Turnstile (bot protection do Clerk)
    `script-src 'self' https://cdn.jsdelivr.net/npm/chart.js@4.4.7/ https://${clerkHost} https://challenges.cloudflare.com`,
    // O Clerk injeta estilos inline (o app em si não tem <style> inline)
    "style-src 'self' 'unsafe-inline'",
    // Chamadas do Clerk Frontend API; o resto vai para a própria origem
    `connect-src 'self' https://${clerkHost}`,
    // Avatares do Clerk, ícones data: e miniaturas dos prints (URL.createObjectURL) em blob:
    "img-src 'self' data: blob: https://img.clerk.com",
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
// Falha fechado: se a CSP não puder ser montada, responde 500 (com X-Robots-Tag) em vez de servir sem CSP.
export function securityHeaders<B extends object>(clerkHost: (env: B) => string): MiddlewareHandler<{ Bindings: B }> {
  return async (c, next) => {
    c.header('X-Robots-Tag', ROBOTS_TAG);
    let csp: string;
    try {
      csp = contentSecurityPolicy(clerkHost(c.env));
    } catch (err) {
      logError('csp não pôde ser montada', { err: err instanceof Error ? err.message : String(err) });
      return c.json({ error: 'Configuração de segurança inválida' }, 500);
    }
    const path = c.req.path;
    applyHeaders((name, value) => c.header(name, value), path, csp);
    await next();
    // Response vinda de fetch()/ASSETS tem headers imutáveis: recria antes de alterar
    c.res = new Response(c.res.body, c.res);
    applyHeaders((name, value) => c.res.headers.set(name, value), path, csp);
  };
}

type Resolver<B> = string | ((env: B, c: Context) => string);

// Defesa contra CSRF: em métodos mutáveis exige Origin igual ao permitido (ausente também é rejeitado).
export function requireSameOrigin<B extends object>(allowedOrigin: Resolver<B>): MiddlewareHandler<{ Bindings: B }> {
  return async (c, next) => {
    if (MUTATING_METHODS.has(c.req.method)) {
      const allowed = typeof allowedOrigin === 'function' ? allowedOrigin(c.env, c) : allowedOrigin;
      // falha fechado: origin permitido vazio/indefinido nunca autoriza
      if (!allowed || c.req.header('origin') !== allowed) return c.json({ error: 'Origem não permitida' }, 403);
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
// pois o tamanho não poderia ser verificado antes de ler o corpo; valor que não seja só dígitos responde 400;
// acima do limite responde 413. O tamanho real do corpo lido deve ser conferido pela rota.
export function limitBody(maxBytes: number): MiddlewareHandler {
  return async (c, next) => {
    const length = c.req.header('content-length');
    if (length === undefined) {
      if (['POST', 'PUT', 'PATCH'].includes(c.req.method)) {
        return c.json({ error: 'Content-Length obrigatório' }, 411);
      }
    } else if (!/^\d+$/.test(length)) {
      return c.json({ error: 'Content-Length inválido' }, 400);
    } else if (Number(length) > maxBytes) {
      return c.json({ error: 'Corpo da requisição muito grande' }, 413);
    }
    await next();
  };
}
