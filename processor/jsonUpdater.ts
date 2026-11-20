import { DataSource, fsDataSource } from './dataSource';
import { getCurrentYear } from './utils';
import { normalize } from './participantsParser';

export interface ParticipantRecord {
  name: string;
  km: number[];
  // pace (s/km) de cada atividade, alinhado por índice com km; ausente até o primeiro pace registrado
  pace?: (number | null)[];
}

const MONTH_NAMES: Record<number, string> = {
  1: 'janeiro',
  2: 'fevereiro',
  3: 'marco',
  4: 'abril',
  5: 'maio',
  6: 'junho',
  7: 'julho',
  8: 'agosto',
  9: 'setembro',
  10: 'outubro',
  11: 'novembro',
  12: 'dezembro',
};

export function getMonthName(month: number): string {
  const name = MONTH_NAMES[month];
  if (!name) throw new Error(`Mês inválido: ${month}`);
  return name;
}

export function monthRelPath(gender: 'female' | 'male', month: number, year = getCurrentYear()): string {
  return `${year}/${gender}-${getMonthName(month)}.json`;
}

export function loadMonthDataSync(
  gender: 'female' | 'male',
  month: number,
  year = getCurrentYear(),
  source: DataSource = fsDataSource,
): ParticipantRecord[] {
  const raw = source.readText(monthRelPath(gender, month, year));
  return raw === null ? [] : (JSON.parse(raw) as ParticipantRecord[]);
}

export function appendKm(
  data: ParticipantRecord[],
  name: string,
  km: number,
  pace: number | null = null,
): ParticipantRecord[] {
  const normalizedName = normalize(name);
  const existing = data.find((p) => p.name === name || normalize(p.name) === normalizedName);
  if (!existing) {
    data.push(pace === null ? { name, km: [km] } : { name, km: [km], pace: [pace] });
    return data;
  }

  if (pace !== null || existing.pace) {
    const paces = existing.pace ?? [];
    existing.pace = existing.km.map((_, i) => paces[i] ?? null);
    existing.pace.push(pace);
  }
  existing.km.push(km);
  return data;
}
