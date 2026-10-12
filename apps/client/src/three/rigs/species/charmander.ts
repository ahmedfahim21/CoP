import { Kit, finishRig, type Rig } from '../kit.js';
import { bipedWalk, breath, faintPose, squashStretch, strikeCurve } from '../motion.js';

const ORANGE = 0xf2894a;
const CREAM = 0xf7d58f;

/** Charmander: upright lizard with a big head and a flame on its tail tip. */
export function buildCharmander(): Rig {
  const k = new Kit();
  const body = k.joint(k.root);
  const legL = k.joint(body, [0.12, 0.25, 0]);
  const legR = k.joint(body, [-0.12, 0.25, 0]);
  for (const leg of [legL, legR]) {
    k.capsule(leg, 0.075, 0.1, ORANGE, [0, -0.1, 0]);
    k.sphere(leg, 0.08, ORANGE, [0, -0.21, 0.05], [1, 0.55, 1.5]);
  }
  const torso = k.joint(body, [0, 0.47, 0]);
  k.sphere(torso, 0.24, ORANGE, [0, 0, 0], [1, 1.2, 0.88]);
  k.sphere(torso, 0.18, CREAM, [0, -0.04, 0.09], [0.95, 1.1, 0.7]);
  const arms = ([1, -1] as const).map((sx) => {
    const arm = k.joint(torso, [sx * 0.2, 0.1, 0.06], [0.5, 0, -sx * 0.45]);
    k.capsule(arm, 0.05, 0.12, ORANGE, [0, -0.09, 0]);
    return arm;
  });
  const [armL, armR] = arms as [typeof arms[0], typeof arms[0]];
  const head = k.joint(body, [0, 0.8, 0.04]);
  k.sphere(head, 0.25, ORANGE, [0, 0.08, 0], [1, 0.95, 1.05]);
  k.sphere(head, 0.12, ORANGE, [0, 0.05, 0.14], [1.05, 0.75, 0.8]);
  for (const sx of [1, -1]) {
    k.eye(head, [sx * 0.1, 0.14, 0.2], 0.05, { sclera: true, iris: 0x2f6fbf, yaw: sx * 0.4, tall: 1.2 });
    k.sphere(head, 0.01, 0x3a2216, [sx * 0.04, 0.06, 0.29]);
  }
  const jaw = k.joint(head, [0, -0.02, 0.12]);
  k.sphere(jaw, 0.075, ORANGE, [0, -0.01, 0.05], [1.1, 0.4, 0.8]);
  k.capsule(head, 0.01, 0.12, 0x6a2a1a, [0, -0.01, 0.27], [0, 0, Math.PI / 2]);

  const tail1 = k.joint(body, [0, 0.33, -0.18], [-1.6, 0, 0]);
  k.capsule(tail1, 0.075, 0.18, ORANGE, [0, 0.12, 0]);
  const tail2 = k.joint(tail1, [0, 0.26, 0], [1.0, 0, 0]);
  k.capsule(tail2, 0.055, 0.12, ORANGE, [0, 0.09, 0]);
  const flame = k.joint(tail2, [0, 0.22, 0], [0.6, 0, 0]);
  const outer = k.ownMat(0xff8c1a, { emissive: 0xff6a00, emissiveIntensity: 0.9, roughness: 1 });
  const inner = k.ownMat(0xffe07a, { emissive: 0xffc030, emissiveIntensity: 1.1, roughness: 1 });
  k.cone(flame, 0.08, 0.24, outer, [0, 0.1, 0]).castShadow = false;
  k.cone(flame, 0.045, 0.16, inner, [0, 0.07, 0.015]).castShadow = false;
  const muzzle = k.joint(head, [0, 0.0, 0.32]);

  return finishRig(k, {
    height: 1.2,
    muzzle,
    attackStyle: 'breath',
    attackDuration: 0.55,
    animate(p) {
      body.position.set(0, 0, 0);
      body.rotation.set(0, 0, 0);
      bipedWalk({ body, legL, legR, armL, armR, head }, p, { legSwing: 0.75, bob: 0.06 });
      torso.scale.y = 1 + breath(p);
      tail1.rotation.z = Math.sin(p.t * 2.4) * 0.2;
      const flick = 1 + Math.sin(p.t * 21) * 0.13 + Math.sin(p.t * 33) * 0.08;
      flame.scale.set(1 / flick, flick, 1 / flick);
      const s = strikeCurve(p.attack);
      body.rotation.x += s * 0.22;
      head.rotation.x = -s * 0.25;
      jaw.rotation.x = Math.max(0, s) * 0.45;
      squashStretch(body, p);
      faintPose(k.root, body, p);
    },
  });
}
