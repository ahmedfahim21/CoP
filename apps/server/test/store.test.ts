import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_DECK, isProfileTag, type CardId } from '@cop/shared';
import { ProfileStore, type MatchReport } from '../src/store.js';
import { testRpc } from './pglite.js';

let store: ProfileStore;
beforeEach(async () => {
  store = new ProfileStore(await testRpc());
});
afterEach(() => store.close());

function ranked(a: string | null, b: string | null, winner: 0 | 1 | null, crowns: [number, number] = [1, 0]): MatchReport {
  return {
    mode: 'ranked', winner, reason: winner === null ? 'draw' : 'crowns',
    sides: [{ profileId: a, name: 'A', crowns: crowns[0] }, { profileId: b, name: 'B', crowns: crowns[1] }],
  };
}

describe('profiles', () => {
  it('creates a profile with a tag, a sanitized name and defaults', async () => {
    const { profile, credential } = (await store.create('  Misty\u0007  '));
    expect(isProfileTag(profile.id)).toBe(true);
    expect(credential.startsWith(`${profile.id}.`)).toBe(true);
    expect(profile).toMatchObject({ name: 'Misty', trophies: 0, wins: 0, losses: 0, rank: null, deck: [...DEFAULT_DECK], starters: ['charmander', 'squirtle'] });
    expect((await store.create(undefined)).profile.name).toBe('Trainer');
  });

  it('authenticates only the exact credential', async () => {
    const { profile, credential } = (await store.create('Ash'));
    expect((await store.authenticate(credential))?.id).toBe(profile.id);
    expect((await store.authenticate(`${credential}x`))).toBeNull();
    expect((await store.authenticate(`${profile.id}.${'A'.repeat(32)}`))).toBeNull();
    expect((await store.authenticate(profile.id))).toBeNull();
    expect((await store.authenticate(undefined))).toBeNull();
  });

  it('updates name, deck and starters, rejecting invalid ones', async () => {
    const { profile } = (await store.create('Ash'));
    const deck: CardId[] = ['magikarp', 'geodude', 'dugtrio', 'gengar', 'chansey', 'scyther', 'jolteon', 'rapidash'];
    const ok = (await store.update(profile.id, { name: 'Red', deck, starters: ['bulbasaur', 'squirtle'] }));
    expect(ok.rejected).toEqual([]);
    expect(ok.profile).toMatchObject({ name: 'Red', deck, starters: ['bulbasaur', 'squirtle'] });
    const bad = (await store.update(profile.id, { deck: ['pikachu'] as CardId[], starters: ['bulbasaur', 'bulbasaur'] }));
    expect(bad.rejected).toEqual(['deck', 'starters']);
    expect(bad.profile).toMatchObject({ deck, starters: ['bulbasaur', 'squirtle'] });
  });

});

describe('matches', () => {
  it('a ranked win moves trophies both ways and updates ladder stats', async () => {
    const a = (await store.create('A')).profile.id;
    const b = (await store.create('B')).profile.id;
    const [ra, rb] = (await store.recordMatch(ranked(a, b, 0, [3, 1])));
    expect(ra).toEqual({ trophiesBefore: 0, delta: 30 });
    // At zero trophies there's nothing to lose.
    expect(rb).toEqual({ trophiesBefore: 0, delta: 0 });
    expect((await store.get(a))).toMatchObject({ trophies: 30, bestTrophies: 30, wins: 1, losses: 0, threeCrowns: 1, streak: 1, bestStreak: 1, battles: 1, rank: 1 });
    expect((await store.get(b))).toMatchObject({ trophies: 0, wins: 0, losses: 1, streak: 0, battles: 1, rank: 2 });

    await store.recordMatch(ranked(a, b, 1));
    expect((await store.get(a))).toMatchObject({ wins: 1, losses: 1, streak: 0, bestStreak: 1, bestTrophies: 30 });
    expect((await store.get(a))!.trophies).toBeLessThan(30);
  });

  it('only ranked games between two different profiles are rated', async () => {
    const a = (await store.create('A')).profile.id;
    const b = (await store.create('B')).profile.id;
    expect((await store.recordMatch({ ...ranked(a, b, 0), mode: 'friendly' }))).toEqual([{ trophiesBefore: 0, delta: 0 }, { trophiesBefore: 0, delta: 0 }]);
    await store.recordMatch(ranked(a, a, 0));
    await store.recordMatch(ranked(a, null, 0));
    await store.recordMatch({ ...ranked(a, null, 0), mode: 'training' });
    // None of it moves trophies or ranked stats, but every battle counts towards the ladder.
    expect((await store.get(a))).toMatchObject({ trophies: 0, wins: 0, losses: 0, battles: 5, rank: 1 });
    expect((await store.get(b))).toMatchObject({ trophies: 0, wins: 0, losses: 0, battles: 1, rank: 2 });
    const board = await store.leaderboard();
    expect(board.total).toBe(2);
    expect(board.entries).toEqual([
      { rank: 1, id: a, name: 'A', trophies: 0, wins: 0, losses: 0, battles: 5, rated: false },
      { rank: 2, id: b, name: 'B', trophies: 0, wins: 0, losses: 0, battles: 1, rated: false },
    ]);
    expect((await store.recentMatches(a))).toHaveLength(5);
  });

  it('a draw counts for both sides', async () => {
    const a = (await store.create('A')).profile.id;
    const b = (await store.create('B')).profile.id;
    await store.recordMatch(ranked(a, b, null, [1, 1]));
    expect((await store.get(a))).toMatchObject({ draws: 1, trophies: 0 });
    expect((await store.get(b))).toMatchObject({ draws: 1 });
    expect((await store.recentMatches(b))[0]).toMatchObject({ outcome: 'draw', crowns: 1, opponentCrowns: 1 });
  });

  it('history is newest first, from each player’s side', async () => {
    const a = (await store.create('Ash')).profile.id;
    const b = (await store.create('Gary')).profile.id;
    await store.recordMatch({ ...ranked(a, b, 0, [2, 0]), sides: [{ profileId: a, name: 'Ash', crowns: 2 }, { profileId: b, name: 'Gary', crowns: 0 }] }, 1000);
    await store.recordMatch({ mode: 'training', winner: 1, reason: 'king', sides: [{ profileId: null, name: 'Brock (bot)', crowns: 0 }, { profileId: a, name: 'Ash', crowns: 3 }] }, 2000);
    const history = (await store.recentMatches(a));
    expect(history.map((m) => m.mode)).toEqual(['training', 'ranked']);
    expect(history[0]).toMatchObject({ outcome: 'win', crowns: 3, delta: 0, playedAt: 2000, opponent: { id: null, name: 'Brock (bot)' } });
    expect(history[1]).toMatchObject({ outcome: 'win', crowns: 2, delta: 30, opponent: { id: b, name: 'Gary', trophies: 0 } });
    expect((await store.recentMatches(b))[0]).toMatchObject({ outcome: 'loss', opponentCrowns: 2, opponent: { id: a, name: 'Ash' } });
  });
});

