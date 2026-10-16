import { ARENA_H, ARENA_W, BRIDGE_XS, DEPLOY_MIN_Y, PRINCESS_POS, POCKET_MIN_Y, hypot, laneOf, mirror, type Lane, type Point, type Team } from './arena.js';
import { CARDS, type CardId } from './cards.js';
import { ELIXIR_MAX, canDeployCard, isDoubleElixir, isStructure, openPockets, statsOf, type Entity, type MatchState } from './sim.js';
import { typeMultiplier } from './types.js';

/**
 * A training opponent. It reads the same state the server simulates and answers with
 * the same `play` a human would send, so it can't do anything a player couldn't.
 * Everything is in the bot's own perspective: its side at the bottom (y > 16).
 */

export interface BotPlay extends Point {
  slot: number;
}

interface Seen {
  e: Entity;
  /** Own-perspective position. */
  x: number;
  y: number;
}

/** How far up the field (own perspective) an enemy counts as a threat. */
const THREAT_LINE = 13;

/** How well the bot plays. */
export interface BotSkill {
  /** Mean seconds between decisions; higher is easier. */
  reaction: number;
  /** Chance, each decision, that it notices a threat and answers it. */
  vigilance: number;
  /** Chance a play lands somewhere random (but legal) instead of where it planned. */
  sloppiness: number;
  /** Whether it backs up its own tanks with support troops. */
  supports: boolean;
}

/** The full-strength bot (and the default). */
export const ACE_SKILL: BotSkill = { reaction: 0.9, vigilance: 1, sloppiness: 0, supports: true };
export const ROOKIE_SKILL: BotSkill = { reaction: 2.2, vigilance: 0.4, sloppiness: 0.4, supports: false };

/** Trophies at which the ladder bot reaches full strength. */
export const ACE_TROPHIES = 2000;

/** Bot strength for a player with `trophies`: a rookie at 0, the ace from ACE_TROPHIES up. */
export function skillForTrophies(trophies: number): BotSkill {
  return lerpSkill(ROOKIE_SKILL, ACE_SKILL, Math.max(0, Math.min(1, trophies / ACE_TROPHIES)));
}

/** `k` = 0 is `a`, 1 is `b`. */
export function lerpSkill(a: BotSkill, b: BotSkill, k: number): BotSkill {
  if (k <= 0) return { ...a };
  if (k >= 1) return { ...b };
  const mix = (x: number, y: number) => x + (y - x) * k;
  return { reaction: mix(a.reaction, b.reaction), vigilance: mix(a.vigilance, b.vigilance), sloppiness: mix(a.sloppiness, b.sloppiness), supports: k >= 0.5 ? b.supports : a.supports };
}

export class Bot {
  private wait: number;

  constructor(readonly team: Team, private readonly rand: () => number, readonly skill: BotSkill = ACE_SKILL) {
    // Let the battle open before the first move.
    this.wait = 1.5 + rand() * 2;
  }

  /** Advance the bot's clock; returns a play when it decides to make one. */
  update(state: MatchState, dt: number): BotPlay | null {
    if (state.phase !== 'regular' && state.phase !== 'overtime') return null;
    this.wait -= dt;
    if (this.wait > 0) return null;
    const play = chooseBotPlay(state, this.team, this.rand, this.skill);
    this.wait = play ? this.skill.reaction * (0.6 + 0.8 * this.rand()) : 0.35;
    return play;
  }
}

/** One decision: defend what's coming, back up a push in progress, else start one when elixir is high. */
export function chooseBotPlay(state: MatchState, team: Team, rand: () => number, skill: BotSkill = ACE_SKILL): BotPlay | null {
  const plan = planBotPlay(state, team, rand, skill);
  if (!plan || skill.sloppiness <= 0 || rand() >= skill.sloppiness) return plan;
  // A fumble: same card, dropped somewhere in its own half.
  const id = state.players[team].hand[plan.slot]!;
  const pockets = openPockets(state, team);
  for (let i = 0; i < 6; i++) {
    const spot = { x: 1 + rand() * (ARENA_W - 2), y: DEPLOY_MIN_Y + 0.5 + rand() * (ARENA_H - DEPLOY_MIN_Y - 1.5) };
    if (canDeployCard(id, spot, pockets)) return { slot: plan.slot, ...spot };
  }
  return plan;
}

