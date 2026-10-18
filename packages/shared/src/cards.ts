import type { PokeType } from './types.js';

export type TargetClass = 'ground' | 'air-ground' | 'buildings';

/**
 * Card specialities: each is a Clash Royale mechanic given to the Pokémon whose Pokédex
 * identity fits it. The simulation implements every kind; cards only carry the numbers.
 */
export type Ability =
  /** Ignores bridges and leaps straight over the river (Hog Rider). */
  | { kind: 'riverLeap' }
  /** After running `afterTiles` uninterrupted it charges: faster, next hit multiplied (Prince). */
  | { kind: 'charge'; afterTiles: number; speedMult: number; damageMult: number }
  /** Deploys anywhere on the field and tunnels in, untargetable, for `seconds` (Miner). */
  | { kind: 'dig'; seconds: number }
  /** Invisible and untargetable except for `revealSeconds` after each attack (Royal Ghost). */
  | { kind: 'shadow'; revealSeconds: number }
  /** Heals nearby allied troops every `every` seconds (Battle Healer). */
  | { kind: 'heal'; every: number; amount: number; radius: number }
  /** Attacks hit everything around itself, not just the target (Valkyrie). */
  | { kind: 'spin' }
  /** Hits paralyze: no moving or attacking for `seconds` (Electro Wizard). */
  | { kind: 'stun'; seconds: number }
  /** Hits chill: movement and attack speed multiplied by `factor` (Ice Wizard). */
  | { kind: 'slow'; seconds: number; factor: number }
  /** Damage climbs while it keeps hitting the same target (Inferno Dragon). */
  | { kind: 'ramp'; hitsPerStage: number; multipliers: readonly number[] }
  /** Explodes when it faints (Giant Skeleton). */
  | { kind: 'deathBlast'; damage: number; radius: number; type: PokeType }
  /** Becomes another Pokémon if it survives `after` seconds on the field (Card Evolutions). */
  | { kind: 'evolve'; after: number; into: FormId }
  /** A placed structure: never moves, decays over `lifetime`, lures tower-only troops (Tesla). */
  | { kind: 'building'; lifetime: number }
  /** Shots travel a straight line, hitting everything along it once; optional knockback (Bowler, Magic Archer). */
  | { kind: 'line'; length: number; width: number; knockback: number }
  /** Leaps onto ground targets between min and max range and slams on landing (Mega Knight). */
  | { kind: 'jump'; minRange: number; maxRange: number; seconds: number; cooldown: number; damageMult: number; radius: number; knockback: number; deploySlam: boolean }
  /** Below `below` of its health it moves and attacks faster (Rage). */
  | { kind: 'rage'; below: number; speedMult: number; hitSpeedMult: number }
  /** Leaves a damaging cloud where it faints (Poison). */
  | { kind: 'deathCloud'; radius: number; dps: number; seconds: number; type: PokeType }
  /** A shield that soaks damage before health (Dark Prince). */
  | { kind: 'shield'; hp: number }
  /** Each hit arcs on to more nearby enemies, briefly stunning all (Electro Dragon). */
  | { kind: 'chain'; jumps: number; range: number; stun: number };

/** Distances in tiles, times in seconds, speeds in tiles/second. */
export interface CombatStats {
  hp: number;
  damage: number;
  hitSpeed: number;
  /** Edge-to-edge attack range. */
  range: number;
  sightRange: number;
  speed: number;
  radius: number;
  flying: boolean;
  targets: TargetClass;
  types: readonly PokeType[];
  move: { name: string; type: PokeType };
  /** 0 = instant hit (melee, beams). */
  projectileSpeed: number;
  splashRadius: number;
  /** Dies on its first attack (Self-Destruct). */
  kamikaze: boolean;
  ability?: Ability;
}

export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';

export interface CardDef {
  id: CardId;
  name: string;
  /** National Pokédex number, used for artwork. */
  dex: number;
  cost: number;
  count: number;
  rarity: Rarity;
  /** Shown on the card's detail screen. */
  special?: { name: string; text: string };
  stats: CombatStats;
}

