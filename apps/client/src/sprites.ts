import { CARDS, STARTERS, type CardId, type StarterId } from '@cop/shared';
import { SERVER_URL } from './config.js';

const POKEAPI = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites';

export type Facing = 'front' | 'back';

export const pokemonSpriteUrl = (dex: number, facing: Facing) =>
  facing === 'front' ? `${POKEAPI}/pokemon/${dex}.png` : `${POKEAPI}/pokemon/back/${dex}.png`;

export const POKE_BALL_URL = `${POKEAPI}/items/poke-ball.png`;
export const trainerSpriteUrl = (name: 'red' | 'blue') => `${SERVER_URL}/sprites/trainer/${name}`;

/** Phaser texture keys. */
export const pokemonKey = (dex: number, facing: Facing) => `pkmn-${dex}-${facing}`;
export const trainerKey = (name: 'red' | 'blue') => `trainer-${name}`;
export const POKE_BALL_KEY = 'poke-ball';

export function dexOf(defId: string): number {
  if (defId in CARDS) return CARDS[defId as CardId].dex;
  if (defId in STARTERS) return STARTERS[defId as StarterId].dex!;
  throw new Error(`No sprite for ${defId}`);
}

export function allPokemonDex(): number[] {
  return [...Object.values(CARDS).map((c) => c.dex), ...Object.values(STARTERS).map((s) => s.dex!)];
}
