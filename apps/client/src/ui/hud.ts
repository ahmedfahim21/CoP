import { Crown, Trophy } from 'lucide';
import { CARDS, ELIXIR_MAX, type CardId, type ErrorMessage, type HandMessage, type Point, type Team } from '@cop/shared';
import type { Session } from '../net.js';
import { BattleView, type BarInfo } from '../three/battle.js';
import { cardEl, setCard } from './cards.js';
import { h, icon } from './dom.js';
import { avatar } from './home.js';

const ERROR_TEXT: Record<ErrorMessage['error'], string> = {
  'not-enough-elixir': 'Not enough elixir!',
  'bad-position': "Can't deploy there!",
  'not-playing': 'Wait for the battle to start!',
  'bad-slot': 'That play was rejected',
  'bad-message': 'That play was rejected',
};

interface BarEl {
  root: HTMLDivElement;
  fill: HTMLDivElement;
  lag: HTMLDivElement;
  num: HTMLDivElement | null;
  lastHp: number;
}

/**
 * The in-battle screen: the 3D view plus everything drawn over it. All play input goes
 * through here; the server decides whether a play is legal.
 */
export class BattleHud {
  readonly el: HTMLDivElement;
  readonly view: BattleView;
  private readonly team: Team;
  private readonly stageHost = h('div', { class: 'stage-host' });
  private readonly barsLayer = h('div', { class: 'bars-layer' });
  private readonly textLayer = h('div', { class: 'text-layer' });
  private readonly center = h('div', { class: 'banner-center' });
  private readonly statusBanner = h('div', { class: 'hud-banner', hidden: true });
  private readonly timerBox = h('div', { class: 'timer-box' });
  private readonly timerValue = h('div', { class: 'timer-value', textContent: '3:00' });
  private readonly timerLabel = h('div', { class: 'timer-label', textContent: 'Time left' });
  private readonly foeCrowns = h('div', { class: 'crowns' });
  private readonly myCrowns = h('div', { class: 'crowns' });
  private readonly foeName = h('div', { class: 'plate-name', textContent: 'Rival' });
  private readonly foeTag = h('div', { class: 'foe-tag' });
  private readonly cards: HTMLDivElement[] = [];
  private readonly nextHolder = h('div', {});
  private readonly elixir = h('div', { class: 'elixir' });
  private readonly elixirFill = h('div', { class: 'elixir-fill' });
  private readonly elixirNum = h('span', { textContent: '5' });
  private readonly dragCard = h('div', { class: 'drag-card hidden' });
  private readonly bars = new Map<string, BarEl>();
  private hand: HandMessage | null = null;
  /** Slots with a play in flight, oldest first; each server reply settles one. */
  private inFlight: number[] = [];
  private selected: number | null = null;
  private dragging = false;
  private lastPhase = '';
  private lastCount = -1;
  private wasDouble = false;
  private crowns = { mine: 0, foe: 0 };
  private ended = false;
  private toastTimer = 0;
  private readonly unsubs: Array<() => void> = [];

  constructor(private readonly session: Session, private readonly onEnded: () => void) {
    this.team = session.team!;
    this.el = h('div', { attrs: { id: 'battle' } },
      h('div', { class: 'battle-stage' }, this.stageHost, this.barsLayer, this.textLayer, this.center),
      h('div', { class: 'hud-top' },
        h('div', { class: 'foe-plate' }, avatar('blue'), h('div', {}, this.foeName, h('div', { class: 'foe-line' }, this.foeCrowns, this.foeTag))),
        this.timerBox,
      ),
      h('div', { class: 'mine-crowns' }, this.myCrowns),
      this.statusBanner,
      this.buildTray(),
      this.dragCard,
    );
    this.timerBox.append(this.timerLabel, this.timerValue);
    this.renderCrowns(this.foeCrowns, 0, 'enemy', false);
    this.renderCrowns(this.myCrowns, 0, 'mine', false);
    document.body.append(this.el);

    this.view = new BattleView(this.stageHost, session, {
      onBars: (bars) => this.updateBars(bars),
      onText: (text, x, y, tone) => this.floatText(text, x, y, tone),
    });
    this.unsubs.push(session.on('hand', (m) => this.setHand(m)));
    this.unsubs.push(session.on('error', (m) => {
      this.inFlight.shift();
      this.toast(ERROR_TEXT[m.error]);
    }));
    this.unsubs.push(this.view.stage.onFrame(() => this.tick()));
    if (session.hand) this.setHand(session.hand);
    this.setupStageInput();
  }

