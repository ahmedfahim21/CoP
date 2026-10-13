/**
 * Ladder rules: trophies, arenas and the matchmaking search window. Pure so the server
 * (which owns the numbers) and the client (which only displays them) agree.
 */

export const START_TROPHIES = 0;
/** Elo K-factor: an even match moves ±K/2 trophies. */
export const TROPHY_K = 60;
/** A win always earns at least this much, and a loss always costs at least this much. */
export const TROPHY_MIN_SWING = 5;

export type Outcome = 'win' | 'loss' | 'draw';

/** Elo expected score for `mine` against `theirs`, in [0, 1]. */
export function expectedScore(mine: number, theirs: number): number {
  return 1 / (1 + 10 ** ((theirs - mine) / 400));
}

/**
 * Trophies gained (positive) or lost (negative) for one side of a ranked match.
 * Never takes a player below zero.
 */
export function trophyDelta(mine: number, theirs: number, outcome: Outcome): number {
  const score = outcome === 'win' ? 1 : outcome === 'loss' ? 0 : 0.5;
  let delta = Math.round(TROPHY_K * (score - expectedScore(mine, theirs)));
  if (outcome === 'win') delta = Math.max(TROPHY_MIN_SWING, delta);
  if (outcome === 'loss') delta = Math.min(-TROPHY_MIN_SWING, delta);
  // `+ 0` turns -0 (a loss at zero trophies) into 0.
  return Math.max(-mine, delta) + 0;
}

export interface Arena {
  /** 1-based, shown as "Arena 3". */
  index: number;
  name: string;
  minTrophies: number;
}

export const ARENAS: readonly Arena[] = [
  { index: 1, name: 'Pallet Town', minTrophies: 0 },
  { index: 2, name: 'Viridian Forest', minTrophies: 300 },
  { index: 3, name: 'Pewter Gym', minTrophies: 600 },
  { index: 4, name: 'Cerulean Cape', minTrophies: 1000 },
  { index: 5, name: 'Vermilion Docks', minTrophies: 1400 },
  { index: 6, name: 'Celadon Rooftop', minTrophies: 1800 },
  { index: 7, name: 'Fuchsia Safari', minTrophies: 2300 },
  { index: 8, name: 'Saffron Dojo', minTrophies: 2800 },
  { index: 9, name: 'Cinnabar Volcano', minTrophies: 3400 },
  { index: 10, name: 'Indigo Plateau', minTrophies: 4000 },
];

export function arenaFor(trophies: number): Arena {
  let best = ARENAS[0]!;
  for (const a of ARENAS) if (trophies >= a.minTrophies) best = a;
  return best;
}

/** The next arena up, or null at the top. */
export function nextArena(trophies: number): Arena | null {
  return ARENAS.find((a) => a.minTrophies > trophies) ?? null;
}

/** Trophy gap a queued player accepts right away; it widens the longer they wait. */
export const SEARCH_WINDOW_START = 100;
export const SEARCH_WINDOW_GROWTH = 40;
/** After this long in the queue, any trophy gap is fine. */
export const SEARCH_WINDOW_OPEN_AFTER = 20;

/** Largest trophy gap a player who has waited `seconds` accepts. */
export function searchWindow(seconds: number): number {
  if (seconds >= SEARCH_WINDOW_OPEN_AFTER) return Infinity;
  return SEARCH_WINDOW_START + SEARCH_WINDOW_GROWTH * Math.max(0, seconds);
}
