import {
  ARENA_H, ARENA_W, BRIDGE_HALF_WIDTH, BRIDGE_XS, KING_POS, PRINCESS_POS, RIVER_BOTTOM, RIVER_TOP,
  dist, inRiver, isValidDeploy, laneOf, mirror, onBridgeColumn, riverSide,
  type Lane, type Point, type Team,
} from './arena.js';
import { CARDS, DEFAULT_DECK, FORMS, unitStats, type Ability, type CardId, type CombatStats, type FormId, type UnitId } from './cards.js';
import { STARTERS, TRAINER, type StarterId, type StarterPick } from './starters.js';
import { effectivenessLabel, typeMultiplier, type Effectiveness, type PokeType } from './types.js';
import type { MatchMode } from './profile.js';

export const COUNTDOWN_SECONDS = 3;
export const REGULAR_SECONDS = 180;
export const OVERTIME_SECONDS = 60;
export const DOUBLE_ELIXIR_AT = 60;
export const ELIXIR_START = 5;
export const ELIXIR_MAX = 10;
export const ELIXIR_PER_SECOND = 1 / 2.8;

/** The clock and tower health a match is played with. */
export interface MatchRules {
  regularSeconds: number;
  overtimeSeconds: number;
  /** Double elixir starts when this many regular seconds are left (and lasts through overtime). */
  doubleElixirAt: number;
  /** Multiplies every tower's health. */
  towerHpScale: number;
  /** Equal crowns after overtime: the healthier weakest tower wins (true), or it's a draw. */
  tiebreak: boolean;
}

export const STANDARD_RULES: MatchRules = {
  regularSeconds: REGULAR_SECONDS, overtimeSeconds: OVERTIME_SECONDS, doubleElixirAt: DOUBLE_ELIXIR_AT, towerHpScale: 1, tiebreak: true,
};

/** Training against the bot: 2:00 with double elixir after 30 seconds, 0:30 overtime, towers at 60%; a tie is a draw. */
export const QUICK_RULES: MatchRules = { regularSeconds: 120, overtimeSeconds: 30, doubleElixirAt: 90, towerHpScale: 0.6, tiebreak: false };

export function rulesFor(mode: MatchMode): MatchRules {
  return mode === 'training' ? QUICK_RULES : STANDARD_RULES;
}
export const DEPLOY_SECONDS = 1;
export const HAND_SIZE = 4;

export type Phase = 'countdown' | 'regular' | 'overtime' | 'ended';
export type EntityKind = 'unit' | 'king' | 'princess';
export type ResultReason = 'king' | 'crowns' | 'tiebreak' | 'draw' | 'forfeit';

export interface Entity {
  id: string;
  team: Team;
  kind: EntityKind;
  /** UnitId for troops (cards and evolved forms), StarterId for princess towers, 'trainer' for the king. */
  defId: UnitId | StarterId | 'trainer';
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  deployTimer: number;
  cooldown: number;
  targetId: string | null;
  /** King towers stay dormant until hit or a princess tower falls. */
  active: boolean;
  /** Princess towers only, own perspective. */
  lane: Lane | null;
  /** Untargetable: tunnelling in (Dig) or cloaked (Shadow). */
  hidden: boolean;
  /** Seconds of paralysis left. */
  stun: number;
  /** Seconds of chill left, and the speed factor while chilled. */
  slow: number;
  slowFactor: number;
  /** Tiles run without stopping, for Take Down. */
  charge: number;
  /** Fire Spin: who it's been burning and for how many hits. */
  rampTarget: string | null;
  rampHits: number;
  /** Countdown shared by timed abilities: heal cadence, shadow reveal, evolution. */
  abilityTimer: number;
  /** Barrier: damage soaked before health. */
  shield: number;
  /** Rage is on. */
  enraged: boolean;
  /** Jump Kick in flight, and the wait until the next one. */
  jump: { fromX: number; fromY: number; toX: number; toY: number; t: number; seconds: number } | null;
  jumpCooldown: number;
}

export interface Projectile {
  id: string;
  team: Team;
  sourceDefId: Entity['defId'];
  x: number;
  y: number;
  targetId: string;
  /** Last known target position; used if the target dies mid-flight. */
  tx: number;
  ty: number;
  /** Line shots (Rollout, Swift) fly straight and hit everything they pass once. */
  line: { dx: number; dy: number; travel: number; hit: string[] } | null;
}

/** A lingering damage area (Poison Gas). */
export interface Zone {
  id: string;
  team: Team;
  x: number;
  y: number;
  radius: number;
  dps: number;
  type: PokeType;
  timeLeft: number;
  /** Seconds to the next damage pulse. */
  tick: number;
}

export const ZONE_TICK = 0.5;

export interface PlayerState {
  elixir: number;
  hand: CardId[];
  queue: CardId[];
  crowns: number;
  starters: StarterPick;
}

export interface MatchResult {
  winner: Team | null;
  reason: ResultReason;
}

