import { seededRandom, lerpSkill, ACE_SKILL, ROOKIE_SKILL, type BotSkill } from './bot.js';
import { CARD_IDS, type CardId } from './cards.js';
import { hashString, weekIndex } from './progression.js';
import { trophyDelta, type Outcome } from './ranking.js';
import { QUICK_RULES, STANDARD_RULES, type MatchRules, type TeamMods, type TowerHealth } from './sim.js';
import { STARTER_IDS, type StarterPick } from './starters.js';

/**
 * Single-player modes beyond the League: the Daily Challenge, the Gauntlet, weekly events
 * and ghost battles. All of them are a deck for the bot, a skill and a set of rules, played
 * on the server like any other battle, so the server can score them.
 */

function pick<T>(rand: () => number, xs: readonly T[]): T {
  return xs[Math.floor(rand() * xs.length)]!;
}

function randomStarters(rand: () => number): StarterPick {
  const left = pick(rand, STARTER_IDS);
  const right = pick(rand, STARTER_IDS.filter((s) => s !== left));
  return [left, right] as const;
}

function shuffle<T>(rand: () => number, xs: readonly T[]): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Eight different cards, any of the 27. */
export function randomDeck(rand: () => number): CardId[] {
  return shuffle(rand, CARD_IDS).slice(0, 8);
}

/** Decks the bot plays outside the League; each has a tank to lead pushes. */
export const BOT_DECKS: ReadonlyArray<readonly CardId[]> = [
  ['rattata', 'zubat', 'voltorb', 'pikachu', 'machop', 'lapras', 'charizard', 'snorlax'],
  ['tauros', 'pikachu', 'zubat', 'voltorb', 'scyther', 'mrmime', 'koffing', 'dugtrio'],
  ['golem', 'starmie', 'rattata', 'magneton', 'jolteon', 'primeape', 'zapdos', 'geodude'],
  ['hitmonlee', 'gengar', 'chansey', 'articuno', 'zubat', 'rapidash', 'machop', 'voltorb'],
  ['snorlax', 'moltres', 'mrmime', 'dugtrio', 'rattata', 'starmie', 'primeape', 'zubat'],
  ['lapras', 'scyther', 'koffing', 'jolteon', 'geodude', 'magikarp', 'chansey', 'voltorb'],
];

// ---------------------------------------------------------------- Daily Challenge

export interface DailyChallenge {
  day: string;
  title: string;
  text: string;
  seed: number;
  /** Everyone plays the same deck and towers, so the scores compare. */
  deck: CardId[];
  starters: StarterPick;
  foeDeck: CardId[];
  foeStarters: StarterPick;
  foeSkill: BotSkill;
  rules: MatchRules;
}

const DAILY_DECKS: ReadonlyArray<readonly CardId[]> = [
  ['snorlax', 'pikachu', 'zubat', 'voltorb', 'rattata', 'lapras', 'magikarp', 'primeape'],
  ['charizard', 'machop', 'pikachu', 'zubat', 'voltorb', 'rattata', 'primeape', 'magikarp'],
  ['lapras', 'snorlax', 'rattata', 'zubat', 'machop', 'pikachu', 'voltorb', 'charizard'],
  ['primeape', 'machop', 'magikarp', 'pikachu', 'zubat', 'voltorb', 'rattata', 'snorlax'],
];

interface DailyVariant {
  title: string;
  text: string;
  rules: MatchRules;
}

const DAILY_VARIANTS: readonly DailyVariant[] = [
  { title: 'Rush Hour', text: 'Double elixir from the start. Score fast.', rules: { ...QUICK_RULES, doubleElixirAt: QUICK_RULES.regularSeconds } },
  { title: 'Glass Towers', text: 'Every tower is at 40% health.', rules: { ...QUICK_RULES, towerHpScale: 0.4 } },
  { title: 'Heavyweights', text: 'The bot’s troops have 40% more HP; yours hit 20% harder.', rules: { ...QUICK_RULES, teams: [{ unitDamage: 1.2 }, { unitHp: 1.4 }] } },
  { title: 'Underdog', text: 'The bot’s elixir flows 30% faster. Hold the line.', rules: { ...QUICK_RULES, teams: [{}, { elixirRate: 1.3 }] } },
  { title: 'Fortress', text: 'Its towers have double HP, yours start full of elixir.', rules: { ...QUICK_RULES, teams: [{ startElixir: 10 }, { towerHp: 2 }] } },
  { title: 'Lightning Round', text: 'One minute. Every second counts.', rules: { ...QUICK_RULES, regularSeconds: 60, doubleElixirAt: 30, overtimeSeconds: 0 } },
];

