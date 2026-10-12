import { Kit, finishRig, type Rig } from '../kit.js';
import { breath, faintPose, quadWalk, squashStretch, strikeCurve } from '../motion.js';

const PURPLE = 0x9b6fc4;
const CREAM = 0xf1deb0;
const PINK = 0xe9a3bb;
const DARK = 0x3a2a44;

/** Rattata: low and quick, huge ears, buck teeth, whiskers and a curled tail. */
export function buildRattata(): Rig {
  const k = new Kit();
  const body = k.joint(k.root);
  const torso = k.joint(body, [0, 0.3, 0]);
  k.sphere(torso, 0.24, PURPLE, [0, 0, 0], [0.92, 0.82, 1.35]);
  k.sphere(torso, 0.19, CREAM, [0, -0.07, 0.1], [0.8, 0.62, 1.05]);

  const legs = ([[0.13, 0.17], [-0.13, 0.17], [0.14, -0.18], [-0.14, -0.18]] as const).map(([x, z]) => {
    const leg = k.joint(body, [x, 0.2, z]);
    k.capsule(leg, 0.048, 0.07, PURPLE, [0, -0.07, 0]);
    k.sphere(leg, 0.055, CREAM, [0, -0.15, 0.03], [1, 0.5, 1.45]);
    return leg;
  });
  const [legFL, legFR, legBL, legBR] = legs as [typeof legs[0], typeof legs[0], typeof legs[0], typeof legs[0]];

  const head = k.joint(body, [0, 0.42, 0.3]);
  k.sphere(head, 0.2, PURPLE, [0, 0, 0], [1, 0.92, 1.05]);
  k.sphere(head, 0.11, CREAM, [0, -0.06, 0.15], [1, 0.8, 1.1]);
  k.sphere(head, 0.032, PINK, [0, -0.02, 0.27]);
  k.box(head, [0.04, 0.085, 0.02], 0xfbf7ee, [0.022, -0.14, 0.22], [0.15, 0, 0]);
  k.box(head, [0.04, 0.085, 0.02], 0xfbf7ee, [-0.022, -0.14, 0.22], [0.15, 0, 0]);
  for (const sx of [1, -1]) {
    const ear = k.joint(head, [sx * 0.13, 0.15, -0.03], [0, 0, -sx * 0.55]);
    k.sphere(ear, 0.12, PURPLE, [0, 0.07, 0], [1, 1.15, 0.32]);
    k.sphere(ear, 0.085, PINK, [0, 0.07, 0.02], [1, 1.1, 0.3]);
    k.eye(head, [sx * 0.1, 0.04, 0.155], 0.045, { sclera: true, iris: 0xb02350, yaw: sx * 0.45 });
    for (const dy of [0, -0.035]) k.capsule(head, 0.006, 0.16, DARK, [sx * 0.14, -0.05 + dy, 0.18], [0, 0, sx * (1.35 + dy * 4)]);
  }
  const tail = k.joint(body, [0, 0.3, -0.31], [0.2, 0, 0]);
  k.torus(tail, 0.17, 0.028, PURPLE, [0, 0.15, -0.12], [0, Math.PI / 2, 0], Math.PI * 1.55);
  const muzzle = k.joint(head, [0, -0.05, 0.28]);

  return finishRig(k, {
    height: 0.85,
    muzzle,
    attackStyle: 'bite',
    attackDuration: 0.4,
    animate(p) {
      body.position.set(0, 0, 0);
      body.rotation.set(0, 0, 0);
      quadWalk({ body, legFL, legFR, legBL, legBR, head }, p, { swing: 0.8, bob: 0.05 });
      torso.scale.y = 1 + breath(p, 3.5);
      tail.rotation.y = Math.sin(p.t * 4 + p.walk) * 0.35;
      // Sniffing twitch while idle.
      head.rotation.y = Math.sin(p.t * 1.7) * 0.12 * (1 - Math.min(1, p.speed));
      const s = strikeCurve(p.attack);
      head.position.z = 0.3 + s * 0.16;
      head.rotation.x = s * 0.35;
      body.rotation.x += s * 0.1;
      squashStretch(body, p);
      faintPose(k.root, body, p);
    },
  });
}
