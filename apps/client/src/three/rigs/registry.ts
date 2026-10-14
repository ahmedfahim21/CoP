import type { Rig } from './pose.js';
import { modelRig } from './models.js';

export { RIG_NAMES, type RigName } from './names.js';

export function buildRig(name: string): Rig {
  return modelRig(name);
}
