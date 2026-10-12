import { Kit, finishRig, type Rig } from '../kit.js';
import { clamp01, faintPose, squashStretch, strideAmount } from '../motion.js';

const ORANGE = 0xe8582c;
const BELLY = 0xf4e3c0;
const FIN = 0xf3d27a;

/** Magikarp: an upright, flopping fish. Moves by hopping; Splash is a big pointless jump. */
export function buildMagikarp(): Rig {
  const k = new Kit();
  const body = k.joint(k.root);
  const fish = k.joint(body, [0, 0.45, 0]);
  // Body stands on its tail, facing +Z.
  k.sphere(fish, 0.3, ORANGE, [0, 0, 0], [0.75, 1.2, 0.95]);
  k.sphere(fish, 0.24, BELLY, [0, -0.06, 0.1], [0.65, 1, 0.7]);
  // Scale arcs on the flanks.
  for (const y of [0.12, -0.04, -0.2]) for (const sx of [1, -1]) k.torus(fish, 0.07, 0.012, 0xc4441c, [sx * 0.2, y, -0.02], [0, sx * 1.2, 0], Math.PI);
  // Crown-like dorsal fin.
  for (let i = 0; i < 5; i++) {
    const z = -0.2 + i * 0.09;
    k.cone(fish, 0.05, 0.16 + (i % 2) * 0.05, FIN, [0, 0.34 - Math.abs(z) * 0.4, z - 0.02], [-0.35 + i * 0.12, 0, 0], [0.4, 1, 1]);
  }
  for (const sx of [1, -1]) {
    k.eye(fish, [sx * 0.15, 0.18, 0.2], 0.06, { sclera: true, iris: 0xd9c070, yaw: sx * 0.7, tall: 1 });
    // Whiskers droop from the lips.
    k.capsule(fish, 0.015, 0.3, FIN, [sx * 0.09, -0.04, 0.32], [0.5, 0, sx * 0.35]);
    const pectoral = k.joint(fish, [sx * 0.22, -0.05, 0.05], [0, 0, -sx * 0.6]);
    k.sphere(pectoral, 0.1, FIN, [sx * 0.06, 0, 0], [1, 0.25, 0.6]);
  }
  // Lips.
  k.sphere(fish, 0.08, 0xf1b2a0, [0, 0.04, 0.3], [1.2, 0.55, 0.6]);
  const tail = k.joint(fish, [0, -0.35, -0.05]);
  k.shape(tail, 'karp-tail', [[0, 0], [0.22, -0.2], [0.08, -0.16], [0, -0.26], [-0.08, -0.16], [-0.22, -0.2]], 0.04, FIN, [0, 0, 0], [0, Math.PI / 2, 0]);
  const muzzle = k.joint(fish, [0, 0.04, 0.34]);

  return finishRig(k, {
    height: 1.05,
    muzzle,
    attackStyle: 'splash',
    attackDuration: 0.7,
    animate(p) {
      const g = strideAmount(p);
      // Hop-flop: every stride is a little jump with a sideways wobble.
      const hop = Math.abs(Math.sin(p.walk * 0.9));
      body.position.set(0, hop * 0.28 * g, 0);
      fish.rotation.set(-0.15 * g, 0, Math.sin(p.walk * 0.9) * 0.35 * g + Math.sin(p.t * 7) * 0.06);
      tail.rotation.y = Math.sin(p.t * 9) * 0.4;
      // Splash: a big, useless jump.
      if (p.attack >= 0) {
        const a = clamp01(p.attack);
        body.position.y += Math.sin(a * Math.PI) * 0.9;
        fish.rotation.z += Math.sin(a * Math.PI * 4) * 0.4;
      }
      // Evolution: it stretches tall as the glow builds.
      squashStretch(body, p, p.special * 0.25);
      faintPose(k.root, body, p);
    },
  });
}