  dispose() {
    for (const u of this.unsubs) u();
    this.view.dispose();
    this.el.remove();
  }

  /** Disconnect notices from the app shell. */
  setStatus(text: string | null) {
    this.statusBanner.hidden = text === null;
    if (text) this.statusBanner.textContent = text;
  }

  showResult(content: HTMLElement) {
    this.el.append(content);
  }

  // --- Tray ---

  private buildTray(): HTMLElement {
    const hand = h('div', { class: 'hand' });
    for (let i = 0; i < 4; i++) {
      const c = h('div', { class: 'card' });
      c.addEventListener('pointerdown', (e) => this.onCardDown(e, i));
      this.cards.push(c);
      hand.append(c);
    }
    const ticks = h('div', { class: 'elixir-ticks' });
    for (let i = 0; i < 10; i++) ticks.append(h('i'));
    const drop = h('div', { class: 'drop big' }, this.elixirNum);
    this.elixir.append(drop, h('div', { class: 'elixir-bar' }, this.elixirFill, ticks));
    return h('div', { class: 'tray' },
      h('div', { class: 'next' }, h('div', { class: 'lbl', textContent: 'Next' }), this.nextHolder),
      hand,
      this.elixir,
    );
  }

  private setHand(m: HandMessage) {
    this.inFlight.shift();
    const prev = this.hand;
    this.hand = m;
    m.hand.forEach((id, i) => {
      if (prev?.hand[i] === id && this.cards[i]!.dataset.card === id) return;
      setCard(this.cards[i]!, id);
      // Replaced cards slide in from the "next" slot.
      if (prev) {
        this.cards[i]!.classList.remove('enter');
        void this.cards[i]!.offsetWidth;
        this.cards[i]!.classList.add('enter');
      }
      if (this.selected === i) this.deselect();
    });
    this.nextHolder.replaceChildren(cardEl(m.next));
  }

  private myElixir(): number {
    return this.session.state.players.get(this.session.room.sessionId)?.elixir ?? 0;
  }

  private playing(): boolean {
    const p = this.session.state.phase;
    return p === 'regular' || p === 'overtime';
  }

  private usable(i: number): boolean {
    const id = this.hand?.hand[i];
    return !!id && this.playing() && !this.inFlight.includes(i) && CARDS[id].cost <= this.myElixir();
  }

  // --- Input ---

  private onCardDown(e: PointerEvent, i: number) {
    e.preventDefault();
    const id = this.hand?.hand[i];
    if (!id) return;
    if (!this.usable(i)) {
      if (this.playing() && !this.inFlight.includes(i)) this.toast('Not enough elixir!');
      return;
    }
    this.select(i);
    this.dragging = true;
    this.dragCard.replaceChildren(cardEl(id));
    this.dragCard.style.left = `${e.clientX}px`;
    this.dragCard.style.top = `${e.clientY}px`;
    const card = this.cards[i]!;
    card.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => this.dragMove(ev, id);
    const up = (ev: PointerEvent) => {
      card.removeEventListener('pointermove', move);
      card.removeEventListener('pointerup', up);
      card.removeEventListener('pointercancel', up);
      card.classList.remove('dragging');
      this.dragCard.classList.add('hidden');
      this.dragging = false;
      const local = this.localAt(ev);
      if (local) this.tryPlay(local);
      else this.view.setGhost(null, null); // released on the tray: stays selected for tap-to-place
    };
    card.addEventListener('pointermove', move);
    card.addEventListener('pointerup', up);
    card.addEventListener('pointercancel', up);
  }

