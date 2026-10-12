import { Kit, finishRig, type Rig } from '../kit.js';
import { breath, clamp01, faintPose, squashStretch, strikeCurve } from '../motion.js';

const SKIN = 0xf2c9a0;
const JEANS = 0x3b4f8f;

export type TrainerLook = 'red' | 'blue';

/**
 * The king: Red (cap, red vest, backpack) for you, Blue (spiky hair, purple shirt) for your
 * rival. Dozes with arms crossed until the tower is hit, then throws Poké Balls.
 */
export function buildTrainer(look: TrainerLook): Rig {
  const k = new Kit();
  const red = look === 'red';
  const top = red ? 0xd63a35 : 0x6a4fb3;
  const sleeve = red ? 0xf3f1ea : 0x6a4fb3;
  const hair = red ? 0x2b2018 : 0x8a5a2b;
  const body = k.joint(k.root);
  const hips = k.joint(body, [0, 0.55, 0]);
  const legs = ([1, -1] as const).map((sx) => {
    const leg = k.joint(hips, [sx * 0.11, 0, 0]);
    k.capsule(leg, 0.09, 0.26, JEANS, [0, -0.23, 0]);
    k.box(leg, [0.17, 0.11, 0.27], red ? 0xd63a35 : 0x3a3a3a, [0, -0.5, 0.04]);
    return leg;
  });
  const [legL, legR] = legs as [typeof legs[0], typeof legs[0]];
  k.capsule(hips, 0.16, 0.06, JEANS, [0, 0.02, 0], [0, 0, Math.PI / 2]);

  const chest = k.joint(hips, [0, 0.1, 0]);
  k.capsule(chest, 0.18, 0.26, top, [0, 0.24, 0], [0, 0, 0], [1.1, 1, 0.8]);
  if (red) {
    k.box(chest, [0.3, 0.3, 0.02], 0xf3f1ea, [0, 0.26, 0.135]); // shirt under the open vest
    k.box(chest, [0.28, 0.32, 0.16], 0xf2c14e, [0, 0.28, -0.2]); // backpack
  } else {
    k.sphere(chest, 0.05, 0x2a2a2a, [0, 0.42, 0.14], [1, 0.6, 0.4]); // pendant
  }
  const arms = ([1, -1] as const).map((sx) => {
    const shoulder = k.joint(chest, [sx * 0.24, 0.42, 0], [0, 0, -sx * 0.12]);
    k.capsule(shoulder, 0.07, 0.16, sleeve, [0, -0.12, 0]);
    const elbow = k.joint(shoulder, [0, -0.28, 0]);
    k.capsule(elbow, 0.06, 0.14, SKIN, [0, -0.1, 0]);
    k.sphere(elbow, 0.065, SKIN, [0, -0.23, 0]);
    return { shoulder, elbow };
  });
  const [armL, armR] = arms as [typeof arms[0], typeof arms[0]];

  // Poké Ball in the throwing hand.
  const ball = k.joint(armR.elbow, [0, -0.26, 0.05]);
  k.dome(ball, 0.075, 0xe5483f, [0, 0, 0], [1, 1, 1], [0, 0, 0], { roughness: 0.3 });
  k.dome(ball, 0.075, 0xf3f1ea, [0, 0, 0], [1, 1, 1], [Math.PI, 0, 0], { roughness: 0.3 });

  const head = k.joint(chest, [0, 0.68, 0.01]);
  head.scale.setScalar(1.3);
  k.sphere(head, 0.2, SKIN, [0, 0.08, 0], [1, 1.05, 1]);
  for (const sx of [1, -1]) {
    k.sphere(head, 0.025, 0x1c1c22, [sx * 0.07, 0.1, 0.18], [1, 1.4, 0.5]);
    k.sphere(head, 0.04, SKIN, [sx * 0.2, 0.06, 0], [0.5, 1, 0.8]);
  }
  k.capsule(head, 0.008, 0.06, 0x8a4a3a, [0, -0.0, 0.19], [0, 0, Math.PI / 2]);
  if (red) {
    k.dome(head, 0.215, hair, [0, 0.1, -0.02], [1, 0.9, 1.05]);
    k.dome(head, 0.22, 0xd63a35, [0, 0.13, 0], [1, 0.8, 1.02]);
    k.box(head, [0.2, 0.12, 0.02], 0xf3f1ea, [0, 0.22, 0.18], [-0.35, 0, 0]);
    k.cylinder(head, 0.17, 0.17, 0.025, 0xd63a35, [0, 0.13, 0.17], [0.15, 0, 0]);
  } else {
    k.dome(head, 0.225, hair, [0, 0.1, -0.01], [1, 0.95, 1.05]);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      k.cone(head, 0.07, 0.2, hair, [Math.cos(a) * 0.13, 0.27, Math.sin(a) * 0.12 - 0.02], [Math.sin(a) * 0.7, 0, -Math.cos(a) * 0.7]);
    }
  }
  const muzzle = ball;

  return finishRig(k, {
    height: 1.9,
    muzzle,
    attackStyle: 'throw',
    attackDuration: 0.6,
    animate(p) {
      body.position.set(0, 0, 0);
      body.rotation.set(0, 0, 0);
      chest.scale.y = 1 + breath(p, 1.6, 0.02);
      legL.rotation.x = 0;
      legR.rotation.x = 0;
      if (p.dormant) {
        // Arms crossed, head nodding off.
        armL.shoulder.rotation.set(-0.9, 0, 0.6);
        armR.shoulder.rotation.set(-0.9, 0, -0.6);
        armL.elbow.rotation.set(-1.5, 0, 0);
        armR.elbow.rotation.set(-1.5, 0, 0);
        head.rotation.x = 0.25 + Math.sin(p.t * 0.9) * 0.08;
        ball.visible = false;
      } else {
        ball.visible = true;
        head.rotation.x = 0;
        armL.shoulder.rotation.set(0, 0, 0.15);
        armL.elbow.rotation.set(-0.3, 0, 0);
        const s = strikeCurve(p.attack);
        // Overhand throw: arm cocks back and up, then whips through.
        const cock = clamp01(-s / 0.55);
        const through = clamp01(s);
        armR.shoulder.rotation.set(-0.2 - cock * 2.4 + through * 1.3 - (p.attack < 0 ? 0 : 0), 0, -0.15);
        armR.elbow.rotation.set(-0.4 - cock * 0.9, 0, 0);
        chest.rotation.y = cock * 0.4 - through * 0.3;
        // The ball leaves the hand at release and reappears on the next wind-up.
        ball.visible = p.attack < 0 || p.attack < 0.36 || p.attack > 0.9;
        // Idle weight shift.
        body.rotation.z = Math.sin(p.t * 0.7) * 0.02;
      }
      squashStretch(body, p);
      faintPose(k.root, body, p);
    },
  });
}
