import { describe, expect, it } from 'vitest';
import { CARD_IDS, isDeck } from './cards.js';
import { STAGES, starsFor, stageRules } from './campaign.js';
import {
  FIRST_UNLOCK_LEVEL, FIRST_WIN_XP, LAST_UNLOCK_LEVEL, LEVEL_UNLOCKS, MAX_LEVEL, STARTER_CARDS, applyBattle, applyPuzzle, dayKey, deckUnlocked, emptyProgress,
  levelFor, nextStage, parseProgress, previousDay, questsFor, stageOpen, unlockLevel, unlockStage, unlockedCards, weekKey, xpToNext,
  type BattleOutcome, type Progress,
} from './progression.js';

const DAY = Date.UTC(2026, 9, 16, 12);
const win = (over: Partial<BattleOutcome> = {}): BattleOutcome => ({
  mode: 'training', outcome: 'win', crowns: 1, towersLost: 0, towerDamage: 2000, defeated: 5, played: { pikachu: 2 }, ...over,
});

describe('calendar', () => {
  it('days and weeks are UTC', () => {
    expect(dayKey(DAY)).toBe('2026-10-16');
    expect(previousDay('2026-03-01')).toBe('2026-02-28');
    expect(weekKey(Date.UTC(2026, 0, 1))).toBe('2026-W01');
    expect(weekKey(Date.UTC(2026, 9, 16))).toBe('2026-W42');
  });
});

describe('levels', () => {
  it('climb with XP and stop at the cap', () => {
    expect(levelFor(0)).toEqual({ level: 1, into: 0, needed: xpToNext(1) });
    expect(levelFor(xpToNext(1)).level).toBe(2);
    expect(levelFor(xpToNext(1) + 5)).toEqual({ level: 2, into: 5, needed: xpToNext(2) });
    expect(levelFor(1e9)).toEqual({ level: MAX_LEVEL, into: 0, needed: 0 });
  });
});

describe('card unlocks', () => {
  it('starter cards plus level unlocks cover every card exactly once', () => {
    expect(new Set([...STARTER_CARDS, ...LEVEL_UNLOCKS]).size).toBe(CARD_IDS.length);
    expect(STARTER_CARDS.length + LEVEL_UNLOCKS.length).toBe(CARD_IDS.length);
    for (const c of LEVEL_UNLOCKS) {
      expect(unlockLevel(c)).toBeGreaterThanOrEqual(FIRST_UNLOCK_LEVEL);
      expect(unlockLevel(c)).toBeLessThanOrEqual(LAST_UNLOCK_LEVEL);
    }
    // Most of the roster from the start; nothing waits past level 6.
    expect(STARTER_CARDS.length).toBe(15);
    expect(LAST_UNLOCK_LEVEL).toBe(6);
    expect(unlockLevel('pikachu')).toBeNull();
  });

  it('every locked card is also unlocked by exactly one League stage', () => {
    const fromStages = STAGES.flatMap((s) => s.unlocks);
    expect(new Set(fromStages).size).toBe(fromStages.length);
    expect(new Set(fromStages)).toEqual(new Set(LEVEL_UNLOCKS));
    expect(unlockStage('golem')?.id).toBe('brock');
  });

  it('a new trainer owns the starter set; legacy trainers own everything', () => {
    expect(unlockedCards(emptyProgress())).toEqual(new Set(STARTER_CARDS));
    expect(unlockedCards({ ...emptyProgress(), legacy: true }).size).toBe(CARD_IDS.length);
    expect(deckUnlocked(emptyProgress(), ['golem'])).toBe(false);
    expect(deckUnlocked({ ...emptyProgress(), stars: { brock: 1 } }, ['golem', 'geodude'])).toBe(true);
  });

  it('levels unlock cards too', () => {
    let xp = 0;
    for (let l = 1; l < FIRST_UNLOCK_LEVEL; l++) xp += xpToNext(l);
    expect(unlockedCards({ ...emptyProgress(), xp }).has(LEVEL_UNLOCKS[0]!)).toBe(true);
    expect(unlockedCards({ ...emptyProgress(), xp: xp - 1 }).has(LEVEL_UNLOCKS[0]!)).toBe(false);
  });

  it('owns every card at level 6, and the legendaries only from then', () => {
    let xp = 0;
    for (let l = 1; l < LAST_UNLOCK_LEVEL; l++) xp += xpToNext(l);
    expect(unlockedCards({ ...emptyProgress(), xp }).size).toBe(CARD_IDS.length);
    const before = unlockedCards({ ...emptyProgress(), xp: xp - 1 });
    expect(before.size).toBe(CARD_IDS.length - 3);
    for (const c of ['moltres', 'articuno', 'zapdos'] as const) expect(before.has(c)).toBe(false);
    // Level 6 is about 1,000 XP: roughly 20-25 battles with quests and first wins.
    expect(xp).toBe(1000);
  });
});

