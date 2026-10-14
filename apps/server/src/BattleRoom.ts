import { Room, ServerError, logger, matchMaker, type Client } from 'colyseus';
import {
  Bot, CARDS, DEFAULT_DECK, MSG, ROOM_NAME, STARTERS, TRAINER, createMatch, rulesFor, forfeit, isCharging, isDeck, isDoubleElixir, isStarterPick, playCard,
  sanitizeTrainerName, seededRandom, step,
  type BattleStats, type CardId, type ErrorMessage, type HandMessage, type JoinOptions, type MatchMode, type MatchState, type PlayMessage,
  type RematchMessage, type RematchStateMessage, type StarterPick, type SummaryMessage, type Team,
} from '@cop/shared';
import { BattleState, EntityState, PlayerInfo, ProjectileState, ZoneState } from '@cop/shared/schema';
import type { ProfileStore } from './store.js';
import { INTERNAL_KEY } from './trust.js';

const TICK_MS = 50;
/** Guards against a huge catch-up step after an event-loop stall. */
const MAX_DT = 0.1;
const BOT_SESSION = 'bot';

/** Options only the server sets (see trust.ts); a client sending them without the key gets nothing. */
export interface InternalOptions {
  internalKey?: string;
  ranked?: boolean;
  /** Seat reservations made by the server carry the already-authenticated profile. */
  profileId?: string | null;
}

type RoomOptions = Partial<JoinOptions> & InternalOptions;

interface Seat {
  sessionId: string;
  profileId: string | null;
  name: string;
  trophies: number;
  starters: StarterPick;
  deck: readonly CardId[];
  bot: boolean;
  /** Asked for a rematch after the battle. */
  rematch: boolean;
  /** Still in the room (bots always are). */
  present: boolean;
}

/** Hand-built decks for the training bot; each has a tank to lead pushes. */
export const BOT_DECKS: ReadonlyArray<readonly CardId[]> = [
  DEFAULT_DECK,
  ['tauros', 'pikachu', 'zubat', 'voltorb', 'scyther', 'mrmime', 'koffing', 'dugtrio'],
  ['golem', 'starmie', 'rattata', 'magneton', 'jolteon', 'primeape', 'zapdos', 'geodude'],
  ['hitmonlee', 'gengar', 'chansey', 'articuno', 'zubat', 'rapidash', 'machop', 'voltorb'],
];
const BOT_NAMES = ['Brock', 'Misty', 'Lt. Surge', 'Erika', 'Koga', 'Sabrina', 'Blaine', 'Gary'];

/**
 * One battle. Modes: ranked (made by the queue, moves trophies), friendly (private room by
 * code), training (against the server's bot) and casual (public quick join, unrated).
 */
export class BattleRoom extends Room<{ state: BattleState }> {
  /** Seconds a dropped player has to come back before forfeiting. Tests shorten it. */
  static reconnectSeconds = 20;
  /** A queue-made room whose second player never shows up turns into training after this. */
  static partnerSeconds = 12;

  /** Injected by the app; null runs without persistence (nothing is recorded). */
  protected store: ProfileStore | null = null;
  private finishing = false;

  maxClients = 2;
  state = new BattleState({
    phase: 'waiting', timeLeft: 0, doubleElixir: false, winner: -1, resultReason: '', mode: 'casual',
  });

  private mode: MatchMode = 'casual';
  private match: MatchState | null = null;
  private readonly teams = new Map<string, Team>();
  private readonly seats: [Seat | null, Seat | null] = [null, null];
  private bot: Bot | null = null;
  private readonly stats: [BattleStats, BattleStats] = [emptyStats(), emptyStats()];
  private summary: SummaryMessage | null = null;
  private rematchLaunched = false;

