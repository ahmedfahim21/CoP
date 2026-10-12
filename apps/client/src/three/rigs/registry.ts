import type { Rig } from './kit.js';
import { buildBulbasaur } from './species/bulbasaur.js';
import { buildCharizard } from './species/charizard.js';
import { buildCharmander } from './species/charmander.js';
import { buildLapras } from './species/lapras.js';
import { buildMachop } from './species/machop.js';
import { buildPikachu } from './species/pikachu.js';
import { buildRattata } from './species/rattata.js';
import { buildSnorlax } from './species/snorlax.js';
import { buildSquirtle } from './species/squirtle.js';
import { buildTrainer } from './species/trainer.js';
import { buildVoltorb } from './species/voltorb.js';
import { buildZubat } from './species/zubat.js';

/** Every model by the defId the simulation uses (card ids, starter ids), plus both trainers. */
export const RIG_BUILDERS = {
  rattata: buildRattata,
  zubat: buildZubat,
  voltorb: buildVoltorb,
  pikachu: buildPikachu,
  machop: buildMachop,
  lapras: buildLapras,
  charizard: buildCharizard,
  snorlax: buildSnorlax,
  bulbasaur: buildBulbasaur,
  charmander: buildCharmander,
  squirtle: buildSquirtle,
  red: () => buildTrainer('red'),
  blue: () => buildTrainer('blue'),
} satisfies Record<string, () => Rig>;

export type RigName = keyof typeof RIG_BUILDERS;

export function buildRig(name: string): Rig {
  const make = (RIG_BUILDERS as Record<string, (() => Rig) | undefined>)[name];
  if (!make) throw new Error(`No rig for "${name}"`);
  return make();
}
