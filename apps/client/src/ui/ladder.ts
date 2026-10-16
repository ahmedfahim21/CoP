import { Bot, Calendar, Copy, Crown, Flame, Key, Medal, Refresh, Replay, Route, Swords, Trophy, Users } from './icons.js';
import {
  STAGES, arenaFor, levelFor, nextArena, winRate,
  type LeaderboardEntry, type MatchRecord, type ProfileStats, type PublicProfile, type ScoreboardResponse, type Team,
} from '@cop/shared';
import { badgeRow, levelBadge, xpBar } from './progress.js';
import { api } from '../api.js';
import type { ProfileSession } from '../profile.js';
import { h, icon } from './dom.js';
import { avatar } from './home.js';

/** Ladder screens: the Ranks tab, the Profile tab and other trainers' profiles. */

export function trophyPill(trophies: number, cls = ''): HTMLDivElement {
  return h('div', { class: `trophies stroke ${cls}`.trim() }, icon(Trophy), String(trophies));
}

/** "+30" / "−12" next to a trophy; null for unrated battles. */
export function deltaPill(delta: number): HTMLDivElement {
  const sign = delta > 0 ? '+' : delta < 0 ? '−' : '±';
  return h('div', { class: `delta stroke ${delta > 0 ? 'up' : delta < 0 ? 'down' : ''}`.trim() }, icon(Trophy), `${sign}${Math.abs(delta)}`);
}

function arenaProgress(trophies: number): HTMLDivElement {
  const arena = arenaFor(trophies);
  const next = nextArena(trophies);
  const pct = next ? ((trophies - arena.minTrophies) / (next.minTrophies - arena.minTrophies)) * 100 : 100;
  return h('div', { class: 'arena-progress' },
    h('div', { class: 'arena-progress-head' },
      h('span', { class: 'stroke', textContent: `Arena ${arena.index} · ${arena.name}` }),
      h('span', { class: 'muted', textContent: next ? `${next.minTrophies - trophies} to ${next.name}` : 'Top arena!' }),
    ),
    h('div', { class: 'arena-bar' }, h('div', { class: 'arena-fill', attrs: { style: `width:${Math.max(3, Math.min(100, pct))}%` } })),
  );
}

function statGrid(p: ProfileStats): HTMLDivElement {
  const rate = winRate(p);
  const stat = (k: string, v: string) => h('div', { class: 'stat' }, h('div', {}, h('div', { class: 'k', textContent: k }), h('div', { class: 'v stroke', textContent: v })));
  return h('div', { class: 'stats profile-stats' },
    stat('Wins', String(p.wins)),
    stat('Losses', String(p.losses)),
    stat('Win rate', rate === null ? '—' : `${Math.round(rate * 100)}%`),
    stat('Three-crown wins', String(p.threeCrowns)),
    stat('Best trophies', String(p.bestTrophies)),
    stat('Best streak', String(p.bestStreak)),
    stat('Draws', String(p.draws)),
    stat('Battles', String(p.battles)),
  );
}

export const MODE_LABEL: Record<MatchRecord['mode'], string> = {
  ranked: 'Ranked', ghost: 'Ghost', league: 'League', daily: 'Daily Challenge', gauntlet: 'Gauntlet', event: 'Event',
  friendly: 'Friendly', training: 'Training', casual: 'Casual',
};

/** Opens a stored battle's replay from `team`'s side. */
export type OnReplay = (matchId: number, team: Team) => void;

function matchList(matches: MatchRecord[], onReplay?: OnReplay): HTMLElement {
  if (matches.length === 0) return h('div', { class: 'hint', textContent: 'No battles yet. Hit Battle to get on the ladder!' });
  return h('ol', { class: 'match-list' }, ...matches.map((m) => {
    const when = new Date(m.playedAt);
    let watch: HTMLButtonElement | null = null;
    if (onReplay && m.hasReplay) {
      watch = h('button', { class: 'replay-btn', attrs: { 'aria-label': 'Watch replay' } }, icon(Replay));
      watch.addEventListener('click', () => onReplay(m.id, (m.team ?? 0) as Team));
    }
    return h('li', { class: `match-row ${m.outcome}${watch ? ' has-replay' : ''}` },
      h('div', { class: 'match-outcome stroke', textContent: m.outcome === 'win' ? 'Win' : m.outcome === 'loss' ? 'Loss' : 'Draw' }),
      h('div', { class: 'match-who' },
        h('div', { class: 'plate-name', textContent: m.opponent.name }),
        h('div', { class: 'plate-sub', textContent: `${MODE_LABEL[m.mode]}${m.reason === 'tiebreak' ? ' · Tower health' : ''} · ${when.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${when.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}` }),
      ),
      h('div', { class: 'match-crowns stroke' }, icon(Crown), `${m.crowns}–${m.opponentCrowns}`),
      m.mode === 'ranked' || m.mode === 'ghost' ? deltaPill(m.delta) : h('div', { class: 'delta' }, icon(m.opponent.id ? Users : Bot)),
      watch,
    );
  }));
}

