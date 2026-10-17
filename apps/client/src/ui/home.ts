import { ChevronLeft, ChevronRight, Castle, Crosshair, Dumbbell, Footprints, Heart, Info, Layers, Lock, MapIcon, Pencil, Sparkles, Swords, Target, Timer, Trophy, TYPE_ICONS, User, Users, Zap, type IconData } from './icons.js';
import { CARDS, CARD_IDS, ROLE_NAMES, STARTERS, ARENAS, arenaFor, cardInfo, unlockLevel, TRAINER_NAME_MAX, type CardId, type PokeType, type StarterId, type Team, type TypeMatchup, type StarterPick } from '@cop/shared';
import { ALL_STARTERS, type Prefs } from '../prefs.js';
import type { ProfileSession } from '../profile.js';
import { createDiorama, type Diorama } from '../three/diorama.js';
import { themeForArena } from '../three/themes.js';
import { trainerSpriteUrl } from '../config.js';
import { cardEl, dropEl, starterArt } from './cards.js';
import { h, icon } from './dom.js';
import { ProfilePanel, RanksPanel, trophyPill } from './ladder.js';
import { AdventurePanel, type AdventureHooks } from './adventure.js';
import { levelBadge, lockCard, unlockHint } from './progress.js';
import { api } from '../api.js';
import { sound } from '../audio/sound.js';
import { soundToggle } from './soundToggle.js';
import { creditsButton } from './credits.js';
import { LeaguePanel } from './league.js';

export type Tab = 'cards' | 'adventure' | 'battle' | 'ranks' | 'profile';

/** How often the Battle tab refreshes its online count. */
const STATUS_POLL_MS = 15_000;

export interface HomeHooks extends AdventureHooks {
  onReplay(matchId: number, team: Team): void;
  onRanked(): void;
  onTraining(): void;
  onCreateRoom(): void;
  onJoinRoom(code: string): void;
}

/** The menu shell: top bar, five tabs, bottom navigation. */
export class Home {
  readonly el: HTMLDivElement;
  private readonly panels: Record<Tab, HTMLDivElement>;
  private readonly navButtons: Record<Tab, HTMLButtonElement>;
  private readonly errorEl = h('div', { class: 'error-text' });
  private readonly codeInput: HTMLInputElement;
  private readonly ranks: RanksPanel;
  private diorama: Diorama | null = null;
  private dioramaHost = h('div', { class: 'stage-host' });
  private readonly arenaName = h('span', {});
  private readonly arenaSub = h('small', {});
  private readonly showcase = h('div', { class: 'arena-showcase' });
  private readonly arenaLock = h('div', { class: 'arena-lock' });
  private readonly arenaPrev = h('button', { class: 'arena-nav prev', attrs: { 'aria-label': 'Previous arena' } }, icon(ChevronLeft));
  private readonly arenaNext = h('button', { class: 'arena-nav next', attrs: { 'aria-label': 'Next arena' } }, icon(ChevronRight));
  private readonly arenaDots = h('div', { class: 'arena-dots' });
  /** The arena the slider shows; null follows your own. */
  private viewedArena: number | null = null;
  private readonly battleSub = h('span', { class: 'sub' });
  private readonly online = h('div', { class: 'online-count' });
  private statusTimer = 0;
  private cardsView: 'deck' | 'towers' = 'deck';
  private tab: Tab = 'battle';
  private activeSlot: 0 | 1 = 0;
  /** Re-render the loadout tabs, e.g. after the server profile replaces local prefs. */
  private readonly rerender: Array<() => void> = [];

