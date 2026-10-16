import {
  CARDS, DRAFT_PICKS, EVENT_BONUS_WINS, PUZZLES, ROLE_NAMES, cardInfo, currentEvent, dailyChallenge, dayKey, draftOffers, draftSeed,
  weekKey, withTodaysQuests,
  type CardId, type ScoreboardResponse,
} from '@cop/shared';
import { api } from '../api.js';
import type { ProfileSession } from '../profile.js';
import { cardEl } from './cards.js';
import { h, icon } from './dom.js';
import { Calendar, Medal, Puzzle, Route, Sparkles, Swords, Tick, Trophy } from './icons.js';
import { questList, streakChip, xpBar } from './progress.js';

export interface AdventureHooks {
  onLeague(stage: string): void;
  onDaily(): void;
  onGauntlet(): void;
  onEvent(draft?: CardId[]): void;
  onPuzzle(id: string): void;
}

/**
 * The Adventure tab: everything to do alone besides the League (which lives on the Battle tab).
 * Daily quests, the Daily Challenge, this week's event, the Gauntlet and puzzles.
 */
export class AdventurePanel {
  readonly el = h('div', { class: 'tab-panel adventure' });

  constructor(private readonly profiles: ProfileSession, private readonly hooks: AdventureHooks) {
    profiles.onChange(() => this.render());
    this.render();
  }

  render() {
    const now = Date.now();
    const today = dayKey(now);
    const id = this.profiles.profile?.id ?? '';
    const progress = withTodaysQuests(this.profiles.progress, today, id || 'guest');
    const ready = this.profiles.status === 'ready';
    const parts: Array<HTMLElement | null> = [
      h('div', { class: 'adv-head' }, xpBar(progress.xp), streakChip(progress, today)),
      ready ? null : h('div', { class: 'hint', textContent: this.profiles.status === 'loading' ? 'Loading your trainer profile…' : 'Adventure needs your trainer profile, and the game server isn’t reachable right now.' }),
      this.questsPanel(progress.quests.day === today ? progress.quests.list : []),
      this.dailyPanel(today),
      this.eventPanel(now),
      this.gauntletPanel(),
      this.puzzlePanel(),
    ];
    this.el.replaceChildren(...parts.filter((p): p is HTMLElement => p !== null));
    for (const b of this.el.querySelectorAll<HTMLButtonElement>('button[data-needs-profile]')) b.disabled = !ready;
  }

  private questsPanel(quests: Parameters<typeof questList>[0]) {
    const done = quests.filter((q) => q.done).length;
    return h('section', { class: 'panel' },
      h('div', { class: 'panel-title stroke' }, icon(Tick), 'Daily quests', h('span', { class: 'panel-aside', textContent: quests.length ? `${done}/${quests.length}` : '' })),
      questList(quests),
      h('div', { class: 'hint left', textContent: 'New quests every day at midnight UTC. Your first win each day pays a bonus too.' }),
    );
  }

  private dailyPanel(today: string) {
    const c = dailyChallenge(today);
    const p = this.profiles.progress;
    const best = p.daily.day === today ? p.daily.best : 0;
    const play = h('button', { class: 'btn gold', data: { needsProfile: '' } }, icon(Swords, 'btn-icon'), best ? ' Try again' : ' Play');
    play.addEventListener('click', () => this.hooks.onDaily());
    const board = h('button', { class: 'btn small' }, icon(Trophy, 'btn-icon'), ' Today’s top');
    board.addEventListener('click', () => showScoreboard('daily', `Daily Challenge · ${c.title}`));
    return h('section', { class: 'panel daily' },
      h('div', { class: 'panel-title stroke' }, icon(Calendar), 'Daily Challenge', h('span', { class: 'panel-aside', textContent: best ? `Best ${best.toLocaleString('en')}` : '' })),
      h('div', { class: 'daily-title stroke', textContent: c.title }),
      h('div', { class: 'hint left', textContent: `${c.text} Everyone plays the same deck today; crowns, damage and speed score.` }),
      h('div', { class: 'mini-deck' }, ...c.deck.map((card) => cardEl(card))),
      h('div', { class: 'row' }, play, board),
    );
  }

  private eventPanel(now: number) {
    const ev = currentEvent(now);
    const p = this.profiles.progress;
    const wins = p.event.week === weekKey(now) ? p.event.wins : 0;
    const play = h('button', { class: 'btn gold', data: { needsProfile: '' } }, icon(Swords, 'btn-icon'), ev.decks === 'draft' ? ' Draft' : ' Play');
    play.addEventListener('click', () => (ev.decks === 'draft' ? this.showDraft(now) : this.hooks.onEvent()));
    const days = Math.ceil((weekEnd(now) - now) / 86_400_000);
    return h('section', { class: 'panel event' },
      h('div', { class: 'panel-title stroke' }, icon(Sparkles), 'Weekly event', h('span', { class: 'panel-aside', textContent: `${days} day${days === 1 ? '' : 's'} left` })),
      h('div', { class: 'daily-title stroke', textContent: ev.name }),
      h('div', { class: 'hint left', textContent: ev.text }),
      h('div', { class: 'event-wins' }, ...Array.from({ length: EVENT_BONUS_WINS }, (_, i) => h('span', { class: i < wins ? 'pip won' : 'pip' })),
        h('span', { textContent: wins >= EVENT_BONUS_WINS ? 'Bonus earned this week' : `Win ${EVENT_BONUS_WINS} for a 100 XP bonus` })),
      h('div', { class: 'row' }, play),
    );
  }

