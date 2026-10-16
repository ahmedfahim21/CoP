import { Bot, Copy, Crown, Dumbbell, Swords, Trophy, Users } from './icons.js';
import type { BattleStats, MatchMode, QueueStatusMessage, RematchStateMessage, SummaryMessage, Team } from '@cop/shared';
import { h, icon } from './dom.js';
import { avatar } from './home.js';
import { deltaPill } from './ladder.js';
import { sound } from '../audio/sound.js';

export interface MatchmakingOverlay {
  el: HTMLDivElement;
  /** Ranked search progress from the queue. */
  setStatus(s: QueueStatusMessage): void;
}

/** Full-screen "searching" / "waiting for friend" overlay. */
export function matchmakingOverlay(opts: { code: string | null; joining?: boolean; ranked?: boolean; onCancel(): void; onTraining?(): void }): MatchmakingOverlay {
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
  const status = h('div', { class: 'mm-status', hidden: true });
  let train: HTMLButtonElement | null = null;
  if (opts.onTraining) {
    train = h('button', { class: 'btn purple small' }, icon(Dumbbell, 'btn-icon'), ' Practice vs bot instead');
    train.addEventListener('click', opts.onTraining);
  }
  const title = opts.joining ? 'Joining room' : opts.code ? 'Friendly battle' : opts.ranked ? 'Ranked battle' : 'Finding opponent';
  const sub = opts.joining ? 'Connecting' : opts.code ? 'Waiting for your friend' : 'Searching for a trainer';
  const el = h('div', { class: 'mm' },
    h('div', { class: 'mm-box' },
      h('div', { class: 'mm-swords' }, icon(Swords)),
      h('h2', { textContent: title }),
      h('div', { class: 'stroke dots', textContent: sub }),
      status,
      invite,
      h('div', { class: 'row' }, cancel, train),
    ),
  );
  return {
    el,
    setStatus(s) {
      status.hidden = false;
      const range = s.range === null ? 'Any trophy range' : `±${s.range} trophies`;
      status.replaceChildren(
        h('div', { class: 'mm-stat' }, h('span', { class: 'k', textContent: 'Searching' }), h('span', { class: 'v stroke', textContent: `${Math.floor(s.waited / 60)}:${String(s.waited % 60).padStart(2, '0')}` })),
        h('div', { class: 'mm-stat' }, icon(Trophy), h('span', { class: 'v', textContent: range })),
        h('div', { class: 'mm-stat' }, icon(Users), h('span', { class: 'v', textContent: `${s.searching} in queue` })),
        h('div', { class: 'mm-stat muted' }, icon(Bot), h('span', { class: 'v', textContent: s.botIn > 0 ? `Bot steps in after ${s.botIn}s` : 'Calling in a bot…' })),
      );
    },
  };
}

export interface ResultInfo {
  winner: 'me' | 'foe' | 'draw';
  myTeam: Team;
  mode: MatchMode;
  myName: string;
  foeName: string;
  foeIsBot: boolean;
  myCrowns: number;
  foeCrowns: number;
  reason: string;
  /** Each side's weakest standing tower, 0..1: shown when the tiebreak decided it. */
  towerHealth: { mine: number; foe: number } | null;
  /** Ranked: queue again. Otherwise: ask for a rematch in a fresh room. */
  onAgain(): void;
  onMenu(): void;
}

const REASONS: Record<string, string> = {
  king: 'The trainer was defeated!',
  crowns: 'Decided on crowns.',
  tiebreak: 'Crowns were level after overtime, so the healthier weakest tower wins.',
  draw: 'Nobody could break through.',
  forfeit: 'A trainer left the battle.',
};

const MODE_NOTE: Record<MatchMode, string> = {
  ranked: '',
  ghost: 'Ghost battle: only your trophies move, at half rate.',
  league: '',
  daily: '',
  gauntlet: '',
  event: '',
  friendly: 'Friendly battle: no trophies at stake.',
  training: 'Training battle: no trophies at stake.',
  casual: 'Unrated battle.',
};

/** Clash-style result: rival on top, you below, the winner gets the ribbon; then trophies and stats. */
export class ResultScreen {
  readonly el: HTMLDivElement;
  private readonly myDelta = h('div', { class: 'result-delta' });
  private readonly statsEl = h('div', { class: 'result-stats' });
  private readonly rematchNote = h('div', { class: 'reason' });
  private readonly again: HTMLButtonElement;
  private asked = false;