  private dragMove(e: PointerEvent, id: CardId) {
    const local = this.localAt(e);
    const card = this.cards[this.selected ?? 0]!;
    if (local) {
      // Over the arena the 3D ghost takes over from the floating card.
      this.dragCard.classList.add('hidden');
      card.classList.add('dragging');
      this.view.setGhost(id, local);
    } else {
      this.dragCard.classList.remove('hidden');
      card.classList.remove('dragging');
      this.dragCard.style.left = `${e.clientX}px`;
      this.dragCard.style.top = `${e.clientY}px`;
      this.view.setGhost(null, null);
    }
  }

  private setupStageInput() {
    const stage = this.stageHost;
    stage.addEventListener('pointerdown', (e) => {
      if (this.selected === null || this.dragging) return;
      const local = this.localAt(e);
      if (local) this.tryPlay(local);
    });
    stage.addEventListener('pointermove', (e) => {
      if (this.selected === null || this.dragging || e.pointerType !== 'mouse') return;
      const id = this.hand?.hand[this.selected];
      const local = this.localAt(e);
      if (id) this.view.setGhost(id, local);
    });
    stage.addEventListener('pointerleave', () => {
      if (!this.dragging) this.view.setGhost(null, null);
    });
  }

  /** Own-perspective tile under the pointer, only when the pointer is over the arena view. */
  private localAt(e: PointerEvent): Point | null {
    const r = this.stageHost.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return null;
    const p = this.view.pickLocal(e.clientX, e.clientY);
    if (!p || p.x < 0 || p.x > 18 || p.y < 0 || p.y > 32) return null;
    return p;
  }

  private select(i: number) {
    this.selected = i;
    this.cards.forEach((c, j) => c.classList.toggle('selected', j === i));
    this.view.showZone(this.hand?.hand[i] ?? null);
  }

  private deselect() {
    this.selected = null;
    this.cards.forEach((c) => c.classList.remove('selected', 'dragging'));
    this.view.showZone(null);
    this.view.setGhost(null, null);
  }

  private tryPlay(local: Point) {
    const slot = this.selected;
    const card = slot === null ? undefined : this.hand?.hand[slot];
    if (slot === null || !card) return;
    if (!this.view.canDeployAt(local, card)) {
      this.toast("Can't deploy there!");
      this.view.setGhost(null, null);
      return;
    }
    this.inFlight.push(slot);
    this.session.play({ slot, x: local.x, y: local.y });
    this.deselect();
  }

  // --- Per-frame HUD ---

  private tick() {
    const s = this.session.state;
    // Timer.
    const t = Math.max(0, Math.ceil(s.timeLeft));
    if (s.phase === 'countdown' || s.phase === 'waiting') {
      this.timerValue.textContent = '3:00';
    } else {
      this.timerValue.textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    }
    this.timerLabel.textContent = s.phase === 'overtime' ? 'Overtime' : 'Time left';
    this.timerBox.classList.toggle('urgent', (s.phase === 'regular' || s.phase === 'overtime') && t <= 10);

    // Countdown and announcements.
    if (s.phase === 'countdown') {
      const n = Math.max(1, t);
      if (n !== this.lastCount) {
        this.lastCount = n;
        this.announce(String(n), 'big');
      }
    }
    if (s.phase !== this.lastPhase) {
      if (this.lastPhase === 'countdown' && s.phase === 'regular') this.announce('Fight!', 'big fight');
      if (s.phase === 'overtime') this.announce('Overtime!', 'ribbon overtime');
      if (s.phase === 'ended' && !this.ended) {
        this.ended = true;
        this.deselect();
        setTimeout(() => this.onEnded(), 1600);
      }
      this.lastPhase = s.phase;
    }
    if (s.doubleElixir && !this.wasDouble && s.phase === 'regular') this.announce('2× Elixir!', 'ribbon');
    this.wasDouble = s.doubleElixir;

    // Names and crowns.
    s.players.forEach((p) => {
      if (p.team === this.team) {
        if (p.crowns !== this.crowns.mine) this.renderCrowns(this.myCrowns, (this.crowns.mine = p.crowns), 'mine', true);
      } else {
        if (this.foeName.textContent !== p.name) {
          this.foeName.textContent = p.name;
          // Bots are named "… (bot)"; guests have no trophies to show.
          this.foeTag.replaceChildren(...(p.profileId ? [icon(Trophy), String(p.trophies)] : []));
        }
        if (p.crowns !== this.crowns.foe) this.renderCrowns(this.foeCrowns, (this.crowns.foe = p.crowns), 'enemy', true);
      }
    });

    // Elixir.
    const elixir = this.myElixir();
    this.elixirFill.style.width = `${(Math.min(ELIXIR_MAX, elixir) / ELIXIR_MAX) * 100}%`;
    this.elixirNum.textContent = String(Math.floor(elixir));
    this.elixir.classList.toggle('double', s.doubleElixir);
    this.elixir.classList.toggle('full', elixir >= ELIXIR_MAX - 0.01);
    this.cards.forEach((c, i) => c.classList.toggle('unaffordable', !this.usable(i) && this.selected !== i));
    if (this.selected !== null && !this.usable(this.selected) && !this.dragging) this.deselect();
  }

