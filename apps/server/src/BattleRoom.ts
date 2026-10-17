import { Room, ServerError, logger, matchMaker, type Client } from 'colyseus';
import {
  ACE_SKILL, BOT_DECKS, Bot, CARDS, DEFAULT_DECK, MSG, ROOKIE_SKILL, ROOM_NAME, ReplayRecorder, STARTERS, STEP_SECONDS,
  applyBattle, chaosDeck, createMatch, currentEvent, dailyChallenge, dailyScore, dayKey, deckUnlocked, eventFoe, forfeit, gauntletRound,
  draftSeed, isCharging, isDeck, isDoubleElixir, isDraftedDeck, isStarterPick, lerpSkill, levelFor, playCard, rulesFor, sanitizeTrainerName,
  seasonKey, seededRandom, skillForTrophies, stageById, stageOpen, stageRules, step, towerHealthOf,
  type AdventureRequest, type AdventureSummary, type BattleOutcome, type BattleStats, type BotSkill, type CardId, type DailyChallenge,
  type ErrorMessage, type HandMessage, type JoinOptions, type MatchMode, type MatchRules, type MatchState, type PlayMessage, type Progress,
  type RematchMessage, type RematchStateMessage, type RewardSummary, type Stage, type StarterPick, type SummaryMessage, type Team,
  type TowerHealth, type WeeklyEvent,
} from '@cop/shared';
import { BattleState, EntityState, PlayerInfo, ProjectileState, ZoneState } from '@cop/shared/schema';
import type { Ghost, ProfileStore } from './store.js';
import { INTERNAL_KEY } from './trust.js';

const TICK_MS = STEP_SECONDS * 1000;
/** After an event-loop stall, catch up at most this many steps at once. */
const MAX_CATCH_UP_STEPS = 4;
const BOT_SESSION = 'bot';

/** A Gauntlet run between rounds. */
export interface GauntletRun {
  seed: number;
  round: number;
  /** Your towers' health after the last round; null for round 1. */
  carry: TowerHealth | null;
}

/** Options only the server sets (see trust.ts); a client sending them without the key gets nothing. */
export interface InternalOptions {
  internalKey?: string;
  ranked?: boolean;
  /** Seat reservations made by the server carry the already-authenticated profile. */
  profileId?: string | null;
  /** A ghost battle against this trainer's deck. */
  ghost?: Ghost;
  /** The next round of a Gauntlet run. */
  gauntlet?: GauntletRun;
}

type RoomOptions = Partial<JoinOptions> & InternalOptions;

interface Seat {
  sessionId: string;
  profileId: string | null;
  name: string;
  trophies: number;
  level: number;
  starters: StarterPick;
  deck: readonly CardId[];
  bot: boolean;
  ghost: boolean;
  /** Asked for a rematch after the battle. */
  rematch: boolean;
  /** Still in the room (bots always are). */
  present: boolean;
}

interface Identity {
  profileId: string | null;
  name: string;
  trophies: number;
  progress: Progress | null;
}

/** The bot's side of a single-player battle. */
interface BotPlan {
  name: string;
  deck: CardId[];
  starters: StarterPick;
  skill: BotSkill;
  /** A ghost's real trainer. */
  ghost: Ghost | null;
}

/** What this room's battle is. Set up on create, completed when the player joins. */
interface Plan {
  mode: MatchMode;
  rules: MatchRules;
  seed: number;
  title: string;
  twist: string;
  /** Null: a practice bot matched to the player. */
  bot: BotPlan | null;
  /** Your deck and towers when the mode decides them (Daily Challenge, Chaos, Draft). */
  you: { deck?: CardId[]; starters?: StarterPick };
  stage: Stage | null;
  daily: DailyChallenge | null;
  gauntlet: GauntletRun | null;
  event: WeeklyEvent | null;
  /** The request that made the room, reused for a rematch. */
  request: AdventureRequest | null;
}

