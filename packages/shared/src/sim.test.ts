import { describe, expect, it } from 'vitest';
import { inRiver, mirror, onBridgeColumn, type Team } from './arena.js';
import { CARDS } from './cards.js';
import {
  COUNTDOWN_SECONDS, ELIXIR_MAX, ELIXIR_START, OVERTIME_SECONDS, REGULAR_SECONDS,
  canTarget, createMatch, forfeit, openPockets, playCard, step,
} from './sim.js';
import { DT, PICKS, onlyUnits, runUntil, spawn, started, tower } from './testing.js';

describe('createMatch', () => {
  it('sets up towers, hands and elixir for both players', () => {
    const s = createMatch(PICKS, 42);
    expect(s.phase).toBe('countdown');
    expect(s.timeLeft).toBe(COUNTDOWN_SECONDS);
    expect(s.result).toBeNull();
    expect(s.projectiles).toEqual([]);
    expect(s.entities).toHaveLength(6);

    for (const team of [0, 1] as const) {
      const p = s.players[team];
      expect(p.elixir).toBe(ELIXIR_START);
      expect(p.crowns).toBe(0);
      expect(p.starters).toEqual(PICKS[team]);
      expect(p.hand).toHaveLength(4);
      expect(p.queue).toHaveLength(4);
      expect(new Set([...p.hand, ...p.queue]).size).toBe(8);

      const king = tower(s, team, 'king');
      expect(king).toMatchObject({ defId: 'trainer', hp: 4000, maxHp: 4000, active: false, deployTimer: 0, targetId: null, lane: null });
      expect({ x: king.x, y: king.y }).toEqual(mirror(team, { x: 9, y: 29 }));
      const left = tower(s, team, 'princess', 'left');
      const right = tower(s, team, 'princess', 'right');
      expect(left).toMatchObject({ defId: PICKS[team][0], hp: 2500, active: true });
      expect(right).toMatchObject({ defId: PICKS[team][1], hp: 2500, active: true });
      // Each player's "left" is on their own left: team 1's is at world x 14.5.
      expect(left.x).toBe(team === 0 ? 3.5 : 14.5);
    }
  });

  it('is deterministic for a seed', () => {
    expect(createMatch(PICKS, 7)).toEqual(createMatch(PICKS, 7));
  });
});

describe('phases and elixir', () => {
  it('counts down without generating elixir, then starts the clock', () => {
    const s = createMatch(PICKS, 1);
    step(s, COUNTDOWN_SECONDS - 1);
    expect(s.phase).toBe('countdown');
    step(s, 1);
    expect(s.phase).toBe('regular');
    expect(s.timeLeft).toBe(REGULAR_SECONDS);
    expect(s.players[0].elixir).toBe(ELIXIR_START);
  });

  it('regenerates 1 elixir per 2.8s, doubles in the last minute, caps at 10', () => {
    const s = started();
    for (let i = 0; i < 56; i++) step(s, DT);
    expect(s.players[0].elixir).toBeCloseTo(ELIXIR_START + 1, 5);
    expect(s.players[1].elixir).toBeCloseTo(ELIXIR_START + 1, 5);

    s.timeLeft = 60;
    s.players[0].elixir = 0;
    for (let i = 0; i < 56; i++) step(s, DT);
    expect(s.players[0].elixir).toBeCloseTo(2, 5);

    s.players[0].elixir = 9.99;
    step(s, 1);
    expect(s.players[0].elixir).toBe(ELIXIR_MAX);
  });
});

