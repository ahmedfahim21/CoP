import { ARENAS, arenaFor, type Arena as ArenaTier } from '@cop/shared';
import { PALETTE, shade } from './palette.js';

export type ThemeId =
  | 'pallet' | 'viridian' | 'pewter' | 'cerulean' | 'vermilion'
  | 'celadon' | 'fuchsia' | 'saffron' | 'cinnabar' | 'indigo';

export type Emblem = 'pokeball' | 'boulder' | 'cascade' | 'thunder' | 'rainbow' | 'soul' | 'marsh' | 'volcano' | 'league';

/**
 * How one arena looks. The field layout never changes (the rules don't know about themes);
 * only its dressing does: floor, lanes, river, bridges, the border and what lies beyond it.
 */
export interface ArenaTheme {
  id: ThemeId;
  /** The ladder arena (1-based) this look belongs to. */
  arena: number;
  /** Background and far fog. */
  sky: number;
  /** Hemisphere light's ground bounce. */
  bounce: number;
  turf: {
    /** Mown squares, mown stripes, deck boards or tatami mats. */
    pattern: 'checker' | 'stripes' | 'planks' | 'tatami';
    colors: readonly [number, number];
    /** Per-tile tonal noise. */
    noise: number;
    /** Joints drawn between tiles, boards or mats. */
    grout: string | null;
  };
  /** Small marks painted over the floor. */
  marks:
    | { kind: 'tufts'; dark: string; light: string; count: number; leaves?: boolean; flowers?: readonly string[] }
    | { kind: 'pebbles'; count: number }
    | { kind: 'sand'; count: number }
    | { kind: 'embers'; count: number }
    | { kind: 'none' };
  lane: { kind: 'cobble' | 'dirt' | 'flagstone' | 'boardwalk' | 'steel' | 'slabs'; color: number; edge: number };
  plaza: number;
  plazaJoint: number;
  /** RGB of the darkening along the field's side edges, e.g. "20,60,10". */
  edgeShade: string;
  /** The river's colours (lava is a river too). */
  water: { shallow: number; deep: number; foam: number; bed: number };
  bank: number;
  coping: number;
  floaters: { kind: 'lilies' | 'rocks' | 'none'; count: number };
  bridge: 'planks' | 'logs' | 'slabs';
  /** Kerbs of a slab bridge; the bank colour when null. */
  kerb: number | null;
  /** Timber: bridges, posts, poles. `alt` is the second plank tone. */
  wood: { base: number; light: number; alt: number; dark: number };
  border:
    | { kind: 'palisade'; radius: number; spacing: number; tip: number | 'flat' | null }
    | { kind: 'rockwall'; stone: number }
    | { kind: 'posts'; post: number; rail: number; panel: number | null; round: boolean; spacing: number }
    | { kind: 'crates' };
  banner: { field: string; band: string; trim: string; emblem: Emblem };
  torch: 'wood' | 'stone';
  rock: number;
  /** The strip just outside the border, and the ground beyond it. */
  apron: number;
  outer: number;
  beyond: 'meadow' | 'pines' | 'crags' | 'beach' | 'docks' | 'city' | 'savanna' | 'garden' | 'volcano' | 'stadium';
  /** Ambient specks: fireflies, embers, petals, confetti. */
  particles: { count: number; color: number; glow: number; motion: 'drift' | 'rise' | 'fall'; size: number } | null;
}

