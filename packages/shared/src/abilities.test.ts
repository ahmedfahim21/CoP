import { describe, expect, it } from 'vitest';
import { inRiver, onBridgeColumn } from './arena.js';
import { CARD_IDS, CARDS, FORMS, isDeck, type CardId } from './cards.js';
import { ELIXIR_MAX, OVERTIME_SECONDS, REGULAR_SECONDS, canDeployCard, canTarget, createMatch, playCard, step, type Entity, type GameEvent } from './sim.js';
import { DT, PICKS, keepUnits, onlyUnits, run, runUntil, spawn, started, tower } from './testing.js';

const hitsOn = (events: GameEvent[], id: string) =>
  events.filter((e): e is Extract<GameEvent, { type: 'hit' }> => e.type === 'hit' && e.targetId === id);

/** Park a troop: placed exactly, never deploys, so it stands still as a target. */
function park(e: Entity, x: number, y: number) {
  Object.assign(e, { x, y, deployTimer: 999 });
}

describe('River Leap (Rapidash)', () => {
  it('crosses the river away from the bridges and only targets towers', () => {
    const s = started();
    const [rapidash] = spawn(s, 0, 'rapidash', { x: 9, y: 20 });
    const [machop] = spawn(s, 1, 'machop', { x: 9, y: 20 });
    park(machop!, 9, 21.5);
    expect(canTarget(rapidash!, machop!)).toBe(false);
    let leapedAt: number | null = null;
    for (let t = 0; t < 10 && rapidash!.y > 14.9; t += DT) {
      step(s, DT);
      if (inRiver(rapidash!.y) && leapedAt === null) leapedAt = rapidash!.x;
    }
    expect(leapedAt).not.toBeNull();
    expect(onBridgeColumn(leapedAt!)).toBe(false);
    expect(rapidash!.y).toBeLessThan(15);
  });
});

describe('Take Down (Tauros)', () => {
  it('charges after a run and lands one double-damage hit', () => {
    const s = started();
    onlyUnits(s);
    const [tauros] = spawn(s, 0, 'tauros', { x: 9, y: 26 });
    const [machop] = spawn(s, 1, 'machop', { x: 9, y: 20 });
    park(machop!, 9, 20);
    const events = run(s, 9);
    const chargeAt = events.findIndex((e) => e.type === 'charge' && e.id === tauros!.id);
    const hits = hitsOn(events, machop!.id);
    expect(chargeAt).toBeGreaterThanOrEqual(0);
    expect(events.indexOf(hits[0]!)).toBeGreaterThan(chargeAt);
    expect(hits.map((h) => h.damage).slice(0, 3)).toEqual([460, 230, 230]);
  });
});

describe('Dig (Dugtrio)', () => {
  it('can be placed anywhere on dry land, unlike other troops', () => {
    expect(canDeployCard('dugtrio', { x: 9, y: 8 }, new Set())).toBe(true);
    expect(canDeployCard('dugtrio', { x: 3, y: 2 }, new Set())).toBe(true);
    expect(canDeployCard('dugtrio', { x: 9, y: 16 }, new Set())).toBe(false);
    expect(canDeployCard('dugtrio', { x: 0.1, y: 8 }, new Set())).toBe(false);
    expect(canDeployCard('machop', { x: 9, y: 8 }, new Set())).toBe(false);
  });

  it('is untargetable while tunnelling, then surfaces and gets shot', () => {
    const s = started();
    const [dugtrio] = spawn(s, 0, 'dugtrio', { x: 3.5, y: 9.5 });
    expect(dugtrio).toMatchObject({ hidden: true, deployTimer: CARDS.dugtrio.stats.ability?.kind === 'dig' ? 1.8 : -1 });
    const enemyTower = tower(s, 1, 'princess', 'right'); // world (3.5, 6.5)
    expect(canTarget(enemyTower, dugtrio!)).toBe(false);
    const underground = run(s, 1.5);
    expect(hitsOn(underground, dugtrio!.id)).toHaveLength(0);
    run(s, 0.4);
    expect(dugtrio!.hidden).toBe(false);
    expect(canTarget(enemyTower, dugtrio!)).toBe(true);
    runUntil(s, (ev) => hitsOn(ev, dugtrio!.id).length > 0, 3);
  });
});

