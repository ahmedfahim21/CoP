import { sound } from '../audio/sound.js';
import { h, icon } from './dom.js';
import { VolumeOn, VolumeOff } from './icons.js';

/** Speaker button that mutes and unmutes everything; stays in sync across instances. */
export function soundToggle(): { el: HTMLButtonElement; dispose: () => void } {
  const el = h('button', { class: 'sound-toggle' });
  const render = () => {
    el.replaceChildren(icon(sound.muted ? VolumeOff : VolumeOn));
    el.setAttribute('aria-label', sound.muted ? 'Turn sound on' : 'Turn sound off');
    el.setAttribute('aria-pressed', String(!sound.muted));
  };
  render();
  el.addEventListener('click', () => sound.setMuted(!sound.muted));
  return { el, dispose: sound.onChange(render) };
}
