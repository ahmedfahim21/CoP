import { schema, t, type SchemaType } from '@colyseus/schema';

/**
 * Network state mirrored from the simulation every tick. World coordinates;
 * clients rotate them into their own perspective. Hands are private and sent as messages.
 */
export const EntityState = schema({
  id: t.string(),
  team: t.uint8(),
  kind: t.string(),
  defId: t.string(),
  x: t.float32(),
  y: t.float32(),
  hp: t.int32(),
  maxHp: t.int32(),
  deploying: t.boolean(),
  active: t.boolean(),
  /** Tunnelling or cloaked: untargetable. */
  hidden: t.boolean(),
  stunned: t.boolean(),
  slowed: t.boolean(),
  /** Take Down primed. */
  charging: t.boolean(),
  /** Barrier points left. */
  shield: t.int16(),
  enraged: t.boolean(),
}, 'EntityState');
export type EntityState = SchemaType<typeof EntityState>;

export const ProjectileState = schema({
  id: t.string(),
  team: t.uint8(),
  sourceDefId: t.string(),
  targetId: t.string(),
  x: t.float32(),
  y: t.float32(),
}, 'ProjectileState');
export type ProjectileState = SchemaType<typeof ProjectileState>;

/** A lingering damage cloud. */
export const ZoneState = schema({
  id: t.string(),
  team: t.uint8(),
  x: t.float32(),
  y: t.float32(),
  radius: t.float32(),
  timeLeft: t.float32(),
}, 'ZoneState');
export type ZoneState = SchemaType<typeof ZoneState>;

export const PlayerInfo = schema({
  sessionId: t.string(),
  name: t.string(),
  team: t.uint8(),
  elixir: t.float32(),
  crowns: t.uint8(),
  starterLeft: t.string(),
  starterRight: t.string(),
  connected: t.boolean(),
  /** Ladder trophies at the start of the battle; 0 for guests and bots. */
  trophies: t.uint16(),
  /** Profile tag, empty for guests and bots. */
  profileId: t.string(),
  bot: t.boolean(),
  /** The bot playing a real trainer's deck (profileId is theirs). */
  ghost: t.boolean(),
  /** Trainer level; 0 for guests and bots. */
  level: t.uint8(),
}, 'PlayerInfo');
export type PlayerInfo = SchemaType<typeof PlayerInfo>;

export const BattleState = schema({
  /** 'waiting' until both players are in, then the simulation's phase. */
  phase: t.string(),
  timeLeft: t.float32(),
  doubleElixir: t.boolean(),
  entities: t.map(EntityState),
  projectiles: t.map(ProjectileState),
  zones: t.map(ZoneState),
  /** Keyed by sessionId. */
  players: t.map(PlayerInfo),
  /** -1 while playing or on a draw; see resultReason. */
  winner: t.int8(),
  /** Empty while playing. */
  resultReason: t.string(),
  /** A MatchMode: 'ranked', 'ghost', 'league', 'daily', 'gauntlet', 'event', 'friendly', 'training' or 'casual'. */
  mode: t.string(),
  /** What this battle is, for single-player modes, e.g. "Brock · Pewter Gym"; empty otherwise. */
  title: t.string(),
  /** Its special rules in a sentence, e.g. a gym's twist; empty otherwise. */
  twist: t.string(),
}, 'BattleState');
export type BattleState = SchemaType<typeof BattleState>;
