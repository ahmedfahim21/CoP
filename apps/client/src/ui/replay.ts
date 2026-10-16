import { isReplay, playCard, startReplay, type Replay, type ReplayResponse, type Team } from '@cop/shared';
import { api } from '../api.js';
import { track } from '../analytics.js';
import { LocalBattle } from '../local.js';
import { h, icon } from './dom.js';
import { BattleHud } from './hud.js';
import { Link, Pause, Play, Restart, Tick, ToStart } from './icons.js';

/**
 * Watching a stored battle. Replays are a recipe (seed, loadouts, rules, plays per step),
 * so the browser re-simulates the battle and shows it with the normal battle screen, from
 * either side, at 1×, 2× or 4×.
 */
export async function watchReplay(matchId: number, side: Team | null, onClose: () => void): Promise<void> {
  const loading = h('div', { class: 'mm' }, h('div', { class: 'mm-box' }, h('div', { class: 'spinner' }), h('h2', { textContent: 'Loading replay' })));
  document.body.append(loading);
  let res: ReplayResponse;
  try {
    res = await api.replay(matchId);
  } catch (err) {
    loading.remove();
    alert(`That replay couldn't be loaded: ${err instanceof Error ? err.message : String(err)}`);
    onClose();
    return;
  }
  loading.remove();
  if (!isReplay(res.replay)) {
    alert('That replay is from an older version of the game and can no longer be played.');
    onClose();
    return;
  }
  track({ name: 'replay_watched' });
  new ReplayViewer(res, res.replay, side ?? 0, onClose);
}

const SPEEDS = [1, 2, 4] as const;

class ReplayViewer {
  private battle!: LocalBattle;
  private hud!: BattleHud;
  private readonly bar: HTMLDivElement;
  private readonly playBtn = h('button', { class: 'replay-icon', attrs: { 'aria-label': 'Pause', title: 'Pause' } }, icon(Pause));
  /** 1× / 2× / 4×, the current one highlighted. */
  private readonly speedBtns = SPEEDS.map((s) => h('button', { class: 'replay-speed', textContent: `${s}×`, attrs: { 'aria-label': `${s}× speed`, 'aria-pressed': String(s === 1) } }));
  private speed = 1;
  private paused = false;

  constructor(private readonly res: ReplayResponse, private readonly replay: Replay, private readonly side: Team, private readonly onClose: () => void) {
    const restart = h('button', { class: 'replay-icon', attrs: { 'aria-label': 'Restart from the beginning', title: 'Restart' } }, icon(ToStart));
    const share = h('button', { class: 'replay-icon', attrs: { 'aria-label': 'Copy a link to this replay', title: 'Copy link' } }, icon(Link));
    const close = h('button', { class: 'replay-close', textContent: 'Close' });
    this.playBtn.addEventListener('click', () => this.togglePause());
    this.speedBtns.forEach((b, i) => b.addEventListener('click', () => this.setSpeed(SPEEDS[i]!)));
    restart.addEventListener('click', () => this.restart());
    share.addEventListener('click', async () => {
      const url = `${location.origin}${location.pathname}?replay=${res.id}&side=${side}`;
      try {
        await navigator.clipboard.writeText(url);
        share.classList.add('done');
        share.replaceChildren(icon(Tick));
        window.setTimeout(() => {
          share.classList.remove('done');
          share.replaceChildren(icon(Link));
        }, 1600);
      } catch (err) {
        console.error('Copying the replay link failed', err);
        prompt('Copy the replay link:', url);
      }
    });
    close.addEventListener('click', () => this.close());
    this.bar = h('div', { class: 'replay-bar' },
      h('div', { class: 'replay-tag', attrs: { 'aria-label': 'Replay' } }, h('span', { textContent: 'Replay' })),
      this.playBtn,
      h('div', { class: 'replay-speeds', attrs: { role: 'group', 'aria-label': 'Playback speed' } }, ...this.speedBtns),
      restart,
      share,
      close);
    this.start();
  }

  private start() {
    const r = this.replay;
    const match = startReplay(r);
    const names: [string, string] = [r.names[0], r.names[1]];
    this.battle = new LocalBattle(match, { team: this.side, names, interactive: false, title: '', twist: '' });
    this.battle.state.mode = this.res.mode;
    // Recorded plays go in before their step, exactly as the server applied them.
    this.battle.beforeStep = (m, n) => {
      let mine = false;
      for (const p of r.plays) {
        if (p.step !== n) continue;
        playCard(m, p.team, p.slot, p);
        if (p.team === this.side) mine = true;
      }
      if (mine) this.battle.refreshHand();
    };
    this.battle.speed = this.paused ? 0 : this.speed;
    this.hud = new BattleHud(this.battle, () => this.ended());
    this.hud.el.classList.add('replaying');
    this.hud.el.append(this.bar);
    this.battle.start();
  }

  private togglePause() {
    this.paused = !this.paused;
    this.battle.speed = this.paused ? 0 : this.speed;
    this.playBtn.replaceChildren(icon(this.paused ? Play : Pause));
    this.playBtn.setAttribute('aria-label', this.paused ? 'Play' : 'Pause');
    this.playBtn.title = this.paused ? 'Play' : 'Pause';
  }

  private setSpeed(s: number) {
    this.speed = s;
    this.speedBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(SPEEDS[i] === s)));
    if (!this.paused) this.battle.speed = s;
  }

  private restart() {
    this.teardown();
    this.start();
  }

  private ended() {
    const again = h('button', { class: 'btn gold' }, icon(Restart, 'btn-icon'), ' Watch again');
    const close = h('button', { class: 'btn' }, 'Close');
    again.addEventListener('click', () => this.restart());
    close.addEventListener('click', () => this.close());
    const winner = this.replay.result?.winner;
    this.hud.showResult(h('div', { class: 'result replay-end' },
      h('h2', { textContent: winner === null || winner === undefined ? 'Draw' : `${this.replay.names[winner]} won` }),
      h('div', { class: 'reason', textContent: `${this.replay.names[0]} ${this.res.players[0]?.crowns ?? 0} – ${this.res.players[1]?.crowns ?? 0} ${this.replay.names[1]}` }),
      h('div', { class: 'actions' }, close, again)));
  }

  private teardown() {
    this.battle.dispose();
    this.hud.dispose();
  }

  private close() {
    this.teardown();
    this.onClose();
  }
}
