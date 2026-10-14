import { CARDS, CARD_IDS, FORMS, type CardId, type CombatStats } from './cards.js';
import { STARTERS, STARTER_IDS, type StarterId } from './starters.js';
import { POKE_TYPES, typeMultiplier, type PokeType } from './types.js';

/**
 * Everything the card detail screen says about a card, derived from the same numbers the
 * simulation runs on, so the text can't drift from the game.
 */

export type Role = 'win-condition' | 'tank' | 'swarm' | 'splash' | 'ranged' | 'melee' | 'support' | 'defense' | 'air';

export const ROLE_NAMES: Record<Role, string> = {
  'win-condition': 'Win condition',
  tank: 'Tank',
  swarm: 'Swarm',
  splash: 'Area damage',
  ranged: 'Ranged',
  melee: 'Melee',
  support: 'Support',
  defense: 'Defense',
  air: 'Air',
};

export interface TypeMatchup {
  type: PokeType;
  /** The in-game damage multiplier (already softened, e.g. 1.5 for super effective). */
  multiplier: number;
}

export interface TowerMatchup {
  id: StarterId;
  /** This card's move against the tower. */
  dealt: number;
  /** The tower's shots against this card. */
  taken: number;
}

export interface CardInfo {
  roles: Role[];
  /** Damage per second against a neutral target, per Pokémon. */
  dps: number;
  /** One line per special trait, with the real numbers. */
  traits: string[];
  /** Pokémon types in the game that this card's move hits super effectively. */
  strongAgainst: TypeMatchup[];
  /** Move types in the game that hit this card super effectively. */
  weakAgainst: TypeMatchup[];
  /** Move types in the game that barely hurt this card. */
  resists: TypeMatchup[];
  towers: TowerMatchup[];
}

const round1 = (v: number) => Math.round(v * 10) / 10;
const pct = (v: number) => `${Math.round(v * 100)}%`;
const tiles = (v: number) => `${round1(v)} tile${v === 1 ? '' : 's'}`;
const sec = (v: number) => `${round1(v)}s`;
const cap = (t: PokeType) => t[0]!.toUpperCase() + t.slice(1);

/** Every stat block in the game: cards, evolved forms and starter towers. */
const ALL_STATS: CombatStats[] = [
  ...CARD_IDS.map((c) => CARDS[c].stats),
  ...Object.values(FORMS).map((f) => f.stats),
  ...STARTER_IDS.map((t) => STARTERS[t].stats),
];
const inGame = (types: Set<PokeType>) => POKE_TYPES.filter((t) => types.has(t));
/** Types some Pokémon in the game has, and types some move in the game uses, in chart order. */
export const DEFENDING_TYPES = inGame(new Set(ALL_STATS.flatMap((s) => s.types)));
export const ATTACKING_TYPES = inGame(new Set(ALL_STATS.map((s) => s.move.type)));

export function rolesOf(id: CardId): Role[] {
  const def = CARDS[id];
  const s = def.stats;
  const roles: Role[] = [];
  if (s.targets === 'buildings') roles.push('win-condition');
  if (s.ability?.kind === 'building') roles.push('defense');
  if (s.hp * def.count >= 1500 && s.targets !== 'buildings') roles.push('tank');
  if (def.count > 1) roles.push('swarm');
  if (s.splashRadius > 0 || s.ability?.kind === 'spin' || s.ability?.kind === 'line' || s.ability?.kind === 'chain') roles.push('splash');
  if (s.ability?.kind === 'heal' || s.ability?.kind === 'shield') roles.push('support');
  if (s.flying) roles.push('air');
  roles.push(s.range >= 2 ? 'ranged' : 'melee');
  return roles;
}