  async onCreate(options: RoomOptions) {
    this.setPatchRate(TICK_MS);
    const internal = options.internalKey === INTERNAL_KEY;
    this.mode = options.training === true ? 'training'
      : internal && options.ranked === true ? 'ranked'
        : options.private === true ? 'friendly'
          : 'casual';
    this.state.mode = this.mode;
    if (this.mode === 'training') this.maxClients = 1;
    // Only casual rooms are open to quick join; everything else is reached by id or reservation.
    if (this.mode !== 'casual') await this.setPrivate(true);
    this.onMessage(MSG.play, (client, message: unknown) => this.handlePlay(client, message));
    this.onMessage(MSG.rematch, (client) => this.handleRematch(client));
    if (internal && this.mode === 'ranked') {
      this.clock.setTimeout(() => this.partnerNoShow(), BattleRoom.partnerSeconds * 1000);
    }
  }

  async onJoin(client: Client, options: RoomOptions) {
    if (!isStarterPick(options.starters)) throw new ServerError(400, 'Pick two different starters');
    if (options.deck !== undefined && !isDeck(options.deck)) throw new ServerError(400, 'A deck is eight different cards');
    const identity = await this.identify(options);
    // Checked after the lookup: nothing awaits between here and taking the seat.
    // A late arrival whose seat the bot already took (see partnerNoShow).
    if (this.seats[0] && this.seats[1]) throw new ServerError(409, 'This battle has already started');
    const team: Team = this.seats[0] === null ? 0 : 1;
    this.teams.set(client.sessionId, team);
    this.seats[team] = {
      sessionId: client.sessionId, ...identity, starters: options.starters, deck: options.deck ?? DEFAULT_DECK,
      bot: false, rematch: false, present: true,
    };
    this.addPlayerInfo(this.seats[team]!, team);
    logger.info(`[room ${this.roomId}] ${client.sessionId} joined as team ${team} (${identity.profileId ?? 'guest'}, ${this.mode})`);
    if (this.mode === 'training') this.seatBot(1);
    if (this.seats[0] && this.seats[1]) void this.startMatch();
  }

  onDrop(client: Client) {
    const player = this.state.players.get(client.sessionId);
    if (!this.match || this.match.phase === 'ended' || !player) return;
    player.connected = false;
    logger.info(`[room ${this.roomId}] ${client.sessionId} dropped; holding seat ${BattleRoom.reconnectSeconds}s`);
    this.allowReconnection(client, BattleRoom.reconnectSeconds);
  }

  onReconnect(client: Client) {
    const player = this.state.players.get(client.sessionId);
    if (player) player.connected = true;
    logger.info(`[room ${this.roomId}] ${client.sessionId} reconnected`);
    this.sendHand(client);
    if (this.summary) client.send(MSG.summary, this.summary);
  }

  onLeave(client: Client) {
    const team = this.teams.get(client.sessionId);
    if (team === undefined) return;
    if (!this.match) {
      // Left the lobby before the match started: free the seat.
      this.teams.delete(client.sessionId);
      this.seats[team] = null;
      this.state.players.delete(client.sessionId);
      return;
    }
    const player = this.state.players.get(client.sessionId);
    if (player) player.connected = false;
    const seat = this.seats[team];
    if (seat) seat.present = false;
    if (this.match.phase !== 'ended') {
      logger.info(`[room ${this.roomId}] ${client.sessionId} left mid-match; team ${team} forfeits`);
      forfeit(this.match, team);
      this.syncState();
      this.setSimulationInterval();
      void this.finish();
    } else {
      this.broadcastRematchState();
    }
  }

  onUncaughtException(error: Error, methodName: string) {
    // A refused join (bad starters, bad credential, room full) is the player's problem,
    // not the room's: Colyseus already sends it back to them. Don't end everyone's battle.
    if (error.cause instanceof ServerError) return;
    logger.error(`[room ${this.roomId}] ${methodName} failed:`, error);
    // A broken simulation must not keep running silently; close the room so clients see it.
    void this.disconnect();
  }

  /** Who is joining: a seat the server reserved, a profile credential, or a guest. */
  private async identify(options: RoomOptions): Promise<Pick<Seat, 'profileId' | 'name' | 'trophies'>> {
    if (options.internalKey === INTERNAL_KEY && typeof options.profileId === 'string') {
      const profile = await this.store?.get(options.profileId);
      if (profile) return { profileId: profile.id, name: profile.name, trophies: profile.trophies };
    }
    if (options.credential !== undefined && this.store) {
      const profile = await this.store.authenticate(options.credential);
      if (!profile) throw new ServerError(401, 'Profile not recognised');
      return { profileId: profile.id, name: profile.name, trophies: profile.trophies };
    }
    return { profileId: null, name: sanitizeTrainerName(options.name), trophies: 0 };
  }