  constructor(private readonly prefs: Prefs, private readonly profiles: ProfileSession, private readonly hooks: HomeHooks, initialCode: string) {
    this.codeInput = h('input', { class: 'code-input', placeholder: 'Room code', value: initialCode, autocomplete: 'off', spellcheck: false, maxLength: 24 });
    this.ranks = new RanksPanel(profiles);
    this.panels = {
      cards: this.buildCardsTab(),
      adventure: new AdventurePanel(profiles, hooks).el,
      battle: this.buildBattle(),
      ranks: this.ranks.el,
      profile: new ProfilePanel(profiles, hooks.onReplay).el,
    };
    const nav = h('nav', { class: 'nav' });
    const tabs: Array<[Tab, string, Parameters<typeof icon>[0]]> = [
      ['cards', 'Cards', Layers], ['adventure', 'Adventure', MapIcon], ['battle', 'Battle', Swords], ['ranks', 'Ranks', Trophy], ['profile', 'Profile', User],
    ];
    this.navButtons = {} as Record<Tab, HTMLButtonElement>;
    for (const [t, label, ic] of tabs) {
      const b = h('button', { class: 'nav-tab', attrs: { role: 'tab', 'aria-selected': 'false' } }, icon(ic), h('span', { textContent: label }));
      b.addEventListener('click', () => this.select(t));
      this.navButtons[t] = b;
      nav.append(b);
    }
    this.el = h('div', { attrs: { id: 'app' } },
      this.buildTopbar(),
      h('div', { class: 'content' }, ...Object.values(this.panels)),
      nav,
    );
    document.body.append(this.el);
    this.select('battle');
    this.showArena();
    let lastLoadout = loadoutKey(prefs);
    profiles.onChange(() => {
      this.showArena();
      // The server's copy of the loadout may have replaced the local one.
      const key = loadoutKey(prefs);
      if (key === lastLoadout) return;
      lastLoadout = key;
      for (const fn of this.rerender) fn();
      this.unmountDiorama();
      if (!this.el.hidden) this.mountDiorama();
    });
  }

  private showArena() {
    const p = this.profiles.profile;
    const own = arenaFor(p?.trophies ?? 0).index;
    const index = this.viewedArena ?? own;
    const arena = ARENAS[index - 1]!;
    const locked = index > own;
    this.arenaName.textContent = `Arena ${arena.index}`;
    this.arenaSub.textContent = locked ? `${arena.name} · locked` : arena.name;
    this.showcase.classList.toggle('locked', locked);
    this.arenaLock.replaceChildren(...(locked ? [icon(Lock), h('span', { textContent: `Unlocks at ${arena.minTrophies.toLocaleString()} trophies` })] : []));
    this.arenaPrev.disabled = index <= 1;
    this.arenaNext.disabled = index >= ARENAS.length;
    this.arenaDots.replaceChildren(...ARENAS.map((a) => h('span', { class: `dot${a.index === index ? ' on' : ''}${a.index > own ? ' locked' : ''}` })));
    this.diorama?.setTheme(themeForArena(index));
    this.battleSub.textContent = this.profiles.status === 'offline' ? 'Ranked · offline, tap to retry' : 'Ranked · 1v1';
  }

  show(error: string | null = null) {
    this.el.hidden = false;
    this.errorEl.textContent = error ?? '';
    if (error) this.select('battle');
    // Back from a battle: the slider returns to your own arena.
    if (this.viewedArena !== null) {
      this.viewedArena = null;
      this.showArena();
    }
    this.mountDiorama();
    this.pollStatus(this.tab === 'battle');
  }

  hide() {
    this.el.hidden = true;
    this.unmountDiorama();
    this.pollStatus(false);
  }

  /** Jump to a tab (e.g. Adventure after a Daily Challenge, Battle after a League stage). */
  open(tab: Tab) {
    this.select(tab);
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
    if (tab === 'ranks') void this.ranks.load();
    this.pollStatus(tab === 'battle' && !this.el.hidden);
  }

  /** "12 trainers online", refreshed while the Battle tab is showing. */
  private pollStatus(on: boolean) {
    clearInterval(this.statusTimer);
    this.statusTimer = 0;
    if (!on) return;
    const load = () => api.status().then((st) => {
      const others = Math.max(0, st.online);
      this.online.replaceChildren(h('span', { class: 'online-dot' }),
        h('span', { textContent: others === 0 ? 'Quiet right now: ghosts of real trainers fill in' : `${others} trainer${others === 1 ? '' : 's'} online · ${st.searching} searching` }));
    }, (err: unknown) => {
      console.warn('Status check failed', err);
      this.online.replaceChildren();
    });
    void load();
    this.statusTimer = window.setInterval(() => void load(), STATUS_POLL_MS);
  }