export const CARD_IDS = [
  'rattata', 'zubat', 'voltorb', 'pikachu', 'machop', 'lapras', 'charizard', 'snorlax',
  'magikarp', 'geodude', 'dugtrio', 'gengar', 'chansey', 'scyther', 'jolteon', 'rapidash', 'tauros', 'articuno', 'moltres',
  'primeape', 'mrmime', 'magneton', 'starmie', 'koffing', 'golem', 'hitmonlee', 'zapdos',
  'exeggcute', 'jigglypuff', 'vileplume', 'cloyster', 'arcanine', 'dragonite',
] as const;
export type CardId = (typeof CARD_IDS)[number];

const MELEE = { range: 0.5, projectileSpeed: 0, splashRadius: 0, kamikaze: false, sightRange: 5.5 } as const;

export const CARDS: Record<CardId, CardDef> = {
  rattata: {
    id: 'rattata', name: 'Rattata', dex: 19, cost: 2, count: 4, rarity: 'common',
    special: { name: 'Swarm', text: 'Four quick biters that surround a target.' },
    stats: { ...MELEE, hp: 180, damage: 80, hitSpeed: 1, speed: 2, radius: 0.3, flying: false, targets: 'ground', types: ['normal'], move: { name: 'Tackle', type: 'normal' } },
  },
  zubat: {
    id: 'zubat', name: 'Zubat', dex: 41, cost: 2, count: 3, rarity: 'common',
    special: { name: 'Swarm', text: 'Three fliers that ground troops can’t reach.' },
    stats: { ...MELEE, hp: 120, damage: 70, hitSpeed: 1.1, speed: 2, radius: 0.3, flying: true, targets: 'air-ground', types: ['poison', 'flying'], move: { name: 'Wing Attack', type: 'flying' } },
  },
  voltorb: {
    id: 'voltorb', name: 'Voltorb', dex: 100, cost: 2, count: 1, rarity: 'rare',
    special: { name: 'Self-Destruct', text: 'Rolls in and explodes on its first hit.' },
    stats: { ...MELEE, hp: 300, damage: 400, hitSpeed: 1, speed: 2, radius: 0.4, flying: false, targets: 'ground', types: ['electric'], move: { name: 'Self-Destruct', type: 'normal' }, splashRadius: 2, kamikaze: true },
  },
  pikachu: {
    id: 'pikachu', name: 'Pikachu', dex: 25, cost: 3, count: 1, rarity: 'rare',
    stats: { ...MELEE, hp: 600, damage: 150, hitSpeed: 1.1, range: 5, sightRange: 6, speed: 1, radius: 0.4, flying: false, targets: 'air-ground', types: ['electric'], move: { name: 'Thunderbolt', type: 'electric' }, projectileSpeed: 10 },
  },
  machop: {
    id: 'machop', name: 'Machop', dex: 66, cost: 3, count: 1, rarity: 'common',
    stats: { ...MELEE, hp: 1400, damage: 170, hitSpeed: 1.2, range: 0.8, speed: 1, radius: 0.5, flying: false, targets: 'ground', types: ['fighting'], move: { name: 'Karate Chop', type: 'fighting' } },
  },
  lapras: {
    id: 'lapras', name: 'Lapras', dex: 131, cost: 4, count: 1, rarity: 'epic',
    stats: { ...MELEE, hp: 1500, damage: 180, hitSpeed: 1.5, range: 5, sightRange: 6, speed: 0.75, radius: 0.7, flying: false, targets: 'air-ground', types: ['water', 'ice'], move: { name: 'Ice Beam', type: 'ice' }, projectileSpeed: 9 },
  },
  charizard: {
    id: 'charizard', name: 'Charizard', dex: 6, cost: 5, count: 1, rarity: 'epic',
    special: { name: 'Flamethrower', text: 'Flies over the river and scorches groups.' },
    stats: { ...MELEE, hp: 1000, damage: 140, hitSpeed: 1.6, range: 3.5, speed: 1, radius: 0.6, flying: true, targets: 'air-ground', types: ['fire', 'flying'], move: { name: 'Flamethrower', type: 'fire' }, projectileSpeed: 8, splashRadius: 1.5 },
  },
  snorlax: {
    id: 'snorlax', name: 'Snorlax', dex: 143, cost: 6, count: 1, rarity: 'legendary',
    special: { name: 'Body Slam', text: 'A huge wall that only cares about towers.' },
    stats: { ...MELEE, hp: 3500, damage: 220, hitSpeed: 1.5, range: 0.9, sightRange: 7, speed: 0.75, radius: 0.8, flying: false, targets: 'buildings', types: ['normal'], move: { name: 'Body Slam', type: 'normal' } },
  },
  magikarp: {
    id: 'magikarp', name: 'Magikarp', dex: 129, cost: 3, count: 1, rarity: 'rare',
    special: { name: 'Evolve', text: 'Splash does nothing… but survive 7 seconds and it evolves into Gyarados!' },
    stats: { ...MELEE, hp: 420, damage: 0, hitSpeed: 1.5, speed: 1, radius: 0.4, flying: false, targets: 'ground', types: ['water'], move: { name: 'Splash', type: 'normal' }, ability: { kind: 'evolve', after: 7, into: 'gyarados' } },
  },
  geodude: {
    id: 'geodude', name: 'Geodude', dex: 74, cost: 3, count: 1, rarity: 'common',
    special: { name: 'Explosion', text: 'Tanky rock that goes for towers and explodes when it faints.' },
    stats: { ...MELEE, hp: 1250, damage: 70, hitSpeed: 1.3, range: 0.6, speed: 0.75, radius: 0.55, flying: false, targets: 'buildings', types: ['rock', 'ground'], move: { name: 'Rollout', type: 'rock' }, ability: { kind: 'deathBlast', damage: 260, radius: 2.2, type: 'rock' } },
  },
  dugtrio: {
    id: 'dugtrio', name: 'Dugtrio', dex: 51, cost: 3, count: 1, rarity: 'rare',
    special: { name: 'Dig', text: 'Deploy it anywhere: it tunnels in underground where nothing can hit it.' },
    stats: { ...MELEE, hp: 900, damage: 130, hitSpeed: 1.2, range: 0.6, speed: 1.5, radius: 0.45, flying: false, targets: 'ground', types: ['ground'], move: { name: 'Dig', type: 'ground' }, ability: { kind: 'dig', seconds: 1.8 } },
  },
  gengar: {
    id: 'gengar', name: 'Gengar', dex: 94, cost: 3, count: 1, rarity: 'epic',
    special: { name: 'Shadow', text: 'Invisible and untargetable until it strikes; slashes everything nearby.' },
    stats: { ...MELEE, hp: 850, damage: 190, hitSpeed: 1.8, range: 0.8, speed: 1.5, radius: 0.5, flying: false, targets: 'ground', types: ['ghost', 'poison'], move: { name: 'Shadow Punch', type: 'ghost' }, splashRadius: 1, ability: { kind: 'shadow', revealSeconds: 0.8 } },
  },
  chansey: {
    id: 'chansey', name: 'Chansey', dex: 113, cost: 4, count: 1, rarity: 'rare',
    special: { name: 'Soft-Boiled', text: 'Heals nearby allied troops every few seconds.' },
    stats: { ...MELEE, hp: 1400, damage: 70, hitSpeed: 1.5, range: 0.6, speed: 1, radius: 0.55, flying: false, targets: 'ground', types: ['normal'], move: { name: 'Pound', type: 'normal' }, ability: { kind: 'heal', every: 2.5, amount: 95, radius: 4 } },
  },
  scyther: {
    id: 'scyther', name: 'Scyther', dex: 123, cost: 4, count: 1, rarity: 'rare',
    special: { name: 'Fury Cutter', text: 'Spins its scythes, hitting every ground enemy around it.' },
    stats: { ...MELEE, hp: 1300, damage: 160, hitSpeed: 1.4, range: 0.6, speed: 1.5, radius: 0.5, flying: false, targets: 'ground', types: ['bug', 'flying'], move: { name: 'Fury Cutter', type: 'bug' }, splashRadius: 1.6, ability: { kind: 'spin' } },
  },
  jolteon: {
    id: 'jolteon', name: 'Jolteon', dex: 135, cost: 4, count: 1, rarity: 'epic',
    special: { name: 'Thunder Wave', text: 'Every hit paralyzes its target for a moment.' },
    stats: { ...MELEE, hp: 650, damage: 110, hitSpeed: 1.6, range: 5, sightRange: 6, speed: 2, radius: 0.4, flying: false, targets: 'air-ground', types: ['electric'], move: { name: 'Thunder Shock', type: 'electric' }, projectileSpeed: 14, ability: { kind: 'stun', seconds: 0.6 } },
  },
  rapidash: {
    id: 'rapidash', name: 'Rapidash', dex: 78, cost: 4, count: 1, rarity: 'rare',
    special: { name: 'River Leap', text: 'Gallops for towers and leaps straight over the river.' },
    stats: { ...MELEE, hp: 1100, damage: 200, hitSpeed: 1.6, range: 0.8, sightRange: 7, speed: 2, radius: 0.55, flying: false, targets: 'buildings', types: ['fire'], move: { name: 'Flame Charge', type: 'fire' }, ability: { kind: 'riverLeap' } },
  },
  tauros: {
    id: 'tauros', name: 'Tauros', dex: 128, cost: 5, count: 1, rarity: 'epic',
    special: { name: 'Take Down', text: 'After a short run it charges in, and its next hit does double damage.' },
    stats: { ...MELEE, hp: 1500, damage: 230, hitSpeed: 1.4, range: 0.8, speed: 1, radius: 0.6, flying: false, targets: 'ground', types: ['normal'], move: { name: 'Take Down', type: 'normal' }, ability: { kind: 'charge', afterTiles: 2, speedMult: 2, damageMult: 2 } },
  },
  articuno: {
    id: 'articuno', name: 'Articuno', dex: 144, cost: 5, count: 1, rarity: 'legendary',
    special: { name: 'Freeze', text: 'Its icy splash slows enemies’ movement and attacks.' },
    stats: { ...MELEE, hp: 1200, damage: 120, hitSpeed: 1.5, range: 5, sightRange: 6, speed: 1, radius: 0.6, flying: true, targets: 'air-ground', types: ['ice', 'flying'], move: { name: 'Ice Beam', type: 'ice' }, projectileSpeed: 9, splashRadius: 1.3, ability: { kind: 'slow', seconds: 2.5, factor: 0.6 } },
  },
  moltres: {
    id: 'moltres', name: 'Moltres', dex: 146, cost: 5, count: 1, rarity: 'legendary',
    special: { name: 'Fire Spin', text: 'A flame stream that gets hotter the longer it burns one target.' },
    stats: { ...MELEE, hp: 1150, damage: 30, hitSpeed: 0.4, range: 3.5, sightRange: 5.5, speed: 1, radius: 0.6, flying: true, targets: 'air-ground', types: ['fire', 'flying'], move: { name: 'Fire Spin', type: 'fire' }, ability: { kind: 'ramp', hitsPerStage: 5, multipliers: [1, 3, 8] } },
  },
  primeape: {
    id: 'primeape', name: 'Primeape', dex: 57, cost: 3, count: 1, rarity: 'common',
    special: { name: 'Rage', text: 'Below half health it flies into a rage: faster feet, faster fists.' },
    stats: { ...MELEE, hp: 1000, damage: 140, hitSpeed: 1.1, range: 0.6, speed: 1.5, radius: 0.45, flying: false, targets: 'ground', types: ['fighting'], move: { name: 'Low Kick', type: 'fighting' }, ability: { kind: 'rage', below: 0.5, speedMult: 1.4, hitSpeedMult: 0.6 } },
  },
  mrmime: {
    id: 'mrmime', name: 'Mr. Mime', dex: 122, cost: 3, count: 1, rarity: 'rare',
    special: { name: 'Barrier', text: 'Mimes up an invisible wall that soaks hits before its own health.' },
    stats: { ...MELEE, hp: 700, damage: 110, hitSpeed: 1.3, range: 4.5, sightRange: 5.5, speed: 1, radius: 0.45, flying: false, targets: 'air-ground', types: ['psychic', 'fairy'], move: { name: 'Psybeam', type: 'psychic' }, projectileSpeed: 10, ability: { kind: 'shield', hp: 450 } },
  },
  magneton: {
    id: 'magneton', name: 'Magneton', dex: 82, cost: 4, count: 1, rarity: 'rare',
    special: { name: 'Magnet Turret', text: 'Hovers in place like a Tesla, zapping air and ground. Lures tower-only troops; fades after 30 seconds.' },
    stats: { ...MELEE, hp: 1100, damage: 120, hitSpeed: 1.1, range: 5.5, sightRange: 5.5, speed: 0, radius: 0.7, flying: false, targets: 'air-ground', types: ['electric', 'steel'], move: { name: 'Thunder Shock', type: 'electric' }, ability: { kind: 'building', lifetime: 30 } },
  },
  starmie: {
    id: 'starmie', name: 'Starmie', dex: 121, cost: 4, count: 1, rarity: 'rare',
    special: { name: 'Swift', text: 'Its stars fly straight on, piercing every enemy in the line.' },
    stats: { ...MELEE, hp: 750, damage: 130, hitSpeed: 1.3, range: 6, sightRange: 6.5, speed: 1, radius: 0.45, flying: false, targets: 'air-ground', types: ['water', 'psychic'], move: { name: 'Swift', type: 'normal' }, projectileSpeed: 11, ability: { kind: 'line', length: 8, width: 0.45, knockback: 0 } },
  },
  koffing: {
    id: 'koffing', name: 'Koffing', dex: 109, cost: 5, count: 1, rarity: 'epic',
    special: { name: 'Poison Gas', text: 'Floats over to towers and drops Sludge. When it faints it leaves a lingering poison cloud.' },
    stats: { ...MELEE, hp: 1000, damage: 300, hitSpeed: 2, range: 0.5, speed: 1, radius: 0.5, flying: true, targets: 'buildings', types: ['poison'], move: { name: 'Sludge', type: 'poison' }, ability: { kind: 'deathCloud', radius: 2.5, dps: 70, seconds: 4, type: 'poison' } },
  },
  golem: {
    id: 'golem', name: 'Golem', dex: 76, cost: 5, count: 1, rarity: 'epic',
    special: { name: 'Rollout', text: 'Rolls a boulder that ploughs through every ground enemy in its path and knocks them back.' },
    stats: { ...MELEE, hp: 1700, damage: 240, hitSpeed: 2.5, range: 4, sightRange: 5, speed: 0.75, radius: 0.75, flying: false, targets: 'ground', types: ['rock', 'ground'], move: { name: 'Rollout', type: 'rock' }, projectileSpeed: 5, ability: { kind: 'line', length: 7, width: 0.55, knockback: 1.4 } },
  },
  hitmonlee: {
    id: 'hitmonlee', name: 'Hitmonlee', dex: 106, cost: 6, count: 1, rarity: 'epic',
    special: { name: 'Jump Kick', text: 'Lands with a slam when deployed, and leaps onto enemies a few tiles away for double damage.' },
    stats: { ...MELEE, hp: 2200, damage: 200, hitSpeed: 1.7, range: 0.8, speed: 1, radius: 0.6, flying: false, targets: 'ground', types: ['fighting'], move: { name: 'Double Kick', type: 'fighting' }, splashRadius: 1.3, ability: { kind: 'jump', minRange: 3, maxRange: 5.5, seconds: 0.8, cooldown: 3, damageMult: 2, radius: 1.8, knockback: 1.2, deploySlam: true } },
  },
  zapdos: {
    id: 'zapdos', name: 'Zapdos', dex: 145, cost: 5, count: 1, rarity: 'legendary',
    special: { name: 'Chain Lightning', text: 'Thunder arcs from its target to two more enemies, stunning each for a moment.' },
    stats: { ...MELEE, hp: 1050, damage: 150, hitSpeed: 2, range: 4, sightRange: 5.5, speed: 1, radius: 0.6, flying: true, targets: 'air-ground', types: ['electric', 'flying'], move: { name: 'Thunder', type: 'electric' }, ability: { kind: 'chain', jumps: 2, range: 4, stun: 0.4 } },
  },
  exeggcute: {
    id: 'exeggcute', name: 'Exeggcute', dex: 102, cost: 3, count: 3, rarity: 'common',
    special: { name: 'Egg Trio', text: 'Three egg pairs that pelt anything in range, fliers included.' },
    stats: { ...MELEE, hp: 260, damage: 70, hitSpeed: 1.2, range: 4.5, sightRange: 5.5, speed: 1, radius: 0.35, flying: false, targets: 'air-ground', types: ['grass', 'psychic'], move: { name: 'Bullet Seed', type: 'grass' }, projectileSpeed: 9 },
  },
  jigglypuff: {
    id: 'jigglypuff', name: 'Jigglypuff', dex: 39, cost: 3, count: 1, rarity: 'rare',
    special: { name: 'Sing', text: 'Its song makes whatever it hits drowsy: slower to move and attack for 2 seconds.' },
    stats: { ...MELEE, hp: 720, damage: 80, hitSpeed: 1.3, range: 4.5, sightRange: 6, speed: 1, radius: 0.45, flying: false, targets: 'air-ground', types: ['normal', 'fairy'], move: { name: 'Sing', type: 'normal' }, projectileSpeed: 8, ability: { kind: 'slow', seconds: 2, factor: 0.6 } },
  },
  vileplume: {
    id: 'vileplume', name: 'Vileplume', dex: 45, cost: 4, count: 1, rarity: 'rare',
    special: { name: 'Petal Dance', text: 'Showers petals that hit everything around its target.' },
    stats: { ...MELEE, hp: 820, damage: 150, hitSpeed: 1.5, range: 5, sightRange: 6, speed: 0.75, radius: 0.55, flying: false, targets: 'air-ground', types: ['grass', 'poison'], move: { name: 'Petal Dance', type: 'grass' }, projectileSpeed: 8, splashRadius: 1.3 },
  },
  cloyster: {
    id: 'cloyster', name: 'Cloyster', dex: 91, cost: 4, count: 1, rarity: 'epic',
    special: { name: 'Shell Armor', text: 'Its shell soaks the first 600 damage before Cloyster takes any.' },
    stats: { ...MELEE, hp: 850, damage: 120, hitSpeed: 1.1, range: 4.5, sightRange: 6, speed: 0.75, radius: 0.55, flying: false, targets: 'air-ground', types: ['water', 'ice'], move: { name: 'Icicle Spear', type: 'ice' }, projectileSpeed: 11, ability: { kind: 'shield', hp: 600 } },
  },
  arcanine: {
    id: 'arcanine', name: 'Arcanine', dex: 59, cost: 4, count: 1, rarity: 'epic',
    special: { name: 'Extreme Speed', text: 'A fast runner: after 2 tiles it charges even faster, and its next bite hits twice as hard.' },
    stats: { ...MELEE, hp: 1100, damage: 160, hitSpeed: 1.2, range: 0.6, speed: 1.5, radius: 0.55, flying: false, targets: 'ground', types: ['fire'], move: { name: 'Fire Fang', type: 'fire' }, ability: { kind: 'charge', afterTiles: 2, speedMult: 1.6, damageMult: 2 } },
  },
  dragonite: {
    id: 'dragonite', name: 'Dragonite', dex: 149, cost: 6, count: 1, rarity: 'legendary',
    special: { name: 'Outrage', text: 'A flying heavyweight. Below half health it moves and hits much faster.' },
    stats: { ...MELEE, hp: 2400, damage: 230, hitSpeed: 1.5, range: 0.8, speed: 0.9, radius: 0.75, flying: true, targets: 'air-ground', types: ['dragon', 'flying'], move: { name: 'Outrage', type: 'dragon' }, ability: { kind: 'rage', below: 0.5, speedMult: 1.4, hitSpeedMult: 0.6 } },
  },
};

