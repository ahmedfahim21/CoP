import { Kit, finishRig, type Rig } from '../kit.js';
import { clamp01, faintPose, squashStretch, strikeCurve } from '../motion.js';

const PURPLE = 0x8a6ab0;
const MARK = 0xf0e2c0;

/** Koffing: a bobbing ball of gas with craters and a skull-and-crossbones mark. */
export function buildKoffing(): Rig {
  const k = new Kit();
  const body = k.joint(k.root);
  const ball = k.joint(body, [0, 0.5, 0]);
  k.sphere(ball, 0.42, PURPLE, [0, 0, 0], [1, 0.97, 1], [0, 0, 0], { roughness: 0.55 });
  // Gas vents.
  for (const [x, y, z] of [[0.3, 0.25, 0.1], [-0.28, 0.28, 0.05], [0.05, 0.38, -0.15], [-0.25, -0.1, -0.3], [0.3, -0.2, -0.2]] as const) {
    k.cylinder(ball, 0.05, 0.07, 0.08, 0x6e5294, [x, y, z], [Math.atan2(z, y), 0, -Math.atan2(x, y)]);
  }
  // Skull-and-crossbones on the belly.
  k.sphere(ball, 0.07, MARK, [0, -0.17, 0.37], [1, 0.9, 0.4]);
  k.capsule(ball, 0.018, 0.16, MARK, [0, -0.24, 0.36], [0, 0, 0.8]);
  k.capsule(ball, 0.018, 0.16, MARK, [0, -0.24, 0.36], [0, 0, -0.8]);
  for (const sx of [1, -1]) k.eye(ball, [sx * 0.13, 0.12, 0.36], 0.05, { sclera: true, iris: 0x2a2a2a, yaw: sx * 0.35, tall: 1.2 });
  const mouth = k.joint(ball, [0, 0.0, 0.38]);
  k.sphere(mouth, 0.1, 0x3a1a3a, [0, 0, 0], [1.6, 0.5, 0.4]);
  k.cone(mouth, 0.02, 0.05, 0xfbf7ee, [0.07, 0.03, 0.03], [Math.PI, 0, 0]);
  k.cone(mouth, 0.02, 0.05, 0xfbf7ee, [-0.07, 0.03, 0.03], [Math.PI, 0, 0]);
  const muzzle = k.joint(ball, [0, -0.4, 0]);

  return finishRig(k, {
    height: 1,
    flyHeight: 1.3,
    muzzle,
    attackStyle: 'slam',
    attackDuration: 0.6,
    animate(p) {
      body.position.set(0, Math.sin(p.t * 1.8) * 0.12, 0);
      ball.rotation.set(Math.sin(p.t * 0.9) * 0.08, Math.sin(p.t * 0.6) * 0.2, Math.sin(p.t * 1.3) * 0.1);
      // Breathing in and out like a bellows.
      const puff = 1 + Math.sin(p.t * 2.2) * 0.04;
      ball.scale.set(puff, 1 / puff, puff);
      // Sludge: inflate, then dip and spit downward.
      const s = strikeCurve(p.attack);
      ball.scale.multiplyScalar(1 + Math.max(0, -s) * 0.15);
      body.position.y -= Math.max(0, s) * 0.35;
      mouth.scale.y = 1 + clamp01(s) * 1.4;
      squashStretch(body, p);
      faintPose(k.root, body, p);
      if (p.faint >= 0) body.position.y -= Math.min(1, p.faint * 1.6) * 1.2;
    },
  });
}
