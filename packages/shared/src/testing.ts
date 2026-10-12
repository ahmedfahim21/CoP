// Test helpers for the simulation. Not exported from the package.
import type { Team } from './arena.js';
import type { CardId } from './cards.js';
import { ELIXIR_MAX, REGULAR_SECONDS, createMatch, playCard, step, type Entity, type GameEvent, type MatchState } from './sim.js';
import type { StarterPick } from './starters.js';

export const DT = 0.05;
export const PICKS: [StarterPick, StarterPick] = [['bulbasaur', 'charmander'], ['squirtle', 'charmander']];

export function started(seed = 1): MatchState {
  const s = createMatch(PICKS, seed);
  s.phase = 'regular';
  s.timeLeft = REGULAR_SECONDS;
  return s;
}

/** Put `card` in slot 0 (from anywhere, deck or not) with plenty of elixir and play it at a local point. */
export function spawn(s: MatchState, team: Team, card: CardId, local: { x: number; y: number }): Entity[] {
  const p = s.players[team];
  const hi = p.hand.indexOf(card);
  if (hi >= 0) {
    [p.hand[0], p.hand[hi]] = [p.hand[hi]!, p.hand[0]!];
  } else {
    const qi = p.queue.indexOf(card);
    if (qi >= 0) p.queue[qi] = p.hand[0]!;
    p.hand[0] = card;
  }
  p.elixir = ELIXIR_MAX;
  const r = playCard(s, team, 0, local);
  if (!r.ok) throw new Error(r.error);
  return r.units;
}

export function tower(s: MatchState, team: Team, kind: Entity['kind'], lane?: 'left' | 'right'): Entity {
  const t = s.entities.find((e) => e.team === team && e.kind === kind && (lane === undefined || e.lane === lane));
  if (!t) throw new Error(`no ${kind} for team ${team}`);
  return t;
}

export function runUntil(s: MatchState, pred: (events: GameEvent[]) => boolean, maxSeconds = 60): GameEvent[] {
  for (let t = 0; t < maxSeconds; t += DT) {
    step(s, DT);
    if (pred(s.events)) return s.events;
  }
  throw new Error('condition not reached');
}

export function run(s: MatchState, seconds: number): GameEvent[] {
  const all: GameEvent[] = [];
  for (let t = 0; t < seconds - DT / 2; t += DT) {
    step(s, DT);
    all.push(...s.events);
  }
  return all;
}

/** Remove the princess towers and put kings to sleep, so fights can be tested in isolation. */
export function onlyUnits(s: MatchState): void {
  s.entities = s.entities.filter((e) => e.kind !== 'princess');
  for (const k of s.entities) if (k.kind === 'king') k.active = false;
}

/** Remove every troop except the given ones. */
export function keepUnits(s: MatchState, ...keep: Entity[]): void {
  const ids = new Set(keep.map((e) => e.id));
  s.entities = s.entities.filter((e) => e.kind !== 'unit' || ids.has(e.id));
}
