import Phaser from 'phaser';
import { isStarterId, type StarterId, type StarterPick } from '@cop/shared';
import { GAME_H, GAME_W } from './layout.js';
import { createPrivate, joinByCode, quickMatch, type Session } from './net.js';
import { BattleScene, type BattleData } from './scenes/Battle.js';
import { clearScreen, renderBusy, renderMenu, renderResult, renderWaiting, showBanner } from './ui/screens.js';

const PICK_STORAGE_KEY = 'cop:starters';

function loadPick(): StarterId[] {
  try {
    const raw = JSON.parse(localStorage.getItem(PICK_STORAGE_KEY) ?? '[]') as unknown;
    return Array.isArray(raw) ? raw.filter(isStarterId).slice(0, 2) : [];
  } catch (err) {
    // Storage is a convenience; private mode or corrupt data just means no remembered pick.
    console.warn('Could not read saved starters', err);
    return [];
  }
}

function savePick(pick: StarterPick) {
  try {
    localStorage.setItem(PICK_STORAGE_KEY, JSON.stringify(pick));
  } catch (err) {
    console.warn('Could not save starters', err);
  }
}

await document.fonts.load('16px "Press Start 2P"');

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: GAME_W,
  height: GAME_H,
  backgroundColor: '#151a26',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  input: { activePointers: 2 },
});
game.scene.add('battle', BattleScene, false);
// Dev-only handle for inspecting game state from the console.
if (import.meta.env.DEV) Object.assign(window, { __game: game });

type Mode = 'quick' | 'create' | { code: string };

let session: Session | null = null;
let battleRunning = false;
const urlCode = new URLSearchParams(location.search).get('room') ?? '';

function menu(error: string | null = null) {
  renderMenu({
    starters: loadPick(),
    code: urlCode,
    error,
    onQuick: (pick) => void connect('quick', pick),
    onCreate: (pick) => void connect('create', pick),
    onJoin: (pick, code) => void connect({ code }, pick),
  });
}

async function connect(mode: Mode, pick: StarterPick) {
  savePick(pick);
  renderBusy('Connecting…');
  let s: Session;
  try {
    s = mode === 'quick' ? await quickMatch(pick) : mode === 'create' ? await createPrivate(pick) : await joinByCode(mode.code, pick);
  } catch (err) {
    console.error('Joining a battle failed', err);
    const message = err instanceof Error ? err.message : String(err);
    return menu(`Couldn't join: ${message}`);
  }
  session = s;
  watch(s, mode);
}

function watch(s: Session, mode: Mode) {
  if (typeof mode === 'object') renderBusy('Joining room…');
  else renderWaiting({ code: mode === 'create' ? s.room.roomId : null, onCancel: () => backToMenu() });

  s.room.onStateChange(() => {
    if (session !== s) return;
    if (!battleRunning && s.state.phase !== 'waiting' && s.team !== undefined) startBattle(s, mode);
    if (battleRunning) {
      let opponentAway = false;
      s.state.players.forEach((p, id) => {
        if (id !== s.room.sessionId && !p.connected) opponentAway = true;
      });
      const waiting = opponentAway && s.state.phase !== 'ended';
      showBanner(waiting ? 'Opponent disconnected — waiting for them to return' : null);
    }
  });
  s.room.onDrop(() => {
    if (session === s) showBanner('Connection lost — reconnecting…');
  });
  s.room.onReconnect(() => {
    if (session === s) showBanner(null);
  });
  s.room.onLeave((code) => {
    if (session !== s) return; // we left on purpose
    console.error(`Left the battle room unexpectedly (code ${code})`);
    const wasEnded = s.state.phase === 'ended';
    stopBattle();
    session = null;
    if (!wasEnded) menu('Disconnected from the battle.');
  });
}

function startBattle(s: Session, mode: Mode) {
  battleRunning = true;
  clearScreen();
  showBanner(null);
  const data: BattleData = { session: s, onEnded: () => showResult(s, mode) };
  game.scene.start('battle', data);
}

function stopBattle() {
  battleRunning = false;
  showBanner(null);
  if (game.scene.isActive('battle')) game.scene.stop('battle');
}

function showResult(s: Session, mode: Mode) {
  if (session !== s) return;
  const st = s.state;
  const me = s.team!;
  let myCrowns = 0;
  let enemyCrowns = 0;
  st.players.forEach((p) => {
    if (p.team === me) myCrowns = p.crowns;
    else enemyCrowns = p.crowns;
  });
  renderResult({
    outcome: st.winner === -1 ? 'draw' : st.winner === me ? 'win' : 'loss',
    myCrowns,
    enemyCrowns,
    reason: st.resultReason,
    // Joining by code can't be repeated (that room is over), so "again" makes a fresh private room.
    onAgain: () => {
      void leaveCurrent();
      void connect(mode === 'quick' ? 'quick' : 'create', s.starters);
    },
    onMenu: () => backToMenu(),
  });
}

async function leaveCurrent() {
  const s = session;
  session = null;
  stopBattle();
  if (!s) return;
  try {
    await s.leave();
  } catch (err) {
    console.error('Leaving the room failed', err);
  }
}

function backToMenu() {
  void leaveCurrent();
  menu();
}

menu();
