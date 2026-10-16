import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import {
  DEFAULT_DECK, PROFILE_TAG_ALPHABET, PROFILE_TAG_LENGTH, START_TROPHIES, STAGES, deckUnlocked, ghostTrophyDelta, isDeck, isStarterPick,
  levelFor, parseCredential, parseProgress, sanitizeTrainerName, seasonKey, totalStars, trophyDelta,
  type CardId, type LeaderboardEntry, type MatchMode, type MatchRecord, type OwnProfile, type Outcome, type Progress, type ProfileUpdate,
  type PublicProfile, type Replay, type ReplayResponse, type ResultReason, type ScoreboardResponse, type SeasonResult, type StarterPick, type Team,
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
  /** Ghost battles: the side the bot played with a real trainer's deck. Their profile only gets the history entry. */
  ghostTeam?: Team;
  replay?: Replay;
}

/** A real trainer the bot can play as. */
export interface Ghost {
  id: string;
  name: string;
  trophies: number;
  deck: CardId[];
  starters: StarterPick;
}

/** Trainers count as recently active, for ghosts, for this long. */
export const GHOST_ACTIVE_MS = 30 * 86_400_000;
/** Seasons: trophies above this are halved towards it when a new month starts. */
export const SEASON_FLOOR = 1000;

/** Per-side outcome of recording a match. */
export interface RecordedSide {
  trophiesBefore: number;
  delta: number;
}

/** What cop_get_profile returns: the profile row as JSON (progress unparsed) plus the credential hash. */
type StoredProfile = Omit<OwnProfile, 'progress' | 'level' | 'badges' | 'stars' | 'gauntletBest'> & {
  secretHash: string;
  progress: unknown;
  progressVersion: number;
  seasons: SeasonResult[];
};

