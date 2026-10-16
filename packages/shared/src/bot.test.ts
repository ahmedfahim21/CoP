import { describe, expect, it } from 'vitest';
import { mirror } from './arena.js';
import { ACE_SKILL, ACE_TROPHIES, Bot, ROOKIE_SKILL, chooseBotPlay, seededRandom, skillForTrophies } from './bot.js';
import { CARDS } from './cards.js';
import { OVERTIME_SECONDS, REGULAR_SECONDS, createMatch, playCard, step, type MatchState } from './sim.js';
import { DT, PICKS, keepUnits, spawn, started } from './testing.js';

/** Plays a whole match; `players` decide for each team (null = idle). Returns rejected plays too. */
function playOut(s: MatchState, players: [((s: MatchState) => ReturnType<Bot['update']>) | null, ((s: MatchState) => ReturnType<Bot['update']>) | null]) {
  let rejected = 0;
  let plays = 0;
  let t = 0;
  for (; t < REGULAR_SECONDS + OVERTIME_SECONDS + 5 && s.phase !== 'ended'; t += DT) {
    for (const team of [0, 1] as const) {
      const play = players[team]?.(s);
      if (!play) continue;
      const r = playCard(s, team, play.slot, play);
      if (r.ok) plays++;
      else rejected++;
    }
    step(s, DT);
  }
  return { rejected, plays, seconds: t };
}

describe('bot', () => {
  it.each([1, 2, 3])('beats an idle opponent and never sends an illegal play (seed %s)', (seed) => {
    const s = started(seed);
    const bot = new Bot(1, seededRandom(seed));
    const { rejected, plays, seconds } = playOut(s, [null, (m) => bot.update(m, DT)]);
    expect(rejected).toBe(0);
    expect(plays).toBeGreaterThanOrEqual(3);
    expect(s.result?.winner).toBe(1);
    // Troops walk around towers instead of stalling behind them, so an undefended side falls
    // fast: three crowns well inside regulation (it took ~175s when they got stuck).
    expect(s.players[1].crowns).toBe(3);
    expect(seconds).toBeLessThan(120);
  });

  it('wins most matches against a random player, from either side', () => {
    let wins = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const s = createMatch(PICKS, seed);
      const team = (seed % 2) as 0 | 1;
      const bot = new Bot(team, seededRandom(seed));
      const rand = seededRandom(seed * 31);
      const random = () => (rand() < 0.02 ? { slot: Math.floor(rand() * 4), x: 1 + rand() * 16, y: 17 + rand() * 13 } : null);
      const botPlays = (m: MatchState) => bot.update(m, DT);
      playOut(s, team === 0 ? [botPlays, random] : [random, botPlays]);
      expect(s.phase).toBe('ended');
      if (s.result?.winner === team) wins++;
    }
    expect(wins).toBeGreaterThanOrEqual(7);
  });

  it('defends a push with a troop between the threat and its towers', () => {
    const s = started(4);
    keepUnits(s);
    // Team 0 walks a Machop deep into team 1's half (team 1 sees it near its own left tower).
    const [machop] = spawn(s, 0, 'machop', { x: 14.5, y: 20 });
    Object.assign(machop!, mirror(1, { x: 4, y: 21 }), { deployTimer: 0 });
    s.players[1].elixir = 6;
    s.players[1].hand = ['pikachu', 'machop', 'rattata', 'snorlax'];
    const play = chooseBotPlay(s, 1, seededRandom(1));
    expect(play).not.toBeNull();
    expect(CARDS[s.players[1].hand[play!.slot]!].stats.targets).not.toBe('buildings');
    expect(play!.y).toBeGreaterThanOrEqual(21);
    expect(Math.abs(play!.x - 4)).toBeLessThan(4);
  });

  it('holds its elixir when nothing is happening', () => {
    const s = started(5);
    s.players[1].elixir = 5;
    const quiet = seededRandom(9);
    for (let i = 0; i < 20; i++) expect(chooseBotPlay(s, 1, quiet)).toBeNull();
    s.players[1].elixir = 10;
    expect(chooseBotPlay(s, 1, quiet)).not.toBeNull();
  });

  it('waits for the battle to begin', () => {
    const s = createMatch(PICKS, 1);
    s.players[0].elixir = 10;
    const bot = new Bot(0, seededRandom(1));
    for (let i = 0; i < 100; i++) expect(bot.update(s, DT)).toBeNull();
  });
});

describe('bot skill', () => {
  it('scales from rookie at 0 trophies to ace at the top', () => {
    expect(skillForTrophies(0)).toEqual(ROOKIE_SKILL);
    expect(skillForTrophies(ACE_TROPHIES)).toEqual(ACE_SKILL);
    expect(skillForTrophies(99999)).toEqual(ACE_SKILL);
    const mid = skillForTrophies(ACE_TROPHIES / 2);
    expect(mid.reaction).toBeLessThan(ROOKIE_SKILL.reaction);
    expect(mid.reaction).toBeGreaterThan(ACE_SKILL.reaction);
  });

  it('the ace beats the rookie most of the time, and both only play legal cards', () => {
    let aceWins = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const s = createMatch(PICKS, seed);
      const aceTeam = (seed % 2) as 0 | 1;
      const ace = new Bot(aceTeam, seededRandom(seed), ACE_SKILL);
      const rookie = new Bot((1 - aceTeam) as 0 | 1, seededRandom(seed + 100), ROOKIE_SKILL);
      const bots = aceTeam === 0 ? [ace, rookie] : [rookie, ace];
      const { rejected } = playOut(s, [(m) => bots[0]!.update(m, DT), (m) => bots[1]!.update(m, DT)]);
      expect(rejected).toBe(0);
      if (s.result?.winner === aceTeam) aceWins++;
    }
    expect(aceWins).toBeGreaterThanOrEqual(6);
  });
});