export { BOT_DECKS };
const BOT_NAMES = ['Brock', 'Misty', 'Lt. Surge', 'Erika', 'Koga', 'Sabrina', 'Blaine', 'Gary'];
/** Modes that need a profile: their whole point is progress. */
const PROFILE_MODES: readonly MatchMode[] = ['league', 'daily', 'gauntlet', 'event'];
/** Modes played alone against the bot. */
const SOLO_MODES: readonly MatchMode[] = ['training', 'ghost', 'league', 'daily', 'gauntlet', 'event'];

/**
 * One battle. Two players: ranked (made by the queue, moves trophies), friendly (private
 * room by code) and casual (public quick join, unrated). Against the bot: training, ghost
 * (the bot plays a real trainer's deck), league, daily, gauntlet and event.
 */
export class BattleRoom extends Room<{ state: BattleState }> {
  /** Seconds a dropped player has to come back before forfeiting. Tests shorten it. */
  static reconnectSeconds = 20;
  /** A queue-made room whose second player never shows up turns into training after this. */
  static partnerSeconds = 12;
  /** The clock for days and weeks (Daily Challenge, events, drafts). Tests pin it. */
  static now = () => Date.now();

  /** Injected by the app; null runs without persistence (nothing is recorded). */
  protected store: ProfileStore | null = null;
  private finishing = false;

  maxClients = 2;
  state = new BattleState({
    phase: 'waiting', timeLeft: 0, doubleElixir: false, winner: -1, resultReason: '', mode: 'casual', title: '', twist: '', regularSeconds: 0, arena: 0,
  });

  private plan!: Plan;
  private match: MatchState | null = null;
  private recorder: ReplayRecorder | null = null;
  private stepClock = 0;
  private readonly teams = new Map<string, Team>();
  private readonly seats: [Seat | null, Seat | null] = [null, null];
  private bot: Bot | null = null;
  private readonly stats: [BattleStats, BattleStats] = [emptyStats(), emptyStats()];
  private readonly played: [Partial<Record<CardId, number>>, Partial<Record<CardId, number>>] = [{}, {}];
  /** Tower health each side started with, to measure damage dealt. */
  private startTowerHp: [number, number] = [0, 0];
  /** Regular-time seconds left at the last step still in regular time. */
  private regularTimeLeft = 0;
  private summary: SummaryMessage | null = null;
  private rematchLaunched = false;

  get mode(): MatchMode {
    return this.plan.mode;
  }

  async onCreate(options: RoomOptions) {
    this.setPatchRate(TICK_MS);
    this.plan = planFor(options, BattleRoom.now());
    this.state.mode = this.plan.mode;
    this.state.title = this.plan.title;
    this.state.twist = this.plan.twist;
    this.state.arena = this.plan.stage?.arena ?? 0;
    this.state.regularSeconds = this.plan.rules.regularSeconds;
    if (SOLO_MODES.includes(this.plan.mode)) this.maxClients = 1;
    // Only casual rooms are open to quick join; everything else is reached by id or reservation.
    if (this.plan.mode !== 'casual') await this.setPrivate(true);
    this.onMessage(MSG.play, (client, message: unknown) => this.handlePlay(client, message));
    this.onMessage(MSG.rematch, (client) => this.handleRematch(client));
    if (options.internalKey === INTERNAL_KEY && this.plan.mode === 'ranked') {
      this.clock.setTimeout(() => this.partnerNoShow(), BattleRoom.partnerSeconds * 1000);
    }
  }

