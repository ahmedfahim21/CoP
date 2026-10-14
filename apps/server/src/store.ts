import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import {
  DEFAULT_DECK, PROFILE_TAG_ALPHABET, PROFILE_TAG_LENGTH, START_TROPHIES, isDeck, isStarterPick, parseCredential, sanitizeTrainerName, trophyDelta,
  type CardId, type LeaderboardEntry, type MatchMode, type MatchRecord, type OwnProfile, type Outcome, type ProfileUpdate,
  type PublicProfile, type ResultReason, type StarterPick, type Team,
} from '@cop/shared';
import { DbError, type Rpc } from './db.js';

const DEFAULT_STARTERS: StarterPick = ['charmander', 'squirtle'];

/** One side of a finished battle, as the room reports it. */
export interface MatchSide {
  /** Null for guests and bots: they appear in the opponent's history but have no profile. */
  profileId: string | null;
  name: string;
  crowns: number;
}

export interface MatchReport {
  mode: MatchMode;
  /** Null on a draw. */
  winner: Team | null;
  reason: ResultReason;
  sides: [MatchSide, MatchSide];
}

/** Per-side outcome of recording a match. */
export interface RecordedSide {
  trophiesBefore: number;
  delta: number;
}

/** What cop_get_profile returns: an OwnProfile plus the credential hash. */
type StoredProfile = OwnProfile & { secretHash: string };

/** Attempts at recording a rated match whose trophies moved underneath it. */
const RECORD_ATTEMPTS = 4;

/**
 * Profiles, the trophy ladder and match history, on Supabase. The data logic lives in the
 * cop_* SQL functions (supabase/migrations); this class validates input, hashes
 * credentials and keeps the trophy formula in TypeScript, shared with the client.
 */
export class ProfileStore {
  constructor(private readonly db: Rpc) {}

  close() {
    return this.db.close();
  }

  async create(rawName: unknown, now = Date.now()): Promise<{ profile: OwnProfile; credential: string }> {
    const name = sanitizeTrainerName(rawName);
    const secret = randomBytes(24).toString('base64url');
    for (let attempt = 0; ; attempt++) {
      const id = newTag();
      try {
        const stored = await this.db.call<StoredProfile>('cop_create_profile', {
          p_id: id, p_secret_hash: hashSecret(secret), p_name: name, p_trophies: START_TROPHIES,
          p_deck: [...DEFAULT_DECK], p_starters: [...DEFAULT_STARTERS], p_now: now,
        });
        return { profile: toOwn(stored), credential: `${id}.${secret}` };
      } catch (err) {
        // A tag collision is astronomically rare; anything else is a real failure.
        if (attempt >= 4 || (err as DbError).code !== '23505') throw err;
      }
    }
  }

  /** The profile a credential belongs to, or null if it doesn't check out. */
  async authenticate(credential: unknown, now = Date.now()): Promise<OwnProfile | null> {
    const parsed = parseCredential(credential);
    if (!parsed) return null;
    const stored = await this.stored(parsed.id);
    if (!stored) return null;
    const expected = Buffer.from(stored.secretHash, 'hex');
    const actual = Buffer.from(hashSecret(parsed.secret), 'hex');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
    await this.db.call('cop_touch', { p_id: stored.id, p_now: now });
    return toOwn(stored);
  }

  async get(id: string): Promise<PublicProfile | null> {
    const stored = await this.stored(id);
    return stored ? toPublic(stored) : null;
  }

  async own(id: string): Promise<OwnProfile | null> {
    const stored = await this.stored(id);
    return stored ? toOwn(stored) : null;
  }

  /** Applies the valid fields of `update`; returns which were rejected. */
  async update(id: string, update: ProfileUpdate): Promise<{ profile: OwnProfile | null; rejected: string[] }> {
    const rejected: string[] = [];
    const deck = update.deck === undefined ? null : isDeck(update.deck) ? update.deck : (rejected.push('deck'), null);
    const starters = update.starters === undefined ? null : isStarterPick(update.starters) ? update.starters : (rejected.push('starters'), null);
    const stored = await this.db.call<StoredProfile | null>('cop_update_profile', {
      p_id: id,
      p_name: update.name === undefined ? null : sanitizeTrainerName(update.name),
      p_deck: deck,
      p_starters: starters,
    });
    return { profile: stored ? toOwn(stored) : null, rejected };
  }

