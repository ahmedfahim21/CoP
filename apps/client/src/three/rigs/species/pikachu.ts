import { Kit, finishRig, type Rig } from '../kit.js';
import { bipedWalk, breath, clamp01, faintPose, squashStretch, strikeCurve } from '../motion.js';

const YELLOW = 0xf8d030;
const BROWN = 0x9a5b2a;
const RED = 0xe8483b;
const BLACK = 0x26221f;

/** Pikachu: oversized head, long black-tipped ears, red cheeks that crackle when it attacks. */
export function buildPikachu(): Rig {
  const k = new Kit();
  const body = k.joint(k.root);

  const legL = k.joint(body, [0.13, 0.2, 0]);
  const legR = k.joint(body, [-0.13, 0.2, 0]);
  for (const leg of [legL, legR]) {
    k.capsule(leg, 0.075, 0.08, YELLOW, [0, -0.08, 0]);
    k.sphere(leg, 0.085, YELLOW, [0, -0.17, 0.05], [1, 0.55, 1.5]);
  }
  const torso = k.joint(body, [0, 0.42, 0]);
  k.sphere(torso, 0.26, YELLOW, [0, 0, 0], [1, 1.08, 0.9]);
  // Two brown stripes across the back.
  k.capsule(torso, 0.035, 0.24, BROWN, [0, 0.08, -0.255], [0, 0, Math.PI / 2], [1, 1, 0.6]);
  k.capsule(torso, 0.035, 0.2, BROWN, [0, -0.06, -0.265], [0, 0, Math.PI / 2], [1, 1, 0.6]);

  const armL = k.joint(torso, [0.21, 0.08, 0.1], [0, 0, -0.5]);
  const armR = k.joint(torso, [-0.21, 0.08, 0.1], [0, 0, 0.5]);
  for (const arm of [armL, armR]) k.capsule(arm, 0.055, 0.1, YELLOW, [0, -0.07, 0.04], [0.6, 0, 0]);

  const head = k.joint(body, [0, 0.7, 0.03]);
  k.sphere(head, 0.315, YELLOW, [0, 0.17, 0], [1.12, 0.96, 1]);
  const earL = k.joint(head, [0.17, 0.38, -0.03], [0, 0, -0.42]);
  const earR = k.joint(head, [-0.17, 0.38, -0.03], [0, 0, 0.42]);
  for (const ear of [earL, earR]) {
    k.cone(ear, 0.085, 0.46, YELLOW, [0, 0.23, 0], [0, 0, 0], [1, 1, 0.6]);
    k.cone(ear, 0.042, 0.15, BLACK, [0, 0.39, 0], [0, 0, 0], [1, 1, 0.6]);
  }
  k.eye(head, [0.12, 0.22, 0.25], 0.052, { yaw: 0.35 });
  k.eye(head, [-0.12, 0.22, 0.25], 0.052, { yaw: -0.35 });
  const cheekMat = k.ownMat(RED, { roughness: 0.4, emissive: 0xffe060, emissiveIntensity: 0 });
  k.sphere(head, 0.075, cheekMat, [0.22, 0.09, 0.19], [1, 1, 0.45], [0, 0.85, 0]);
  k.sphere(head, 0.075, cheekMat, [-0.22, 0.09, 0.19], [1, 1, 0.45], [0, -0.85, 0]);
  k.sphere(head, 0.016, BLACK, [0, 0.15, 0.32]);
  k.sphere(head, 0.035, 0x7a2b22, [0, 0.07, 0.3], [1.4, 0.6, 0.5]);

  // Lightning-bolt tail with a brown root.
  const tail = k.joint(body, [0, 0.32, -0.24], [-0.5, 0, 0]);
  k.box(tail, [0.07, 0.16, 0.05], BROWN, [0, 0.06, 0]);
  k.shape(tail, 'pika-tail', [[-0.04, 0.1], [0.12, 0.28], [0.03, 0.32], [0.2, 0.55], [-0.12, 0.42], [-0.02, 0.36], [-0.14, 0.18]], 0.05, YELLOW, [0, 0, 0], [0, Math.PI / 2, 0]);

  const muzzle = k.joint(head, [0, 0.15, 0.32]);

  return finishRig(k, {
    height: 1.25,
    muzzle,
    attackStyle: 'cast',
    attackDuration: 0.55,
    animate(p) {
      body.position.set(0, 0, 0);
      body.rotation.set(0, 0, 0);
      bipedWalk({ body, legL, legR, armL, armR, head }, p, { legSwing: 0.8, bob: 0.07 });
      torso.scale.y = 1 + breath(p);
      // Ears flick now and then, tail sways.
      const flick = Math.max(0, Math.sin(p.t * 1.3) - 0.92) * 6;
      earL.rotation.z = -0.42 - flick * 0.3 + Math.sin(p.t * 2) * 0.03;
      earR.rotation.z = 0.42 + Math.sin(p.t * 2.1 + 1) * 0.03;
      tail.rotation.z = Math.sin(p.t * 3.2) * 0.25;
      // Cast: rear back while the cheeks charge, then thrust the head forward.
      const s = strikeCurve(p.attack);
      body.rotation.x += s * 0.28;
      head.rotation.x = -s * 0.2;
      const charge = p.attack < 0 ? 0 : clamp01(1 - Math.abs(p.attack - 0.3) / 0.35);
      cheekMat.emissiveIntensity = charge * 2.2 + (Math.sin(p.t * 30) > 0.6 ? charge : 0);
      squashStretch(body, p);
      faintPose(k.root, body, p);
    },
  });
}
