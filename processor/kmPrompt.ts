export const KM_PROMPT = `Extract the total running distance from this screenshot.
Rules:
1. Return ONLY the numeric value (decimal, use '.' separator).
2. No units or explanation.
3. If not found, return null.
Examples: "10,5 km" -> 10.5 | "5.25" -> 5.25 | none -> null`;

export function parseKmResponse(raw: string): number {
  const text = raw.trim().replace(',', '.');
  const km = parseFloat(text);
  if (isNaN(km)) throw new Error(`Não foi possível extrair km: "${text}"`);
  return km;
}
