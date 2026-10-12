import { Kit, finishRig, type Rig } from '../kit.js';
import { bipedWalk, breath, faintPose, squashStretch, strikeCurve } from '../motion.js';

const GREY = 0x9db0c2;
const DARK = 0x71849a;
const CREST = 0x9c7a62;
const LIP = 0xe6dccb;

/** Machop: compact brawler with oversized forearms and a three-ridged crest. */
export function buildMachop(): Rig {
  const k = new Kit();
  const body = k.joint(k.root);
  const legL = k.joint(body, [0.14, 0.38, 0]);
  const legR = k.joint(body, [-0.14, 0.38, 0]);
  for (const leg of [legL, legR]) {
    k.capsule(leg, 0.09, 0.18, GREY, [0, -0.17, 0]);
    k.sphere(leg, 0.1, DARK, [0, -0.36, 0.05], [1, 0.5, 1.4]);
  }
  const torso = k.joint(body, [0, 0.62, 0]);
  k.sphere(torso, 0.29, GREY, [0, 0, 0], [1.1, 1.12, 0.82]);
  // Pecs and abs.
  for (const sx of [1, -1]) k.sphere(torso, 0.12, GREY, [sx * 0.1, 0.1, 0.17], [1.1, 0.7, 0.55]);
  for (const y of [-0.04, -0.13]) k.box(torso, [0.16, 0.012, 0.02], DARK, [0, y, 0.235]);
  k.box(torso, [0.62, 0.09, 0.5], 0x4a5566, [0, -0.22, 0], [0, 0, 0]); // trunks band

  const arms = ([1, -1] as const).map((sx) => {
    const shoulder = k.joint(torso, [sx * 0.31, 0.14, 0], [0, 0, -sx * 0.25]);
    k.sphere(shoulder, 0.1, GREY, [0, 0, 0]);
    k.capsule(shoulder, 0.075, 0.14, GREY, [0, -0.14, 0]);
    const elbow = k.joint(shoulder, [0, -0.26, 0]);
    k.capsule(elbow, 0.1, 0.12, GREY, [0, -0.1, 0]);
    k.sphere(elbow, 0.115, DARK, [0, -0.26, 0.01]);
    return { shoulder, elbow };
  });
  const [armL, armR] = arms as [typeof arms[0], typeof arms[0]];

  const head = k.joint(body, [0, 0.97, 0.02]);
  k.sphere(head, 0.23, GREY, [0, 0.08, 0], [1, 1.05, 1]);
  // Three ridges side by side across the crown, the middle one tallest.
  for (const [x, h, tilt] of [[0.09, 0.15, -0.35], [0, 0.2, 0], [-0.09, 0.15, 0.35]] as const) {
    k.cone(head, 0.065, h, CREST, [x, 0.3 + h * 0.3, 0.02], [-0.15, 0, tilt], [0.55, 1, 1.5]);
  }
  for (const sx of [1, -1]) {
    k.eye(head, [sx * 0.09, 0.11, 0.2], 0.04, { sclera: true, iris: 0xd53b2f, yaw: sx * 0.35, tall: 1.1 });
    k.box(head, [0.1, 0.022, 0.02], 0x2a2f38, [sx * 0.09, 0.18, 0.21], [0, 0, sx * 0.3]);
  }
  k.sphere(head, 0.07, LIP, [0, -0.02, 0.2], [1.3, 0.55, 0.6]);
  const muzzle = k.joint(armR.elbow, [0, -0.3, 0.05]);

  return finishRig(k, {
    height: 1.4,
    muzzle,
    attackStyle: 'punch',
    attackDuration: 0.45,
    animate(p) {
      body.position.set(0, 0, 0);
      body.rotation.set(0, 0, 0);
      bipedWalk({ body, legL, legR, armL: armL.shoulder, armR: armR.shoulder, head }, p, { legSwing: 0.65, armSwing: 0.5, bob: 0.05 });
      torso.scale.y = 1 + breath(p, 2);
      // Guard stance: forearms up.
      armL.elbow.rotation.x = -0.9;
      armR.elbow.rotation.x = -0.9;
      const s = strikeCurve(p.attack);
      if (p.attack >= 0) {
        // Right straight: chamber back, then drive the fist forward while the torso twists.
        armR.shoulder.rotation.x = -0.4 - Math.max(0, s) * 1.25 + Math.min(0, s) * -0.9;
        armR.elbow.rotation.x = -0.9 + Math.max(0, s) * 0.85;
        torso.rotation.y = -s * 0.35;
        body.position.z = Math.max(0, s) * 0.12;
      } else {
        torso.rotation.y = 0;
      }
      squashStretch(body, p);
      faintPose(k.root, body, p);
    },
  });
}
