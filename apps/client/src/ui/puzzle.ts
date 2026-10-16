import { PUZZLES, puzzleById, puzzleStatus, startPuzzle, type Puzzle } from '@cop/shared';
import { track } from '../analytics.js';
import { LocalBattle } from '../local.js';
import type { ProfileSession } from '../profile.js';
import { h, icon } from './dom.js';
import { BattleHud } from './hud.js';
import { Puzzle as PuzzleIcon, Restart, Swords, Tick } from './icons.js';

/**
 * Puzzles run entirely in the browser on the shared simulation: no server round trips, so
 * they work offline too. Solving one tells the server once, for the XP.
 */
export function playPuzzle(id: string, profiles: ProfileSession, onClose: () => void) {
  const puzzle = puzzleById(id);
  if (!puzzle) return onClose();
  intro(puzzle, () => run(puzzle, profiles, onClose), onClose);
}

function intro(p: Puzzle, onStart: () => void, onClose: () => void) {
  const start = h('button', { class: 'btn gold' }, icon(Swords, 'btn-icon'), ' Start');
  const back = h('button', { class: 'btn' }, 'Back');
  const goal = p.goal.kind === 'defend'
    ? `Goal: wipe out every enemy troop without losing a tower, within ${p.goal.seconds} seconds.`
    : `Goal: take down an enemy tower within ${p.goal.seconds} seconds.`;
  const el = h('div', { class: 'mm puzzle-intro' },
    h('div', { class: 'mm-box' },
      h('div', { class: 'mm-swords' }, icon(PuzzleIcon)),
      h('h2', { textContent: p.title }),
      h('div', { class: 'puzzle-text', textContent: p.text }),
      h('div', { class: 'puzzle-goal stroke', textContent: goal }),
      h('div', { class: 'hint', textContent: `${p.elixir} elixir${p.regen ? ', refilling' : ', no refills'}. The enemy has none.` }),
      h('div', { class: 'row' }, back, start)));
  document.body.append(el);
  start.addEventListener('click', () => {
    el.remove();
    onStart();
  });
  back.addEventListener('click', () => {
    el.remove();
    onClose();
  });
}

function run(p: Puzzle, profiles: ProfileSession, onClose: () => void) {
  let status: ReturnType<typeof puzzleStatus> = 'playing';
  const battle: LocalBattle = new LocalBattle(startPuzzle(p), {
    team: 0, names: ['You', 'Puzzle'], title: p.title, twist: p.text,
    clock: (_m, elapsed) => Math.max(0, p.goal.seconds - elapsed),
    afterStep: (m, elapsed) => {
      status = puzzleStatus(p, m, elapsed);
      if (status !== 'playing') queueMicrotask(() => battle.end());
    },
  });
  const hud = new BattleHud(battle, () => finish());
  battle.start();

  const finish = () => {
    const solved = status === 'solved';
    const retry = h('button', { class: 'btn' }, icon(Restart, 'btn-icon'), ' Retry');
    const back = h('button', { class: 'btn' }, 'Puzzles');
    const nextId = PUZZLES[PUZZLES.findIndex((x) => x.id === p.id) + 1]?.id;
    const next = solved && nextId ? h('button', { class: 'btn gold' }, 'Next puzzle') : null;
    const reward = h('div', { class: 'reason' });
    const close = () => {
      battle.dispose();
      hud.dispose();
    };
    retry.addEventListener('click', () => {
      close();
      run(p, profiles, onClose);
    });
    back.addEventListener('click', () => {
      close();
      onClose();
    });
    next?.addEventListener('click', () => {
      close();
      playPuzzle(nextId!, profiles, onClose);
    });
    hud.showResult(h('div', { class: 'result puzzle-result' },
      h('div', { class: 'mm-swords' }, icon(solved ? Tick : PuzzleIcon)),
      h('h2', { textContent: solved ? 'Solved!' : 'Not quite' }),
      h('div', { class: 'reason', textContent: solved ? p.title : p.goal.kind === 'defend' ? 'A tower fell, or time ran out.' : 'The tower held.' }),
      reward,
      h('div', { class: 'actions' }, back, retry, next)));
    if (!solved) return;
    track({ name: 'puzzle_solved', puzzle: p.id });
    profiles.claimPuzzle(p.id).then((res) => {
      if (res && res.xp > 0) reward.textContent = `+${res.xp} XP`;
      else if (res) reward.textContent = 'Already solved: no XP this time.';
      else reward.textContent = 'Offline: progress not saved.';
    }, (err: unknown) => {
      console.error('Claiming the puzzle failed', err);
      reward.textContent = 'Couldn’t save the solve; try again later.';
    });
  };
}