describe('Shadow (Gengar)', () => {
  it('is cloaked until it strikes, then fades again', () => {
    const s = started();
    onlyUnits(s);
    const [gengar] = spawn(s, 0, 'gengar', { x: 9, y: 24 });
    const [machop] = spawn(s, 1, 'machop', { x: 9, y: 20 });
    park(machop!, 9, 21.5);
    run(s, 1.05);
    expect(gengar!.hidden).toBe(true);
    expect(canTarget(machop!, gengar!)).toBe(false);
    runUntil(s, (ev) => ev.some((e) => e.type === 'attack' && e.id === gengar!.id));
    expect(gengar!.hidden).toBe(false);
    expect(canTarget(machop!, gengar!)).toBe(true);
    run(s, 1.5);
    expect(gengar!.hidden).toBe(true);
  });
});

describe('Soft-Boiled (Chansey)', () => {
  it('heals damaged allies in range, capped at max, and nobody else', () => {
    const s = started();
    onlyUnits(s);
    const [chansey] = spawn(s, 0, 'chansey', { x: 9, y: 24 });
    const [near, nearFull] = [spawn(s, 0, 'machop', { x: 10, y: 25 })[0]!, spawn(s, 0, 'machop', { x: 8, y: 25 })[0]!];
    const [far] = spawn(s, 0, 'machop', { x: 2, y: 30 });
    for (const m of [near, nearFull, far!]) m.deployTimer = 999;
    near.hp = 1000;
    nearFull.hp = nearFull.maxHp - 10;
    far!.hp = 1000;
    const events = runUntil(s, (ev) => ev.some((e) => e.type === 'heal'), 5);
    const heal = events.find((e) => e.type === 'heal');
    expect(heal).toMatchObject({ type: 'heal', id: chansey!.id, radius: 4 });
    expect(new Set((heal as Extract<GameEvent, { type: 'heal' }>).healed)).toEqual(new Set([near.id, nearFull.id]));
    expect(near.hp).toBe(1095);
    expect(nearFull.hp).toBe(nearFull.maxHp);
    expect(far!.hp).toBe(1000);
  });

  it('stays quiet when nobody needs healing', () => {
    const s = started();
    onlyUnits(s);
    spawn(s, 0, 'chansey', { x: 9, y: 24 });
    expect(run(s, 4).some((e) => e.type === 'heal')).toBe(false);
  });
});

describe('Fury Cutter (Scyther)', () => {
  it('hits enemies all around it, not just the target', () => {
    const s = started();
    onlyUnits(s);
    const [scyther] = spawn(s, 0, 'scyther', { x: 9, y: 24 });
    const rats = spawn(s, 1, 'rattata', { x: 9, y: 20 });
    const [front, behind, far, extra] = rats as [Entity, Entity, Entity, Entity];
    keepUnits(s, scyther!, front, behind, far);
    void extra;
    park(front, 9, 23.15);
    park(behind, 9, 24.85);
    park(far, 9, 20.5);
    Object.assign(scyther!, { deployTimer: 0 });
    const events = runUntil(s, (ev) => ev.some((e) => e.type === 'attack' && e.id === scyther!.id), 3);
    expect(hitsOn(events, front.id)).toHaveLength(1);
    expect(hitsOn(events, behind.id)).toHaveLength(1);
    expect(hitsOn(events, far.id)).toHaveLength(0);
  });
});