describe('playCard', () => {
  it('rejects plays before the match starts and leaves state untouched', () => {
    const s = createMatch(PICKS, 1);
    const before = structuredClone(s);
    expect(playCard(s, 0, 0, { x: 9, y: 20 })).toEqual({ ok: false, error: 'not-playing' });
    expect(s).toEqual(before);
  });

  it.each([
    ['bad-slot', 4, { x: 9, y: 20 }, 10],
    ['bad-slot', 1.5, { x: 9, y: 20 }, 10],
    ['not-enough-elixir', 0, { x: 9, y: 20 }, 0],
    ['bad-position', 0, { x: 9, y: 12 }, 10],
    ['bad-position', 0, { x: Number.NaN, y: 20 }, 10],
    ['bad-position', 0, { x: 9, y: 31.9 }, 10],
  ] as const)('rejects %s (slot %s at %o) without changing state', (error, slot, at, elixir) => {
    const s = started();
    s.players[0].elixir = elixir;
    const before = structuredClone(s);
    expect(playCard(s, 0, slot, at)).toEqual({ ok: false, error });
    expect(s).toEqual(before);
  });

  it('spends elixir, cycles the hand and spawns units in world coords — and nothing else', () => {
    const s = started();
    const team = 1;
    s.players[team].elixir = 10;
    const before = structuredClone(s);
    const card = s.players[team].hand[2]!;
    const next = s.players[team].queue[0]!;

    const r = playCard(s, team, 2, { x: 4, y: 22 });
    if (!r.ok) throw new Error(r.error);

    const def = CARDS[card];
    expect(s.players[team].elixir).toBe(10 - def.cost);
    expect(s.players[team].hand).toEqual(before.players[team].hand.map((c, i) => (i === 2 ? next : c)));
    expect(s.players[team].queue).toEqual([...before.players[team].queue.slice(1), card]);
    expect(r.units).toHaveLength(def.count);
    for (const u of r.units) {
      expect(u).toMatchObject({ team, kind: 'unit', defId: card, hp: def.stats.hp, maxHp: def.stats.hp, deployTimer: 1, targetId: null });
      // Team 1 plays from its own perspective, which is the rotated world.
      expect(u.y).toBeLessThan(16);
    }
    const centroid = r.units.reduce((a, u) => ({ x: a.x + u.x / r.units.length, y: a.y + u.y / r.units.length }), { x: 0, y: 0 });
    expect(centroid.x).toBeCloseTo(18 - 4, 1);
    expect(centroid.y).toBeCloseTo(32 - 22, 1);
    expect(s.events).toEqual([{ type: 'spawn', team, cardId: card, x: 14, y: 10 }]);

    // Only the playing player's fields and the entity list changed.
    expect(s.players[0]).toEqual(before.players[0]);
    expect(s.players[team].crowns).toBe(before.players[team].crowns);
    expect(s.players[team].starters).toEqual(before.players[team].starters);
    expect(s.entities.slice(0, before.entities.length)).toEqual(before.entities);
    expect(s.projectiles).toEqual(before.projectiles);
    expect({ phase: s.phase, timeLeft: s.timeLeft, result: s.result }).toEqual({ phase: before.phase, timeLeft: before.timeLeft, result: before.result });
  });

  it('opens the pocket in a lane once the enemy princess tower there falls', () => {
    const s = started();
    s.players[0].elixir = 10;
    expect(openPockets(s, 0).size).toBe(0);
    expect(playCard(s, 0, 0, { x: 3, y: 12 })).toEqual({ ok: false, error: 'bad-position' });

    // Team 1's right tower sits on team 0's left (world x 3.5).
    tower(s, 1, 'princess', 'right').hp = 0;
    step(s, DT);
    expect([...openPockets(s, 0)]).toEqual(['left']);
    expect(playCard(s, 0, 0, { x: 3, y: 12 }).ok).toBe(true);
    s.players[0].elixir = 10;
    expect(playCard(s, 0, 0, { x: 15, y: 12 })).toEqual({ ok: false, error: 'bad-position' });
  });
});

describe('targeting', () => {
  it('respects ground / air / buildings-only target classes', () => {
    const s = started();
    const [snorlax] = spawn(s, 0, 'snorlax', { x: 9, y: 20 });
    const [rattata] = spawn(s, 0, 'rattata', { x: 5, y: 20 });
    const [pikachu] = spawn(s, 0, 'pikachu', { x: 12, y: 20 });
    const [zubat] = spawn(s, 1, 'zubat', { x: 9, y: 20 });
    const [machop] = spawn(s, 1, 'machop', { x: 5, y: 20 });
    const enemyTower = tower(s, 1, 'king');

    expect(canTarget(snorlax!, machop!)).toBe(false);
    expect(canTarget(snorlax!, enemyTower)).toBe(true);
    expect(canTarget(rattata!, zubat!)).toBe(false);
    expect(canTarget(rattata!, machop!)).toBe(true);
    expect(canTarget(pikachu!, zubat!)).toBe(true);
    expect(canTarget(pikachu!, snorlax!)).toBe(false); // same team
  });

  it('keeps the trainer dormant until hit', () => {
    const s = started();
    const king = tower(s, 1, 'king');
    const [rattata] = spawn(s, 0, 'rattata', { x: 9, y: 20 });
    s.entities = s.entities.filter((e) => e.kind !== 'unit' || e.id === rattata!.id);
    // Put the unit within the king's range but out of the princess towers' reach.
    Object.assign(rattata!, { x: 9, y: 9, deployTimer: 5 });
    s.entities = s.entities.filter((e) => e.kind !== 'princess' || e.team !== 1);
    step(s, 2);
    expect(king.active).toBe(false);
    expect(s.projectiles).toHaveLength(0);
  });
});

