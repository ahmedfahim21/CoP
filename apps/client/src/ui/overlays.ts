import { Crown, Copy, Swords } from 'lucide';
import { h, icon } from './dom.js';
import { avatar } from './home.js';

/** Full-screen "searching" / "waiting for friend" overlay. */
export function matchmakingOverlay(opts: { code: string | null; joining?: boolean; onCancel(): void }): HTMLDivElement {
  const cancel = h('button', { class: 'btn small' }, 'Cancel');
  cancel.addEventListener('click', opts.onCancel);
  let invite: HTMLElement | null = null;
  if (opts.code) {
    const link = `${location.origin}${location.pathname}?room=${encodeURIComponent(opts.code)}`;
    const copy = h('button', { class: 'btn gold small' }, icon(Copy, 'btn-icon'), ' Copy invite link');
    copy.addEventListener('click', async () => {
      await navigator.clipboard.writeText(link);
      copy.replaceChildren('Copied!');
    });
    invite = h('div', { class: 'mm-box' }, h('div', { class: 'stroke', textContent: 'Room code' }), h('div', { class: 'code stroke', textContent: opts.code }), copy);
  }
  const title = opts.joining ? 'Joining room' : opts.code ? 'Friendly battle' : 'Finding opponent';
  const sub = opts.joining ? 'Connecting' : opts.code ? 'Waiting for your friend' : 'Searching for a trainer';
  return h('div', { class: 'mm' },
    h('div', { class: 'mm-box' },
      h('div', { class: 'mm-swords' }, icon(Swords)),
      h('h2', { textContent: title }),
      h('div', { class: 'stroke dots', textContent: sub }),
      invite,
      cancel,
    ),
  );
}

export interface ResultInfo {
  winner: 'me' | 'foe' | 'draw';
  myName: string;
  foeName: string;
  myCrowns: number;
  foeCrowns: number;
  reason: string;
  onAgain(): void;
  onMenu(): void;
}

const REASONS: Record<string, string> = {
  king: 'The trainer was defeated!',
  crowns: 'Decided on crowns.',
  tiebreak: 'Tiebreak on tower health.',
  draw: 'Nobody could break through.',
  forfeit: 'A trainer left the battle.',
};

/** Clash-style result: rival on top, you below, the winner gets the ribbon. */
export function resultOverlay(r: ResultInfo): HTMLDivElement {
  const side = (who: 'me' | 'foe') => {
    const crowns = who === 'me' ? r.myCrowns : r.foeCrowns;
    return h('div', { class: `result-side ${who}` },
      r.winner === who ? h('div', { class: 'winner-ribbon', textContent: 'Winner!' }) : null,
      avatar(who === 'me' ? 'red' : 'blue'),
      h('div', { class: 'plate-name', textContent: who === 'me' ? r.myName : r.foeName }),
      h('div', { class: 'crowns' }, ...[0, 1, 2].map((i) => icon(Crown, `crown ${who === 'me' ? 'mine' : 'enemy'}${i < crowns ? ' won' : ''}`))),
    );
  };
  const again = h('button', { class: 'btn gold' }, 'Play again');
  const menu = h('button', { class: 'btn' }, 'OK');
  again.addEventListener('click', r.onAgain);
  menu.addEventListener('click', r.onMenu);
  return h('div', { class: 'result' },
    side('foe'),
    h('h2', { textContent: r.winner === 'draw' ? 'Draw' : r.winner === 'me' ? 'Victory!' : 'Defeat' }),
    side('me'),
    h('div', { class: 'reason', textContent: REASONS[r.reason] ?? '' }),
    h('div', { class: 'actions' }, menu, again),
  );
}