  private renderCrowns(el: HTMLElement, count: number, side: 'mine' | 'enemy', animate: boolean) {
    el.replaceChildren(...[0, 1, 2].map((i) => {
      const c = icon(Crown, `crown ${side}${i < count ? ' won' : ''}${animate && i === count - 1 ? ' pop' : ''}`);
      return c;
    }));
  }

  private announce(text: string, cls: string) {
    const el = h('div', { class: cls, textContent: text });
    this.center.replaceChildren(el);
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }

  /** A short-lived banner, e.g. "Not enough elixir!". */
  notify(text: string, ms = 1300) {
    this.setStatus(text);
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.setStatus(null), ms);
  }

  private toast(text: string) {
    this.notify(text);
  }

  private floatText(text: string, x: number, y: number, tone: 'super' | 'weak' | 'special') {
    const el = h('div', { class: `float-text ${tone}`, textContent: text });
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    this.textLayer.append(el);
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }

  private updateBars(bars: BarInfo[]) {
    const seen = new Set<string>();
    for (const b of bars) {
      seen.add(b.id);
      let el = this.bars.get(b.id);
      if (!el) {
        el = this.createBar(b);
        this.bars.set(b.id, el);
        this.barsLayer.append(el.root);
      }
      el.root.style.display = b.visible ? '' : 'none';
      if (!b.visible) continue;
      el.root.style.transform = `translate(${b.x}px, ${b.y}px) translate(-50%, -100%)`;
      if (b.hp !== el.lastHp) {
        const pct = `${Math.max(0, b.hp / b.maxHp) * 100}%`;
        el.fill.style.width = pct;
        el.lag.style.width = pct;
        if (el.num) el.num.textContent = String(Math.max(0, b.hp));
        el.lastHp = b.hp;
      }
    }
    for (const [id, el] of this.bars) {
      if (seen.has(id)) continue;
      el.root.remove();
      this.bars.delete(id);
    }
  }

  private createBar(b: BarInfo): BarEl {
    const fill = h('div', { class: 'hp-fill' });
    const lag = h('div', { class: 'hp-lag' });
    const track = h('div', { class: 'hp-track' }, lag, fill);
    const kindCls = b.kind === 'unit' ? 'unit' : b.kind === 'king' ? 'tower king' : 'tower';
    const root = h('div', { class: `hp ${b.mine ? 'mine' : 'enemy'} ${kindCls}` });
    root.style.left = '0';
    root.style.top = '0';
    let num: HTMLDivElement | null = null;
    if (b.kind !== 'unit') {
      if (b.kind === 'king') root.append(h('div', { class: 'hp-badge' }, icon(Crown)));
      num = h('div', { class: 'hp-num', textContent: String(b.hp) });
    }
    root.append(track);
    if (num) root.append(num);
    const pct = `${Math.max(0, b.hp / b.maxHp) * 100}%`;
    fill.style.width = pct;
    lag.style.width = pct;
    return { root, fill, lag, num, lastHp: b.hp };
  }
}