export type GameEvent =
  /** An attack starts: drives wind-up animations. Ranged hits land later, when the projectile arrives. */
  | { type: 'attack'; id: string; targetId: string }
  | { type: 'hit'; targetId: string; x: number; y: number; damage: number; effectiveness: Effectiveness; status?: 'stun' | 'slow' }
  | { type: 'death'; id: string; kind: EntityKind; team: Team; x: number; y: number }
  | { type: 'spawn'; team: Team; cardId: CardId; x: number; y: number }
  /** Soft-Boiled pulse. */
  | { type: 'heal'; id: string; x: number; y: number; radius: number; healed: string[] }
  /** Take Down: the charge has begun. */
  | { type: 'charge'; id: string }
  /** A troop evolved into another Pokémon in place. */
  | { type: 'evolve'; id: string; from: UnitId; into: UnitId; x: number; y: number }
  /** Death explosion (Explosion). */
  | { type: 'blast'; id: string; team: Team; x: number; y: number; radius: number }
  /** Jump Kick takes off: the troop arcs from (x, y) to (tx, ty) over `seconds`. */
  | { type: 'jump'; id: string; x: number; y: number; tx: number; ty: number; seconds: number }
  /** A landing slam (Jump Kick or deploy). */
  | { type: 'slam'; id: string; x: number; y: number; radius: number }
  /** Rage kicked in. */
  | { type: 'rage'; id: string }
  /** Barrier broke. */
  | { type: 'shieldBreak'; id: string }
  /** Chain Lightning: the bolt's path, attacker first. */
  | { type: 'chain'; id: string; path: string[] }
  /** A poison cloud appeared. */
  | { type: 'cloud'; id: string; team: Team; x: number; y: number; radius: number; seconds: number }
  /** A troop was knocked back. */
  | { type: 'knock'; id: string };

export interface MatchState {
  phase: Phase;
  /** Seconds left in the current phase. */
  timeLeft: number;
  nextId: number;
  rngState: number;
  entities: Entity[];
  projectiles: Projectile[];
  zones: Zone[];
  players: [PlayerState, PlayerState];
  result: MatchResult | null;
  /** Events produced by the most recent step/playCard; cleared at the start of each step. */
  events: GameEvent[];
  rules: MatchRules;
}

export function statsOf(e: Pick<Entity, 'kind' | 'defId'>): CombatStats {
  if (e.kind === 'king') return TRAINER.stats;
  if (e.kind === 'princess') return STARTERS[e.defId as StarterId].stats;
  return unitStats(e.defId as UnitId);
}

function abilityOf<K extends Ability['kind']>(e: Pick<Entity, 'kind' | 'defId'>, kind: K): Extract<Ability, { kind: K }> | null {
  const a = statsOf(e).ability;
  return a && a.kind === kind ? (a as Extract<Ability, { kind: K }>) : null;
}

/** Whether Take Down is primed: the next hit is a charge hit. */
export function isCharging(e: Pick<Entity, 'kind' | 'defId' | 'charge'>): boolean {
  const c = abilityOf(e, 'charge');
  return c !== null && e.charge >= c.afterTiles;
}

// --- RNG (mulberry32), kept in state so matches are reproducible ---