  private addPlayerInfo(seat: Seat, team: Team) {
    this.state.players.set(seat.sessionId, new PlayerInfo({
      sessionId: seat.sessionId, name: seat.name, team, elixir: 0, crowns: 0,
      starterLeft: seat.starters[0], starterRight: seat.starters[1], connected: true,
      trophies: seat.trophies, profileId: seat.profileId ?? '', bot: seat.bot,
    }));
  }

  /** Fill `team` with the training bot. */
  private seatBot(team: Team) {
    if (this.seats[team]) return;
    const rand = seededRandom(Math.floor(Math.random() * 2 ** 31));
    const starterIds = Object.keys(STARTERS) as Array<keyof typeof STARTERS>;
    const left = starterIds[Math.floor(rand() * starterIds.length)]!;
    const right = starterIds.filter((s) => s !== left)[Math.floor(rand() * (starterIds.length - 1))]!;
    this.seats[team] = {
      sessionId: BOT_SESSION, profileId: null, name: `${BOT_NAMES[Math.floor(rand() * BOT_NAMES.length)]!} (bot)`, trophies: 0,
      starters: [left, right], deck: BOT_DECKS[Math.floor(rand() * BOT_DECKS.length)]!, bot: true, rematch: true, present: true,
    };
    this.teams.set(BOT_SESSION, team);
    this.addPlayerInfo(this.seats[team]!, team);
    this.bot = new Bot(team, rand);
  }

  /** The queue promised two players but only one came: they get the bot instead of a wait. */
  private partnerNoShow() {
    if (this.match || this.clients.length !== 1) return;
    logger.info(`[room ${this.roomId}] ranked opponent never arrived; switching to training`);
    this.mode = 'training';
    this.state.mode = 'training';
    this.seatBot(this.seats[0] ? 1 : 0);
    void this.startMatch();
  }

  private async startMatch() {
    await this.lock();
    const [a, b] = this.seats as [Seat, Seat];
    // Ranked needs two different profiles; anything else is played for fun.
    if (this.mode === 'ranked' && (a.profileId === null || b.profileId === null || a.profileId === b.profileId)) {
      this.mode = 'casual';
      this.state.mode = 'casual';
    }
    this.match = createMatch([a.starters, b.starters], Math.floor(Math.random() * 2 ** 31), [a.deck, b.deck], rulesFor(this.mode));
    this.syncState();
    for (const client of this.clients) this.sendHand(client);
    this.setSimulationInterval((dtMs) => this.tick(Math.min(dtMs / 1000, MAX_DT)), TICK_MS);
    logger.info(`[room ${this.roomId}] ${this.mode} match started: ${a.name} vs ${b.name}`);
  }

  private tick(dt: number) {
    const match = this.match!;
    step(match, dt);
    if (this.bot) {
      const play = this.bot.update(match, dt);
      if (play) playCard(match, this.bot.team, play.slot, play);
    }
    this.publish();
    if (match.phase === 'ended') {
      this.setSimulationInterval();
      logger.info(`[room ${this.roomId}] match ended: ${JSON.stringify(match.result)}`);
      void this.finish();
    }
  }

  /** Tally, mirror and broadcast whatever the last step or play produced, exactly once. */
  private publish() {
    const match = this.match!;
    for (const ev of match.events) {
      if (ev.type === 'spawn') {
        this.stats[ev.team].cardsPlayed += 1;
        this.stats[ev.team].elixirSpent += CARDS[ev.cardId].cost;
      } else if (ev.type === 'death' && ev.kind === 'unit') {
        this.stats[(1 - ev.team) as Team].defeated += 1;
      }
    }
    this.syncState();
    if (match.events.length > 0) this.broadcast(MSG.fx, match.events);
    match.events = [];
  }