export function dailyChallenge(day: string): DailyChallenge {
  const seed = hashString(`daily:${day}`);
  const rand = seededRandom(seed);
  const variant = pick(rand, DAILY_VARIANTS);
  return {
    day, title: variant.title, text: variant.text, seed,
    deck: [...pick(rand, DAILY_DECKS)], starters: randomStarters(rand),
    foeDeck: [...pick(rand, BOT_DECKS)], foeStarters: randomStarters(rand),
    foeSkill: lerpSkill(ROOKIE_SKILL, ACE_SKILL, 0.8),
    rules: { ...variant.rules, tiebreak: false },
  };
}

export interface DailyScoreInput {
  won: boolean;
  crowns: number;
  /** Damage dealt to the bot's towers. */
  towerDamage: number;
  /** Your towers' health left, 0..1 averaged over all three. */
  towerHealth: number;
  /** Seconds left on the regular clock when the battle ended (0 in overtime). */
  secondsLeft: number;
}

/** Crowns matter most, then damage, then keeping your towers up and finishing early. */
export function dailyScore(s: DailyScoreInput): number {
  return Math.max(0, Math.round(
    s.crowns * 1000 + s.towerDamage / 5 + s.towerHealth * 500 + (s.won ? 250 + s.secondsLeft * 5 : 0),
  ));
}

// ---------------------------------------------------------------- Gauntlet

/** Fallen towers come back to this much health for the next round. */
export const GAUNTLET_REVIVE = 0.25;

export const GAUNTLET_RULES: MatchRules = { ...QUICK_RULES, regularSeconds: 90, doubleElixirAt: 45, overtimeSeconds: 30, tiebreak: false };

export interface GauntletRound {
  round: number;
  foeDeck: CardId[];
  foeStarters: StarterPick;
  foeSkill: BotSkill;
  rules: MatchRules;
}

/** Round `round` (1-based) of a run seeded by `seed`, with your towers as `carry` left them. */
export function gauntletRound(round: number, seed: number, carry: TowerHealth | null): GauntletRound {
  const rand = seededRandom(hashString(`gauntlet:${seed}:${round}`));
  // Each round the bot is sharper and its troops and towers a little tougher.
  const k = Math.min(1, 0.15 + 0.1 * (round - 1));
  const tough = 1 + 0.06 * (round - 1);
  const foe: Partial<TeamMods> = { unitHp: tough, towerHp: tough, unitDamage: 1 + 0.03 * (round - 1) };
  return {
    round,
    foeDeck: round <= BOT_DECKS.length ? [...pick(rand, BOT_DECKS)] : randomDeck(rand),
    foeStarters: randomStarters(rand),
    foeSkill: lerpSkill(ROOKIE_SKILL, ACE_SKILL, k),
    rules: { ...GAUNTLET_RULES, teams: [{}, foe], startHp: [carry ? reviveTowers(carry) : null, null] },
  };
}

/** Tower health carried into the next round: fallen side towers come back at 25%. */
export function reviveTowers(h: TowerHealth): TowerHealth {
  return {
    king: Math.max(GAUNTLET_REVIVE, h.king),
    left: Math.max(GAUNTLET_REVIVE, h.left),
    right: Math.max(GAUNTLET_REVIVE, h.right),
  };
}

// ---------------------------------------------------------------- weekly events

export type EventId = 'triple' | 'mirror' | 'chaos' | 'sudden' | 'giants' | 'draft';

export interface WeeklyEvent {
  id: EventId;
  name: string;
  text: string;
  rules: MatchRules;
  /** How decks are chosen: your own, the bot copies yours, both random, or drafted. */
  decks: 'own' | 'mirror' | 'random' | 'draft';
}