  constructor(private readonly r: ResultInfo) {
    sound.play(r.winner === 'me' ? 'victory' : r.winner === 'foe' ? 'defeat' : 'draw');
    const side = (who: 'me' | 'foe') => {
      const crowns = who === 'me' ? r.myCrowns : r.foeCrowns;
      return h('div', { class: `result-side ${who}` },
        r.winner === who ? h('div', { class: 'winner-ribbon', textContent: 'Winner!' }) : null,
        avatar(who === 'me' ? 'red' : 'blue'),
        h('div', { class: 'plate-name', textContent: who === 'me' ? r.myName : r.foeName }),
        h('div', { class: 'crowns' }, ...[0, 1, 2].map((i) => icon(Crown, `crown ${who === 'me' ? 'mine' : 'enemy'}${i < crowns ? ' won' : ''}`))),
        who === 'me' ? this.myDelta : null,
      );
    };
    const ranked = r.mode === 'ranked';
    this.again = h('button', { class: 'btn gold' }, ranked ? 'Battle again' : 'Rematch');
    const menu = h('button', { class: 'btn' }, 'OK');
    this.again.addEventListener('click', () => {
      if (!ranked) {
        this.asked = true;
        this.again.disabled = true;
        this.rematchNote.textContent = r.foeIsBot ? 'Setting up…' : 'Waiting for your rival…';
      }
      r.onAgain();
    });
    menu.addEventListener('click', r.onMenu);
    this.el = h('div', { class: 'result' },
      side('foe'),
      h('h2', { textContent: heading(r) }),
      side('me'),
      r.reason === 'tiebreak' && r.towerHealth
        ? h('div', { class: 'tiebreak' },
          h('div', { class: 'tiebreak-row' }, h('span', { textContent: 'Your weakest tower' }), h('span', { class: 'tiebreak-val stroke', textContent: pct(r.towerHealth.mine) })),
          h('div', { class: 'tiebreak-row' }, h('span', { textContent: "Rival's weakest tower" }), h('span', { class: 'tiebreak-val stroke', textContent: pct(r.towerHealth.foe) })))
        : null,
      h('div', { class: 'reason', textContent: [REASONS[r.reason] ?? '', MODE_NOTE[r.mode]].filter(Boolean).join(' ') }),
      this.statsEl,
      h('div', { class: 'actions' }, menu, this.again),
      this.rematchNote,
    );
  }

  setSummary(s: SummaryMessage) {
    const mine = s.teams[this.r.myTeam];
    const foe = s.teams[(1 - this.r.myTeam) as Team];
    this.myDelta.replaceChildren(...(s.mode === 'ranked' ? [deltaPill(mine.delta), h('div', { class: 'trophy-total stroke' }, icon(Trophy), String(mine.trophies))] : []));
    const rows: Array<[string, (b: BattleStats) => number]> = [
      ['Cards played', (b) => b.cardsPlayed],
      ['Elixir spent', (b) => b.elixirSpent],
      ['Tower damage', (b) => b.towerDamage],
      ['Troops defeated', (b) => b.defeated],
    ];
    this.statsEl.replaceChildren(
      h('div', { class: 'result-stats-head' }, h('span', {}), h('span', { class: 'stroke', textContent: 'You' }), h('span', { class: 'stroke', textContent: 'Rival' })),
      ...rows.map(([label, get]) => {
        const a = get(mine.stats);
        const b = get(foe.stats);
        return h('div', { class: 'result-stats-row' },
          h('span', { class: 'k', textContent: label }),
          h('span', { class: `v stroke${a > b ? ' lead' : ''}`, textContent: String(a) }),
          h('span', { class: `v stroke${b > a ? ' lead' : ''}`, textContent: String(b) }));
      }),
    );
  }

  setRematch(state: RematchStateMessage) {
    if (this.r.mode === 'ranked') return;
    const foeAsked = state.requested[(1 - this.r.myTeam) as Team];
    if (!state.open) {
      this.again.disabled = true;
      if (!this.r.foeIsBot) this.rematchNote.textContent = 'Your rival has left.';
      return;
    }
    if (foeAsked && !this.asked && !this.r.foeIsBot) {
      this.rematchNote.textContent = `${this.r.foeName} wants a rematch!`;
      this.again.classList.add('pulse');
    }
  }
}

/** The result's headline; a tiebreak says so outright, since the crowns look level. */
function heading(r: ResultInfo): string {
  if (r.winner === 'draw') return 'Draw';
  if (r.reason === 'tiebreak') return r.winner === 'me' ? 'Won on tower health' : 'Lost on tower health';
  return r.winner === 'me' ? 'Victory!' : 'Defeat';
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
