import { parsePace } from './pace';

export interface ActivityResult {
  km: number;
  pace: number | null;
}

export const ACTIVITY_PROMPT = `Extract the total running distance and the average pace from this screenshot.
Rules:
1. Return ONLY a JSON object: {"km": <number>, "pace": "<m:ss>" | null}.
2. "km": total distance as a decimal number using '.' separator, or null if not found.
3. "pace": the AVERAGE pace per km (e.g. "5:45"). Ignore split/lap paces. Use null if no average pace is shown.
4. No units, markdown or explanation.
Examples: "10,5 km" and "Pace médio 5'45\\"/km" -> {"km": 10.5, "pace": "5:45"} | "5.25 km" only -> {"km": 5.25, "pace": null}`;

function parseKm(value: unknown, raw: string): number {
  const km = typeof value === 'number' ? value : parseFloat(String(value ?? '').replace(',', '.'));
  if (!Number.isFinite(km)) throw new Error(`Não foi possível extrair km: "${raw.trim()}"`);
  return km;
}

export function parseActivityResponse(raw: string): ActivityResult {
  const json = raw.match(/\{[\s\S]*\}/);
  if (!json) return { km: parseKm(raw.trim(), raw), pace: null };

  let parsed: { km?: unknown; pace?: unknown };
  try {
    parsed = JSON.parse(json[0]);
  } catch {
    throw new Error(`Resposta inválida do modelo: "${raw.trim()}"`);
  }

  const pace = typeof parsed.pace === 'string' ? parsePace(parsed.pace) : null;
  return { km: parseKm(parsed.km, raw), pace };
}