function planBotPlay(state: MatchState, team: Team, rand: () => number, skill: BotSkill): BotPlay | null {
  const me = state.players[team];
  const seen = state.entities.filter((e) => e.hp > 0).map((e): Seen => ({ e, ...mirror(team, e) }));
  const mine = seen.filter((s) => s.e.team === team && s.e.kind === 'unit');
  const threats = seen.filter((s) => s.e.team !== team && s.e.kind === 'unit' && !s.e.hidden && s.y >= THREAT_LINE);
  const affordable = me.hand
    .map((id, slot) => ({ id, slot }))
    .filter(({ id }) => CARDS[id].cost <= me.elixir);
  if (affordable.length === 0) return null;
  const pockets = openPockets(state, team);
  const legal = (slot: number, id: CardId, p: Point): BotPlay | null => {
    const at = clampPoint(p);
    return canDeployCard(id, at, pockets) ? { slot, ...at } : null;
  };

  if (threats.length > 0 && (skill.vigilance >= 1 || rand() < skill.vigilance)) {
    const defence = defend(threats, mine, affordable, legal, rand);
    if (defence) return defence;
  }

  // A tank walking up to the bridge is the moment to commit support behind it.
  const tank = mine.find((m) => isTank(m.e.defId as CardId) && m.y > DEPLOY_MIN_Y && m.y < 26);
  if (tank && skill.supports && me.elixir >= 4) {
    const support = affordable
      .filter(({ id }) => !isTank(id) && CARDS[id].stats.ability?.kind !== 'building' && CARDS[id].stats.ability?.kind !== 'dig')
      .sort((a, b) => supportValue(b.id) - supportValue(a.id))[0];
    if (support) {
      const play = legal(support.slot, support.id, { x: tank.x, y: Math.max(DEPLOY_MIN_Y + 0.5, tank.y + 1.8) });
      if (play) return play;
    }
  }

  const full = me.elixir >= ELIXIR_MAX - 0.3;
  const eager = me.elixir >= (isDoubleElixir(state) ? 6 : 8.5) && rand() < 0.25;
  if (!full && !eager) return null;
  return attack(seen, team, mine, affordable, pockets, legal, rand);
}

/** Ranged and splash troops make the best escorts. */
function supportValue(id: CardId): number {
  const s = CARDS[id].stats;
  return (s.range >= 3 ? 6 : 0) + (s.splashRadius > 0 ? 4 : 0) + (s.targets === 'air-ground' ? 2 : 0) - CARDS[id].cost * 0.5;
}

type Legal = (slot: number, id: CardId, p: Point) => BotPlay | null;

function defend(threats: Seen[], mine: Seen[], hand: Array<{ id: CardId; slot: number }>, legal: Legal, rand: () => number): BotPlay | null {
  // The deepest threat is the most urgent.
  const lead = threats.reduce((a, b) => (b.y > a.y ? b : a));
  const near = threats.filter((t) => hypot(t.x - lead.x, t.y - lead.y) < 4);
  const threatHp = near.reduce((sum, t) => sum + t.e.hp, 0);
  const defenders = mine.filter((m) => hypot(m.x - lead.x, m.y - lead.y) < 6 && !isStructure(m.e) && statsOf(m.e).targets !== 'buildings');
  const defenderHp = defenders.reduce((sum, d) => sum + d.e.hp, 0);
  // Already handled, or only a straggler the towers will deal with.
  if (defenderHp >= threatHp * 0.8) return null;
  if (threatHp < 450 && near.length < 3) return null;

  const flying = near.some((t) => statsOf(t.e).flying);
  const swarm = near.length >= 3;
  const towerSeekers = near.every((t) => statsOf(t.e).targets === 'buildings');
  let best: { id: CardId; slot: number; score: number } | null = null;
  for (const c of hand) {
    const s = CARDS[c.id].stats;
    if (s.targets === 'buildings') continue;
    if (flying && s.targets === 'ground' && near.every((t) => statsOf(t.e).flying)) continue;
    let score = 0;
    for (const t of near) score += typeMultiplier(s.move.type, statsOf(t.e).types) * 10;
    score /= near.length;
    if (swarm && s.splashRadius > 0) score += 20;
    if (swarm && CARDS[c.id].count > 1) score += 8;
    if (!swarm && threatHp > 1500 && s.damage * CARDS[c.id].count >= 300) score += 10;
    if (towerSeekers && s.ability?.kind === 'building') score += 25;
    if (s.kamikaze && swarm) score += 15;
    score -= CARDS[c.id].cost * 2.5;
    score += rand() * 4;
    if (!best || score > best.score) best = { ...c, score };
  }
  if (!best) return null;

  const s = CARDS[best.id].stats;
  const lane = laneOf(lead.x);
  const tower = PRINCESS_POS[lane];
  let spot: Point;
  if (s.ability?.kind === 'dig') spot = { x: lead.x, y: lead.y + 1 };
  else if (s.ability?.kind === 'building') spot = { x: ARENA_W / 2 + (lane === 'left' ? -1.5 : 1.5), y: 21 };
  // Ranged troops stand behind the tower and let the threat walk into both.
  else if (s.range >= 3) spot = { x: tower.x + (lane === 'left' ? 2 : -2), y: Math.max(lead.y + 4, 26) };
  // Melee meets it head-on, a little behind so the tower gets shots in.
  else spot = { x: lead.x, y: Math.max(lead.y + 2.5, DEPLOY_MIN_Y + 1) };
  return legal(best.slot, best.id, spot) ?? legal(best.slot, best.id, { x: lead.x, y: DEPLOY_MIN_Y + 1 });
}

