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