/** Units that only exist by evolving from a card. */
export const FORM_IDS = ['gyarados'] as const;
export type FormId = (typeof FORM_IDS)[number];

export interface FormDef {
  id: FormId;
  name: string;
  dex: number;
  stats: CombatStats;
}

export const FORMS: Record<FormId, FormDef> = {
  gyarados: {
    id: 'gyarados', name: 'Gyarados', dex: 130,
    stats: { ...MELEE, hp: 2200, damage: 230, hitSpeed: 1.6, range: 3, sightRange: 6, speed: 1, radius: 0.8, flying: false, targets: 'air-ground', types: ['water', 'flying'], move: { name: 'Hydro Pump', type: 'water' }, projectileSpeed: 10, splashRadius: 1.4 },
  },
};

export type UnitId = CardId | FormId;

export function unitStats(id: UnitId): CombatStats {
  return id in FORMS ? FORMS[id as FormId].stats : CARDS[id as CardId].stats;
}

export function unitName(id: UnitId): string {
  return id in FORMS ? FORMS[id as FormId].name : CARDS[id as CardId].name;
}

export function isCardId(v: unknown): v is CardId {
  return typeof v === 'string' && (CARD_IDS as readonly string[]).includes(v);
}

export const DECK_SIZE = 8;

/** The classic eight, for anyone who hasn't built a deck. */
export const DEFAULT_DECK: readonly CardId[] = ['rattata', 'zubat', 'voltorb', 'pikachu', 'machop', 'lapras', 'charizard', 'snorlax'];

/** A legal deck: exactly eight different cards. */
export function isDeck(v: unknown): v is CardId[] {
  return Array.isArray(v) && v.length === DECK_SIZE && v.every(isCardId) && new Set(v).size === DECK_SIZE;
}
