import type { ErrorHandler, NotFoundHandler } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { GitHubError } from './github';
import { logError } from './logger';

// Erro com status HTTP definido, para ser convertido em resposta pela camada de rotas.
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

// Converte exceções das rotas em respostas JSON { error }. Mensagens internas nunca vão para o cliente.
export const onError: ErrorHandler = (err, c) => {
  if (err instanceof HttpError) {
    return c.json({ error: err.message }, err.status as ContentfulStatusCode);
  }
  const path = new URL(c.req.url).pathname;
  const info = { err: { name: err.name, message: err.message }, method: c.req.method, path };
  if (err instanceof GitHubError) {
    logError('falha ao falar com o GitHub', { ...info, status: err.status });
    return c.json({ error: 'Falha ao falar com o GitHub' }, 502);
  }
  logError('erro nao tratado', info);
  return c.json({ error: 'Erro interno do servidor' }, 500);
};

export const notFound: NotFoundHandler = (c) => c.json({ error: 'Não encontrado' }, 404);
