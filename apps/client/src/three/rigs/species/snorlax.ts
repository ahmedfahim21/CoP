import { Kit, finishRig, type Rig } from '../kit.js';
import { breath, clamp01, faintPose, squashStretch, strikeCurve, strideAmount } from '../motion.js';

const TEAL = 0x2f6f80;
const CREAM = 0xf1e3c4;
const CLAW = 0xfbf7ee;

/** Snorlax: an enormous slow waddle, belly-first, that body-slams buildings. */
export function buildSnorlax(): Rig {
  const k = new Kit();
  const body = k.joint(k.root);
  const feet = ([1, -1] as const).map((sx) => {
    const foot = k.joint(body, [sx * 0.38, 0.12, 0.2]);
    k.sphere(foot, 0.27, CREAM, [0, 0, 0], [1, 0.48, 1.3]);
    for (const dx of [-0.1, 0, 0.1]) k.cone(foot, 0.035, 0.08, CLAW, [dx, 0.06, 0.32], [Math.PI / 2.4, 0, 0]);
    return foot;
  });
  const [footL, footR] = feet as [typeof feet[0], typeof feet[0]];
  const trunk = k.joint(body, [0, 0.95, 0]);
  k.sphere(trunk, 0.82, TEAL, [0, 0, 0], [1.02, 1.04, 0.86]);
  k.sphere(trunk, 0.68, CREAM, [0, -0.05, 0.22], [1, 1.02, 0.62]);

  const arms = ([1, -1] as const).map((sx) => {
    const arm = k.joint(trunk, [sx * 0.78, 0.3, 0.08], [0, 0, -sx * 0.5]);
    k.capsule(arm, 0.19, 0.28, TEAL, [0, -0.25, 0]);
    for (const dz of [-0.07, 0, 0.07]) k.cone(arm, 0.03, 0.08, CLAW, [0, -0.6, dz + 0.04], [Math.PI, 0, 0]);
    return arm;
  });
  const [armL, armR] = arms as [typeof arms[0], typeof arms[0]];

  const head = k.joint(trunk, [0, 0.82, 0.06]);
  k.sphere(head, 0.48, TEAL, [0, 0.05, 0], [1.1, 0.82, 0.95]);
  k.sphere(head, 0.4, CREAM, [0, 0, 0.18], [1.02, 0.75, 0.55]);
  for (const sx of [1, -1]) {
    k.cone(head, 0.13, 0.22, TEAL, [sx * 0.36, 0.38, -0.02], [0, 0, -sx * 0.35]);
    // Contented closed eyes.
    k.capsule(head, 0.015, 0.12, 0x2a2a2a, [sx * 0.15, 0.1, 0.4], [0, 0, Math.PI / 2 + sx * 0.12]);
  }
  k.capsule(head, 0.018, 0.26, 0x5a2a2a, [0, -0.08, 0.4], [0, 0, Math.PI / 2]);
  k.cone(head, 0.025, 0.06, CLAW, [0.07, -0.05, 0.41]);
  k.cone(head, 0.025, 0.06, CLAW, [-0.07, -0.05, 0.41]);
  const muzzle = k.joint(trunk, [0, -0.3, 0.8]);

  return finishRig(k, {
    height: 2.6,
    muzzle,
    attackStyle: 'slam',
    attackDuration: 0.75,
    animate(p) {
      const g = strideAmount(p);
      // Waddle: the whole body rolls side to side and the planted foot carries it.
      body.position.set(0, Math.abs(Math.sin(p.walk * 0.7)) * 0.07 * g, 0);
      body.rotation.set(0, 0, Math.sin(p.walk * 0.7) * 0.11 * g);
      footL.position.z = 0.2 + Math.sin(p.walk * 0.7) * 0.18 * g;
      footR.position.z = 0.2 - Math.sin(p.walk * 0.7) * 0.18 * g;
      footL.position.y = 0.12 + Math.max(0, Math.sin(p.walk * 0.7)) * 0.08 * g;
      footR.position.y = 0.12 + Math.max(0, -Math.sin(p.walk * 0.7)) * 0.08 * g;
      trunk.scale.set(1 - breath(p, 1.2, 0.03), 1 + breath(p, 1.2, 0.03), 1);
      head.rotation.z = Math.sin(p.t * 0.9) * 0.05;
      // Body slam: rise up on its toes with arms overhead, then crash down.
      const s = strikeCurve(p.attack);
      const up = clamp01(-s / 0.55);
      const down = clamp01(s);
      armL.rotation.z = -0.5 - up * 2.2 + down * 1.6;
      armR.rotation.z = 0.5 + up * 2.2 - down * 1.6;
      body.position.y += up * 0.35;
      body.rotation.x = -up * 0.15 + down * 0.25;
      squashStretch(trunk, p, up * 0.12);
      faintPose(k.root, body, p);
    },
  });
}
