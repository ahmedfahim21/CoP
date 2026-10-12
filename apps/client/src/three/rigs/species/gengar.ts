import { Kit, finishRig, type Rig } from '../kit.js';
import { bipedWalk, breath, faintPose, squashStretch, strikeCurve } from '../motion.js';

const PURPLE = 0x6a4aa8;
const DARK = 0x4a3080;

/** Gengar: round, spiky and grinning; lunges out of the shadows with a Shadow Punch. */
export function buildGengar(): Rig {
  const k = new Kit();
  const body = k.joint(k.root);
  const legL = k.joint(body, [0.17, 0.22, 0]);
  const legR = k.joint(body, [-0.17, 0.22, 0]);
  for (const leg of [legL, legR]) {
    k.capsule(leg, 0.08, 0.06, PURPLE, [0, -0.08, 0]);
    k.sphere(leg, 0.09, PURPLE, [0, -0.17, 0.05], [1, 0.5, 1.4]);
  }
  const trunk = k.joint(body, [0, 0.62, 0]);
  k.sphere(trunk, 0.44, PURPLE, [0, 0, 0], [1.05, 0.95, 0.92]);
  // Spikes down the back.
  for (const [x, y, z] of [[0, 0.3, -0.32], [0.2, 0.18, -0.36], [-0.2, 0.18, -0.36], [0.28, -0.05, -0.33], [-0.28, -0.05, -0.33]] as const) {
    k.cone(trunk, 0.08, 0.22, PURPLE, [x, y, z], [-1.3, 0, x * 1.5]);
  }
  for (const sx of [1, -1]) {
    k.cone(trunk, 0.1, 0.3, PURPLE, [sx * 0.26, 0.42, -0.04], [0, 0, -sx * 0.45]);
    k.eye(trunk, [sx * 0.15, 0.17, 0.36], 0.07, { sclera: true, iris: 0xd8344a, yaw: sx * 0.35, tall: 0.75 });
    k.box(trunk, [0.14, 0.035, 0.03], DARK, [sx * 0.15, 0.27, 0.38], [0, 0, sx * 0.35]);
  }
  // The grin: a red mouth with a white band of teeth.
  k.sphere(trunk, 0.22, 0x9a2238, [0, -0.08, 0.3], [1.2, 0.35, 0.55]);
  k.box(trunk, [0.38, 0.05, 0.05], 0xf4f1f8, [0, -0.06, 0.38], [0.2, 0, 0]);
  const arms = ([1, -1] as const).map((sx) => {
    const arm = k.joint(trunk, [sx * 0.42, 0.02, 0.08], [0.3, 0, -sx * 0.6]);
    k.capsule(arm, 0.075, 0.12, PURPLE, [0, -0.1, 0]);
    for (const dz of [-0.04, 0, 0.04]) k.cone(arm, 0.02, 0.07, PURPLE, [dz, -0.26, 0.03], [Math.PI, 0, 0]);
    return arm;
  });
  const [armL, armR] = arms as [typeof arms[0], typeof arms[0]];
  const muzzle = k.joint(armR, [0, -0.3, 0.05]);

  return finishRig(k, {
    height: 1.35,
    muzzle,
    attackStyle: 'punch',
    attackDuration: 0.5,
    animate(p) {
      body.position.set(0, 0, 0);
      body.rotation.set(0, 0, 0);
      bipedWalk({ body, legL, legR, armL, armR }, p, { legSwing: 0.6, armSwing: 0.5, bob: 0.07 });
      // Sly sway.
      trunk.rotation.z = Math.sin(p.t * 1.8) * 0.06;
      trunk.scale.y = 1 + breath(p, 2);
      const s = strikeCurve(p.attack);
      if (p.attack >= 0) {
        armR.rotation.x = 0.3 - Math.max(0, s) * 1.6 + Math.min(0, s) * -0.8;
        armL.rotation.x = 0.3 + Math.max(0, s) * 0.6;
        trunk.rotation.y = -s * 0.4;
        body.position.z = Math.max(0, s) * 0.2;
      } else {
        trunk.rotation.y = 0;
      }
      squashStretch(body, p);
      faintPose(k.root, body, p);
    },
  });
}
