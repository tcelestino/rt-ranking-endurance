import * as fs from 'fs';
import * as path from 'path';
import { normalize } from './participantsParser';

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

export function getFullYear(): number {
  return new Date().getFullYear();
}

export function getMonthName(month: number): string {
  const name = MONTH_NAMES[month];
  if (!name) throw new Error(`Mês inválido: ${month}`);
  return name;
}

export function getDataFilePath(gender: 'female' | 'male', month: number): string {
  const monthStr = getMonthName(month);
  const year = getFullYear();

  return path.resolve(process.cwd(), 'data', year.toString(), `${gender}-${monthStr}.json`);
}

export async function loadMonthData(gender: 'female' | 'male', month: number): Promise<ParticipantRecord[]> {
  const filePath = getDataFilePath(gender, month);
  try {
    const raw = await fs.promises.readFile(filePath, 'utf-8');
    return JSON.parse(raw) as ParticipantRecord[];
  } catch (err: any) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

export function appendKm(data: ParticipantRecord[], name: string, km: number): ParticipantRecord[] {
  const normalizedName = normalize(name);
  const existing = data.find((p) => p.name === name || normalize(p.name) === normalizedName);
  if (existing) {
    existing.km.push(km);
  } else {
    data.push({ name, km: [km] });
  }
  return data;
}

export async function saveMonthData(
  gender: 'female' | 'male',
  month: number,
  data: ParticipantRecord[],
): Promise<void> {
  const filePath = getDataFilePath(gender, month);
  const dir = path.dirname(filePath);

  try {
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  } catch (err) {
    console.error(`Erro ao salvar dados em ${filePath}:`, err);
    throw err;
  }
}
