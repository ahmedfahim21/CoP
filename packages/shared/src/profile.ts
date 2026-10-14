import type { CardId } from './cards.js';
import type { Outcome } from './ranking.js';
import type { ResultReason } from './sim.js';
import type { StarterPick } from './starters.js';

/** Shapes of the profile and leaderboard HTTP API (`/api/*`). */

export type MatchMode = 'ranked' | 'friendly' | 'training' | 'casual';

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
}

/** What the owner sees: their loadout too. */
export interface OwnProfile extends PublicProfile {
  deck: CardId[];
  starters: StarterPick;
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
