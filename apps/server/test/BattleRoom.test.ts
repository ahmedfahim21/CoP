import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { CARDS, CARD_IDS, MSG, ROOM_NAME, playCard, type HandMessage, type MatchState, type StarterPick } from '@cop/shared';
import { createAppServer } from '../src/app.js';
import { BattleRoom } from '../src/BattleRoom.js';
import type { FetchFn } from '../src/sprites.js';
import { ProfileStore } from '../src/store.js';

const RED: StarterPick = ['bulbasaur', 'charmander'];
const BLUE: StarterPick = ['squirtle', 'charmander'];
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

const fetchFn = vi.fn<FetchFn>();
let colyseus: ColyseusTestServer;

beforeAll(async () => {
  colyseus = await boot(createAppServer({ fetchFn, store: new ProfileStore(':memory:') }));
});
afterAll(async () => {
  await colyseus.shutdown();
});
afterEach(async () => {
  BattleRoom.reconnectSeconds = 20;
  fetchFn.mockReset();
  await colyseus.cleanup();
});

/** Reaches into the room for its simulation; only tests do this. */
function matchOf(room: BattleRoom): MatchState {
  return room['match']!;
}

async function startMatch() {
  const handA = { value: null as HandMessage | null };
  const handB = { value: null as HandMessage | null };
  const a = await colyseus.sdk.joinOrCreate(ROOM_NAME, { starters: RED, name: '  Ash\u0007 Ketchum of Pallet Town ' });
  a.onMessage(MSG.hand, (m: HandMessage) => (handA.value = m));
  const b = await colyseus.sdk.joinOrCreate(ROOM_NAME, { starters: BLUE });
  b.onMessage(MSG.hand, (m: HandMessage) => (handB.value = m));
  const room = colyseus.getRoomById<BattleRoom>(a.roomId);
  await vi.waitFor(() => expect(handA.value && handB.value).toBeTruthy());
  return { a, b, room, handA, handB };
}

/** Skip the countdown and freeze the clock so state only changes through commands. */
function freezeInPlay(room: BattleRoom) {
  room.setSimulationInterval();
  const match = matchOf(room);
  match.phase = 'regular';
  match.timeLeft = 180;
  room.state.phase = 'regular';
}

function snapshot(room: BattleRoom) {
  return structuredClone(room.state.toJSON());
}

