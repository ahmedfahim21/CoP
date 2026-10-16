import { STAGES, nextStage, stageOpen, type Stage } from '@cop/shared';
import type { ProfileSession } from '../profile.js';
import { modal } from './adventure.js';
import { cardEl } from './cards.js';
import { h, icon } from './dom.js';
import { Gift, Lock, MapIcon, Medal, Sparkles, Swords } from './icons.js';
import { cardNames, starList, starsEl } from './progress.js';

/**
 * The Kanto League on the Battle tab: the next stage to beat, with its twist and reward, and
 * the map of all thirteen (8 gyms, the Elite Four and Champion Blue) with stars earned.
 */
export class LeaguePanel {
  readonly el = h('section', { class: 'panel league' });

  constructor(private readonly profiles: ProfileSession, private readonly onLeague: (stage: string) => void) {
    profiles.onChange(() => this.render());
    this.render();
  }

  private render() {
    const p = this.profiles.progress;
    const next = nextStage(p);
    const map = h('div', { class: 'league-map' }, ...STAGES.map((s) => {
      const stars = p.stars[s.id] ?? 0;
      const open = stageOpen(p, s.id);
      const b = h('button', { class: `stage-dot${stars > 0 ? ' cleared' : ''}${open ? '' : ' locked'}${next?.id === s.id ? ' next' : ''}`, data: { type: s.type }, attrs: { 'aria-label': `${s.leader}, ${s.title}` } },
        h('span', { class: 'stage-num stroke', textContent: s.order <= 8 ? String(s.order) : s.order === 13 ? 'C' : 'E4' }),
        open ? starsEl(stars) : icon(Lock),
        h('span', { class: 'stage-name', textContent: s.leader }));
      b.addEventListener('click', () => this.showStage(s));
      return b;
    }));
    const champion = !next;
    const ready = this.profiles.status === 'ready';
    const parts: Array<HTMLElement | null> = [
      h('div', { class: 'panel-title stroke' }, icon(MapIcon), 'Kanto League',
        h('span', { class: 'panel-aside', textContent: `${Object.values(p.stars).reduce((a, b) => a + b, 0)}/${STAGES.length * 3}` }, icon(Medal))),
      champion
        ? h('div', { class: 'league-next' }, h('div', { class: 'stroke', textContent: 'You are the Champion!' }), h('div', { class: 'hint left', textContent: 'Go back for any missing stars.' }))
        : this.stageCard(next!, true),
      map,
      ready ? null : h('div', { class: 'hint left', textContent: this.profiles.status === 'loading' ? 'Loading your trainer profile…' : 'The League needs your trainer profile, and the game server isn’t reachable right now.' }),
    ];
    this.el.replaceChildren(...parts.filter((x): x is HTMLElement => x !== null));
  }

  private stageCard(s: Stage, compact: boolean) {
    const p = this.profiles.progress;
    const stars = p.stars[s.id] ?? 0;
    const open = stageOpen(p, s.id);
    const go = h('button', { class: 'btn gold' }, icon(Swords, 'btn-icon'), stars > 0 ? ' Battle again' : ' Battle');
    // League battles are recorded on the profile, so they need it loaded (here and in the stage pop-up).
    go.disabled = !open || this.profiles.status !== 'ready';
    go.addEventListener('click', () => {
      document.querySelector('.modal-backdrop')?.remove();
      this.onLeague(s.id);
    });
    return h('div', { class: `league-next${compact ? '' : ' full'}`, data: { type: s.type } },
      h('div', { class: 'league-who' },
        h('div', { class: 'league-leader stroke', textContent: s.leader }),
        h('div', { class: 'plate-sub', textContent: `${s.title} · ${s.badge}` }),
        starsEl(stars)),
      h('div', { class: 'league-twist' }, icon(Sparkles), h('span', { textContent: s.twist })),
      h('div', { class: 'league-hint', textContent: s.hint }),
      s.unlocks.length && stars === 0 ? h('div', { class: 'league-reward' }, icon(Gift), `First clear unlocks ${cardNames([...s.unlocks])}`) : null,
      compact ? null : starList(stars),
      open ? null : h('div', { class: 'hint left', textContent: `Beat ${STAGES[s.order - 2]?.leader ?? 'the previous stage'} first.` }),
      h('div', { class: 'row' }, go),
    );
  }

  private showStage(s: Stage) {
    const close = h('button', { class: 'btn' }, 'Close');
    const deck = h('div', { class: 'mini-deck' }, ...s.deck.map((c) => cardEl(c)));
    const backdrop = modal(s.title, h('div', { class: 'stage-modal' }, this.stageCard(s, false), h('div', { class: 'section-title', textContent: 'Their deck' }), deck), close);
    close.addEventListener('click', () => backdrop.remove());
  }

}
