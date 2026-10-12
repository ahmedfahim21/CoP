import {
  ARENA_H, ARENA_W, BRIDGE_HALF_WIDTH, BRIDGE_XS, KING_POS, PRINCESS_POS, RIVER_BOTTOM, RIVER_TOP,
  dist, inRiver, isValidDeploy, laneOf, mirror, onBridgeColumn, riverSide,
  type Lane, type Point, type Team,
} from './arena.js';
import { CARDS, DEFAULT_DECK, type CardId, type CombatStats } from './cards.js';
import { STARTERS, TRAINER, type StarterId, type StarterPick } from './starters.js';
import { effectivenessLabel, typeMultiplier, type Effectiveness } from './types.js';

export const COUNTDOWN_SECONDS = 3;
export const REGULAR_SECONDS = 180;
export const OVERTIME_SECONDS = 60;
export const DOUBLE_ELIXIR_AT = 60;
export const ELIXIR_START = 5;
export const ELIXIR_MAX = 10;
export const ELIXIR_PER_SECOND = 1 / 2.8;
export const DEPLOY_SECONDS = 1;
export const HAND_SIZE = 4;

export type Phase = 'countdown' | 'regular' | 'overtime' | 'ended';
export type EntityKind = 'unit' | 'king' | 'princess';
export type ResultReason = 'king' | 'crowns' | 'tiebreak' | 'draw' | 'forfeit';

export interface Entity {
  id: string;
  team: Team;
  kind: EntityKind;
  /** CardId for units, StarterId for princess towers, 'trainer' for the king. */
  defId: CardId | StarterId | 'trainer';
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
}

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
  | { type: 'hit'; targetId: string; x: number; y: number; damage: number; effectiveness: Effectiveness }
  | { type: 'death'; id: string; kind: EntityKind; team: Team; x: number; y: number }
  | { type: 'spawn'; team: Team; cardId: CardId; x: number; y: number };

export interface MatchState {
  phase: Phase;
  /** Seconds left in the current phase. */
  timeLeft: number;
  nextId: number;
  rngState: number;
  entities: Entity[];
  projectiles: Projectile[];
  players: [PlayerState, PlayerState];
  result: MatchResult | null;
  /** Events produced by the most recent step/playCard; cleared at the start of each step. */
  events: GameEvent[];
}

export function statsOf(e: Pick<Entity, 'kind' | 'defId'>): CombatStats {
  if (e.kind === 'king') return TRAINER.stats;
  if (e.kind === 'princess') return STARTERS[e.defId as StarterId].stats;
  return CARDS[e.defId as CardId].stats;
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

function addEntity(state: MatchState, partial: Omit<Entity, 'id' | 'hp' | 'maxHp' | 'cooldown' | 'targetId'>): Entity {
  const stats = statsOf(partial);
  const e: Entity = { ...partial, id: newId(state), hp: stats.hp, maxHp: stats.hp, cooldown: stats.hitSpeed * 0.5, targetId: null };
  state.entities.push(e);
  return e;
}

export function createMatch(starters: [StarterPick, StarterPick], seed: number): MatchState {
  const state: MatchState = {
    phase: 'countdown',
    timeLeft: COUNTDOWN_SECONDS,
    nextId: 1,
    rngState: seed | 0,
    entities: [],
    projectiles: [],
    players: [emptyPlayer(starters[0]), emptyPlayer(starters[1])],
    result: null,
    events: [],
  };
  for (const team of [0, 1] as const) {
    const deck = shuffled(state, DEFAULT_DECK);
    state.players[team].hand = deck.slice(0, HAND_SIZE);
    state.players[team].queue = deck.slice(HAND_SIZE);

    const king = mirror(team, KING_POS);
    addEntity(state, { team, kind: 'king', defId: 'trainer', ...king, deployTimer: 0, active: false, lane: null });
    (['left', 'right'] as const).forEach((lane, i) => {
      const p = mirror(team, PRINCESS_POS[lane]);
      addEntity(state, { team, kind: 'princess', defId: starters[team][i]!, ...p, deployTimer: 0, active: true, lane });
    });
  }
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
  if (!isValidDeploy(local, openPockets(state, team))) return { ok: false, error: 'bad-position' };

  player.elixir -= card.cost;
  const next = player.queue.shift()!;
  player.hand[slot] = next;
  player.queue.push(cardId);

  const offsets = FORMATIONS[card.count];
  if (!offsets) throw new Error(`No formation for count ${card.count}`);
  const units = offsets.map((o) => {
    const world = mirror(team, { x: clamp(local.x + o.x, 0.3, ARENA_W - 0.3), y: clamp(local.y + o.y, 0.3, ARENA_H - 0.3) });
    return addEntity(state, { team, kind: 'unit', defId: cardId, ...world, deployTimer: DEPLOY_SECONDS, active: true, lane: null });
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
      state.timeLeft = REGULAR_SECONDS;
    }
    return;
  }

  const rate = isDoubleElixir(state) ? ELIXIR_PER_SECOND * 2 : ELIXIR_PER_SECOND;
  for (const p of state.players) p.elixir = Math.min(ELIXIR_MAX, p.elixir + rate * dt);

  const byId = new Map(state.entities.map((e) => [e.id, e]));
  for (const e of state.entities) {
    if (e.hp <= 0) continue;
    if (e.deployTimer > 0) {
      e.deployTimer = Math.max(0, e.deployTimer - dt);
      continue;
    }
    e.cooldown = Math.max(0, e.cooldown - dt);
    if (e.kind === 'unit') updateUnit(state, e, byId, dt);
    else updateTower(state, e, byId);
  }
  updateProjectiles(state, byId, dt);
  separate(state);
  resolveDeaths(state);

  // resolveDeaths may have ended the match; TS can't see the mutation.
  if ((state.phase as Phase) === 'ended') return;
  state.timeLeft -= dt;
  if (state.timeLeft <= 0) endOfPhase(state);
}

export function isDoubleElixir(state: MatchState): boolean {
  return state.phase === 'overtime' || (state.phase === 'regular' && state.timeLeft <= DOUBLE_ELIXIR_AT);
}

export function canTarget(attacker: Entity, target: Entity): boolean {
  if (target.team === attacker.team || target.hp <= 0) return false;
  const s = statsOf(attacker).targets;
  if (s === 'buildings') return target.kind !== 'unit';
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
      nearest(state, unit, (e) => canTarget(unit, e) && e.kind !== 'unit') ??
      undefined;
    unit.targetId = target?.id ?? null;
  } else if (target.kind !== 'unit' && !inRange(unit, target)) {
    // Walking to a tower: divert to any enemy that comes into sight.
    const diversion = nearest(state, unit, (e) => e.kind === 'unit' && canTarget(unit, e) && gap(unit, e) <= stats.sightRange);
    if (diversion) {
      target = diversion;
      unit.targetId = diversion.id;
    }
  }
  if (!target) return;

  if (inRange(unit, target)) {
    if (unit.cooldown <= 0) attack(state, unit, target);
    return;
  }
  moveToward(unit, nextWaypoint(unit, target), stats.speed * dt);
}

