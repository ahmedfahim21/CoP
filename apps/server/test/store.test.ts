import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_DECK, isProfileTag, type CardId } from '@cop/shared';
import { ProfileStore, type MatchReport } from '../src/store.js';

let store: ProfileStore;
beforeEach(() => {
  store = new ProfileStore(':memory:');
});
afterEach(() => store.close());

function ranked(a: string | null, b: string | null, winner: 0 | 1 | null, crowns: [number, number] = [1, 0]): MatchReport {
  return {
    mode: 'ranked', winner, reason: winner === null ? 'draw' : 'crowns',
    sides: [{ profileId: a, name: 'A', crowns: crowns[0] }, { profileId: b, name: 'B', crowns: crowns[1] }],
  };
}

describe('profiles', () => {
  it('creates a profile with a tag, a sanitized name and defaults', () => {
    const { profile, credential } = store.create('  Misty\u0007  ');
    expect(isProfileTag(profile.id)).toBe(true);
    expect(credential.startsWith(`${profile.id}.`)).toBe(true);
    expect(profile).toMatchObject({ name: 'Misty', trophies: 0, wins: 0, losses: 0, rank: null, deck: [...DEFAULT_DECK], starters: ['charmander', 'squirtle'] });
    expect(store.create(undefined).profile.name).toBe('Trainer');
  });

  it('authenticates only the exact credential', () => {
    const { profile, credential } = store.create('Ash');
    expect(store.authenticate(credential)?.id).toBe(profile.id);
    expect(store.authenticate(`${credential}x`)).toBeNull();
    expect(store.authenticate(`${profile.id}.${'A'.repeat(32)}`)).toBeNull();
    expect(store.authenticate(profile.id)).toBeNull();
    expect(store.authenticate(undefined)).toBeNull();
  });

  it('updates name, deck and starters, rejecting invalid ones', () => {
    const { profile } = store.create('Ash');
    const deck: CardId[] = ['magikarp', 'geodude', 'dugtrio', 'gengar', 'chansey', 'scyther', 'jolteon', 'rapidash'];
    const ok = store.update(profile.id, { name: 'Red', deck, starters: ['bulbasaur', 'squirtle'] });
    expect(ok.rejected).toEqual([]);
    expect(ok.profile).toMatchObject({ name: 'Red', deck, starters: ['bulbasaur', 'squirtle'] });
    const bad = store.update(profile.id, { deck: ['pikachu'] as CardId[], starters: ['bulbasaur', 'bulbasaur'] });
    expect(bad.rejected).toEqual(['deck', 'starters']);
    expect(bad.profile).toMatchObject({ deck, starters: ['bulbasaur', 'squirtle'] });
  });

  it('persists to disk across reopenings', async () => {
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const dir = mkdtempSync(join(tmpdir(), 'cop-store-'));
    try {
      const path = join(dir, 'nested', 'cop.sqlite');
      const first = new ProfileStore(path);
      const { credential } = first.create('Brock');
      first.close();
      const second = new ProfileStore(path);
      expect(second.authenticate(credential)?.name).toBe('Brock');
      second.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('matches', () => {
  it('a ranked win moves trophies both ways and updates ladder stats', () => {
    const a = store.create('A').profile.id;
    const b = store.create('B').profile.id;
    const [ra, rb] = store.recordMatch(ranked(a, b, 0, [3, 1]));
    expect(ra).toEqual({ trophiesBefore: 0, delta: 30 });
    // At zero trophies there's nothing to lose.
    expect(rb).toEqual({ trophiesBefore: 0, delta: 0 });
    expect(store.get(a)).toMatchObject({ trophies: 30, bestTrophies: 30, wins: 1, losses: 0, threeCrowns: 1, streak: 1, bestStreak: 1, battles: 1, rank: 1 });
    expect(store.get(b)).toMatchObject({ trophies: 0, wins: 0, losses: 1, streak: 0, battles: 1, rank: 2 });

    store.recordMatch(ranked(a, b, 1));
    expect(store.get(a)).toMatchObject({ wins: 1, losses: 1, streak: 0, bestStreak: 1, bestTrophies: 30 });
    expect(store.get(a)!.trophies).toBeLessThan(30);
  });

  it('only ranked games between two different profiles are rated', () => {
    const a = store.create('A').profile.id;
    const b = store.create('B').profile.id;
    expect(store.recordMatch({ ...ranked(a, b, 0), mode: 'friendly' })).toEqual([{ trophiesBefore: 0, delta: 0 }, { trophiesBefore: 0, delta: 0 }]);
    store.recordMatch(ranked(a, a, 0));
    store.recordMatch(ranked(a, null, 0));
    store.recordMatch({ ...ranked(a, null, 0), mode: 'training' });
    expect(store.get(a)).toMatchObject({ trophies: 0, wins: 0, losses: 0, battles: 5, rank: null });
    expect(store.leaderboard().total).toBe(0);
    expect(store.recentMatches(a)).toHaveLength(5);
  });

  it('a draw counts for both sides', () => {
    const a = store.create('A').profile.id;
    const b = store.create('B').profile.id;
    store.recordMatch(ranked(a, b, null, [1, 1]));
    expect(store.get(a)).toMatchObject({ draws: 1, trophies: 0 });
    expect(store.get(b)).toMatchObject({ draws: 1 });
    expect(store.recentMatches(b)[0]).toMatchObject({ outcome: 'draw', crowns: 1, opponentCrowns: 1 });
  });

  it('history is newest first, from each player’s side', () => {
    const a = store.create('Ash').profile.id;
    const b = store.create('Gary').profile.id;
    store.recordMatch({ ...ranked(a, b, 0, [2, 0]), sides: [{ profileId: a, name: 'Ash', crowns: 2 }, { profileId: b, name: 'Gary', crowns: 0 }] }, 1000);
    store.recordMatch({ mode: 'training', winner: 1, reason: 'king', sides: [{ profileId: null, name: 'Brock (bot)', crowns: 0 }, { profileId: a, name: 'Ash', crowns: 3 }] }, 2000);
    const history = store.recentMatches(a);
    expect(history.map((m) => m.mode)).toEqual(['training', 'ranked']);
    expect(history[0]).toMatchObject({ outcome: 'win', crowns: 3, delta: 0, playedAt: 2000, opponent: { id: null, name: 'Brock (bot)' } });
    expect(history[1]).toMatchObject({ outcome: 'win', crowns: 2, delta: 30, opponent: { id: b, name: 'Gary', trophies: 0 } });
    expect(store.recentMatches(b)[0]).toMatchObject({ outcome: 'loss', opponentCrowns: 2, opponent: { id: a, name: 'Ash' } });
  });
});

describe('leaderboard', () => {
  it('orders by trophies, then wins, then who got there first', () => {
    const ids = ['P1', 'P2', 'P3', 'P4'].map((n, i) => store.create(n, 1000 + i).profile.id);
    const [p1, p2, p3, p4] = ids as [string, string, string, string];
    store.recordMatch(ranked(p1, p2, 0));
    store.recordMatch(ranked(p1, p3, 0));
    store.recordMatch(ranked(p3, p4, 0));
    const board = store.leaderboard();
    expect(board.total).toBe(4);
    expect(board.entries.map((e) => e.id)).toEqual([p1, p3, p2, p4]);
    expect(board.entries.map((e) => e.rank)).toEqual([1, 2, 3, 4]);
    for (const e of board.entries) expect(store.rankOf(e.id)).toBe(e.rank);
    expect(store.leaderboard(2, 2).entries.map((e) => [e.rank, e.id])).toEqual([[3, p2], [4, p4]]);
  });
});
