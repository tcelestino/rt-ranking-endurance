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

export function findGender(participants: Participants, name: string): 'female' | 'male' | null {
  const normalized = name.toLowerCase();

  if (participants.female.some((n) => n.toLowerCase() === normalized)) {
    return 'female';
  }
  if (participants.male.some((n) => n.toLowerCase() === normalized)) {
    return 'male';
  }
  return null;
}
