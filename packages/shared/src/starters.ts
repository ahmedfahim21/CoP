import type { CombatStats } from './cards.js';

export const STARTER_IDS = ['bulbasaur', 'charmander', 'squirtle'] as const;
export type StarterId = (typeof STARTER_IDS)[number];

export interface TowerDef {
  name: string;
  dex: number | null;
  stats: CombatStats;
}

const PRINCESS_BASE = {
  hp: 2500, damage: 90, hitSpeed: 0.8, range: 7.5, sightRange: 7.5, speed: 0, radius: 1.5,
  flying: false, targets: 'air-ground', projectileSpeed: 12, splashRadius: 0, kamikaze: false,
} as const;

export const STARTERS: Record<StarterId, TowerDef> = {
  bulbasaur: { name: 'Bulbasaur', dex: 1, stats: { ...PRINCESS_BASE, types: ['grass', 'poison'], move: { name: 'Razor Leaf', type: 'grass' } } },
  charmander: { name: 'Charmander', dex: 4, stats: { ...PRINCESS_BASE, types: ['fire'], move: { name: 'Ember', type: 'fire' } } },
  squirtle: { name: 'Squirtle', dex: 7, stats: { ...PRINCESS_BASE, types: ['water'], move: { name: 'Water Gun', type: 'water' } } },
};

/** The king tower is the trainer: typeless, throws Poké Balls. */
export const TRAINER: TowerDef = {
  name: 'Trainer Red',
  dex: null,
  stats: {
    hp: 4000, damage: 100, hitSpeed: 1, range: 7, sightRange: 7, speed: 0, radius: 2,
    flying: false, targets: 'air-ground', types: [], move: { name: 'Poké Ball', type: 'normal' },
    projectileSpeed: 10, splashRadius: 0, kamikaze: false,
  },
};

export function isStarterId(v: unknown): v is StarterId {
  return typeof v === 'string' && (STARTER_IDS as readonly string[]).includes(v);
}

/** Two distinct starters, own-perspective [left, right]. */
export type StarterPick = readonly [StarterId, StarterId];

export function isStarterPick(v: unknown): v is StarterPick {
  return Array.isArray(v) && v.length === 2 && isStarterId(v[0]) && isStarterId(v[1]) && v[0] !== v[1];
}
