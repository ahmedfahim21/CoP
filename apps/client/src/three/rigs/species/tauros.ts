import * as THREE from 'three';
import { Kit, finishRig, type Rig } from '../kit.js';
import { faintPose, gallop, squashStretch, strikeCurve } from '../motion.js';

const HIDE = 0xb5835a;
const MANE = 0x6b4a2e;
const HORN = 0xefe2c4;
const HOOF = 0x3e3a36;

/** Tauros: a stocky bull with a shaggy mane and three whipping tails; lowers its horns to charge. */
export function buildTauros(): Rig {
  const k = new Kit();
  const body = k.joint(k.root);
  const torso = k.joint(body, [0, 0.62, 0]);
  k.sphere(torso, 0.34, HIDE, [0, 0, -0.05], [0.95, 0.85, 1.4]);
  // Shaggy mane over the shoulders.
  for (const [x, y, z] of [[0, 0.18, 0.25], [0.2, 0.05, 0.28], [-0.2, 0.05, 0.28], [0, -0.05, 0.36]] as const) {
    k.sphere(torso, 0.22, MANE, [x, y, z], [1, 0.85, 0.8], [0, 0, 0], { roughness: 1 });
  }
  const legs = ([[0.18, 0.3], [-0.18, 0.3], [0.18, -0.36], [-0.18, -0.36]] as const).map(([x, z]) => {
    const leg = k.joint(body, [x, 0.48, z]);
    k.capsule(leg, 0.075, 0.24, HIDE, [0, -0.2, 0]);
    k.cylinder(leg, 0.07, 0.08, 0.08, HOOF, [0, -0.44, 0]);
    return leg;
  });
  const [legFL, legFR, legBL, legBR] = legs as [typeof legs[0], typeof legs[0], typeof legs[0], typeof legs[0]];
  const head = k.joint(torso, [0, 0.05, 0.5]);
  k.sphere(head, 0.2, HIDE, [0, 0, 0.05], [0.95, 0.85, 1.1]);
  k.sphere(head, 0.12, 0xd7a982, [0, -0.07, 0.2], [1.1, 0.75, 0.8]);
  for (const sx of [1, -1]) {
    // Horns sweep out and forward.
    const horn = k.joint(head, [sx * 0.15, 0.12, 0], [0, 0, -sx * 1.1]);
    k.cone(horn, 0.05, 0.36, HORN, [0, 0.16, 0], [0.5, 0, 0]);
    k.eye(head, [sx * 0.11, 0.06, 0.16], 0.035, { sclera: true, iris: 0x3a2216, yaw: sx * 0.6, tall: 0.8 });
    k.box(head, [0.1, 0.025, 0.03], 0x3a2216, [sx * 0.11, 0.12, 0.17], [0, 0, sx * 0.5]);
  }
  const tails: THREE.Group[] = [];
  for (const sx of [-1, 0, 1]) {
    const t = k.joint(torso, [sx * 0.07, 0.12, -0.5], [-0.4, 0, sx * 0.25]);
    k.capsule(t, 0.02, 0.36, MANE, [0, -0.2, -0.05], [-0.4, 0, 0]);
    k.sphere(t, 0.05, MANE, [0, -0.42, -0.15]);
    tails.push(t);
  }
  const muzzle = k.joint(head, [0, 0.05, 0.35]);

  return finishRig(k, {
    height: 1.35,
    muzzle,
    attackStyle: 'kick',
    attackDuration: 0.5,
    animate(p) {
      body.position.set(0, 0, 0);
      body.rotation.set(0, 0, 0);
      gallop({ body, legFL, legFR, legBL, legBR }, p, { swing: p.charging ? 1 : 0.7, bob: p.charging ? 0.12 : 0.06 });
      tails.forEach((t, i) => (t.rotation.z = (i - 1) * 0.25 + Math.sin(p.t * 6 + i * 1.3) * (p.charging ? 0.5 : 0.25)));
      // Charging: head down, horns forward.
      head.rotation.x = p.charging ? 0.55 : 0.05 + Math.sin(p.t * 1.2) * 0.05;
      // Take Down: drive the horns through the target.
      const s = strikeCurve(p.attack);
      head.rotation.x += s * 0.5;
      body.position.z = Math.max(0, s) * 0.25;
      squashStretch(body, p);
      faintPose(k.root, body, p);
    },
  });
}
