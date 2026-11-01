import { NextFunction, Request, Response } from 'express';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

// erros do body-parser (JSON inválido, corpo grande demais) trazem status 4xx e o corpo cru em err.body
function resolveStatus(err: unknown): number {
  if (err instanceof HttpError) return err.status;
  const status = (err as { status?: unknown } | null)?.status;
  return typeof status === 'number' && status >= 400 && status < 500 ? status : 500;
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  const status = resolveStatus(err);
  const message = err instanceof Error ? err.message : String(err);
  if (status >= 500) {
    req.log.error({ err, status }, message);
  } else {
    // 4xx: nunca loga o objeto do erro (pode conter o corpo da requisição)
    req.log.warn({ status }, message);
  }
  res.status(status).json({ error: message });
}