  async onJoin(client: Client, options: RoomOptions) {
    if (!isStarterPick(options.starters)) throw new ServerError(400, 'Pick two different starters');
    if (options.deck !== undefined && !isDeck(options.deck)) throw new ServerError(400, 'A deck is eight different cards');
    const identity = await this.identify(options);
    const plan = this.plan;
    if (PROFILE_MODES.includes(plan.mode) && !identity.profileId) throw new ServerError(401, 'Single-player battles need a trainer profile');
    if (plan.stage && identity.progress && !stageOpen(identity.progress, plan.stage.id)) {
      throw new ServerError(403, 'Beat the stage before this one first');
    }
    if (plan.event?.decks === 'draft' && plan.request?.kind === 'event') {
      if (!isDraftedDeck(draftSeed(identity.profileId ?? '', BattleRoom.now()), plan.request.draft)) {
        throw new ServerError(400, 'Those picks are not from this week’s draft');
      }
      plan.you.deck = [...plan.request.draft];
    }
    const deck = plan.you.deck ?? options.deck ?? [...DEFAULT_DECK];
    const starters = plan.you.starters ?? options.starters;
    // Your own deck must be cards you've unlocked; decks the mode hands you are fine.
    if (!plan.you.deck && identity.progress && !deckUnlocked(identity.progress, deck)) {
      throw new ServerError(403, 'Some cards in that deck are still locked');
    }
    // Checked after the lookup: nothing awaits between here and taking the seat.
    // A late arrival whose seat the bot already took (see partnerNoShow).
    if (this.seats[0] && this.seats[1]) throw new ServerError(409, 'This battle has already started');
    const team: Team = this.seats[0] === null ? 0 : 1;
    this.teams.set(client.sessionId, team);
    this.seats[team] = {
      sessionId: client.sessionId, profileId: identity.profileId, name: identity.name, trophies: identity.trophies,
      level: identity.progress ? levelFor(identity.progress.xp).level : 0,
      starters, deck, bot: false, ghost: false, rematch: false, present: true,
    };
    this.addPlayerInfo(this.seats[team]!, team);
    logger.info(`[room ${this.roomId}] ${client.sessionId} joined as team ${team} (${identity.profileId ?? 'guest'}, ${plan.mode})`);
    if (SOLO_MODES.includes(plan.mode)) this.seatBot(1, this.seats[team]!);
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
  private async identify(options: RoomOptions): Promise<Identity> {
    if (options.internalKey === INTERNAL_KEY && typeof options.profileId === 'string') {
      const profile = await this.store?.own(options.profileId);
      if (profile) return { profileId: profile.id, name: profile.name, trophies: profile.trophies, progress: profile.progress };
    }
    if (options.credential !== undefined && this.store) {
      const profile = await this.store.authenticate(options.credential);
      if (!profile) throw new ServerError(401, 'Profile not recognised');
      return { profileId: profile.id, name: profile.name, trophies: profile.trophies, progress: profile.progress };
    }
    return { profileId: null, name: sanitizeTrainerName(options.name), trophies: 0, progress: null };
  }

  private addPlayerInfo(seat: Seat, team: Team) {
    this.state.players.set(seat.sessionId, new PlayerInfo({
      sessionId: seat.sessionId, name: seat.name, team, elixir: 0, crowns: 0,
      starterLeft: seat.starters[0], starterRight: seat.starters[1], connected: true,
      trophies: seat.trophies, profileId: seat.profileId ?? '', bot: seat.bot, ghost: seat.ghost, level: seat.level,
    }));
  }

  /** Fill `team` with the bot, as the plan says (or a practice bot matched to the player). */
  private seatBot(team: Team, human: Seat) {
    if (this.seats[team]) return;
    const rand = seededRandom(this.plan.seed ^ 0x5bd1e995);
    const plan = this.plan.bot ?? trainingBot(rand, human.trophies);
    if (this.plan.event?.decks === 'mirror') {
      plan.deck = [...human.deck];
      plan.starters = human.starters;
    }
    this.seats[team] = {
      sessionId: BOT_SESSION, profileId: plan.ghost?.id ?? null, name: plan.name, trophies: plan.ghost?.trophies ?? 0, level: 0,
      starters: plan.starters, deck: plan.deck, bot: true, ghost: plan.ghost !== null, rematch: true, present: true,
    };
    this.teams.set(BOT_SESSION, team);
    this.addPlayerInfo(this.seats[team]!, team);
    this.bot = new Bot(team, rand, plan.skill);
  }

  /** The queue promised two players but only one came: they get the bot instead of a wait. */
  private partnerNoShow() {
    if (this.match || this.clients.length !== 1) return;
    logger.info(`[room ${this.roomId}] ranked opponent never arrived; switching to training`);
    this.plan.mode = 'training';
    this.plan.rules = rulesFor('training');
    this.state.mode = 'training';
    const human = (this.seats[0] ?? this.seats[1])!;
    this.seatBot(this.seats[0] ? 1 : 0, human);
    void this.startMatch();
  }

  private async startMatch() {
    await this.lock();
    const [a, b] = this.seats as [Seat, Seat];
    // Ranked needs two different profiles; anything else is played for fun.
    if (this.plan.mode === 'ranked' && (a.profileId === null || b.profileId === null || a.profileId === b.profileId)) {
      this.plan.mode = 'casual';
      this.state.mode = 'casual';
    }
    const decks: [CardId[], CardId[]] = [[...a.deck], [...b.deck]];
    const starters: [StarterPick, StarterPick] = [a.starters, b.starters];
    this.match = createMatch(starters, this.plan.seed, decks, this.plan.rules);
    this.startTowerHp = [towerHpOf(this.match, 0), towerHpOf(this.match, 1)];
    this.recorder = new ReplayRecorder({ seed: this.plan.seed, starters, decks, rules: this.plan.rules, names: [a.name, b.name] });
    this.syncState();
    for (const client of this.clients) this.sendHand(client);
    this.stepClock = 0;
    this.setSimulationInterval((dtMs) => this.advance(dtMs), TICK_MS);
    logger.info(`[room ${this.roomId}] ${this.plan.mode} match started: ${a.name} vs ${b.name}`);
  }

  /** Real time in, fixed 50 ms simulation steps out (so replays re-simulate exactly). */
  private advance(dtMs: number) {
    this.stepClock = Math.min(this.stepClock + dtMs, TICK_MS * MAX_CATCH_UP_STEPS);
    while (this.stepClock >= TICK_MS && this.match && this.match.phase !== 'ended') {
      this.stepClock -= TICK_MS;
      this.tick();
    }
  }

  /** One simulation step. (Tests call it directly; the argument is ignored.) */
  private tick(_dt?: number) {
    const match = this.match!;
    if (match.phase === 'regular') this.regularTimeLeft = match.timeLeft;
    step(match, STEP_SECONDS);
    this.recorder?.stepped();
    if (this.bot) {
      const play = this.bot.update(match, STEP_SECONDS);
      if (play && playCard(match, this.bot.team, play.slot, play).ok) this.recorder?.play(this.bot.team, play.slot, play);
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
        this.played[ev.team][ev.cardId] = (this.played[ev.team][ev.cardId] ?? 0) + 1;
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

    const at = { x: message.x, y: message.y };
    const result = playCard(this.match, team, message.slot, at);
    const where = `slot ${message.slot} at (${message.x.toFixed(1)}, ${message.y.toFixed(1)})`;
    if (!result.ok) {
      logger.info(`[room ${this.roomId}] team ${team} play rejected: ${result.error} — ${where}`);
      return this.sendError(client, result.error);
    }
    this.recorder?.play(team, message.slot, at);
    logger.info(`[room ${this.roomId}] team ${team} played ${result.units[0]!.defId} — ${where}`);
    this.publish();
    this.sendHand(client);
  }

  /** Record the result once, pay out progress, and tell everyone how it went. */
  private async finish() {
    const match = this.match;
    if (!match?.result || this.summary || this.finishing) return;
    // Set before the first await, so a second end-of-match signal can't record it twice.
    this.finishing = true;
    const now = BattleRoom.now();
    const seats = this.seats as [Seat, Seat];
    for (const team of [0, 1] as const) {
      const foe = (1 - team) as Team;
      this.stats[team].towerDamage = Math.max(0, Math.round(this.startTowerHp[foe] - towerHpOf(match, foe)));
    }
    const side = (t: Team) => ({ profileId: seats[t].profileId, name: seats[t].name, crowns: match.players[t].crowns });
    let recorded = seats.map((s) => ({ trophiesBefore: s.trophies, delta: 0 }));
    let matchId: number | undefined;
    if (this.store && seats.some((s) => s.profileId)) {
      try {
        const ghostTeam = seats.findIndex((s) => s.ghost);
        const res = await this.store.recordBattle({
          mode: this.plan.mode,
          winner: match.result.winner,
          reason: match.result.reason,
          sides: [side(0), side(1)],
          ghostTeam: ghostTeam >= 0 ? (ghostTeam as Team) : undefined,
          replay: this.recorder?.finish(match.result),
        }, now);
        recorded = res.sides;
        matchId = res.matchId;
      } catch (err) {
        logger.error(`[room ${this.roomId}] recording the match failed:`, err);
      }
    }
    const adventure: AdventureSummary = {};
    const rewards: [RewardSummary | undefined, RewardSummary | undefined] = [undefined, undefined];
    for (const team of [0, 1] as const) {
      const seat = seats[team];
      if (!seat.profileId || seat.bot || !this.store) continue;
      try {
        rewards[team] = await this.payOut(seat, team, match, now, adventure);
      } catch (err) {
        logger.error(`[room ${this.roomId}] updating progress for ${seat.profileId} failed:`, err);
      }
    }
    if (this.plan.event) adventure.event = this.plan.event.id;
    this.summary = {
      mode: this.plan.mode,
      matchId,
      adventure: Object.keys(adventure).length > 0 ? adventure : undefined,
      teams: [0, 1].map((t) => ({
        trophies: recorded[t]!.trophiesBefore + recorded[t]!.delta,
        delta: recorded[t]!.delta,
        stats: { ...this.stats[t]! },
        rewards: rewards[t],
      })) as SummaryMessage['teams'],
    };
    this.broadcast(MSG.summary, this.summary);
    this.broadcastRematchState();
  }

  /** XP, quests, stars and bests for one trainer; fills in the adventure summary. */
  private async payOut(seat: Seat, team: Team, match: MatchState, now: number, adventure: AdventureSummary): Promise<RewardSummary | undefined> {
    const store = this.store!;
    const profileId = seat.profileId!;
    const result = match.result!;
    const won = result.winner === team;
    const battle: BattleOutcome = {
      mode: this.plan.mode,
      outcome: result.winner === null ? 'draw' : won ? 'win' : 'loss',
      crowns: match.players[team].crowns,
      towersLost: 3 - match.entities.filter((e) => e.team === team && e.kind !== 'unit').length,
      towerDamage: this.stats[team].towerDamage,
      defeated: this.stats[team].defeated,
      played: this.played[team],
    };
    if (this.plan.stage) battle.stage = this.plan.stage.id;
    if (this.plan.event) battle.event = true;
    if (this.plan.daily) {
      const h = towerHealthOf(match.entities, team);
      // A win before time ran out is worth more the earlier it came; overtime and losses get no time bonus.
      const secondsLeft = won && result.reason !== 'forfeit' ? Math.max(0, Math.round(this.regularTimeLeft)) : 0;
      battle.dailyScore = dailyScore({ won, crowns: battle.crowns, towerDamage: battle.towerDamage, towerHealth: (h.king + h.left + h.right) / 3, secondsLeft });
    }
    const gauntlet = this.plan.gauntlet;
    if (gauntlet) battle.gauntletRounds = won ? gauntlet.round : gauntlet.round - 1;

    const r = await store.updateProgress(profileId, (p) => {
      const res = applyBattle(p, battle, now, profileId);
      return { progress: res.progress, result: res };
    });
    if (!r) return undefined;
    if (r.stars) adventure.stage = { id: r.stars.stage, starsBefore: r.stars.before, starsAfter: r.stars.after };
    if (this.plan.daily && battle.dailyScore !== undefined) {
      const board = await store.submitScore('daily', this.plan.daily.day, profileId, seat.name, battle.dailyScore, { crowns: battle.crowns }, now);
      adventure.daily = { score: battle.dailyScore, best: board.best, rank: board.rank };
    }
    if (gauntlet) {
      const rounds = battle.gauntletRounds!;
      // The run's score goes on the board when it ends.
      const rank = !won && rounds > 0 ? (await store.submitScore('gauntlet', seasonKey(now), profileId, seat.name, rounds, {}, now)).rank : null;
      adventure.gauntlet = { round: gauntlet.round, cleared: won, best: r.progress.gauntletBest, rank };
    }
    return {
      xp: r.xp, rewards: r.rewards, levelBefore: r.levelBefore, levelAfter: r.levelAfter, totalXp: r.progress.xp,
      unlocked: r.unlocked, quests: r.quests,
    };
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

  /** The next battle in this room's series: the same again, or the Gauntlet's next round. */
  private nextRoomOptions(): RoomOptions {
    const base = { internalKey: INTERNAL_KEY };
    const plan = this.plan;
    if (plan.gauntlet) {
      const human = this.seats.findIndex((s) => s && !s.bot) as Team;
      const won = this.match?.result?.winner === human;
      return won
        ? { ...base, gauntlet: { seed: plan.gauntlet.seed, round: plan.gauntlet.round + 1, carry: towerHealthOf(this.match!.entities, human) } }
        : { ...base, adventure: { kind: 'gauntlet' } };
    }
    if (plan.request) return { ...base, adventure: plan.request };
    if (plan.mode === 'ghost' && plan.bot?.ghost) return { ...base, ghost: plan.bot.ghost };
    return { ...base, private: true, training: SOLO_MODES.includes(plan.mode) };
  }

  /** A fresh private room for the next battle; each player gets a reserved seat. */
  private async launchRematch(humans: Seat[]) {
    this.rematchLaunched = true;
    try {
      const room = await matchMaker.createRoom(ROOM_NAME, this.nextRoomOptions());
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

/** Practice bot: random towers and deck, as strong as the player's trophies suggest. */
function trainingBot(rand: () => number, trophies: number): BotPlan {
  const starterIds = Object.keys(STARTERS) as Array<keyof typeof STARTERS>;
  const left = starterIds[Math.floor(rand() * starterIds.length)]!;
  const right = starterIds.filter((s) => s !== left)[Math.floor(rand() * (starterIds.length - 1))]!;
  return {
    name: `${BOT_NAMES[Math.floor(rand() * BOT_NAMES.length)]!} (bot)`,
    deck: [...BOT_DECKS[Math.floor(rand() * BOT_DECKS.length)]!],
    starters: [left, right],
    skill: skillForTrophies(trophies),
    ghost: null,
  };
}

/** Reads the room's create options into a plan. Anything only the server may set needs the key. */
function planFor(options: RoomOptions, now: number): Plan {
  const internal = options.internalKey === INTERNAL_KEY;
  const seed = Math.floor(Math.random() * 2 ** 31);
  const base = { seed, title: '', twist: '', bot: null, you: {}, stage: null, daily: null, gauntlet: null, event: null, request: null };
  if (internal && options.ghost) {
    const g = options.ghost;
    return {
      ...base, mode: 'ghost', rules: rulesFor('ghost'),
      title: `${g.name}'s ghost`, twist: 'The bot plays their deck. Only your trophies move, at half rate.',
      bot: { name: g.name, deck: [...g.deck], starters: g.starters, skill: skillForTrophies(g.trophies), ghost: g },
    };
  }
  if (internal && options.ranked === true) return { ...base, mode: 'ranked', rules: rulesFor('ranked') };
  if (internal && options.gauntlet) return gauntletPlan(options.gauntlet, base);
  const req = parseAdventure(options.adventure);
  if (req?.kind === 'league') {
    const stage = stageById(req.stage)!;
    return {
      ...base, mode: 'league', rules: stageRules(stage), request: req, stage,
      title: `${stage.leader} · ${stage.title}`, twist: stage.twist,
      bot: { name: stage.leader, deck: [...stage.deck], starters: stage.starters, skill: lerpSkill(ROOKIE_SKILL, ACE_SKILL, stage.skill), ghost: null },
    };
  }
  if (req?.kind === 'daily') {
    const daily = dailyChallenge(dayKey(now));
    return {
      // Everyone plays the day's seed, so the shuffle is the same for all.
      ...base, mode: 'daily', rules: daily.rules, seed: daily.seed, request: req, daily,
      title: `Daily: ${daily.title}`, twist: daily.text, you: { deck: daily.deck, starters: daily.starters },
      bot: { name: 'Challenger', deck: daily.foeDeck, starters: daily.foeStarters, skill: daily.foeSkill, ghost: null },
    };
  }
  if (req?.kind === 'gauntlet') return gauntletPlan({ seed: Math.floor(Math.random() * 2 ** 31), round: 1, carry: null }, base);
  if (req?.kind === 'event') {
    const event = currentEvent(now);
    const foe = eventFoe(event, seed, { deck: [...DEFAULT_DECK], starters: ['charmander', 'squirtle'] });
    return {
      ...base, mode: 'event', rules: event.rules, request: req, event,
      title: `Event: ${event.name}`, twist: event.text,
      you: event.decks === 'random' ? { deck: chaosDeck(seed) } : {},
      bot: { name: 'Event rival', deck: foe.deck, starters: foe.starters, skill: lerpSkill(ROOKIE_SKILL, ACE_SKILL, 0.6), ghost: null },
    };
  }
  if (options.training === true) return { ...base, mode: 'training', rules: rulesFor('training') };
  if (options.private === true) return { ...base, mode: 'friendly', rules: rulesFor('friendly') };
  return { ...base, mode: 'casual', rules: rulesFor('casual') };
}

function gauntletPlan(run: GauntletRun, base: Omit<Plan, 'mode' | 'rules'>): Plan {
  const round = gauntletRound(run.round, run.seed, run.carry);
  return {
    ...base, mode: 'gauntlet', rules: round.rules, gauntlet: run, request: null,
    title: `Gauntlet · Round ${run.round}`,
    twist: run.round === 1 ? 'Win to advance. Your towers keep their damage between rounds.' : 'Your towers carry their damage; fallen towers return at 25%.',
    bot: { name: `Gauntlet ${run.round}`, deck: round.foeDeck, starters: round.foeStarters, skill: round.foeSkill, ghost: null },
  };
}

/** A well-formed adventure request, or null. */
function parseAdventure(v: unknown): AdventureRequest | null {
  if (typeof v !== 'object' || v === null) return null;
  const r = v as Partial<{ kind: string; stage: unknown; draft: unknown }>;
  if (r.kind === 'league') return stageById(r.stage) ? { kind: 'league', stage: r.stage as string } : null;
  if (r.kind === 'daily' || r.kind === 'gauntlet') return { kind: r.kind };
  if (r.kind === 'event') return { kind: 'event', ...(Array.isArray(r.draft) ? { draft: r.draft as CardId[] } : {}) };
  return null;
}

function emptyStats(): BattleStats {
  return { cardsPlayed: 0, elixirSpent: 0, towerDamage: 0, defeated: 0 };
}

/** Health left in `team`'s towers. */
function towerHpOf(match: MatchState, team: Team): number {
  return match.entities.filter((e) => e.team === team && e.kind !== 'unit').reduce((sum, e) => sum + Math.max(0, e.hp), 0);
}

function isPlayMessage(m: unknown): m is PlayMessage {
  if (typeof m !== 'object' || m === null) return false;
  const { slot, x, y } = m as Record<string, unknown>;
  return typeof slot === 'number' && typeof x === 'number' && typeof y === 'number';
}
