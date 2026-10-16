import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { boot, type ColyseusTestServer } from '@colyseus/testing';
import type { Room as ClientRoom } from '@colyseus/sdk';
import {
  MSG, QUEUE_ROOM_NAME, ROOM_NAME,
  type CreatedProfileResponse, type LeaderboardResponse, type MatchState, type OwnProfileResponse, type ProfileResponse,
  type QueueStatusMessage, type RematchMessage, type RematchStateMessage, type SeatMessage, type StarterPick, type SummaryMessage, type Team,
} from '@cop/shared';
import { CREATE_LIMIT } from '../src/api.js';
import { createAppServer } from '../src/app.js';
import { BOT_DECKS, BattleRoom } from '../src/BattleRoom.js';
import { QueueRoom } from '../src/QueueRoom.js';
import { ProfileStore } from '../src/store.js';
import { testRpc } from './pglite.js';
import { QUICK_RULES, isDeck } from '@cop/shared';

const RED: StarterPick = ['bulbasaur', 'charmander'];
const BLUE: StarterPick = ['squirtle', 'charmander'];

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
  QueueRoom.botAfterSeconds = 30;
  BattleRoom.partnerSeconds = 12;
  await colyseus.cleanup();
});

function matchOf(room: BattleRoom): MatchState {
  return room['match']!;
}