function nextRandom(state: MatchState): number {
  let t = (state.rngState = (state.rngState + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function shuffled<T>(state: MatchState, items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(nextRandom(state) * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

// --- Setup ---

function newId(state: MatchState): string {
  return `e${state.nextId++}`;
}

type EntitySeed = Pick<Entity, 'team' | 'kind' | 'defId' | 'x' | 'y' | 'deployTimer' | 'active' | 'lane'>;

function addEntity(state: MatchState, seed: EntitySeed): Entity {
  const stats = statsOf(seed);
  const a = stats.ability;
  const e: Entity = {
    ...seed, id: newId(state), hp: stats.hp, maxHp: stats.hp, cooldown: stats.hitSpeed * 0.5, targetId: null,
    hidden: a?.kind === 'dig', stun: 0, slow: 0, slowFactor: 1, charge: 0, rampTarget: null, rampHits: 0,
    abilityTimer: a?.kind === 'heal' ? a.every : a?.kind === 'evolve' ? a.after : 0,
    shield: a?.kind === 'shield' ? a.hp : 0, enraged: false, jump: null, jumpCooldown: 0,
  };
  state.entities.push(e);
  return e;
}

export function createMatch(
  starters: [StarterPick, StarterPick], seed: number,
  decks: [readonly CardId[], readonly CardId[]] = [DEFAULT_DECK, DEFAULT_DECK], rules: MatchRules = STANDARD_RULES,
): MatchState {
  const state: MatchState = {
    phase: 'countdown',
    timeLeft: COUNTDOWN_SECONDS,
    nextId: 1,
    rngState: seed | 0,
    entities: [],
    projectiles: [],
    zones: [],
    players: [emptyPlayer(starters[0]), emptyPlayer(starters[1])],
    result: null,
    events: [],
    rules,
  };
  for (const team of [0, 1] as const) {
    const deck = shuffled(state, decks[team]);
    state.players[team].hand = deck.slice(0, HAND_SIZE);
    state.players[team].queue = deck.slice(HAND_SIZE);

    const king = mirror(team, KING_POS);
    addEntity(state, { team, kind: 'king', defId: 'trainer', ...king, deployTimer: 0, active: false, lane: null });
    (['left', 'right'] as const).forEach((lane, i) => {
      const p = mirror(team, PRINCESS_POS[lane]);
      addEntity(state, { team, kind: 'princess', defId: starters[team][i]!, ...p, deployTimer: 0, active: true, lane });
    });
  }
  for (const t of state.entities) t.hp = t.maxHp = Math.round(t.maxHp * rules.towerHpScale);
  return state;
}

function emptyPlayer(starters: StarterPick): PlayerState {
  return { elixir: ELIXIR_START, hand: [], queue: [], crowns: 0, starters };
}

// --- Commands ---

export type PlayError = 'not-playing' | 'bad-slot' | 'not-enough-elixir' | 'bad-position';

/**
 * Lanes (from `team`'s perspective) where the enemy princess tower has fallen.
 * Takes plain entities so the client can run it on network state too.
 */
export function openPocketsFrom(entities: Iterable<{ team: number; kind: string; x: number; y: number }>, team: Team): Set<Lane> {
  const open = new Set<Lane>(['left', 'right']);
  for (const e of entities) {
    if (e.team !== team && e.kind === 'princess') open.delete(laneOf(mirror(team, e).x));
  }
  return open;
}

export function openPockets(state: MatchState, team: Team): Set<Lane> {
  return openPocketsFrom(state.entities, team);
}

/** Where `card` may be placed. Diggers go anywhere on dry land; everyone else uses the deploy zone. */
export function canDeployCard(card: CardId, local: Point, pockets: ReadonlySet<Lane>): boolean {
  if (CARDS[card].stats.ability?.kind === 'dig') {
    return Number.isFinite(local.x) && Number.isFinite(local.y)
      && local.x >= 0.5 && local.x <= ARENA_W - 0.5 && local.y >= 0.5 && local.y <= ARENA_H - 0.5 && !inRiver(local.y);
  }
  return isValidDeploy(local, pockets);
}

const FORMATIONS: Record<number, readonly Point[]> = {
  1: [{ x: 0, y: 0 }],
  3: [{ x: 0, y: -0.5 }, { x: -0.5, y: 0.25 }, { x: 0.5, y: 0.25 }],
  4: [{ x: -0.45, y: -0.45 }, { x: 0.45, y: -0.45 }, { x: -0.45, y: 0.45 }, { x: 0.45, y: 0.45 }],
};

/**
 * Plays the card in `slot` at a point given in the player's own perspective.
 * On failure nothing in `state` changes.
 */
export function playCard(state: MatchState, team: Team, slot: number, local: Point): { ok: true; units: Entity[] } | { ok: false; error: PlayError } {
  if (state.phase !== 'regular' && state.phase !== 'overtime') return { ok: false, error: 'not-playing' };
  const player = state.players[team];
  if (!Number.isInteger(slot) || slot < 0 || slot >= player.hand.length) return { ok: false, error: 'bad-slot' };
  const cardId = player.hand[slot]!;
  const card = CARDS[cardId];
  if (player.elixir < card.cost) return { ok: false, error: 'not-enough-elixir' };
  if (!canDeployCard(cardId, local, openPockets(state, team))) return { ok: false, error: 'bad-position' };

  player.elixir -= card.cost;
  const next = player.queue.shift()!;
  player.hand[slot] = next;
  player.queue.push(cardId);

  const offsets = FORMATIONS[card.count];
  if (!offsets) throw new Error(`No formation for count ${card.count}`);
  const dig = card.stats.ability?.kind === 'dig' ? card.stats.ability : null;
  const units = offsets.map((o) => {
    const world = mirror(team, { x: clamp(local.x + o.x, 0.3, ARENA_W - 0.3), y: clamp(local.y + o.y, 0.3, ARENA_H - 0.3) });
    return addEntity(state, { team, kind: 'unit', defId: cardId, ...world, deployTimer: dig ? dig.seconds : DEPLOY_SECONDS, active: true, lane: null });
  });
  const center = mirror(team, local);
  state.events.push({ type: 'spawn', team, cardId, x: center.x, y: center.y });
  return { ok: true, units };
}

export function forfeit(state: MatchState, loser: Team): void {
  if (state.phase === 'ended') return;
  state.phase = 'ended';
  state.timeLeft = 0;
  state.result = { winner: (1 - loser) as Team, reason: 'forfeit' };
}

// --- Simulation ---

export function step(state: MatchState, dt: number): void {
  state.events = [];
  if (state.phase === 'ended') return;

  if (state.phase === 'countdown') {
    state.timeLeft -= dt;
    if (state.timeLeft <= 0) {
      state.phase = 'regular';
      state.timeLeft = state.rules.regularSeconds;
    }
    return;
  }

  const rate = isDoubleElixir(state) ? ELIXIR_PER_SECOND * 2 : ELIXIR_PER_SECOND;
  for (const p of state.players) p.elixir = Math.min(ELIXIR_MAX, p.elixir + rate * dt);

  const byId = new Map(state.entities.map((e) => [e.id, e]));
  for (const e of [...state.entities]) {
    if (e.hp <= 0) continue;
    if (e.deployTimer > 0) {
      e.deployTimer = Math.max(0, e.deployTimer - dt);
      if (e.deployTimer === 0) onDeployed(state, e);
      continue;
    }
    e.slow = Math.max(0, e.slow - dt);
    if (e.slow === 0) e.slowFactor = 1;
    if (e.stun > 0) {
      // Paralyzed: frozen in place, attack timer on hold, charge lost.
      e.stun = Math.max(0, e.stun - dt);
      e.charge = 0;
      continue;
    }
    const rage = abilityOf(e, 'rage');
    const tempo = dt * e.slowFactor;
    // Rage speeds up the attack timer as well as the legs.
    e.cooldown = Math.max(0, e.cooldown - tempo / (rage && e.enraged ? rage.hitSpeedMult : 1));
    if (e.kind === 'unit') {
      tickAbility(state, e, dt);
      if (e.hp > 0 && e.jump) flyJump(state, e, dt);
      else if (e.hp > 0) updateUnit(state, e, byId, tempo);
    } else {
      updateTower(state, e, byId);
    }
  }
  updateProjectiles(state, byId, dt);
  updateZones(state, dt);
  separate(state);
  resolveDeaths(state);

  // resolveDeaths may have ended the match; TS can't see the mutation.
  if ((state.phase as Phase) === 'ended') return;
  state.timeLeft -= dt;
  if (state.timeLeft <= 0) endOfPhase(state);
}

export function isDoubleElixir(state: MatchState): boolean {
  return state.phase === 'overtime' || (state.phase === 'regular' && state.timeLeft <= state.rules.doubleElixirAt);
}

function onDeployed(state: MatchState, e: Entity) {
  if (abilityOf(e, 'dig')) e.hidden = false;
  // A ghost arrives already cloaked.
  if (abilityOf(e, 'shadow')) e.hidden = true;
  const jump = abilityOf(e, 'jump');
  if (jump?.deploySlam) slam(state, e, 1, jump.radius, jump.knockback);
}

/** Structures: towers, plus troops that are buildings (they lure tower-only troops). */
export function isStructure(e: Pick<Entity, 'kind' | 'defId'>): boolean {
  return e.kind !== 'unit' || abilityOf(e, 'building') !== null;
}

/** Per-step upkeep for abilities that run on their own clock. */
function tickAbility(state: MatchState, e: Entity, dt: number) {
  const heal = abilityOf(e, 'heal');
  if (heal) {
    e.abilityTimer -= dt;
    if (e.abilityTimer <= 0) {
      e.abilityTimer = heal.every;
      const healed: string[] = [];
      for (const ally of state.entities) {
        if (ally.team !== e.team || ally.kind !== 'unit' || ally.hp <= 0 || ally.hp >= ally.maxHp) continue;
        if (dist(ally, e) > heal.radius) continue;
        ally.hp = Math.min(ally.maxHp, ally.hp + heal.amount);
        healed.push(ally.id);
      }
      if (healed.length > 0) state.events.push({ type: 'heal', id: e.id, x: e.x, y: e.y, radius: heal.radius, healed });
    }
  }
  const shadow = abilityOf(e, 'shadow');
  if (shadow && !e.hidden) {
    e.abilityTimer -= dt;
    if (e.abilityTimer <= 0) e.hidden = true;
  }
  const evolve = abilityOf(e, 'evolve');
  if (evolve) {
    e.abilityTimer -= dt;
    if (e.abilityTimer <= 0) evolveInto(state, e, evolve.into);
  }
  const building = abilityOf(e, 'building');
  // Buildings wear down on their own, like every Clash Royale building.
  if (building) e.hp -= (e.maxHp / building.lifetime) * dt;
  const rage = abilityOf(e, 'rage');
  if (rage && !e.enraged && e.hp < e.maxHp * rage.below) {
    e.enraged = true;
    state.events.push({ type: 'rage', id: e.id });
  }
  if (abilityOf(e, 'jump')) e.jumpCooldown = Math.max(0, e.jumpCooldown - dt);
}

/** Moves a Jump Kick along its arc and lands it. */
function flyJump(state: MatchState, e: Entity, dt: number) {
  const j = e.jump!;
  j.t = Math.min(j.seconds, j.t + dt);
  const k = j.t / j.seconds;
  e.x = j.fromX + (j.toX - j.fromX) * k;
  e.y = j.fromY + (j.toY - j.fromY) * k;
  if (j.t < j.seconds) return;
  e.jump = null;
  const jump = abilityOf(e, 'jump')!;
  e.jumpCooldown = jump.cooldown;
  e.cooldown = statsOf(e).hitSpeed * 0.5;
  slam(state, e, jump.damageMult, jump.radius, jump.knockback);
}

/** Area hit centred on `e`, with knockback away from it. */
function slam(state: MatchState, e: Entity, mult: number, radius: number, knockback: number) {
  state.events.push({ type: 'slam', id: e.id, x: e.x, y: e.y, radius });
  const inBlast = state.entities.filter((v) => v.team !== e.team && v.hp > 0 && dist(v, e) - statsOf(v).radius <= radius);
  applyDamage(state, e, null, e, mult, radius);
  for (const v of inBlast) {
    const d = Math.max(0.01, dist(v, e));
    knock(state, v, (v.x - e.x) / d, (v.y - e.y) / d, knockback);
  }
}

/** Shove a ground troop along a direction. Structures and fliers don't budge. */
function knock(state: MatchState, v: Entity, dx: number, dy: number, distance: number) {
  if (distance <= 0 || isStructure(v) || statsOf(v).flying || v.hp <= 0) return;
  v.x += dx * distance;
  v.y += dy * distance;
  v.charge = 0;
  state.events.push({ type: 'knock', id: v.id });
}

function evolveInto(state: MatchState, e: Entity, into: FormId) {
  const from = e.defId as UnitId;
  const stats = FORMS[into].stats;
  e.defId = into;
  // Evolution is a reward for surviving: the new form arrives at full strength.
  e.maxHp = stats.hp;
  e.hp = stats.hp;
  e.cooldown = stats.hitSpeed * 0.5;
  e.targetId = null;
  e.abilityTimer = 0;
  state.events.push({ type: 'evolve', id: e.id, from, into, x: e.x, y: e.y });
}

export function canTarget(attacker: Entity, target: Entity): boolean {
  if (target.team === attacker.team || target.hp <= 0 || target.hidden) return false;
  const s = statsOf(attacker).targets;
  if (s === 'buildings') return isStructure(target);
  if (s === 'ground') return !statsOf(target).flying;
  return true;
}

/** Edge-to-edge distance. */
function gap(a: Entity, b: Entity): number {
  return dist(a, b) - statsOf(a).radius - statsOf(b).radius;
}

function inRange(a: Entity, b: Entity): boolean {
  return gap(a, b) <= statsOf(a).range;
}

function nearest(state: MatchState, from: Entity, filter: (e: Entity) => boolean): Entity | null {
  let best: Entity | null = null;
  let bestGap = Infinity;
  for (const e of state.entities) {
    if (!filter(e)) continue;
    const g = gap(from, e);
    if (g < bestGap) {
      best = e;
      bestGap = g;
    }
  }
  return best;
}

function updateTower(state: MatchState, tower: Entity, byId: Map<string, Entity>): void {
  if (!tower.active) return;
  let target = tower.targetId ? byId.get(tower.targetId) : undefined;
  if (!target || !canTarget(tower, target) || !inRange(tower, target)) {
    target = nearest(state, tower, (e) => canTarget(tower, e) && inRange(tower, e)) ?? undefined;
    tower.targetId = target?.id ?? null;
  }
  if (target && tower.cooldown <= 0) attack(state, tower, target);
}

function updateUnit(state: MatchState, unit: Entity, byId: Map<string, Entity>, dt: number): void {
  const stats = statsOf(unit);
  let target = unit.targetId ? byId.get(unit.targetId) : undefined;
  // Keep a target while it's attackable; otherwise retarget (enemies in sight first, then towers).
  if (!target || !canTarget(unit, target) || (!inRange(unit, target) && target.kind === 'unit' && gap(unit, target) > stats.sightRange)) {
    target =
      nearest(state, unit, (e) => canTarget(unit, e) && gap(unit, e) <= stats.sightRange) ??
      nearest(state, unit, (e) => canTarget(unit, e) && isStructure(e)) ??
      undefined;
    unit.targetId = target?.id ?? null;
  } else if (isStructure(target) && !inRange(unit, target)) {
    // Walking to a tower: divert to any enemy that comes into sight.
    const diversion = nearest(state, unit, (e) => e.kind === 'unit' && canTarget(unit, e) && gap(unit, e) <= stats.sightRange);
    if (diversion) {
      target = diversion;
      unit.targetId = diversion.id;
    }
  }
  if (!target) return;

  const jump = abilityOf(unit, 'jump');
  if (jump && unit.jumpCooldown <= 0 && !statsOf(target).flying) {
    const g = gap(unit, target);
    if (g >= jump.minRange && g <= jump.maxRange) {
      // Land just short of the target, touching it.
      const d = dist(unit, target);
      const stop = (stats.radius + statsOf(target).radius) / d;
      const toX = target.x + (unit.x - target.x) * stop;
      const toY = target.y + (unit.y - target.y) * stop;
      unit.jump = { fromX: unit.x, fromY: unit.y, toX, toY, t: 0, seconds: jump.seconds };
      state.events.push({ type: 'jump', id: unit.id, x: unit.x, y: unit.y, tx: toX, ty: toY, seconds: jump.seconds });
      return;
    }
  }

  if (inRange(unit, target)) {
    if (unit.cooldown <= 0) attack(state, unit, target);
    return;
  }
  const charge = abilityOf(unit, 'charge');
  const rage = abilityOf(unit, 'rage');
  const wasCharging = isCharging(unit);
  const speed = stats.speed * (wasCharging && charge ? charge.speedMult : 1) * (rage && unit.enraged ? rage.speedMult : 1);
  const moved = moveToward(unit, steerAround(state, unit, nextWaypoint(unit, target), target), speed * dt);
  if (charge) {
    unit.charge += moved;
    if (!wasCharging && isCharging(unit)) state.events.push({ type: 'charge', id: unit.id });
  }
}

/** Ground units cross the river only on bridges; leapers and fliers go straight. */
function nextWaypoint(unit: Entity, target: Entity): Point {
  if (statsOf(unit).flying || abilityOf(unit, 'riverLeap')) return target;
  const from = riverSide(unit.y);
  if (from === riverSide(target.y) && !inRiver(unit.y)) return target;

  const bridgeX = BRIDGE_XS.reduce((best, bx) =>
    Math.abs(unit.x - bx) + Math.abs(target.x - bx) < Math.abs(unit.x - best) + Math.abs(target.x - best) ? bx : best,
  );
  const onBridge = Math.abs(unit.x - bridgeX) <= BRIDGE_HALF_WIDTH * 0.6;
  // Heading "up" means from the bottom side towards y=0.
  const goingUp = inRiver(unit.y) ? riverSide(target.y) === 'top' : from === 'bottom';
  const entryY = goingUp ? RIVER_BOTTOM + 0.5 : RIVER_TOP - 0.5;
  const exitY = goingUp ? RIVER_TOP - 0.6 : RIVER_BOTTOM + 0.6;
  if (!onBridge) return { x: bridgeX, y: inRiver(unit.y) ? unit.y : entryY };
  return { x: bridgeX, y: exitY };
}

/**
 * Ground units walk straight at their waypoint, and towers only push them back out along the
 * line between centres — so a unit directly behind a tower would push into it forever. If a
 * structure other than the target blocks the straight path, head for a point beside it on
 * the side nearer the way we're going; once past, the straight path is clear again.
 */
function steerAround(state: MatchState, unit: Entity, to: Point, target: Entity): Point {
  const stats = statsOf(unit);
  if (stats.flying) return to;
  const dx = to.x - unit.x;
  const dy = to.y - unit.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return to;
  const ux = dx / len;
  const uy = dy / len;
  let block: { s: Entity; along: number; side: number; clear: number } | null = null;
  for (const s of state.entities) {
    if (s === target || s.hp <= 0 || !isStructure(s)) continue;
    const clear = statsOf(s).radius + stats.radius + 0.2;
    const sx = s.x - unit.x;
    const sy = s.y - unit.y;
    const along = sx * ux + sy * uy;
    // Sideways offset of the structure along n = (-uy, ux), the normal we'll step along.
    const offset = -sx * uy + sy * ux;
    if (along <= -clear * 0.5 || along > len + clear || Math.abs(offset) >= clear) continue;
    if (!block || along < block.along) {
      // Pass on the side away from the structure (stable: stepping that way only grows the
      // offset). Dead centre: the side towards the middle of the arena, then a fixed side.
      const towardMiddle = Math.sign((ARENA_W / 2 - s.x) * -uy);
      const side = Math.abs(offset) > 1e-3 ? -Math.sign(offset) : towardMiddle || (unit.team === 0 ? 1 : -1);
      block = { s, along, side, clear };
    }
  }
  if (!block) return to;
  // A point beside the structure, a little past its centre, along our direction of travel.
  const nx = -uy * block.side;
  const ny = ux * block.side;
  return {
    x: block.s.x + nx * block.clear * 1.15 + ux * 0.4,
    y: block.s.y + ny * block.clear * 1.15 + uy * 0.4,
  };
}

/** Returns the distance actually moved. */
function moveToward(e: Entity, to: Point, maxStep: number): number {
  const d = dist(e, to);
  if (d < 1e-6) return 0;
  const s = Math.min(maxStep, d);
  e.x += ((to.x - e.x) / d) * s;
  e.y += ((to.y - e.y) / d) * s;
  return s;
}

function attack(state: MatchState, attacker: Entity, target: Entity): void {
  const stats = statsOf(attacker);
  attacker.cooldown = stats.hitSpeed;
  state.events.push({ type: 'attack', id: attacker.id, targetId: target.id });
  let mult = 1;
  const charge = abilityOf(attacker, 'charge');
  if (charge) {
    if (isCharging(attacker)) mult = charge.damageMult;
    attacker.charge = 0;
  }
  const ramp = abilityOf(attacker, 'ramp');
  if (ramp) {
    if (attacker.rampTarget === target.id) attacker.rampHits += 1;
    else {
      attacker.rampTarget = target.id;
      attacker.rampHits = 0;
    }
    mult = ramp.multipliers[Math.min(Math.floor(attacker.rampHits / ramp.hitsPerStage), ramp.multipliers.length - 1)]!;
  }
  const shadow = abilityOf(attacker, 'shadow');
  if (shadow) {
    attacker.hidden = false;
    attacker.abilityTimer = shadow.revealSeconds;
  }
  if (stats.kamikaze) {
    applyDamage(state, attacker, target, target);
    attacker.hp = 0;
    return;
  }
  if (abilityOf(attacker, 'spin')) {
    // Fury Cutter: the blades sweep a circle around the attacker itself.
    applyDamage(state, attacker, target, attacker, mult, stats.splashRadius + stats.radius);
    return;
  }
  const line = abilityOf(attacker, 'line');
  if (line) {
    const d = Math.max(0.01, dist(attacker, target));
    state.projectiles.push({
      id: newId(state), team: attacker.team, sourceDefId: attacker.defId, x: attacker.x, y: attacker.y,
      targetId: '', tx: target.x, ty: target.y,
      line: { dx: (target.x - attacker.x) / d, dy: (target.y - attacker.y) / d, travel: line.length, hit: [] },
    });
    return;
  }
  if (stats.projectileSpeed > 0) {
    state.projectiles.push({
      id: newId(state), team: attacker.team, sourceDefId: attacker.defId,
      x: attacker.x, y: attacker.y, targetId: target.id, tx: target.x, ty: target.y, line: null,
    });
    return;
  }
  const chain = abilityOf(attacker, 'chain');
  if (chain) {
    // Chain Lightning: target first, then up to `jumps` fresh enemies near the last one.
    const path = [target];
    while (path.length <= chain.jumps) {
      const last = path[path.length - 1]!;
      const next = nearest(state, last, (e) => canTarget(attacker, e) && !path.includes(e) && dist(e, last) <= chain.range);
      if (!next) break;
      path.push(next);
    }
    for (const v of path) {
      applyDamage(state, attacker, v, v, mult);
      v.stun = Math.max(v.stun, chain.stun);
      v.charge = 0;
    }
    state.events.push({ type: 'chain', id: attacker.id, path: [attacker.id, ...path.map((v) => v.id)] });
    return;
  }
  applyDamage(state, attacker, target, target, mult);
}

/** Damage `target`, or everything in splash radius around `at`, applying on-hit statuses. */
function applyDamage(state: MatchState, source: Pick<Entity, 'team' | 'kind' | 'defId'>, target: Entity | null, at: Point, mult = 1, radius?: number): void {
  const stats = statsOf(source);
  const splash = radius ?? stats.splashRadius;
  const victims = splash > 0
    ? state.entities.filter((e) => e.team !== source.team && e.hp > 0 && dist(e, at) - statsOf(e).radius <= splash && splashCanHit(stats, e))
    : target && target.hp > 0 ? [target] : [];
  const stun = abilityOf(source, 'stun');
  const slow = abilityOf(source, 'slow');
  for (const v of victims) {
    hurt(state, v, Math.round(stats.damage * mult * typeMultiplier(stats.move.type, statsOf(v).types)), stats.move.type, stun ? 'stun' : slow ? 'slow' : undefined);
    if (stun) {
      v.stun = Math.max(v.stun, stun.seconds);
      v.charge = 0;
    }
    if (slow) {
      v.slow = Math.max(v.slow, slow.seconds);
      v.slowFactor = Math.min(v.slowFactor, slow.factor);
    }
  }
}

function hurt(state: MatchState, v: Entity, damage: number, moveType: PokeType, status?: 'stun' | 'slow') {
  if (v.shield > 0 && damage > 0) {
    // Barrier soaks the hit first; overflow carries on to health.
    const soaked = Math.min(v.shield, damage);
    v.shield -= soaked;
    v.hp -= damage - soaked;
    if (v.shield === 0) state.events.push({ type: 'shieldBreak', id: v.id });
  } else {
    v.hp -= damage;
  }
  if (v.kind === 'king' && damage > 0) v.active = true;
  state.events.push({ type: 'hit', targetId: v.id, x: v.x, y: v.y, damage, effectiveness: effectivenessLabel(moveType, statsOf(v).types), ...(status ? { status } : {}) });
}

/** Area damage not tied to an attacker's stats (death explosions). */
function blast(state: MatchState, team: Team, at: Point, radius: number, damage: number, moveType: PokeType) {
  for (const v of state.entities) {
    if (v.team === team || v.hp <= 0 || dist(v, at) - statsOf(v).radius > radius) continue;
    hurt(state, v, Math.round(damage * typeMultiplier(moveType, statsOf(v).types)), moveType);
  }
}

function splashCanHit(stats: CombatStats, e: Entity): boolean {
  if (stats.targets === 'ground') return !statsOf(e).flying;
  return true;
}

function updateProjectiles(state: MatchState, byId: Map<string, Entity>, dt: number): void {
  const remaining: Projectile[] = [];
  for (const p of state.projectiles) {
    if (p.line) {
      if (flyLine(state, p, dt)) remaining.push(p);
      continue;
    }
    const target = byId.get(p.targetId);
    const alive = target !== undefined && target.hp > 0;
    if (alive) {
      p.tx = target.x;
      p.ty = target.y;
    }
    const source = { team: p.team, kind: kindOfDef(p.sourceDefId), defId: p.sourceDefId };
    const speed = statsOf(source).projectileSpeed;
    const d = Math.hypot(p.tx - p.x, p.ty - p.y);
    if (d <= speed * dt) {
      const hasSplash = statsOf(source).splashRadius > 0;
      if (alive || hasSplash) applyDamage(state, source, alive ? target : null, { x: p.tx, y: p.ty });
      continue;
    }
    p.x += ((p.tx - p.x) / d) * speed * dt;
    p.y += ((p.ty - p.y) / d) * speed * dt;
    remaining.push(p);
  }
  state.projectiles = remaining;
}

/** Advances a line shot, hitting each enemy it passes once. Returns false when it's spent. */
function flyLine(state: MatchState, p: Projectile, dt: number): boolean {
  const line = p.line!;
  const source = { team: p.team, kind: kindOfDef(p.sourceDefId), defId: p.sourceDefId };
  const stats = statsOf(source);
  const ability = abilityOf(source, 'line')!;
  const step = Math.min(line.travel, stats.projectileSpeed * dt);
  const from = { x: p.x, y: p.y };
  p.x += line.dx * step;
  p.y += line.dy * step;
  line.travel -= step;
  for (const v of state.entities) {
    if (v.team === p.team || v.hp <= 0 || v.hidden || line.hit.includes(v.id)) continue;
    if (stats.targets === 'ground' && statsOf(v).flying) continue;
    if (distToSegment(v, from, p) > ability.width + statsOf(v).radius) continue;
    line.hit.push(v.id);
    applyDamage(state, source, v, v);
    knock(state, v, line.dx, line.dy, ability.knockback);
  }
  return line.travel > 1e-6;
}

function distToSegment(pt: Point, a: Point, b: Point): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const len2 = vx * vx + vy * vy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((pt.x - a.x) * vx + (pt.y - a.y) * vy) / len2));
  return Math.hypot(pt.x - (a.x + vx * t), pt.y - (a.y + vy * t));
}

/** Poison clouds pulse damage to every enemy inside, towers and fliers included. */
function updateZones(state: MatchState, dt: number): void {
  for (const z of state.zones) {
    z.timeLeft -= dt;
    z.tick -= dt;
    if (z.tick > 0) continue;
    z.tick += ZONE_TICK;
    for (const v of state.entities) {
      if (v.team === z.team || v.hp <= 0 || dist(v, z) - statsOf(v).radius > z.radius) continue;
      hurt(state, v, Math.round(z.dps * ZONE_TICK * typeMultiplier(z.type, statsOf(v).types)), z.type);
    }
  }
  state.zones = state.zones.filter((z) => z.timeLeft > 0);
}

function kindOfDef(defId: Entity['defId']): EntityKind {
  if (defId === 'trainer') return 'king';
  return defId in STARTERS ? 'princess' : 'unit';
}

/** True for troops that may stand in the river (fliers, leapers, and anyone mid-jump). */
function crossesWater(e: Entity): boolean {
  return statsOf(e).flying || abilityOf(e, 'riverLeap') !== null || e.jump !== null;
}

/** Push overlapping units apart and out of towers; keep ground units off the water. */
function separate(state: MatchState): void {
  // Buildings stand their ground like towers; troops mid-jump are in the air.
  const units = state.entities.filter((e) => !isStructure(e) && e.hp > 0 && !e.jump);
  const towers = state.entities.filter((e) => isStructure(e) && e.hp > 0);
  for (let i = 0; i < units.length; i++) {
    const a = units[i]!;
    const sa = statsOf(a);
    for (let j = i + 1; j < units.length; j++) {
      const b = units[j]!;
      const sb = statsOf(b);
      if (sa.flying !== sb.flying) continue;
      pushApart(a, b, sa.radius + sb.radius, 0.5);
    }
    if (!sa.flying) {
      for (const t of towers) pushApart(a, t, sa.radius + statsOf(t).radius, 1);
    }
  }
  for (const u of units) {
    u.x = clamp(u.x, 0.3, ARENA_W - 0.3);
    u.y = clamp(u.y, 0.3, ARENA_H - 0.3);
    if (!crossesWater(u) && inRiver(u.y) && !onBridgeColumn(u.x)) {
      u.y = riverSide(u.y) === 'bottom' ? RIVER_BOTTOM : RIVER_TOP;
    }
  }
}

/** Moves `a` (and `b` by the remaining share) so they no longer overlap. shareA=1 moves only `a`. */
function pushApart(a: Entity, b: Entity, minDist: number, shareA: number): void {
  let dx = a.x - b.x;
  let dy = a.y - b.y;
  let d = Math.hypot(dx, dy);
  if (d >= minDist) return;
  if (d < 1e-6) {
    // Deterministic nudge for exactly stacked entities.
    dx = a.id < b.id ? 1 : -1;
    dy = 0;
    d = 1;
  }
  const overlap = minDist - Math.hypot(a.x - b.x, a.y - b.y);
  const nx = dx / d;
  const ny = dy / d;
  a.x += nx * overlap * shareA;
  a.y += ny * overlap * shareA;
  if (shareA < 1) {
    b.x -= nx * overlap * (1 - shareA);
    b.y -= ny * overlap * (1 - shareA);
  }
}

function resolveDeaths(state: MatchState): void {
  const kingsLost = new Set<Team>();
  // Explosions can kill more troops, so keep resolving until nothing else falls.
  for (let dead = state.entities.filter((e) => e.hp <= 0); dead.length > 0; dead = state.entities.filter((e) => e.hp <= 0)) {
    state.entities = state.entities.filter((e) => e.hp > 0);
    for (const e of dead) resolveDeath(state, e, kingsLost);
  }
  if (kingsLost.size > 0) {
    state.phase = 'ended';
    state.timeLeft = 0;
    state.result = kingsLost.size === 2
      ? { winner: null, reason: 'draw' }
      : { winner: kingsLost.has(0) ? 1 : 0, reason: 'king' };
    return;
  }
  const [a, b] = state.players;
  if (state.phase === 'overtime' && a.crowns !== b.crowns) endWithCrowns(state, 'crowns');
}

function resolveDeath(state: MatchState, e: Entity, kingsLost: Set<Team>): void {
  state.events.push({ type: 'death', id: e.id, kind: e.kind, team: e.team, x: e.x, y: e.y });
  const enemy = state.players[1 - e.team]!;
  if (e.kind === 'princess') {
    enemy.crowns += 1;
    const king = state.entities.find((k) => k.team === e.team && k.kind === 'king');
    if (king) king.active = true;
  }
  if (e.kind === 'king') {
    kingsLost.add(e.team);
    enemy.crowns = 3;
    // The trainer falling takes the remaining towers with it.
    state.entities = state.entities.filter((t) => !(t.team === e.team && t.kind === 'princess'));
  }
  const cloud = e.kind === 'unit' ? abilityOf(e, 'deathCloud') : null;
  if (cloud) {
    const z: Zone = { id: newId(state), team: e.team, x: e.x, y: e.y, radius: cloud.radius, dps: cloud.dps, type: cloud.type, timeLeft: cloud.seconds, tick: ZONE_TICK };
    state.zones.push(z);
    state.events.push({ type: 'cloud', id: z.id, team: e.team, x: e.x, y: e.y, radius: cloud.radius, seconds: cloud.seconds });
  }
  const boom = e.kind === 'unit' ? abilityOf(e, 'deathBlast') : null;
  if (boom) {
    state.events.push({ type: 'blast', id: e.id, team: e.team, x: e.x, y: e.y, radius: boom.radius });
    blast(state, e.team, e, boom.radius, boom.damage, boom.type);
  }
}

function endWithCrowns(state: MatchState, reason: ResultReason): void {
  const [a, b] = state.players;
  state.phase = 'ended';
  state.timeLeft = 0;
  state.result = { winner: a.crowns > b.crowns ? 0 : 1, reason };
}

function endOfPhase(state: MatchState): void {
  const [a, b] = state.players;
  if (a.crowns !== b.crowns) return endWithCrowns(state, 'crowns');
  if (state.phase === 'regular') {
    state.phase = 'overtime';
    state.timeLeft = state.rules.overtimeSeconds;
    return;
  }
  // Overtime ran out with equal crowns: a draw, or (with the tiebreak) the side whose weakest
  // tower is healthier wins.
  const weakest = ([0, 1] as const).map((team) => weakestTower(state.entities, team));
  state.phase = 'ended';
  state.timeLeft = 0;
  if (!state.rules.tiebreak || weakest[0] === weakest[1]) state.result = { winner: null, reason: 'draw' };
  else state.result = { winner: weakest[0]! > weakest[1]! ? 0 : 1, reason: 'tiebreak' };
}

/** Health fraction (0..1) of `team`'s most damaged standing tower; the tiebreak compares these. */
export function weakestTower(entities: Iterable<{ team: number; kind: string; hp: number; maxHp: number }>, team: Team): number {
  let min = 1;
  for (const e of entities) if (e.team === team && e.kind !== 'unit') min = Math.min(min, e.hp / e.maxHp);
  return min;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
