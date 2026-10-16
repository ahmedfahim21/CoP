import {
  CARDS, MAX_LEVEL, STAGES, STAR_TEXT, levelFor, unlockLevel, unlockStage,
  type CardId, type Progress, type QuestState,
} from '@cop/shared';
import { h, icon } from './dom.js';
import { Flame, Lock, Star, Tick } from './icons.js';

/** Progression widgets shared by the menus and the result screen. */

export function levelBadge(level: number, cls = ''): HTMLDivElement {
  return h('div', { class: `level-badge stroke ${cls}`.trim(), attrs: { title: `Trainer level ${level}` } }, h('small', { textContent: 'Lv' }), String(level));
}

/** "Lv 7 · 140 / 360 XP" with a bar. */
export function xpBar(xp: number): HTMLDivElement {
  const { level, into, needed } = levelFor(xp);
  const pct = needed > 0 ? (into / needed) * 100 : 100;
  return h('div', { class: 'xp' },
    levelBadge(level),
    h('div', { class: 'xp-track', attrs: { role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(needed || 1), 'aria-valuenow': String(into) } },
      h('div', { class: 'xp-fill', attrs: { style: `width:${Math.max(2, Math.min(100, pct))}%` } })),
    h('div', { class: 'xp-text', textContent: level >= MAX_LEVEL ? 'Max level' : `${into} / ${needed} XP` }),
  );
}

export function starsEl(n: number, of = 3): HTMLDivElement {
  return h('div', { class: 'stars', attrs: { 'aria-label': `${n} of ${of} stars` } },
    ...Array.from({ length: of }, (_, i) => icon(Star, i < n ? 'star won' : 'star')));
}

/** What each star is for, with the earned ones ticked. */
export function starList(n: number): HTMLUListElement {
  return h('ul', { class: 'star-list' }, ...STAR_TEXT.map((text, i) => h('li', { class: i < n ? 'done' : '' }, icon(i < n ? Tick : Star), text)));
}

export function questList(quests: QuestState[]): HTMLElement {
  if (quests.length === 0) return h('div', { class: 'hint', textContent: 'Play a battle to get today’s quests.' });
  return h('ul', { class: 'quest-list' }, ...quests.map((q) => {
    const pct = Math.min(100, (q.progress / q.target) * 100);
    return h('li', { class: `quest${q.done ? ' done' : ''}` },
      h('div', { class: 'quest-head' },
        h('span', { class: 'quest-text', textContent: q.text }),
        h('span', { class: 'quest-xp stroke', textContent: q.done ? 'Done' : `+${q.xp} XP` })),
      h('div', { class: 'quest-track' }, h('div', { class: 'quest-fill', attrs: { style: `width:${pct}%` } })),
      h('div', { class: 'quest-count', textContent: `${Math.min(q.progress, q.target).toLocaleString('en')} / ${q.target.toLocaleString('en')}` }),
    );
  }));
}

/** The streak chip: "3-day streak". */
export function streakChip(p: Progress, today: string): HTMLElement | null {
  const alive = p.streak.day === today || p.streak.count > 0;
  if (!alive || p.streak.count < 1) return null;
  return h('div', { class: 'streak-chip stroke' }, icon(Flame), `${p.streak.count}-day streak`);
}

/** Why a card is locked: "Lv 7, or beat Koga". */
export function unlockHint(card: CardId): string {
  const level = unlockLevel(card);
  const stage = unlockStage(card);
  const parts = [level ? `trainer level ${level}` : null, stage ? `beat ${stage.leader}` : null].filter(Boolean);
  return parts.length ? `Unlocks at ${parts.join(', or ')}` : '';
}

/** A lock over a card element. */
export function lockCard(el: HTMLElement, card: CardId) {
  el.classList.add('locked');
  el.append(h('div', { class: 'lock-cover', attrs: { title: unlockHint(card) } }, icon(Lock), h('span', { textContent: shortUnlock(card) })));
}

function shortUnlock(card: CardId): string {
  const level = unlockLevel(card);
  return level ? `Lv ${level}` : '';
}

/** Names for a list of cards: "Geodude and Golem". */
export function cardNames(cards: CardId[]): string {
  const names = cards.map((c) => CARDS[c].name);
  return names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** The League's badge row, earned ones lit. */
export function badgeRow(stars: Record<string, number>): HTMLDivElement {
  return h('div', { class: 'badge-row' }, ...STAGES.map((s) => h('div', {
    class: `badge-dot${(stars[s.id] ?? 0) > 0 ? ' won' : ''}`, data: { type: s.type }, attrs: { title: `${s.badge} (${s.leader})` },
  }, h('span', { textContent: s.order <= 8 ? String(s.order) : s.order === 13 ? '★' : 'E' }))));
}
