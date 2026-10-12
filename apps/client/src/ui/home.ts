import { Bird, Castle, Crosshair, Footprints, Heart, Layers, Pencil, Shield, Sparkles, Swords, Target, Timer, Users, Zap } from 'lucide';
import { CARDS, DEFAULT_DECK, STARTERS, sanitizeTrainerName, TRAINER_NAME_MAX, type CardId, type StarterId, type StarterPick } from '@cop/shared';
import { ALL_STARTERS, savePrefs, type Prefs } from '../prefs.js';
import { createDiorama } from '../three/diorama.js';
import { trainerSpriteUrl } from '../config.js';
import { cardEl, dropEl, starterArt } from './cards.js';
import { h, icon } from './dom.js';

export type Tab = 'cards' | 'battle' | 'towers';

export interface HomeHooks {
  onQuickMatch(): void;
  onCreateRoom(): void;
  onJoinRoom(code: string): void;
}

/** The menu shell: top bar, three tabs, bottom navigation. */
export class Home {
  readonly el: HTMLDivElement;
  private readonly panels: Record<Tab, HTMLDivElement>;
  private readonly navButtons: Record<Tab, HTMLButtonElement>;
  private readonly errorEl = h('div', { class: 'error-text' });
  private readonly codeInput: HTMLInputElement;
  private diorama: { dispose(): void } | null = null;
  private dioramaHost = h('div', { class: 'stage-host' });
  private tab: Tab = 'battle';
  private activeSlot: 0 | 1 = 0;

  constructor(private readonly prefs: Prefs, private readonly hooks: HomeHooks, initialCode: string) {
    this.codeInput = h('input', { class: 'code-input', placeholder: 'Room code', value: initialCode, autocomplete: 'off', spellcheck: false, maxLength: 24 });
    this.panels = {
      cards: this.buildCards(),
      battle: this.buildBattle(),
      towers: this.buildTowers(),
    };
    const nav = h('nav', { class: 'nav' });
    const tabs: Array<[Tab, string, Parameters<typeof icon>[0]]> = [['cards', 'Cards', Layers], ['battle', 'Battle', Swords], ['towers', 'Towers', Castle]];
    this.navButtons = {} as Record<Tab, HTMLButtonElement>;
    for (const [t, label, ic] of tabs) {
      const b = h('button', { class: 'nav-tab', attrs: { role: 'tab', 'aria-selected': 'false' } }, icon(ic), h('span', { textContent: label }));
      b.addEventListener('click', () => this.select(t));
      this.navButtons[t] = b;
      nav.append(b);
    }
    this.el = h('div', { attrs: { id: 'app' } },
      this.buildTopbar(),
      h('div', { class: 'content' }, this.panels.cards, this.panels.battle, this.panels.towers),
      nav,
    );
    document.body.append(this.el);
    this.select('battle');
  }

  show(error: string | null = null) {
    this.el.hidden = false;
    this.errorEl.textContent = error ?? '';
    if (error) this.select('battle');
    this.mountDiorama();
  }

  hide() {
    this.el.hidden = true;
    this.unmountDiorama();
  }

  private select(tab: Tab) {
    this.tab = tab;
    this.el.dataset.tab = tab;
    for (const t of Object.keys(this.panels) as Tab[]) {
      this.panels[t].hidden = t !== tab;
      this.navButtons[t].setAttribute('aria-selected', String(t === tab));
    }
    if (tab === 'battle' && !this.el.hidden) this.mountDiorama();
    else this.unmountDiorama();
  }

  private mountDiorama() {
    if (this.diorama || this.tab !== 'battle') return;
    this.diorama = createDiorama(this.dioramaHost, this.prefs.starters);
  }

  private unmountDiorama() {
    this.diorama?.dispose();
    this.diorama = null;
  }

  // --- Top bar ---

