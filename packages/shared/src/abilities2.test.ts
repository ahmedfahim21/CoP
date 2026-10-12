import { describe, expect, it } from 'vitest';
import { typeMultiplier } from './types.js';
import { canTarget, isStructure, step, type Entity, type GameEvent } from './sim.js';
import { DT, keepUnits, onlyUnits, run, runUntil, spawn, started } from './testing.js';

const hitsOn = (events: GameEvent[], id: string) =>
  events.filter((e): e is Extract<GameEvent, { type: 'hit' }> => e.type === 'hit' && e.targetId === id);

function park(e: Entity, x: number, y: number) {
  Object.assign(e, { x, y, deployTimer: 999 });
}

describe('Magnet Turret (Magneton)', () => {
  it('is a structure that never moves, decays, and lures tower-only troops', () => {
    const s = started();
    onlyUnits(s);
    const [magneton] = spawn(s, 0, 'magneton', { x: 9, y: 22 });
    const [snorlax] = spawn(s, 1, 'snorlax', { x: 9, y: 20 });
    Object.assign(snorlax!, { x: 9, y: 17.5, deployTimer: 0 });
    expect(isStructure(magneton!)).toBe(true);
    expect(canTarget(snorlax!, magneton!)).toBe(true);
    const at = { x: magneton!.x, y: magneton!.y };
    run(s, 1.05);
    expect(snorlax!.targetId).toBe(magneton!.id);
    run(s, 2);
    expect({ x: magneton!.x, y: magneton!.y }).toEqual(at);
  });

  it('wears down over its 30 second lifetime', () => {
    const s = started();
    onlyUnits(s);
    const [magneton] = spawn(s, 0, 'magneton', { x: 9, y: 26 });
    run(s, 1 + 10);
    expect(magneton!.hp).toBeCloseTo(magneton!.maxHp * (2 / 3), 0);
    run(s, 21);
    expect(s.entities.includes(magneton!)).toBe(false);
  });
});

describe('Rollout (Golem)', () => {
  it('rolls through a line of ground troops, hitting each once and knocking them back; fliers are untouched', () => {
    const s = started();
    onlyUnits(s);
    const [golem] = spawn(s, 0, 'golem', { x: 9, y: 26 });
    const m1 = spawn(s, 1, 'machop', { x: 9, y: 20 })[0]!;
    const m2 = spawn(s, 1, 'machop', { x: 9, y: 20 })[0]!;
    const bats = spawn(s, 1, 'zubat', { x: 9, y: 20 });
    keepUnits(s, golem!, m1, m2, bats[0]!);
    park(m1, 9, 22.5);
    // Far enough apart that the first knockback doesn't shove into the second.
    park(m2, 9, 19.2);
    park(bats[0]!, 9, 21.5);
    Object.assign(golem!, { deployTimer: 0 });
    const events = run(s, 3.5);
    const dmg = Math.round(240 * typeMultiplier('rock', ['fighting']));
    expect(hitsOn(events, m1.id).map((h) => h.damage)).toEqual([dmg]);
    expect(hitsOn(events, m2.id).map((h) => h.damage)).toEqual([dmg]);
    expect(hitsOn(events, bats[0]!.id)).toHaveLength(0);
    expect(m1.y).toBeCloseTo(22.5 - 1.4, 5);
    expect(m2.y).toBeCloseTo(19.2 - 1.4, 5);
  });
});

describe('Swift (Starmie)', () => {
  it('pierces a line of enemies including fliers, without knockback', () => {
    const s = started();
    onlyUnits(s);
    const [starmie] = spawn(s, 0, 'starmie', { x: 9, y: 27 });
    const [machop] = spawn(s, 1, 'machop', { x: 9, y: 20 });
    const bats = spawn(s, 1, 'zubat', { x: 9, y: 20 });
    keepUnits(s, starmie!, machop!, bats[0]!);
    park(machop!, 9, 22);
    park(bats[0]!, 9, 23.5);
    Object.assign(starmie!, { deployTimer: 0 });
    runUntil(s, (ev) => hitsOn(ev, machop!.id).length > 0, 3);
    expect(machop!.y).toBe(22);
    expect(bats[0]!.hp).toBeLessThan(bats[0]!.maxHp);
  });
});

