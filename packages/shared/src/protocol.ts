import type { Point } from './arena.js';
import type { CardId } from './cards.js';
import type { PlayError } from './sim.js';
import type { StarterPick } from './starters.js';

/** Messages and options shared by client and server. All positions are in the sender's own perspective. */
export const ROOM_NAME = 'battle';

export const TRAINER_NAME_MAX = 16;

export interface JoinOptions {
  starters: StarterPick;
  /** Shown to the opponent. Trimmed and capped server-side; empty falls back to "Trainer". */
  name?: string;
  /** Eight different cards; omitted means the default deck. */
  deck?: CardId[];
  /** Only meaningful on create: hides the room from quick match; join by its id instead. */
  private?: boolean;
}

export interface PlayMessage extends Point {
  slot: number;
}

export interface HandMessage {
  hand: CardId[];
  next: CardId;
}

export interface ErrorMessage {
  error: PlayError | 'bad-message';
}

export function sanitizeTrainerName(raw: unknown): string {
  if (typeof raw !== 'string') return 'Trainer';
  const name = raw.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, TRAINER_NAME_MAX);
  return name === '' ? 'Trainer' : name;
}

export const MSG = {
  play: 'play',
  hand: 'hand',
  error: 'error',
  fx: 'fx',
} as const;
