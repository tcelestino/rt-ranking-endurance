// erros do execFile carregam stdout/stderr completos (e o comando); loga só o que identifica a falha
export function summarizeExecError(err: unknown) {
  const { code, signal, killed } = err as { code?: unknown; signal?: unknown; killed?: unknown };
  return { code, signal, killed };
}
