const TIME_ZONE = 'America/Sao_Paulo';

function datePart(now: Date, type: 'month' | 'year'): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, year: 'numeric', month: 'numeric' }).formatToParts(now);
  return Number(parts.find((p) => p.type === type)!.value);
}

export function getCurrentMonth(now: Date = new Date()): number {
  const env = process.env.CURRENT_MONTH;
  if (env) {
    const parsed = parseInt(env, 10);
    if (!isNaN(parsed) && parsed >= 1 && parsed <= 12) return parsed;
  }
  return datePart(now, 'month');
}

export function getCurrentYear(now: Date = new Date()): number {
  return datePart(now, 'year');
}

export function capitalizeFirstLetter(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}