  private buildTopbar(): HTMLElement {
    const name = h('div', { class: 'plate-name', textContent: this.prefs.name });
    const edit = h('button', { class: 'name-edit', attrs: { 'aria-label': 'Edit trainer name' } }, icon(Pencil));
    const textCol = h('div', { attrs: { style: 'min-width:0;flex:1' } }, name, h('div', { class: 'plate-sub', textContent: 'Kanto League' }));
    edit.addEventListener('click', () => {
      const input = h('input', { class: 'name-input', value: this.prefs.name, maxLength: TRAINER_NAME_MAX });
      const commit = () => {
        this.prefs.name = sanitizeTrainerName(input.value);
        savePrefs(this.prefs);
        name.textContent = this.prefs.name;
        input.replaceWith(name);
        edit.hidden = false;
      };
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') input.blur();
      });
      input.addEventListener('blur', commit, { once: true });
      name.replaceWith(input);
      edit.hidden = true;
      input.focus();
      input.select();
    });
    return h('header', { class: 'topbar' },
      h('div', { class: 'profile' }, avatar('red'), textCol, edit),
    );
  }

  // --- Battle tab ---

  private buildBattle(): HTMLDivElement {
    const battle = h('button', { class: 'btn gold battle' }, 'Battle', h('span', { class: 'sub', textContent: '1v1 · Quick match' }));
    battle.addEventListener('click', () => this.hooks.onQuickMatch());
    const create = h('button', { class: 'btn purple small' }, 'Create room');
    create.addEventListener('click', () => this.hooks.onCreateRoom());
    const join = h('button', { class: 'btn green small' }, 'Join');
    const updateJoin = () => (join.disabled = this.codeInput.value.trim() === '');
    this.codeInput.addEventListener('input', updateJoin);
    this.codeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !join.disabled) join.click();
    });
    join.addEventListener('click', () => this.hooks.onJoinRoom(this.codeInput.value));
    updateJoin();

    return h('div', { class: 'tab-panel' },
      h('div', { class: 'arena-showcase' }, this.dioramaHost, h('div', { class: 'arena-label stroke' }, 'Kanto Arena', h('small', { textContent: 'Pallet Town grounds' }))),
      battle,
      h('div', { class: 'panel' },
        h('div', { class: 'panel-title stroke' }, icon(Users), 'Friendly battle'),
        h('div', { class: 'row' }, create, this.codeInput, join),
        this.errorEl,
      ),
    );
  }

  // --- Cards tab ---

  private buildCards(): HTMLDivElement {
    const avg = DEFAULT_DECK.reduce((s, id) => s + CARDS[id].cost, 0) / DEFAULT_DECK.length;
    const grid = h('div', { class: 'deck-grid' });
    for (const id of DEFAULT_DECK) {
      const c = cardEl(id, { count: true });
      c.addEventListener('click', () => showCardDetail(id));
      grid.append(c);
    }
    return h('div', { class: 'tab-panel' },
      h('div', { class: 'deck-head' }, h('h2', { textContent: 'Battle Deck' }), h('div', { class: 'avg stroke' }, dropEl(avg.toFixed(1)), 'Avg. elixir')),
      grid,
      h('div', { class: 'hint', textContent: 'Tap a card to see its stats and move.' }),
    );
  }

  // --- Towers tab ---

  private buildTowers(): HTMLDivElement {
    const slots = h('div', { class: 'tower-slots' });
    const list = h('div', { class: 'starter-list' });
    const render = () => {
      slots.replaceChildren(...([0, 1] as const).map((i) => {
        const id = this.prefs.starters[i];
        const b = h('button', { class: 'tower-slot', attrs: { 'aria-pressed': String(this.activeSlot === i) } },
          h('div', { class: 'slot-label stroke', textContent: i === 0 ? 'Left tower' : 'Right tower' }),
          starterArt(id),
          h('div', { class: 'stroke', textContent: STARTERS[id].name }),
          typePills(STARTERS[id].stats.types),
        );
        b.addEventListener('click', () => {
          this.activeSlot = i;
          render();
        });
        return b;
      }));
      list.replaceChildren(...ALL_STARTERS.map((id) => {
        const used = this.prefs.starters.indexOf(id);
        const b = h('button', { class: 'starter-pick' }, starterArt(id), h('div', { class: 'nm stroke', textContent: STARTERS[id].name }));
        if (used >= 0) b.dataset.used = '';
        b.addEventListener('click', () => this.assignStarter(id, render));
        return b;
      }));
    };
    render();
    return h('div', { class: 'tab-panel' },
      h('h2', { textContent: 'Tower Pokémon' }),
      h('div', { class: 'hint', textContent: 'Your starters guard your side towers and attack with their typed moves.' }),
      slots,
      h('div', { class: 'hint', textContent: 'Pick a tower, then choose who guards it.' }),
      list,
    );
  }

  private assignStarter(id: StarterId, rerender: () => void) {
    const pick = [...this.prefs.starters] as [StarterId, StarterId];
    const other = this.activeSlot === 0 ? 1 : 0;
    // Choosing the one already on the other tower swaps them.
    if (pick[other] === id) pick[other] = pick[this.activeSlot];
    pick[this.activeSlot] = id;
    this.prefs.starters = pick as StarterPick;
    savePrefs(this.prefs);
    this.activeSlot = other;
    rerender();
  }
}

