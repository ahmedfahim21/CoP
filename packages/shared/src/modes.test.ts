import { describe, expect, it } from 'vitest';
import { Bot, seededRandom } from './bot.js';
import { isDeck } from './cards.js';
import {
  BOT_DECKS, EVENTS, GAUNTLET_REVIVE, chaosDeck, currentEvent, dailyChallenge, dailyScore, draftOffers, eventFoe, gauntletRound,
  ghostTrophyDelta, isDraftedDeck, reviveTowers,
} from './modes.js';
import { trophyDelta } from './ranking.js';
import { createMatch, playCard, step, towerHealthOf, type MatchState } from './sim.js';

describe('Daily Challenge', () => {
  it('is the same for everyone on a day and changes day to day', () => {
    const a = dailyChallenge('2026-10-16');
    expect(dailyChallenge('2026-10-16')).toEqual(a);
    expect(isDeck(a.deck)).toBe(true);
    expect(isDeck(a.foeDeck)).toBe(true);
    const days = Array.from({ length: 10 }, (_, i) => dailyChallenge(`2026-10-${10 + i}`));
    expect(new Set(days.map((d) => `${d.title}:${d.deck.join()}`)).size).toBeGreaterThan(3);
  });

  it('scores crowns first, then damage, health and speed', () => {
    const base = { won: false, crowns: 0, towerDamage: 0, towerHealth: 0, secondsLeft: 0 };
    expect(dailyScore(base)).toBe(0);
    expect(dailyScore({ ...base, crowns: 1 })).toBeGreaterThan(dailyScore({ ...base, towerDamage: 4000 }));
    expect(dailyScore({ ...base, won: true, crowns: 3, secondsLeft: 30 })).toBeGreaterThan(dailyScore({ ...base, won: true, crowns: 3 }));
  });
});

describe('Gauntlet', () => {
  it('gets harder every round and carries tower damage', () => {
    const r1 = gauntletRound(1, 42, null);
    const r5 = gauntletRound(5, 42, { king: 0.8, left: 0, right: 0.5 });
    expect(r5.foeSkill.reaction).toBeLessThan(r1.foeSkill.reaction);
    expect(r5.rules.teams![1].unitHp!).toBeGreaterThan(1);
    expect(r5.rules.startHp![0]).toEqual({ king: 0.8, left: GAUNTLET_REVIVE, right: 0.5 });
    const m = createMatch([['bulbasaur', 'charmander'], r5.foeStarters], 1, [BOT_DECKS[0]!, r5.foeDeck], r5.rules);
    const h = towerHealthOf(m.entities, 0);
    expect(h.left).toBeCloseTo(GAUNTLET_REVIVE, 2);
    expect(h.king).toBeCloseTo(0.8, 2);
    expect(towerHealthOf(m.entities, 1)).toEqual({ king: 1, left: 1, right: 1 });
    expect(reviveTowers({ king: 0.1, left: 0, right: 1 })).toEqual({ king: GAUNTLET_REVIVE, left: GAUNTLET_REVIVE, right: 1 });
    expect(gauntletRound(3, 42, null)).toEqual(gauntletRound(3, 42, null));
  });
});

describe('events', () => {
  it('rotate weekly through every event', () => {
    const week = 7 * 86_400_000;
    const ids = new Set(Array.from({ length: EVENTS.length }, (_, i) => currentEvent(Date.UTC(2026, 0, 5) + i * week).id));
    expect(ids.size).toBe(EVENTS.length);
  });

  it('drafts offer disjoint pairs, so every pick makes a legal deck', () => {
    const offers = draftOffers(9);
    expect(new Set(offers.flat()).size).toBe(16);
    const deck = offers.map((p, i) => p[i % 2]!);
    expect(isDeck(deck)).toBe(true);
    expect(isDraftedDeck(9, deck)).toBe(true);
    expect(isDraftedDeck(9, [...deck.slice(0, 7), offers[0]![0]])).toBe(false);
    expect(isDraftedDeck(10, deck)).toBe(false);
  });

  it('mirror copies your deck; chaos and draft get random decks', () => {
    const mine = { deck: [...BOT_DECKS[1]!], starters: ['squirtle', 'bulbasaur'] as const };
    expect(eventFoe(EVENTS.find((e) => e.id === 'mirror')!, 1, mine)).toEqual(mine);
    expect(isDeck(eventFoe(EVENTS.find((e) => e.id === 'chaos')!, 1, mine).deck)).toBe(true);
    expect(isDeck(chaosDeck(5))).toBe(true);
  });

  it('every event battle runs to a result with bots on both sides', () => {
    for (const ev of EVENTS) {
      const s = createMatch([['bulbasaur', 'charmander'], ['squirtle', 'charmander']], 3, [BOT_DECKS[0]!, BOT_DECKS[2]!], ev.rules);
      const bots = [new Bot(0, seededRandom(1)), new Bot(1, seededRandom(2))];
      for (let t = 0; t < 400 && s.phase !== 'ended'; t += 0.05) {
        for (const b of bots) {
          const p = b.update(s, 0.05);
          if (p) createPlay(s, b.team, p);
        }
        stepOnce(s);
      }
      expect(s.phase, ev.id).toBe('ended');
    }
  });
});

describe('ghosts', () => {
  it('move half the trophies, and never below zero', () => {
    expect(ghostTrophyDelta(1000, 1000, 'win')).toBe(Math.round(trophyDelta(1000, 1000, 'win') / 2));
    expect(ghostTrophyDelta(1000, 1000, 'loss')).toBe(-15);
    expect(ghostTrophyDelta(0, 1000, 'loss')).toBe(0);
  });
});


function createPlay(s: MatchState, team: 0 | 1, p: { slot: number; x: number; y: number }) {
  playCard(s, team, p.slot, p);
}

function stepOnce(s: MatchState) {
  step(s, 0.05);
}
