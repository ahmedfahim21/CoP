import { describe, expect, it } from 'vitest';
import { STAGES } from './campaign.js';
import { ARENAS } from './ranking.js';

describe('League arenas', () => {
  it('fights each gym in its own city and the Elite Four and Champion on the Indigo Plateau', () => {
    for (const s of STAGES) {
      const arena = ARENAS[s.arena - 1];
      expect(arena, s.id).toBeDefined();
      if (s.title.endsWith('Gym')) expect(arena!.name.split(' ')[0], s.id).toBe(s.title.split(' ')[0]);
      else expect(arena!.name, s.id).toBe('Indigo Plateau');
    }
  });
});
