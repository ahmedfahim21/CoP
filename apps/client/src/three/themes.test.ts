import { describe, expect, it } from 'vitest';
import { ARENAS } from '@cop/shared';
import { DESIGNED, THEMES, themeForArena, themeForTrophies, tierOf } from './themes.js';

describe('arena themes', () => {
  it('gives every ladder arena its own look, in ladder order', () => {
    expect(DESIGNED.map((t) => t.arena)).toEqual(ARENAS.map((a) => a.index));
    expect(new Set(DESIGNED.map((t) => t.id)).size).toBe(ARENAS.length);
    for (const a of ARENAS) expect(tierOf(themeForArena(a.index))).toEqual(a);
  });

  it('makes each arena look different from the others', () => {
    // No two arenas share a sky, a floor or the scenery beyond the walls.
    const skies = DESIGNED.map((t) => t.sky);
    expect(new Set(skies).size).toBe(DESIGNED.length);
    const floors = DESIGNED.map((t) => `${t.turf.pattern}:${t.turf.colors.join(',')}`);
    expect(new Set(floors).size).toBe(DESIGNED.length);
    expect(new Set(DESIGNED.map((t) => t.beyond)).size).toBe(DESIGNED.length);
  });

  it('picks the arena a battle is fought in from trophies', () => {
    expect(themeForTrophies(0)).toBe(THEMES.pallet);
    expect(themeForTrophies(ARENAS[1]!.minTrophies - 1)).toBe(THEMES.pallet);
    expect(themeForTrophies(ARENAS[1]!.minTrophies)).toBe(THEMES.viridian);
    expect(themeForTrophies(ARENAS[2]!.minTrophies)).toBe(THEMES.pewter);
    expect(themeForTrophies(99999)).toBe(THEMES.indigo);
  });
});