describe('movement', () => {
  it('ground units only cross the river on a bridge', () => {
    const s = started();
    const [machop] = spawn(s, 0, 'machop', { x: 9, y: 22 });
    let crossed = false;
    for (let t = 0; t < 30 && !crossed; t += DT) {
      step(s, DT);
      if (inRiver(machop!.y)) expect(onBridgeColumn(machop!.x)).toBe(true);
      crossed = machop!.y < 15;
    }
    expect(crossed).toBe(true);
  });

  it('flying units go straight over the river', () => {
    const s = started();
    const [zubat] = spawn(s, 0, 'zubat', { x: 9, y: 18 });
    let crossedAtX: number | null = null;
    for (let t = 0; t < 5 && crossedAtX === null; t += DT) {
      step(s, DT);
      if (zubat!.y < 16) crossedAtX = zubat!.x;
    }
    expect(crossedAtX).not.toBeNull();
    expect(onBridgeColumn(crossedAtX!)).toBe(false);
  });
});

describe('combat', () => {
  it('applies type effectiveness: Water Gun is super effective on Charizard', () => {
    const s = started();
    const [charizard] = spawn(s, 0, 'charizard', { x: 9, y: 20 });
    // Team 1's left tower (Squirtle) is at world (14.5, 6.5).
    s.entities = s.entities.filter((e) => !(e.team === 1 && e.lane === 'right'));
    Object.assign(charizard!, { x: 14.5, y: 11, deployTimer: 0 });
    const events = runUntil(s, (ev) => ev.some((e) => e.type === 'hit' && e.targetId === charizard!.id));
    expect(events.find((e) => e.type === 'hit' && e.targetId === charizard!.id)).toMatchObject({ damage: 135, effectiveness: 'super' });
  });

  it('splash damage hits every enemy in the radius', () => {
    const s = started();
    onlyUnits(s);
    const [charizard] = spawn(s, 0, 'charizard', { x: 9, y: 20 });
    const rats = spawn(s, 1, 'rattata', { x: 9, y: 22 });
    Object.assign(charizard!, { x: 9, y: 24, deployTimer: 0 });
    for (const [i, r] of rats.entries()) Object.assign(r, { x: 8.6 + (i % 2) * 0.8, y: 21.2 - Math.floor(i / 2) * 0.8, deployTimer: 5 });
    const events = runUntil(s, (ev) => ev.some((e) => e.type === 'hit'));
    const hits = events.filter((e) => e.type === 'hit');
    expect(hits).toHaveLength(4);
    // Flamethrower (fire) vs Normal is neutral.
    for (const h of hits) expect(h).toMatchObject({ damage: 140, effectiveness: 'neutral' });
  });

  it('announces every attack with attacker and target, before its hit', () => {
    const s = started();
    onlyUnits(s);
    const [machop] = spawn(s, 0, 'machop', { x: 9, y: 20 });
    const [rattata] = spawn(s, 1, 'rattata', { x: 9, y: 20 });
    s.entities = s.entities.filter((e) => e.kind !== 'unit' || e.id === machop!.id || e.id === rattata!.id);
    Object.assign(machop!, { x: 9, y: 20, deployTimer: 0 });
    Object.assign(rattata!, { x: 9, y: 21, deployTimer: 5 });
    const events = runUntil(s, (ev) => ev.some((e) => e.type === 'attack'));
    const attackAt = events.findIndex((e) => e.type === 'attack');
    expect(events[attackAt]).toEqual({ type: 'attack', id: machop!.id, targetId: rattata!.id });
    // Melee lands in the same step, after the announcement.
    expect(events.findIndex((e) => e.type === 'hit')).toBeGreaterThan(attackAt);
  });

  it('ranged attacks are announced when fired, hits arrive with the projectile', () => {
    const s = started();
    onlyUnits(s);
    const [pikachu] = spawn(s, 0, 'pikachu', { x: 9, y: 24 });
    const [machop] = spawn(s, 1, 'machop', { x: 9, y: 20 });
    Object.assign(pikachu!, { x: 9, y: 24, deployTimer: 0 });
    Object.assign(machop!, { x: 9, y: 20, deployTimer: 5 });
    const fired = runUntil(s, (ev) => ev.some((e) => e.type === 'attack'));
    expect(fired.some((e) => e.type === 'hit')).toBe(false);
    expect(s.projectiles).toHaveLength(1);
    runUntil(s, (ev) => ev.some((e) => e.type === 'hit'));
  });

  it('Voltorb self-destructs on its first attack', () => {
    const s = started();
    onlyUnits(s);
    const [voltorb] = spawn(s, 0, 'voltorb', { x: 9, y: 20 });
    const [machop] = spawn(s, 1, 'machop', { x: 9, y: 20 });
    Object.assign(voltorb!, { x: 9, y: 20, deployTimer: 0 });
    Object.assign(machop!, { x: 9, y: 21.3, deployTimer: 5 });
    const events = runUntil(s, (ev) => ev.some((e) => e.type === 'death'));
    expect(events.find((e) => e.type === 'death')).toMatchObject({ id: voltorb!.id });
    expect(machop!.hp).toBe(1400 - 400);
    expect(s.entities.some((e) => e.id === voltorb!.id)).toBe(false);
  });
});