const pallet: ArenaTheme = {
  id: 'pallet',
  arena: 1,
  sky: 0x4f8f37,
  bounce: 0x5d7a3a,
  turf: { pattern: 'checker', colors: [PALETTE.grassA, PALETTE.grassB], noise: 0.015, grout: null },
  marks: { kind: 'tufts', dark: 'rgba(40,96,30,0.55)', light: 'rgba(220,255,170,0.35)', count: 520 },
  lane: { kind: 'cobble', color: PALETTE.path, edge: PALETTE.pathEdge },
  plaza: PALETTE.plaza,
  plazaJoint: PALETTE.plazaJoint,
  edgeShade: '20,60,10',
  water: { shallow: PALETTE.water, deep: PALETTE.waterDeep, foam: PALETTE.foam, bed: 0x16808f },
  bank: PALETTE.stoneDark,
  coping: PALETTE.stone,
  floaters: { kind: 'lilies', count: 16 },
  bridge: 'planks',
  kerb: null,
  wood: { base: PALETTE.wood, light: PALETTE.woodLight, alt: 0xd4a066, dark: PALETTE.woodDark },
  border: { kind: 'palisade', radius: 0.2, spacing: 0.42, tip: null },
  banner: { field: '#c8322c', band: '#a3241f', trim: '#f2c14e', emblem: 'pokeball' },
  torch: 'wood',
  rock: PALETTE.rock,
  apron: 0x78a443,
  outer: PALETTE.outerGrass,
  beyond: 'meadow',
  particles: null,
};

/** Deep woods: darker turf, dirt trails, mossy logs, pines, tall grass and fireflies. */
const viridian: ArenaTheme = {
  id: 'viridian',
  arena: 2,
  sky: 0x2c5f2a,
  bounce: 0x41622b,
  turf: { pattern: 'checker', colors: [0x63ad3e, 0x559f35], noise: 0.02, grout: null },
  marks: { kind: 'tufts', dark: 'rgba(24,70,20,0.6)', light: 'rgba(190,240,140,0.3)', count: 900, leaves: true },
  lane: { kind: 'dirt', color: 0xa77d50, edge: 0x7f5d38 },
  plaza: 0xa4aa90,
  plazaJoint: 0x7b8268,
  edgeShade: '10,40,5',
  water: { shallow: 0x3cc6a2, deep: 0x1c8a76, foam: 0xd9fff0, bed: 0x125f52 },
  bank: 0x6a7058,
  coping: 0x9fa58c,
  floaters: { kind: 'lilies', count: 30 },
  bridge: 'logs',
  kerb: null,
  wood: { base: 0x80562f, light: 0x9a6a3c, alt: 0x8a5e34, dark: 0x5a3a1e },
  border: { kind: 'palisade', radius: 0.2, spacing: 0.42, tip: 0x5d9236 },
  banner: { field: '#3f8a3a', band: '#2c6a2a', trim: '#f2c14e', emblem: 'pokeball' },
  torch: 'wood',
  rock: 0x7f8a72,
  apron: 0x4f8a33,
  outer: 0x3d7a2c,
  beyond: 'pines',
  particles: { count: 36, color: 0xeaff8a, glow: 0xc8ff4a, motion: 'drift', size: 0.05 },
};

/** Brock's rock gym: a sandstone floor, flagstone lanes, stone walls and crags under Mt. Moon. */
const pewter: ArenaTheme = {
  id: 'pewter',
  arena: 3,
  sky: 0x8c7658,
  bounce: 0x7d6a4c,
  turf: { pattern: 'checker', colors: [0xd4b585, 0xc6a574], noise: 0.025, grout: 'rgba(96,66,36,0.4)' },
  marks: { kind: 'pebbles', count: 420 },
  lane: { kind: 'flagstone', color: 0xa29b8f, edge: 0x7b7469 },
  plaza: 0x928c81,
  plazaJoint: 0x6c665d,
  edgeShade: '80,50,20',
  water: { shallow: 0x62bddc, deep: 0x2f80a8, foam: 0xe8f6ff, bed: 0x2a5e75 },
  bank: 0x6f6759,
  coping: 0xa69e91,
  floaters: { kind: 'rocks', count: 12 },
  bridge: 'slabs',
  kerb: null,
  wood: { base: 0x8a6a4a, light: 0xa07e5a, alt: 0x94724f, dark: 0x5e4630 },
  border: { kind: 'rockwall', stone: 0x9b9184 },
  banner: { field: '#7a5a3a', band: '#5a4028', trim: '#c9c2b4', emblem: 'boulder' },
  torch: 'stone',
  rock: 0x8c8378,
  apron: 0xb39770,
  outer: 0x9a8262,
  beyond: 'crags',
  particles: null,
};