describe('matchmaking', () => {
  it('quick match pairs two players into one room and starts the countdown', async () => {
    const { a, b, room, handA, handB } = await startMatch();
    expect(b.roomId).toBe(a.roomId);
    expect(room.locked).toBe(true);

    const state = room.state.toJSON();
    expect(state.phase).toBe('countdown');
    expect(state.winner).toBe(-1);
    expect(state.resultReason).toBe('');
    expect(state.players[a.sessionId]).toEqual({
      sessionId: a.sessionId, name: 'Ash Ketchum of P', team: 0, elixir: 5, crowns: 0, starterLeft: 'bulbasaur', starterRight: 'charmander', connected: true,
      trophies: 0, profileId: '', bot: false,
    });
    expect(state.players[b.sessionId]).toEqual({
      sessionId: b.sessionId, name: 'Trainer', team: 1, elixir: 5, crowns: 0, starterLeft: 'squirtle', starterRight: 'charmander', connected: true,
      trophies: 0, profileId: '', bot: false,
    });
    const towers = Object.values(state.entities);
    expect(towers).toHaveLength(6);
    expect(towers.filter((t) => t.kind === 'princess').map((t) => `${t.team}:${t.defId}`).sort())
      .toEqual(['0:bulbasaur', '0:charmander', '1:charmander', '1:squirtle']);

    const match = matchOf(room);
    expect(handA.value).toEqual({ hand: match.players[0].hand, next: match.players[0].queue[0] });
    expect(handB.value).toEqual({ hand: match.players[1].hand, next: match.players[1].queue[0] });
  });

  it('private rooms are skipped by quick match but joinable by code', async () => {
    const host = await colyseus.sdk.create(ROOM_NAME, { starters: RED, private: true });
    const stranger = await colyseus.sdk.joinOrCreate(ROOM_NAME, { starters: BLUE });
    expect(stranger.roomId).not.toBe(host.roomId);

    const friend = await colyseus.sdk.joinById(host.roomId, { starters: BLUE });
    expect(friend.roomId).toBe(host.roomId);
    await vi.waitFor(() => expect(colyseus.getRoomById<BattleRoom>(host.roomId).state.phase).toBe('countdown'));
  });

  it('rejects a third player and invalid starter picks', async () => {
    const { a } = await startMatch();
    await expect(colyseus.sdk.joinById(a.roomId, { starters: RED })).rejects.toThrow();
    await expect(colyseus.sdk.joinOrCreate(ROOM_NAME, { starters: ['bulbasaur', 'bulbasaur'] })).rejects.toThrow(/starters/);
    await expect(colyseus.sdk.joinOrCreate(ROOM_NAME, {})).rejects.toThrow(/starters/);
  });

  it('deals each player from their own deck, and rejects bad decks', async () => {
    const deckA = ['magikarp', 'geodude', 'dugtrio', 'gengar', 'chansey', 'scyther', 'jolteon', 'rapidash'] as const;
    const a = await colyseus.sdk.create(ROOM_NAME, { starters: RED, deck: [...deckA], private: true });
    const handA = { value: null as HandMessage | null };
    a.onMessage(MSG.hand, (m: HandMessage) => (handA.value = m));
    const b = await colyseus.sdk.joinById(a.roomId, { starters: BLUE });
    b.onMessage(MSG.hand, () => undefined);
    const room = colyseus.getRoomById<BattleRoom>(a.roomId);
    await vi.waitFor(() => expect(handA.value).not.toBeNull());
    const match = matchOf(room);
    expect(new Set([...match.players[0].hand, ...match.players[0].queue])).toEqual(new Set(deckA));
    expect(new Set([...match.players[1].hand, ...match.players[1].queue])).toEqual(new Set(CARD_IDS.slice(0, 8)));
    expect(new Set([...handA.value!.hand, handA.value!.next]).size).toBe(5);
    for (const c of [...handA.value!.hand, handA.value!.next]) expect(deckA).toContain(c);

    await expect(colyseus.sdk.joinOrCreate(ROOM_NAME, { starters: RED, deck: ['pikachu'] })).rejects.toThrow(/eight different cards/);
    await expect(colyseus.sdk.joinOrCreate(ROOM_NAME, { starters: RED, deck: [...deckA.slice(0, 7), 'magikarp'] })).rejects.toThrow(/eight different cards/);
  });

  it('frees the seat if the waiting player leaves before the match starts', async () => {
    const solo = await colyseus.sdk.create(ROOM_NAME, { starters: RED, private: true });
    const room = colyseus.getRoomById<BattleRoom>(solo.roomId);
    expect(room.state.players.size).toBe(1);
    await solo.leave();
    await vi.waitFor(() => expect(room.state.players.size).toBe(0));
    expect(room.state.phase).toBe('waiting');
    expect(room.state.resultReason).toBe('');
  });
});

