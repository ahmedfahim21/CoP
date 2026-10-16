import { seededRandom } from './bot.js';
import { CARDS, CARD_IDS, DEFAULT_DECK, type CardId } from './cards.js';
import { STAGES, starsFor, stageById } from './campaign.js';
import type { MatchMode } from './profile.js';
import type { Outcome } from './ranking.js';
import type { PokeType } from './types.js';

/**
 * Trainer progression: XP and levels, card unlocks, League stars, daily quests, play-day
 * streaks and personal bests. Everything here is pure: the server applies it to the stored
 * progress after each battle, the client uses it to show what's next.
 */

// ---------------------------------------------------------------- calendar

/** UTC calendar day, e.g. "2026-10-16". */
export function dayKey(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

/** The day before `day`. */
export function previousDay(day: string): string {
  return dayKey(Date.parse(`${day}T00:00:00Z`) - 86_400_000);
}

/** Monday-based UTC week, e.g. "2026-W42". */
export function weekKey(now: number): string {
  const d = new Date(now);
  const day = (d.getUTCDay() + 6) % 7;
  const thursday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day + 3));
  const yearStart = Date.UTC(thursday.getUTCFullYear(), 0, 1);
  const week = 1 + Math.floor((thursday.getTime() - yearStart) / (7 * 86_400_000));
  return `${thursday.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** Number of whole weeks since 2026-01-05 (a Monday); drives the event rotation. */
export function weekIndex(now: number): number {
  return Math.floor((now - Date.UTC(2026, 0, 5)) / (7 * 86_400_000));
}

/** Monthly ladder season, e.g. "2026-10". */
export function seasonKey(now: number): string {
  return new Date(now).toISOString().slice(0, 7);
}

/** A stable 32-bit hash of a string, for seeding. */
export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

// ---------------------------------------------------------------- levels

export const MAX_LEVEL = 30;

/** XP needed to go from `level` to the next. */
export function xpToNext(level: number): number {
  return 80 + 40 * level;
}

export interface LevelInfo {
  level: number;
  /** XP into the current level. */
  into: number;
  /** XP the current level needs; 0 at the cap. */
  needed: number;
}

export function levelFor(xp: number): LevelInfo {
  let level = 1;
  let left = Math.max(0, Math.floor(xp));
  while (level < MAX_LEVEL && left >= xpToNext(level)) {
    left -= xpToNext(level);
    level += 1;
  }
  return { level, into: level < MAX_LEVEL ? left : 0, needed: level < MAX_LEVEL ? xpToNext(level) : 0 };
}

// ---------------------------------------------------------------- cards

/** What every new trainer owns: the classic deck plus two. */
export const STARTER_CARDS: readonly CardId[] = [...DEFAULT_DECK, 'magikarp', 'primeape'];

/**
 * The rest, in the order trainer levels unlock them (level 3, 4, 5, …). The League unlocks
 * the same cards sooner: each stage's first clear grants its own.
 */
export const LEVEL_UNLOCKS: readonly CardId[] = [
  'geodude', 'starmie', 'jolteon', 'scyther', 'koffing', 'mrmime', 'rapidash', 'dugtrio', 'golem',
  'chansey', 'magneton', 'tauros', 'gengar', 'hitmonlee', 'moltres', 'articuno', 'zapdos',
];
export const FIRST_UNLOCK_LEVEL = 3;

/** The level that unlocks `card` (null for starter cards). */
export function unlockLevel(card: CardId): number | null {
  const i = LEVEL_UNLOCKS.indexOf(card);
  return i < 0 ? null : FIRST_UNLOCK_LEVEL + i;
}

/** The League stage that unlocks `card`, if any. */
export function unlockStage(card: CardId) {
  return STAGES.find((s) => s.unlocks.includes(card)) ?? null;
}

export function unlockedCards(p: Progress): Set<CardId> {
  if (p.legacy) return new Set(CARD_IDS);
  const owned = new Set<CardId>(STARTER_CARDS);
  const { level } = levelFor(p.xp);
  LEVEL_UNLOCKS.forEach((c, i) => {
    if (level >= FIRST_UNLOCK_LEVEL + i) owned.add(c);
  });
  for (const s of STAGES) if ((p.stars[s.id] ?? 0) > 0) for (const c of s.unlocks) owned.add(c);
  return owned;
}

export function deckUnlocked(p: Progress, deck: readonly CardId[]): boolean {
  const owned = unlockedCards(p);
  return deck.every((c) => owned.has(c));
}

/** The League stages open to play: every cleared stage plus the next one. */
export function stageOpen(p: Progress, id: string): boolean {
  const stage = stageById(id);
  if (!stage) return false;
  const prev = STAGES[stage.order - 2];
  return !prev || (p.stars[prev.id] ?? 0) > 0;
}

// ---------------------------------------------------------------- quests

export type QuestKind = 'win' | 'battle' | 'crowns' | 'threeCrown' | 'playType' | 'towerDamage' | 'league' | 'daily' | 'defeat';

export interface Quest {
  id: string;
  kind: QuestKind;
  target: number;
  /** For 'playType': the card type to play. */
  type?: PokeType;
  xp: number;
  text: string;
}

export interface QuestState extends Quest {
  progress: number;
  done: boolean;
}

const QUEST_TYPES: readonly PokeType[] = ['fire', 'water', 'electric', 'normal', 'fighting', 'flying', 'poison', 'psychic', 'rock', 'ground'];

function questPool(rand: () => number): Quest[] {
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)]!;
  const type = pick(QUEST_TYPES);
  const wins = pick([2, 3]);
  const battles = pick([3, 5]);
  const crowns = pick([4, 6]);
  const damage = pick([6000, 10000]);
  const defeat = pick([15, 25]);
  const plays = pick([6, 10]);
  return [
    { id: 'win', kind: 'win', target: wins, xp: 60, text: `Win ${wins} battles` },
    { id: 'battle', kind: 'battle', target: battles, xp: 40, text: `Play ${battles} battles` },
    { id: 'crowns', kind: 'crowns', target: crowns, xp: 50, text: `Earn ${crowns} crowns` },
    { id: 'threeCrown', kind: 'threeCrown', target: 1, xp: 80, text: 'Win with three crowns' },
    { id: `playType-${type}`, kind: 'playType', target: plays, type, xp: 50, text: `Play ${plays} ${type}-type cards` },
    { id: 'towerDamage', kind: 'towerDamage', target: damage, xp: 50, text: `Deal ${damage.toLocaleString('en')} tower damage` },
    { id: 'league', kind: 'league', target: 1, xp: 60, text: 'Win a League battle' },
    { id: 'daily', kind: 'daily', target: 1, xp: 40, text: 'Play the Daily Challenge' },
    { id: 'defeat', kind: 'defeat', target: defeat, xp: 40, text: `Defeat ${defeat} enemy troops` },
  ];
}

export const QUESTS_PER_DAY = 3;

/** The day's quests for a trainer: the same three all day, different per trainer and day. */
export function questsFor(day: string, profileId: string): QuestState[] {
  const rand = seededRandom(hashString(`${day}:${profileId}`));
  const pool = questPool(rand);
  const chosen: Quest[] = [];
  while (chosen.length < QUESTS_PER_DAY && pool.length > 0) chosen.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]!);
  return chosen.map((q) => ({ ...q, progress: 0, done: false }));
}

// ---------------------------------------------------------------- progress

export interface Progress {
  v: 1;
  xp: number;
  /** Trainers who played before unlocks existed keep every card. */
  legacy: boolean;
  /** League stage id → best stars (1–3). */
  stars: Record<string, number>;
  quests: { day: string; list: QuestState[] };
  /** Consecutive UTC days with at least one battle. */
  streak: { day: string; count: number; best: number };
  /** Day of the last first-win-of-the-day bonus. */
  firstWinDay: string;
  daily: { day: string; best: number; attempts: number };
  gauntletBest: number;
  /** Solved puzzle ids. */
  puzzles: string[];
  /** Event wins this week. */
  event: { week: string; wins: number };
}

export function emptyProgress(): Progress {
  return {
    v: 1, xp: 0, legacy: false, stars: {}, quests: { day: '', list: [] }, streak: { day: '', count: 0, best: 0 },
    firstWinDay: '', daily: { day: '', best: 0, attempts: 0 }, gauntletBest: 0, puzzles: [], event: { week: '', wins: 0 },
  };
}

/** Accepts whatever the database holds and fills in anything missing, so old rows keep working. */
export function parseProgress(raw: unknown): Progress {
  const base = emptyProgress();
  if (typeof raw !== 'object' || raw === null) return base;
  const r = raw as Partial<Progress>;
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const str = (v: unknown, d: string) => (typeof v === 'string' ? v : d);
  const stars: Record<string, number> = {};
  if (r.stars && typeof r.stars === 'object') {
    for (const [k, v] of Object.entries(r.stars)) if (stageById(k) && typeof v === 'number') stars[k] = Math.max(0, Math.min(3, Math.floor(v)));
  }
  return {
    v: 1,
    xp: Math.max(0, num(r.xp, 0)),
    legacy: r.legacy === true,
    stars,
    quests: {
      day: str(r.quests?.day, ''),
      list: Array.isArray(r.quests?.list) ? r.quests!.list.filter((q) => q && typeof q.id === 'string' && typeof q.target === 'number') : [],
    },
    streak: { day: str(r.streak?.day, ''), count: num(r.streak?.count, 0), best: num(r.streak?.best, 0) },
    firstWinDay: str(r.firstWinDay, ''),
    daily: { day: str(r.daily?.day, ''), best: num(r.daily?.best, 0), attempts: num(r.daily?.attempts, 0) },
    gauntletBest: num(r.gauntletBest, 0),
    puzzles: Array.isArray(r.puzzles) ? r.puzzles.filter((x): x is string => typeof x === 'string') : [],
    event: { week: str(r.event?.week, ''), wins: num(r.event?.wins, 0) },
  };
}

/** Rolls the quests over to `day` if they're from an earlier one. */
export function withTodaysQuests(p: Progress, day: string, profileId: string): Progress {
  if (p.quests.day === day) return p;
  return { ...p, quests: { day, list: questsFor(day, profileId) } };
}

// ---------------------------------------------------------------- battles

/** What a finished battle meant for one player, as the server measured it. */
export interface BattleOutcome {
  mode: MatchMode;
  outcome: Outcome;
  crowns: number;
  towersLost: number;
  towerDamage: number;
  defeated: number;
  /** Cards played, by id (repeats counted). */
  played: Partial<Record<CardId, number>>;
  /** League stage fought, if any. */
  stage?: string;
  /** Daily Challenge score. */
  dailyScore?: number;
  /** Gauntlet: rounds cleared so far in this run (set on the round that ended it, or every round). */
  gauntletRounds?: number;
  /** Weekly event battle. */
  event?: boolean;
}

export interface Reward {
  xp: number;
  text: string;
}

export interface BattleRewards {
  progress: Progress;
  rewards: Reward[];
  /** Total XP gained. */
  xp: number;
  levelBefore: number;
  levelAfter: number;
  /** Cards this battle unlocked. */
  unlocked: CardId[];
  /** Quests this battle completed. */
  quests: QuestState[];
  /** League stars after this battle (stage battles only). */
  stars?: { stage: string; before: number; after: number };
  /** Daily Challenge personal best after this battle. */
  dailyBest?: { score: number; improved: boolean };
}

const BASE_XP: Record<Outcome, number> = { win: 30, draw: 15, loss: 10 };
const CROWN_XP = 5;
export const FIRST_WIN_XP = 50;
export const STREAK_XP_PER_DAY = 10;
export const STREAK_XP_CAP_DAYS = 7;
const STAGE_CLEAR_XP = 100;
const STAR_XP = 25;
const DAILY_FIRST_XP = 40;
const DAILY_BEST_XP = 20;
const GAUNTLET_ROUND_XP = 10;
export const EVENT_BONUS_WINS = 3;
const EVENT_BONUS_XP = 100;
export const PUZZLE_XP = 30;

/** Applies one battle to a trainer's progress. */
export function applyBattle(before: Progress, b: BattleOutcome, now: number, profileId: string): BattleRewards {
  const day = dayKey(now);
  let p = withTodaysQuests(structuredClone(before), day, profileId);
  const rewards: Reward[] = [];
  const add = (xp: number, text: string) => {
    if (xp > 0) rewards.push({ xp, text });
  };
  const won = b.outcome === 'win';

  add(BASE_XP[b.outcome] + CROWN_XP * b.crowns, won ? 'Victory' : b.outcome === 'draw' ? 'Draw' : 'Good battle');

  // Play-day streak: the first battle of a day extends (or restarts) it and pays a bonus.
  if (p.streak.day !== day) {
    const count = p.streak.day === previousDay(day) ? p.streak.count + 1 : 1;
    p.streak = { day, count, best: Math.max(p.streak.best, count) };
    if (count > 1) add(STREAK_XP_PER_DAY * Math.min(count, STREAK_XP_CAP_DAYS), `${count}-day streak`);
  }
  if (won && p.firstWinDay !== day) {
    p.firstWinDay = day;
    add(FIRST_WIN_XP, 'First win of the day');
  }

  let stars: BattleRewards['stars'];
  if (b.stage && stageById(b.stage)) {
    const prev = p.stars[b.stage] ?? 0;
    const earned = starsFor(won, b.towersLost, b.crowns);
    if (earned > prev) {
      p.stars = { ...p.stars, [b.stage]: earned };
      if (prev === 0) add(STAGE_CLEAR_XP, `${stageById(b.stage)!.badge}!`);
      // The first star comes with the clear; each one beyond it pays on its own.
      const extra = earned - Math.max(prev, 1);
      add(STAR_XP * extra, `${extra} new star${extra > 1 ? 's' : ''}`);
    }
    stars = { stage: b.stage, before: prev, after: Math.max(prev, earned) };
  }

  let dailyBest: BattleRewards['dailyBest'];
  if (b.dailyScore !== undefined) {
    const first = p.daily.day !== day;
    const prevBest = first ? 0 : p.daily.best;
    const improved = b.dailyScore > prevBest;
    p.daily = { day, best: Math.max(prevBest, b.dailyScore), attempts: (first ? 0 : p.daily.attempts) + 1 };
    if (first) add(DAILY_FIRST_XP, 'Daily Challenge');
    else if (improved) add(DAILY_BEST_XP, 'New daily best');
    dailyBest = { score: p.daily.best, improved };
  }

  if (b.gauntletRounds !== undefined) {
    if (won) add(GAUNTLET_ROUND_XP * b.gauntletRounds, `Gauntlet round ${b.gauntletRounds}`);
    p.gauntletBest = Math.max(p.gauntletBest, b.gauntletRounds);
  }

  if (b.event && won) {
    const week = weekKey(now);
    const wins = (p.event.week === week ? p.event.wins : 0) + 1;
    p.event = { week, wins };
    if (wins === EVENT_BONUS_WINS) add(EVENT_BONUS_XP, `${EVENT_BONUS_WINS} event wins this week`);
  }

  // Quests.
  const completed: QuestState[] = [];
  p.quests = {
    day: p.quests.day,
    list: p.quests.list.map((q) => {
      if (q.done) return q;
      const progress = Math.min(q.target, q.progress + questGain(q, b));
      const next = { ...q, progress, done: progress >= q.target };
      if (next.done) completed.push(next);
      return next;
    }),
  };
  for (const q of completed) add(q.xp, `Quest: ${q.text}`);

  return finishRewards(before, p, rewards, completed, { stars, dailyBest });
}

function questGain(q: Quest, b: BattleOutcome): number {
  switch (q.kind) {
    case 'win': return b.outcome === 'win' ? 1 : 0;
    case 'battle': return 1;
    case 'crowns': return b.crowns;
    case 'threeCrown': return b.outcome === 'win' && b.crowns >= 3 ? 1 : 0;
    case 'playType': {
      let n = 0;
      for (const [id, count] of Object.entries(b.played)) if (CARDS[id as CardId]?.stats.types.includes(q.type!)) n += count ?? 0;
      return n;
    }
    case 'towerDamage': return b.towerDamage;
    case 'league': return b.stage && b.outcome === 'win' ? 1 : 0;
    case 'daily': return b.dailyScore !== undefined ? 1 : 0;
    case 'defeat': return b.defeated;
  }
}

/** Solving a puzzle for the first time. */
export function applyPuzzle(before: Progress, puzzleId: string): BattleRewards {
  if (before.puzzles.includes(puzzleId)) return finishRewards(before, before, [], [], {});
  const p = { ...structuredClone(before), puzzles: [...before.puzzles, puzzleId] };
  return finishRewards(before, p, [{ xp: PUZZLE_XP, text: 'Puzzle solved' }], [], {});
}

function finishRewards(
  before: Progress, p: Progress, rewards: Reward[], quests: QuestState[],
  extra: Pick<BattleRewards, 'stars' | 'dailyBest'>,
): BattleRewards {
  const xp = rewards.reduce((sum, r) => sum + r.xp, 0);
  const after = { ...p, xp: p.xp + xp };
  const ownedBefore = unlockedCards(before);
  const unlocked = [...unlockedCards(after)].filter((c) => !ownedBefore.has(c));
  return {
    progress: after, rewards, xp, quests, unlocked,
    levelBefore: levelFor(before.xp).level, levelAfter: levelFor(after.xp).level,
    ...extra,
  };
}

/** Total League stars, for profiles. */
export function totalStars(p: Progress): number {
  return Object.values(p.stars).reduce((sum, n) => sum + n, 0);
}

/** The next League stage to play, or null once the Champion has fallen. */
export function nextStage(p: Progress) {
  return STAGES.find((s) => (p.stars[s.id] ?? 0) === 0) ?? null;
}