  private handlePlay(client: Client, message: unknown) {
    const team = this.teams.get(client.sessionId);
    if (team === undefined || !this.match) return this.sendError(client, 'not-playing');
    if (!isPlayMessage(message)) return this.sendError(client, 'bad-message');

    const result = playCard(this.match, team, message.slot, { x: message.x, y: message.y });
    const where = `slot ${message.slot} at (${message.x.toFixed(1)}, ${message.y.toFixed(1)})`;
    if (!result.ok) {
      logger.info(`[room ${this.roomId}] team ${team} play rejected: ${result.error} — ${where}`);
      return this.sendError(client, result.error);
    }
    logger.info(`[room ${this.roomId}] team ${team} played ${result.units[0]!.defId} — ${where}`);
    this.publish();
    this.sendHand(client);
  }

  /** Record the result once and tell everyone how it went. */
  private async finish() {
    const match = this.match;
    if (!match?.result || this.summary || this.finishing) return;
    // Set before the first await, so a second end-of-match signal can't record it twice.
    this.finishing = true;
    const seats = this.seats as [Seat, Seat];
    for (const team of [0, 1] as const) this.stats[team].towerDamage = towerDamageTo(match, (1 - team) as Team);
    const side = (t: Team) => ({ profileId: seats[t].profileId, name: seats[t].name, crowns: match.players[t].crowns });
    let recorded = seats.map((s) => ({ trophiesBefore: s.trophies, delta: 0 }));
    if (this.store && seats.some((s) => s.profileId)) {
      try {
        recorded = await this.store.recordMatch({
          mode: this.mode,
          winner: match.result.winner,
          reason: match.result.reason,
          sides: [side(0), side(1)],
        });
      } catch (err) {
        logger.error(`[room ${this.roomId}] recording the match failed:`, err);
      }
    }
    this.summary = {
      mode: this.mode,
      teams: [0, 1].map((t) => ({
        trophies: recorded[t]!.trophiesBefore + recorded[t]!.delta,
        delta: recorded[t]!.delta,
        stats: { ...this.stats[t]! },
      })) as SummaryMessage['teams'],
    };
    this.broadcast(MSG.summary, this.summary);
    this.broadcastRematchState();
  }

  // --- Rematch ---

  private handleRematch(client: Client) {
    const team = this.teams.get(client.sessionId);
    const seat = team === undefined ? null : this.seats[team];
    if (!seat || !this.summary || this.rematchLaunched) return;
    seat.rematch = true;
    this.broadcastRematchState();
    const humans = this.seats.filter((s): s is Seat => s !== null && !s.bot);
    if (this.seats.every((s) => s?.rematch) && humans.every((s) => s.present)) void this.launchRematch(humans);
  }

  private broadcastRematchState() {
    if (!this.summary) return;
    this.broadcast(MSG.rematchState, {
      requested: [this.seats[0]?.rematch ?? false, this.seats[1]?.rematch ?? false],
      open: !this.rematchLaunched && this.seats.every((s) => s?.present),
    } satisfies RematchStateMessage);
  }

  /** A fresh private room with the same loadouts; each player gets a reserved seat. */
  private async launchRematch(humans: Seat[]) {
    this.rematchLaunched = true;
    const training = this.seats.some((s) => s?.bot);
    try {
      const room = await matchMaker.createRoom(ROOM_NAME, { private: true, training, internalKey: INTERNAL_KEY } satisfies RoomOptions);
      for (const seat of humans) {
        const client = this.clients.find((c) => c.sessionId === seat.sessionId);
        if (!client) continue;
        const reservation = await matchMaker.reserveSeatFor(room, {
          starters: seat.starters, deck: [...seat.deck], name: seat.name, profileId: seat.profileId, internalKey: INTERNAL_KEY,
        } satisfies RoomOptions);
        client.send(MSG.rematch, { reservation } satisfies RematchMessage);
      }
      logger.info(`[room ${this.roomId}] rematch in room ${room.roomId}`);
    } catch (err) {
      logger.error(`[room ${this.roomId}] rematch failed:`, err);
      this.broadcastRematchState();
    }
  }

  // --- Sync ---