describe('play', () => {
  it('a valid play spends exactly the cost, spawns the units and changes nothing else', async () => {
    const { a, room, handA } = await startMatch();
    freezeInPlay(room);
    const match = matchOf(room);
    match.players[0].elixir = 10;
    room['syncState']();
    const before = snapshot(room);
    const card = match.players[0].hand[1]!;
    const expectedNext = match.players[0].queue[0]!;
    const handBefore = handA.value;

    a.send(MSG.play, { slot: 1, x: 9, y: 22 });
    await vi.waitFor(() => expect(handA.value).not.toBe(handBefore));

    const after = snapshot(room);
    const def = CARDS[card];
    expect(after.players[a.sessionId]).toEqual({ ...before.players[a.sessionId], elixir: 10 - def.cost });
    const others = Object.keys(before.players).filter((k) => k !== a.sessionId);
    for (const k of others) expect(after.players[k]).toEqual(before.players[k]);

    const spawned = Object.values(after.entities).filter((e) => !(e.id in before.entities));
    expect(spawned).toHaveLength(def.count);
    for (const u of spawned) {
      expect(u).toMatchObject({ team: 0, kind: 'unit', defId: card, hp: def.stats.hp, maxHp: def.stats.hp, deploying: true, active: true });
      expect(u.y).toBeGreaterThan(20);
    }
    for (const [id, e] of Object.entries(before.entities)) expect(after.entities[id]).toEqual(e);
    const { entities: _ae, players: _ap, ...restAfter } = after;
    const { entities: _be, players: _bp, ...restBefore } = before;
    expect(restAfter).toEqual(restBefore);

    expect(handA.value!.hand[1]).toBe(expectedNext);
    expect(handA.value).toEqual({ hand: match.players[0].hand, next: match.players[0].queue[0] });
  });

  it('team 1 plays in its own perspective', async () => {
    const { b, room, handB } = await startMatch();
    freezeInPlay(room);
    matchOf(room).players[1].elixir = 10;
    const before = handB.value;
    b.send(MSG.play, { slot: 0, x: 9, y: 22 });
    await vi.waitFor(() => expect(handB.value).not.toBe(before));
    const units = [...room.state.entities.values()].filter((e) => e.kind === 'unit');
    expect(units.length).toBeGreaterThan(0);
    for (const u of units) {
      expect(u.team).toBe(1);
      expect(u.y).toBeLessThan(12);
    }
  });

  it.each([
    ['bad-position', { slot: 0, x: 9, y: 10 }],
    ['bad-slot', { slot: 7, x: 9, y: 22 }],
    ['bad-message', { slot: '0', x: 9, y: 22 }],
    ['bad-message', null],
  ])('rejects %s with an error and no state change', async (error, message) => {
    const { a, room } = await startMatch();
    freezeInPlay(room);
    // Enough for any card, so the hand's random order can't trip the elixir check first.
    matchOf(room).players[0].elixir = 10;
    room['syncState']();
    const before = snapshot(room);
    const reply = a.waitForMessage(MSG.error);
    a.send(MSG.play, message);
    expect(await reply).toEqual({ error });
    expect(snapshot(room)).toEqual(before);
  });

  it('syncs projectiles with their source and target', async () => {
    const { room } = await startMatch();
    freezeInPlay(room);
    const match = matchOf(room);
    match.players[1].elixir = 10;
    const played = playCard(match, 1, 0, { x: 9, y: 20 });
    if (!played.ok) throw new Error(played.error);
    // Park the unit in front of team 0's left tower (Bulbasaur) so the tower opens fire.
    const unit = played.units[0]!;
    Object.assign(unit, { x: 3.5, y: 20.5, deployTimer: 5 });
    for (let i = 0; i < 40 && room.state.projectiles.size === 0; i++) room['tick'](0.05);
    const shots = [...room.state.projectiles.values()].map((p) => p.toJSON());
    expect(shots).toHaveLength(1);
    expect(shots[0]).toMatchObject({ team: 0, sourceDefId: 'bulbasaur', targetId: unit.id });
    expect(typeof shots[0]!.x).toBe('number');
  });

  it('syncs ability state: a digging Dugtrio is hidden until it surfaces', async () => {
    const { a, room, handA } = await startMatch();
    freezeInPlay(room);
    const match = matchOf(room);
    match.players[0].hand[0] = 'dugtrio';
    match.players[0].elixir = 10;
    const before = handA.value;
    a.send(MSG.play, { slot: 0, x: 4, y: 8 });
    await vi.waitFor(() => expect(handA.value).not.toBe(before));
    const dug = [...room.state.entities.values()].find((e) => e.defId === 'dugtrio')!;
    expect(dug.toJSON()).toMatchObject({ team: 0, hidden: true, deploying: true, stunned: false, slowed: false, charging: false });
    for (let i = 0; i < 40; i++) room['tick'](0.05);
    expect(room.state.entities.get(dug.id)!.hidden).toBe(false);
  });

  it('syncs evolution in place: same id, new species and health', async () => {
    const { room } = await startMatch();
    freezeInPlay(room);
    const match = matchOf(room);
    match.players[0].elixir = 10;
    match.players[0].hand[0] = 'magikarp';
    const played = playCard(match, 0, 0, { x: 9, y: 28 });
    if (!played.ok) throw new Error(played.error);
    const id = played.units[0]!.id;
    room['syncState']();
    expect(room.state.entities.get(id)!.defId).toBe('magikarp');
    played.units[0]!.abilityTimer = 0.01;
    played.units[0]!.deployTimer = 0;
    room['tick'](0.05);
    expect(room.state.entities.get(id)!.toJSON()).toMatchObject({ id, defId: 'gyarados', hp: 2200, maxHp: 2200 });
  });

  it('syncs Barrier and poison clouds', async () => {
    const { room } = await startMatch();
    freezeInPlay(room);
    const match = matchOf(room);
    match.players[0].elixir = 10;
    match.players[0].hand[0] = 'mrmime';
    const mime = playCard(match, 0, 0, { x: 9, y: 28 });
    if (!mime.ok) throw new Error(mime.error);
    match.players[0].elixir = 10;
    match.players[0].hand[0] = 'koffing';
    const koffing = playCard(match, 0, 0, { x: 5, y: 28 });
    if (!koffing.ok) throw new Error(koffing.error);
    room['syncState']();
    expect(room.state.entities.get(mime.units[0]!.id)!.shield).toBe(450);
    koffing.units[0]!.hp = 0;
    room['tick'](0.05);
    const zones = [...room.state.zones.values()].map((z) => z.toJSON());
    expect(zones).toHaveLength(1);
    expect(zones[0]).toMatchObject({ team: 0, radius: 2.5 });
    expect(zones[0]!.x).toBeCloseTo(koffing.units[0]!.x, 3);
    for (let i = 0; i < 90; i++) room['tick'](0.05);
    expect(room.state.zones.size).toBe(0);
  });

  it('rejects plays without enough elixir', async () => {
    const { a, room } = await startMatch();
    freezeInPlay(room);
    matchOf(room).players[0].elixir = 0;
    room['syncState']();
    const before = snapshot(room);
    const reply = a.waitForMessage(MSG.error);
    a.send(MSG.play, { slot: 0, x: 9, y: 22 });
    expect(await reply).toEqual({ error: 'not-enough-elixir' });
    expect(snapshot(room)).toEqual(before);
  });

  it('rejects plays before the opponent arrives', async () => {
    const a = await colyseus.sdk.create(ROOM_NAME, { starters: RED, private: true });
    const reply = a.waitForMessage(MSG.error);
    a.send(MSG.play, { slot: 0, x: 9, y: 22 });
    expect(await reply).toEqual({ error: 'not-playing' });
  });

  it('only the player who played receives their new hand', async () => {
    const { a, room, handA, handB } = await startMatch();
    freezeInPlay(room);
    matchOf(room).players[0].elixir = 10;
    const bHand = handB.value;
    const aHand = handA.value;
    a.send(MSG.play, { slot: 0, x: 9, y: 22 });
    await vi.waitFor(() => expect(handA.value).not.toBe(aHand));
    await room.waitForNextPatch();
    expect(handB.value).toBe(bHand);
  });
});

