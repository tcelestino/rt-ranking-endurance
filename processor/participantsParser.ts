import * as fs from 'fs';
import * as path from 'path';

export interface Participants {
  female: string[];
  male: string[];
}

export function loadParticipants(filePath?: string): Participants {
  const resolved = filePath ?? path.resolve('data/runners.json');
  const raw = fs.readFileSync(resolved, 'utf-8');
  return JSON.parse(raw) as Participants;
}

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export function findParticipant(
  participants: Participants,
  name: string,
): { gender: 'female' | 'male'; canonicalName: string } | null {
  const normalized = normalize(name);
  const female = participants.female.some((n) => normalize(n) === normalized);
  const male = participants.male.some((n) => normalize(n) === normalized);

  if (female) {
    return {
      gender: 'female',
      canonicalName: participants.female.find((n) => normalize(n) === normalized)!,
    };
  }
  if (male) {
    return {
      gender: 'male',
      canonicalName: participants.male.find((n) => normalize(n) === normalized)!,
    };
  }
  return null;
}

export function saveParticipants(participants: Participants, filePath?: string): void {
  const resolved = filePath ?? path.resolve('data/runners.json');
  fs.writeFileSync(resolved, JSON.stringify(participants, null, 2) + '\n', 'utf-8');
}

export function addParticipant(participants: Participants, name: string, gender: 'female' | 'male'): string {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Nome do participante é obrigatório');

  const existing = findParticipant(participants, trimmed);
  if (existing) {
    const label = existing.gender === 'female' ? 'feminino' : 'masculino';
    throw new Error(`Participante "${existing.canonicalName}" já existe (${label})`);
  }

  participants[gender].push(trimmed);
  return trimmed;
}

export function removeParticipant(participants: Participants, name: string): string {
  const existing = findParticipant(participants, name);
  if (!existing) throw new Error(`Participante "${name}" não encontrado`);

  const list = participants[existing.gender];
  list.splice(list.indexOf(existing.canonicalName), 1);
  return existing.canonicalName;
}