  private mountDiorama() {
    if (this.diorama || this.tab !== 'battle') return;
    const own = arenaFor(this.profiles.profile?.trophies ?? 0).index;
    this.diorama = createDiorama(this.dioramaHost, this.prefs.starters, themeForArena(this.viewedArena ?? own));
  }

  /** Steps the arena slider; you can look at every arena, the ones above yours show as locked. */
  private slideArena(step: -1 | 1) {
    const own = arenaFor(this.profiles.profile?.trophies ?? 0).index;
    const next = Math.min(ARENAS.length, Math.max(1, (this.viewedArena ?? own) + step));
    this.viewedArena = next === own ? null : next;
    this.showArena();
  }

  private buildShowcase(): HTMLDivElement {
    this.arenaPrev.addEventListener('click', () => this.slideArena(-1));
    this.arenaNext.addEventListener('click', () => this.slideArena(1));
    // Swipe sideways on the arena to slide.
    let start: { x: number; y: number; id: number } | null = null;
    this.showcase.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('button')) return;
      start = { x: e.clientX, y: e.clientY, id: e.pointerId };
    });
    const end = (e: PointerEvent) => {
      if (!start || e.pointerId !== start.id) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      start = null;
      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5) this.slideArena(dx < 0 ? 1 : -1);
    };
    this.showcase.addEventListener('pointerup', end);
    this.showcase.addEventListener('pointercancel', () => { start = null; });
    this.showcase.append(this.dioramaHost, this.arenaLock, this.arenaPrev, this.arenaNext, this.arenaDots,
      h('div', { class: 'arena-label stroke' }, this.arenaName, this.arenaSub));
    return this.showcase;
  }

  private unmountDiorama() {
    this.diorama?.dispose();
    this.diorama = null;
  }

  // --- Top bar ---

  private buildTopbar(): HTMLElement {
    const name = h('div', { class: 'plate-name', textContent: this.prefs.name });
    const sub = h('div', { class: 'plate-sub' });
    const trophies = h('div', {});
    const level = h('div', {});
    const edit = h('button', { class: 'name-edit', attrs: { 'aria-label': 'Edit trainer name' } }, icon(Pencil));
    const textCol = h('div', { attrs: { style: 'min-width:0;flex:1' } }, name, sub);
    const show = () => {
      const p = this.profiles.profile;
      // While the name is being edited, the input owns it.
      if (!edit.hidden) name.textContent = this.prefs.name;
      sub.textContent = p ? `${arenaFor(p.trophies).name}${p.rank ? ` · #${p.rank}` : ''}` : this.profiles.status === 'offline' ? 'Offline' : 'Kanto League';
      trophies.replaceChildren(trophyPill(p?.trophies ?? 0));
      level.replaceChildren(p ? levelBadge(this.profiles.level.level) : '');
    };
    this.profiles.onChange(show);
    show();
    textCol.addEventListener('click', () => {
      // Not while renaming: the click is for the input.
      if (!edit.hidden) this.select('profile');
    });
    edit.addEventListener('click', () => {
      const input = h('input', { class: 'name-input', value: this.prefs.name, maxLength: TRAINER_NAME_MAX });
      const commit = () => {
        this.profiles.chooseName(input.value);
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
      h('div', { class: 'profile' }, h('div', { class: 'avatar-wrap' }, avatar('red'), level), textCol, edit),
      trophies,
      soundToggle().el,
      creditsButton(),
    );
  }

  // --- Battle tab ---

  private buildBattle(): HTMLDivElement {
    const battle = h('button', { class: 'btn gold battle' }, 'Battle', this.battleSub);
    battle.addEventListener('click', () => this.hooks.onRanked());
    const train = h('button', { class: 'btn purple small' }, icon(Dumbbell, 'btn-icon'), ' Train');
    train.addEventListener('click', () => this.hooks.onTraining());
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
      this.buildShowcase(),
      battle,
      this.online,
      new LeaguePanel(this.profiles, (stage) => this.hooks.onLeague(stage)).el,
      h('div', { class: 'panel' },
        h('div', { class: 'row training-row' },
          h('div', { class: 'grow' },
            h('div', { class: 'panel-title stroke' }, icon(Dumbbell), 'Training camp'),
            h('div', { class: 'hint left', textContent: 'Practice against a bot as strong as your trophies. No trophies at stake.' })),
          train),
      ),
      h('div', { class: 'panel' },
        h('div', { class: 'panel-title stroke' }, icon(Users), 'Friendly battle'),
        h('div', { class: 'row' }, create, this.codeInput, join),
        this.errorEl,
      ),
    );
  }

  // --- Cards tab: the deck and the tower Pokémon ---

  private buildCardsTab(): HTMLDivElement {
    const deck = this.buildCards();
    const towers = this.buildTowers();
    const seg = h('div', { class: 'segmented', attrs: { role: 'tablist' } });
    const views: Array<['deck' | 'towers', string, IconData]> = [['deck', 'Deck', Layers], ['towers', 'Towers', Castle]];
    const show = () => {
      deck.hidden = this.cardsView !== 'deck';
      towers.hidden = this.cardsView !== 'towers';
      for (const b of seg.children) b.setAttribute('aria-selected', String((b as HTMLElement).dataset.view === this.cardsView));
    };
    for (const [view, label, ic] of views) {
      const b = h('button', { class: 'seg-btn', data: { view }, attrs: { role: 'tab' } }, icon(ic), label);
      b.addEventListener('click', () => {
        this.cardsView = view;
        show();
      });
      seg.append(b);
    }
    show();
    return h('div', { class: 'tab-panel' }, seg, deck, towers);
  }

  private buildCards(): HTMLDivElement {
    const panel = h('div', { class: 'sub-panel' });
    /** A collection card picked with "Use", waiting for the deck slot it replaces. */
    let pending: CardId | null = null;
    const render = () => {
      const deck = this.prefs.deck;
      const owned = this.profiles.unlocked;
      /** Unlocked cards outside the deck get a "Use" button in their detail screen. */
      const useFor = (id: CardId) => (deck.includes(id) || !owned.has(id) ? null : () => {
        pending = id;
        render();
      });
      const avg = deck.reduce((sum, id) => sum + CARDS[id].cost, 0) / deck.length;
      const grid = h('div', { class: pending ? 'deck-grid swapping' : 'deck-grid' });
      for (const id of deck) {
        const c = cardEl(id, { count: true });
        c.addEventListener('click', () => {
          if (pending) {
            this.prefs.deck = deck.map((d) => (d === id ? pending! : d));
            this.profiles.saveLoadout();
            pending = null;
            render();
          } else {
            showCardDetail(id, useFor);
          }
        });
        grid.append(c);
      }
      // Owned cards first, then the locked ones in the order they unlock.
      const rest = CARD_IDS.filter((id) => !deck.includes(id)).sort((a, b) => unlockOrder(a, owned) - unlockOrder(b, owned));
      const collection = h('div', { class: 'deck-grid' });
      for (const id of rest) {
        const c = cardEl(id, { count: true });
        if (pending === id) c.classList.add('picked');
        if (!owned.has(id)) lockCard(c, id);
        c.addEventListener('click', () => showCardDetail(id, useFor, owned.has(id)));
        collection.append(c);
      }
      const cancel = h('button', { class: 'btn small' }, 'Cancel');
      cancel.addEventListener('click', () => {
        pending = null;
        render();
      });
      const parts: Array<HTMLElement | null> = [
        h('div', { class: 'deck-head' },
          h('h2', { textContent: 'Battle Deck' }),
          h('div', { class: 'avg stroke' }, dropEl(avg.toFixed(1)), 'Avg. elixir')),
        pending
          ? h('div', { class: 'swap-banner' }, cardEl(pending), h('div', { class: 'stroke', textContent: `Tap a card in your deck to swap in ${CARDS[pending].name}` }), cancel)
          : null,
        grid,
        h('div', { class: 'collection-head' }, h('h2', { textContent: 'Card Collection' }), h('div', { class: 'found stroke', textContent: `Found: ${owned.size}/${CARD_IDS.length}` })),
        collection,
        h('div', { class: 'hint', textContent: owned.size < CARD_IDS.length
          ? 'Tap a card for its stats. Locked cards unlock as you level up, or sooner by beating the League.'
          : 'Tap a card for its stats and speciality.' }),
      ];
      panel.replaceChildren(...parts.filter((p): p is HTMLElement => p !== null));
    };
    render();
    this.rerender.push(() => {
      pending = null;
      render();
    });
    // Unlocks arrive with the profile (after battles, puzzles and level-ups).
    let ownedKey = '';
    this.profiles.onChange(() => {
      const key = [...this.profiles.unlocked].sort().join();
      if (key === ownedKey) return;
      ownedKey = key;
      render();
    });
    return panel;
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
    this.rerender.push(render);
    return h('div', { class: 'sub-panel' },
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
    this.profiles.saveLoadout();
    this.activeSlot = other;
    rerender();
  }
}

function loadoutKey(p: Prefs): string {
  return JSON.stringify([p.name, p.deck, p.starters]);
}

export function avatar(look: 'red' | 'blue'): HTMLDivElement {
  const img = h('img', { src: trainerSpriteUrl(look), alt: '', draggable: false });
  img.addEventListener('error', () => console.error(`Trainer sprite failed to load: ${img.src}`));
  return h('div', { class: look === 'red' ? 'avatar' : 'avatar enemy' }, img);
}

function typePills(types: readonly PokeType[]): HTMLDivElement {
  return h('div', { class: 'types' }, ...types.map((t) => typePill(t)));
}

/** A type badge; `note` adds a multiplier such as ×2. */
function typePill(t: PokeType, note: string | null = null): HTMLSpanElement {
  return h('span', { class: 'type-pill', data: { type: t } }, icon(TYPE_ICONS[t]), t, note ? h('span', { class: 'type-note', textContent: note }) : null);
}

const TARGETS: Record<string, string> = { ground: 'Ground', 'air-ground': 'Air & ground', buildings: 'Towers only' };
const RARITY: Record<string, string> = { common: 'Common', rare: 'Rare', epic: 'Epic', legendary: 'Legendary' };
const speedName = (s: number) => (s === 0 ? 'Stationary' : s >= 2 ? 'Very fast' : s >= 1.5 ? 'Fast' : s >= 1 ? 'Medium' : 'Slow');
const times = (m: number) => `×${m}`;

/**
 * Everything about a card: special traits with their numbers, roles, stats, type matchups
 * and how it fares against each starter tower. `useFor` decides whether a card gets a
 * "Use" button (cards outside the deck).
 */
function showCardDetail(id: CardId, useFor: (id: CardId) => (() => void) | null, owned = true) {
  const def = CARDS[id];
  const s = def.stats;
  const info = cardInfo(id);
  const onUse = useFor(id);
  sound.cry(def.dex);
  const stat = (ic: IconData, k: string, v: string) => h('div', { class: 'stat' }, icon(ic), h('div', {}, h('div', { class: 'k', textContent: k }), h('div', { class: 'v stroke', textContent: v })));
  const close = h('button', { class: onUse ? 'btn' : 'btn gold' }, 'OK');
  const use = onUse ? h('button', { class: 'btn gold' }, 'Use') : null;

  const matchRow = (label: string, list: readonly TypeMatchup[], empty: string) =>
    h('div', { class: 'match-type-row' },
      h('span', { class: 'match-type-label stroke', textContent: label }),
      list.length
        ? h('div', { class: 'types' }, ...list.map((m) => typePill(m.type, m.multiplier === 1.5 ? null : times(m.multiplier))))
        : h('span', { class: 'detail-empty', textContent: empty }));

  const damageLabel = s.splashRadius > 0 || s.ability?.kind === 'spin' ? 'Area damage' : 'Damage';
  const damageValue = s.ability?.kind === 'ramp' ? `${s.damage}→${s.damage * s.ability.multipliers[s.ability.multipliers.length - 1]!}` : String(s.damage);

  const backdrop = h('div', { class: 'modal-backdrop' },
    h('div', { class: 'modal card-modal', attrs: { role: 'dialog', 'aria-label': def.name } },
      h('div', { class: 'modal-head' }, cardEl(id, { count: true }),
        h('div', { class: 'modal-head-text' },
          h('h2', { textContent: def.name }),
          h('div', { class: 'detail-sub' }, h('span', { class: `rarity-tag ${def.rarity}`, textContent: RARITY[def.rarity]! }), dropEl(def.cost), `${def.cost} elixir`),
          typePills(s.types),
          h('div', { class: 'role-row' }, ...info.roles.map((r) => h('span', { class: 'role-tag', textContent: ROLE_NAMES[r] }))))),
      def.special || info.traits.length
        ? h('div', { class: 'special' },
          def.special ? h('div', { class: 'special-name stroke' }, icon(Sparkles), def.special.name) : h('div', { class: 'special-name stroke' }, icon(Info), 'Traits'),
          def.special ? h('div', { class: 'special-text', textContent: def.special.text }) : null,
          info.traits.length ? h('ul', { class: 'trait-list' }, ...info.traits.map((t) => h('li', { textContent: t }))) : null)
        : null,
      h('div', { class: 'move-line' }, icon(Swords), h('span', { class: 'stroke', textContent: s.move.name }), typePill(s.move.type),
        h('span', { class: 'move-dps', textContent: s.damage > 0 ? `${info.dps} DPS` : 'No damage' })),
      h('div', { class: 'stats' },
        stat(Heart, 'Hitpoints', def.count > 1 ? `${s.hp} ×${def.count}` : String(s.hp)),
        stat(Zap, damageLabel, damageValue),
        stat(Timer, 'Hit speed', `${s.hitSpeed}s`),
        stat(Crosshair, 'Range', s.range >= 2 ? `${s.range} tiles` : 'Melee'),
        stat(Footprints, 'Speed', speedName(s.speed)),
        stat(Target, 'Targets', TARGETS[s.targets]!),
      ),
      h('div', { class: 'type-matchups' },
        matchRow('Strong vs', info.strongAgainst, s.damage > 0 ? 'No type advantage' : 'Deals no damage'),
        matchRow('Weak to', info.weakAgainst, 'No weaknesses'),
        matchRow('Resists', info.resists, 'Nothing')),
      h('div', { class: 'tower-matchups' }, ...info.towers.map((t) => h('div', { class: 'tower-matchup', attrs: { title: `${STARTERS[t.id].name} tower` } },
        h('span', { class: 'mini-art' }, starterArt(t.id)),
        h('div', { class: 'tower-mults' },
          h('span', { class: `mult ${tone(t.dealt)}`, textContent: `deals ${times(t.dealt)}` }),
          h('span', { class: `mult ${tone(1 / t.taken)}`, textContent: `takes ${times(t.taken)}` }))))),
      owned ? null : h('div', { class: 'locked-note' }, icon(Lock), h('span', { textContent: unlockHint(id) })),
      h('div', { class: 'row modal-actions' }, close, use),
    ),
  );
  const dismiss = () => backdrop.remove();
  close.addEventListener('click', dismiss);
  use?.addEventListener('click', () => {
    dismiss();
    onUse!();
  });
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) dismiss();
  });
  document.body.append(backdrop);
}

/** Good for this card above 1, bad below. */
const tone = (m: number) => (m > 1 ? 'good' : m < 1 ? 'bad' : 'plain');

/** Collection order: owned cards (0), then locked ones by the level that opens them. */
function unlockOrder(id: CardId, owned: Set<CardId>): number {
  return owned.has(id) ? 0 : unlockLevel(id) ?? 99;
}
