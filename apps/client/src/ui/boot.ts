import { ATTACKING_TYPES, CARDS, CARD_IDS, DEFENDING_TYPES, FORMS, STARTERS, traitsOf, typeMultiplier, type CardId, type FormId, type StarterId } from '@cop/shared';
import { trainerSpriteUrl } from '../config.js';
import { loadModels } from '../three/rigs/models.js';
import { h } from './dom.js';
import { sound } from '../audio/sound.js';

/** Gen III (Emerald) pixel sprites, ~600 bytes each. */
const EMERALD = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/versions/generation-iii/emerald';

function spriteFor(name: string): string {
  if (name === 'red' || name === 'blue') return trainerSpriteUrl(name);
  const dex = CARDS[name as CardId]?.dex ?? FORMS[name as FormId]?.dex ?? STARTERS[name as StarterId]?.dex;
  if (!dex) throw new Error(`No sprite for model "${name}"`);
  return `${EMERALD}/${dex}.png`;
}

const cap = (t: string) => t[0]!.toUpperCase() + t.slice(1);
const list = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/** Loading tips, straight from the game data: every special ability and every type advantage. */
function tips(): string[] {
  const abilities = CARD_IDS.filter((id) => CARDS[id].stats.ability).map((id) => `${CARDS[id].name}: ${traitsOf(id).at(-1)!}`);
  const types = ATTACKING_TYPES.flatMap((a) => {
    const strong = DEFENDING_TYPES.filter((d) => typeMultiplier(a, [d]) > 1).map(cap);
    return strong.length ? [`${cap(a)} moves hit ${list(strong)} Pokémon for ×1.5 damage.`] : [];
  });
  return [...abilities, ...types];
}

/**
 * The loading screen, then the title screen. While the 3D models download, each one is a
 * "Who's that Pokémon?" silhouette that pops into colour as it arrives. With `splash`, the
 * screen then waits for a tap (which also unlocks audio) while the game builds underneath;
 * the returned promise resolves as soon as the models are in. Errors stay on screen and
 * are rethrown.
 */
export async function bootModels({ splash = false } = {}): Promise<void> {
  const fill = h('div', { class: 'boot-fill' });
  const ticks = h('div', { class: 'boot-ticks' }, ...Array.from({ length: 10 }, () => h('i')));
  const count = h('span', { class: 'boot-count', textContent: '0%' });
  const label = h('div', { class: 'boot-label' }, h('span', { textContent: 'Catching Pokémon' }), count);
  const dex = h('div', { class: 'boot-dex' });
  const tip = h('div', { class: 'boot-tip-text' });
  const tipBox = h('div', { class: 'boot-tip' }, h('span', { class: 'boot-tip-tag', textContent: 'Tip' }), tip);
  const play = h('button', { class: 'btn gold boot-play', textContent: 'Tap to play', hidden: true });
  const progress = h('div', { class: 'boot-progress' }, label, h('div', { class: 'boot-bar' }, fill, ticks));
  const el = h('div', { class: 'boot' },
    h('div', { class: 'boot-rays' }),
    h('div', { class: 'boot-stage' },
      h('div', { class: 'boot-logo' },
        h('span', { class: 'boot-logo-top', textContent: 'Clash' }),
        h('span', { class: 'boot-logo-of', textContent: 'of' }),
        h('span', { class: 'boot-logo-bottom', textContent: 'Pokémons' })),
      h('div', { class: 'boot-ball' }, h('i')),
      dex,
      progress,
      play,
      tipBox));
  document.body.append(el);

  const pool = tips();
  let tipIndex = Math.floor(Math.random() * pool.length);
  const nextTip = () => {
    tipIndex = (tipIndex + 1) % pool.length;
    tip.classList.remove('in');
    void tip.offsetWidth; // restart the slide-in
    tip.textContent = pool[tipIndex]!;
    tip.classList.add('in');
  };
  nextTip();
  const tipTimer = window.setInterval(nextTip, 3600);

  const slots = new Map<string, HTMLElement>();
  try {
    await loadModels(
      (done, total, name) => {
        const pct = Math.round((done / total) * 100);
        fill.style.width = `${pct}%`;
        count.textContent = `${done}/${total}`;
        slots.get(name)?.classList.add('caught');
      },
      (names) => {
        for (const name of names) {
          const img = h('img', { src: spriteFor(name), alt: '', draggable: false });
          img.addEventListener('error', () => console.error(`Boot sprite failed to load: ${img.src}`));
          const slot = h('div', { class: 'boot-mon', attrs: { title: name } }, img);
          slots.set(name, slot);
          dex.append(slot);
        }
      },
    );
  } catch (err) {
    window.clearInterval(tipTimer);
    console.error('Loading models failed', err);
    label.replaceChildren(h('span', { textContent: `Couldn't load the Pokémon models: ${err instanceof Error ? err.message : String(err)}` }));
    el.classList.add('failed');
    throw err;
  }

  const leave = () => {
    window.clearInterval(tipTimer);
    el.classList.add('leaving');
    el.addEventListener('animationend', () => el.remove(), { once: true });
  };
  if (!splash) {
    window.addEventListener('pointerdown', () => sound.unlock(), { once: true });
    leave();
    return;
  }
  el.classList.add('ready');
  progress.hidden = true;
  play.hidden = false;
  play.focus();
  const start = () => {
    sound.unlock();
    sound.play('select');
    window.removeEventListener('keydown', onKey);
    leave();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') start();
  };
  play.addEventListener('click', start);
  window.addEventListener('keydown', onKey);
}
