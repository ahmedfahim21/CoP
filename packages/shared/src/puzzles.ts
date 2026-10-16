import { mirror, type Point } from './arena.js';
import type { CardId } from './cards.js';
import { STANDARD_RULES, createMatch, playCard, step, type MatchRules, type MatchState } from './sim.js';
import type { StarterPick } from './starters.js';

/**
 * Puzzles: a frozen moment of a battle and a goal, played alone in the browser. The enemy
 * has no elixir and makes no plays; you get a fixed hand and budget. Each one ships with a
 * solution that the tests replay, so every puzzle is known to be solvable.
 */

export interface TowerStart {
  left?: number;
  right?: number;
  king?: number;
}

export interface PuzzlePlay extends Point {
  /** Seconds after the puzzle starts. */
  at: number;
  slot: number;
}

export interface Puzzle {
  id: string;
  title: string;
  text: string;
  /** Your hand in order (slots 0–3), then the cards that cycle in. Eight different cards. */
  deck: CardId[];
  elixir: number;
  /** Whether elixir refills during the puzzle. */
  regen: boolean;
  starters: StarterPick;
  /** Enemy troops already on the field, in world coordinates (your side is y > 16). */
  foes: Array<{ card: CardId; at: Point }>;
  /** Towers that start damaged, as a fraction of full health. Left and right are as you see
   *  the arena (your side at the bottom), for both your towers and theirs. */
  foeTowers?: TowerStart;
  myTowers?: TowerStart;
  goal: { kind: 'defend' | 'destroy'; seconds: number };
  solution: PuzzlePlay[];
}

export const PUZZLES: readonly Puzzle[] = [
  {
    id: 'snorlax-stop', title: 'Stop the Snorlax', text: 'A Snorlax is lumbering at your left tower. Bring it down before the tower falls.',
    deck: ['rattata', 'machop', 'pikachu', 'zubat', 'voltorb', 'lapras', 'charizard', 'magikarp'], elixir: 5, regen: false,
    starters: ['charmander', 'squirtle'], foes: [{ card: 'snorlax', at: { x: 3.5, y: 17.5 } }],
    goal: { kind: 'defend', seconds: 40 }, solution: [{ at: 1.5, slot: 0, x: 3.5, y: 21 }, { at: 2, slot: 1, x: 4.5, y: 22 }],
  },
  {
    id: 'air-raid', title: 'Air Raid', text: 'Charizard is flying at your weakened right tower. Only some of your cards can hit it, and you have 4 elixir.',
    deck: ['machop', 'rattata', 'pikachu', 'voltorb', 'snorlax', 'lapras', 'magikarp', 'primeape'], elixir: 4, regen: false,
    starters: ['bulbasaur', 'charmander'], foes: [{ card: 'charizard', at: { x: 14.5, y: 17 } }], myTowers: { right: 0.2 },
    goal: { kind: 'defend', seconds: 40 }, solution: [{ at: 0.5, slot: 2, x: 13, y: 26 }],
  },
  {
    id: 'two-fronts', title: 'Two Fronts', text: 'A Machop on the left, Zubats on the right, both towers battered, and 6 elixir to stop both.',
    deck: ['pikachu', 'rattata', 'snorlax', 'voltorb', 'machop', 'lapras', 'charizard', 'magikarp'], elixir: 6, regen: false,
    starters: ['charmander', 'squirtle'], foes: [{ card: 'machop', at: { x: 3.5, y: 18 } }, { card: 'zubat', at: { x: 14.5, y: 18 } }],
    myTowers: { left: 0.3, right: 0.3 },
    goal: { kind: 'defend', seconds: 40 }, solution: [{ at: 0.3, slot: 3, x: 14.5, y: 21 }, { at: 0.5, slot: 1, x: 3.5, y: 21.5 }],
  },
  {
    id: 'dig-finish', title: 'Finishing Blow', text: 'Their right tower is hanging on at a sliver of health. You have 3 elixir and 20 seconds.',
    deck: ['dugtrio', 'machop', 'rattata', 'snorlax', 'pikachu', 'zubat', 'voltorb', 'lapras'], elixir: 3, regen: false,
    starters: ['bulbasaur', 'squirtle'], foes: [], foeTowers: { right: 0.12 },
    goal: { kind: 'destroy', seconds: 20 }, solution: [{ at: 0.5, slot: 0, x: 14.5, y: 8.2 }],
  },
  {
    id: 'swarm-sweep', title: 'Above the Swarm', text: 'Eight Rattata are charging your left tower. They can’t bite what they can’t reach.',
    deck: ['machop', 'charizard', 'pikachu', 'snorlax', 'zubat', 'lapras', 'voltorb', 'magikarp'], elixir: 5, regen: false,
    starters: ['charmander', 'squirtle'], foes: [{ card: 'rattata', at: { x: 3.5, y: 18.5 } }, { card: 'rattata', at: { x: 4.5, y: 17.5 } }],
    goal: { kind: 'defend', seconds: 40 }, solution: [{ at: 0.3, slot: 1, x: 3.8, y: 22 }],
  },
  {
    id: 'counter-push', title: 'Counter-Push', text: 'Defend the Machop, then turn your survivors into a tower kill. 30 seconds, elixir refills.',
    deck: ['lapras', 'rattata', 'pikachu', 'voltorb', 'zubat', 'machop', 'snorlax', 'magikarp'], elixir: 4, regen: true,
    starters: ['squirtle', 'charmander'], foes: [{ card: 'machop', at: { x: 14.5, y: 18 } }], foeTowers: { right: 0.2 },
    goal: { kind: 'destroy', seconds: 30 }, solution: [{ at: 0.5, slot: 0, x: 14.5, y: 22 }, { at: 9, slot: 1, x: 14.5, y: 17.5 }],
  },
];

