import { Client, type Room } from '@colyseus/sdk';
import {
  MSG, QUEUE_ROOM_NAME, ROOM_NAME,
  type AdventureRequest, type CardId, type ErrorMessage, type GameEvent, type HandMessage, type JoinOptions, type MatchMode, type PlayMessage,
  type QueueJoinOptions, type QueueStatusMessage, type RematchMessage, type RematchStateMessage, type SeatMessage,
  type StarterPick, type SummaryMessage, type Team,
} from '@cop/shared';
import { BattleState } from '@cop/shared/schema';
import { SERVER_URL } from './config.js';
import type { BattleSource, MapLike } from './three/battle.js';

const client = new Client(SERVER_URL);

interface SessionEvents {
  hand: HandMessage;
  fx: GameEvent[];
  error: ErrorMessage;
  summary: SummaryMessage;
  rematchState: RematchStateMessage;
  rematch: RematchMessage;
}

/** A player as the HUD reads them (network PlayerInfo, or a local stand-in). */
export interface PlayerLike {
  team: number;
  name: string;
  elixir: number;
  crowns: number;
  connected: boolean;
  trophies: number;
  profileId: string;
  bot: boolean;
  ghost: boolean;
  level: number;
}

/**
 * What the battle HUD needs from a battle: the networked Session, or a LocalBattle simulated
 * in the browser (puzzles).
 */
export interface BattleSession extends BattleSource {
  readonly hand: HandMessage | null;
  readonly room: { readonly sessionId: string };
  readonly state: BattleSource['state'] & {
    phase: string;
    timeLeft: number;
    doubleElixir: boolean;
    mode: string;
    title: string;
    twist: string;
    players: MapLike<PlayerLike> & { get(key: string): PlayerLike | undefined };
  };
  on(event: 'hand', fn: (m: HandMessage) => void): () => void;
  on(event: 'error', fn: (m: ErrorMessage) => void): () => void;
  on(event: 'fx', fn: (events: GameEvent[]) => void): () => void;
  play(message: PlayMessage): void;
}

/**
 * A joined battle room. Message handlers are registered immediately on join so nothing
 * that arrives before the battle scene starts (e.g. the opening hand) is lost.
 */
export class Session {
  hand: HandMessage | null = null;
  summary: SummaryMessage | null = null;
  rematchState: RematchStateMessage | null = null;
  private readonly listeners: { [K in keyof SessionEvents]: Set<(payload: SessionEvents[K]) => void> } = {
    hand: new Set(), fx: new Set(), error: new Set(), summary: new Set(), rematchState: new Set(), rematch: new Set(),
  };

  constructor(readonly room: Room<any, BattleState>, readonly loadout: Loadout) {
    room.onMessage(MSG.hand, (m: HandMessage) => {
      this.hand = m;
      this.emit('hand', m);
    });
    room.onMessage(MSG.fx, (events: GameEvent[]) => this.emit('fx', events));
    room.onMessage(MSG.error, (m: ErrorMessage) => this.emit('error', m));
    room.onMessage(MSG.summary, (m: SummaryMessage) => {
      this.summary = m;
      this.emit('summary', m);
    });
    room.onMessage(MSG.rematchState, (m: RematchStateMessage) => {
      this.rematchState = m;
      this.emit('rematchState', m);
    });
    room.onMessage(MSG.rematch, (m: RematchMessage) => this.emit('rematch', m));
  }

  get state(): BattleState {
    return this.room.state;
  }

  /** The room's mode; may change from 'ranked' once both players are in (e.g. same profile twice). */
  get mode(): MatchMode {
    return (this.state.mode || 'casual') as MatchMode;
  }

  /** Undefined until the first state patch arrives. */
  get team(): Team | undefined {
    return this.state.players?.get(this.room.sessionId)?.team as Team | undefined;
  }

  onStateChange(fn: () => void): () => void {
    this.room.onStateChange(fn);
    return () => this.room.onStateChange.remove(fn);
  }

  play(message: PlayMessage) {
    this.room.send(MSG.play, message);
  }

  requestRematch() {
    this.room.send(MSG.rematch);
  }

  on<K extends keyof SessionEvents>(event: K, fn: (payload: SessionEvents[K]) => void): () => void {
    this.listeners[event].add(fn);
    return () => this.listeners[event].delete(fn);
  }

  private emit<K extends keyof SessionEvents>(event: K, payload: SessionEvents[K]) {
    for (const fn of this.listeners[event]) fn(payload);
  }

  leave() {
    return this.room.leave(true);
  }
}

/** Everything a player brings to a battle. */
export interface Loadout {
  starters: StarterPick;
  name: string;
  deck: CardId[];
  /** Profile credential; null plays as a guest. */
  credential: string | null;
}

function joinOptions(l: Loadout): JoinOptions {
  return { starters: l.starters, name: l.name, deck: l.deck, ...(l.credential ? { credential: l.credential } : {}) };
}

/** A search in the ranked queue. `seated` settles once the queue hands out a battle seat. */
export interface Search {
  seated: Promise<{ session: Session; mode: SeatMessage['mode'] }>;
  cancel(): Promise<void>;
}

export async function rankedSearch(l: Loadout & { credential: string }, onStatus: (s: QueueStatusMessage) => void): Promise<Search> {
  const queue = await client.joinOrCreate(QUEUE_ROOM_NAME, { credential: l.credential, starters: l.starters, deck: l.deck } satisfies QueueJoinOptions);
  let done = false;
  const seated = new Promise<{ session: Session; mode: SeatMessage['mode'] }>((resolve, reject) => {
    queue.onMessage(MSG.queueStatus, (m: QueueStatusMessage) => onStatus(m));
    queue.onMessage(MSG.seat, async (m: SeatMessage) => {
      done = true;
      try {
        const room = await client.consumeSeatReservation(m.reservation as never, BattleState);
        resolve({ session: new Session(room, l), mode: m.mode });
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      } finally {
        queue.leave(true).catch((err: unknown) => console.error('Leaving the queue failed', err));
      }
    });
    queue.onError((code, message) => {
      if (done) return;
      done = true;
      reject(new Error(message ?? `Queue error ${code}`));
    });
    queue.onLeave((code) => {
      if (done) return;
      done = true;
      reject(new Error(`Left the queue (code ${code})`));
    });
  });
  return {
    seated,
    cancel: async () => {
      done = true;
      await queue.leave(true);
    },
  };
}

export async function training(l: Loadout): Promise<Session> {
  const room = await client.create(ROOM_NAME, { ...joinOptions(l), training: true } satisfies JoinOptions, BattleState);
  return new Session(room, l);
}

/** A single-player battle: a League stage, the Daily Challenge, a Gauntlet run or this week's event. */
export async function adventure(l: Loadout, request: AdventureRequest): Promise<Session> {
  const room = await client.create(ROOM_NAME, { ...joinOptions(l), adventure: request } satisfies JoinOptions, BattleState);
  return new Session(room, l);
}

export async function createPrivate(l: Loadout): Promise<Session> {
  const room = await client.create(ROOM_NAME, { ...joinOptions(l), private: true } satisfies JoinOptions, BattleState);
  return new Session(room, l);
}

export async function joinByCode(code: string, l: Loadout): Promise<Session> {
  const room = await client.joinById(code.trim(), joinOptions(l), BattleState);
  return new Session(room, l);
}

/** Take the seat the server reserved in a rematch room. */
export async function takeSeat(reservation: unknown, l: Loadout): Promise<Session> {
  const room = await client.consumeSeatReservation(reservation as never, BattleState);
  return new Session(room, l);
}
