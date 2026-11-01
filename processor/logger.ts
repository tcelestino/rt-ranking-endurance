import pino, { DestinationStream, Logger, LoggerOptions } from 'pino';

export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.authorization',
  '*.apiToken',
];

interface CreateLoggerOptions {
  level?: string;
  pretty?: boolean;
  destination?: DestinationStream;
}

// nível padrão "silent": os CLIs de processor/ não emitem logs; o backoffice define LOG_LEVEL em backoffice/src/env.ts
export function createLogger({
  level = process.env.LOG_LEVEL ?? 'silent',
  pretty = false,
  destination,
}: CreateLoggerOptions = {}): Logger {
  const options: LoggerOptions = {
    level,
    base: { service: process.env.OTEL_SERVICE_NAME ?? 'rt-ranking-backoffice', env: process.env.NODE_ENV ?? 'development' },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: { paths: REDACT_PATHS, censor: '[Redacted]' },
  };

  if (pretty && !destination) {
    return pino({
      ...options,
      transport: {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l', ignore: 'pid,hostname,service,env' },
      },
    });
  }

  return pino({ ...options, formatters: { level: (label) => ({ level: label }) } }, destination);
}

const pretty = process.env.NODE_ENV !== 'production' && process.env.LOG_PRETTY !== 'false' && Boolean(process.stdout.isTTY);

export const logger = createLogger({ pretty });
