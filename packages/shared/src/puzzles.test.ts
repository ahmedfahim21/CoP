import { describe, expect, it } from 'vitest';
import { isDeck } from './cards.js';
import { PUZZLES, playPuzzle, puzzleById, startPuzzle } from './puzzles.js';

describe('puzzles', () => {
  it.each(PUZZLES.map((p) => [p.id, p] as const))('%s is solved by its solution and lost by doing nothing', (_id, p) => {
    expect(isDeck(p.deck)).toBe(true);
    expect(playPuzzle(p, p.solution)).toEqual({ status: 'solved', rejected: 0 });
    expect(playPuzzle(p, []).status).toBe('failed');
  });

  it('starts with the hand in order, the budget set and the enemy idle', () => {
    const p = puzzleById('air-raid')!;
    const s = startPuzzle(p);
    expect(s.players[0].hand).toEqual(p.deck.slice(0, 4));
    expect(s.players[0].elixir).toBe(4);
    expect(s.players[1].elixir).toBe(0);
    expect(s.entities.filter((e) => e.team === 1 && e.kind === 'unit').map((e) => e.defId)).toEqual(['charizard']);
  });

  it('ids are unique', () => {
    expect(new Set(PUZZLES.map((p) => p.id)).size).toBe(PUZZLES.length);
  });
});