describe('concurrency', () => {
  it('two results landing together both count', async () => {
    const a = (await store.create('A')).profile.id;
    const b = (await store.create('B')).profile.id;
    const c = (await store.create('C')).profile.id;
    await Promise.all([store.recordMatch(ranked(a, b, 0)), store.recordMatch(ranked(a, c, 0))]);
    expect(await store.get(a)).toMatchObject({ wins: 2, battles: 2, streak: 2 });
    expect((await store.recentMatches(a)).length).toBe(2);
  });
});

describe('leaderboard', () => {
  it('lists trainers who only fought the bot, with no trophies, below everyone ranked', async () => {
    const ranked1 = (await store.create('Ranked winner', 1000)).profile.id;
    const ranked2 = (await store.create('Ranked loser', 1001)).profile.id;
    const botOnly = (await store.create('Bot fan', 999)).profile.id;
    const idle = (await store.create('Never played', 998)).profile.id;
    await store.recordMatch(ranked(ranked1, ranked2, 0));
    for (let i = 0; i < 3; i++) await store.recordMatch({ ...ranked(botOnly, null, 0), mode: 'training' });

    const board = await store.leaderboard();
    expect(board.total).toBe(3);
    expect(board.entries.map((e) => e.id)).toEqual([ranked1, ranked2, botOnly]);
    expect(board.entries[0]).toMatchObject({ trophies: 30, wins: 1, battles: 1, rated: true });
    // Lost its only ranked game: still rated, and above the bot-only trainer despite being newer.
    expect(board.entries[1]).toMatchObject({ trophies: 0, losses: 1, battles: 1, rated: true });
    expect(board.entries[2]).toEqual({ rank: 3, id: botOnly, name: 'Bot fan', trophies: 0, wins: 0, losses: 0, battles: 3, rated: false });
    for (const e of board.entries) expect(await store.rankOf(e.id)).toBe(e.rank);
    // Nobody who hasn't battled is listed or ranked.
    expect(await store.rankOf(idle)).toBeNull();
  });

  it('orders by trophies, then wins, then who got there first', async () => {
    const ids: string[] = [];
    for (const [i, n] of ['P1', 'P2', 'P3', 'P4'].entries()) ids.push((await store.create(n, 1000 + i)).profile.id);
    const [p1, p2, p3, p4] = ids as [string, string, string, string];
    await store.recordMatch(ranked(p1, p2, 0));
    await store.recordMatch(ranked(p1, p3, 0));
    await store.recordMatch(ranked(p3, p4, 0));
    const board = (await store.leaderboard());
    expect(board.total).toBe(4);
    expect(board.entries.map((e) => e.id)).toEqual([p1, p3, p2, p4]);
    expect(board.entries.map((e) => e.rank)).toEqual([1, 2, 3, 4]);
    for (const e of board.entries) expect((await store.rankOf(e.id))).toBe(e.rank);
    expect((await store.leaderboard(2, 2)).entries.map((e) => [e.rank, e.id])).toEqual([[3, p2], [4, p4]]);
  });
});
