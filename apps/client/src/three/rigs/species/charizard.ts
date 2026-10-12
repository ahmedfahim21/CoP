import { Kit, finishRig, type Rig } from '../kit.js';
import { faintPose, flap, squashStretch, strikeCurve } from '../motion.js';

const ORANGE = 0xf0803c;
const CREAM = 0xf8d796;
const WING_IN = 0x2f7fa0;

const WING: Array<[number, number]> = [[0, 0], [0.2, 0.3], [0.55, 0.55], [0.95, 0.62], [0.85, 0.42], [0.92, 0.22], [0.7, 0.2], [0.72, 0.02], [0.5, 0.06], [0.42, -0.12], [0.2, -0.04]];

/** Charizard: big-winged flier with a burning tail tip, breathing fire on attack. */
export function buildCharizard(): Rig {
  const k = new Kit();
  const body = k.joint(k.root);
  const torso = k.joint(body, [0, 0.62, 0], [0.25, 0, 0]);
  k.sphere(torso, 0.34, ORANGE, [0, 0, 0], [0.95, 1.25, 0.85]);
  k.sphere(torso, 0.27, CREAM, [0, -0.04, 0.12], [0.9, 1.1, 0.7]);
  for (const sx of [1, -1]) {
    // Legs dangle in flight.
    const thigh = k.joint(torso, [sx * 0.2, -0.32, 0.02]);
    k.sphere(thigh, 0.13, ORANGE, [0, 0, 0], [0.9, 1.2, 1]);
    k.capsule(thigh, 0.07, 0.14, ORANGE, [0, -0.18, 0.04]);
    k.sphere(thigh, 0.08, ORANGE, [0, -0.32, 0.1], [1, 0.6, 1.4]);
    for (const dx of [-0.04, 0.04]) k.cone(thigh, 0.02, 0.06, 0xfbf7ee, [dx, -0.33, 0.21], [Math.PI / 2, 0, 0]);
    // Small arms.
    const arm = k.joint(torso, [sx * 0.27, 0.12, 0.12], [0.6, 0, -sx * 0.3]);
    k.capsule(arm, 0.055, 0.14, ORANGE, [0, -0.1, 0]);
  }
  const neck = k.joint(torso, [0, 0.38, 0.05], [-0.35, 0, 0]);
  k.capsule(neck, 0.11, 0.18, ORANGE, [0, 0.1, 0]);
  const head = k.joint(neck, [0, 0.28, 0.02], [0.1, 0, 0]);
  k.sphere(head, 0.2, ORANGE, [0, 0, 0], [0.95, 0.9, 1.1]);
  const jaw = k.joint(head, [0, -0.07, 0.08]);
  k.sphere(jaw, 0.13, ORANGE, [0, 0, 0.15], [0.85, 0.55, 1.2]);
  k.sphere(head, 0.12, ORANGE, [0, 0.03, 0.22], [0.9, 0.7, 1.1]);
  for (const sx of [1, -1]) {
    k.cone(head, 0.045, 0.24, CREAM, [sx * 0.1, 0.17, -0.12], [-1.1, 0, -sx * 0.3]);
    k.eye(head, [sx * 0.1, 0.07, 0.15], 0.04, { sclera: true, iris: 0x3d7fb5, yaw: sx * 0.5, tall: 1.1 });
    k.sphere(head, 0.012, 0x3a2216, [sx * 0.04, 0.05, 0.33]);
  }

  const wings = ([1, -1] as const).map((sx) => {
    const w = k.joint(torso, [sx * 0.15, 0.22, -0.2], [0, 0, 0]);
    const outer = k.shape(w, 'zard-wing', WING, 0.025, ORANGE, [0, 0, 0], [-Math.PI / 2 + 0.25, sx > 0 ? 0 : Math.PI, 0]);
    outer.scale.set(1.15, 1.15, 1);
    const inner = k.shape(w, 'zard-wing', WING, 0.025, WING_IN, [0, -0.025, 0], [-Math.PI / 2 + 0.25, sx > 0 ? 0 : Math.PI, 0]);
    inner.scale.set(1.05, 1.05, 1);
    return { w, sx };
  });

  // Tail curls back and up to the flame.
  const tail1 = k.joint(torso, [0, -0.3, -0.22], [-1.1, 0, 0]);
  k.capsule(tail1, 0.1, 0.22, ORANGE, [0, 0.16, 0]);
  const tail2 = k.joint(tail1, [0, 0.34, 0], [-0.6, 0, 0]);
  k.capsule(tail2, 0.07, 0.2, ORANGE, [0, 0.14, 0]);
  const flame = k.joint(tail2, [0, 0.32, 0]);
  const flameOuter = k.ownMat(0xff7a1a, { emissive: 0xff5a00, emissiveIntensity: 1.6, roughness: 1 });
  const flameInner = k.ownMat(0xffe27a, { emissive: 0xffd040, emissiveIntensity: 2, roughness: 1 });
  const f1 = k.cone(flame, 0.11, 0.3, flameOuter, [0, 0.12, 0]);
  const f2 = k.cone(flame, 0.06, 0.2, flameInner, [0, 0.08, 0.02]);
  f1.castShadow = false;
  f2.castShadow = false;
  const muzzle = k.joint(head, [0, -0.02, 0.36]);

  return finishRig(k, {
    height: 1.9,
    flyHeight: 1.0,
    muzzle,
    attackStyle: 'breath',
    attackDuration: 0.7,
    animate(p) {
      const f = flap(p.t, 1.6);
      for (const { w, sx } of wings) {
        w.rotation.z = sx * f * 0.55;
        w.rotation.y = -sx * 0.25;
      }
      body.position.set(0, -f * 0.12, 0);
      body.rotation.set(0.12 * Math.min(1, p.speed), 0, 0);
      tail1.rotation.x = -1.1 + Math.sin(p.t * 1.6) * 0.12;
      tail1.rotation.z = Math.sin(p.t * 1.1) * 0.15;
      const flick = 1 + Math.sin(p.t * 23) * 0.12 + Math.sin(p.t * 37) * 0.08;
      flame.scale.set(1 / flick, flick, 1 / flick);
      // Breath: rear the head back, then lunge with the jaw open.
      const s = strikeCurve(p.attack);
      neck.rotation.x = -0.35 + s * 0.5;
      head.rotation.x = 0.1 + s * 0.15;
      jaw.rotation.x = Math.max(0, s) * 0.5;
      squashStretch(torso, p);
      faintPose(k.root, body, p);
      if (p.faint >= 0) body.position.y -= Math.min(1, p.faint * 1.6) * 1.0;
    },
  });
}