  /** Draft: eight pairs, pick one of each, then battle with the result. */
  private showDraft(now: number) {
    const id = this.profiles.profile?.id;
    if (!id) return;
    const offers = draftOffers(draftSeed(id, now));
    const picks: CardId[] = [];
    const body = h('div', { class: 'draft' });
    const go = h('button', { class: 'btn gold', disabled: true }, icon(Swords, 'btn-icon'), ' Battle');
    const cancel = h('button', { class: 'btn' }, 'Cancel');
    const render = () => {
      const i = picks.length;
      const done = i >= DRAFT_PICKS;
      go.disabled = !done;
      body.replaceChildren(
        h('div', { class: 'hint left', textContent: done ? 'Your deck is ready.' : `Pick ${i + 1} of ${DRAFT_PICKS}: choose one.` }),
        done ? h('div', {}) : h('div', { class: 'draft-pair' }, ...offers[i]!.map((c) => {
          const b = h('button', { class: 'draft-pick' }, cardEl(c), h('div', { class: 'draft-role', textContent: cardInfo(c).roles.map((r) => ROLE_NAMES[r]).join(' · ') || CARDS[c].stats.move.name }));
          b.addEventListener('click', () => {
            picks.push(c);
            render();
          });
          return b;
        })),
        h('div', { class: 'section-title', textContent: `Deck ${picks.length}/${DRAFT_PICKS}` }),
        h('div', { class: 'mini-deck' }, ...picks.map((c) => cardEl(c))),
      );
    };
    render();
    const backdrop = modal('Draft', body, cancel, go);
    cancel.addEventListener('click', () => backdrop.remove());
    go.addEventListener('click', () => {
      backdrop.remove();
      this.hooks.onEvent([...picks]);
    });
  }

  private gauntletPanel() {
    const best = this.profiles.progress.gauntletBest;
    const play = h('button', { class: 'btn gold', data: { needsProfile: '' } }, icon(Swords, 'btn-icon'), ' Start a run');
    play.addEventListener('click', () => this.hooks.onGauntlet());
    const board = h('button', { class: 'btn small' }, icon(Trophy, 'btn-icon'), ' Season top');
    board.addEventListener('click', () => showScoreboard('gauntlet', 'Gauntlet · this season'));
    return h('section', { class: 'panel gauntlet' },
      h('div', { class: 'panel-title stroke' }, icon(Route), 'Gauntlet', h('span', { class: 'panel-aside', textContent: best ? `Best: round ${best}` : '' })),
      h('div', { class: 'hint left', textContent: 'Win round after round against tougher bots. Your towers keep their damage between rounds, so every chip counts. How far can you go?' }),
      h('div', { class: 'row' }, play, board),
    );
  }

  private puzzlePanel() {
    const solved = new Set(this.profiles.progress.puzzles);
    return h('section', { class: 'panel puzzles' },
      h('div', { class: 'panel-title stroke' }, icon(Puzzle), 'Puzzles', h('span', { class: 'panel-aside', textContent: `${solved.size}/${PUZZLES.length}` })),
      h('div', { class: 'puzzle-grid' }, ...PUZZLES.map((p, i) => {
        const b = h('button', { class: `puzzle-tile${solved.has(p.id) ? ' solved' : ''}` },
          h('span', { class: 'puzzle-num stroke', textContent: String(i + 1) }),
          h('span', { class: 'puzzle-name', textContent: p.title }),
          solved.has(p.id) ? icon(Tick) : null);
        b.addEventListener('click', () => this.hooks.onPuzzle(p.id));
        return b;
      })),
      h('div', { class: 'hint left', textContent: 'A frozen moment and a goal. Each one teaches a trick; the first solve pays 30 XP.' }),
    );
  }
}

/** Monday 00:00 UTC after `now`. */
function weekEnd(now: number): number {
  const d = new Date(now);
  const day = (d.getUTCDay() + 6) % 7;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day + 7);
}

/** A modal with a title, a body and buttons; returns the backdrop (remove it to close). */
export function modal(title: string, body: HTMLElement, ...buttons: HTMLButtonElement[]): HTMLDivElement {
  const backdrop = h('div', { class: 'modal-backdrop' },
    h('div', { class: 'modal', attrs: { role: 'dialog', 'aria-label': title } },
      h('h2', { textContent: title }), body, h('div', { class: 'row modal-actions' }, ...buttons)));
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) backdrop.remove();
  });
  document.body.append(backdrop);
  return backdrop;
}

export function showScoreboard(board: ScoreboardResponse['board'], title: string) {
  const list = h('div', { class: 'ladder' }, h('div', { class: 'spinner' }));
  const close = h('button', { class: 'btn gold' }, 'OK');
  const backdrop = modal(title, list, close);
  close.addEventListener('click', () => backdrop.remove());
  api.scores(board).then((res) => {
    if (res.entries.length === 0) {
      list.replaceChildren(h('div', { class: 'hint', textContent: 'No scores yet. Be the first!' }));
      return;
    }
    list.replaceChildren(h('ol', { class: 'ladder-list' }, ...res.entries.map((e) => h('li', { class: `ladder-row${e.rank <= 3 ? ` top${e.rank}` : ''}` },
      h('div', { class: 'ladder-rank stroke' }, e.rank <= 3 ? icon(Medal) : null, String(e.rank)),
      h('div', { class: 'ladder-who' }, h('div', { class: 'plate-name', textContent: e.name })),
      h('div', { class: 'score stroke', textContent: board === 'gauntlet' ? `Round ${e.score}` : e.score.toLocaleString('en') })))));
  }, (err: unknown) => {
    console.error(`Loading the ${board} board failed`, err);
    list.replaceChildren(h('div', { class: 'error-text', textContent: err instanceof Error ? err.message : String(err) }));
  });
}