/** Misty's cape: a sandy beach, boardwalks, white rope fences, palms and the open sea. */
const cerulean: ArenaTheme = {
  id: 'cerulean',
  arena: 4,
  sky: 0x7cc6e6,
  bounce: 0xd8c79a,
  turf: { pattern: 'checker', colors: [0xf0dca8, 0xe9d39c], noise: 0.02, grout: null },
  marks: { kind: 'sand', count: 260 },
  lane: { kind: 'boardwalk', color: 0xc99c68, edge: 0x9a7048 },
  plaza: 0xece5d3,
  plazaJoint: 0xc2b79c,
  edgeShade: '140,100,40',
  water: { shallow: 0x55dcea, deep: 0x1a8fc8, foam: 0xffffff, bed: 0x1a6d96 },
  bank: 0xc9b98f,
  coping: 0xf1ead8,
  floaters: { kind: 'none', count: 0 },
  bridge: 'planks',
  kerb: null,
  wood: { base: 0xb08458, light: 0xd9b383, alt: 0xc9a171, dark: 0x7d5a3a },
  border: { kind: 'posts', post: 0xf4f1ea, rail: 0xd8bf8a, panel: null, round: true, spacing: 0.9 },
  banner: { field: '#2f7fd0', band: '#1f5fa8', trim: '#f4f1ea', emblem: 'cascade' },
  torch: 'wood',
  rock: 0xb7ab97,
  apron: 0xeedba6,
  outer: 0x3fb2d8,
  beyond: 'beach',
  particles: null,
};

/** Lt. Surge's harbour at sunset: a timber deck, riveted steel lanes, crates, cranes and sea. */
const vermilion: ArenaTheme = {
  id: 'vermilion',
  arena: 5,
  sky: 0xeea06a,
  bounce: 0x8a6a50,
  turf: { pattern: 'planks', colors: [0xa77a52, 0x9a6e48], noise: 0.05, grout: 'rgba(50,30,15,0.55)' },
  marks: { kind: 'none' },
  lane: { kind: 'steel', color: 0x8e959c, edge: 0xf2c14e },
  plaza: 0x7d848b,
  plazaJoint: 0x555b61,
  edgeShade: '50,30,15',
  water: { shallow: 0x3a8fb8, deep: 0x1c4f7a, foam: 0xd6ecf5, bed: 0x163a55 },
  bank: 0x5d5f63,
  coping: 0x9aa1a8,
  floaters: { kind: 'none', count: 0 },
  bridge: 'slabs',
  kerb: 0xf2c14e,
  wood: { base: 0x8a6040, light: 0xa77a52, alt: 0x96694a, dark: 0x5a3d26 },
  border: { kind: 'crates' },
  banner: { field: '#e07b1f', band: '#b85f12', trim: '#1d1d22', emblem: 'thunder' },
  torch: 'stone',
  rock: 0x6f7378,
  apron: 0x7e5838,
  outer: 0x2a6f9a,
  beyond: 'docks',
  particles: null,
};

/** Erika's rooftop garden: lawn and flower beds, white paving, glass railings, the city around. */
const celadon: ArenaTheme = {
  id: 'celadon',
  arena: 6,
  sky: 0x9fd0f0,
  bounce: 0x7a8a7a,
  turf: { pattern: 'checker', colors: [0x80cf5a, 0x72c24e], noise: 0.015, grout: null },
  marks: { kind: 'tufts', dark: 'rgba(40,100,30,0.45)', light: 'rgba(230,255,190,0.35)', count: 300, flowers: ['#ff9ec8', '#ffe36b', '#ffffff', '#c79bff'] },
  lane: { kind: 'slabs', color: 0xe9e4da, edge: 0xb9b3a7 },
  plaza: 0xd8d2c6,
  plazaJoint: 0xa9a397,
  edgeShade: '30,70,20',
  water: { shallow: 0x62e2f2, deep: 0x2aa6d8, foam: 0xffffff, bed: 0x2a7fa8 },
  bank: 0xb9b3a7,
  coping: 0xefeae0,
  floaters: { kind: 'lilies', count: 10 },
  bridge: 'slabs',
  kerb: 0x6a7078,
  wood: { base: 0x7a8088, light: 0x9aa0a8, alt: 0x8a9098, dark: 0x555b62 },
  border: { kind: 'posts', post: 0x5b6168, rail: 0x5b6168, panel: 0xbfe6f0, round: false, spacing: 1.1 },
  banner: { field: '#7bbf4a', band: '#5a9a32', trim: '#ffffff', emblem: 'rainbow' },
  torch: 'stone',
  rock: 0xb5b0a6,
  apron: 0xcfc9bd,
  outer: 0x8e8f99,
  beyond: 'city',
  particles: null,
};

