import { describe, expect, it } from 'vitest';
import { ARENAS, SEARCH_WINDOW_OPEN_AFTER, arenaFor, expectedScore, nextArena, searchWindow, trophyDelta } from './ranking.js';
import { isProfileTag, parseCredential, winRate } from './profile.js';

describe('trophies', () => {
  it('an even match swings by half the K-factor, symmetrically', () => {
    expect(trophyDelta(1000, 1000, 'win')).toBe(30);
    expect(trophyDelta(1000, 1000, 'loss')).toBe(-30);
    expect(trophyDelta(1000, 1000, 'draw')).toBe(0);
  });

  it('beating a stronger player pays more than beating a weaker one', () => {
    expect(trophyDelta(1000, 1400, 'win')).toBeGreaterThan(trophyDelta(1000, 600, 'win'));
    expect(trophyDelta(1400, 1000, 'loss')).toBeLessThan(trophyDelta(1000, 1400, 'loss'));
    expect(expectedScore(1400, 1000)).toBeCloseTo(1 - expectedScore(1000, 1400), 10);
  });

  it('wins and losses always move at least the minimum swing', () => {
    expect(trophyDelta(3000, 0, 'win')).toBe(5);
    expect(trophyDelta(0 + 100, 3000, 'loss')).toBe(-5);
  });

  it('never drops below zero', () => {
    expect(trophyDelta(0, 0, 'loss')).toBe(0);
    expect(trophyDelta(12, 0, 'loss')).toBe(-12);
    expect(trophyDelta(0, 500, 'draw')).toBeGreaterThan(0);
  });
});

describe('arenas', () => {
  it('maps trophies to the highest arena reached', () => {
    expect(arenaFor(0).name).toBe('Pallet Town');
    expect(arenaFor(299).index).toBe(1);
    expect(arenaFor(300).index).toBe(2);
    expect(arenaFor(99999).name).toBe('Indigo Plateau');
    expect(nextArena(0)!.minTrophies).toBe(300);
    expect(nextArena(4000)).toBeNull();
    expect(ARENAS.map((a) => a.minTrophies)).toEqual([...ARENAS.map((a) => a.minTrophies)].sort((a, b) => a - b));
  });
});

describe('search window', () => {
  it('starts narrow, widens with time, then opens up', () => {
    expect(searchWindow(0)).toBe(100);
    expect(searchWindow(5)).toBeGreaterThan(searchWindow(1));
    expect(searchWindow(SEARCH_WINDOW_OPEN_AFTER)).toBe(Infinity);
  });
});

describe('profile helpers', () => {
  it('parses credentials and rejects lookalikes', () => {
    expect(parseCredential('8QYL2GPC.abcdefghijklmnop0123')).toEqual({ id: '8QYL2GPC', secret: 'abcdefghijklmnop0123' });
    expect(parseCredential('8QYL2GPC')).toBeNull();
    expect(parseCredential('8qyl2gpc.abcdefghijklmnop0123')).toBeNull();
    expect(parseCredential('8QYL2GPC.short')).toBeNull();
    expect(parseCredential('8QYL2GPC.has spaces in the secret!')).toBeNull();
    expect(parseCredential(42)).toBeNull();
    expect(isProfileTag('0289PYLQ')).toBe(true);
    expect(isProfileTag('0289PYL')).toBe(false);
  });

  it('win rate counts draws as games', () => {
    expect(winRate({ wins: 0, losses: 0, draws: 0 })).toBeNull();
    expect(winRate({ wins: 3, losses: 1, draws: 0 })).toBe(0.75);
    expect(winRate({ wins: 1, losses: 0, draws: 1 })).toBe(0.5);
  });
});
