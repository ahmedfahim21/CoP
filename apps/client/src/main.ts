import { inject } from '@vercel/analytics';
import { weakestTower, type AdventureRequest, type MatchMode, type SummaryMessage, type Team } from '@cop/shared';
import { track } from './analytics.js';
import { loadPrefs } from './prefs.js';
import { ProfileSession } from './profile.js';
import { adventure, createPrivate, joinByCode, rankedSearch, takeSeat, training, type Loadout, type Search, type Session } from './net.js';
import { bootModels } from './ui/boot.js';
import { askTrainerName } from './ui/intro.js';
import { Home } from './ui/home.js';
import { BattleHud } from './ui/hud.js';
import { QUEUE_MODES, ResultScreen, matchmakingOverlay } from './ui/overlays.js';
import { playPuzzle } from './ui/puzzle.js';
import { watchReplay } from './ui/replay.js';
import { sound } from './audio/sound.js';

type Mode = 'ranked' | 'training' | 'create' | { code: string } | { adventure: AdventureRequest };

// Vercel Web Analytics: page views on the deployed site; development builds only log to the console.
inject({ mode: import.meta.env.PROD ? 'production' : 'development' });

await bootModels({ splash: true });

// Menu taps click; cards in the battle hand have their own select sound.
document.addEventListener('pointerdown', (e) => {
  const el = (e.target as Element).closest('button, .card');
  if (el && !el.closest('.hand')) sound.play('tap');
});

const prefs = loadPrefs();
const profiles = new ProfileSession(prefs);
// New trainers name themselves first, so their profile is created with that name.
if (!prefs.named) profiles.chooseName(await askTrainerName());
void profiles.connect();
const params = new URLSearchParams(location.search);
const urlCode = params.get('room') ?? '';

let session: Session | null = null;
let hud: BattleHud | null = null;
let overlay: HTMLElement | null = null;
let search: Search | null = null;
/** Bumped whenever the player starts something new or backs out; late async results check it. */
let attempt = 0;
const resultUnsubs: Array<() => void> = [];

const home = new Home(prefs, profiles, {
  onRanked: () => void connect('ranked'),
  onTraining: () => void connect('training'),
  onCreateRoom: () => void connect('create'),
  onJoinRoom: (code) => void connect({ code }),
  onLeague: (stage) => void connect({ adventure: { kind: 'league', stage } }),
  onDaily: () => void connect({ adventure: { kind: 'daily' } }),
  onGauntlet: () => void connect({ adventure: { kind: 'gauntlet' } }),
  onEvent: (draft) => void connect({ adventure: { kind: 'event', ...(draft ? { draft } : {}) } }),
  onPuzzle: (id) => {
    home.hide();
    playPuzzle(id, profiles, () => backToMenu('adventure'));
  },
  onReplay: (matchId, team) => openReplay(matchId, team),
}, urlCode);
home.show();

/** Single-player modes come back to the Adventure tab. */
const ADVENTURE_MODES: readonly MatchMode[] = ['league', 'daily', 'gauntlet', 'event'];

// A shared replay link: ?replay=<battle>&side=<0|1>.
const replayId = Number.parseInt(params.get('replay') ?? '', 10);
if (Number.isSafeInteger(replayId) && replayId > 0) {
  history.replaceState(null, '', location.pathname);
  openReplay(replayId, params.get('side') === '1' ? 1 : 0);
}

function openReplay(matchId: number, team: Team) {
  home.hide();
  void watchReplay(matchId, team, () => backToMenu());
}

function loadout(): Loadout {
  return { starters: prefs.starters, name: prefs.name, deck: prefs.deck, credential: profiles.activeCredential };
}

function setOverlay(el: HTMLElement | null) {
  overlay?.remove();
  overlay = el;
  if (el) document.body.append(el);
}

function stopSearch() {
  const s = search;
  search = null;
  s?.cancel().catch((err: unknown) => console.error('Leaving the queue failed', err));
}

function fail(err: unknown) {
  console.error('Joining a battle failed', err);
  stopSearch();
  setOverlay(null);
  home.show(`Couldn't join: ${err instanceof Error ? err.message : String(err)}`);
}

