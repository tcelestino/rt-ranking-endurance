import * as fs from 'fs';
import * as path from 'path';

export interface ParticipantRecord {
  name: string;
  km: number[];
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

export function getDataFilePath(gender: 'female' | 'male', month: number): string {
  const monthStr = getMonthName(month);
  return path.resolve('data', `${gender}-${monthStr}.json`);
}

export function loadMonthData(gender: 'female' | 'male', month: number): ParticipantRecord[] {
  const filePath = getDataFilePath(gender, month);
  if (!fs.existsSync(filePath)) return [];

  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw) as ParticipantRecord[];
}

export function appendKm(data: ParticipantRecord[], name: string, km: number): ParticipantRecord[] {
  const existing = data.find((p) => p.name.toLowerCase() === name.toLowerCase());
  if (existing) {
    existing.km.push(km);
  } else {
    data.push({ name, km: [km] });
  }
  return data;
}

export function saveMonthData(gender: 'female' | 'male', month: number, data: ParticipantRecord[]): void {
  const filePath = getDataFilePath(gender, month);
  const dir = path.dirname(filePath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}
