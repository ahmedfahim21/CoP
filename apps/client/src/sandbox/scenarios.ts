import { ELIXIR_MAX, mirror, playCard, type CardId, type Entity, type MatchState, type Team } from '@cop/shared';

/** A staged fight that shows off one speciality. Positions are world tiles. */
export interface Scenario {
  id: string;
  title: string;
  note: string;
  /** Which side the camera sits behind. */
  view: Team;
  setup(s: MatchState): void;
}

/** Deploy `card` for `team` at a world point, bypassing hand, elixir and zone rules. */
export function place(s: MatchState, team: Team, card: CardId, world: { x: number; y: number }, opts: { still?: boolean; ready?: boolean } = {}): Entity[] {
  const p = s.players[team];
  p.hand[0] = card;
  p.elixir = ELIXIR_MAX;
  // Play somewhere legal (own perspective), then move the troops where the scene wants them.
  const local = { x: 9, y: 24 };
  const r = playCard(s, team, 0, local);
  if (!r.ok) throw new Error(`sandbox could not place ${card}: ${r.error}`);
  const origin = mirror(team, local);
  const dx = world.x - origin.x;
  const dy = world.y - origin.y;
  for (const u of r.units) {
    u.x += dx;
    u.y += dy;
    if (opts.still) u.deployTimer = 999;
    if (opts.ready) u.deployTimer = 0;
  }
  return r.units;
}

/** Take the towers out of a scene so a fight plays out on its own. */
export function quietTowers(s: MatchState) {
  s.entities = s.entities.filter((e) => e.kind !== 'princess');
  for (const k of s.entities) if (k.kind === 'king') k.active = false;
}

export const SCENARIOS: Scenario[] = [
  {
    id: 'evolve', title: 'Evolve', view: 0,
    note: 'Magikarp splashes uselessly at Machop, then evolves into Gyarados after 7 seconds.',
    setup(s) {
      quietTowers(s);
      place(s, 0, 'magikarp', { x: 9, y: 20.5 });
      place(s, 1, 'machop', { x: 9, y: 18.9 }, { still: true });
    },
  },
  {
    id: 'shadow', title: 'Shadow', view: 0,
    note: 'Enemy Gengar is all but invisible until it strikes. Switch sides to see it as its owner does.',
    setup(s) {
      quietTowers(s);
      place(s, 1, 'gengar', { x: 9, y: 14.5 });
      place(s, 0, 'machop', { x: 9, y: 20.5 }, { still: true });
    },
  },
  {
    id: 'dig', title: 'Dig', view: 0,
    note: 'Dugtrio tunnels from your king tower to the enemy tower and bursts out.',
    setup(s) {
      place(s, 0, 'dugtrio', { x: 3.5, y: 9.5 });
    },
  },
  {
    id: 'leap', title: 'River Leap', view: 0,
    note: 'Rapidash ignores the bridges and jumps the river on its way to a tower.',
    setup(s) {
      place(s, 0, 'rapidash', { x: 9, y: 22 });
    },
  },
  {
    id: 'charge', title: 'Take Down', view: 0,
    note: 'Tauros charges after a short run: head down, dust flying, double damage on impact.',
    setup(s) {
      quietTowers(s);
      place(s, 0, 'tauros', { x: 9, y: 23.5 });
      place(s, 1, 'snorlax', { x: 9, y: 18.2 }, { still: true });
    },
  },
  {
    id: 'heal', title: 'Soft-Boiled', view: 0,
    note: 'Chansey lifts its egg and heals the wounded troops around it.',
    setup(s) {
      quietTowers(s);
      for (const c of place(s, 0, 'chansey', { x: 9, y: 17.5 }, { still: true })) c.deployTimer = 0;
      for (const x of [7.4, 10.6]) for (const u of place(s, 0, 'machop', { x, y: 18.0 }, { still: true })) u.hp = 500;
    },
  },
  {
    id: 'spin', title: 'Fury Cutter', view: 0,
    note: 'Scyther whirls through a full circle, hitting every Rattata around it.',
    setup(s) {
      quietTowers(s);
      place(s, 0, 'scyther', { x: 9, y: 20.5 }, { ready: true });
      const rats = place(s, 1, 'rattata', { x: 9, y: 20.5 }, { still: true });
      const spots = [[9, 19.6], [9, 21.4], [8.1, 20.5], [9.9, 20.5]] as const;
      rats.forEach((r, i) => Object.assign(r, { x: spots[i]![0], y: spots[i]![1] }));
    },
  },
  {
    id: 'stun', title: 'Thunder Wave', view: 0,
    note: 'Jolteon paralyzes Machop with every hit: it freezes mid-step and crackles.',
    setup(s) {
      quietTowers(s);
      place(s, 0, 'jolteon', { x: 9, y: 23.5 });
      place(s, 1, 'machop', { x: 9, y: 17.5 }, { ready: true });
    },
  },
  {
    id: 'freeze', title: 'Freeze', view: 0,
    note: 'Articuno’s ice splash slows a Rattata pack: tinted blue, moving in slow motion.',
    setup(s) {
      quietTowers(s);
      place(s, 0, 'articuno', { x: 9, y: 23.5 });
      place(s, 1, 'rattata', { x: 9, y: 18.5 }, { ready: true });
    },
  },
  {
    id: 'beam', title: 'Fire Spin', view: 0,
    note: 'Moltres’ flame stream heats up the longer it burns Snorlax.',
    setup(s) {
      quietTowers(s);
      place(s, 0, 'moltres', { x: 9, y: 22.5 });
      place(s, 1, 'snorlax', { x: 9, y: 19.0 }, { still: true });
    },
  },
  {
    id: 'blast', title: 'Explosion', view: 0,
    note: 'Geodude goes down fighting a Rattata swarm and takes them with it.',
    setup(s) {
      quietTowers(s);
      for (const g of place(s, 0, 'geodude', { x: 9, y: 20.5 }, { ready: true })) g.hp = 300;
      place(s, 1, 'rattata', { x: 9, y: 18.5 }, { ready: true });
    },
  },
];