/** The Safari Zone: dry savanna grass, dirt tracks, a muddy river, bamboo and acacias. */
const fuchsia: ArenaTheme = {
  id: 'fuchsia',
  arena: 7,
  sky: 0xe6c27a,
  bounce: 0x9a8040,
  turf: { pattern: 'checker', colors: [0xc9c35c, 0xbbb44e], noise: 0.025, grout: null },
  marks: { kind: 'tufts', dark: 'rgba(120,100,30,0.55)', light: 'rgba(255,240,170,0.35)', count: 700 },
  lane: { kind: 'dirt', color: 0xb68a5c, edge: 0x8f6740 },
  plaza: 0xc2b08a,
  plazaJoint: 0x998763,
  edgeShade: '90,70,20',
  water: { shallow: 0x72b59a, deep: 0x40806c, foam: 0xe6f2d8, bed: 0x3a5a40 },
  bank: 0x7a6a4a,
  coping: 0xa8987a,
  floaters: { kind: 'rocks', count: 8 },
  bridge: 'logs',
  kerb: null,
  wood: { base: 0xb7b04a, light: 0xc8c45a, alt: 0xbdb650, dark: 0x6f6a2c },
  border: { kind: 'palisade', radius: 0.09, spacing: 0.2, tip: 'flat' },
  banner: { field: '#d8559a', band: '#b03a7a', trim: '#f2c14e', emblem: 'soul' },
  torch: 'wood',
  rock: 0xa38f72,
  apron: 0xb8b058,
  outer: 0xa9a14a,
  beyond: 'savanna',
  particles: null,
};

/** Sabrina's dojo: tatami floor, polished boards, a koi pond, red rails and cherry blossom. */
const saffron: ArenaTheme = {
  id: 'saffron',
  arena: 8,
  sky: 0x6b5a8a,
  bounce: 0x6a5a5a,
  turf: { pattern: 'tatami', colors: [0xd8cf9a, 0xcfc58c], noise: 0.015, grout: 'rgba(60,70,40,0.7)' },
  marks: { kind: 'none' },
  lane: { kind: 'boardwalk', color: 0xb0703c, edge: 0x7a4524 },
  plaza: 0xb98a58,
  plazaJoint: 0x6a3a1e,
  edgeShade: '60,40,30',
  water: { shallow: 0x58c0c8, deep: 0x24708a, foam: 0xe8fbff, bed: 0x1d4a5a },
  bank: 0x5e5852,
  coping: 0x9a948c,
  floaters: { kind: 'lilies', count: 8 },
  bridge: 'planks',
  kerb: null,
  wood: { base: 0xa8302a, light: 0xc8463a, alt: 0xb83a2e, dark: 0x3a2420 },
  border: { kind: 'posts', post: 0xb83a2e, rail: 0x3a2a24, panel: 0xf3ecd8, round: false, spacing: 1.0 },
  banner: { field: '#6a3fa0', band: '#4a2a78', trim: '#f2c14e', emblem: 'marsh' },
  torch: 'stone',
  rock: 0x8a847c,
  apron: 0xc8bba0,
  outer: 0x6f8f52,
  beyond: 'garden',
  particles: { count: 40, color: 0xffc4dc, glow: 0x000000, motion: 'fall', size: 0.06 },
};

