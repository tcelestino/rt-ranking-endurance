import { randomUUID } from 'crypto';
import type { IncomingMessage } from 'http';
import type { Logger } from 'pino';
import pinoHttp from 'pino-http';

const REQUEST_ID_PATTERN = /^[\w-]{1,64}$/;

// após o mount de um router o Express reescreve req.url; originalUrl mantém o caminho completo
function requestUrl(req: IncomingMessage): string {
  return (req as IncomingMessage & { originalUrl?: string }).originalUrl ?? req.url ?? '';
}

export function createRequestLogger(logger: Logger) {
  return pinoHttp({
    logger,
    genReqId: (req, res) => {
      const incoming = req.headers['x-request-id'];
      const id = typeof incoming === 'string' && REQUEST_ID_PATTERN.test(incoming) ? incoming : randomUUID();
      res.setHeader('x-request-id', id);
      return id;
    },
    autoLogging: { ignore: (req) => !req.url?.startsWith('/api/') },
    customLogLevel: (_req, res, err) => {
      if (err || res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
    customSuccessMessage: (req, res) => `${req.method} ${requestUrl(req)} ${res.statusCode}`,
    customErrorMessage: (req, res) => `${req.method} ${requestUrl(req)} ${res.statusCode} falhou`,
    // só o necessário: nunca headers nem corpo
    serializers: {
      req: (req) => ({ id: req.id, method: req.method, url: req.url }),
      res: (res) => ({ statusCode: res.statusCode }),
    },
  });
}