describe('disconnects', () => {
  it('a dropped player is marked disconnected and forfeits when the window expires', async () => {
    BattleRoom.reconnectSeconds = 0.3;
    const { a, b, room } = await startMatch();
    await a.leave(false);
    await vi.waitFor(() => expect(room.state.players.get(a.sessionId)!.connected).toBe(false));
    expect(room.state.resultReason).toBe('');
    await vi.waitFor(() => expect(room.state.resultReason).toBe('forfeit'), { timeout: 2000 });
    expect(room.state.phase).toBe('ended');
    expect(room.state.winner).toBe(room.state.players.get(b.sessionId)!.team);
  });

  it('leaving on purpose forfeits immediately', async () => {
    const { a, b, room } = await startMatch();
    await b.leave();
    await vi.waitFor(() => expect(room.state.resultReason).toBe('forfeit'));
    expect(room.state.winner).toBe(room.state.players.get(a.sessionId)!.team);
  });
});

describe('trainer sprite proxy', () => {
  const ok = () => ({ ok: true, status: 200, arrayBuffer: async () => PNG.buffer.slice(0) as ArrayBuffer });

  it('relays the PNG with CORS headers and caches it', async () => {
    fetchFn.mockImplementation(async () => ok());
    for (let i = 0; i < 2; i++) {
      const res = await colyseus.http.get('/sprites/trainer/red');
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('image/png');
      expect(res.headers['access-control-allow-origin']).toBe('*');
    }
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledWith('https://play.pokemonshowdown.com/sprites/trainers/red.png');
  });

  it('404s unknown trainers without calling upstream', async () => {
    fetchFn.mockImplementation(async () => ok());
    await expect(colyseus.http.get('/sprites/trainer/giovanni')).rejects.toMatchObject({ statusCode: 404 });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('502s on upstream failure and retries on the next request', async () => {
    fetchFn.mockImplementationOnce(async () => ({ ok: false, status: 500, arrayBuffer: async () => new ArrayBuffer(0) }));
    fetchFn.mockImplementationOnce(async () => ok());
    await expect(colyseus.http.get('/sprites/trainer/blue')).rejects.toMatchObject({ statusCode: 502 });
    const res = await colyseus.http.get('/sprites/trainer/blue');
    expect(res.statusCode).toBe(200);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});