describe('League', () => {
  it('stages have legal decks and open one after another', () => {
    for (const s of STAGES) {
      expect(isDeck([...s.deck])).toBe(true);
      expect(s.starters[0]).not.toBe(s.starters[1]);
      expect(stageRules(s).teams?.[1]).toEqual(s.foe);
    }
    expect(STAGES.map((s) => s.order)).toEqual(STAGES.map((_, i) => i + 1));
    const p = emptyProgress();
    expect(stageOpen(p, 'brock')).toBe(true);
    expect(stageOpen(p, 'misty')).toBe(false);
    expect(stageOpen({ ...p, stars: { brock: 1 } }, 'misty')).toBe(true);
    expect(stageOpen(p, 'nope')).toBe(false);
    expect(nextStage({ ...p, stars: { brock: 2 } })?.id).toBe('misty');
  });

  it('stars: win, no tower lost, three crowns', () => {
    expect(starsFor(false, 0, 3)).toBe(0);
    expect(starsFor(true, 1, 1)).toBe(1);
    expect(starsFor(true, 0, 1)).toBe(2);
    expect(starsFor(true, 2, 3)).toBe(2);
    expect(starsFor(true, 0, 3)).toBe(3);
  });

  it('first clears unlock cards and pay; better runs add stars', () => {
    const first = applyBattle(emptyProgress(), win({ stage: 'brock', towersLost: 1 }), DAY, 'P');
    expect(first.stars).toEqual({ stage: 'brock', before: 0, after: 1 });
    // Brock's own card, plus level 2's batch: the clear's XP alone reaches level 2.
    expect(first.levelAfter).toBe(2);
    expect(first.unlocked.sort()).toEqual(['golem', 'koffing', 'starmie']);
    expect(first.rewards.map((r) => r.text)).toContain('Boulder Badge!');
    const again = applyBattle(first.progress, win({ stage: 'brock', crowns: 3 }), DAY, 'P');
    expect(again.stars).toEqual({ stage: 'brock', before: 1, after: 3 });
    expect(again.rewards.map((r) => r.text)).toContain('2 new stars');
    const worse = applyBattle(again.progress, win({ stage: 'brock', towersLost: 2 }), DAY, 'P');
    expect(worse.stars).toEqual({ stage: 'brock', before: 3, after: 3 });
    expect(worse.unlocked).toEqual([]);
  });
});

