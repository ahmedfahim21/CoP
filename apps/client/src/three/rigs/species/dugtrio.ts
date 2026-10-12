import * as THREE from 'three';
import { Kit, finishRig, type Rig } from '../kit.js';
import { faintPose, squashStretch, strikeCurve, strideAmount } from '../motion.js';

const BROWN = 0x8a5a3a;
const NOSE = 0xe58fa0;
const DIRT = 0x6b4a2a;

/** Dugtrio: three heads poking out of one mound. The mound travels; the heads bob in turn. */
export function buildDugtrio(): Rig {
  const k = new Kit();
  const body = k.joint(k.root);
  k.sphere(body, 0.5, DIRT, [0, 0.02, 0], [1.1, 0.32, 1.1], [0, 0, 0], { roughness: 1 });
  for (const [x, z] of [[0.38, 0.25], [-0.42, 0.1], [0.1, -0.45], [-0.25, -0.35], [0.45, -0.2]] as const) {
    k.sphere(body, 0.1, 0x5a3c22, [x, 0.06, z], [1, 0.6, 1], [0, 0, 0], { roughness: 1 });
  }
  const heads: THREE.Group[] = [];
  for (const [x, z, h] of [[0, 0.12, 0.62], [0.24, -0.1, 0.48], [-0.24, -0.1, 0.5]] as const) {
    const head = k.joint(body, [x, 0, z]);
    k.capsule(head, 0.16, h - 0.2, BROWN, [0, h / 2, 0], [0, 0, 0], [1, 1, 0.95]);
    k.sphere(head, 0.075, NOSE, [0, h - 0.12, 0.15], [1.25, 0.9, 0.8]);
    for (const sx of [1, -1]) k.sphere(head, 0.025, 0x1c1c22, [sx * 0.06, h - 0.02, 0.13], [0.8, 1.6, 0.5]);
    heads.push(head);
  }
  const muzzle = k.joint(heads[0]!, [0, 0.5, 0.18]);

  return finishRig(k, {
    height: 0.95,
    muzzle,
    attackStyle: 'bite',
    attackDuration: 0.4,
    animate(p) {
      const g = strideAmount(p);
      body.position.set(0, 0, 0);
      body.rotation.set(0, 0, Math.sin(p.walk * 1.4) * 0.04 * g);
      heads.forEach((h, i) => {
        h.position.y = Math.max(0, Math.sin(p.t * 3 + i * 2.1)) * 0.08 + Math.abs(Math.sin(p.walk + i)) * 0.06 * g;
        h.rotation.z = Math.sin(p.t * 1.6 + i) * 0.08;
      });
      // Attack: the heads hammer down in sequence.
      const s = strikeCurve(p.attack);
      heads.forEach((h, i) => (h.rotation.x = Math.max(0, strikeCurve(p.attack < 0 ? -1 : Math.max(0, p.attack - i * 0.08))) * 0.6 + Math.min(0, s) * 0.2));
      squashStretch(body, p);
      faintPose(k.root, body, p);
    },
  });
}