function seasonList(p: PublicProfile): HTMLElement | null {
  if (!p.seasons?.length) return null;
  return h('div', { class: 'seasons' },
    h('h2', { class: 'section-title' }, icon(Calendar), 'Past seasons'),
    h('ol', { class: 'season-list' }, ...p.seasons.map((s) => h('li', {},
      h('span', { class: 'stroke', textContent: seasonName(s.season) }),
      h('span', { textContent: `#${s.rank}` }),
      trophyPill(s.trophies)))));
}

function seasonName(season: string): string {
  const [y, m] = season.split('-').map(Number);
  return new Date(Date.UTC(y!, (m ?? 1) - 1, 1)).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** Level, League badges and Gauntlet best: what a trainer has done beyond the ladder. */
function adventureSummary(p: PublicProfile): HTMLElement {
  const stars: Record<string, number> = {};
  for (const id of p.badges ?? []) stars[id] = 1;
  return h('div', { class: 'adventure-summary' },
    h('div', { class: 'row' },
      levelBadge(p.level ?? 1, 'big'),
      h('div', { class: 'grow' },
        h('div', { class: 'plate-sub', textContent: `${p.badges?.length ?? 0}/${STAGES.length} League badges · ${p.stars ?? 0} stars` }),
        badgeRow(stars)),
    ),
    p.gauntletBest ? h('div', { class: 'plate-sub' }, icon(Route), ` Gauntlet best: round ${p.gauntletBest}`) : null,
  );
}

function profileHeader(p: PublicProfile, look: 'red' | 'blue'): HTMLDivElement {
  return h('div', { class: 'profile-card' },
    avatar(look),
    h('div', { class: 'profile-card-text' },
      h('div', { class: 'plate-name', textContent: p.name }),
      h('div', { class: 'plate-sub', textContent: `#${p.id}${p.rank ? ` · Rank ${p.rank}` : ' · Unranked'}` }),
    ),
    trophyPill(p.trophies, 'big'),
  );
}

/** Another trainer's profile, fetched on open. */
export function showProfileModal(id: string, mine: boolean) {
  const body = h('div', { class: 'modal profile-modal', attrs: { role: 'dialog', 'aria-label': 'Trainer profile' } }, h('div', { class: 'spinner' }));
  const backdrop = h('div', { class: 'modal-backdrop' }, body);
  const close = h('button', { class: 'btn gold' }, 'OK');
  const dismiss = () => backdrop.remove();
  close.addEventListener('click', dismiss);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) dismiss();
  });
  document.body.append(backdrop);
  api.profile(id).then(({ profile, matches }) => {
    body.replaceChildren(
      profileHeader(profile, mine ? 'red' : 'blue'),
      arenaProgress(profile.trophies),
      adventureSummary(profile),
      statGrid(profile),
      h('h2', { class: 'section-title', textContent: 'Recent battles' }),
      matchList(matches.slice(0, 8)),
      h('div', { class: 'row' }, close),
    );
  }, (err: unknown) => {
    console.error(`Loading profile ${id} failed`, err);
    body.replaceChildren(h('div', { class: 'error-text', textContent: err instanceof Error ? err.message : String(err) }), h('div', { class: 'row' }, close));
  });
}

/** The Ranks tab: the top of the ladder, and where you stand. */
type Board = 'trophies' | ScoreboardResponse['board'];

const BOARD_HINT: Record<Board, string> = {
  trophies: 'Ranked and ghost battles move trophies. League, training and friendly battles never do. Trophies above 1000 halve towards it each new month.',
  daily: 'Today’s Daily Challenge: everyone plays the same deck. Resets at midnight UTC.',
  gauntlet: 'Furthest Gauntlet run this month.',
};

export class RanksPanel {
  readonly el = h('div', { class: 'tab-panel' });
  private readonly list = h('div', { class: 'ladder' });
  private readonly footer = h('div', { class: 'ladder-me' });
  private readonly hint = h('div', { class: 'hint' });
  private readonly seg = h('div', { class: 'segmented', attrs: { role: 'tablist' } });
  private board: Board = 'trophies';
  private loading = false;

