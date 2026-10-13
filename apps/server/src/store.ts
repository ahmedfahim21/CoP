import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  DEFAULT_DECK, PROFILE_TAG_ALPHABET, PROFILE_TAG_LENGTH, START_TROPHIES, isDeck, isStarterPick, parseCredential, sanitizeTrainerName, trophyDelta,
  type CardId, type LeaderboardEntry, type MatchMode, type MatchRecord, type OwnProfile, type Outcome, type ProfileUpdate,
  type PublicProfile, type ResultReason, type StarterPick, type Team,
} from '@cop/shared';

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

interface ProfileRow {
  id: string;
  secret_hash: string;
  name: string;
  trophies: number;
  best_trophies: number;
  wins: number;
  losses: number;
  draws: number;
  three_crowns: number;
  streak: number;
  best_streak: number;
  battles: number;
  deck: string;
  starters: string;
  created_at: number;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  secret_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  trophies INTEGER NOT NULL,
  best_trophies INTEGER NOT NULL,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  draws INTEGER NOT NULL DEFAULT 0,
  three_crowns INTEGER NOT NULL DEFAULT 0,
  streak INTEGER NOT NULL DEFAULT 0,
  best_streak INTEGER NOT NULL DEFAULT 0,
  battles INTEGER NOT NULL DEFAULT 0,
  deck TEXT NOT NULL,
  starters TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL
);
-- The ladder only lists players who have played ranked.
CREATE INDEX IF NOT EXISTS profiles_ladder ON profiles (trophies DESC, wins DESC, created_at ASC) WHERE wins + losses + draws > 0;
CREATE TABLE IF NOT EXISTS matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  played_at INTEGER NOT NULL,
  mode TEXT NOT NULL,
  winner INTEGER,
  reason TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS match_players (
  match_id INTEGER NOT NULL REFERENCES matches (id),
  team INTEGER NOT NULL,
  profile_id TEXT REFERENCES profiles (id),
  name TEXT NOT NULL,
  trophies_before INTEGER NOT NULL,
  delta INTEGER NOT NULL,
  crowns INTEGER NOT NULL,
  PRIMARY KEY (match_id, team)
);
CREATE INDEX IF NOT EXISTS match_players_profile ON match_players (profile_id, match_id DESC);
`;

/** Ladder order, shared by the leaderboard and rank lookups. */
const RANKED = 'wins + losses + draws > 0';
const LADDER_ORDER = 'trophies DESC, wins DESC, created_at ASC, id ASC';

/**
 * Profiles, the trophy ladder and match history, in SQLite. Synchronous on purpose: every
 * call is a few indexed statements, and rooms can use it without awaiting mid-tick.
 */
export class ProfileStore {
  private readonly db: DatabaseSync;

  /** `path` is a file, or ':memory:' for tests. */
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    this.db.exec(SCHEMA);
  }

  close() {
    this.db.close();
  }

  create(rawName: unknown, now = Date.now()): { profile: OwnProfile; credential: string } {
    const name = sanitizeTrainerName(rawName);
    const secret = randomBytes(24).toString('base64url');
    const insert = this.db.prepare(`
      INSERT INTO profiles (id, secret_hash, name, trophies, best_trophies, deck, starters, created_at, last_seen)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (let attempt = 0; ; attempt++) {
      const id = newTag();
      try {
        insert.run(id, hashSecret(secret), name, START_TROPHIES, START_TROPHIES, JSON.stringify(DEFAULT_DECK), JSON.stringify(DEFAULT_STARTERS), now, now);
        return { profile: this.own(id)!, credential: `${id}.${secret}` };
      } catch (err) {
        // A tag collision is astronomically rare; anything else is a real failure.
        if (attempt >= 4 || !String(err).includes('UNIQUE')) throw err;
      }
    }
  }

  /** The profile a credential belongs to, or null if it doesn't check out. */
  authenticate(credential: unknown, now = Date.now()): OwnProfile | null {
    const parsed = parseCredential(credential);
    if (!parsed) return null;
    const row = this.row(parsed.id);
    if (!row) return null;
    const expected = Buffer.from(row.secret_hash, 'hex');
    const actual = Buffer.from(hashSecret(parsed.secret), 'hex');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
    this.db.prepare('UPDATE profiles SET last_seen = ? WHERE id = ?').run(now, row.id);
    return this.toOwn(row);
  }

  get(id: string): PublicProfile | null {
    const row = this.row(id);
    return row ? this.toPublic(row) : null;
  }

  own(id: string): OwnProfile | null {
    const row = this.row(id);
    return row ? this.toOwn(row) : null;
  }

  /** Applies the valid fields of `update`; returns which were rejected. */
  update(id: string, update: ProfileUpdate): { profile: OwnProfile | null; rejected: string[] } {
    const rejected: string[] = [];
    if (update.name !== undefined) {
      this.db.prepare('UPDATE profiles SET name = ? WHERE id = ?').run(sanitizeTrainerName(update.name), id);
    }
    if (update.deck !== undefined) {
      if (isDeck(update.deck)) this.db.prepare('UPDATE profiles SET deck = ? WHERE id = ?').run(JSON.stringify(update.deck), id);
      else rejected.push('deck');
    }
    if (update.starters !== undefined) {
      if (isStarterPick(update.starters)) this.db.prepare('UPDATE profiles SET starters = ? WHERE id = ?').run(JSON.stringify(update.starters), id);
      else rejected.push('starters');
    }
    return { profile: this.own(id), rejected };
  }

  /**
   * Stores a finished battle and, for ranked battles between two different profiles,
   * moves trophies and ladder stats. Everything happens in one transaction.
   */
  recordMatch(report: MatchReport, now = Date.now()): [RecordedSide, RecordedSide] {
    const [a, b] = report.sides;
    const rows = [a.profileId ? this.row(a.profileId) ?? null : null, b.profileId ? this.row(b.profileId) ?? null : null] as const;
    const rated = report.mode === 'ranked' && rows[0] !== null && rows[1] !== null && rows[0].id !== rows[1].id;
    const outcomeOf = (team: Team): Outcome => (report.winner === null ? 'draw' : report.winner === team ? 'win' : 'loss');
    const before = rows.map((r) => r?.trophies ?? 0) as [number, number];
    const deltas: [number, number] = rated
      ? [trophyDelta(before[0], before[1], outcomeOf(0)), trophyDelta(before[1], before[0], outcomeOf(1))]
      : [0, 0];

    this.db.exec('BEGIN');
    try {
      const { lastInsertRowid } = this.db.prepare('INSERT INTO matches (played_at, mode, winner, reason) VALUES (?, ?, ?, ?)')
        .run(now, report.mode, report.winner, report.reason);
      const addPlayer = this.db.prepare(`
        INSERT INTO match_players (match_id, team, profile_id, name, trophies_before, delta, crowns) VALUES (?, ?, ?, ?, ?, ?, ?)`);
      for (const team of [0, 1] as const) {
        const side = report.sides[team];
        const row = rows[team];
        addPlayer.run(lastInsertRowid, team, row?.id ?? null, side.name, before[team], deltas[team], side.crowns);
        if (!row) continue;
        if (!rated) {
          this.db.prepare('UPDATE profiles SET battles = battles + 1 WHERE id = ?').run(row.id);
          continue;
        }
        const outcome = outcomeOf(team);
        const trophies = before[team] + deltas[team];
        const streak = outcome === 'win' ? row.streak + 1 : 0;
        this.db.prepare(`
          UPDATE profiles SET
            trophies = ?, best_trophies = MAX(best_trophies, ?),
            wins = wins + ?, losses = losses + ?, draws = draws + ?,
            three_crowns = three_crowns + ?, streak = ?, best_streak = MAX(best_streak, ?), battles = battles + 1
          WHERE id = ?`).run(
          trophies, trophies,
          outcome === 'win' ? 1 : 0, outcome === 'loss' ? 1 : 0, outcome === 'draw' ? 1 : 0,
          outcome === 'win' && side.crowns === 3 ? 1 : 0, streak, streak,
          row.id,
        );
      }
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
    return [{ trophiesBefore: before[0], delta: deltas[0] }, { trophiesBefore: before[1], delta: deltas[1] }];
  }

  /** Most recent battles first. */
  recentMatches(id: string, limit = 20): MatchRecord[] {
    const rows = this.db.prepare(`
      SELECT m.id, m.played_at, m.mode, m.winner, m.reason,
             me.team, me.delta, me.crowns,
             opp.profile_id AS opp_id, opp.name AS opp_name, opp.trophies_before AS opp_trophies, opp.crowns AS opp_crowns
      FROM match_players me
      JOIN matches m ON m.id = me.match_id
      JOIN match_players opp ON opp.match_id = me.match_id AND opp.team != me.team
      WHERE me.profile_id = ?
      ORDER BY me.match_id DESC
      LIMIT ?`).all(id, limit) as Array<{
        id: number; played_at: number; mode: MatchMode; winner: number | null; reason: ResultReason;
        team: number; delta: number; crowns: number;
        opp_id: string | null; opp_name: string; opp_trophies: number; opp_crowns: number;
      }>;
    return rows.map((r) => ({
      id: r.id,
      playedAt: r.played_at,
      mode: r.mode,
      outcome: r.winner === null ? 'draw' : r.winner === r.team ? 'win' : 'loss',
      reason: r.reason,
      crowns: r.crowns,
      opponentCrowns: r.opp_crowns,
      delta: r.delta,
      opponent: { id: r.opp_id, name: r.opp_name, trophies: r.opp_trophies },
    }));
  }

  leaderboard(limit = 50, offset = 0): { entries: LeaderboardEntry[]; total: number } {
    const rows = this.db.prepare(`
      SELECT id, name, trophies, wins, losses FROM profiles WHERE ${RANKED}
      ORDER BY ${LADDER_ORDER} LIMIT ? OFFSET ?`).all(limit, offset) as Array<Omit<LeaderboardEntry, 'rank'>>;
    const { total } = this.db.prepare(`SELECT COUNT(*) AS total FROM profiles WHERE ${RANKED}`).get() as { total: number };
    return { entries: rows.map((r, i) => ({ rank: offset + i + 1, ...r })), total };
  }

  /** 1-based ladder position, or null before a first ranked battle. */
  rankOf(id: string): number | null {
    const row = this.row(id);
    if (!row || row.wins + row.losses + row.draws === 0) return null;
    const { ahead } = this.db.prepare(`
      SELECT COUNT(*) AS ahead FROM profiles WHERE ${RANKED} AND (
        trophies > ?1
        OR (trophies = ?1 AND wins > ?2)
        OR (trophies = ?1 AND wins = ?2 AND created_at < ?3)
        OR (trophies = ?1 AND wins = ?2 AND created_at = ?3 AND id < ?4)
      )`).get(row.trophies, row.wins, row.created_at, row.id) as { ahead: number };
    return ahead + 1;
  }

  private row(id: string): ProfileRow | undefined {
    return this.db.prepare('SELECT * FROM profiles WHERE id = ?').get(id) as ProfileRow | undefined;
  }

  private toPublic(r: ProfileRow): PublicProfile {
    return {
      id: r.id, name: r.name, createdAt: r.created_at, rank: this.rankOf(r.id),
      trophies: r.trophies, bestTrophies: r.best_trophies, wins: r.wins, losses: r.losses, draws: r.draws,
      threeCrowns: r.three_crowns, streak: r.streak, bestStreak: r.best_streak, battles: r.battles,
    };
  }

  private toOwn(r: ProfileRow): OwnProfile {
    const deck = parseJson(r.deck);
    const starters = parseJson(r.starters);
    return {
      ...this.toPublic(r),
      deck: isDeck(deck) ? deck : [...DEFAULT_DECK] as CardId[],
      starters: isStarterPick(starters) ? starters : DEFAULT_STARTERS,
    };
  }
}

function newTag(): string {
  let tag = '';
  for (let i = 0; i < PROFILE_TAG_LENGTH; i++) tag += PROFILE_TAG_ALPHABET[randomInt(PROFILE_TAG_ALPHABET.length)];
  return tag;
}

function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
