import { describe, expect, it } from 'vitest';
import { ARENA_H, ARENA_W, isValidDeploy, mirror } from './arena.js';
import { effectivenessLabel, rawEffectiveness, typeMultiplier } from './types.js';

describe('type effectiveness', () => {
  it.each([
    ['fire', ['grass'], 2, 1.5, 'super'],
    ['water', ['fire'], 2, 1.5, 'super'],
    ['ice', ['grass', 'flying'], 4, 2, 'super'],
    ['fire', ['water', 'rock'], 0.25, 0.6, 'weak'],
    ['grass', ['fire'], 0.5, 0.75, 'weak'],
    ['electric', ['ground'], 0, 0.5, 'immune'],
    ['normal', [], 1, 1, 'neutral'],
    ['water', ['fire', 'flying'], 2, 1.5, 'super'],
  ] as const)('%s vs %o: raw %s → ×%s (%s)', (atk, def, raw, tuned, label) => {
    expect(rawEffectiveness(atk, def)).toBe(raw);
    expect(typeMultiplier(atk, def)).toBe(tuned);
    expect(effectivenessLabel(atk, def)).toBe(label);
  });
});

describe('arena', () => {
  it('mirror is a 180° rotation for team 1 and identity for team 0', () => {
    const p = { x: 3.25, y: 20.5 };
    expect(mirror(0, p)).toEqual(p);
    expect(mirror(1, p)).toEqual({ x: ARENA_W - 3.25, y: ARENA_H - 20.5 });
    expect(mirror(1, mirror(1, p))).toEqual(p);
  });

  it('deploy zone is the own half, plus open pockets', () => {
    expect(isValidDeploy({ x: 9, y: 17 }, new Set())).toBe(true);
    expect(isValidDeploy({ x: 9, y: 16.9 }, new Set())).toBe(false);
    expect(isValidDeploy({ x: 0.2, y: 20 }, new Set())).toBe(false);
    expect(isValidDeploy({ x: 4, y: 10 }, new Set(['left']))).toBe(true);
    expect(isValidDeploy({ x: 4, y: 9.9 }, new Set(['left']))).toBe(false);
    expect(isValidDeploy({ x: 14, y: 12 }, new Set(['left']))).toBe(false);
  });
});
