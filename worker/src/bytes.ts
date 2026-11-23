import { HttpError } from './errors';

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

// Aceita apenas base64 padrão (sem prefixo data:).
export function base64ToBytes(b64: string): Uint8Array {
  if (b64.length === 0) throw new HttpError(400, 'Imagem vazia');
  let binary: string;
  try {
    binary = atob(b64);
  } catch {
    throw new HttpError(400, 'Imagem inválida: base64 malformado');
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