  private sendError(client: Client, error: ErrorMessage['error']) {
    client.send(MSG.error, { error } satisfies ErrorMessage);
  }

  private sendHand(client: Client) {
    const team = this.teams.get(client.sessionId);
    if (team === undefined || !this.match) return;
    const p = this.match.players[team];
    client.send(MSG.hand, { hand: [...p.hand], next: p.queue[0]! } satisfies HandMessage);
  }

  /** Mirror the simulation into the network schema. */
  private syncState() {
    const match = this.match!;
    const s = this.state;
    s.phase = match.phase;
    s.timeLeft = match.timeLeft;
    s.doubleElixir = isDoubleElixir(match);
    s.winner = match.result?.winner ?? -1;
    s.resultReason = match.result?.reason ?? '';

    for (const player of s.players.values()) {
      const p = match.players[player.team as Team];
      player.elixir = p.elixir;
      player.crowns = p.crowns;
    }

    const alive = new Set<string>();
    for (const e of match.entities) {
      alive.add(e.id);
      const existing = s.entities.get(e.id);
      if (existing) {
        existing.x = e.x;
        existing.y = e.y;
        existing.hp = Math.max(0, Math.ceil(e.hp));
        existing.deploying = e.deployTimer > 0;
        existing.active = e.active;
        // Evolution changes species and health pool in place.
        existing.defId = e.defId;
        existing.maxHp = e.maxHp;
        existing.hidden = e.hidden;
        existing.stunned = e.stun > 0;
        existing.slowed = e.slow > 0;
        existing.charging = isCharging(e);
        existing.shield = Math.ceil(e.shield);
        existing.enraged = e.enraged;
      } else {
        s.entities.set(e.id, new EntityState({
          id: e.id, team: e.team, kind: e.kind, defId: e.defId, x: e.x, y: e.y,
          hp: Math.ceil(e.hp), maxHp: e.maxHp, deploying: e.deployTimer > 0, active: e.active,
          hidden: e.hidden, stunned: e.stun > 0, slowed: e.slow > 0, charging: isCharging(e),
          shield: Math.ceil(e.shield), enraged: e.enraged,
        }));
      }
    }
    for (const id of [...s.entities.keys()]) if (!alive.has(id)) s.entities.delete(id);

    const flying = new Set<string>();
    for (const p of match.projectiles) {
      flying.add(p.id);
      const existing = s.projectiles.get(p.id);
      if (existing) {
        existing.x = p.x;
        existing.y = p.y;
      } else {
        s.projectiles.set(p.id, new ProjectileState({ id: p.id, team: p.team, sourceDefId: p.sourceDefId, targetId: p.targetId, x: p.x, y: p.y }));
      }
    }
    for (const id of [...s.projectiles.keys()]) if (!flying.has(id)) s.projectiles.delete(id);

    const clouds = new Set<string>();
    for (const z of match.zones) {
      clouds.add(z.id);
      const existing = s.zones.get(z.id);
      if (existing) existing.timeLeft = z.timeLeft;
      else s.zones.set(z.id, new ZoneState({ id: z.id, team: z.team, x: z.x, y: z.y, radius: z.radius, timeLeft: z.timeLeft }));
    }
    for (const id of [...s.zones.keys()]) if (!clouds.has(id)) s.zones.delete(id);
  }
}

function emptyStats(): BattleStats {
  return { cardsPlayed: 0, elixirSpent: 0, towerDamage: 0, defeated: 0 };
}

/** Health `team`'s towers have lost, counting fallen towers in full. */
function towerDamageTo(match: MatchState, team: Team): number {
  const full = TRAINER.stats.hp + match.players[team].starters.reduce((sum, id) => sum + STARTERS[id].stats.hp, 0);
  const left = match.entities.filter((e) => e.team === team && e.kind !== 'unit').reduce((sum, e) => sum + Math.max(0, e.hp), 0);
  return Math.round(full - left);
}

function isPlayMessage(m: unknown): m is PlayMessage {
  if (typeof m !== 'object' || m === null) return false;
  const { slot, x, y } = m as Record<string, unknown>;
  return typeof slot === 'number' && typeof x === 'number' && typeof y === 'number';
}
