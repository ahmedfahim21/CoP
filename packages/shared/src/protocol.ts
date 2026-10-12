import type { Point } from './arena.js';
import type { CardId } from './cards.js';
import type { PlayError } from './sim.js';
import type { StarterPick } from './starters.js';

/** Messages and options shared by client and server. All positions are in the sender's own perspective. */
export const ROOM_NAME = 'battle';

export interface JoinOptions {
  starters: StarterPick;
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

export const MSG = {
  play: 'play',
  hand: 'hand',
  error: 'error',
  fx: 'fx',
} as const;