/** Blaine's volcano: basalt with glowing cracks, a river of lava, obsidian walls and embers. */
const cinnabar: ArenaTheme = {
  id: 'cinnabar',
  arena: 9,
  sky: 0x3a2422,
  bounce: 0x5a2a1a,
  turf: { pattern: 'checker', colors: [0x4c4648, 0x433d3f], noise: 0.03, grout: null },
  marks: { kind: 'embers', count: 55 },
  lane: { kind: 'flagstone', color: 0x706a64, edge: 0x2e2a2a },
  plaza: 0x5c5652,
  plazaJoint: 0x2e2a2a,
  edgeShade: '20,10,10',
  water: { shallow: 0xffa12a, deep: 0xd83a0a, foam: 0xffe38a, bed: 0x3a1a10 },
  bank: 0x2e2a2a,
  coping: 0x5c5652,
  floaters: { kind: 'rocks', count: 10 },
  bridge: 'slabs',
  kerb: 0x3a3436,
  wood: { base: 0x5a4a3e, light: 0x6e5c4e, alt: 0x64544a, dark: 0x3a2e26 },
  border: { kind: 'rockwall', stone: 0x423d40 },
  banner: { field: '#c83a1a', band: '#8a2410', trim: '#f2c14e', emblem: 'volcano' },
  torch: 'stone',
  rock: 0x3a3537,
  apron: 0x3a3436,
  outer: 0x2e2a2c,
  beyond: 'volcano',
  particles: { count: 44, color: 0xffb04a, glow: 0xff6a1a, motion: 'rise', size: 0.05 },
};

/** The League stadium: striped pitch, marble and gold, columns, packed stands and floodlights. */
const indigo: ArenaTheme = {
  id: 'indigo',
  arena: 10,
  sky: 0x3b3f8a,
  bounce: 0x5a6a8a,
  turf: { pattern: 'stripes', colors: [0x7ccf52, 0x6abb44], noise: 0.008, grout: null },
  marks: { kind: 'none' },
  lane: { kind: 'slabs', color: 0xf1ede4, edge: 0xc9a64a },
  plaza: 0xe6e1d6,
  plazaJoint: 0xc9a64a,
  edgeShade: '20,40,60',
  water: { shallow: 0x4fb8f0, deep: 0x2a5ec8, foam: 0xffffff, bed: 0x1e3f8a },
  bank: 0xb9b3a7,
  coping: 0xf1ede4,
  floaters: { kind: 'none', count: 0 },
  bridge: 'slabs',
  kerb: 0xc9a64a,
  wood: { base: 0x3a3f8a, light: 0x4a50a0, alt: 0x424898, dark: 0x2e3270 },
  border: { kind: 'posts', post: 0xf1ede4, rail: 0xe6e1d6, panel: null, round: true, spacing: 0.55 },
  banner: { field: '#3b3f8a', band: '#262a68', trim: '#f2c14e', emblem: 'league' },
  torch: 'stone',
  rock: 0xbab4a8,
  apron: 0xe6e1d6,
  outer: 0x4a4f7a,
  beyond: 'stadium',
  particles: { count: 50, color: 0xf2c14e, glow: 0x000000, motion: 'fall', size: 0.05 },
};

/** Every arena's look, in ladder order. */
export const DESIGNED: readonly ArenaTheme[] = [pallet, viridian, pewter, cerulean, vermilion, celadon, fuchsia, saffron, cinnabar, indigo];

export const THEMES = Object.fromEntries(DESIGNED.map((t) => [t.id, t])) as Record<ThemeId, ArenaTheme>;

/** The look for a ladder arena: its own, or the highest designed one below it. */
export function themeForArena(index: number): ArenaTheme {
  let best = DESIGNED[0]!;
  for (const t of DESIGNED) if (t.arena <= index) best = t;
  return best;
}

/** The arena a battle is fought in: the higher-ranked player's. */
export function themeForTrophies(trophies: number): ArenaTheme {
  return themeForArena(arenaFor(trophies).index);
}

/** The ladder arena a theme belongs to. */
export function tierOf(theme: ArenaTheme): ArenaTier {
  const tier = ARENAS.find((a) => a.index === theme.arena);
  if (!tier) throw new Error(`Theme ${theme.id} points at arena ${theme.arena}, which the ladder doesn't have`);
  return tier;
}

/** A colour nudged lighter or darker at random, for per-piece variation. */
export const vary = (color: number, rnd: () => number, amount: number) => shade(color, (rnd() - 0.5) * amount);
