/**
 * Every character, by the defId the simulation uses (card ids, evolved forms, starter ids)
 * plus both trainers. Models are built in Blender from tools/blender/species/*.py.
 */
export const RIG_NAMES = [
  'rattata', 'zubat', 'voltorb', 'pikachu', 'machop', 'lapras', 'charizard', 'snorlax',
  'magikarp', 'gyarados', 'geodude', 'dugtrio', 'gengar', 'chansey', 'scyther', 'jolteon',
  'rapidash', 'tauros', 'articuno', 'moltres', 'primeape', 'mrmime', 'magneton', 'starmie',
  'koffing', 'golem', 'hitmonlee', 'zapdos', 'exeggcute', 'jigglypuff', 'vileplume', 'cloyster', 'arcanine', 'dragonite',
  'bulbasaur', 'charmander', 'squirtle', 'red', 'blue',
] as const;

export type RigName = (typeof RIG_NAMES)[number];
