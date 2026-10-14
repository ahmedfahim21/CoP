import { describe, expect, it } from 'vitest';
import { CARDS, CARD_IDS } from './cards.js';
import { ATTACKING_TYPES, DEFENDING_TYPES, cardInfo, rolesOf, traitsOf } from './cardInfo.js';

describe('card info', () => {
  it('describes every card, including every ability, without throwing', () => {
    for (const id of CARD_IDS) {
      const info = cardInfo(id);
      expect(info.roles.length).toBeGreaterThan(0);
      if (CARDS[id].stats.ability) expect(info.traits.length).toBeGreaterThan(0);
      expect(info.towers).toHaveLength(3);
    }
  });

  it('lists type matchups by type, with the in-game multipliers', () => {
    const pikachu = cardInfo('pikachu');
    // Thunderbolt: super effective on Water and Flying, the types that exist in the game.
    expect(pikachu.strongAgainst).toEqual([{ type: 'water', multiplier: 1.5 }, { type: 'flying', multiplier: 1.5 }]);
    // Electric is only weak to Ground; it resists Electric, Flying and Steel moves.
    expect(pikachu.weakAgainst).toEqual([{ type: 'ground', multiplier: 1.5 }]);
    expect(pikachu.resists.map((m) => m.type)).toEqual(['electric', 'flying', 'steel'].filter((t) => (ATTACKING_TYPES as readonly string[]).includes(t)));
    // Double weaknesses come first: Rock on Articuno (Ice/Flying) is 4× raw, ×2 in game.
    expect(cardInfo('articuno').weakAgainst[0]).toEqual({ type: 'rock', multiplier: 2 });
    // Immunities count as resists: Normal moves can't touch Gengar (Ghost).
    expect(cardInfo('gengar').resists).toContainEqual({ type: 'normal', multiplier: 0.5 });
  });

  it('only names types that exist in the game', () => {
    for (const id of CARD_IDS) {
      const info = cardInfo(id);
      for (const m of info.strongAgainst) expect(DEFENDING_TYPES).toContain(m.type);
      for (const m of [...info.weakAgainst, ...info.resists]) expect(ATTACKING_TYPES).toContain(m.type);
    }
    expect(DEFENDING_TYPES).not.toContain('dragon');
    expect(cardInfo('magikarp').strongAgainst).toEqual([]);
  });

  it('rates every starter tower both ways', () => {
    expect(cardInfo('charizard').towers).toEqual([
      { id: 'bulbasaur', dealt: 1.5, taken: 0.6 },
      { id: 'charmander', dealt: 0.75, taken: 0.75 },
      { id: 'squirtle', dealt: 0.75, taken: 1.5 },
    ]);
  });

  it('puts real numbers in the trait text', () => {
    expect(traitsOf('chansey')).toContain('Heals allies within 4 tiles for 95 HP every 2.5s.');
    expect(traitsOf('primeape')).toContain('Below 50% health it rages: 40% faster and attacks every 0.7s instead of 1.1s.');
    expect(traitsOf('moltres').join(' ')).toContain('×1 → ×3 → ×8 every 5 hits');
    expect(traitsOf('magikarp').join(' ')).toContain('Evolves into Gyarados after 7s');
    expect(traitsOf('koffing').join(' ')).toContain('Poison cloud when it faints: 70 damage per second');
  });

  it('assigns roles from stats', () => {
    expect(rolesOf('snorlax')).toContain('win-condition');
    expect(rolesOf('rattata')).toEqual(expect.arrayContaining(['swarm', 'melee']));
    expect(rolesOf('magneton')).toContain('defense');
    expect(rolesOf('chansey')).toContain('support');
    expect(rolesOf('articuno')).toEqual(expect.arrayContaining(['air', 'ranged', 'splash']));
  });
});
