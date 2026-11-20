import { ACTIVITY_PROMPT, parseActivityResponse, type ActivityResult } from '../../processor/kmPrompt';

const DEFAULT_MODEL = '@cf/meta/llama-3.2-11b-vision-instruct';
const CHUNK_SIZE = 0x8000;

export interface AiBinding {
  run(model: string, input: unknown): Promise<unknown>;
}

// Em blocos para não estourar a pilha com imagens grandes.
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK_SIZE));
  }
  return btoa(binary);
}

export async function analyzeImage(
  ai: AiBinding,
  bytes: Uint8Array,
  mimeType: string,
  model: string = DEFAULT_MODEL,
): Promise<ActivityResult> {
  const output = await ai.run(model, {
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: ACTIVITY_PROMPT },
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${bytesToBase64(bytes)}` } },
        ],
      },
    ],
    max_tokens: 60,
  });

  const response = (output as { response?: unknown } | null)?.response;
  if (response === undefined || response === null) {
    throw new Error('Workers AI não retornou resposta');
  }
  return parseActivityResponse(response);
}