  /**
   * Stores a finished battle and, for ranked battles between two different profiles,
   * moves trophies and ladder stats. The database locks both profiles and refuses if
   * their trophies moved since we read them; then we re-read, recompute and retry.
   */
  async recordMatch(report: MatchReport, now = Date.now()): Promise<[RecordedSide, RecordedSide]> {
    for (let attempt = 1; ; attempt++) {
      const [a, b] = report.sides;
      const stored = [a.profileId ? await this.stored(a.profileId) : null, b.profileId ? await this.stored(b.profileId) : null] as const;
      const rated = report.mode === 'ranked' && stored[0] !== null && stored[1] !== null && stored[0].id !== stored[1].id;
      const outcomeOf = (team: Team): Outcome => (report.winner === null ? 'draw' : report.winner === team ? 'win' : 'loss');
      const before = stored.map((p) => p?.trophies ?? 0) as [number, number];
      const deltas: [number, number] = rated
        ? [trophyDelta(before[0], before[1], outcomeOf(0)), trophyDelta(before[1], before[0], outcomeOf(1))]
        : [0, 0];
      try {
        await this.db.call('cop_record_match', {
          p_mode: report.mode, p_winner: report.winner, p_reason: report.reason, p_rated: rated, p_now: now,
          p_sides: report.sides.map((side, team) => ({
            profileId: stored[team]?.id ?? null, name: side.name, crowns: side.crowns, trophiesBefore: before[team], delta: deltas[team],
          })),
        });
        return [{ trophiesBefore: before[0], delta: deltas[0] }, { trophiesBefore: before[1], delta: deltas[1] }];
      } catch (err) {
        const stale = err instanceof DbError && err.code === 'P0001' && err.message.includes('stale_trophies');
        if (!stale || attempt >= RECORD_ATTEMPTS) throw err;
      }
    }
  }

  /** Most recent battles first. */
  recentMatches(id: string, limit = 20): Promise<MatchRecord[]> {
    return this.db.call<MatchRecord[]>('cop_recent_matches', { p_id: id, p_limit: limit });
  }

  leaderboard(limit = 50, offset = 0): Promise<{ entries: LeaderboardEntry[]; total: number }> {
    return this.db.call('cop_leaderboard', { p_limit: limit, p_offset: offset });
  }

  /** 1-based ladder position, or null before a first battle. */
  async rankOf(id: string): Promise<number | null> {
    return (await this.stored(id))?.rank ?? null;
  }

  private stored(id: string): Promise<StoredProfile | null> {
    return this.db.call<StoredProfile | null>('cop_get_profile', { p_id: id });
  }
}

function toPublic(p: StoredProfile): PublicProfile {
  return {
    id: p.id, name: p.name, createdAt: p.createdAt, rank: p.rank,
    trophies: p.trophies, bestTrophies: p.bestTrophies, wins: p.wins, losses: p.losses, draws: p.draws,
    threeCrowns: p.threeCrowns, streak: p.streak, bestStreak: p.bestStreak, battles: p.battles,
  };
}

function toOwn(p: StoredProfile): OwnProfile {
  return {
    ...toPublic(p),
    deck: isDeck(p.deck) ? p.deck : [...DEFAULT_DECK] as CardId[],
    starters: isStarterPick(p.starters) ? p.starters : DEFAULT_STARTERS,
  };
}

function newTag(): string {
  let tag = '';
  for (let i = 0; i < PROFILE_TAG_LENGTH; i++) tag += PROFILE_TAG_ALPHABET[randomInt(PROFILE_TAG_ALPHABET.length)];
  return tag;
}

function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}
