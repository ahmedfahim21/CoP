import { STARTERS, STARTER_IDS, isStarterPick, type StarterId, type StarterPick } from '@cop/shared';
import { pokemonSpriteUrl } from '../sprites.js';

const root = () => document.getElementById('ui')!;

type Child = Node | string | null | false;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & { class?: string; data?: Record<string, string> } = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  const { class: cls, data, ...rest } = props;
  if (cls) el.className = cls;
  if (data) for (const [k, v] of Object.entries(data)) el.dataset[k] = v;
  Object.assign(el, rest);
  for (const c of children) if (c !== null && c !== false) el.append(c);
  return el;
}

function mount(el: HTMLElement) {
  root().replaceChildren(el);
}

export function clearScreen() {
  root().replaceChildren();
}

const capitalize = (s: string) => s[0]!.toUpperCase() + s.slice(1);

export interface MenuProps {
  starters: StarterId[];
  code: string;
  error: string | null;
  onQuick(pick: StarterPick): void;
  onCreate(pick: StarterPick): void;
  onJoin(pick: StarterPick, code: string): void;
}

export function renderMenu(props: MenuProps) {
  let picked = [...props.starters];
  const quick = h('button', { class: 'primary', textContent: 'Quick match' });
  const create = h('button', { class: 'secondary', textContent: 'Create private room' });
  const codeInput = h('input', { class: 'code', placeholder: 'Room code', value: props.code, autocomplete: 'off', spellcheck: false });
  const join = h('button', { class: 'secondary', textContent: 'Join' });
  const hint = h('p', { class: 'center' });

  const tiles = STARTER_IDS.map((id) => {
    const def = STARTERS[id];
    const img = h('img', { src: pokemonSpriteUrl(def.dex!, 'front'), alt: def.name, class: 'pending', draggable: false });
    img.addEventListener('load', () => img.classList.remove('pending'));
    img.addEventListener('error', () => console.error(`Failed to load sprite for ${def.name}`));
    const tile = h('button', { class: 'starter', type: 'button' },
      img,
      h('span', { class: 'name', textContent: def.name }),
      h('span', { class: 'type', textContent: def.stats.types.map(capitalize).join(' / ') }),
    );
    tile.addEventListener('click', () => {
      picked = picked.includes(id) ? picked.filter((p) => p !== id) : [...picked, id].slice(-2);
      update();
    });
    return { id, tile };
  });

  const pick = (): StarterPick | null => (isStarterPick(picked) ? picked : null);

  function update() {
    for (const { id, tile } of tiles) {
      tile.querySelector('.slot')?.remove();
      const i = picked.indexOf(id);
      if (i >= 0) {
        tile.dataset.slot = String(i);
        tile.prepend(h('span', { class: 'slot', textContent: i === 0 ? 'LEFT' : 'RIGHT' }));
      } else {
        delete tile.dataset.slot;
      }
    }
    const ready = pick() !== null;
    quick.disabled = !ready;
    create.disabled = !ready;
    join.disabled = !ready || codeInput.value.trim() === '';
    hint.textContent = ready ? 'They guard your left and right towers.' : `Pick ${2 - picked.length} more starter${picked.length === 1 ? '' : 's'} for your towers.`;
  }

  quick.addEventListener('click', () => props.onQuick(pick()!));
  create.addEventListener('click', () => props.onCreate(pick()!));
  join.addEventListener('click', () => props.onJoin(pick()!, codeInput.value));
  codeInput.addEventListener('input', update);
  codeInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !join.disabled) join.click();
  });

  mount(h('div', { class: 'screen' },
    h('h1', { textContent: 'Clash of Pokémons' }),
    h('h2', { textContent: 'Choose two starters' }),
    h('div', { class: 'starters' }, ...tiles.map((t) => t.tile)),
    hint,
    quick,
    create,
    h('div', { class: 'divider' }),
    h('div', { class: 'row' }, codeInput, join),
    h('div', { class: 'error', textContent: props.error ?? '' }),
  ));
  update();
}

export function renderBusy(text: string) {
  mount(h('div', { class: 'screen' }, h('div', { class: 'spinner' }), h('p', { class: 'center', textContent: text })));
}

export function renderWaiting(props: { code: string | null; onCancel(): void }) {
  const cancel = h('button', { class: 'secondary', textContent: 'Cancel' });
  cancel.addEventListener('click', props.onCancel);

  let invite: HTMLElement | null = null;
  if (props.code) {
    const link = `${location.origin}${location.pathname}?room=${encodeURIComponent(props.code)}`;
    const copy = h('button', { class: 'primary', textContent: 'Copy invite link' });
    copy.addEventListener('click', async () => {
      await navigator.clipboard.writeText(link);
      copy.textContent = 'Copied';
    });
    invite = h('div', { class: 'invite' },
      h('h2', { textContent: 'Room code' }),
      h('div', { class: 'code-box', textContent: props.code }),
      copy,
    );
  }

  mount(h('div', { class: 'screen' },
    h('h1', { textContent: props.code ? 'Private room' : 'Quick match' }),
    h('div', { class: 'spinner' }),
    h('p', { class: 'center', textContent: props.code ? 'Waiting for your friend to join…' : 'Looking for an opponent…' }),
    invite,
    cancel,
  ));
}

export interface ResultProps {
  outcome: 'win' | 'loss' | 'draw';
  myCrowns: number;
  enemyCrowns: number;
  reason: string;
  onAgain(): void;
  onMenu(): void;
}

const REASONS: Record<string, string> = {
  king: 'The trainer fell.',
  crowns: 'Decided on crowns.',
  tiebreak: 'Tiebreak on tower health.',
  draw: 'Nobody could break through.',
  forfeit: 'A trainer left the battle.',
};

export function renderResult(props: ResultProps) {
  const again = h('button', { class: 'primary', textContent: 'Play again' });
  const menu = h('button', { class: 'secondary', textContent: 'Menu' });
  again.addEventListener('click', props.onAgain);
  menu.addEventListener('click', props.onMenu);
  const title = { win: 'Victory', loss: 'Defeat', draw: 'Draw' }[props.outcome];
  mount(h('div', { class: 'screen overlay' },
    h('div', { class: `display result-title ${props.outcome}`, textContent: title }),
    h('div', { class: 'crowns' },
      h('span', { class: 'mine', textContent: String(props.myCrowns) }),
      h('span', { class: 'sep', textContent: 'crowns' }),
      h('span', { class: 'enemy', textContent: String(props.enemyCrowns) }),
    ),
    h('p', { class: 'center', textContent: REASONS[props.reason] ?? '' }),
    again,
    menu,
  ));
}

let bannerEl: HTMLElement | null = null;

export function showBanner(text: string | null) {
  if (text === null) {
    bannerEl?.remove();
    bannerEl = null;
    return;
  }
  if (!bannerEl) {
    bannerEl = h('div', { class: 'banner' });
    document.body.append(bannerEl);
  }
  bannerEl.textContent = text;
}
