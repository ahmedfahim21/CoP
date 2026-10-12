import { CARDS, STARTERS, type CardId, type StarterId } from '@cop/shared';
import { h, artImg } from './dom.js';

const ART = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork';
export const artUrl = (dex: number) => `${ART}/${dex}.png`;

export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';

/** Card frames follow Clash Royale's rarity colours. Purely cosmetic. */
export const RARITY: Record<CardId, Rarity> = {
  rattata: 'common',
  zubat: 'common',
  machop: 'common',
  voltorb: 'rare',
  pikachu: 'rare',
  lapras: 'epic',
  charizard: 'epic',
  snorlax: 'legendary',
};

export function cardEl(id: CardId, opts: { count?: boolean } = {}): HTMLDivElement {
  const def = CARDS[id];
  return h('div', { class: 'card', data: { rarity: RARITY[id], type: def.stats.types[0]!, card: id } },
    h('div', { class: 'card-art' }, artImg(artUrl(def.dex), def.name)),
    h('div', { class: 'card-cost' }, dropEl(def.cost)),
    opts.count && def.count > 1 ? h('div', { class: 'count-badge', textContent: `×${def.count}` }) : null,
    h('div', { class: 'card-name', textContent: def.name }),
  );
}

export function starterArt(id: StarterId): HTMLImageElement {
  return artImg(artUrl(STARTERS[id].dex!), STARTERS[id].name);
}

export function dropEl(value: number | string, big = false): HTMLDivElement {
  return h('div', { class: big ? 'drop big' : 'drop' }, h('span', { textContent: String(value) }));
}

/** Swap the card shown in an existing card element (battle hand). */
export function setCard(el: HTMLElement, id: CardId) {
  const fresh = cardEl(id);
  el.replaceChildren(...fresh.childNodes);
  el.dataset.rarity = fresh.dataset.rarity!;
  el.dataset.type = fresh.dataset.type!;
  el.dataset.card = id;
}
