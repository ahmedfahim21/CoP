export const POKE_TYPES = [
  'normal', 'fire', 'water', 'electric', 'grass', 'ice', 'fighting', 'poison', 'ground',
  'flying', 'psychic', 'bug', 'rock', 'ghost', 'dragon', 'dark', 'steel', 'fairy',
] as const;

export type PokeType = (typeof POKE_TYPES)[number];

/** Gen 6+ type chart. Only non-neutral matchups are listed: attacker → defender → raw multiplier. */
const CHART: Record<PokeType, Partial<Record<PokeType, number>>> = {
  normal: { rock: 0.5, ghost: 0, steel: 0.5 },
  fire: { fire: 0.5, water: 0.5, grass: 2, ice: 2, bug: 2, rock: 0.5, dragon: 0.5, steel: 2 },
  water: { fire: 2, water: 0.5, grass: 0.5, ground: 2, rock: 2, dragon: 0.5 },
  electric: { water: 2, electric: 0.5, grass: 0.5, ground: 0, flying: 2, dragon: 0.5 },
  grass: { fire: 0.5, water: 2, grass: 0.5, poison: 0.5, ground: 2, flying: 0.5, bug: 0.5, rock: 2, dragon: 0.5, steel: 0.5 },
  ice: { fire: 0.5, water: 0.5, grass: 2, ice: 0.5, ground: 2, flying: 2, dragon: 2, steel: 0.5 },
  fighting: { normal: 2, ice: 2, poison: 0.5, flying: 0.5, psychic: 0.5, bug: 0.5, rock: 2, ghost: 0, dark: 2, steel: 2, fairy: 0.5 },
  poison: { grass: 2, poison: 0.5, ground: 0.5, rock: 0.5, ghost: 0.5, steel: 0, fairy: 2 },
  ground: { fire: 2, electric: 2, grass: 0.5, poison: 2, flying: 0, bug: 0.5, rock: 2, steel: 2 },
  flying: { electric: 0.5, grass: 2, fighting: 2, bug: 2, rock: 0.5, steel: 0.5 },
  psychic: { fighting: 2, poison: 2, psychic: 0.5, dark: 0, steel: 0.5 },
  bug: { fire: 0.5, grass: 2, fighting: 0.5, poison: 0.5, flying: 0.5, psychic: 2, ghost: 0.5, dark: 2, steel: 0.5, fairy: 0.5 },
  rock: { fire: 2, ice: 2, fighting: 0.5, ground: 0.5, flying: 2, bug: 2, steel: 0.5 },
  ghost: { normal: 0, psychic: 2, ghost: 2, dark: 0.5 },
  dragon: { dragon: 2, steel: 0.5, fairy: 0 },
  dark: { fighting: 0.5, psychic: 2, ghost: 2, dark: 0.5, fairy: 0.5 },
  steel: { fire: 0.5, water: 0.5, electric: 0.5, ice: 2, rock: 2, steel: 0.5, fairy: 2 },
  fairy: { fire: 0.5, fighting: 2, poison: 0.5, dragon: 2, dark: 2, steel: 0.5 },
};

/** Raw chart product, e.g. Ice vs Grass/Flying = 4. */
export function rawEffectiveness(attack: PokeType, defender: readonly PokeType[]): number {
  return defender.reduce((acc, t) => acc * (CHART[attack][t] ?? 1), 1);
}

/** Raw multipliers are softened so a single bad matchup never fully decides a fight. */
const TUNED: ReadonlyMap<number, number> = new Map([
  [0, 0.5],
  [0.25, 0.6],
  [0.5, 0.75],
  [1, 1],
  [2, 1.5],
  [4, 2],
]);

export function typeMultiplier(attack: PokeType, defender: readonly PokeType[]): number {
  const raw = rawEffectiveness(attack, defender);
  const tuned = TUNED.get(raw);
  if (tuned === undefined) throw new Error(`Unexpected raw effectiveness ${raw} for ${attack} vs ${defender.join('/')}`);
  return tuned;
}

export type Effectiveness = 'super' | 'weak' | 'immune' | 'neutral';

export function effectivenessLabel(attack: PokeType, defender: readonly PokeType[]): Effectiveness {
  const raw = rawEffectiveness(attack, defender);
  if (raw === 0) return 'immune';
  if (raw > 1) return 'super';
  if (raw < 1) return 'weak';
  return 'neutral';
}
