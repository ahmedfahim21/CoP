import { TRAINER_NAME_MAX } from '@cop/shared';
import { h } from './dom.js';
import { avatar } from './home.js';

/** Names from the games, one tap away. */
const SUGGESTIONS = ['Red', 'Leaf', 'Gold', 'Kris', 'Brendan', 'May'];

/**
 * First run: ask the player for their trainer name. Shown behind the title screen, so tapping
 * "Tap to play" reveals it; resolves with what they typed once they confirm.
 */
export function askTrainerName(): Promise<string> {
  return new Promise((resolve) => {
    const input = h('input', {
      class: 'intro-input', maxLength: TRAINER_NAME_MAX, placeholder: 'Your name',
      autocomplete: 'off', spellcheck: false, enterKeyHint: 'go',
      attrs: { 'aria-label': 'Trainer name', autocapitalize: 'words' },
    });
    const go = h('button', { class: 'btn gold intro-go', textContent: "Let's go!", disabled: true });
    const sync = () => (go.disabled = input.value.trim() === '');
    const chips = SUGGESTIONS.map((name) => {
      const b = h('button', { class: 'intro-chip', textContent: name, type: 'button' });
      b.addEventListener('click', () => {
        input.value = name;
        sync();
        input.focus();
      });
      return b;
    });
    const el = h('div', { class: 'intro', attrs: { role: 'dialog', 'aria-label': 'Choose your trainer name' } },
      h('div', { class: 'intro-card' },
        h('div', { class: 'intro-head' },
          avatar('red'),
          h('div', {},
            h('div', { class: 'intro-kicker', textContent: 'Welcome to the Kanto League!' }),
            h('h2', { textContent: 'First, what is your name?' }))),
        input,
        h('div', { class: 'intro-chips' }, ...chips),
        h('div', { class: 'hint left', textContent: `Up to ${TRAINER_NAME_MAX} characters. Rivals see it in battle; you can change it later.` }),
        go));

    const submit = () => {
      if (go.disabled) return;
      el.classList.add('leaving');
      window.setTimeout(() => el.remove(), 450);
      resolve(input.value);
    };
    input.addEventListener('input', sync);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
    });
    go.addEventListener('click', submit);
    document.body.append(el);

    // Focus once the title screen above it has gone, so the keyboard doesn't open behind it.
    const focusWhenVisible = () => {
      if (document.querySelector('.boot')) requestAnimationFrame(focusWhenVisible);
      else input.focus();
    };
    focusWhenVisible();
  });
}