export const EVENTS: readonly WeeklyEvent[] = [
  { id: 'triple', name: 'Triple Elixir', text: 'Elixir flows three times as fast for both sides. Big pushes, all the time.', decks: 'own',
    rules: { ...QUICK_RULES, teams: [{ elixirRate: 3, startElixir: 10 }, { elixirRate: 3, startElixir: 10 }] } },
  { id: 'mirror', name: 'Mirror Match', text: 'The bot plays your deck and your towers. Outplay yourself.', decks: 'mirror', rules: QUICK_RULES },
  { id: 'chaos', name: 'Chaos Decks', text: 'Both sides get eight random cards. Adapt on the fly.', decks: 'random', rules: QUICK_RULES },
  { id: 'sudden', name: 'Sudden Death', text: 'Towers at 30%, one minute on the clock, double elixir. First crown usually wins.', decks: 'own',
    rules: { ...QUICK_RULES, regularSeconds: 60, doubleElixirAt: 60, towerHpScale: 0.3, tiebreak: true } },
  { id: 'giants', name: 'Giant Rumble', text: 'Every troop has double HP but moves 20% slower.', decks: 'own',
    rules: { ...QUICK_RULES, teams: [{ unitHp: 2, unitSpeed: 0.8 }, { unitHp: 2, unitSpeed: 0.8 }] } },
  { id: 'draft', name: 'Draft', text: 'Build your deck one pick at a time from pairs of cards, then battle with it.', decks: 'draft', rules: QUICK_RULES },
];

/** This week's event; the rotation is the same for everyone. */
export function currentEvent(now: number): WeeklyEvent {
  const i = ((weekIndex(now) % EVENTS.length) + EVENTS.length) % EVENTS.length;
  return EVENTS[i]!;
}

export function eventById(id: unknown): WeeklyEvent | null {
  return EVENTS.find((e) => e.id === id) ?? null;
}

export const DRAFT_PICKS = 8;

/**
 * The pairs offered in a draft, from a seed. Pairs never repeat a card, so any choice of one
 * card per pair is a legal deck.
 */
export function draftOffers(seed: number): Array<[CardId, CardId]> {
  const cards = shuffle(seededRandom(seed), CARD_IDS).slice(0, DRAFT_PICKS * 2);
  return Array.from({ length: DRAFT_PICKS }, (_, i) => [cards[2 * i]!, cards[2 * i + 1]!]);
}

/** Whether `deck` is one card from each offered pair, in order. */
export function isDraftedDeck(seed: number, deck: unknown): deck is CardId[] {
  if (!Array.isArray(deck) || deck.length !== DRAFT_PICKS) return false;
  return draftOffers(seed).every((pair, i) => pair.includes(deck[i]));
}

/** The bot's side of an event battle. */
export function eventFoe(event: WeeklyEvent, seed: number, mine: { deck: CardId[]; starters: StarterPick }): { deck: CardId[]; starters: StarterPick } {
  const rand = seededRandom(hashString(`event:${event.id}:${seed}`));
  if (event.decks === 'mirror') return { deck: [...mine.deck], starters: mine.starters };
  if (event.decks === 'random' || event.decks === 'draft') return { deck: randomDeck(rand), starters: randomStarters(rand) };
  return { deck: [...pick(rand, BOT_DECKS)], starters: randomStarters(rand) };
}

/** Your deck in a Chaos battle. */
export function chaosDeck(seed: number): CardId[] {
  return randomDeck(seededRandom(hashString(`chaos:${seed}`)));
}

// ---------------------------------------------------------------- ghosts

/**
 * Ghost battles: when no one is online at your level, you fight the bot playing a real
 * trainer's deck and towers. Only your trophies move, at half the usual rate.
 */
export function ghostTrophyDelta(mine: number, theirs: number, outcome: Outcome): number {
  const full = trophyDelta(mine, theirs, outcome);
  return Math.max(-mine, Math.round(full / 2)) + 0;
}

export const GHOST_RULES: MatchRules = STANDARD_RULES;

/** Bot strength piloting a ghost: matched to the ghost's own trophies. */
export { skillForTrophies as ghostSkill } from './bot.js';