async function connect(mode: Mode) {
  stopSearch();
  const my = ++attempt;
  if (mode === 'ranked') return searchRanked(my);
  setOverlay(matchmakingOverlay({ code: null, joining: typeof mode === 'object', onCancel: () => backToMenu() }).el);
  let s: Session;
  try {
    if (typeof mode === 'object' && 'adventure' in mode && !profiles.activeCredential) await profiles.connect();
    s = mode === 'training' ? await training(loadout())
      : mode === 'create' ? await createPrivate(loadout())
        : 'adventure' in mode ? await adventure(loadout(), mode.adventure)
          : await joinByCode(mode.code, loadout());
  } catch (err) {
    if (my === attempt) fail(err);
    return;
  }
  if (my !== attempt) {
    // Cancelled while the request was in flight.
    await s.leave().catch((err: unknown) => console.error('Leaving a cancelled room failed', err));
    return;
  }
  begin(s, mode === 'create');
}

async function searchRanked(my: number) {
  const searchStarted = Date.now();
  const mm = matchmakingOverlay({
    code: null, ranked: true,
    onCancel: () => {
      track({ name: 'queue_result', result: 'cancelled', waited: Math.round((Date.now() - searchStarted) / 1000) });
      backToMenu();
    },
    onTraining: () => void connect('training'),
  });
  setOverlay(mm.el);
  if (profiles.status !== 'ready') await profiles.connect();
  if (my !== attempt) return;
  const credential = profiles.activeCredential;
  if (!credential) return fail(new Error(`ranked battles need your trainer profile, and the game server can't be reached. ${profiles.problem ?? ''}`));
  let found: Search;
  try {
    found = await rankedSearch({ ...loadout(), credential }, (status) => mm.setStatus(status));
  } catch (err) {
    if (my === attempt) fail(err);
    return;
  }
  if (my !== attempt) return void found.cancel();
  search = found;
  try {
    const { session: s, mode } = await found.seated;
    if (search === found) search = null;
    if (my !== attempt) return void s.leave();
    track({ name: 'queue_result', result: mode, waited: Math.round((Date.now() - searchStarted) / 1000) });
    const notice = mode === 'training' ? 'No rivals online right now. Warm up against a bot!'
      : mode === 'ghost' ? 'No rivals online right now: you face a real trainer’s deck, played by the bot. Half trophies.' : null;
    begin(s, false, notice);
  } catch (err) {
    if (search === found) search = null;
    if (my === attempt) fail(err);
  }
}

/** `invite`: we created a friendly room and wait for the friend, showing its code. */
function begin(s: Session, invite: boolean, notice: string | null = null) {
  session = s;
  if (invite) setOverlay(matchmakingOverlay({ code: s.room.roomId, onCancel: () => backToMenu() }).el);
  watch(s, notice);
}

function watch(s: Session, notice: string | null) {
  s.room.onStateChange(() => {
    if (session !== s) return;
    if (!hud && s.state.phase !== 'waiting' && s.team !== undefined) startBattle(s, notice);
    if (hud && s.state.phase !== 'ended') {
      let away = false;
      s.state.players.forEach((p, id) => {
        if (id !== s.room.sessionId && !p.connected) away = true;
      });
      hud.setStatus(away ? 'Opponent disconnected — waiting for them…' : null);
    }
  });
  s.room.onDrop(() => {
    if (session === s) hud?.setStatus('Connection lost — reconnecting…');
  });
  s.room.onReconnect(() => {
    if (session === s) hud?.setStatus(null);
  });
  s.room.onLeave((code) => {
    if (session !== s) return; // we left on purpose
    console.error(`Left the battle room unexpectedly (code ${code})`);
    const ended = s.state.phase === 'ended';
    if (!ended) {
      teardown();
      home.show('Disconnected from the battle.');
    }
  });
  // Trophies and history change server-side the moment the battle is recorded.
  s.on('summary', (m) => {
    void profiles.refresh();
    trackSummary(s, m);
  });
}