  constructor(private readonly profiles: ProfileSession) {
    const refresh = h('button', { class: 'btn small icon-btn', attrs: { 'aria-label': 'Refresh leaderboard' } }, icon(Refresh));
    refresh.addEventListener('click', () => void this.load());
    for (const [b, label, ic] of [['trophies', 'Trophies', Trophy], ['daily', 'Daily', Calendar], ['gauntlet', 'Gauntlet', Route]] as const) {
      const btn = h('button', { class: 'seg-btn', data: { view: b }, attrs: { role: 'tab', 'aria-selected': String(b === this.board) } }, icon(ic), label);
      btn.addEventListener('click', () => {
        this.board = b;
        for (const x of this.seg.children) x.setAttribute('aria-selected', String((x as HTMLElement).dataset.view === b));
        void this.load();
      });
      this.seg.append(btn);
    }
    this.el.append(
      h('div', { class: 'deck-head' }, h('h2', { textContent: 'Kanto Ladder' }), refresh),
      this.seg,
      this.hint,
      this.list,
      this.footer,
    );
    profiles.onChange(() => this.renderMe());
  }

  async load() {
    if (this.loading) return;
    this.loading = true;
    this.hint.textContent = BOARD_HINT[this.board];
    this.list.replaceChildren(h('div', { class: 'spinner' }));
    try {
      if (this.board === 'trophies') {
        const { entries, total } = await api.leaderboard(50);
        this.render(entries, total);
      } else {
        this.renderScores(await api.scores(this.board));
      }
    } catch (err) {
      console.error('Loading the leaderboard failed', err);
      this.list.replaceChildren(h('div', { class: 'error-text', textContent: err instanceof Error ? err.message : String(err) }));
    } finally {
      this.loading = false;
    }
  }

  private render(entries: LeaderboardEntry[], total: number) {
    const me = this.profiles.profile?.id;
    if (entries.length === 0) {
      this.list.replaceChildren(h('div', { class: 'hint', textContent: 'Nobody is on the ladder yet. Play any battle, even against the bot, to join it!' }));
    } else {
      this.list.replaceChildren(
        h('div', { class: 'plate-sub ladder-total', textContent: `${total} trainer${total === 1 ? '' : 's'}` }),
        h('ol', { class: 'ladder-list' }, ...entries.map((e) => {
          const row = h('li', { class: `ladder-row${e.id === me ? ' me' : ''}${e.rank <= 3 ? ` top${e.rank}` : ''}${e.rated ? '' : ' unrated'}` },
            h('div', { class: 'ladder-rank stroke' }, e.rank <= 3 ? icon(Medal) : null, String(e.rank)),
            h('div', { class: 'ladder-who' },
              h('div', { class: 'plate-name' }, levelBadge(levelFor(e.xp ?? 0).level, 'tiny'), e.name),
              h('div', { class: 'plate-sub', textContent: e.rated ? `${arenaFor(e.trophies).name} · ${e.wins}W ${e.losses}L` : `Unrated · ${e.battles} battle${e.battles === 1 ? '' : 's'}` }),
            ),
            trophyPill(e.trophies),
          );
          row.addEventListener('click', () => showProfileModal(e.id, e.id === me));
          return row;
        })),
      );
    }
    this.renderMe();
  }

  private renderScores(res: ScoreboardResponse) {
    const me = this.profiles.profile?.id;
    this.footer.replaceChildren();
    if (res.entries.length === 0) {
      this.list.replaceChildren(h('div', { class: 'hint', textContent: res.board === 'daily' ? 'No scores yet today. Play the Daily Challenge in Adventure!' : 'No runs yet this season. Start one in Adventure!' }));
      return;
    }
    this.list.replaceChildren(
      h('div', { class: 'plate-sub ladder-total', textContent: `${res.total} trainer${res.total === 1 ? '' : 's'}` }),
      h('ol', { class: 'ladder-list' }, ...res.entries.map((e) => {
        const row = h('li', { class: `ladder-row${e.id === me ? ' me' : ''}${e.rank <= 3 ? ` top${e.rank}` : ''}` },
          h('div', { class: 'ladder-rank stroke' }, e.rank <= 3 ? icon(Medal) : null, String(e.rank)),
          h('div', { class: 'ladder-who' }, h('div', { class: 'plate-name', textContent: e.name })),
          h('div', { class: 'score stroke', textContent: res.board === 'gauntlet' ? `Round ${e.score}` : e.score.toLocaleString('en') }));
        row.addEventListener('click', () => showProfileModal(e.id, e.id === me));
        return row;
      })),
    );
  }

