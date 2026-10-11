// pace em segundos por km; fora desta faixa o valor é tratado como leitura inválida
export const MIN_PACE = 120;
export const MAX_PACE = 1200;

export interface PaceTotals {
  km: number;
  seconds: number;
}

export function isValidPace(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= MIN_PACE && value <= MAX_PACE;
}

// aceita "5:45", "5'45\"", "5'45", "5:45/km" e "5:45 min/km"
export function parsePace(text: string): number | null {
  const match = text.trim().match(/^(\d{1,2})\s*[:'’]\s*(\d{2})/);
  if (!match) return null;
  const seconds = Number(match[2]);
  if (seconds >= 60) return null;
  const pace = Number(match[1]) * 60 + seconds;
  return isValidPace(pace) ? pace : null;
}

export function formatPace(seconds: number): string {
  const rounded = Math.round(seconds);
  const min = Math.floor(rounded / 60);
  const sec = String(rounded % 60).padStart(2, '0');
  return `${min}'${sec}"/km`;
}

// soma só as atividades com pace, para a média ponderada pela distância
export function paceTotals(km: number[], pace: (number | null)[] = []): PaceTotals {
  const totals = { km: 0, seconds: 0 };
  km.forEach((value, i) => {
    const p = pace[i];
    if (value > 0 && p !== null && p !== undefined) {
      totals.km += value;
      totals.seconds += value * p;
    }
  });
  return totals;
}

export function addPaceTotals(a: PaceTotals, b: PaceTotals): PaceTotals {
  return { km: a.km + b.km, seconds: a.seconds + b.seconds };
}

export function averagePace(totals: PaceTotals): number | null {
  return totals.km > 0 ? Math.round(totals.seconds / totals.km) : null;
}
