import type { Point, Team } from './arena.js';
import type { CardId } from './cards.js';
import { createMatch, playCard, step, type GameEvent, type MatchResult, type MatchRules, type MatchState } from './sim.js';
import type { StarterPick } from './starters.js';

/**
 * Replays. The simulation is deterministic: the same seed, loadouts, rules and plays at the
 * same steps give the same battle, bit for bit, in any JS engine (see arena.hypot). So a
 * replay is just that recipe, a few kilobytes, and any client can re-simulate it.
 */

/** Seconds per simulation step, on the server and in replays. */
export const STEP_SECONDS = 0.05;

export interface ReplayPlay extends Point {
  /** Steps already simulated when the play was made; it applies before the next one. */
  step: number;
  team: Team;
  slot: number;
}

export interface Replay {
  v: 1;
  seed: number;
  starters: [StarterPick, StarterPick];
  decks: [CardId[], CardId[]];
  rules: MatchRules;
  names: [string, string];
  plays: ReplayPlay[];
  /** Steps the battle took. */
  steps: number;
  result: MatchResult | null;
}

/** Collects a battle's recipe as the server plays it. */
export class ReplayRecorder {
  readonly plays: ReplayPlay[] = [];
  steps = 0;

  constructor(
    private readonly setup: Pick<Replay, 'seed' | 'starters' | 'decks' | 'rules' | 'names'>,
  ) {}

  /** Call after each successful playCard, with the play exactly as it was applied. */
  play(team: Team, slot: number, at: Point) {
    this.plays.push({ step: this.steps, team, slot, x: at.x, y: at.y });
  }

  /** Call after each step(). */
  stepped() {
    this.steps += 1;
  }

  finish(result: MatchResult | null): Replay {
    return { v: 1, ...this.setup, plays: [...this.plays], steps: this.steps, result };
  }
}

export function startReplay(r: Replay): MatchState {
  return createMatch(r.starters, r.seed, r.decks, r.rules);
}

/**
 * Advances a replay by one step: applies the plays due before step `n`, then steps.
 * Returns false once the battle is over.
 */
export function advanceReplay(r: Replay, match: MatchState, n: number): boolean {
  match.events = [];
  for (const p of r.plays) {
    if (p.step !== n) continue;
    const res = playCard(match, p.team, p.slot, p);
    // A play the original battle accepted must apply again; anything else is a desync.
    if (!res.ok) throw new Error(`replay desync at step ${n}: ${res.error}`);
  }
  const events: GameEvent[] = match.events;
  step(match, STEP_SECONDS);
  // Keep the spawn events from the plays alongside the step's own.
  match.events = [...events, ...match.events];
  return match.phase !== 'ended' && n + 1 < r.steps;
}

/** Re-simulates a whole replay; returns the final state. */
export function runReplay(r: Replay): MatchState {
  const match = startReplay(r);
  for (let n = 0; n < r.steps; n++) if (!advanceReplay(r, match, n)) break;
  return match;
}

export function isReplay(v: unknown): v is Replay {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Partial<Replay>;
  return r.v === 1 && typeof r.seed === 'number' && Array.isArray(r.plays) && typeof r.steps === 'number' && Array.isArray(r.decks) && Array.isArray(r.starters);
}