describe('quests', () => {
  it('three a day, the same all day for one trainer, different for another', () => {
    const a = questsFor('2026-10-16', 'AAAA');
    expect(a).toHaveLength(3);
    expect(new Set(a.map((q) => q.kind)).size).toBe(3);
    expect(questsFor('2026-10-16', 'AAAA')).toEqual(a);
    const others = ['B', 'C', 'D', 'E'].map((id) => questsFor('2026-10-16', id).map((q) => q.id).join());
    expect(new Set([a.map((q) => q.id).join(), ...others]).size).toBeGreaterThan(1);
  });

  it('progress from battles, complete once, and pay their XP', () => {
    const p: Progress = { ...emptyProgress(), quests: { day: '2026-10-16', list: [
      { id: 'win', kind: 'win', target: 2, xp: 60, text: 'Win 2 battles', progress: 0, done: false },
      { id: 'playType-electric', kind: 'playType', type: 'electric', target: 3, xp: 50, text: 'Play 3 electric-type cards', progress: 0, done: false },
      { id: 'crowns', kind: 'crowns', target: 4, xp: 50, text: 'Earn 4 crowns', progress: 0, done: false },
    ] } };
    const one = applyBattle(p, win({ played: { pikachu: 2, rattata: 3 }, crowns: 1 }), DAY, 'P');
    expect(one.quests).toEqual([]);
    expect(one.progress.quests.list.map((q) => q.progress)).toEqual([1, 2, 1]);
    const two = applyBattle(one.progress, win({ played: { voltorb: 1 }, crowns: 3 }), DAY, 'P');
    expect(two.quests.map((q) => q.id).sort()).toEqual(['crowns', 'playType-electric', 'win']);
    expect(two.rewards.filter((r) => r.text.startsWith('Quest')).reduce((s, r) => s + r.xp, 0)).toBe(160);
    const three = applyBattle(two.progress, win({ crowns: 3 }), DAY, 'P');
    expect(three.quests).toEqual([]);
  });

  it('roll over to a new day', () => {
    const p = applyBattle(emptyProgress(), win(), DAY, 'P').progress;
    const next = applyBattle(p, win(), DAY + 86_400_000, 'P').progress;
    expect(next.quests.day).toBe('2026-10-17');
    expect(next.quests.list).toEqual(questsFor('2026-10-17', 'P').map((q) => next.quests.list.find((x) => x.id === q.id)!));
  });
});

describe('daily rewards', () => {
  it('first win of the day pays once; play-day streaks grow and reset', () => {
    const a = applyBattle(emptyProgress(), win(), DAY, 'P');
    expect(a.rewards.find((r) => r.text === 'First win of the day')?.xp).toBe(FIRST_WIN_XP);
    expect(a.progress.streak).toEqual({ day: '2026-10-16', count: 1, best: 1 });
    const b = applyBattle(a.progress, win(), DAY + 3600_000, 'P');
    expect(b.rewards.find((r) => r.text === 'First win of the day')).toBeUndefined();
    const c = applyBattle(b.progress, win({ outcome: 'loss' }), DAY + 86_400_000, 'P');
    expect(c.progress.streak.count).toBe(2);
    expect(c.rewards.map((r) => r.text)).toContain('2-day streak');
    const d = applyBattle(c.progress, win(), DAY + 4 * 86_400_000, 'P');
    expect(d.progress.streak).toEqual({ day: '2026-10-20', count: 1, best: 2 });
  });

  it('Daily Challenge: the first attempt pays, then only a new best', () => {
    const a = applyBattle(emptyProgress(), win({ dailyScore: 2000 }), DAY, 'P');
    expect(a.dailyBest).toEqual({ score: 2000, improved: true });
    const b = applyBattle(a.progress, win({ dailyScore: 1500 }), DAY, 'P');
    expect(b.dailyBest).toEqual({ score: 2000, improved: false });
    expect(b.progress.daily.attempts).toBe(2);
    const c = applyBattle(b.progress, win({ dailyScore: 2600 }), DAY, 'P');
    expect(c.rewards.map((r) => r.text)).toContain('New daily best');
  });

  it('level-ups and unlocks are reported', () => {
    const near = { ...emptyProgress(), xp: xpToNext(1) + xpToNext(2) - 1 };
    const r = applyBattle(near, win(), DAY, 'P');
    expect(r.levelBefore).toBe(2);
    expect(r.levelAfter).toBe(3);
    // Exactly level 3's batch; level 2's was already owned.
    expect(r.unlocked.sort()).toEqual(['mrmime', 'rapidash']);
  });

  it('puzzles pay once', () => {
    const a = applyPuzzle(emptyProgress(), 'air-raid');
    expect(a.xp).toBeGreaterThan(0);
    expect(applyPuzzle(a.progress, 'air-raid').xp).toBe(0);
  });
});

describe('parseProgress', () => {
  it('fills in missing fields and drops junk', () => {
    expect(parseProgress(null)).toEqual(emptyProgress());
    const p = parseProgress({ xp: 50, legacy: true, stars: { brock: 7, nope: 2 }, puzzles: ['a', 3] });
    expect(p).toMatchObject({ xp: 50, legacy: true, stars: { brock: 3 }, puzzles: ['a'] });
    expect(p.quests).toEqual({ day: '', list: [] });
  });
});
