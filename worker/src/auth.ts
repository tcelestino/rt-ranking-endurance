import { createClerkClient } from '@clerk/backend';
import type { MiddlewareHandler } from 'hono';
import { logError, logWarn } from './logger';

const ADMIN_ROLE = 'admin';

export type VerifyResult = { ok: true; userId: string; claims: { metadata?: { role?: unknown } } } | { ok: false };

export type AuthVariables = { userId: string };

// Subconjunto de Env (sem importá-lo: env.ts usa tipos do Workers, ausentes no tsconfig do backoffice que checa tests/)
type ClerkEnv = { CLERK_SECRET_KEY: string; CLERK_PUBLISHABLE_KEY: string };

function errorInfo(err: unknown) {
  return err instanceof Error ? { name: err.name, message: err.message } : { message: String(err) };
}

function createClient(env: ClerkEnv) {
  return createClerkClient({ secretKey: env.CLERK_SECRET_KEY, publishableKey: env.CLERK_PUBLISHABLE_KEY });
}

// Valida o session token do Clerk. Falha fechada: qualquer exceção vira { ok: false }.
export function clerkVerifier(env: ClerkEnv & { ALLOWED_ORIGIN: string }): (req: Request) => Promise<VerifyResult> {
  return async (req) => {
    try {
      const state = await createClient(env).authenticateRequest(req, { authorizedParties: [env.ALLOWED_ORIGIN] });
      if (!state.isAuthenticated) return { ok: false };
      const auth = state.toAuth();
      return {
        ok: true,
        userId: auth.userId,
        claims: { metadata: auth.sessionClaims?.metadata as { role?: unknown } | undefined },
      };
    } catch (err) {
      logError('falha ao verificar sessão do Clerk', { err: errorInfo(err) });
      return { ok: false };
    }
  };
}

// Exige sessão válida (401) e role "admin" em publicMetadata, exposta no session token como "metadata" (403).
export function requireAdmin(
  verify: (req: Request) => Promise<VerifyResult>,
): MiddlewareHandler<{ Variables: AuthVariables }> {
  return async (c, next) => {
    let result: VerifyResult;
    try {
      result = await verify(c.req.raw);
    } catch (err) {
      logError('falha ao verificar sessão', { err: errorInfo(err) });
      result = { ok: false };
    }

    if (!result.ok) {
      return c.json({ error: 'Sessão inválida ou expirada. Faça login novamente.' }, 401);
    }

    if (result.claims.metadata?.role !== ADMIN_ROLE) {
      logWarn(`acesso negado: usuario sem role "${ADMIN_ROLE}"`, {
        userId: result.userId,
        method: c.req.method,
        path: new URL(c.req.url).pathname,
      });
      return c.json({ error: 'Seu usuário não tem permissão para acessar o backoffice.' }, 403);
    }

    c.set('userId', result.userId);
    await next();
  };
}

export async function getUserSummary(
  env: ClerkEnv,
  userId: string,
): Promise<{ name: string | null; email: string | null }> {
  const user = await createClient(env).users.getUser(userId);
  return {
    name: user.fullName,
    email: user.primaryEmailAddress?.emailAddress ?? null,
  };
}
