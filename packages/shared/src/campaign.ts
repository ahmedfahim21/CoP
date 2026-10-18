import type { CardId } from './cards.js';
import { QUICK_RULES, STANDARD_RULES, type MatchRules, type TeamMods } from './sim.js';
import type { StarterPick } from './starters.js';

/**
 * The Kanto League: eight gyms, the Elite Four and the Champion, fought in order against the
 * bot. Each stage is a themed deck plus one twist built from team modifiers, so it needs no
 * special code. Clearing a stage for the first time unlocks the cards it lists.
 */

export interface Stage {
  id: string;
  /** 1-based position in the League. */
  order: number;
  leader: string;
  title: string;
  /** Badge or honour earned. */
  badge: string;
  type: string;
  /** The ladder arena (1-based) the battle is fought in: the gym's city, or the Indigo Plateau. */
  arena: number;
  deck: readonly CardId[];
  starters: StarterPick;
  /** 0 = rookie bot … 1 = full strength. */
  skill: number;
  /** The twist, as shown to the player. */
  twist: string;
  /** Which types to bring. */
  hint: string;
  /** Applied to the leader's side (team 1); `you` to the player's. */
  foe: Partial<TeamMods>;
  you?: Partial<TeamMods>;
  /** Gyms are quick 2:00 battles; the Elite Four and the Champion play the full clock. */
  long: boolean;
  /** Cards unlocked by the first clear. */
  unlocks: readonly CardId[];
}