function attack(
  seen: Seen[], team: Team, mine: Seen[], hand: Array<{ id: CardId; slot: number }>,
  pockets: ReadonlySet<Lane>, legal: Legal, rand: () => number,
): BotPlay | null {
  const lane = targetLane(seen, team, mine, pockets);
  const laneX = PRINCESS_POS[lane].x;
  const bridgeX = lane === 'left' ? BRIDGE_XS[0] : BRIDGE_XS[1];
  // A tank already walking up this lane gets support behind it.
  const tank = mine.find((m) => laneOf(m.x) === lane && m.y > 12 && m.y < 30 && isTank(m.e.defId as CardId));
  const ordered = [...hand].sort((a, b) => rank(b.id) - rank(a.id) + (rand() - 0.5) * 3);

  for (const c of ordered) {
    const s = CARDS[c.id].stats;
    const a = s.ability?.kind;
    let spot: Point;
    if (a === 'dig') {
      // Pop up right in front of the enemy tower.
      spot = { x: laneX, y: ARENA_H - PRINCESS_POS[lane].y + 2.2 };
    } else if (a === 'building') {
      // A turret is only worth it on defence.
      continue;
    } else if (pockets.has(lane)) {
      spot = { x: laneX, y: POCKET_MIN_Y + 1 };
    } else if (tank && !isTank(c.id)) {
      spot = { x: tank.x, y: Math.max(DEPLOY_MIN_Y + 0.5, tank.y + 2) };
    } else if (isTank(c.id)) {
      // Tanks start at the back so elixir comes back before they reach the bridge.
      spot = { x: laneX, y: 29.5 };
    } else if (s.speed >= 1.5 || s.targets === 'buildings') {
      spot = { x: bridgeX, y: DEPLOY_MIN_Y + 0.5 };
    } else {
      spot = { x: laneX, y: 27 };
    }
    const play = legal(c.slot, c.id, spot);
    if (play) return play;
  }
  return null;
}

/**
 * Where to push: an open pocket, else the weaker enemy tower, else wherever our troops
 * already are (so pushes stack up instead of splitting), else the side the enemy is light on.
 */
function targetLane(seen: Seen[], team: Team, mine: Seen[], pockets: ReadonlySet<Lane>): Lane {
  const open = [...pockets];
  if (open.length === 1) return open[0]!;
  const towers = seen.filter((s) => s.e.team !== team && s.e.kind === 'princess');
  if (towers.length === 2) {
    const [a, b] = towers as [Seen, Seen];
    if (Math.abs(a.e.hp - b.e.hp) > 150) return laneOf((a.e.hp < b.e.hp ? a : b).x);
  }
  const weight = (lane: Lane, who: Seen[]) => who.filter((s) => laneOf(s.x) === lane).reduce((sum, s) => sum + s.e.hp, 0);
  const ours = weight('left', mine) - weight('right', mine);
  if (Math.abs(ours) > 200) return ours > 0 ? 'left' : 'right';
  const theirs = seen.filter((s) => s.e.team !== team && s.e.kind === 'unit');
  return weight('left', theirs) <= weight('right', theirs) ? 'left' : 'right';
}

function isTank(id: CardId): boolean {
  const c = CARDS[id];
  if (!c) return false;
  return c.stats.hp >= 1400 && c.count === 1 && c.stats.speed > 0;
}

/** Rough "play this first" order for pushes: tanks lead, cheap cycle cards last. */
function rank(id: CardId): number {
  const c = CARDS[id];
  return (isTank(id) ? 10 : 0) + (c.stats.targets === 'buildings' ? 4 : 0) + c.cost;
}

function clampPoint(p: Point): Point {
  return { x: Math.min(ARENA_W - 0.6, Math.max(0.6, p.x)), y: Math.min(ARENA_H - 0.6, Math.max(0.6, p.y)) };
}

/** Deterministic random source (mulberry32) for bots and tests. */
export function seededRandom(seed: number): () => number {
  let t = seed | 0;
  return () => {
    t = (t + 0x6d2b79f5) | 0;
    let r = Math.imul(t ^ (t >>> 15), t | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
