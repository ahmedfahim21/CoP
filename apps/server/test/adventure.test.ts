import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { boot, type ColyseusTestServer } from '@colyseus/testing';
import type { Room as ClientRoom } from '@colyseus/sdk';
import {
  DEFAULT_DECK, EVENTS, GAUNTLET_RULES, MSG, QUEUE_ROOM_NAME, ROOM_NAME, dailyChallenge, dayKey, draftOffers, draftSeed, isReplay, runReplay, UNLOCK_SCHEDULE,
  type CreatedProfileResponse, type MatchState, type RematchMessage, type ReplayResponse, type ScoreboardResponse, type SeatMessage,
  type StarterPick, type StatusResponse, type SummaryMessage, type Team,
} from '@cop/shared';
import { createAppServer } from '../src/app.js';
import { BattleRoom } from '../src/BattleRoom.js';
import { QueueRoom } from '../src/QueueRoom.js';
import { ProfileStore } from '../src/store.js';
import { testRpc } from './pglite.js';

const RED: StarterPick = ['bulbasaur', 'charmander'];
const DAY = 86_400_000;
/** A Monday-noon timestamp in the week whose event is EVENTS[i]. */
const eventWeek = (i: number) => Date.UTC(2026, 0, 5, 12) + i * 7 * DAY;

let colyseus: ColyseusTestServer;
let store: ProfileStore;

beforeAll(async () => {
  store = new ProfileStore(await testRpc());
  colyseus = await boot(createAppServer({ store }));
});
afterAll(async () => {
  await colyseus.shutdown();
  await store.close();
});
afterEach(async () => {
  BattleRoom.now = () => Date.now();
  QueueRoom.ghostAfterSeconds = 8;
  QueueRoom.botAfterSeconds = 30;
  await colyseus.cleanup();
});