  private renderMe() {
    if (this.board !== 'trophies') return;
    const p = this.profiles.profile;
    this.footer.replaceChildren(p
      ? h('div', { class: 'ladder-row me' },
        h('div', { class: 'ladder-rank stroke', textContent: p.rank ? String(p.rank) : '—' }),
        h('div', { class: 'ladder-who' }, h('div', { class: 'plate-name', textContent: `${p.name} (you)` }), h('div', { class: 'plate-sub', textContent: p.rank ? arenaFor(p.trophies).name : 'Play any battle to join the ladder' })),
        trophyPill(p.trophies))
      : h('div', { class: 'hint', textContent: this.profiles.status === 'offline' ? 'Offline: your rank shows up once the server is reachable.' : '' }));
  }
}

/** The Profile tab: your stats, history and restore code. */
export class ProfilePanel {
  readonly el = h('div', { class: 'tab-panel' });

  constructor(private readonly profiles: ProfileSession, private readonly onReplay?: OnReplay) {
    profiles.onChange(() => this.render());
    this.render();
  }

  private render() {
    const { profile, status } = this.profiles;
    if (!profile) {
      const retry = h('button', { class: 'btn small' }, icon(Refresh, 'btn-icon'), ' Retry');
      retry.addEventListener('click', () => void this.profiles.connect());
      this.el.replaceChildren(
        h('h2', { textContent: 'Trainer Profile' }),
        status === 'loading'
          ? h('div', { class: 'spinner' })
          : h('div', { class: 'panel' },
            h('div', { class: 'panel-title stroke' }, 'Offline'),
            h('div', { class: 'hint', textContent: `Your profile lives on the game server, which isn't reachable right now. ${this.profiles.problem ?? ''}` }),
            h('div', { class: 'row' }, retry)),
        this.restorePanel(),
      );
      return;
    }
    const parts: Array<HTMLElement | null> = [
      // Name, portrait, rank and trophies are already in the top bar; only the tag is new here.
      h('div', { class: 'profile-heading' },
        h('h2', { textContent: 'Trainer Profile' }),
        h('div', { class: 'profile-tag', textContent: `#${profile.id}` })),
      xpBar(profile.progress.xp),
      arenaProgress(profile.trophies),
      adventureSummary(profile),
      profile.streak >= 2 ? h('div', { class: 'streak stroke' }, icon(Flame), `${profile.streak} win streak!`) : null,
      statGrid(profile),
      seasonList(profile),
      h('h2', { class: 'section-title' }, icon(Swords), 'Battle log'),
      matchList(this.profiles.matches, this.onReplay),
      this.restorePanel(),
    ];
    this.el.replaceChildren(...parts.filter((p): p is HTMLElement => p !== null));
  }

  private restorePanel(): HTMLElement {
    const code = this.profiles.restoreCode;
    const error = h('div', { class: 'error-text' });
    const input = h('input', { class: 'code-input', placeholder: 'Paste a restore code', autocomplete: 'off', spellcheck: false });
    const use = h('button', { class: 'btn green small' }, 'Use');
    use.addEventListener('click', async () => {
      if (!confirm('Switch this device to that profile? Keep this profile’s restore code if you want to come back to it.')) return;
      use.disabled = true;
      try {
        await this.profiles.restore(input.value);
      } catch (err) {
        error.textContent = err instanceof Error ? err.message : String(err);
      } finally {
        use.disabled = false;
      }
    });
    let copy: HTMLButtonElement | null = null;
    if (code) {
      copy = h('button', { class: 'btn gold small' }, icon(Copy, 'btn-icon'), ' Copy restore code');
      copy.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(code);
          copy!.replaceChildren('Copied!');
        } catch (err) {
          console.error('Copying the restore code failed', err);
          prompt('Copy your restore code:', code);
        }
      });
    }
    return h('div', { class: 'panel' },
      h('div', { class: 'panel-title stroke' }, icon(Key), 'Restore code'),
      h('div', { class: 'hint left', textContent: 'Your restore code is the key to this profile. Copy it somewhere safe to play on another device or after clearing your browser. Never share it.' }),
      copy ? h('div', { class: 'row' }, copy) : null,
      h('div', { class: 'row' }, input, use),
      error,
    );
  }
}
