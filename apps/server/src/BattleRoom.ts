import { Room, ServerError, logger, type Client } from 'colyseus';
import {
  MSG, createMatch, forfeit, isDoubleElixir, isStarterPick, playCard, sanitizeTrainerName, step,
  type ErrorMessage, type HandMessage, type JoinOptions, type MatchState, type PlayMessage, type StarterPick, type Team,
} from '@cop/shared';
import { BattleState, EntityState, PlayerInfo, ProjectileState } from '@cop/shared/schema';

const TICK_MS = 50;
/** Guards against a huge catch-up step after an event-loop stall. */
const MAX_DT = 0.1;

export class BattleRoom extends Room<{ state: BattleState }> {
  /** Seconds a dropped player has to come back before forfeiting. Tests shorten it. */
  static reconnectSeconds = 20;

  maxClients = 2;
  state = new BattleState({
    phase: 'waiting', timeLeft: 0, doubleElixir: false, winner: -1, resultReason: '',
  });

  private match: MatchState | null = null;
  private readonly teams = new Map<string, Team>();
  private readonly picks: [StarterPick | null, StarterPick | null] = [null, null];

  async onCreate(options: Partial<JoinOptions>) {
    this.setPatchRate(TICK_MS);
    if (options.private === true) await this.setPrivate(true);
    this.onMessage(MSG.play, (client, message: unknown) => this.handlePlay(client, message));
  }

  onJoin(client: Client, options: Partial<JoinOptions>) {
    if (!isStarterPick(options.starters)) throw new ServerError(400, 'Pick two different starters');
    const team: Team = this.picks[0] === null ? 0 : 1;
    this.teams.set(client.sessionId, team);
    this.picks[team] = options.starters;
    this.state.players.set(client.sessionId, new PlayerInfo({
      sessionId: client.sessionId, name: sanitizeTrainerName(options.name), team, elixir: 0, crowns: 0,
      starterLeft: options.starters[0], starterRight: options.starters[1], connected: true,
    }));
    logger.info(`[room ${this.roomId}] ${client.sessionId} joined as team ${team}`);
    if (this.picks[0] && this.picks[1]) void this.startMatch();
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
  }

  onLeave(client: Client) {
    const team = this.teams.get(client.sessionId);
    if (team === undefined) return;
    if (!this.match) {
      // Left the lobby before the match started: free the seat.
      this.teams.delete(client.sessionId);
      this.picks[team] = null;
      this.state.players.delete(client.sessionId);
      return;
    }
    const player = this.state.players.get(client.sessionId);
    if (player) player.connected = false;
    if (this.match.phase !== 'ended') {
      logger.info(`[room ${this.roomId}] ${client.sessionId} left mid-match; team ${team} forfeits`);
      forfeit(this.match, team);
      this.syncState();
      this.setSimulationInterval();
    }
  }

  onUncaughtException(error: Error, methodName: string) {
    logger.error(`[room ${this.roomId}] ${methodName} failed:`, error);
    // A broken simulation must not keep running silently; close the room so clients see it.
    void this.disconnect();
  }

  private async startMatch() {
    await this.lock();
    this.match = createMatch([this.picks[0]!, this.picks[1]!], Math.floor(Math.random() * 2 ** 31));
    this.syncState();
    for (const client of this.clients) this.sendHand(client);
    this.setSimulationInterval((dtMs) => this.tick(Math.min(dtMs / 1000, MAX_DT)), TICK_MS);
    logger.info(`[room ${this.roomId}] match started`);
  }

  private tick(dt: number) {
    const match = this.match!;
    step(match, dt);
    this.syncState();
    if (match.events.length > 0) this.broadcast(MSG.fx, match.events);
    if (match.phase === 'ended') {
      this.setSimulationInterval();
      logger.info(`[room ${this.roomId}] match ended: ${JSON.stringify(match.result)}`);
    }
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
    this.syncState();
    this.broadcast(MSG.fx, this.match.events);
    this.match.events = [];
    this.sendHand(client);
  }

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
      } else {
        s.entities.set(e.id, new EntityState({
          id: e.id, team: e.team, kind: e.kind, defId: e.defId, x: e.x, y: e.y,
          hp: Math.ceil(e.hp), maxHp: e.maxHp, deploying: e.deployTimer > 0, active: e.active,
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
        s.projectiles.set(p.id, new ProjectileState({ id: p.id, team: p.team, sourceDefId: p.sourceDefId, x: p.x, y: p.y }));
      }
    }
    for (const id of [...s.projectiles.keys()]) if (!flying.has(id)) s.projectiles.delete(id);
  }
}

function isPlayMessage(m: unknown): m is PlayMessage {
  if (typeof m !== 'object' || m === null) return false;
  const { slot, x, y } = m as Record<string, unknown>;
  return typeof slot === 'number' && typeof x === 'number' && typeof y === 'number';
}
