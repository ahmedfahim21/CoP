import { loadModels } from '../three/rigs/models.js';
import { h } from './dom.js';

/** Loading screen shown while the 3D models download. Errors stay on screen and are rethrown. */
export async function bootModels(): Promise<void> {
  const bar = h('div', { class: 'boot-fill' });
  const label = h('div', { class: 'boot-label stroke', textContent: 'Loading Pokémon…' });
  const el = h('div', { class: 'boot' }, h('div', { class: 'boot-title stroke', textContent: 'Clash of Pokémons' }), h('div', { class: 'boot-bar' }, bar), label);
  document.body.append(el);
  try {
    await loadModels((done, total) => {
      bar.style.width = `${(done / total) * 100}%`;
      label.textContent = `Loading Pokémon… ${done}/${total}`;
    });
    el.remove();
  } catch (err) {
    console.error('Loading models failed', err);
    label.textContent = `Couldn't load the Pokémon models: ${err instanceof Error ? err.message : String(err)}`;
    el.classList.add('failed');
    throw err;
  }
}