/** Ground units cross the river only on bridges. */
function nextWaypoint(unit: Entity, target: Entity): Point {
  if (statsOf(unit).flying) return target;
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

function moveToward(e: Entity, to: Point, maxStep: number): void {
  const d = dist(e, to);
  if (d < 1e-6) return;
  const s = Math.min(maxStep, d);
  e.x += ((to.x - e.x) / d) * s;
  e.y += ((to.y - e.y) / d) * s;
}

function attack(state: MatchState, attacker: Entity, target: Entity): void {
  const stats = statsOf(attacker);
  attacker.cooldown = stats.hitSpeed;
  if (stats.kamikaze) {
    applyDamage(state, attacker, target, target);
    attacker.hp = 0;
    return;
  }
  if (stats.projectileSpeed > 0) {
    state.projectiles.push({
      id: newId(state), team: attacker.team, sourceDefId: attacker.defId,
      x: attacker.x, y: attacker.y, targetId: target.id, tx: target.x, ty: target.y,
    });
    return;
  }
  applyDamage(state, attacker, target, target);
}

/** Damage `target`, or everything in splash radius around `at`. */
function applyDamage(state: MatchState, source: Pick<Entity, 'team' | 'kind' | 'defId'>, target: Entity | null, at: Point): void {
  const stats = statsOf(source);
  const victims = stats.splashRadius > 0
    ? state.entities.filter((e) => e.team !== source.team && e.hp > 0 && dist(e, at) - statsOf(e).radius <= stats.splashRadius && splashCanHit(stats, e))
    : target && target.hp > 0 ? [target] : [];
  for (const v of victims) {
    const vStats = statsOf(v);
    const damage = Math.round(stats.damage * typeMultiplier(stats.move.type, vStats.types));
    v.hp -= damage;
    if (v.kind === 'king') v.active = true;
    state.events.push({ type: 'hit', targetId: v.id, x: v.x, y: v.y, damage, effectiveness: effectivenessLabel(stats.move.type, vStats.types) });
  }
}

function splashCanHit(stats: CombatStats, e: Entity): boolean {
  if (stats.targets === 'ground') return !statsOf(e).flying;
  return true;
}

function updateProjectiles(state: MatchState, byId: Map<string, Entity>, dt: number): void {
  const remaining: Projectile[] = [];
  for (const p of state.projectiles) {
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

function kindOfDef(defId: Entity['defId']): EntityKind {
  if (defId === 'trainer') return 'king';
  return defId in STARTERS ? 'princess' : 'unit';
}

/** Push overlapping units apart and out of towers; keep ground units off the water. */
function separate(state: MatchState): void {
  const units = state.entities.filter((e) => e.kind === 'unit' && e.hp > 0);
  const towers = state.entities.filter((e) => e.kind !== 'unit' && e.hp > 0);
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
    if (!statsOf(u).flying && inRiver(u.y) && !onBridgeColumn(u.x)) {
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
  const dead = state.entities.filter((e) => e.hp <= 0);
  if (dead.length === 0) return;
  state.entities = state.entities.filter((e) => e.hp > 0);
  const kingsLost = new Set<Team>();
  for (const e of dead) {
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
    state.timeLeft = OVERTIME_SECONDS;
    return;
  }
  // Overtime ran out with equal crowns: the side whose weakest tower is healthier wins.
  const weakest = ([0, 1] as const).map((team) =>
    Math.min(...state.entities.filter((e) => e.team === team && e.kind !== 'unit').map((t) => t.hp / t.maxHp)),
  );
  state.phase = 'ended';
  state.timeLeft = 0;
  if (weakest[0] === weakest[1]) state.result = { winner: null, reason: 'draw' };
  else state.result = { winner: weakest[0]! > weakest[1]! ? 0 : 1, reason: 'tiebreak' };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
