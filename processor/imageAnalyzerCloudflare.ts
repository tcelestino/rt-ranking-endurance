import { KM_PROMPT, parseKmResponse } from './kmPrompt';
import { logger } from './logger';

const log = logger.child({ module: 'imageAnalyzerCloudflare' });

const DEFAULT_MODEL = '@cf/meta/llama-3.2-11b-vision-instruct';

interface WorkersAiResponse {
  success: boolean;
  result?: { response?: string | number | null };
  errors?: { code: number; message: string }[];
}

function getConfig() {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !apiToken) {
    throw new Error('CLOUDFLARE_ACCOUNT_ID e CLOUDFLARE_API_TOKEN precisam estar definidos no .env');
  }
  return { accountId, apiToken, model: process.env.CLOUDFLARE_AI_MODEL || DEFAULT_MODEL };
}

export async function extractKmFromImageBuffer(buffer: Buffer, mimeType: string): Promise<number> {
  const { accountId, apiToken, model } = getConfig();
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`;

  const startedAt = Date.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: KM_PROMPT },
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${buffer.toString('base64')}` } },
          ],
        },
      ],
      max_tokens: 20,
    }),
  });

  const body = (await res.json().catch(() => null)) as WorkersAiResponse | null;
  const durationMs = Date.now() - startedAt;
  if (!res.ok || !body?.success) {
    const detail = body?.errors?.map((e) => `${e.code}: ${e.message}`).join('; ') ?? 'sem detalhes';
    log.error({ model, status: res.status, durationMs, detail }, 'Workers AI retornou erro');
    throw new Error(`Workers AI falhou (HTTP ${res.status}, modelo ${model}): ${detail}`);
  }

  const response = body.result?.response;
  if (response === undefined || response === null) {
    log.error({ model, status: res.status, durationMs }, 'Workers AI não retornou resposta');
    throw new Error('Workers AI não retornou resposta');
  }
  log.debug({ model, status: res.status, durationMs, rawResponse: String(response) }, 'resposta do Workers AI');
  return parseKmResponse(String(response));
}