export function puzzleById(id: unknown): Puzzle | null {
  return PUZZLES.find((p) => p.id === id) ?? null;
}

const PUZZLE_RULES: MatchRules = { ...STANDARD_RULES, regularSeconds: 600, doubleElixirAt: 0, teams: [{}, { elixirRate: 0 }] };

/** The battle a puzzle starts from: already in play, your hand in order, enemies on the field. */
export function startPuzzle(p: Puzzle): MatchState {
  const rules: MatchRules = { ...PUZZLE_RULES, teams: [{ elixirRate: p.regen ? 1 : 0, startElixir: p.elixir }, { elixirRate: 0, startElixir: 0 }] };
  const s = createMatch([p.starters, ['bulbasaur', 'charmander']], 1, [p.deck, p.deck], rules);
  s.phase = 'regular';
  s.timeLeft = rules.regularSeconds;
  s.players[0].hand = p.deck.slice(0, 4);
  s.players[0].queue = p.deck.slice(4);
  for (const f of p.foes) {
    // Play the card legally on the enemy's side, then move its troops into position.
    const foe = s.players[1];
    foe.hand[0] = f.card;
    foe.elixir = 10;
    const origin = { x: 9, y: 24 };
    const r = playCard(s, 1, 0, origin);
    if (!r.ok) throw new Error(`puzzle ${p.id}: could not place ${f.card}: ${r.error}`);
    const placed = mirror(1, origin);
    for (const u of r.units) {
      u.x += f.at.x - placed.x;
      u.y += f.at.y - placed.y;
      u.deployTimer = 0;
    }
    foe.elixir = 0;
  }
  for (const t of s.entities) {
    if (t.kind === 'unit') continue;
    const start = t.team === 0 ? p.myTowers : p.foeTowers;
    // World x is the player's view: the left side of the screen is x < 9 for both teams.
    const f = t.kind === 'king' ? start?.king : start?.[t.x < 9 ? 'left' : 'right'];
    if (f !== undefined) t.hp = Math.max(1, Math.round(t.maxHp * f));
  }
  s.events = [];
  return s;
}

export type PuzzleStatus = 'playing' | 'solved' | 'failed';

/** Where a puzzle stands after `elapsed` seconds. */
export function puzzleStatus(p: Puzzle, s: MatchState, elapsed: number): PuzzleStatus {
  const myTowers = s.entities.filter((e) => e.team === 0 && e.kind !== 'unit').length;
  const foeTowers = s.entities.filter((e) => e.team === 1 && e.kind !== 'unit').length;
  if (p.goal.kind === 'defend') {
    if (myTowers < 3) return 'failed';
    if (!s.entities.some((e) => e.team === 1 && e.kind === 'unit')) return 'solved';
  } else {
    if (foeTowers < 3) return 'solved';
  }
  return elapsed >= p.goal.seconds ? 'failed' : 'playing';
}

export const PUZZLE_STEP = 0.05;

/** Plays a puzzle out with the given plays (e.g. its solution); returns how it ended. */
export function playPuzzle(p: Puzzle, plays: readonly PuzzlePlay[]): { status: PuzzleStatus; rejected: number } {
  const s = startPuzzle(p);
  const todo = [...plays].sort((a, b) => a.at - b.at);
  let rejected = 0;
  for (let n = 0; ; n++) {
    const t = n * PUZZLE_STEP;
    while (todo.length > 0 && todo[0]!.at <= t) {
      const play = todo.shift()!;
      if (!playCard(s, 0, play.slot, play).ok) rejected++;
    }
    step(s, PUZZLE_STEP);
    const status = puzzleStatus(p, s, t + PUZZLE_STEP);
    if (status !== 'playing') return { status, rejected };
  }
}
