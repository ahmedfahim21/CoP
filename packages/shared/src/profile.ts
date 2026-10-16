import type { CardId } from './cards.js';
import type { Progress } from './progression.js';
import type { Outcome } from './ranking.js';
import type { ResultReason } from './sim.js';
import type { StarterPick } from './starters.js';

/** Shapes of the profile and leaderboard HTTP API (`/api/*`). */

/**
 * ranked: two trainers, trophies move. ghost: you against the bot playing a real trainer's
 * deck, only your trophies move (at half rate). league, daily, gauntlet, event: single-player
 * modes against the bot. friendly: a private room. training: free practice. casual: unrated.
 */
export type MatchMode = 'ranked' | 'ghost' | 'league' | 'daily' | 'gauntlet' | 'event' | 'friendly' | 'training' | 'casual';

/** Modes that move trophies. */
export const RATED_MODES: readonly MatchMode[] = ['ranked', 'ghost'];

export interface ProfileStats {
  trophies: number;
  bestTrophies: number;
  wins: number;
  losses: number;
  draws: number;
  threeCrowns: number;
  /** Current ranked win streak. */
  streak: number;
  bestStreak: number;
  /** Battles of any mode. */
  battles: number;
}

/** What anyone can see. */
export interface PublicProfile extends ProfileStats {
  /** Clash-style player tag, e.g. "8QYL2GPC". */
  id: string;
  name: string;
  createdAt: number;
  /** Ladder position, or null before the first battle of any kind. */
  rank: number | null;
  level: number;
  /** League stages cleared, by id, and total stars. */
  badges: string[];
  stars: number;
  gauntletBest: number;
  /** Past ladder seasons, newest first. */
  seasons: SeasonResult[];
}

export interface SeasonResult {
  /** e.g. "2026-10". */
  season: string;
  trophies: number;
  rank: number;
}

/** What the owner sees: their loadout too. */
export interface OwnProfile extends PublicProfile {
  deck: CardId[];
  starters: StarterPick;
  progress: Progress;
}

export interface MatchRecord {
  id: number;
  playedAt: number;
  mode: MatchMode;
  outcome: Outcome;
  reason: ResultReason;
  crowns: number;
  opponentCrowns: number;
  /** Trophy change for this player (0 outside ranked). */
  delta: number;
  opponent: { id: string | null; name: string; trophies: number };
  /** Whether the battle can be watched again (GET /api/replays/:id). */
  hasReplay?: boolean;
  /** This player's side in the battle (for watching a replay from it). */
  team?: number;
}

export interface ProfileResponse {
  profile: PublicProfile;
  matches: MatchRecord[];
}

export interface OwnProfileResponse {
  profile: OwnProfile;
  matches: MatchRecord[];
}

/** Returned once, on creation. The credential is the only way back into the profile. */
export interface CreatedProfileResponse {
  profile: OwnProfile;
  credential: string;
}

export interface ProfileUpdate {
  name?: string;
  deck?: CardId[];
  starters?: StarterPick;
}

export interface LeaderboardEntry {
  rank: number;
  id: string;
  name: string;
  trophies: number;
  wins: number;
  losses: number;
  /** Battles of every kind, bot and friendly included. */
  battles: number;
  /** Has played ranked; otherwise on the ladder with no trophies from bot or friendly battles. */
  rated: boolean;
  /** Total XP, for the trainer level. */
  xp?: number;
}

/** A Daily Challenge or Gauntlet board. */
export interface ScoreboardResponse {
  board: 'daily' | 'gauntlet';
  /** The day ("2026-10-16") or season ("2026-10"). */
  period: string;
  entries: Array<{ rank: number; id: string; name: string; score: number }>;
  total: number;
}

export interface ReplayResponse {
  id: number;
  playedAt: number;
  mode: MatchMode;
  winner: number | null;
  reason: ResultReason;
  replay: unknown;
  players: Array<{ team: number; name: string; profileId: string | null; crowns: number }>;
}

/** Live counts for the Battle tab. */
export interface StatusResponse {
  online: number;
  searching: number;
  inBattle: number;
}

export interface LeaderboardResponse {
  entries: LeaderboardEntry[];
  /** Ranked players in total. */
  total: number;
}

/** Profile credentials are "<tag>.<secret>". Tags only use these characters. */
export const PROFILE_TAG_ALPHABET = '0289PYLQGRJCUV';
export const PROFILE_TAG_LENGTH = 8;

export function isProfileTag(v: unknown): v is string {
  return typeof v === 'string' && v.length === PROFILE_TAG_LENGTH && [...v].every((c) => PROFILE_TAG_ALPHABET.includes(c));
}

/** Splits a credential into its tag and secret, or null if it isn't shaped like one. */
export function parseCredential(v: unknown): { id: string; secret: string } | null {
  if (typeof v !== 'string') return null;
  const dot = v.indexOf('.');
  if (dot < 0) return null;
  const id = v.slice(0, dot);
  const secret = v.slice(dot + 1);
  if (!isProfileTag(id) || !/^[A-Za-z0-9_-]{16,128}$/.test(secret)) return null;
  return { id, secret };
}

export function winRate(p: Pick<ProfileStats, 'wins' | 'losses' | 'draws'>): number | null {
  const n = p.wins + p.losses + p.draws;
  return n === 0 ? null : p.wins / n;
}
