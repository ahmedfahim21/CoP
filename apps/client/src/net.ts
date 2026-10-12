import { Client, type Room } from '@colyseus/sdk';
import {
  MSG, ROOM_NAME,
  type CardId, type ErrorMessage, type GameEvent, type HandMessage, type JoinOptions, type PlayMessage, type StarterPick, type Team,
} from '@cop/shared';
import { BattleState } from '@cop/shared/schema';
import { SERVER_URL } from './config.js';

const client = new Client(SERVER_URL);

interface SessionEvents {
  hand: HandMessage;
  fx: GameEvent[];
  error: ErrorMessage;
}

/**
 * A joined battle room. Message handlers are registered immediately on join so nothing
 * that arrives before the battle scene starts (e.g. the opening hand) is lost.
 */
export class Session {
  hand: HandMessage | null = null;
  private readonly listeners: { [K in keyof SessionEvents]: Set<(payload: SessionEvents[K]) => void> } = {
    hand: new Set(), fx: new Set(), error: new Set(),
  };

  constructor(readonly room: Room<any, BattleState>, readonly starters: StarterPick, readonly isPrivate: boolean) {
    room.onMessage(MSG.hand, (m: HandMessage) => {
      this.hand = m;
      this.emit('hand', m);
    });
    room.onMessage(MSG.fx, (events: GameEvent[]) => this.emit('fx', events));
    room.onMessage(MSG.error, (m: ErrorMessage) => this.emit('error', m));
  }

  get state(): BattleState {
    return this.room.state;
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
}

export async function quickMatch(l: Loadout): Promise<Session> {
  const room = await client.joinOrCreate(ROOM_NAME, { starters: l.starters, name: l.name, deck: l.deck } satisfies JoinOptions, BattleState);
  return new Session(room, l.starters, false);
}

export async function createPrivate(l: Loadout): Promise<Session> {
  const room = await client.create(ROOM_NAME, { starters: l.starters, name: l.name, deck: l.deck, private: true } satisfies JoinOptions, BattleState);
  return new Session(room, l.starters, true);
}

export async function joinByCode(code: string, l: Loadout): Promise<Session> {
  const room = await client.joinById(code.trim(), { starters: l.starters, name: l.name, deck: l.deck } satisfies JoinOptions, BattleState);
  return new Session(room, l.starters, true);
}