describe('Thunder Wave (Jolteon)', () => {
  it('paralyzes what it hits: no movement while stunned', () => {
    const s = started();
    onlyUnits(s);
    spawn(s, 0, 'jolteon', { x: 9, y: 27 });
    const [machop] = spawn(s, 1, 'machop', { x: 9, y: 20 });
    Object.assign(machop!, { x: 9, y: 22.5, deployTimer: 0 });
    const events = runUntil(s, (ev) => hitsOn(ev, machop!.id).length > 0, 5);
    expect(hitsOn(events, machop!.id)[0]).toMatchObject({ status: 'stun', damage: 110 });
    expect(machop!.stun).toBeGreaterThan(0.5);
    const at = { x: machop!.x, y: machop!.y };
    run(s, 0.4);
    expect({ x: machop!.x, y: machop!.y }).toEqual(at);
  });
});

describe('Freeze (Articuno)', () => {
  it('slows what it hits', () => {
    const s = started();
    onlyUnits(s);
    spawn(s, 0, 'articuno', { x: 9, y: 27 });
    const [machop] = spawn(s, 1, 'machop', { x: 9, y: 20 });
    Object.assign(machop!, { x: 9, y: 22.5, deployTimer: 0 });
    const events = runUntil(s, (ev) => hitsOn(ev, machop!.id).length > 0, 5);
    // Ice vs Fighting is neutral.
    expect(hitsOn(events, machop!.id)[0]).toMatchObject({ status: 'slow', damage: 120 });
    expect(machop!.slowFactor).toBe(0.6);
    expect(machop!.slow).toBeGreaterThan(2);
  });
});

describe('Fire Spin (Moltres)', () => {
  it('ramps up on one target and resets on a new one', () => {
    const s = started();
    onlyUnits(s);
    spawn(s, 0, 'moltres', { x: 9, y: 26 });
    const [snorlax] = spawn(s, 1, 'snorlax', { x: 9, y: 20 });
    park(snorlax!, 9, 23);
    const events = run(s, 6.5);
    const damages = hitsOn(events, snorlax!.id).map((h) => h.damage);
    expect(damages.slice(0, 12)).toEqual([30, 30, 30, 30, 30, 90, 90, 90, 90, 90, 240, 240]);

    s.entities = s.entities.filter((e) => e.id !== snorlax!.id);
    const [machop] = spawn(s, 1, 'machop', { x: 9, y: 20 });
    park(machop!, 9, 23.5);
    const next = runUntil(s, (ev) => hitsOn(ev, machop!.id).length > 0, 3);
    expect(hitsOn(next, machop!.id)[0]!.damage).toBe(30);
  });
});

describe('Explosion (Geodude)', () => {
  it('blows up when it faints, hurting nearby enemies only', () => {
    const s = started();
    onlyUnits(s);
    const [geodude] = spawn(s, 0, 'geodude', { x: 9, y: 24 });
    const [friend] = spawn(s, 0, 'machop', { x: 10, y: 24 });
    const rats = spawn(s, 1, 'rattata', { x: 9, y: 20 });
    keepUnits(s, geodude!, friend!, rats[0]!, rats[1]!);
    park(rats[0]!, 9.4, 22.6);
    park(rats[1]!, 9, 19);
    friend!.deployTimer = 999;
    geodude!.hp = 0;
    step(s, DT);
    expect(s.events).toContainEqual({ type: 'blast', id: geodude!.id, team: 0, x: 9, y: 24, radius: 2.2 });
    // Rock vs Normal is neutral: 260 is more than a Rattata has, so it faints too.
    expect(s.events).toContainEqual(expect.objectContaining({ type: 'death', id: rats[0]!.id }));
    expect(rats[1]!.hp).toBe(rats[1]!.maxHp);
    expect(friend!.hp).toBe(friend!.maxHp);
  });
});

