import { h, icon } from './dom.js';
import { Info } from './icons.js';

interface Credit {
  name: string;
  url: string;
  what: string;
}

const SECTIONS: Array<{ title: string; items: Credit[] }> = [
  {
    title: 'Pokémon art and sound',
    items: [
      { name: 'PokeAPI sprites', url: 'https://github.com/PokeAPI/sprites', what: 'Card artwork and the Gen III sprites on the loading screen' },
      { name: 'PokeAPI cries', url: 'https://github.com/PokeAPI/cries', what: 'Gen I Pokémon cries' },
      { name: 'Pokémon Showdown', url: 'https://play.pokemonshowdown.com', what: 'Trainer portraits' },
    ],
  },
  {
    title: 'Built with',
    items: [
      { name: 'three.js', url: 'https://threejs.org', what: '3D arena and characters' },
      { name: 'Blender', url: 'https://www.blender.org', what: 'Every Pokémon model, built by script' },
      { name: 'Colyseus', url: 'https://colyseus.io', what: 'Real-time multiplayer' },
      { name: 'Supabase', url: 'https://supabase.com', what: 'Profiles and the trophy ladder' },
      { name: 'Vite', url: 'https://vite.dev', what: 'Build tooling' },
    ],
  },
  {
    title: 'Look and feel',
    items: [
      { name: 'sakura-crossing', url: 'https://github.com/Kenton-GMI/sakura-crossing', what: 'Cel shading and ink outlines (MIT, © 2026 Kenton Wang)' },
      { name: 'RetroUI', url: 'https://retroui.io', what: 'Inspiration for the menu style' },
      { name: 'Hugeicons', url: 'https://hugeicons.com', what: 'Icons (MIT)' },
      { name: 'Archivo Black & Space Grotesk', url: 'https://fonts.google.com', what: 'Fonts (SIL Open Font License)' },
    ],
  },
];

/** The ⓘ that opens the credits. */
export function creditsButton(): HTMLButtonElement {
  const b = h('button', { class: 'info-btn', attrs: { 'aria-label': 'Credits', title: 'Credits' } }, icon(Info));
  b.addEventListener('click', showCredits);
  return b;
}

/** The credits: who made the game and whose work it stands on. */
export function showCredits() {
  const close = h('button', { class: 'btn gold', textContent: 'OK' });
  const link = (c: Credit) =>
    h('li', { class: 'credit' },
      h('a', { href: c.url, target: '_blank', rel: 'noopener noreferrer', textContent: c.name }),
      h('span', { class: 'credit-what', textContent: c.what }));
  const backdrop = h('div', { class: 'modal-backdrop' },
    h('div', { class: 'modal credits-modal', attrs: { role: 'dialog', 'aria-label': 'Credits' } },
      h('h2', { textContent: 'Credits' }),
      h('p', { class: 'credits-by' },
        'Clash of Pokémons by ',
        h('a', { href: 'https://github.com/ahmedfahim21', target: '_blank', rel: 'noopener noreferrer', textContent: 'ahmedfahim21' }),
        '. ',
        h('a', { href: 'https://github.com/ahmedfahim21/CoP', target: '_blank', rel: 'noopener noreferrer', textContent: 'Source on GitHub' }),
        '.'),
      ...SECTIONS.map((s) => h('section', { class: 'credits-section' },
        h('div', { class: 'detail-title stroke', textContent: s.title }),
        h('ul', { class: 'credit-list' }, ...s.items.map(link)))),
      h('p', { class: 'credits-note' },
        'A non-commercial fan project, not affiliated with or endorsed by Nintendo, Game Freak, The Pokémon Company or Supercell. ',
        'Pokémon © Nintendo / Game Freak / The Pokémon Company. Clash Royale © Supercell.'),
      h('div', { class: 'row modal-actions' }, close)));
  const dismiss = () => {
    backdrop.remove();
    window.removeEventListener('keydown', onKey);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') dismiss();
  };
  close.addEventListener('click', dismiss);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) dismiss();
  });
  window.addEventListener('keydown', onKey);
  document.body.append(backdrop);
  close.focus();
}
