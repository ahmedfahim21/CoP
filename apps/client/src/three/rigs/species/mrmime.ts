import { Kit, finishRig, type Rig } from '../kit.js';
import { bipedWalk, breath, faintPose, squashStretch, strikeCurve } from '../motion.js';

const WHITE = 0xf3eef0;
const PINK = 0xf5a0b0;
const BLUE = 0x4a7ad8;
const RED = 0xd8344a;

/** Mr. Mime: pink and white with blue hair-horns and big gloves; mimes a wall when idle. */
export function buildMrMime(): Rig {
  const k = new Kit();
  const body = k.joint(k.root);
  const legL = k.joint(body, [0.13, 0.42, 0]);
  const legR = k.joint(body, [-0.13, 0.42, 0]);
  for (const leg of [legL, legR]) {
    k.capsule(leg, 0.05, 0.28, PINK, [0, -0.2, 0]);
    k.sphere(leg, 0.09, RED, [0, -0.4, 0.06], [1, 0.6, 1.5]);
  }
  const torso = k.joint(body, [0, 0.66, 0]);
  k.sphere(torso, 0.24, WHITE, [0, 0, 0], [1.05, 1.1, 0.9]);
  for (const [x, y] of [[0, 0.08], [0, -0.08]] as const) k.sphere(torso, 0.04, RED, [x, y, 0.21]);
  for (const sx of [1, -1]) k.sphere(torso, 0.09, PINK, [sx * 0.2, 0.15, 0], [1, 0.8, 0.8]);
  const head = k.joint(torso, [0, 0.36, 0.02]);
  k.sphere(head, 0.2, PINK, [0, 0, 0], [1, 0.95, 0.95]);
  for (const sx of [1, -1]) {
    k.sphere(head, 0.1, BLUE, [sx * 0.17, 0.16, -0.02], [0.8, 1.1, 0.8]);
    k.eye(head, [sx * 0.08, 0.04, 0.17], 0.035, { sclera: true, iris: 0x2a2a3a, yaw: sx * 0.4, tall: 1.1 });
    k.sphere(head, 0.035, 0xf27a8e, [sx * 0.13, -0.05, 0.15], [1, 0.6, 0.4]);
  }
  k.sphere(head, 0.035, 0xb04a5a, [0, -0.08, 0.18], [1.5, 0.6, 0.5]);
  const arms = ([1, -1] as const).map((sx) => {
    const arm = k.joint(torso, [sx * 0.26, 0.14, 0.02], [0, 0, -sx * 0.4]);
    k.capsule(arm, 0.04, 0.2, PINK, [0, -0.14, 0]);
    // Oversized white gloves.
    const hand = k.joint(arm, [0, -0.32, 0]);
    k.sphere(hand, 0.1, WHITE, [0, 0, 0.02], [1, 1.2, 0.5]);
    for (const dx of [-0.05, -0.017, 0.017, 0.05]) k.capsule(hand, 0.022, 0.06, WHITE, [dx, -0.1, 0.02]);
    return { arm, hand };
  });
  const [armL, armR] = arms as [typeof arms[0], typeof arms[0]];
  const muzzle = k.joint(armR.hand, [0, 0, 0.1]);

  return finishRig(k, {
    height: 1.35,
    muzzle,
    attackStyle: 'cast',
    attackDuration: 0.5,
    animate(p) {
      body.position.set(0, 0, 0);
      body.rotation.set(0, 0, 0);
      bipedWalk({ body, legL, legR, armL: armL.arm, armR: armR.arm, head }, p, { legSwing: 0.55, armSwing: 0.4, bob: 0.05 });
      torso.scale.y = 1 + breath(p);
      const still = 1 - Math.min(1, p.speed);
      // Idle: palms out, feeling along an invisible wall.
      const feel = Math.sin(p.t * 1.6);
      armL.arm.rotation.x += -1.3 * still;
      armR.arm.rotation.x += -1.3 * still;
      armL.hand.position.y = -0.32 + feel * 0.04 * still;
      armR.hand.position.y = -0.32 - feel * 0.04 * still;
      armL.hand.rotation.x = armR.hand.rotation.x = 1.3 * still;
      // Psybeam: both hands thrust forward.
      const s = strikeCurve(p.attack);
      armL.arm.rotation.x -= Math.max(0, s) * 1.2;
      armR.arm.rotation.x -= Math.max(0, s) * 1.2;
      squashStretch(body, p);
      faintPose(k.root, body, p);
    },
  });
}
