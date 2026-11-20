import * as fs from 'fs';
import * as path from 'path';
import { monthRelPath, ParticipantRecord } from './jsonUpdater';
import { Participants } from './participantsParser';
import { getCurrentYear } from './utils';

// Escrita em disco (só uso local; o Worker não importa este módulo)

export function getDataFilePath(gender: 'female' | 'male', month: number, year = getCurrentYear()): string {
  return path.resolve(process.cwd(), 'data', monthRelPath(gender, month, year));
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

export function saveParticipants(participants: Participants, filePath?: string): void {
  const resolved = filePath ?? path.resolve('data/runners.json');
  fs.writeFileSync(resolved, JSON.stringify(participants, null, 2) + '\n', 'utf-8');
}
