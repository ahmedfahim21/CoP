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
import { buildArticuno } from './species/articuno.js';
import { buildChansey } from './species/chansey.js';
import { buildDugtrio } from './species/dugtrio.js';
import { buildGengar } from './species/gengar.js';
import { buildGeodude } from './species/geodude.js';
import { buildGyarados } from './species/gyarados.js';
import { buildJolteon } from './species/jolteon.js';
import { buildMagikarp } from './species/magikarp.js';
import { buildMoltres } from './species/moltres.js';
import { buildRapidash } from './species/rapidash.js';
import { buildScyther } from './species/scyther.js';
import { buildTauros } from './species/tauros.js';

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
  magikarp: buildMagikarp,
  gyarados: buildGyarados,
  geodude: buildGeodude,
  dugtrio: buildDugtrio,
  gengar: buildGengar,
  chansey: buildChansey,
  scyther: buildScyther,
  jolteon: buildJolteon,
  rapidash: buildRapidash,
  tauros: buildTauros,
  articuno: buildArticuno,
  moltres: buildMoltres,
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
