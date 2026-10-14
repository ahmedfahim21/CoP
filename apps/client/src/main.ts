import { inject } from '@vercel/analytics';
import { loadPrefs } from './prefs.js';
import { ProfileSession } from './profile.js';
import { createPrivate, joinByCode, rankedSearch, takeSeat, training, type Loadout, type Search, type Session } from './net.js';
import { bootModels } from './ui/boot.js';
import { askTrainerName } from './ui/intro.js';
import { Home } from './ui/home.js';
import { BattleHud } from './ui/hud.js';
import { ResultScreen, matchmakingOverlay } from './ui/overlays.js';
import { sound } from './audio/sound.js';

type Mode = 'ranked' | 'training' | 'create' | { code: string };

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
const urlCode = new URLSearchParams(location.search).get('room') ?? '';

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
}, urlCode);
home.show();

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
  setOverlay(matchmakingOverlay({ code: null, joining: typeof mode === 'object', onCancel: backToMenu }).el);
  let s: Session;
  try {
    s = mode === 'training' ? await training(loadout()) : mode === 'create' ? await createPrivate(loadout()) : await joinByCode(mode.code, loadout());
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
  const mm = matchmakingOverlay({ code: null, ranked: true, onCancel: backToMenu, onTraining: () => void connect('training') });
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
    begin(s, false, mode === 'training' ? 'No rivals online right now. Warm up against a bot!' : null);
  } catch (err) {
    if (search === found) search = null;
    if (my === attempt) fail(err);
  }
}

/** `invite`: we created a friendly room and wait for the friend, showing its code. */
function begin(s: Session, invite: boolean, notice: string | null = null) {
  session = s;
  if (invite) setOverlay(matchmakingOverlay({ code: s.room.roomId, onCancel: backToMenu }).el);
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
  s.on('summary', () => void profiles.refresh());
}

function startBattle(s: Session, notice: string | null) {
  setOverlay(null);
  home.hide();
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
  const ranked = s.mode === 'ranked';
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
    // A finished room can't be replayed: ranked queues again, everything else asks for a fresh room.
    onAgain: () => (ranked ? void leave().then(() => connect('ranked')) : s.requestRematch()),
    onMenu: () => backToMenu(),
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
  setOverlay(matchmakingOverlay({ code: null, joining: true, onCancel: backToMenu }).el);
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

function backToMenu() {
  attempt++;
  stopSearch();
  void leave();
  setOverlay(null);
  home.show();
  void profiles.refresh();
}

// Dev-only handle for inspecting state from the console.
if (import.meta.env.DEV) Object.assign(window, { __app: { get session() { return session; }, get hud() { return hud; }, profiles } });