/** Attempts at writing progress that someone else changed underneath us. */
const PROGRESS_ATTEMPTS = 6;

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

  /** Applies the valid fields of `update`; returns which were rejected. A deck must be legal and unlocked. */
  async update(id: string, update: ProfileUpdate): Promise<{ profile: OwnProfile | null; rejected: string[] }> {
    const rejected: string[] = [];
    let deck: CardId[] | null = null;
    if (update.deck !== undefined) {
      const stored = await this.stored(id);
      if (isDeck(update.deck) && stored && deckUnlocked(parseProgress(stored.progress), update.deck)) deck = update.deck;
      else rejected.push('deck');
    }
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
    return (await this.recordBattle(report, now)).sides;
  }

  /** recordMatch, plus the stored battle's id (for its replay). */
  async recordBattle(report: MatchReport, now = Date.now()): Promise<{ sides: [RecordedSide, RecordedSide]; matchId: number }> {
    for (let attempt = 1; ; attempt++) {
      const [a, b] = report.sides;
      const stored = [a.profileId ? await this.stored(a.profileId) : null, b.profileId ? await this.stored(b.profileId) : null] as const;
      const outcomeOf = (team: Team): Outcome => (report.winner === null ? 'draw' : report.winner === team ? 'win' : 'loss');
      const before = stored.map((p) => p?.trophies ?? 0) as [number, number];
      const distinct = stored[0] !== null && stored[1] !== null && stored[0].id !== stored[1].id;
      const ghost = report.mode === 'ghost' && report.ghostTeam !== undefined && distinct ? report.ghostTeam : null;
      const rated = report.mode === 'ranked' && distinct;
      const apply = ([0, 1] as const).map((t) => (rated ? 'rated' : ghost === null ? 'count' : t === ghost ? 'none' : 'rated'));
      const deltas = ([0, 1] as const).map((t) => {
        if (apply[t] !== 'rated') return 0;
        const them = before[(1 - t) as Team];
        return ghost === null ? trophyDelta(before[t], them, outcomeOf(t)) : ghostTrophyDelta(before[t], them, outcomeOf(t));
      }) as [number, number];
      try {
        const matchId = await this.db.call<number>('cop_record_battle', {
          p_mode: report.mode, p_winner: report.winner, p_reason: report.reason, p_now: now, p_replay: report.replay ?? null,
          p_sides: report.sides.map((side, team) => ({
            profileId: stored[team]?.id ?? null, name: side.name, crowns: side.crowns, trophiesBefore: before[team], delta: deltas[team],
            apply: apply[team],
          })),
        });
        return { sides: [{ trophiesBefore: before[0], delta: deltas[0] }, { trophiesBefore: before[1], delta: deltas[1] }], matchId };
      } catch (err) {
        const stale = err instanceof DbError && err.code === 'P0001' && err.message.includes('stale_trophies');
        if (!stale || attempt >= RECORD_ATTEMPTS) throw err;
      }
    }
  }

  /** The trainer's progress, for reading. */
  async progress(id: string): Promise<Progress | null> {
    const stored = await this.stored(id);
    return stored ? parseProgress(stored.progress) : null;
  }

  /**
   * Read-modify-write of a trainer's progress. `change` gets the current progress and returns
   * the new one plus anything to hand back; if someone else wrote in between, it runs again on
   * the fresh copy. Returns null for an unknown profile.
   */
  async updateProgress<T>(id: string, change: (p: Progress) => { progress: Progress; result: T }): Promise<T | null> {
    for (let attempt = 1; ; attempt++) {
      const stored = await this.stored(id);
      if (!stored) return null;
      const { progress, result } = change(parseProgress(stored.progress));
      try {
        await this.db.call('cop_save_progress', { p_id: id, p_progress: progress, p_version: stored.progressVersion });
        return result;
      } catch (err) {
        const stale = err instanceof DbError && err.code === 'P0001' && err.message.includes('stale_progress');
        if (!stale || attempt >= PROGRESS_ATTEMPTS) throw err;
      }
    }
  }

  /**
   * Up to `limit` recently active trainers to fight as ghosts, nearest in trophies first:
   * within 150, then 400, then anyone.
   */
  async ghosts(trophies: number, exclude: string | null, now = Date.now(), limit = 5): Promise<Ghost[]> {
    for (const window of [150, 400, 1_000_000]) {
      const found = await this.db.call<Ghost[]>('cop_ghosts', {
        p_trophies: trophies, p_window: window, p_exclude: exclude, p_since: now - GHOST_ACTIVE_MS, p_limit: limit,
      });
      const legal = found.filter((g) => isDeck(g.deck) && isStarterPick(g.starters));
      if (legal.length > 0) return legal;
    }
    return [];
  }

  /** Keeps a trainer's best score on a board; returns that best and its rank. */
  submitScore(board: ScoreboardResponse['board'], period: string, id: string, name: string, score: number, detail: Record<string, unknown> = {}, now = Date.now()) {
    return this.db.call<{ best: number; rank: number }>('cop_submit_score', {
      p_board: board, p_period: period, p_id: id, p_name: name, p_score: Math.round(score), p_detail: detail, p_now: now,
    });
  }

  async scoreboard(board: ScoreboardResponse['board'], period: string, limit = 50): Promise<ScoreboardResponse> {
    const r = await this.db.call<Omit<ScoreboardResponse, 'board' | 'period'>>('cop_scoreboard', { p_board: board, p_period: period, p_limit: limit });
    return { board, period, ...r, entries: r.entries.map(({ rank, id, name, score }) => ({ rank, id, name, score })) };
  }

  replay(matchId: number): Promise<ReplayResponse | null> {
    return this.db.call<ReplayResponse | null>('cop_replay', { p_match_id: matchId });
  }

  /** Starts a new ladder season if the month has turned (see cop_season_rollover). */
  seasonRollover(now = Date.now()) {
    return this.db.call<{ rolled: boolean; season: string; ended?: string; trainers?: number }>('cop_season_rollover', {
      p_season: seasonKey(now), p_floor: SEASON_FLOOR,
    });
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
  const progress = parseProgress(p.progress);
  return {
    id: p.id, name: p.name, createdAt: p.createdAt, rank: p.rank,
    trophies: p.trophies, bestTrophies: p.bestTrophies, wins: p.wins, losses: p.losses, draws: p.draws,
    threeCrowns: p.threeCrowns, streak: p.streak, bestStreak: p.bestStreak, battles: p.battles,
    level: levelFor(progress.xp).level,
    badges: STAGES.filter((s) => (progress.stars[s.id] ?? 0) > 0).map((s) => s.id),
    stars: totalStars(progress),
    gauntletBest: progress.gauntletBest,
    seasons: Array.isArray(p.seasons) ? p.seasons : [],
  };
}

function toOwn(p: StoredProfile): OwnProfile {
  const progress = parseProgress(p.progress);
  return {
    ...toPublic(p),
    // A deck saved before its cards were locked (or tampered with) falls back to the classic eight.
    deck: isDeck(p.deck) && deckUnlocked(progress, p.deck) ? p.deck : [...DEFAULT_DECK] as CardId[],
    starters: isStarterPick(p.starters) ? p.starters : DEFAULT_STARTERS,
    progress,
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
