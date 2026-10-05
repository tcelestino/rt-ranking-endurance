import { clerkClient, getAuth } from '@clerk/express';
import { NextFunction, Request, Response } from 'express';

const ADMIN_ROLE = 'admin';

export function assertClerkEnv(): string {
  const missing = ['CLERK_PUBLISHABLE_KEY', 'CLERK_SECRET_KEY'].filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Variáveis ausentes no .env: ${missing.join(', ')}. Configure as chaves do Clerk.`);
  }
  return process.env.CLERK_PUBLISHABLE_KEY as string;
}

// exige sessão do Clerk e role "admin" em publicMetadata (exposta no session token como claim "metadata")
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const auth = getAuth(req);
  if (!auth.isAuthenticated) {
    res.status(401).json({ error: 'Sessão inválida ou expirada. Faça login novamente.' });
    return;
  }

  const metadata = auth.sessionClaims?.metadata as { role?: unknown } | undefined;
  if (metadata?.role !== ADMIN_ROLE) {
    console.warn(
      `[auth] usuário ${auth.userId} sem role "${ADMIN_ROLE}" tentou acessar ${req.method} ${req.originalUrl}`,
    );
    res.status(403).json({ error: 'Seu usuário não tem permissão para acessar o backoffice.' });
    return;
  }

  res.locals.userId = auth.userId;
  next();
}

export async function getUserSummary(userId: string) {
  const user = await clerkClient.users.getUser(userId);
  return {
    name: user.fullName,
    email: user.primaryEmailAddress?.emailAddress ?? null,
  };
}
