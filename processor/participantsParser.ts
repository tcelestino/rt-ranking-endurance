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
