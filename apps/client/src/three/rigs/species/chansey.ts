import { Kit, finishRig, type Rig } from '../kit.js';
import { bipedWalk, breath, clamp01, faintPose, squashStretch, strikeCurve } from '../motion.js';

const PINK = 0xf5b5c5;
const PINK_DARK = 0xe591a8;
const EGG = 0xfbf6ec;

/** Chansey: an egg-shaped nurse carrying an egg in its pouch; raises it high to heal. */
export function buildChansey(): Rig {
  const k = new Kit();
  const body = k.joint(k.root);
  const legL = k.joint(body, [0.15, 0.16, 0.02]);
  const legR = k.joint(body, [-0.15, 0.16, 0.02]);
  for (const leg of [legL, legR]) k.sphere(leg, 0.1, PINK, [0, -0.06, 0.04], [1, 0.6, 1.3]);
  const trunk = k.joint(body, [0, 0.56, 0]);
  k.sphere(trunk, 0.42, PINK, [0, 0, 0], [0.95, 1.12, 0.9]);
  // Pouch and egg.
  k.sphere(trunk, 0.22, 0xfbe2e8, [0, -0.18, 0.28], [1.1, 0.6, 0.45]);
  const egg = k.joint(trunk, [0, -0.08, 0.33]);
  const eggMat = k.ownMat(EGG, { roughness: 0.35, emissive: 0xffd6e8, emissiveIntensity: 0 });
  k.sphere(egg, 0.1, eggMat, [0, 0, 0], [0.85, 1.1, 0.85]);
  for (const sx of [1, -1]) {
    k.eye(trunk, [sx * 0.13, 0.22, 0.33], 0.035, { yaw: sx * 0.35, tall: 1.4 });
    k.sphere(trunk, 0.04, 0xf08aa6, [sx * 0.22, 0.12, 0.3], [1, 0.6, 0.4]);
    // Three tufts on each side of the head.
    for (const [dy, len] of [[0.36, 0.2], [0.24, 0.24], [0.12, 0.18]] as const) {
      k.cone(trunk, 0.05, len, PINK_DARK, [sx * 0.38, dy, -0.02], [0, 0, -sx * (1.3 + dy)]);
    }
  }
  k.capsule(trunk, 0.012, 0.08, 0xb45a6e, [0, 0.13, 0.4], [0, 0, Math.PI / 2]);
  const arms = ([1, -1] as const).map((sx) => {
    const arm = k.joint(trunk, [sx * 0.34, 0.0, 0.12], [0, 0, -sx * 0.5]);
    k.capsule(arm, 0.06, 0.1, PINK, [0, -0.09, 0]);
    return arm;
  });
  const [armL, armR] = arms as [typeof arms[0], typeof arms[0]];
  const muzzle = k.joint(trunk, [0, 0.1, 0.42]);

  return finishRig(k, {
    height: 1.25,
    muzzle,
    attackStyle: 'punch',
    attackDuration: 0.45,
    animate(p) {
      body.position.set(0, 0, 0);
      body.rotation.set(0, 0, 0);
      bipedWalk({ body, legL, legR, armL, armR }, p, { legSwing: 0.5, armSwing: 0.3, bob: 0.06 });
      trunk.scale.y = 1 + breath(p, 2.2, 0.03);
      // Soft-Boiled: both arms up, the egg lifted and glowing, a happy hop.
      const heal = clamp01(p.special);
      armL.rotation.z = -0.5 - heal * 2.1;
      armR.rotation.z = 0.5 + heal * 2.1;
      egg.position.y = -0.08 + heal * 0.62;
      egg.position.z = 0.33 - heal * 0.25;
      eggMat.emissiveIntensity = heal * 1.4;
      body.position.y += Math.sin(heal * Math.PI) * 0.15;
      // Pound: a two-handed shove.
      const s = strikeCurve(p.attack);
      armL.rotation.x = -Math.max(0, s) * 1.1;
      armR.rotation.x = -Math.max(0, s) * 1.1;
      squashStretch(body, p, heal * 0.08);
      faintPose(k.root, body, p);
    },
  });
}
