// Log mínimo: uma linha JSON por evento. Nunca passe tokens, headers ou corpos em `fields`.
type Fields = Record<string, unknown>;

export function logInfo(msg: string, fields: Fields = {}): void {
  console.log(JSON.stringify({ level: 'info', msg, ...fields }));
}

export function logWarn(msg: string, fields: Fields = {}): void {
  console.warn(JSON.stringify({ level: 'warn', msg, ...fields }));
}

export function logError(msg: string, fields: Fields = {}): void {
  console.error(JSON.stringify({ level: 'error', msg, ...fields }));
}
