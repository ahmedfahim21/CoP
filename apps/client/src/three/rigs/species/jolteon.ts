import { Kit, finishRig, type Rig } from '../kit.js';
import { breath, clamp01, faintPose, gallop, squashStretch, strikeCurve } from '../motion.js';

const YELLOW = 0xf8d23a;
const COLLAR = 0xf8f4e8;

/** Jolteon: a spiky electric fox whose fur bristles before every Thunder Shock. */
export function buildJolteon(): Rig {
  const k = new Kit();
  const body = k.joint(k.root);
  const torso = k.joint(body, [0, 0.42, 0]);
  k.sphere(torso, 0.24, YELLOW, [0, 0, 0], [0.9, 0.85, 1.35]);
  // Spiky coat along the back and flanks.
  const spikes = k.joint(torso);
  for (let i = 0; i < 9; i++) {
    const z = -0.28 + (i % 3) * 0.18;
    const side = Math.floor(i / 3) - 1;
    k.cone(spikes, 0.06, 0.2, YELLOW, [side * 0.14, 0.17 - Math.abs(side) * 0.05, z], [-1.2, 0, side * 0.6]);
  }
  const legs = ([[0.12, 0.2], [-0.12, 0.2], [0.12, -0.22], [-0.12, -0.22]] as const).map(([x, z]) => {
    const leg = k.joint(body, [x, 0.34, z]);
    k.capsule(leg, 0.05, 0.2, YELLOW, [0, -0.16, 0]);
    k.sphere(leg, 0.055, COLLAR, [0, -0.32, 0.03], [1, 0.5, 1.3]);
    return leg;
  });
  const [legFL, legFR, legBL, legBR] = legs as [typeof legs[0], typeof legs[0], typeof legs[0], typeof legs[0]];
  const head = k.joint(body, [0, 0.66, 0.3]);
  // White spiky collar ruff.
  const collar = k.joint(head, [0, -0.12, -0.08]);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    k.cone(collar, 0.06, 0.2, COLLAR, [Math.cos(a) * 0.14, Math.sin(a) * 0.1, -0.03], [0, 0, a - Math.PI / 2]);
  }
  k.sphere(head, 0.17, YELLOW, [0, 0, 0.03], [1, 0.9, 1.1]);
  k.sphere(head, 0.08, YELLOW, [0, -0.04, 0.17], [0.9, 0.7, 1.1]);
  k.sphere(head, 0.02, 0x2a2a2a, [0, -0.02, 0.26]);
  for (const sx of [1, -1]) {
    k.cone(head, 0.07, 0.32, YELLOW, [sx * 0.11, 0.2, -0.02], [0, 0, -sx * 0.3], [0.7, 1, 0.5]);
    k.eye(head, [sx * 0.08, 0.05, 0.14], 0.04, { sclera: true, iris: 0x3a2a1a, yaw: sx * 0.5, tall: 1 });
  }
  const tail = k.joint(body, [0, 0.48, -0.32], [-0.6, 0, 0]);
  for (let i = 0; i < 3; i++) k.cone(tail, 0.07, 0.22, YELLOW, [(i - 1) * 0.06, 0.1, 0], [0, 0, (i - 1) * 0.4]);
  const muzzle = k.joint(head, [0, 0, 0.25]);

  return finishRig(k, {
    height: 1.05,
    muzzle,
    attackStyle: 'cast',
    attackDuration: 0.45,
    animate(p) {
      body.position.set(0, 0, 0);
      body.rotation.set(0, 0, 0);
      gallop({ body, legFL, legFR, legBL, legBR, head }, p, { swing: 0.75, bob: 0.06 });
      torso.scale.y = 1 + breath(p, 3);
      tail.rotation.y = Math.sin(p.t * 3) * 0.3;
      // Thunder Shock: the coat bristles, then the head snaps forward.
      const charge = p.attack < 0 ? 0 : clamp01(1 - Math.abs(p.attack - 0.25) / 0.3);
      spikes.scale.setScalar(1 + charge * 0.35 + (charge > 0 ? Math.sin(p.t * 50) * 0.04 : 0));
      collar.scale.setScalar(1 + charge * 0.25);
      const s = strikeCurve(p.attack);
      head.rotation.x = -s * 0.25;
      squashStretch(body, p);
      faintPose(k.root, body, p);
    },
  });
}