/** Analytics for a finished battle: the outcome, and any milestone it reached. */
function trackSummary(s: Session, m: SummaryMessage) {
  const me = s.team;
  if (me === undefined) return;
  const winner = s.state.winner;
  track({ name: 'battle_end', mode: m.mode, outcome: winner === -1 ? 'draw' : winner === me ? 'win' : 'loss' });
  const r = m.teams[me].rewards;
  if (profiles.profile && profiles.profile.battles === 0) track({ name: 'first_battle' });
  if (r && r.levelAfter > r.levelBefore) track({ name: 'level_up', level: r.levelAfter });
  for (const q of r?.quests ?? []) track({ name: 'quest_complete', quest: q.kind });
  const stage = m.adventure?.stage;
  if (stage && stage.starsAfter > stage.starsBefore) track({ name: 'league_clear', stage: stage.id, stars: stage.starsAfter });
}

function startBattle(s: Session, notice: string | null) {
  setOverlay(null);
  home.hide();
  track({ name: 'battle_start', mode: s.mode });
  hud = new BattleHud(s, () => showResult(s));
  if (notice) hud.notify(notice, 3500);
}

function showResult(s: Session) {
  if (session !== s || !hud) return;
  const st = s.state;
  const me = s.team!;
  let foeName = 'Rival';
  let foeIsBot = false;
  let myCrowns = 0;
  let foeCrowns = 0;
  st.players.forEach((p) => {
    if (p.team === me) myCrowns = p.crowns;
    else {
      foeCrowns = p.crowns;
      foeName = p.name;
      foeIsBot = p.bot;
    }
  });
  const queueAgain = QUEUE_MODES.includes(s.mode);
  const result = new ResultScreen({
    winner: st.winner === -1 ? 'draw' : st.winner === me ? 'me' : 'foe',
    myTeam: me,
    mode: s.mode,
    myName: prefs.name,
    foeName,
    foeIsBot,
    myCrowns,
    foeCrowns,
    reason: st.resultReason,
    towerHealth: st.resultReason === 'tiebreak'
      ? { mine: weakestTower(st.entities.values(), me), foe: weakestTower(st.entities.values(), (1 - me) as Team) }
      : null,
    // A finished room can't be replayed: ranked and ghost queue again; everything else asks
    // the server for the next room (a rematch, the same stage again, the Gauntlet's next round).
    onAgain: () => (queueAgain ? void leave().then(() => connect('ranked')) : s.requestRematch()),
    onMenu: () => backToMenu(ADVENTURE_MODES.includes(s.mode) ? 'adventure' : undefined),
    onReplay: (matchId) => {
      const team = s.team ?? 0;
      void leave().then(() => openReplay(matchId, team));
    },
  });
  if (s.summary) result.setSummary(s.summary);
  if (s.rematchState) result.setRematch(s.rematchState);
  resultUnsubs.push(
    s.on('summary', (m) => result.setSummary(m)),
    s.on('rematchState', (m) => result.setRematch(m)),
    s.on('rematch', (m) => void rematch(s, m.reservation)),
  );
  hud.showResult(result.el);
}

/** Both players agreed: move into the rematch room the server reserved for us. */
async function rematch(old: Session, reservation: unknown) {
  if (session !== old) return;
  const my = ++attempt;
  teardown();
  setOverlay(matchmakingOverlay({ code: null, joining: true, onCancel: () => backToMenu() }).el);
  let s: Session;
  try {
    s = await takeSeat(reservation, loadout());
  } catch (err) {
    if (my === attempt) fail(err);
    return;
  } finally {
    old.leave().catch((err: unknown) => console.error('Leaving the finished room failed', err));
  }
  if (my !== attempt) return void s.leave();
  begin(s, false);
}

function teardown() {
  for (const u of resultUnsubs.splice(0)) u();
  hud?.dispose();
  hud = null;
  session = null;
  setOverlay(null);
}

async function leave() {
  const s = session;
  teardown();
  if (!s) return;
  try {
    await s.leave();
  } catch (err) {
    console.error('Leaving the room failed', err);
  }
}

function backToMenu(tab?: 'adventure') {
  attempt++;
  stopSearch();
  void leave();
  setOverlay(null);
  home.show();
  if (tab) home.open(tab);
  void profiles.refresh();
}

// Dev-only handle for inspecting state from the console.
if (import.meta.env.DEV) Object.assign(window, { __app: { get session() { return session; }, get hud() { return hud; }, profiles } });
