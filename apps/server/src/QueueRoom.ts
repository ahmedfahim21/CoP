import { Room, ServerError, logger, matchMaker, type Client } from 'colyseus';
import {
  DEFAULT_DECK, MSG, ROOM_NAME, isDeck, isStarterPick, searchWindow,
  type CardId, type QueueJoinOptions, type QueueStatusMessage, type SeatMessage, type StarterPick,
} from '@cop/shared';
import type { InternalOptions } from './BattleRoom.js';
import { pairUp, type QueueEntry } from './matchmaking.js';
import type { ProfileStore } from './store.js';
import { INTERNAL_KEY } from './trust.js';

interface Waiting extends QueueEntry {
  client: Client;
  name: string;
  starters: StarterPick;
  deck: CardId[];
}

/**
 * The ranked queue. Everyone searching sits in this one room; once a second it pairs
 * players by trophies (see matchmaking.ts), creates a ranked battle and hands each player
 * a reserved seat. Nobody waits forever: after `botAfterSeconds` you get the training bot.
 */
export class QueueRoom extends Room {
  static cycleMs = 1000;
  static botAfterSeconds = 30;

  protected store: ProfileStore | null = null;

  maxClients = 1000;
  private readonly waiting = new Map<string, Waiting>();
  /** Each profile's most recent ranked opponent, so the queue can avoid instant rematches. */
  private static readonly lastOpponent = new Map<string, string>();

  onCreate() {
    this.clock.setInterval(() => this.cycle(), QueueRoom.cycleMs);
  }

  async onJoin(client: Client, options: Partial<QueueJoinOptions>) {
    if (!isStarterPick(options.starters)) throw new ServerError(400, 'Pick two different starters');
    if (options.deck !== undefined && !isDeck(options.deck)) throw new ServerError(400, 'A deck is eight different cards');
    const profile = await this.store?.authenticate(options.credential);
    if (!profile) throw new ServerError(401, 'Ranked battles need a trainer profile');
    this.waiting.set(client.sessionId, {
      client, profileId: profile.id, name: profile.name, trophies: profile.trophies, joinedAt: Date.now(),
      starters: options.starters, deck: options.deck ?? [...DEFAULT_DECK],
    });
    logger.info(`[queue] ${profile.id} (${profile.trophies} trophies) searching; ${this.waiting.size} in queue`);
    this.cycle();
  }

  onLeave(client: Client) {
    this.waiting.delete(client.sessionId);
  }

  /** Pair whoever can be paired, send bots to whoever has waited too long, update the rest. */
  cycle(now = Date.now()) {
    for (const [a, b] of pairUp([...this.waiting.values()], now, (id) => QueueRoom.lastOpponent.get(id))) {
      this.waiting.delete(a.client.sessionId);
      this.waiting.delete(b.client.sessionId);
      if (a.profileId !== b.profileId) {
        QueueRoom.lastOpponent.set(a.profileId, b.profileId);
        QueueRoom.lastOpponent.set(b.profileId, a.profileId);
      }
      logger.info(`[queue] paired ${a.profileId} (${a.trophies}) with ${b.profileId} (${b.trophies}) after ${((now - Math.min(a.joinedAt, b.joinedAt)) / 1000).toFixed(1)}s`);
      void this.launch([a, b], 'ranked');
    }
    for (const w of [...this.waiting.values()]) {
      if (now - w.joinedAt < QueueRoom.botAfterSeconds * 1000) continue;
      this.waiting.delete(w.client.sessionId);
      logger.info(`[queue] no opponent for ${w.profileId}; sending in the bot`);
      void this.launch([w], 'training');
    }
    const searching = this.waiting.size;
    for (const w of this.waiting.values()) {
      const waited = (now - w.joinedAt) / 1000;
      const range = searchWindow(waited);
      w.client.send(MSG.queueStatus, {
        waited: Math.round(waited),
        range: Number.isFinite(range) ? Math.round(range) : null,
        searching,
        botIn: Math.max(0, Math.round(QueueRoom.botAfterSeconds - waited)),
      } satisfies QueueStatusMessage);
    }
  }

  private async launch(players: Waiting[], mode: SeatMessage['mode']) {
    try {
      const room = await matchMaker.createRoom(ROOM_NAME, mode === 'ranked'
        ? { ranked: true, internalKey: INTERNAL_KEY } satisfies InternalOptions
        : { training: true, internalKey: INTERNAL_KEY });
      for (const p of players) {
        const reservation = await matchMaker.reserveSeatFor(room, {
          starters: p.starters, deck: p.deck, profileId: p.profileId, internalKey: INTERNAL_KEY,
        });
        p.client.send(MSG.seat, { reservation, mode } satisfies SeatMessage);
      }
    } catch (err) {
      logger.error('[queue] creating a battle failed:', err);
      for (const p of players) p.client.error(500, 'Could not start the battle; try again');
    }
  }
}
