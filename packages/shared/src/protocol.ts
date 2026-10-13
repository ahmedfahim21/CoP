import type { Point } from './arena.js';
import type { CardId } from './cards.js';
import type { MatchMode } from './profile.js';
import type { PlayError } from './sim.js';
import type { StarterPick } from './starters.js';

/** Messages and options shared by client and server. All positions are in the sender's own perspective. */
export const ROOM_NAME = 'battle';
/** Ranked matchmaking queue; pairs players by trophies and hands out battle seats. */
export const QUEUE_ROOM_NAME = 'queue';

export const TRAINER_NAME_MAX = 16;

export interface JoinOptions {
  starters: StarterPick;
  /** Shown to the opponent. Trimmed and capped server-side; empty falls back to "Trainer". */
  name?: string;
  /** Eight different cards; omitted means the default deck. */
  deck?: CardId[];
  /** Only meaningful on create: hides the room from quick match; join by its id instead. */
  private?: boolean;
  /** Only meaningful on create: a private practice battle against the server's bot. */
  training?: boolean;
  /** Profile credential ("<tag>.<secret>"). The profile's name replaces `name`; omitted means a guest. */
  credential?: string;
}

export interface QueueJoinOptions {
  /** Ranked play needs a profile. */
  credential: string;
  starters: StarterPick;
  deck?: CardId[];
}

/** Sent by the queue every second while searching. */
export interface QueueStatusMessage {
  /** Seconds in the queue. */
  waited: number;
  /** Trophy gap currently accepted; null once any opponent is fine. */
  range: number | null;
  /** Trainers searching right now, including you. */
  searching: number;
  /** Seconds until a bot steps in. */
  botIn: number;
}

/** The queue found a battle. Consume the reservation to join it. */
export interface SeatMessage {
  reservation: unknown;
  mode: Extract<MatchMode, 'ranked' | 'training'>;
}

export interface BattleStats {
  cardsPlayed: number;
  elixirSpent: number;
  /** Damage dealt to enemy towers. */
  towerDamage: number;
  /** Enemy troops defeated. */
  defeated: number;
}

/** Sent once when a battle ends, indexed by team. */
export interface SummaryMessage {
  mode: MatchMode;
  teams: [TeamSummary, TeamSummary];
}

export interface TeamSummary {
  trophies: number;
  /** Trophy change; 0 outside ranked. */
  delta: number;
  stats: BattleStats;
}

/** Who has asked for a rematch, by team. `open` is false once the rival has gone. */
export interface RematchStateMessage {
  requested: [boolean, boolean];
  open: boolean;
}

/** A rematch room is ready; consume the reservation to join it. */
export interface RematchMessage {
  reservation: unknown;
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
  summary: 'summary',
  rematch: 'rematch',
  rematchState: 'rematchState',
  queueStatus: 'queueStatus',
  seat: 'seat',
} as const;
