import { describe, expect, it } from 'vitest';
import { Bot, seededRandom } from './bot.js';
import { ReplayRecorder, STEP_SECONDS, isReplay, runReplay } from './replay.js';
import { QUICK_RULES, createMatch, playCard, step, type MatchRules } from './sim.js';
import { PICKS } from './testing.js';
import { DEFAULT_DECK } from './cards.js';

/** Plays a bot-vs-bot battle the way the server does, recording it. */
function recordBattle(seed: number, rules: MatchRules = QUICK_RULES) {
  const decks: [typeof DEFAULT_DECK[number][], typeof DEFAULT_DECK[number][]] = [[...DEFAULT_DECK], ['tauros', 'pikachu', 'zubat', 'voltorb', 'scyther', 'mrmime', 'koffing', 'dugtrio']];
  const match = createMatch(PICKS, seed, decks, rules);
  const rec = new ReplayRecorder({ seed, starters: PICKS, decks, rules, names: ['A', 'B'] });
  const bots = [new Bot(0, seededRandom(seed)), new Bot(1, seededRandom(seed + 1))];
  while (match.phase !== 'ended') {
    step(match, STEP_SECONDS);
    rec.stepped();
    for (const bot of bots) {
      const play = bot.update(match, STEP_SECONDS);
      if (play && playCard(match, bot.team, play.slot, play).ok) rec.play(bot.team, play.slot, play);
    }
  }
  return { match, replay: rec.finish(match.result) };
}

describe('replays', () => {
  it.each([3, 7])('re-simulate to the identical battle (seed %s)', (seed) => {
    const { match, replay } = recordBattle(seed);
    expect(replay.plays.length).toBeGreaterThan(10);
    const again = runReplay(JSON.parse(JSON.stringify(replay)));
    expect(again.result).toEqual(match.result);
    expect(again.players.map((p) => p.crowns)).toEqual(match.players.map((p) => p.crowns));
    const hp = (m: typeof match) => m.entities.filter((e) => e.kind !== 'unit').map((e) => `${e.id}:${e.hp}`);
    expect(hp(again)).toEqual(hp(match));
  });

  it('carries team modifiers through', () => {
    const rules: MatchRules = { ...QUICK_RULES, teams: [{ towerHp: 1.5 }, { unitDamage: 1.3, elixirRate: 1.2 }] };
    const { match, replay } = recordBattle(11, rules);
    expect(runReplay(replay).result).toEqual(match.result);
  });

  it('recognises replay payloads', () => {
    expect(isReplay(recordBattle(2).replay)).toBe(true);
    expect(isReplay({ v: 2 })).toBe(false);
    expect(isReplay(null)).toBe(false);
  });
});
