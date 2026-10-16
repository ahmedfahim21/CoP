import { Bot, Copy, Crown, Dumbbell, Ghost, Gift, Replay, Star, Swords, Tick, Trophy, Users } from './icons.js';
import { STAGES, stageById, type BattleStats, type MatchMode, type QueueStatusMessage, type RematchStateMessage, type SummaryMessage, type Team } from '@cop/shared';
import { cardEl } from './cards.js';
import { h, icon } from './dom.js';
import { levelBadge, starsEl } from './progress.js';
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
        h('div', { class: 'mm-stat muted' }, icon(Ghost), h('span', { class: 'v', textContent: s.botIn > 0 ? `A ghost steps in after ${s.botIn}s` : 'Finding a ghost…' })),
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
  /** Ranked and ghost: queue again. Otherwise: ask for a rematch in a fresh room. */
  onAgain(): void;
  onMenu(): void;
  /** Watch this battle again; offered once the summary says it was stored. */
  onReplay?(matchId: number): void;
}

/** Modes whose "again" goes back to the ranked queue. */
export const QUEUE_MODES: readonly MatchMode[] = ['ranked', 'ghost'];

const REASONS: Record<string, string> = {
  king: 'The trainer was defeated!',
  crowns: 'Decided on crowns.',
  tiebreak: 'Crowns were level after overtime, so the healthier weakest tower wins.',
  draw: 'Nobody could break through.',
  forfeit: 'A trainer left the battle.',
};

const MODE_NOTE: Record<MatchMode, string> = {
  ranked: '',
  ghost: 'Ghost battle: the bot played a real trainer’s deck. Only your trophies move, at half rate.',
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
  private readonly rewardsEl = h('div', { class: 'result-rewards' });
  private readonly statsEl = h('div', { class: 'result-stats' });
  private readonly replayRow = h('div', { class: 'result-replay' });
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
    const ranked = QUEUE_MODES.includes(r.mode);
    this.again = h('button', { class: 'btn gold' }, againLabel(r));
    const menu = h('button', { class: 'btn' }, 'OK');
    this.again.addEventListener('click', () => {
      if (!ranked) {
        this.asked = true;
        this.again.disabled = true;
        this.rematchNote.textContent = r.foeIsBot ? 'Setting up…' : 'Waiting for your rival…';
        this.again.classList.remove('pulse');
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
      this.rewardsEl,
      this.statsEl,
      h('div', { class: 'actions' }, menu, this.again),
      this.rematchNote,
      this.replayRow,
    );
  }

  setSummary(s: SummaryMessage) {
    const mine = s.teams[this.r.myTeam];
    const foe = s.teams[(1 - this.r.myTeam) as Team];
    this.myDelta.replaceChildren(...(QUEUE_MODES.includes(s.mode) ? [deltaPill(mine.delta), h('div', { class: 'trophy-total stroke' }, icon(Trophy), String(mine.trophies))] : []));
    this.showRewards(s);
    if (s.adventure?.gauntlet) this.again.textContent = s.adventure.gauntlet.cleared ? `Round ${s.adventure.gauntlet.round + 1}` : 'New run';
    if (s.matchId !== undefined && this.r.onReplay) {
      const watch = h('button', { class: 'btn small' }, icon(Replay, 'btn-icon'), ' Watch replay');
      watch.addEventListener('click', () => this.r.onReplay!(s.matchId!));
      this.replayRow.replaceChildren(watch);
    }
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

  /** What the battle earned: stars, scores, XP, levels, new cards and quests. */
  private showRewards(s: SummaryMessage) {
    const mine = s.teams[this.r.myTeam].rewards;
    const adv = s.adventure;
    const parts: Array<HTMLElement | null> = [];
    if (adv?.stage) {
      const stage = stageById(adv.stage.id);
      const gained = adv.stage.starsAfter - adv.stage.starsBefore;
      parts.push(h('div', { class: 'reward-line stage' }, starsEl(adv.stage.starsAfter),
        h('span', { textContent: gained > 0 ? (adv.stage.starsBefore === 0 ? `${stage?.badge ?? 'Badge'} earned!` : `+${gained} star${gained > 1 ? 's' : ''}`) : stage ? `${stage.leader}: ${adv.stage.starsAfter}/3 stars` : '' })));
      const nextStage = stage ? STAGES[stage.order] : undefined;
      if (adv.stage.starsBefore === 0 && adv.stage.starsAfter > 0 && nextStage) {
        parts.push(h('div', { class: 'reward-line', textContent: `${nextStage.leader} awaits.` }));
      }
    }
    if (adv?.daily) {
      parts.push(h('div', { class: 'reward-line' }, icon(Star),
        h('span', { textContent: `Score ${adv.daily.score.toLocaleString('en')}${adv.daily.score >= adv.daily.best ? ' · new best' : ` · best ${adv.daily.best.toLocaleString('en')}`}${adv.daily.rank ? ` · #${adv.daily.rank} today` : ''}` })));
    }
    if (adv?.gauntlet) {
      const g = adv.gauntlet;
      parts.push(h('div', { class: 'reward-line' }, icon(Swords),
        h('span', { textContent: g.cleared ? `Round ${g.round} cleared!` : `Run over: ${g.round - 1} round${g.round - 1 === 1 ? '' : 's'} cleared${g.rank ? ` · #${g.rank} this season` : ''}` })));
    }
    if (mine) {
      if (mine.levelAfter > mine.levelBefore) {
        parts.push(h('div', { class: 'level-up' }, levelBadge(mine.levelAfter, 'big'), h('span', { class: 'stroke', textContent: 'Level up!' })));
      }
      if (mine.xp > 0) {
        parts.push(h('div', { class: 'xp-gain' },
          h('div', { class: 'xp-gain-total stroke', textContent: `+${mine.xp} XP` }),
          h('ul', { class: 'xp-lines' }, ...mine.rewards.map((rw) => h('li', {}, h('span', { textContent: rw.text }), h('span', { class: 'stroke', textContent: `+${rw.xp}` }))))));
      }
      for (const q of mine.quests) parts.push(h('div', { class: 'reward-line quest-done' }, icon(Tick), h('span', { textContent: `Quest complete: ${q.text}` })));
      if (mine.unlocked.length > 0) {
        parts.push(h('div', { class: 'new-cards' }, h('div', { class: 'stroke' }, icon(Gift), mine.unlocked.length > 1 ? ' New cards!' : ' New card!'),
          h('div', { class: 'mini-deck' }, ...mine.unlocked.map((c) => cardEl(c)))));
      }
    }
    this.rewardsEl.replaceChildren(...parts.filter((p): p is HTMLElement => p !== null));
  }

  setRematch(state: RematchStateMessage) {
    if (QUEUE_MODES.includes(this.r.mode)) return;
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

function againLabel(r: ResultInfo): string {
  switch (r.mode) {
    case 'ranked': case 'ghost': return 'Battle again';
    case 'league': return r.winner === 'me' ? 'Play again' : 'Try again';
    case 'daily': return 'Try again';
    case 'gauntlet': return r.winner === 'me' ? 'Next round' : 'New run';
    case 'event': return 'Play again';
    default: return 'Rematch';
  }
}

/** The result's headline; a tiebreak says so outright, since the crowns look level. */
function heading(r: ResultInfo): string {
  if (r.winner === 'draw') return 'Draw';
  if (r.reason === 'tiebreak') return r.winner === 'me' ? 'Won on tower health' : 'Lost on tower health';
  return r.winner === 'me' ? 'Victory!' : 'Defeat';
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
