import { Bot, Copy, Crown, Flame, KeyRound, Medal, RefreshCw, Swords, Trophy, Users } from 'lucide';
import {
  arenaFor, nextArena, winRate,
  type LeaderboardEntry, type MatchRecord, type ProfileStats, type PublicProfile,
} from '@cop/shared';
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

const MODE_LABEL: Record<MatchRecord['mode'], string> = { ranked: 'Ranked', friendly: 'Friendly', training: 'Training', casual: 'Casual' };

function matchList(matches: MatchRecord[]): HTMLElement {
  if (matches.length === 0) return h('div', { class: 'hint', textContent: 'No battles yet. Hit Battle to get on the ladder!' });
  return h('ol', { class: 'match-list' }, ...matches.map((m) => {
    const when = new Date(m.playedAt);
    return h('li', { class: `match-row ${m.outcome}` },
      h('div', { class: 'match-outcome stroke', textContent: m.outcome === 'win' ? 'Win' : m.outcome === 'loss' ? 'Loss' : 'Draw' }),
      h('div', { class: 'match-who' },
        h('div', { class: 'plate-name', textContent: m.opponent.name }),
        h('div', { class: 'plate-sub', textContent: `${MODE_LABEL[m.mode]} · ${when.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${when.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}` }),
      ),
      h('div', { class: 'match-crowns stroke' }, icon(Crown), `${m.crowns}–${m.opponentCrowns}`),
      m.mode === 'ranked' ? deltaPill(m.delta) : h('div', { class: 'delta' }, icon(m.opponent.id ? Users : Bot)),
    );
  }));
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
export class RanksPanel {
  readonly el = h('div', { class: 'tab-panel' });
  private readonly list = h('div', { class: 'ladder' });
  private readonly footer = h('div', { class: 'ladder-me' });
  private loading = false;

  constructor(private readonly profiles: ProfileSession) {
    const refresh = h('button', { class: 'btn small icon-btn', attrs: { 'aria-label': 'Refresh leaderboard' } }, icon(RefreshCw));
    refresh.addEventListener('click', () => void this.load());
    this.el.append(
      h('div', { class: 'deck-head' }, h('h2', { textContent: 'Kanto Ladder' }), refresh),
      h('div', { class: 'hint', textContent: 'Ranked battles move trophies. Friendly and training battles never do.' }),
      this.list,
      this.footer,
    );
    profiles.onChange(() => this.renderMe());
  }

  async load() {
    if (this.loading) return;
    this.loading = true;
    this.list.replaceChildren(h('div', { class: 'spinner' }));
    try {
      const { entries, total } = await api.leaderboard(50);
      this.render(entries, total);
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
      this.list.replaceChildren(h('div', { class: 'hint', textContent: 'Nobody is on the ladder yet. Win a ranked battle to take the top spot!' }));
    } else {
      this.list.replaceChildren(
        h('div', { class: 'plate-sub ladder-total', textContent: `${total} ranked trainer${total === 1 ? '' : 's'}` }),
        h('ol', { class: 'ladder-list' }, ...entries.map((e) => {
          const row = h('li', { class: `ladder-row${e.id === me ? ' me' : ''}${e.rank <= 3 ? ` top${e.rank}` : ''}` },
            h('div', { class: 'ladder-rank stroke' }, e.rank <= 3 ? icon(Medal) : null, String(e.rank)),
            h('div', { class: 'ladder-who' },
              h('div', { class: 'plate-name', textContent: e.name }),
              h('div', { class: 'plate-sub', textContent: `${arenaFor(e.trophies).name} · ${e.wins}W ${e.losses}L` }),
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

  private renderMe() {
    const p = this.profiles.profile;
    this.footer.replaceChildren(p
      ? h('div', { class: 'ladder-row me' },
        h('div', { class: 'ladder-rank stroke', textContent: p.rank ? String(p.rank) : '—' }),
        h('div', { class: 'ladder-who' }, h('div', { class: 'plate-name', textContent: `${p.name} (you)` }), h('div', { class: 'plate-sub', textContent: p.rank ? arenaFor(p.trophies).name : 'Play a ranked battle to get ranked' })),
        trophyPill(p.trophies))
      : h('div', { class: 'hint', textContent: this.profiles.status === 'offline' ? 'Offline: your rank shows up once the server is reachable.' : '' }));
  }
}

/** The Profile tab: your stats, history and restore code. */
export class ProfilePanel {
  readonly el = h('div', { class: 'tab-panel' });

  constructor(private readonly profiles: ProfileSession) {
    profiles.onChange(() => this.render());
    this.render();
  }

  private render() {
    const { profile, status } = this.profiles;
    if (!profile) {
      const retry = h('button', { class: 'btn small' }, icon(RefreshCw, 'btn-icon'), ' Retry');
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
      profileHeader(profile, 'red'),
      arenaProgress(profile.trophies),
      profile.streak >= 2 ? h('div', { class: 'streak stroke' }, icon(Flame), `${profile.streak} win streak!`) : null,
      statGrid(profile),
      h('h2', { class: 'section-title' }, icon(Swords), 'Battle log'),
      matchList(this.profiles.matches),
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
      h('div', { class: 'panel-title stroke' }, icon(KeyRound), 'Restore code'),
      h('div', { class: 'hint left', textContent: 'Your restore code is the key to this profile. Copy it somewhere safe to play on another device or after clearing your browser. Never share it.' }),
      copy ? h('div', { class: 'row' }, copy) : null,
      h('div', { class: 'row' }, input, use),
      error,
    );
  }
}