export const STAGES: readonly Stage[] = [
  {
    id: 'brock', order: 1, leader: 'Brock', title: 'Pewter Gym', badge: 'Boulder Badge', type: 'rock', arena: 3,
    deck: ['geodude', 'golem', 'dugtrio', 'machop', 'rattata', 'primeape', 'snorlax', 'zubat'], starters: ['bulbasaur', 'squirtle'],
    skill: 0.1, twist: 'Rock solid: his towers have 40% more HP.', hint: 'Water and fighting crack rock: Lapras and Machop hit his team hard.', foe: { towerHp: 1.4 }, long: false, unlocks: ['golem', 'jigglypuff'],
  },
  {
    id: 'misty', order: 2, leader: 'Misty', title: 'Cerulean Gym', badge: 'Cascade Badge', type: 'water', arena: 4,
    deck: ['starmie', 'magikarp', 'zubat', 'pikachu', 'chansey', 'voltorb', 'rattata', 'machop'], starters: ['squirtle', 'bulbasaur'],
    skill: 0.05, twist: 'Rain dance: her troops have 10% more HP.', hint: 'Electric beats water: Pikachu and Voltorb shine here.', foe: { unitHp: 1.1 }, long: false, unlocks: ['starmie'],
  },
  {
    id: 'surge', order: 3, leader: 'Lt. Surge', title: 'Vermilion Gym', badge: 'Thunder Badge', type: 'electric', arena: 5,
    deck: ['jolteon', 'magneton', 'pikachu', 'voltorb', 'zapdos', 'machop', 'snorlax', 'rattata'], starters: ['charmander', 'squirtle'],
    skill: 0.25, twist: 'Overcharged: his troops move 15% faster.', hint: 'Ground is immune to electric: Geodude and Golem shrug off his shocks.', foe: { unitSpeed: 1.15 }, long: false, unlocks: ['magneton'],
  },
  {
    id: 'erika', order: 4, leader: 'Erika', title: 'Celadon Gym', badge: 'Rainbow Badge', type: 'grass', arena: 6,
    deck: ['scyther', 'chansey', 'tauros', 'zubat', 'koffing', 'mrmime', 'vileplume', 'lapras'], starters: ['bulbasaur', 'charmander'],
    skill: 0.45, twist: 'Sweet scent: her elixir flows 15% faster.', hint: 'Fire and flying burn through her team: Charizard is your friend.', foe: { elixirRate: 1.15 }, long: false, unlocks: ['tauros', 'vileplume'],
  },
  {
    id: 'koga', order: 5, leader: 'Koga', title: 'Fuchsia Gym', badge: 'Soul Badge', type: 'poison', arena: 7,
    deck: ['koffing', 'gengar', 'zubat', 'voltorb', 'dugtrio', 'scyther', 'machop', 'snorlax'], starters: ['bulbasaur', 'squirtle'],
    skill: 0.55, twist: 'Toxic: his troops hit 20% harder.', hint: 'Psychic and ground beat poison: try Mr. Mime, Starmie or Golem.', foe: { unitDamage: 1.2 }, long: false, unlocks: ['koffing', 'gengar'],
  },
  {
    id: 'sabrina', order: 6, leader: 'Sabrina', title: 'Saffron Gym', badge: 'Marsh Badge', type: 'psychic', arena: 8,
    deck: ['mrmime', 'starmie', 'gengar', 'machop', 'magikarp', 'chansey', 'exeggcute', 'pikachu'], starters: ['squirtle', 'charmander'],
    skill: 0.3, twist: 'Barrier: her towers have 10% more HP.', hint: 'Psychic crushes fighting and poison. Bring ghost or bug: Gengar and Scyther.', foe: { towerHp: 1.1 }, long: false, unlocks: ['mrmime', 'hitmonlee', 'exeggcute'],
  },
  {
    id: 'blaine', order: 7, leader: 'Blaine', title: 'Cinnabar Gym', badge: 'Volcano Badge', type: 'fire', arena: 9,
    deck: ['rapidash', 'moltres', 'charizard', 'arcanine', 'koffing', 'voltorb', 'zubat', 'golem'], starters: ['charmander', 'bulbasaur'],
    skill: 0.75, twist: 'Heatwave: his troops hit 15% harder and his towers have 20% more HP.', hint: 'Water and rock douse fire: Lapras, Starmie and Golem.', foe: { unitDamage: 1.15, towerHp: 1.2 },
    long: false, unlocks: ['rapidash', 'moltres', 'arcanine'],
  },
  {
    id: 'giovanni', order: 8, leader: 'Giovanni', title: 'Viridian Gym', badge: 'Earth Badge', type: 'ground', arena: 2,
    deck: ['dugtrio', 'golem', 'geodude', 'hitmonlee', 'tauros', 'snorlax', 'gengar', 'zubat'], starters: ['bulbasaur', 'charmander'],
    skill: 0.7, twist: 'Earthquake: his towers and troops have 15% more HP.', hint: 'Water and ice break the ground: Lapras and Starmie.', foe: { towerHp: 1.15, unitHp: 1.15 },
    long: false, unlocks: [],
  },
  {
    id: 'lorelei', order: 9, leader: 'Lorelei', title: 'Elite Four', badge: 'Ice Crest', type: 'ice', arena: 10,
    deck: ['articuno', 'lapras', 'cloyster', 'magikarp', 'dugtrio', 'zubat', 'mrmime', 'golem'], starters: ['squirtle', 'bulbasaur'],
    skill: 0.8, twist: 'Blizzard: her troops have 10% more HP, and the cold slows yours by 5%.', hint: 'Fire, fighting and rock melt ice: Rapidash, Hitmonlee and Golem.', foe: { unitHp: 1.1 }, you: { unitSpeed: 0.95 },
    long: true, unlocks: ['articuno', 'cloyster'],
  },
  {
    id: 'bruno', order: 10, leader: 'Bruno', title: 'Elite Four', badge: 'Fist Crest', type: 'fighting', arena: 10,
    deck: ['hitmonlee', 'machop', 'primeape', 'golem', 'geodude', 'tauros', 'snorlax', 'dugtrio'], starters: ['charmander', 'squirtle'],
    skill: 0.85, twist: 'Bulk up: his troops hit 20% harder.', hint: 'Psychic and flying beat fighting: Mr. Mime, Starmie and Charizard.', foe: { unitDamage: 1.2 }, long: true, unlocks: [],
  },
  {
    id: 'agatha', order: 11, leader: 'Agatha', title: 'Elite Four', badge: 'Shade Crest', type: 'ghost', arena: 10,
    deck: ['gengar', 'koffing', 'zubat', 'mrmime', 'chansey', 'jolteon', 'voltorb', 'snorlax'], starters: ['bulbasaur', 'charmander'],
    skill: 0.85, twist: 'Curse: her elixir flows 10% faster, and you start with only 3.', hint: 'Normal and fighting moves barely touch ghosts. Psychic and ground hit hard: Mr. Mime, Starmie, Dugtrio.', foe: { elixirRate: 1.1 }, you: { startElixir: 3 },
    long: true, unlocks: [],
  },
  {
    id: 'lance', order: 12, leader: 'Lance', title: 'Elite Four', badge: 'Dragon Crest', type: 'dragon', arena: 10,
    deck: ['magikarp', 'charizard', 'moltres', 'zapdos', 'articuno', 'lapras', 'dugtrio', 'dragonite'], starters: ['charmander', 'squirtle'],
    skill: 0.8, twist: 'Dragon dance: his troops have 10% more HP.', hint: 'His fliers hate electric and ice: Jolteon, Magneton and Articuno.', foe: { unitHp: 1.1 },
    long: true, unlocks: ['dragonite'],
  },
  {
    id: 'blue', order: 13, leader: 'Blue', title: 'Champion', badge: 'Champion Ribbon', type: 'normal', arena: 10,
    deck: ['tauros', 'zapdos', 'charizard', 'starmie', 'gengar', 'scyther', 'chansey', 'voltorb'], starters: ['squirtle', 'charmander'],
    skill: 0.95, twist: 'Champion: his towers have 10% more HP and his elixir flows 5% faster.', hint: 'A balanced team with no weak spot. Bring your best deck.',
    foe: { towerHp: 1.1, elixirRate: 1.05 }, long: true, unlocks: ['zapdos'],
  },
];

export function stageById(id: unknown): Stage | null {
  return STAGES.find((s) => s.id === id) ?? null;
}

export function stageRules(stage: Stage): MatchRules {
  const base = stage.long ? STANDARD_RULES : QUICK_RULES;
  // A League battle is a duel: a tie after overtime goes to the healthier side.
  return { ...base, tiebreak: true, teams: [stage.you ?? {}, stage.foe] };
}

/**
 * Stars for a win: one for winning, one for losing no tower, one for three crowns.
 * A loss or draw earns none.
 */
export function starsFor(won: boolean, towersLost: number, crowns: number): number {
  if (!won) return 0;
  return 1 + (towersLost === 0 ? 1 : 0) + (crowns >= 3 ? 1 : 0);
}

export const STAR_TEXT = ['Win', 'Lose no tower', 'Three crowns'] as const;
