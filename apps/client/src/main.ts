import { loadPrefs } from './prefs.js';
import { createPrivate, joinByCode, quickMatch, type Session } from './net.js';
import { Home } from './ui/home.js';
import { BattleHud } from './ui/hud.js';
import { matchmakingOverlay, resultOverlay } from './ui/overlays.js';

type Mode = 'quick' | 'create' | { code: string };

const prefs = loadPrefs();
const urlCode = new URLSearchParams(location.search).get('room') ?? '';

let session: Session | null = null;
let hud: BattleHud | null = null;
let overlay: HTMLElement | null = null;

const home = new Home(prefs, {
  onQuickMatch: () => void connect('quick'),
  onCreateRoom: () => void connect('create'),
  onJoinRoom: (code) => void connect({ code }),
}, urlCode);
home.show();

function setOverlay(el: HTMLElement | null) {
  overlay?.remove();
  overlay = el;
  if (el) document.body.append(el);
}

async function connect(mode: Mode) {
  const cancel = () => backToMenu();
  setOverlay(matchmakingOverlay({ code: null, joining: typeof mode === 'object', onCancel: cancel }));
  let s: Session;
  try {
    s = mode === 'quick'
      ? await quickMatch(prefs.starters, prefs.name)
      : mode === 'create'
        ? await createPrivate(prefs.starters, prefs.name)
        : await joinByCode(mode.code, prefs.starters, prefs.name);
  } catch (err) {
    console.error('Joining a battle failed', err);
    setOverlay(null);
    home.show(`Couldn't join: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  if (!overlay) {
    // Cancelled while the request was in flight.
    await s.leave().catch((err: unknown) => console.error('Leaving a cancelled room failed', err));
    return;
  }
  session = s;
  if (mode === 'create') setOverlay(matchmakingOverlay({ code: s.room.roomId, onCancel: cancel }));
  watch(s, mode);
}

function watch(s: Session, mode: Mode) {
  s.room.onStateChange(() => {
    if (session !== s) return;
    if (!hud && s.state.phase !== 'waiting' && s.team !== undefined) startBattle(s, mode);
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
}

function startBattle(s: Session, mode: Mode) {
  setOverlay(null);
  home.hide();
  hud = new BattleHud(s, () => showResult(s, mode));
}

function showResult(s: Session, mode: Mode) {
  if (session !== s || !hud) return;
  const st = s.state;
  const me = s.team!;
  let foeName = 'Rival';
  let myCrowns = 0;
  let foeCrowns = 0;
  st.players.forEach((p) => {
    if (p.team === me) myCrowns = p.crowns;
    else {
      foeCrowns = p.crowns;
      foeName = p.name;
    }
  });
  hud.showResult(resultOverlay({
    winner: st.winner === -1 ? 'draw' : st.winner === me ? 'me' : 'foe',
    myName: prefs.name,
    foeName,
    myCrowns,
    foeCrowns,
    reason: st.resultReason,
    // A finished room can't be rejoined, so "again" from a friendly makes a fresh room.
    onAgain: () => {
      void leave();
      void connect(mode === 'quick' ? 'quick' : 'create');
    },
    onMenu: () => backToMenu(),
  }));
}

function teardown() {
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
  void leave();
  setOverlay(null);
  home.show();
}

// Dev-only handle for inspecting state from the console.
if (import.meta.env.DEV) Object.assign(window, { __app: { get session() { return session; }, get hud() { return hud; } } });