async function newProfile(name: string): Promise<CreatedProfileResponse> {
  const res = await colyseus.http.post('/api/profiles', { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
  expect(res.statusCode).toBe(201);
  return res.data as CreatedProfileResponse;
}

const auth = (credential: string) => ({ headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' } });

/** Join the queue and resolve with the seat it hands out. */
async function queueFor(credential: string, starters = RED) {
  const queue = await colyseus.sdk.joinOrCreate(QUEUE_ROOM_NAME, { credential, starters });
  const seat = new Promise<SeatMessage>((resolve) => queue.onMessage(MSG.seat, resolve));
  const status: QueueStatusMessage[] = [];
  queue.onMessage(MSG.queueStatus, (m: QueueStatusMessage) => status.push(m));
  return { queue, seat, status };
}

async function sit(seat: SeatMessage) {
  const room = await colyseus.sdk.consumeSeatReservation(seat.reservation as never);
  const summary = new Promise<SummaryMessage>((resolve) => room.onMessage(MSG.summary, resolve));
  room.onMessage(MSG.hand, () => undefined);
  room.onMessage(MSG.fx, () => undefined);
  room.onMessage(MSG.rematchState, () => undefined);
  return { room, summary };
}

/** Knock out `loser`'s trainer, skipping any countdown: the battle ends on this tick. */
function knockOut(room: BattleRoom, loser: Team) {
  const match = matchOf(room);
  if (match.phase === 'countdown') match.phase = 'regular';
  match.entities.find((e) => e.team === loser && e.kind === 'king')!.hp = 0;
  room['tick'](0.05);
  expect(match.phase).toBe('ended');
}

describe('profile API', () => {
  it('creates, reads and updates your own profile', async () => {
    const { profile, credential } = await newProfile('Misty');
    expect(profile).toMatchObject({ name: 'Misty', trophies: 0, rank: null });

    const me = await colyseus.http.get('/api/profiles/me', auth(credential));
    expect((me.data as OwnProfileResponse).profile).toMatchObject({ id: profile.id, deck: profile.deck });

    const deck = ['magikarp', 'primeape', 'rattata', 'zubat', 'voltorb', 'pikachu', 'machop', 'snorlax'];
    const patched = await colyseus.http.patch('/api/profiles/me', { ...auth(credential), body: JSON.stringify({ name: 'Misty W', deck, starters: ['squirtle', 'bulbasaur'] }) });
    expect((patched.data as OwnProfileResponse).profile).toMatchObject({ name: 'Misty W', deck, starters: ['squirtle', 'bulbasaur'] });

    await expect(colyseus.http.patch('/api/profiles/me', { ...auth(credential), body: JSON.stringify({ deck: ['pikachu'] }) }))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  it('turns away missing or wrong credentials', async () => {
    const { profile } = await newProfile('Brock');
    await expect(colyseus.http.get('/api/profiles/me')).rejects.toMatchObject({ statusCode: 401 });
    await expect(colyseus.http.get('/api/profiles/me', auth(`${profile.id}.${'x'.repeat(32)}`))).rejects.toMatchObject({ statusCode: 401 });
  });

  it('shows public profiles without the loadout, and 404s unknown tags', async () => {
    const { profile } = await newProfile('Erika');
    const res = await colyseus.http.get(`/api/profiles/${profile.id.toLowerCase()}`);
    const body = res.data as ProfileResponse;
    expect(body.profile).toMatchObject({ id: profile.id, name: 'Erika' });
    expect(body.profile).not.toHaveProperty('deck');
    expect(body.matches).toEqual([]);
    await expect(colyseus.http.get('/api/profiles/00000000')).rejects.toMatchObject({ statusCode: 404 });
    await expect(colyseus.http.get('/api/profiles/not-a-tag')).rejects.toMatchObject({ statusCode: 404 });
  });

  it('answers CORS preflights and serves the leaderboard', async () => {
    const pre = await colyseus.http.put('/api/leaderboard').catch((e: { statusCode: number }) => e);
    expect(pre.statusCode).not.toBe(500);
    const res = await colyseus.http.get('/api/leaderboard?limit=5');
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.data as LeaderboardResponse).toHaveProperty('entries');
  });

  it('rate-limits profile creation per address', async () => {
    const max = CREATE_LIMIT.max;
    CREATE_LIMIT.max = 0;
    try {
      await expect(colyseus.http.post('/api/profiles', { body: '{}' })).rejects.toMatchObject({ statusCode: 429 });
    } finally {
      CREATE_LIMIT.max = max;
    }
  });
});

describe('battles with profiles', () => {
  it('a profile joins under its own name and trophies; a bad credential is refused', async () => {
    const { profile, credential } = await newProfile('Lt. Surge');
    const a = await colyseus.sdk.create(ROOM_NAME, { starters: RED, credential, name: 'ignored', private: true });
    const room = colyseus.getRoomById<BattleRoom>(a.roomId);
    expect(room.state.players.get(a.sessionId)!.toJSON()).toMatchObject({ name: 'Lt. Surge', profileId: profile.id, trophies: 0, bot: false });
    expect(room.state.mode).toBe('friendly');
    await expect(colyseus.sdk.joinById(a.roomId, { starters: BLUE, credential: `${profile.id}.${'y'.repeat(32)}` })).rejects.toThrow(/not recognised/);
  });

  it('a public room cannot be made ranked by the client', async () => {
    const a = await colyseus.sdk.joinOrCreate(ROOM_NAME, { starters: RED, ranked: true, internalKey: 'guess' });
    expect(colyseus.getRoomById<BattleRoom>(a.roomId).state.mode).toBe('casual');
  });
});

describe('ranked queue', () => {
  it('pairs two trainers into a ranked battle and records the result', async () => {
    const ash = await newProfile('Ash');
    const gary = await newProfile('Gary');
    const qa = await queueFor(ash.credential, RED);
    const qb = await queueFor(gary.credential, BLUE);
    const [seatA, seatB] = await Promise.all([qa.seat, qb.seat]);
    expect(seatA.mode).toBe('ranked');
    const a = await sit(seatA);
    const b = await sit(seatB);
    expect(b.room.roomId).toBe(a.room.roomId);
    const room = colyseus.getRoomById<BattleRoom>(a.room.roomId);
    await vi.waitFor(() => expect(room.state.phase).toBe('countdown'));
    expect(room.state.mode).toBe('ranked');
    // Ranked rooms are invisible to quick join.
    const stranger = await colyseus.sdk.joinOrCreate(ROOM_NAME, { starters: RED });
    expect(stranger.roomId).not.toBe(room.roomId);

    const ashTeam = room.state.players.get(a.room.sessionId)!.team as Team;
    knockOut(room, (1 - ashTeam) as Team);
    const summary = await a.summary;
    expect(summary.mode).toBe('ranked');
    expect(summary.teams[ashTeam]).toMatchObject({ trophies: 30, delta: 30 });
    expect(summary.teams[ashTeam].stats.towerDamage).toBeGreaterThan(0);
    expect((await store.get(ash.profile.id))).toMatchObject({ trophies: 30, wins: 1, rank: 1 });
    expect((await store.get(gary.profile.id))).toMatchObject({ losses: 1, rank: 2 });

    const board = (await colyseus.http.get('/api/leaderboard')).data as LeaderboardResponse;
    expect(board.entries[0]).toMatchObject({ id: ash.profile.id, trophies: 30, wins: 1, rank: 1 });
    const history = (await colyseus.http.get(`/api/profiles/${gary.profile.id}`)).data as ProfileResponse;
    expect(history.matches[0]).toMatchObject({ mode: 'ranked', outcome: 'loss', opponent: { id: ash.profile.id, name: 'Ash' } });
  });

  it('a forfeit counts as a ranked loss', async () => {
    const a = await newProfile('Koga');
    const b = await newProfile('Sabrina');
    const [qa, qb] = [await queueFor(a.credential), await queueFor(b.credential, BLUE)];
    const sa = await sit(await qa.seat);
    await sit(await qb.seat);
    const room = colyseus.getRoomById<BattleRoom>(sa.room.roomId);
    await vi.waitFor(() => expect(room.state.phase).toBe('countdown'));
    await sa.room.leave();
    await vi.waitFor(async () => expect((await store.get(a.profile.id))!.losses).toBe(1));
    expect((await store.get(b.profile.id))!.wins).toBe(1);
  });

  it('two tabs on one profile still get a battle, but it is unrated', async () => {
    const me = await newProfile('Twin');
    const q1 = await queueFor(me.credential);
    const q2 = await queueFor(me.credential, BLUE);
    const a = await sit(await q1.seat);
    await sit(await q2.seat);
    const room = colyseus.getRoomById<BattleRoom>(a.room.roomId);
    await vi.waitFor(() => expect(room.state.phase).toBe('countdown'));
    expect(room.state.mode).toBe('casual');
    knockOut(room, 1);
    expect((await a.summary).teams[0].delta).toBe(0);
    expect((await store.get(me.profile.id))).toMatchObject({ trophies: 0, wins: 0, battles: 2 });
  });

  it('reports progress while searching, and sends a bot after the wait', async () => {
    QueueRoom.botAfterSeconds = 1.5;
    const me = await newProfile('Lonely');
    const q = await queueFor(me.credential);
    await vi.waitFor(() => expect(q.status.length).toBeGreaterThan(0));
    expect(q.status[0]).toMatchObject({ searching: 1, range: 100 });
    expect(q.status[0]!.botIn).toBeGreaterThan(0);
    const seat = await q.seat;
    expect(seat.mode).toBe('training');
    const { room: client } = await sit(seat);
    const room = colyseus.getRoomById<BattleRoom>(client.roomId);
    await vi.waitFor(() => expect(room.state.phase).toBe('countdown'));
    const players = [...room.state.players.values()].map((p) => p.toJSON());
    expect(players.find((p) => p.bot)).toMatchObject({ connected: true, profileId: '', name: expect.stringMatching(/\(bot\)$/) });
    expect(room.state.mode).toBe('training');
  });

  it('needs a profile', async () => {
    await expect(colyseus.sdk.joinOrCreate(QUEUE_ROOM_NAME, { starters: RED })).rejects.toThrow(/profile/);
    await expect(colyseus.sdk.joinOrCreate(QUEUE_ROOM_NAME, { starters: RED, credential: 'nope' })).rejects.toThrow(/profile/);
  });

  it('if the opponent never takes their seat, the bot does', async () => {
    BattleRoom.partnerSeconds = 0.5;
    const a = await newProfile('Present');
    const b = await newProfile('Absent');
    const qa = await queueFor(a.credential);
    const qb = await queueFor(b.credential, BLUE);
    await qb.seat; // never consumed
    const { room: client } = await sit(await qa.seat);
    const room = colyseus.getRoomById<BattleRoom>(client.roomId);
    await vi.waitFor(() => expect(room.state.mode).toBe('training'), { timeout: 3000 });
    await vi.waitFor(() => expect(room.state.phase).toBe('countdown'));
    await expect(colyseus.sdk.consumeSeatReservation((await qb.seat).reservation as never)).rejects.toThrow();
  });
});

describe('training', () => {
  it('the bot plays its cards and the battle can be rematched', async () => {
    const me = await newProfile('Trainee');
    const client = await colyseus.sdk.create(ROOM_NAME, { starters: RED, credential: me.credential, training: true });
    client.onMessage(MSG.hand, () => undefined);
    client.onMessage(MSG.fx, () => undefined);
    client.onMessage(MSG.rematchState, () => undefined);
    const summary = new Promise<SummaryMessage>((resolve) => client.onMessage(MSG.summary, resolve));
    const room = colyseus.getRoomById<BattleRoom>(client.roomId);
    await vi.waitFor(() => expect(room.state.phase).toBe('countdown'));
    room.setSimulationInterval();
    const match = matchOf(room);
    // Training is the quick format: weaker towers, a 2:00 clock.
    expect(match.rules).toBe(QUICK_RULES);
    expect(match.entities.filter((e) => e.kind === 'king').map((e) => e.maxHp)).toEqual([2400, 2400]);
    expect(match.entities.filter((e) => e.kind === 'princess').every((e) => e.maxHp === 1500 && e.hp === 1500)).toBe(true);
    expect(room.state.entities.get(match.entities.find((e) => e.kind === 'king')!.id)!.maxHp).toBe(2400);
    match.phase = 'regular';
    match.timeLeft = 120;
    match.players[1].elixir = 10;
    for (let i = 0; i < 200 && !match.entities.some((e) => e.team === 1 && e.kind === 'unit'); i++) room['tick'](0.05);
    expect(match.entities.some((e) => e.team === 1 && e.kind === 'unit')).toBe(true);
    expect(room['stats'][1].cardsPlayed).toBeGreaterThan(0);

    knockOut(room, 1);
    expect((await summary).mode).toBe('training');
    expect((await store.get(me.profile.id))).toMatchObject({ trophies: 0, battles: 1 });

    const rematch = new Promise<RematchMessage>((resolve) => client.onMessage(MSG.rematch, resolve));
    client.send(MSG.rematch);
    const next = await colyseus.sdk.consumeSeatReservation((await rematch).reservation as never);
    const nextRoom = colyseus.getRoomById<BattleRoom>(next.roomId);
    expect(next.roomId).not.toBe(client.roomId);
    await vi.waitFor(() => expect(nextRoom.state.phase).toBe('countdown'));
    expect(nextRoom.state.mode).toBe('training');
    expect(nextRoom.state.players.get(next.sessionId)!.toJSON()).toMatchObject({ name: 'Trainee', profileId: me.profile.id });
  });

  it('bot decks are legal', async () => {
    for (const d of BOT_DECKS) expect(isDeck([...d])).toBe(true);
  });
});

describe('rematch', () => {
  async function friendly() {
    const a = await colyseus.sdk.create(ROOM_NAME, { starters: RED, private: true, name: 'Host' });
    const b = await colyseus.sdk.joinById(a.roomId, { starters: BLUE, name: 'Guest' });
    const states: Record<string, RematchStateMessage[]> = { a: [], b: [] };
    for (const [k, r] of [['a', a], ['b', b]] as Array<[string, ClientRoom]>) {
      r.onMessage(MSG.hand, () => undefined);
      r.onMessage(MSG.fx, () => undefined);
      r.onMessage(MSG.summary, () => undefined);
      r.onMessage(MSG.rematchState, (m: RematchStateMessage) => states[k]!.push(m));
    }
    const room = colyseus.getRoomById<BattleRoom>(a.roomId);
    await vi.waitFor(() => expect(room.state.phase).toBe('countdown'));
    knockOut(room, 1);
    return { a, b, room, states };
  }

  it('starts a new friendly once both trainers ask', async () => {
    const { a, b, states } = await friendly();
    const ra = new Promise<RematchMessage>((resolve) => a.onMessage(MSG.rematch, resolve));
    const rb = new Promise<RematchMessage>((resolve) => b.onMessage(MSG.rematch, resolve));
    a.send(MSG.rematch);
    await vi.waitFor(() => expect(states.b!.at(-1)).toEqual({ requested: [true, false], open: true }));
    b.send(MSG.rematch);
    const [na, nb] = await Promise.all([
      ra.then((m) => colyseus.sdk.consumeSeatReservation(m.reservation as never)),
      rb.then((m) => colyseus.sdk.consumeSeatReservation(m.reservation as never)),
    ]);
    expect(na.roomId).toBe(nb.roomId);
    const next = colyseus.getRoomById<BattleRoom>(na.roomId);
    await vi.waitFor(() => expect(next.state.phase).toBe('countdown'));
    expect(next.state.mode).toBe('friendly');
    expect([...next.state.players.values()].map((p) => p.name).sort()).toEqual(['Guest', 'Host']);
  });

  it('closes once the rival leaves', async () => {
    const { a, b, states } = await friendly();
    a.send(MSG.rematch);
    await b.leave();
    await vi.waitFor(() => expect(states.a!.at(-1)).toEqual({ requested: [true, false], open: false }));
  });
});

describe('fx', () => {
  it('each step’s events are broadcast once and then cleared', async () => {
    const a = await colyseus.sdk.create(ROOM_NAME, { starters: RED, training: true });
    a.onMessage(MSG.hand, () => undefined);
    a.onMessage(MSG.fx, () => undefined);
    const room = colyseus.getRoomById<BattleRoom>(a.roomId);
    await vi.waitFor(() => expect(room.state.phase).toBe('countdown'));
    room.setSimulationInterval();
    matchOf(room).phase = 'regular';
    room['tick'](0.05);
    expect(matchOf(room).events).toEqual([]);
  });
});