describe('towers and results', () => {
  it('a fallen princess tower gives a crown and wakes the trainer', () => {
    const s = started();
    const t = tower(s, 1, 'princess', 'left');
    t.hp = 0;
    step(s, DT);
    expect(s.players[0].crowns).toBe(1);
    expect(s.players[1].crowns).toBe(0);
    expect(tower(s, 1, 'king').active).toBe(true);
    expect(s.entities.some((e) => e.id === t.id)).toBe(false);
    expect(s.events).toContainEqual(expect.objectContaining({ type: 'death', id: t.id, kind: 'princess', team: 1 }));
    expect(s.phase).toBe('regular');
  });

  it('a fallen trainer ends the match with three crowns', () => {
    const s = started();
    tower(s, 0, 'king').hp = 0;
    step(s, DT);
    expect(s.phase).toBe('ended');
    expect(s.result).toEqual({ winner: 1, reason: 'king' });
    expect(s.players[1].crowns).toBe(3);
    expect(s.entities.filter((e) => e.team === 0)).toHaveLength(0);
  });

  it('more crowns at full time wins', () => {
    const s = started();
    s.players[1].crowns = 1;
    s.timeLeft = DT / 2;
    step(s, DT);
    expect(s.result).toEqual({ winner: 1, reason: 'crowns' });
  });

  it('a tie goes to overtime, where the next crown wins', () => {
    const s = started();
    s.timeLeft = DT / 2;
    step(s, DT);
    expect(s.phase).toBe('overtime');
    expect(s.timeLeft).toBe(OVERTIME_SECONDS);
    tower(s, 0, 'princess', 'right').hp = 0;
    step(s, DT);
    expect(s.result).toEqual({ winner: 1, reason: 'crowns' });
  });

  it('overtime timeout: healthier weakest tower wins, otherwise draw', () => {
    const s = started();
    s.phase = 'overtime';
    s.timeLeft = DT / 2;
    tower(s, 1, 'princess', 'left').hp = 1000;
    step(s, DT);
    expect(s.result).toEqual({ winner: 0, reason: 'tiebreak' });

    const d = started();
    d.phase = 'overtime';
    d.timeLeft = DT / 2;
    step(d, DT);
    expect(d.result).toEqual({ winner: null, reason: 'draw' });
  });

  it('forfeit hands the win to the other side and freezes the match', () => {
    const s = started();
    forfeit(s, 0);
    expect(s.result).toEqual({ winner: 1, reason: 'forfeit' });
    const frozen = structuredClone(s);
    step(s, 1);
    expect(s).toEqual({ ...frozen, events: [] });
  });
});

describe('soak', () => {
  it.each([1, 2, 3, 4, 5])('random bot-vs-bot match %s finishes with a sane state', (seed) => {
    const s = createMatch(PICKS, seed);
    let rnd = seed * 9973;
    const rand = () => ((rnd = (rnd * 16807) % 2147483647) / 2147483647);
    let plays = 0;
    for (let t = 0; t < REGULAR_SECONDS + OVERTIME_SECONDS + 10 && s.phase !== 'ended'; t += DT) {
      for (const team of [0, 1] as const) {
        if (rand() < 0.02 && playCard(s, team, Math.floor(rand() * 4), { x: 1 + rand() * 16, y: 17 + rand() * 13 }).ok) plays++;
      }
      step(s, DT);
      for (const e of s.entities) {
        expect(Number.isFinite(e.x) && Number.isFinite(e.y) && Number.isFinite(e.hp)).toBe(true);
        expect(e.x).toBeGreaterThanOrEqual(0);
        expect(e.x).toBeLessThanOrEqual(18);
      }
      for (const p of s.players) expect(p.elixir).toBeLessThanOrEqual(ELIXIR_MAX);
    }
    expect(plays).toBeGreaterThan(20);
    expect(s.phase).toBe('ended');
    expect(s.result).not.toBeNull();
  });
});