describe('Jump Kick (Hitmonlee)', () => {
  it('slams on deploy', () => {
    const s = started();
    onlyUnits(s);
    const [rattata] = spawn(s, 1, 'rattata', { x: 9, y: 20 });
    keepUnits(s, rattata!);
    park(rattata!, 9, 24.8);
    const [lee] = spawn(s, 0, 'hitmonlee', { x: 9, y: 24 });
    const events = runUntil(s, (ev) => ev.some((e) => e.type === 'slam'), 2);
    expect(events.find((e) => e.type === 'slam')).toMatchObject({ id: lee!.id, radius: 1.8 });
    // Fighting vs Normal is super effective.
    expect(hitsOn(events, rattata!.id)[0]!.damage).toBe(Math.round(200 * typeMultiplier('fighting', ['normal'])));
  });

  it('leaps onto a target at mid range and lands a double-damage slam with knockback', () => {
    const s = started();
    onlyUnits(s);
    const [lee] = spawn(s, 0, 'hitmonlee', { x: 9, y: 27 });
    const [machop] = spawn(s, 1, 'machop', { x: 9, y: 20 });
    park(machop!, 9, 22.5);
    Object.assign(lee!, { deployTimer: 0 });
    const events = runUntil(s, (ev) => ev.some((e) => e.type === 'slam'), 3);
    expect(events.find((e) => e.type === 'slam')).toMatchObject({ id: lee!.id });
    expect(hitsOn(events, machop!.id)[0]!.damage).toBe(400);
    expect(machop!.y).toBeLessThan(22.5);
    expect(lee!.y).toBeLessThan(25);
  });
});

describe('Rage (Primeape)', () => {
  it('kicks in below half health and speeds it up', () => {
    const s = started();
    onlyUnits(s);
    const [calm] = spawn(s, 0, 'primeape', { x: 5, y: 28 });
    const [angry] = spawn(s, 0, 'primeape', { x: 13, y: 28 });
    angry!.hp = 400;
    run(s, 1.05);
    expect(calm!.enraged).toBe(false);
    expect(angry!.enraged).toBe(true);
    const before = { calm: calm!.y, angry: angry!.y };
    run(s, 1);
    expect(before.angry - angry!.y).toBeGreaterThan((before.calm - calm!.y) * 1.3);
  });
});

describe('Poison Gas (Koffing)', () => {
  it('leaves a cloud that pulses damage for its duration', () => {
    const s = started();
    onlyUnits(s);
    const [koffing] = spawn(s, 0, 'koffing', { x: 9, y: 24 });
    const [machop] = spawn(s, 1, 'machop', { x: 9, y: 20 });
    park(machop!, 9.5, 23);
    koffing!.hp = 0;
    step(s, DT);
    expect(s.events).toContainEqual(expect.objectContaining({ type: 'cloud', team: 0, radius: 2.5, seconds: 4 }));
    expect(s.zones).toHaveLength(1);
    const events = run(s, 4.2);
    const pulses = hitsOn(events, machop!.id);
    expect(pulses.length).toBe(8);
    expect(pulses[0]!.damage).toBe(Math.round(70 * 0.5 * typeMultiplier('poison', ['fighting'])));
    expect(s.zones).toHaveLength(0);
  });
});

describe('Barrier (Mr. Mime)', () => {
  it('soaks damage with its shield before health, then breaks', () => {
    const s = started();
    onlyUnits(s);
    const [mime] = spawn(s, 0, 'mrmime', { x: 9, y: 24 });
    const [machop] = spawn(s, 1, 'machop', { x: 9, y: 20 });
    park(mime!, 9, 24);
    Object.assign(machop!, { x: 9, y: 23, deployTimer: 0 });
    const per = Math.round(170 * typeMultiplier('fighting', ['psychic', 'fairy']));
    const hits = Math.ceil(450 / per);
    let events: GameEvent[] = [];
    for (let n = 0; n < hits; n++) events = events.concat(runUntil(s, (ev) => hitsOn(ev, mime!.id).length > 0, 3));
    expect(events.some((e) => e.type === 'shieldBreak' && e.id === mime!.id)).toBe(true);
    expect(mime!.shield).toBe(0);
    expect(mime!.hp).toBe(mime!.maxHp - (per * hits - 450));
  });
});

describe('Chain Lightning (Zapdos)', () => {
  it('arcs from its target to two more nearby enemies and stuns them all', () => {
    const s = started();
    onlyUnits(s);
    const [zapdos] = spawn(s, 0, 'zapdos', { x: 9, y: 27 });
    const rats = spawn(s, 1, 'rattata', { x: 9, y: 20 });
    const [a, b, c, far] = rats as [Entity, Entity, Entity, Entity];
    park(a, 9, 23.5);
    park(b, 11, 23.5);
    park(c, 13, 23.5);
    park(far, 17.5, 23.5);
    Object.assign(zapdos!, { deployTimer: 0 });
    const events = runUntil(s, (ev) => ev.some((e) => e.type === 'chain'), 3);
    const chain = events.find((e) => e.type === 'chain') as Extract<GameEvent, { type: 'chain' }>;
    expect(chain.path).toEqual([zapdos!.id, a.id, b.id, c.id]);
    for (const r of [a, b, c]) expect(r.stun).toBeGreaterThan(0.3);
    expect(far.hp).toBe(far.maxHp);
  });
});
