import { describe, expect, it } from 'vitest';
import { pairUp, type QueueEntry } from '../src/matchmaking.js';

const NOW = 100_000;
const entry = (profileId: string, trophies: number, waitedSeconds = 0): QueueEntry => ({ profileId, trophies, joinedAt: NOW - waitedSeconds * 1000 });
const ids = (pairs: Array<[QueueEntry, QueueEntry]>) => pairs.map(([a, b]) => [a.profileId, b.profileId]);

describe('pairUp', () => {
  it('pairs players whose trophies are close', () => {
    expect(ids(pairUp([entry('A', 1000), entry('B', 1050)], NOW))).toEqual([['A', 'B']]);
  });

  it('keeps far-apart players waiting until their windows widen', () => {
    const far = [entry('A', 1000), entry('B', 1500)];
    expect(pairUp(far, NOW)).toEqual([]);
    expect(ids(pairUp([entry('A', 1000, 10), entry('B', 1500, 10)], NOW))).toEqual([['A', 'B']]);
    // After the window opens, any gap goes.
    expect(ids(pairUp([entry('A', 0, 25), entry('B', 4000, 25)], NOW))).toEqual([['A', 'B']]);
  });

  it('gives each player the closest opponent, longest-waiting first', () => {
    const queue = [entry('new', 1010, 0), entry('old', 1000, 8), entry('mid', 1100, 4), entry('far', 1180, 1)];
    expect(ids(pairUp(queue, NOW))).toEqual([['old', 'new'], ['mid', 'far']]);
  });

  it('prefers a fresh opponent over last battle’s rival', () => {
    const last = (id: string) => ({ A: 'B', B: 'A' })[id];
    expect(ids(pairUp([entry('A', 1000, 5), entry('B', 1000), entry('C', 1060)], NOW, last))).toEqual([['A', 'C']]);
    // …but a rematch beats not playing at all.
    expect(ids(pairUp([entry('A', 1000, 5), entry('B', 1000)], NOW, last))).toEqual([['A', 'B']]);
  });

  it('pairs a profile with itself only when nobody else fits', () => {
    expect(ids(pairUp([entry('A', 1000, 3), entry('A', 1000), entry('B', 1080)], NOW))).toEqual([['A', 'B']]);
    expect(ids(pairUp([entry('A', 1000, 3), entry('A', 1000)], NOW))).toEqual([['A', 'A']]);
  });

  it('never puts anyone in two pairs', () => {
    const queue = Array.from({ length: 9 }, (_, i) => entry(`P${i}`, 1000 + i * 10, i));
    const pairs = pairUp(queue, NOW);
    expect(pairs).toHaveLength(4);
    expect(new Set(pairs.flat()).size).toBe(8);
  });
});