export function avatar(look: 'red' | 'blue'): HTMLDivElement {
  const img = h('img', { src: trainerSpriteUrl(look), alt: '', draggable: false });
  img.addEventListener('error', () => console.error(`Trainer sprite failed to load: ${img.src}`));
  return h('div', { class: look === 'red' ? 'avatar' : 'avatar enemy' }, img);
}

function typePills(types: readonly string[]): HTMLDivElement {
  return h('div', { class: 'types' }, ...types.map((t) => h('span', { class: 'type-pill', data: { type: t }, textContent: t })));
}

const TARGETS: Record<string, string> = { ground: 'Ground', 'air-ground': 'Air & ground', buildings: 'Towers only' };
const speedName = (s: number) => (s >= 2 ? 'Very fast' : s >= 1.5 ? 'Fast' : s >= 1 ? 'Medium' : 'Slow');

function showCardDetail(id: CardId) {
  const def = CARDS[id];
  const s = def.stats;
  const stat = (ic: Parameters<typeof icon>[0], k: string, v: string) => h('div', { class: 'stat' }, icon(ic), h('div', {}, h('div', { class: 'k', textContent: k }), h('div', { class: 'v stroke', textContent: v })));
  const close = h('button', { class: 'btn gold' }, 'OK');
  const card = cardEl(id, { count: true });
  const backdrop = h('div', { class: 'modal-backdrop' },
    h('div', { class: 'modal', attrs: { role: 'dialog', 'aria-label': def.name } },
      h('div', { class: 'modal-head' }, card, h('div', {}, h('h2', { textContent: def.name }), typePills(s.types))),
      h('div', { class: 'move-line stroke' }, icon(Sparkles), `${s.move.name}`, h('span', { class: 'type-pill', data: { type: s.move.type }, textContent: s.move.type })),
      h('div', { class: 'stats' },
        stat(Heart, 'Hitpoints', String(s.hp)),
        stat(Zap, s.splashRadius > 0 ? 'Area damage' : 'Damage', String(s.damage)),
        stat(Timer, 'Hit speed', `${s.hitSpeed}s`),
        stat(Crosshair, 'Range', s.range >= 2 ? `${s.range}` : 'Melee'),
        stat(Footprints, 'Speed', speedName(s.speed)),
        stat(Target, 'Targets', TARGETS[s.targets]!),
        stat(Shield, 'Count', def.count > 1 ? `×${def.count}` : '1'),
        stat(Bird, 'Flying', s.flying ? 'Yes' : 'No'),
      ),
      close,
    ),
  );
  const dismiss = () => backdrop.remove();
  close.addEventListener('click', dismiss);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) dismiss();
  });
  document.body.append(backdrop);
}
