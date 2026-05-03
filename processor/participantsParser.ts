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

export function findGender(participants: Participants, name: string): 'female' | 'male' | null {
  const normalized = normalize(name);

  if (participants.female.some((n) => normalize(n) === normalized)) {
    return 'female';
  }
  if (participants.male.some((n) => normalize(n) === normalized)) {
    return 'male';
  }
  return null;
}

export function findCanonicalName(participants: Participants, name: string): string | null {
  const normalized = normalize(name);

  const female = participants.female.find((n) => normalize(n) === normalized);
  if (female) return female;

  const male = participants.male.find((n) => normalize(n) === normalized);
  if (male) return male;

  return null;
}
