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
    const deck: CardId[] = ['magikarp', 'primeape', 'rattata', 'zubat', 'voltorb', 'pikachu', 'machop', 'snorlax'];
    const ok = (await store.update(profile.id, { name: 'Red', deck, starters: ['bulbasaur', 'squirtle'] }));
    expect(ok.rejected).toEqual([]);
    expect(ok.profile).toMatchObject({ name: 'Red', deck, starters: ['bulbasaur', 'squirtle'] });
    const bad = (await store.update(profile.id, { deck: ['pikachu'] as CardId[], starters: ['bulbasaur', 'bulbasaur'] }));
    expect(bad.rejected).toEqual(['deck', 'starters']);
    expect(bad.profile).toMatchObject({ deck, starters: ['bulbasaur', 'squirtle'] });
  });

  it('only accepts decks of unlocked cards', async () => {
    const { profile } = await store.create('Newbie');
    const locked: CardId[] = ['magikarp', 'golem', 'rattata', 'zubat', 'voltorb', 'pikachu', 'machop', 'snorlax'];
    expect((await store.update(profile.id, { deck: locked })).rejected).toEqual(['deck']);
    await store.updateProgress(profile.id, (p) => ({ progress: { ...p, stars: { brock: 1 } }, result: null }));
    expect((await store.update(profile.id, { deck: locked })).rejected).toEqual([]);
    expect((await store.own(profile.id))!.progress.stars).toEqual({ brock: 1 });
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
      { rank: 1, id: a, name: 'A', trophies: 0, wins: 0, losses: 0, battles: 5, rated: false, xp: 0 },
      { rank: 2, id: b, name: 'B', trophies: 0, wins: 0, losses: 0, battles: 1, rated: false, xp: 0 },
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
    expect(board.entries[2]).toEqual({ rank: 3, id: botOnly, name: 'Bot fan', trophies: 0, wins: 0, losses: 0, battles: 3, rated: false, xp: 0 });
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

describe('ghost battles', () => {
  it('move only the challenger’s trophies, at half rate, and leave the ghost a history entry', async () => {
    const me = (await store.create('Me')).profile.id;
    const owner = (await store.create('Ghost owner')).profile.id;
    const { sides } = await store.recordBattle({ ...ranked(me, owner, 0, [2, 0]), mode: 'ghost', ghostTeam: 1 });
    expect(sides[0]).toEqual({ trophiesBefore: 0, delta: 15 });
    expect(sides[1]).toEqual({ trophiesBefore: 0, delta: 0 });
    expect(await store.get(me)).toMatchObject({ trophies: 15, wins: 1, battles: 1 });
    expect(await store.get(owner)).toMatchObject({ trophies: 0, losses: 0, battles: 0 });
    expect((await store.recentMatches(owner))[0]).toMatchObject({ mode: 'ghost', outcome: 'loss', opponent: { id: me } });
  });
});

describe('progress', () => {
  it('concurrent updates both land', async () => {
    const id = (await store.create('Busy')).profile.id;
    await Promise.all([
      store.updateProgress(id, (p) => ({ progress: { ...p, xp: p.xp + 10 }, result: null })),
      store.updateProgress(id, (p) => ({ progress: { ...p, xp: p.xp + 5 }, result: null })),
    ]);
    expect((await store.progress(id))!.xp).toBe(15);
    expect(await store.updateProgress('00000000', (p) => ({ progress: p, result: 1 }))).toBeNull();
  });

  it('public profiles show level, badges and stars', async () => {
    const id = (await store.create('Climber')).profile.id;
    await store.updateProgress(id, (p) => ({ progress: { ...p, xp: 500, stars: { brock: 3, misty: 1 }, gauntletBest: 4 }, result: null }));
    expect(await store.get(id)).toMatchObject({ level: 4, badges: ['brock', 'misty'], stars: 4, gauntletBest: 4, seasons: [] });
  });
});

describe('ghost lookup', () => {
  it('finds active trainers near your trophies, never yourself', async () => {
    const me = (await store.create('Me', 1000)).profile.id;
    const near = (await store.create('Near', 1000)).profile.id;
    await store.create('Never battled', 1000);
    await store.recordMatch(ranked(near, me, 0));
    const ghosts = await store.ghosts(30, me, 2000);
    expect(ghosts.map((g) => g.id)).toEqual([near]);
    expect(ghosts[0]).toMatchObject({ name: 'Near', deck: [...DEFAULT_DECK] });
    // Long inactive trainers are skipped.
    expect(await store.ghosts(30, me, 1000 + 60 * 86_400_000)).toEqual([]);
  });
});

describe('score boards', () => {
  it('keep each trainer’s best and rank them', async () => {
    const a = (await store.create('A')).profile.id;
    const b = (await store.create('B')).profile.id;
    expect(await store.submitScore('daily', '2026-10-16', a, 'A', 1200, {}, 1)).toEqual({ best: 1200, rank: 1 });
    expect(await store.submitScore('daily', '2026-10-16', b, 'B', 1500, {}, 2)).toEqual({ best: 1500, rank: 1 });
    expect(await store.submitScore('daily', '2026-10-16', a, 'A', 900, {}, 3)).toEqual({ best: 1200, rank: 2 });
    expect(await store.submitScore('daily', '2026-10-17', a, 'A', 10, {}, 4)).toEqual({ best: 10, rank: 1 });
    const board = await store.scoreboard('daily', '2026-10-16');
    expect(board).toEqual({ board: 'daily', period: '2026-10-16', total: 2, entries: [
      { rank: 1, id: b, name: 'B', score: 1500 }, { rank: 2, id: a, name: 'A', score: 1200 },
    ] });
  });
});

describe('replays', () => {
  it('are stored with the battle and flagged in history', async () => {
    const a = (await store.create('A')).profile.id;
    const replay = { v: 1, seed: 5, starters: [['bulbasaur', 'charmander'], ['squirtle', 'charmander']], decks: [[...DEFAULT_DECK], [...DEFAULT_DECK]], rules: {}, names: ['A', 'Bot'], plays: [], steps: 10, result: null } as never;
    const { matchId } = await store.recordBattle({ mode: 'training', winner: 0, reason: 'crowns', sides: [{ profileId: a, name: 'A', crowns: 1 }, { profileId: null, name: 'Bot', crowns: 0 }], replay });
    expect((await store.recentMatches(a))[0]).toMatchObject({ id: matchId, hasReplay: true, team: 0 });
    expect(await store.replay(matchId)).toMatchObject({ id: matchId, mode: 'training', replay: { seed: 5 }, players: [{ team: 0, name: 'A', profileId: a }, { team: 1, name: 'Bot', profileId: null }] });
    expect(await store.replay(999)).toBeNull();
  });
});

describe('seasons', () => {
  it('the first call only records the season; a new month archives final standings', async () => {
    const top = (await store.create('Top')).profile.id;
    const low = (await store.create('Low')).profile.id;
    for (let i = 0; i < 3; i++) await store.recordMatch(ranked(top, low, 0));
    const oct = Date.UTC(2026, 9, 16);
    expect(await store.seasonRollover(oct)).toEqual({ rolled: false, season: '2026-10' });
    expect(await store.seasonRollover(oct + 86_400_000)).toEqual({ rolled: false, season: '2026-10' });
    const before = (await store.get(top))!.trophies;
    const res = await store.seasonRollover(Date.UTC(2026, 10, 2));
    expect(res).toMatchObject({ rolled: true, season: '2026-11', ended: '2026-10', trainers: 2 });
    expect((await store.get(top))!.seasons).toEqual([{ season: '2026-10', trophies: before, rank: 1 }]);
    expect((await store.get(low))!.seasons).toEqual([{ season: '2026-10', trophies: 0, rank: 2 }]);
    expect((await store.get(top))!.trophies).toBe(before);
    expect((await store.seasonRollover(Date.UTC(2026, 10, 3))).rolled).toBe(false);
  });

  it('leaves trophies as they are, even far above 1000', async () => {
    const id = (await store.create('Pro')).profile.id;
    await store['db'].call('cop_record_battle', {
      p_mode: 'ranked', p_winner: 0, p_reason: 'crowns', p_replay: null, p_now: 1,
      p_sides: [{ profileId: id, name: 'Pro', crowns: 1, trophiesBefore: 0, delta: 2000, apply: 'rated' }, { profileId: null, name: 'X', crowns: 0, trophiesBefore: 0, delta: 0, apply: 'none' }],
    });
    await store.seasonRollover(Date.UTC(2026, 9, 1));
    await store.seasonRollover(Date.UTC(2026, 10, 1));
    expect((await store.get(id))!.trophies).toBe(2000);
  });
});
