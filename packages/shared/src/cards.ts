import type { PokeType } from './types.js';

export type TargetClass = 'ground' | 'air-ground' | 'buildings';

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
  /** 0 = instant melee hit. */
  projectileSpeed: number;
  splashRadius: number;
  /** Dies on its first attack (Self-Destruct). */
  kamikaze: boolean;
}

export interface CardDef {
  id: CardId;
  name: string;
  /** National Pokédex number, used for sprites. */
  dex: number;
  cost: number;
  count: number;
  stats: CombatStats;
}

export const CARD_IDS = ['rattata', 'zubat', 'voltorb', 'pikachu', 'machop', 'lapras', 'charizard', 'snorlax'] as const;
export type CardId = (typeof CARD_IDS)[number];

const MELEE = { range: 0.5, projectileSpeed: 0, splashRadius: 0, kamikaze: false, sightRange: 5.5 } as const;

export const CARDS: Record<CardId, CardDef> = {
  rattata: {
    id: 'rattata', name: 'Rattata', dex: 19, cost: 2, count: 4,
    stats: { ...MELEE, hp: 180, damage: 80, hitSpeed: 1, speed: 2, radius: 0.3, flying: false, targets: 'ground', types: ['normal'], move: { name: 'Tackle', type: 'normal' } },
  },
  zubat: {
    id: 'zubat', name: 'Zubat', dex: 41, cost: 2, count: 3,
    stats: { ...MELEE, hp: 120, damage: 70, hitSpeed: 1.1, speed: 2, radius: 0.3, flying: true, targets: 'air-ground', types: ['poison', 'flying'], move: { name: 'Wing Attack', type: 'flying' } },
  },
  voltorb: {
    id: 'voltorb', name: 'Voltorb', dex: 100, cost: 2, count: 1,
    stats: { ...MELEE, hp: 300, damage: 400, hitSpeed: 1, speed: 2, radius: 0.4, flying: false, targets: 'ground', types: ['electric'], move: { name: 'Self-Destruct', type: 'normal' }, splashRadius: 2, kamikaze: true },
  },
  pikachu: {
    id: 'pikachu', name: 'Pikachu', dex: 25, cost: 3, count: 1,
    stats: { ...MELEE, hp: 600, damage: 150, hitSpeed: 1.1, range: 5, sightRange: 6, speed: 1, radius: 0.4, flying: false, targets: 'air-ground', types: ['electric'], move: { name: 'Thunderbolt', type: 'electric' }, projectileSpeed: 10 },
  },
  machop: {
    id: 'machop', name: 'Machop', dex: 66, cost: 3, count: 1,
    stats: { ...MELEE, hp: 1400, damage: 170, hitSpeed: 1.2, range: 0.8, speed: 1, radius: 0.5, flying: false, targets: 'ground', types: ['fighting'], move: { name: 'Karate Chop', type: 'fighting' } },
  },
  lapras: {
    id: 'lapras', name: 'Lapras', dex: 131, cost: 4, count: 1,
    stats: { ...MELEE, hp: 1500, damage: 180, hitSpeed: 1.5, range: 5, sightRange: 6, speed: 0.75, radius: 0.7, flying: false, targets: 'air-ground', types: ['water', 'ice'], move: { name: 'Ice Beam', type: 'ice' }, projectileSpeed: 9 },
  },
  charizard: {
    id: 'charizard', name: 'Charizard', dex: 6, cost: 5, count: 1,
    stats: { ...MELEE, hp: 1000, damage: 140, hitSpeed: 1.6, range: 3.5, speed: 1, radius: 0.6, flying: true, targets: 'air-ground', types: ['fire', 'flying'], move: { name: 'Flamethrower', type: 'fire' }, projectileSpeed: 8, splashRadius: 1.5 },
  },
  snorlax: {
    id: 'snorlax', name: 'Snorlax', dex: 143, cost: 6, count: 1,
    stats: { ...MELEE, hp: 3500, damage: 220, hitSpeed: 1.5, range: 0.9, sightRange: 7, speed: 0.75, radius: 0.8, flying: false, targets: 'buildings', types: ['normal'], move: { name: 'Body Slam', type: 'normal' } },
  },
};

export function isCardId(v: unknown): v is CardId {
  return typeof v === 'string' && (CARD_IDS as readonly string[]).includes(v);
}

/** Fixed MVP deck: every card once. */
export const DEFAULT_DECK: readonly CardId[] = CARD_IDS;
