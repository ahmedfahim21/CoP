// Animation sandbox: runs the real simulation locally and renders it with the real battle view,
// so each speciality can be watched (and tuned) in isolation. Dev tool: open /sandbox.html.
import { REGULAR_SECONDS, createMatch, isCharging, step, type GameEvent, type MatchState, type Team } from '@cop/shared';
import { BattleView, type BattleSource, type EntityLike, type ProjectileLike } from '../three/battle.js';
import { bootModels } from '../ui/boot.js';
import { h } from '../ui/dom.js';
import { SCENARIOS, type Scenario } from './scenarios.js';

const TICK = 0.05;

/** Mirrors a local MatchState into the shape the battle view reads from the network. */
class LocalSource implements BattleSource {
  readonly state = { entities: new Map<string, EntityLike>(), projectiles: new Map<string, ProjectileLike>() };
  private readonly fx = new Set<(events: GameEvent[]) => void>();
  private readonly changes = new Set<() => void>();

  constructor(readonly team: Team, private match: MatchState) {
    this.mirror();
  }

  on(_event: 'fx', fn: (events: GameEvent[]) => void) {
    this.fx.add(fn);
    return () => this.fx.delete(fn);
  }

  onStateChange(fn: () => void) {
    this.changes.add(fn);
    return () => this.changes.delete(fn);
  }

  tick() {
    step(this.match, TICK);
    this.mirror();
    if (this.match.events.length > 0) for (const fn of this.fx) fn(this.match.events);
    for (const fn of this.changes) fn();
  }

  private mirror() {
    const ents = new Map<string, EntityLike>();
    for (const e of this.match.entities) {
      ents.set(e.id, {
        id: e.id, team: e.team, kind: e.kind, defId: e.defId, x: e.x, y: e.y, hp: Math.max(0, Math.ceil(e.hp)), maxHp: e.maxHp,
        deploying: e.deployTimer > 0, active: e.active, hidden: e.hidden, stunned: e.stun > 0, slowed: e.slow > 0,
        charging: isCharging(e),
      });
    }
    this.state.entities = ents;
    const shots = new Map<string, ProjectileLike>();
    for (const p of this.match.projectiles) shots.set(p.id, { id: p.id, team: p.team, sourceDefId: p.sourceDefId, targetId: p.targetId, x: p.x, y: p.y });
    this.state.projectiles = shots;
  }
}

const textLayer = h('div', { class: 'text-layer' });
const stageHost = h('div', { class: 'stage-host' });
const note = h('div', { class: 'sandbox-note' });
const bar = h('div', { class: 'sandbox-bar' });
document.body.append(h('div', { attrs: { id: 'sandbox' } }, h('div', { class: 'stage-wrap' }, stageHost, textLayer, note), bar));

let view: BattleView | null = null;
let timer = 0;
let current: Scenario = SCENARIOS[0]!;
let side: Team = 0;

function run(sc: Scenario, team: Team) {
  current = sc;
  side = team;
  clearInterval(timer);
  view?.dispose();
  const match = createMatch([['bulbasaur', 'charmander'], ['squirtle', 'charmander']], 7);
  match.phase = 'regular';
  match.timeLeft = REGULAR_SECONDS;
  sc.setup(match);
  const source = new LocalSource(team, match);
  view = new BattleView(stageHost, source, {
    onBars: () => undefined,
    onText: (text, x, y, tone) => {
      const el = h('div', { class: `float-text ${tone}`, textContent: text });
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      textLayer.append(el);
      el.addEventListener('animationend', () => el.remove(), { once: true });
    },
  });
  timer = window.setInterval(() => source.tick(), TICK * 1000);
  note.replaceChildren(sc.title, h('small', { textContent: sc.note }));
  renderBar();
  history.replaceState(null, '', `?scene=${sc.id}&side=${team}`);
}

function renderBar() {
  bar.replaceChildren(
    ...SCENARIOS.map((sc) => {
      const b = h('button', { class: 'btn small', textContent: sc.title, attrs: { 'aria-pressed': String(sc === current) } });
      b.addEventListener('click', () => run(sc, sc.view));
      return b;
    }),
    (() => {
      const b = h('button', { class: 'btn small purple', textContent: 'Replay' });
      b.addEventListener('click', () => run(current, side));
      return b;
    })(),
    (() => {
      const b = h('button', { class: 'btn small green', textContent: `Side: ${side === 0 ? 'Blue' : 'Red'}` });
      b.addEventListener('click', () => run(current, side === 0 ? 1 : 0));
      return b;
    })(),
  );
}

await bootModels();
const params = new URLSearchParams(location.search);
const initial = SCENARIOS.find((s) => s.id === params.get('scene')) ?? SCENARIOS[0]!;
run(initial, params.get('side') === '1' ? 1 : initial.view);

// Console handle for inspecting the running scene.
Object.assign(window, { __sandbox: { get view() { return view; } } });
