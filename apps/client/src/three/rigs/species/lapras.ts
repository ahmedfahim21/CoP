import { Kit, finishRig, type Rig } from '../kit.js';
import { breath, faintPose, squashStretch, strikeCurve, strideAmount } from '../motion.js';

const BLUE = 0x5aa7da;
const CREAM = 0xf3e7c6;
const SHELL = 0x8d92a3;
const KNOB = 0x6d7284;

/** Lapras: gliding on its belly, paddling flippers, long swaying neck and a knobbed shell. */
export function buildLapras(): Rig {
  const k = new Kit();
  const body = k.joint(k.root);
  const hull = k.joint(body, [0, 0.36, 0]);
  k.sphere(hull, 0.52, BLUE, [0, 0, 0], [1, 0.58, 1.22]);
  k.sphere(hull, 0.45, CREAM, [0, -0.08, 0.12], [0.95, 0.48, 1.1]);
  k.dome(hull, 0.5, SHELL, [0, 0.12, -0.1], [1, 0.75, 1.08], [0, 0, 0], { roughness: 0.75 });
  for (const [x, z] of [[0, 0.1], [0.22, -0.05], [-0.22, -0.05], [0.12, -0.32], [-0.12, -0.32], [0, -0.48]] as const) {
    k.cone(hull, 0.07, 0.17, KNOB, [x, 0.5 - Math.abs(z) * 0.3, z - 0.05], [0, 0, 0], [1, 1, 1], { roughness: 0.7 });
  }
  const flippers = ([[0.46, 0.32, 1], [-0.46, 0.32, -1], [0.4, -0.42, 1], [-0.4, -0.42, -1]] as const).map(([x, z, sx]) => {
    const f = k.joint(hull, [x, -0.1, z], [0, sx * 0.4, 0]);
    k.sphere(f, 0.22, BLUE, [sx * 0.14, 0, 0], [1.3, 0.22, 0.6]);
    return { f, sx };
  });

  const neck = k.joint(hull, [0, 0.2, 0.48], [-0.25, 0, 0]);
  k.capsule(neck, 0.13, 0.32, BLUE, [0, 0.22, 0]);
  k.capsule(neck, 0.1, 0.3, CREAM, [0, 0.2, 0.06], [0, 0, 0], [1, 1, 0.6]);
  const upper = k.joint(neck, [0, 0.42, 0], [0.2, 0, 0]);
  k.capsule(upper, 0.12, 0.22, BLUE, [0, 0.14, 0]);
  const head = k.joint(upper, [0, 0.34, 0.04], [0.1, 0, 0]);
  k.sphere(head, 0.2, BLUE, [0, 0, 0.05], [1, 0.88, 1.25]);
  k.cone(head, 0.04, 0.14, CREAM, [0, 0.2, 0.08], [-0.3, 0, 0]);
  for (const sx of [1, -1]) {
    k.cone(head, 0.05, 0.16, BLUE, [sx * 0.14, 0.14, -0.05], [-0.6, 0, -sx * 0.5]);
    k.eye(head, [sx * 0.11, 0.05, 0.19], 0.042, { yaw: sx * 0.6 });
  }
  k.box(head, [0.16, 0.012, 0.02], 0x2a3a4a, [0, -0.06, 0.28], [0, 0, 0]);
  const muzzle = k.joint(head, [0, -0.03, 0.3]);

  return finishRig(k, {
    height: 1.75,
    muzzle,
    attackStyle: 'cast',
    attackDuration: 0.6,
    animate(p) {
      const g = strideAmount(p);
      // Gliding: a rolling swell instead of steps.
      body.position.set(0, Math.sin(p.walk * 0.6) * 0.04 * g + breath(p, 1.4, 0.02), 0);
      body.rotation.set(Math.sin(p.walk * 0.6 + 1) * 0.04 * g, 0, Math.sin(p.walk * 0.3) * 0.05 * g);
      for (const { f, sx } of flippers) f.rotation.z = Math.sin(p.walk * 0.6 + (sx > 0 ? 0 : Math.PI)) * 0.45 * g + Math.sin(p.t * 1.5) * 0.05;
      // Neck sways; on attack it coils back and strikes forward.
      const s = strikeCurve(p.attack);
      neck.rotation.x = -0.25 + s * 0.45 + Math.sin(p.t * 1.1) * 0.05;
      neck.rotation.z = Math.sin(p.t * 0.8) * 0.06;
      upper.rotation.x = 0.2 + s * 0.2;
      head.rotation.x = 0.1 - s * 0.25;
      squashStretch(hull, p);
      faintPose(k.root, body, p);
    },
  });
}
