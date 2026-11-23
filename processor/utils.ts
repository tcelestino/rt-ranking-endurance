const TIME_ZONE = 'America/Sao_Paulo';

function datePart(now: Date, type: 'month' | 'year'): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: 'numeric',
  }).formatToParts(now);
  return Number(parts.find((p) => p.type === type)!.value);
}

// `override` (ex.: env.CURRENT_MONTH do Worker) vence o relógio. Sem o argumento (arguments.length < 2), cai em
// process.env.CURRENT_MONTH, preservando o comportamento do CLI/backoffice local. No Worker `process` pode não existir.
export function getCurrentMonth(now: Date = new Date(), override?: string): number {
  const raw =
    arguments.length >= 2 ? override : typeof process !== 'undefined' ? process.env?.CURRENT_MONTH : undefined;
  if (raw) {
    const parsed = parseInt(raw, 10);
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