describe('Evolve (Magikarp)', () => {
  it('Splash does nothing, but after 7 seconds it becomes a full-health Gyarados', () => {
    const s = started();
    onlyUnits(s);
    const [karp] = spawn(s, 0, 'magikarp', { x: 9, y: 24 });
    const [machop] = spawn(s, 1, 'machop', { x: 9, y: 20 });
    park(machop!, 9, 22.6);
    let elapsed = 0;
    const seen: GameEvent[] = [];
    while (!seen.some((e) => e.type === 'evolve') && elapsed < 12) {
      step(s, DT);
      elapsed += DT;
      seen.push(...s.events);
    }
    const splashes = hitsOn(seen, machop!.id);
    expect(splashes.length).toBeGreaterThan(0);
    for (const h of splashes) expect(h.damage).toBe(0);
    expect(machop!.hp).toBe(machop!.maxHp);
    // 1s deploy + 7s on the field.
    expect(elapsed).toBeGreaterThan(7.9);
    expect(elapsed).toBeLessThan(8.15);
    expect(seen.find((e) => e.type === 'evolve')).toMatchObject({ id: karp!.id, from: 'magikarp', into: 'gyarados' });
    expect(karp).toMatchObject({ defId: 'gyarados', hp: FORMS.gyarados.stats.hp, maxHp: FORMS.gyarados.stats.hp });
  });
});

describe('decks', () => {
  it('validates decks: eight different real cards', () => {
    expect(isDeck(['magikarp', 'geodude', 'dugtrio', 'gengar', 'chansey', 'scyther', 'jolteon', 'rapidash'])).toBe(true);
    expect(isDeck(['magikarp', 'geodude', 'dugtrio', 'gengar', 'chansey', 'scyther', 'jolteon'])).toBe(false);
    expect(isDeck(['magikarp', 'magikarp', 'dugtrio', 'gengar', 'chansey', 'scyther', 'jolteon', 'rapidash'])).toBe(false);
    expect(isDeck(['mewtwo', 'geodude', 'dugtrio', 'gengar', 'chansey', 'scyther', 'jolteon', 'rapidash'])).toBe(false);
    expect(isDeck('pikachu')).toBe(false);
  });

  it('each player cycles their own deck', () => {
    const a: CardId[] = ['magikarp', 'geodude', 'dugtrio', 'gengar', 'chansey', 'scyther', 'jolteon', 'rapidash'];
    const b: CardId[] = ['tauros', 'articuno', 'moltres', 'pikachu', 'machop', 'lapras', 'charizard', 'snorlax'];
    const s = createMatch(PICKS, 3, [a, b]);
    expect(new Set([...s.players[0].hand, ...s.players[0].queue])).toEqual(new Set(a));
    expect(new Set([...s.players[1].hand, ...s.players[1].queue])).toEqual(new Set(b));
  });
});

describe('soak with the full roster', () => {
  it.each([11, 12, 13, 14, 15, 16])('random decks match %s stays sane and finishes', (seed) => {
    let rnd = seed * 7919;
    const rand = () => ((rnd = (rnd * 16807) % 2147483647) / 2147483647);
    const deck = () => [...CARD_IDS].sort(() => rand() - 0.5).slice(0, 8);
    const s = createMatch(PICKS, seed, [deck(), deck()]);
    s.phase = 'regular';
    s.timeLeft = REGULAR_SECONDS;
    let plays = 0;
    for (let t = 0; t < REGULAR_SECONDS + OVERTIME_SECONDS + 5 && (s.phase as string) !== 'ended'; t += DT) {
      for (const team of [0, 1] as const) {
        if (rand() < 0.03) {
          // Diggers sometimes go deep, everyone else on their own half.
          const deep = rand() < 0.3;
          if (playCard(s, team, Math.floor(rand() * 4), { x: 1 + rand() * 16, y: deep ? 2 + rand() * 12 : 17.5 + rand() * 13 }).ok) plays++;
        }
      }
      step(s, DT);
      for (const e of s.entities) {
        expect(Number.isFinite(e.x) && Number.isFinite(e.y) && Number.isFinite(e.hp)).toBe(true);
        expect(e.hp).toBeLessThanOrEqual(e.maxHp);
      }
      for (const p of s.players) expect(p.elixir).toBeLessThanOrEqual(ELIXIR_MAX);
    }
    expect(plays).toBeGreaterThan(30);
    expect(s.phase).toBe('ended');
  });
});