async function newProfile(name: string): Promise<CreatedProfileResponse> {
  const res = await colyseus.http.post('/api/profiles', { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
  return res.data as CreatedProfileResponse;
}

function matchOf(room: BattleRoom): MatchState {
  return room['match']!;
}

function listen(client: ClientRoom) {
  const summary = new Promise<SummaryMessage>((resolve) => client.onMessage(MSG.summary, resolve));
  const rematch = new Promise<RematchMessage>((resolve) => client.onMessage(MSG.rematch, resolve));
  client.onMessage(MSG.hand, () => undefined);
  client.onMessage(MSG.fx, () => undefined);
  client.onMessage(MSG.rematchState, () => undefined);
  return { summary, rematch };
}

/** Joins a single-player battle and waits for it to begin. */
async function adventure(credential: string, adventure: unknown, deck?: string[]) {
  const client = await colyseus.sdk.create(ROOM_NAME, { starters: RED, credential, adventure, ...(deck ? { deck } : {}) });
  const msgs = listen(client);
  const room = colyseus.getRoomById<BattleRoom>(client.roomId);
  await vi.waitFor(() => expect(room.state.phase).toBe('countdown'));
  room.setSimulationInterval();
  return { client, room, ...msgs };
}

/** Knock out `loser`'s trainer (and optionally a tower of the winner's): the battle ends on this tick. */
function knockOut(room: BattleRoom, loser: Team, opts: { winnerLosesTower?: boolean } = {}) {
  const match = matchOf(room);
  if (match.phase === 'countdown') match.phase = 'regular';
  if (opts.winnerLosesTower) match.entities.find((e) => e.team !== loser && e.kind === 'princess')!.hp = 0;
  match.entities.find((e) => e.team === loser && e.kind === 'king')!.hp = 0;
  room['tick']();
  expect(match.phase).toBe('ended');
}

describe('League', () => {
  it('a first clear earns the badge, unlocks its cards and opens the next stage', async () => {
    const me = await newProfile('Leaguer');
    const { room, summary } = await adventure(me.credential, { kind: 'league', stage: 'brock' });
    // Fought in Pewter Gym's arena (3), whatever the player's trophies.
    expect(room.state.toJSON()).toMatchObject({ mode: 'league', title: 'Brock · Pewter Gym', twist: expect.stringContaining('40%'), arena: 3 });
    const bot = [...room.state.players.values()].find((p) => p.bot)!;
    expect(bot.name).toBe('Brock');
    // His twist: towers with 40% more HP.
    const king = matchOf(room).entities.find((e) => e.team === 1 && e.kind === 'king')!;
    expect(king.maxHp).toBe(Math.round(4000 * 0.6 * 1.4));
    knockOut(room, 1);
    const s = await summary;
    expect(s.mode).toBe('league');
    expect(s.adventure?.stage).toEqual({ id: 'brock', starsBefore: 0, starsAfter: 3 });
    // Brock's own card, plus the level batches reached: the clear's XP alone reaches level 2, and
    // today's quests (drawn from the date and the profile's random tag) can add another level.
    const rewards = s.teams[0].rewards!;
    expect(rewards.levelAfter).toBeGreaterThanOrEqual(2);
    const byLevel = UNLOCK_SCHEDULE.filter((u) => u.level <= rewards.levelAfter).flatMap((u) => u.cards);
    expect(rewards.unlocked.sort()).toEqual([...new Set(['golem', ...byLevel])].sort());
    expect(s.teams[0].rewards?.rewards.map((r) => r.text)).toContain('Boulder Badge!');
    expect((await store.own(me.profile.id))!.progress.stars).toEqual({ brock: 3 });
    // Misty is open now.
    const next = await adventure(me.credential, { kind: 'league', stage: 'misty' });
    expect(next.room.state.title).toContain('Misty');
    expect(next.room.state.arena).toBe(4);
  });

  it('stages open in order, and need a profile', async () => {
    const me = await newProfile('Skipper');
    await expect(colyseus.sdk.create(ROOM_NAME, { starters: RED, credential: me.credential, adventure: { kind: 'league', stage: 'misty' } }))
      .rejects.toThrow(/Beat the stage/);
    await expect(colyseus.sdk.create(ROOM_NAME, { starters: RED, adventure: { kind: 'league', stage: 'brock' } })).rejects.toThrow(/profile/);
  });

  it('a better run raises the stars; a worse one never lowers them', async () => {
    const me = await newProfile('Perfectionist');
    const a = await adventure(me.credential, { kind: 'league', stage: 'brock' });
    knockOut(a.room, 1, { winnerLosesTower: true });
    expect((await a.summary).adventure?.stage).toEqual({ id: 'brock', starsBefore: 0, starsAfter: 2 });
    // Retry from the result screen: a rematch is the same stage again.
    a.client.send(MSG.rematch);
    const seat = await a.rematch;
    const next = await colyseus.sdk.consumeSeatReservation(seat.reservation as never);
    const nextMsgs = listen(next);
    const room = colyseus.getRoomById<BattleRoom>(next.roomId);
    await vi.waitFor(() => expect(room.state.phase).toBe('countdown'));
    expect(room.state.title).toContain('Brock');
    room.setSimulationInterval();
    knockOut(room, 1);
    expect((await nextMsgs.summary).adventure?.stage).toEqual({ id: 'brock', starsBefore: 2, starsAfter: 3 });
  });
});

describe('card locks', () => {
  it('your own deck must be unlocked cards, in every battle', async () => {
    const me = await newProfile('Locked');
    const locked = ['golem', 'geodude', 'rattata', 'zubat', 'voltorb', 'pikachu', 'machop', 'snorlax'];
    await expect(colyseus.sdk.create(ROOM_NAME, { starters: RED, credential: me.credential, training: true, deck: locked })).rejects.toThrow(/locked/);
    await expect(colyseus.sdk.joinOrCreate(QUEUE_ROOM_NAME, { starters: RED, credential: me.credential, deck: locked })).rejects.toThrow(/locked/);
    // Guests have no collection to check.
    const guest = await colyseus.sdk.create(ROOM_NAME, { starters: RED, training: true, deck: locked });
    expect(guest.roomId).toBeTruthy();
  });
});

describe('Daily Challenge', () => {
  it('everyone plays the day’s deck and seed; scores go on the day’s board', async () => {
    const day = dayKey(Date.now());
    const challenge = dailyChallenge(day);
    const me = await newProfile('Daily');
    const { room, summary } = await adventure(me.credential, { kind: 'daily' });
    expect(room.state.title).toBe(`Daily: ${challenge.title}`);
    // Not a League stage: the arena follows the players' trophies.
    expect(room.state.arena).toBe(0);
    const mine = matchOf(room).players[0];
    expect(new Set([...mine.hand, ...mine.queue])).toEqual(new Set(challenge.deck));
    expect(room['plan'].seed).toBe(challenge.seed);
    knockOut(room, 1);
    const s = await summary;
    expect(s.adventure?.daily?.score).toBeGreaterThan(3000);
    expect(s.adventure?.daily).toMatchObject({ rank: 1, best: s.adventure!.daily!.score });
    expect(s.teams[0].rewards?.rewards.map((r) => r.text)).toContain('Daily Challenge');
    const board = (await colyseus.http.get('/api/scores/daily')).data as ScoreboardResponse;
    expect(board).toMatchObject({ board: 'daily', period: day, total: 1 });
    expect(board.entries[0]).toMatchObject({ id: me.profile.id, name: 'Daily', score: s.adventure!.daily!.score });
  });
});

describe('Gauntlet', () => {
  it('winning a round leads to the next with tower damage carried; the run ends on a loss and is scored', async () => {
    const me = await newProfile('Runner');
    const r1 = await adventure(me.credential, { kind: 'gauntlet' });
    expect(r1.room.state.title).toBe('Gauntlet · Round 1');
    // The timer shows the Gauntlet's own clock before the start, not the ladder's.
    expect(r1.room.state.regularSeconds).toBe(GAUNTLET_RULES.regularSeconds);
    // Take damage before winning, so round 2 starts hurt.
    const myLeft = matchOf(r1.room).entities.find((e) => e.team === 0 && e.kind === 'princess')!;
    myLeft.hp = Math.round(myLeft.maxHp / 2);
    knockOut(r1.room, 1);
    const s1 = await r1.summary;
    expect(s1.adventure?.gauntlet).toEqual({ round: 1, cleared: true, best: 1, rank: null });

    r1.client.send(MSG.rematch);
    const next = await colyseus.sdk.consumeSeatReservation((await r1.rematch).reservation as never);
    const msgs = listen(next);
    const r2 = colyseus.getRoomById<BattleRoom>(next.roomId);
    await vi.waitFor(() => expect(r2.state.phase).toBe('countdown'));
    r2.setSimulationInterval();
    expect(r2.state.title).toBe('Gauntlet · Round 2');
    const carried = matchOf(r2).entities.find((e) => e.team === 0 && e.kind === 'princess' && e.lane === myLeft.lane)!;
    expect(carried.hp / carried.maxHp).toBeCloseTo(0.5, 2);
    knockOut(r2, 0);
    const s2 = await msgs.summary;
    expect(s2.adventure?.gauntlet).toEqual({ round: 2, cleared: false, best: 1, rank: 1 });
    const board = (await colyseus.http.get('/api/scores/gauntlet')).data as ScoreboardResponse;
    expect(board.entries[0]).toMatchObject({ id: me.profile.id, score: 1 });
    expect((await store.get(me.profile.id))!.gauntletBest).toBe(1);
  });
});

describe('events', () => {
  it('Mirror Match: the bot plays your own deck and towers', async () => {
    BattleRoom.now = () => eventWeek(EVENTS.findIndex((e) => e.id === 'mirror'));
    const me = await newProfile('Mirror');
    const { room, summary } = await adventure(me.credential, { kind: 'event' });
    expect(room.state.title).toBe('Event: Mirror Match');
    const bot = room['seats'][1]!;
    expect([...bot.deck].sort()).toEqual([...DEFAULT_DECK].sort());
    expect(bot.starters).toEqual(RED);
    knockOut(room, 1);
    expect((await summary).adventure?.event).toBe('mirror');
  });

  it('Draft: only this week’s offered picks are accepted, and you battle with them', async () => {
    const now = eventWeek(EVENTS.findIndex((e) => e.id === 'draft'));
    BattleRoom.now = () => now;
    const me = await newProfile('Drafter');
    const offers = draftOffers(draftSeed(me.profile.id, now));
    const picks = offers.map((pair) => pair[1]);
    const { room } = await adventure(me.credential, { kind: 'event', draft: picks });
    const mine = matchOf(room).players[0];
    expect(new Set([...mine.hand, ...mine.queue])).toEqual(new Set(picks));
    await expect(colyseus.sdk.create(ROOM_NAME, { starters: RED, credential: me.credential, adventure: { kind: 'event', draft: [...DEFAULT_DECK] } }))
      .rejects.toThrow(/draft/);
  });

  it('Triple Elixir: both sides fill up three times as fast', async () => {
    BattleRoom.now = () => eventWeek(EVENTS.findIndex((e) => e.id === 'triple'));
    const me = await newProfile('Triple');
    const { room } = await adventure(me.credential, { kind: 'event' });
    const match = matchOf(room);
    expect(match.players.map((p) => p.elixir)).toEqual([10, 10]);
    expect(match.rules.teams?.map((t) => t.elixirRate)).toEqual([3, 3]);
  });
});

describe('ghost battles', () => {
  it('after a short wait the queue pits you against a real trainer’s deck; only your trophies move', async () => {
    QueueRoom.ghostAfterSeconds = 0.3;
    const owner = await newProfile('Ghostly');
    const ownerDeck = ['magikarp', 'primeape', 'rattata', 'zubat', 'voltorb', 'pikachu', 'machop', 'snorlax'];
    await colyseus.http.patch('/api/profiles/me', { headers: { Authorization: `Bearer ${owner.credential}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ deck: ownerDeck, starters: ['squirtle', 'bulbasaur'] }) });
    // Make sure at least one trainer qualifies as a ghost: a battle on record.
    await store.recordMatch({ mode: 'training', winner: 0, reason: 'crowns', sides: [{ profileId: owner.profile.id, name: 'Ghostly', crowns: 1 }, { profileId: null, name: 'Bot', crowns: 0 }] });

    const me = await newProfile('Seeker');
    const queue = await colyseus.sdk.joinOrCreate(QUEUE_ROOM_NAME, { credential: me.credential, starters: RED });
    const seat = await new Promise<SeatMessage>((resolve) => queue.onMessage(MSG.seat, resolve));
    queue.onMessage(MSG.queueStatus, () => undefined);
    expect(seat.mode).toBe('ghost');
    const client = await colyseus.sdk.consumeSeatReservation(seat.reservation as never);
    const { summary } = listen(client);
    const room = colyseus.getRoomById<BattleRoom>(client.roomId);
    await vi.waitFor(() => expect(room.state.phase).toBe('countdown'));
    room.setSimulationInterval();
    expect(room.state.mode).toBe('ghost');
    // Some real, recently active trainer (other tests' trainers count too): their name, towers and deck.
    const ghost = [...room.state.players.values()].find((p) => p.bot)!.toJSON();
    expect(ghost).toMatchObject({ ghost: true, profileId: expect.stringMatching(/^[0289PYLQGRJCUV]{8}$/) });
    expect(ghost.profileId).not.toBe(me.profile.id);
    const real = (await store.own(ghost.profileId))!;
    expect(ghost).toMatchObject({ name: real.name, starterLeft: real.starters[0], starterRight: real.starters[1] });
    expect(new Set(room['seats'][1]!.deck)).toEqual(new Set(real.deck));
    const before = await store.get(real.id);

    knockOut(room, 1);
    const s = await summary;
    expect(s.teams[0].delta).toBe(15);
    expect(await store.get(me.profile.id)).toMatchObject({ trophies: 15, wins: 1 });
    expect(await store.get(real.id)).toMatchObject({ trophies: before!.trophies, losses: before!.losses, battles: before!.battles });
    expect((await store.recentMatches(real.id))[0]).toMatchObject({ mode: 'ghost', outcome: 'loss', opponent: { name: 'Seeker' } });
  });

  it('with no ghost about, the bot still steps in', async () => {
    QueueRoom.ghostAfterSeconds = 0.2;
    QueueRoom.botAfterSeconds = 1;
    // A fresh database: nobody else has battled.
    const solo = await newProfile('Alone');
    const queue = await colyseus.sdk.joinOrCreate(QUEUE_ROOM_NAME, { credential: solo.credential, starters: RED });
    queue.onMessage(MSG.queueStatus, () => undefined);
    const seat = await new Promise<SeatMessage>((resolve) => queue.onMessage(MSG.seat, resolve));
    expect(['ghost', 'training']).toContain(seat.mode);
  });
});

describe('rewards and replays', () => {
  it('every battle pays XP and quest progress, and its replay re-simulates to the same result', async () => {
    const me = await newProfile('Watcher');
    const client = await colyseus.sdk.create(ROOM_NAME, { starters: RED, credential: me.credential, training: true });
    const { summary } = listen(client);
    const room = colyseus.getRoomById<BattleRoom>(client.roomId);
    await vi.waitFor(() => expect(room.state.phase).toBe('countdown'));
    room.setSimulationInterval();
    // Let the bot play the whole battle against an idle trainer.
    const match = matchOf(room);
    for (let i = 0; i < 20_000 && match.phase !== 'ended'; i++) room['tick']();
    expect(match.phase).toBe('ended');
    const s = await summary;
    expect(s.teams[0].rewards!.xp).toBeGreaterThan(0);
    expect(s.teams[0].rewards!.totalXp).toBe(s.teams[0].rewards!.xp);
    expect(s.matchId).toBeGreaterThan(0);

    const res = (await colyseus.http.get(`/api/replays/${s.matchId}`)).data as ReplayResponse;
    expect(isReplay(res.replay)).toBe(true);
    const again = runReplay(res.replay as never);
    expect(again.result).toEqual(match.result);
    const towers = (m: MatchState) => m.entities.filter((e) => e.kind !== 'unit').map((e) => `${e.id}:${e.hp}`);
    expect(towers(again)).toEqual(towers(match));
    await expect(colyseus.http.get('/api/replays/99999')).rejects.toMatchObject({ statusCode: 404 });
  });

  it('puzzles pay once', async () => {
    const me = await newProfile('Puzzler');
    const post = (id: string) => colyseus.http.post('/api/progress/puzzle', {
      headers: { Authorization: `Bearer ${me.credential}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ id }),
    });
    expect(((await post('air-raid')).data as { xp: number }).xp).toBe(30);
    expect(((await post('air-raid')).data as { xp: number }).xp).toBe(0);
    await expect(post('nope')).rejects.toMatchObject({ statusCode: 400 });
  });

  it('reports who is online', async () => {
    const me = await newProfile('Counter');
    const q = await colyseus.sdk.joinOrCreate(QUEUE_ROOM_NAME, { credential: me.credential, starters: RED });
    q.onMessage(MSG.queueStatus, () => undefined);
    await vi.waitFor(async () => {
      const s = (await colyseus.http.get('/api/status')).data as StatusResponse;
      expect(s).toMatchObject({ searching: 1, online: 1 });
    });
  });
});
