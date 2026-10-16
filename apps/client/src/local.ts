import {
  STEP_SECONDS, isCharging, isDoubleElixir, playCard, step,
  type ErrorMessage, type GameEvent, type HandMessage, type MatchState, type PlayMessage, type Team,
} from '@cop/shared';
import type { BattleSession, PlayerLike } from './net.js';
import type { EntityLike, ProjectileLike } from './three/battle.js';

type Listener<T> = (payload: T) => void;

/** The mirrored state, with plain Maps where the network has MapSchemas. */
interface LocalState {
  phase: string;
  timeLeft: number;
  doubleElixir: boolean;
  mode: string;
  title: string;
  twist: string;
  entities: Map<string, EntityLike>;
  projectiles: Map<string, ProjectileLike>;
  players: Map<string, PlayerLike>;
}

export interface LocalBattleOptions {
  /** Which side the player sees and plays. */
  team: Team;
  names: [string, string];
  title?: string;
  twist?: string;
  /** Runs after every step (a puzzle checks its goal here and may call end()). */
  afterStep?: (match: MatchState, elapsed: number) => void;
  /** What the timer shows; defaults to the match clock. */
  clock?: (match: MatchState, elapsed: number) => number;
  /** Whether the player may play cards. Replays are watch-only. */
  interactive?: boolean;
}

/**
 * A battle simulated in the browser: the same shape the HUD and the 3D view read from the
 * network, driven by the shared simulation at the server's 50 ms step. Puzzles play on it;
 * replays watch it.
 */
export class LocalBattle implements BattleSession {
  readonly room = { sessionId: 'me' };
  hand: HandMessage | null = null;
  readonly state: LocalState;
  /** Seconds simulated so far. */
  elapsed = 0;
  /** Simulation steps per real step: 0 pauses, 2 or 4 fast-forwards. */
  speed = 1;
  private timer = 0;
  private readonly players = new Map<string, PlayerLike>();
  private readonly listeners = { hand: new Set<Listener<HandMessage>>(), error: new Set<Listener<ErrorMessage>>(), fx: new Set<Listener<GameEvent[]>>() };
  private readonly changes = new Set<() => void>();
  /** Runs before each step: replays apply their recorded plays here. */
  beforeStep: ((match: MatchState, stepIndex: number) => void) | null = null;
  private steps = 0;

  constructor(readonly match: MatchState, private readonly opts: LocalBattleOptions) {
    for (const team of [0, 1] as const) {
      this.players.set(team === opts.team ? 'me' : 'foe', {
        team, name: opts.names[team], elixir: 0, crowns: 0, connected: true, trophies: 0, profileId: '', bot: team !== opts.team, ghost: false, level: 0,
      });
    }
    this.state = {
      phase: match.phase, timeLeft: match.timeLeft, doubleElixir: false, mode: 'puzzle', title: opts.title ?? '', twist: opts.twist ?? '',
      entities: new Map<string, EntityLike>(), projectiles: new Map<string, ProjectileLike>(), players: this.players,
    };
    this.mirror();
    this.sendHand();
  }

  get team(): Team {
    return this.opts.team;
  }

  start() {
    if (this.timer) return;
    this.timer = window.setInterval(() => {
      for (let i = 0; i < this.speed && this.match.phase !== 'ended'; i++) this.stepOnce();
      if (this.match.phase === 'ended') this.stop();
    }, STEP_SECONDS * 1000);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = 0;
  }

  /** Ends the battle where it stands (a solved or failed puzzle). */
  end() {
    this.match.phase = 'ended';
    this.mirror();
    this.emitChange();
    this.stop();
  }

  stepOnce() {
    this.beforeStep?.(this.match, this.steps);
    const spawned = this.match.events;
    step(this.match, STEP_SECONDS);
    this.steps += 1;
    this.elapsed += STEP_SECONDS;
    const events = [...spawned, ...this.match.events];
    this.match.events = [];
    this.opts.afterStep?.(this.match, this.elapsed);
    this.mirror();
    if (events.length > 0) for (const fn of this.listeners.fx) fn(events);
    this.emitChange();
  }

  play(m: PlayMessage) {
    if (this.opts.interactive === false) return;
    const r = playCard(this.match, this.opts.team, m.slot, { x: m.x, y: m.y });
    if (!r.ok) {
      for (const fn of this.listeners.error) fn({ error: r.error });
      return;
    }
    // Spawn events go out with the next step, like the server's.
    this.sendHand();
  }

  on(event: 'hand', fn: Listener<HandMessage>): () => void;
  on(event: 'error', fn: Listener<ErrorMessage>): () => void;
  on(event: 'fx', fn: Listener<GameEvent[]>): () => void;
  on(event: 'hand' | 'error' | 'fx', fn: Listener<never>): () => void {
    const set = this.listeners[event] as Set<Listener<never>>;
    set.add(fn);
    return () => set.delete(fn);
  }

  onStateChange(fn: () => void): () => void {
    this.changes.add(fn);
    return () => this.changes.delete(fn);
  }

  dispose() {
    this.stop();
    this.changes.clear();
  }

  /** Re-sends the player's hand (replays call this after applying the viewed side's plays). */
  refreshHand() {
    this.sendHand();
  }

  private sendHand() {
    const p = this.match.players[this.opts.team];
    this.hand = { hand: [...p.hand], next: p.queue[0]! };
    for (const fn of this.listeners.hand) fn(this.hand);
  }

  private emitChange() {
    for (const fn of this.changes) fn();
  }

  private mirror() {
    const m = this.match;
    const s = this.state;
    s.phase = m.phase;
    s.timeLeft = this.opts.clock ? this.opts.clock(m, this.elapsed) : m.timeLeft;
    s.doubleElixir = isDoubleElixir(m);
    for (const p of this.players.values()) {
      p.elixir = m.players[p.team]!.elixir;
      p.crowns = m.players[p.team]!.crowns;
    }
    const ents = new Map<string, EntityLike>();
    for (const e of m.entities) {
      ents.set(e.id, {
        id: e.id, team: e.team, kind: e.kind, defId: e.defId, x: e.x, y: e.y, hp: Math.max(0, Math.ceil(e.hp)), maxHp: e.maxHp,
        deploying: e.deployTimer > 0, active: e.active, hidden: e.hidden, stunned: e.stun > 0, slowed: e.slow > 0, charging: isCharging(e),
      });
    }
    s.entities = ents;
    const shots = new Map<string, ProjectileLike>();
    for (const p of m.projectiles) shots.set(p.id, { id: p.id, team: p.team, sourceDefId: p.sourceDefId, targetId: p.targetId, x: p.x, y: p.y });
    s.projectiles = shots;
  }
}