export function traitsOf(id: CardId): string[] {
  const def = CARDS[id];
  const s = def.stats;
  const out: string[] = [];
  if (def.count > 1) out.push(`Deploys ${def.count} at once.`);
  if (s.flying) out.push('Flies over the river; troops that only reach the ground can’t touch it.');
  if (s.targets === 'buildings') out.push('Ignores troops and heads straight for towers.');
  else if (s.targets === 'ground' && s.damage > 0) out.push('Can’t hit flying Pokémon.');
  if (s.splashRadius > 0 && !s.kamikaze) out.push(`Each hit splashes everything within ${tiles(s.splashRadius)}.`);
  if (s.kamikaze) out.push(`Faints on its first hit, dealing ${s.damage} to everything within ${tiles(s.splashRadius)}.`);

  const a = s.ability;
  switch (a?.kind) {
    case 'riverLeap': out.push('Jumps the river anywhere: no bridge needed.'); break;
    case 'charge': out.push(`After ${tiles(a.afterTiles)} of running it charges: ×${a.speedMult} speed and ×${a.damageMult} damage on the next hit.`); break;
    case 'dig': out.push(`Can be deployed anywhere on the arena. Tunnels in for ${sec(a.seconds)}, untargetable.`); break;
    case 'shadow': out.push(`Invisible and untargetable, except for ${sec(a.revealSeconds)} after each attack.`); break;
    case 'heal': out.push(`Heals allies within ${tiles(a.radius)} for ${a.amount} HP every ${sec(a.every)}.`); break;
    case 'spin': out.push('Every swing hits all enemies around it, not just its target.'); break;
    case 'stun': out.push(`Each hit paralyzes for ${sec(a.seconds)}: no moving or attacking.`); break;
    case 'slow': out.push(`Each hit chills for ${sec(a.seconds)}: moves and attacks ${pct(1 - a.factor)} slower.`); break;
    case 'ramp': out.push(`Damage climbs ${a.multipliers.map((m) => `×${m}`).join(' → ')} every ${a.hitsPerStage} hits on the same target, up to ${s.damage * a.multipliers[a.multipliers.length - 1]!} per hit.`); break;
    case 'deathBlast': out.push(`Explodes when it faints: ${a.damage} ${cap(a.type)} damage within ${tiles(a.radius)}.`); break;
    case 'evolve': {
      const into = FORMS[a.into];
      out.push(`Evolves into ${into.name} after ${sec(a.after)} on the field: ${into.stats.hp} HP, ${into.stats.move.name} for ${into.stats.damage}${into.stats.splashRadius > 0 ? ' area' : ''} damage.`);
      break;
    }
    case 'building': out.push(`Stays put and decays over ${sec(a.lifetime)}. Lures troops that only target towers.`); break;
    case 'line': out.push(`Shots travel ${tiles(a.length)} in a straight line, hitting everything along it once${a.knockback > 0 ? ` and knocking it back ${tiles(a.knockback)}` : ''}.`); break;
    case 'jump': out.push(`Leaps onto ground targets ${a.minRange}–${tiles(a.maxRange)} away and slams for ×${a.damageMult} damage within ${tiles(a.radius)}, every ${sec(a.cooldown)}.${a.deploySlam ? ' Also slams where it’s deployed.' : ''}`); break;
    case 'rage': out.push(`Below ${pct(a.below)} health it rages: ${pct(a.speedMult - 1)} faster and attacks every ${round1(s.hitSpeed * a.hitSpeedMult)}s instead of ${sec(s.hitSpeed)}.`); break;
    case 'shield': out.push(`Starts behind a ${a.hp} HP barrier that soaks damage first.`); break;
    case 'chain': out.push(`Lightning jumps to ${a.jumps} more enemies within ${tiles(a.range)}, each stunned for ${sec(a.stun)}.`); break;
    case 'deathCloud': out.push(`Leaves a ${cap(a.type)} cloud when it faints: ${a.dps} damage per second within ${tiles(a.radius)} for ${sec(a.seconds)}.`); break;
    case undefined: break;
    default: {
      const unhandled: never = a;
      throw new Error(`No description for ability ${JSON.stringify(unhandled)}`);
    }
  }
  if (s.damage <= 0 && s.ability?.kind !== 'evolve') out.push('Deals no damage.');
  return out;
}

export function cardInfo(id: CardId): CardInfo {
  const me = CARDS[id].stats;
  const strongAgainst = me.damage > 0
    ? DEFENDING_TYPES.map((type) => ({ type, multiplier: typeMultiplier(me.move.type, [type]) })).filter((m) => m.multiplier > 1)
    : [];
  const taken = ATTACKING_TYPES.map((type) => ({ type, multiplier: typeMultiplier(type, me.types) }));
  return {
    roles: rolesOf(id),
    dps: me.hitSpeed > 0 ? Math.round(me.damage / me.hitSpeed) : 0,
    traits: traitsOf(id),
    strongAgainst,
    weakAgainst: taken.filter((m) => m.multiplier > 1).sort((a, b) => b.multiplier - a.multiplier),
    resists: taken.filter((m) => m.multiplier < 1).sort((a, b) => a.multiplier - b.multiplier),
    towers: STARTER_IDS.map((t) => ({
      id: t,
      dealt: typeMultiplier(me.move.type, STARTERS[t].stats.types),
      taken: typeMultiplier(STARTERS[t].stats.move.type, me.types),
    })),
  };
}
