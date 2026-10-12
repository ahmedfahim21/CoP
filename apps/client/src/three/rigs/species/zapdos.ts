import { Kit, finishRig, type Rig } from '../kit.js';
import { clamp01, faintPose, flap, squashStretch, strikeCurve } from '../motion.js';

const YELLOW = 0xf5d23a;
const BLACK = 0x2a2a2a;
const BEAK = 0xe88a2a;

/** Jagged, lightning-shaped wing. */
const WING: Array<[number, number]> = [[0, 0.05], [0.3, 0.22], [0.5, 0.14], [0.68, 0.34], [0.86, 0.2], [1.12, 0.36], [1.0, 0.1], [1.1, 0.02], [0.8, 0.0], [0.86, -0.12], [0.6, -0.04], [0.55, -0.16], [0.35, -0.05], [0.25, -0.16], [0.1, -0.06]];

/** Zapdos: a spiky thunderbird with jagged wings that crackle when it calls down Thunder. */
export function buildZapdos(): Rig {
  const k = new Kit();
  const body = k.joint(k.root);
  const torso = k.joint(body, [0, 0.4, 0], [0.3, 0, 0]);
  k.sphere(torso, 0.27, YELLOW, [0, 0, 0], [0.85, 1.05, 1.3]);
  for (let i = 0; i < 5; i++) k.cone(torso, 0.06, 0.2, YELLOW, [(i - 2) * 0.07, -0.1, 0.25], [1.4, 0, (i - 2) * 0.2]);
  const neck = k.joint(torso, [0, 0.22, 0.25], [-0.55, 0, 0]);
  k.capsule(neck, 0.085, 0.2, YELLOW, [0, 0.13, 0]);
  const head = k.joint(neck, [0, 0.32, 0.02], [0.45, 0, 0]);
  k.sphere(head, 0.14, YELLOW, [0, 0, 0.03], [0.9, 0.9, 1.15]);
  k.cone(head, 0.055, 0.22, BEAK, [0, -0.02, 0.24], [Math.PI / 2, 0, 0]);
  for (const sx of [1, -1]) {
    k.eye(head, [sx * 0.08, 0.04, 0.12], 0.035, { sclera: true, iris: 0x2a2a2a, yaw: sx * 0.7, tall: 0.7 });
    k.box(head, [0.1, 0.025, 0.02], BLACK, [sx * 0.08, 0.1, 0.13], [0, 0, sx * 0.5]);
  }
  // Spiky crest.
  for (let i = 0; i < 5; i++) k.cone(head, 0.035, 0.24, YELLOW, [(i - 2) * 0.03, 0.12, -0.04 - i * 0.02], [-0.9 - i * 0.15, 0, (i - 2) * 0.25]);
  const sparkMat = k.ownMat(YELLOW, { emissive: 0xfff27a, emissiveIntensity: 0 });
  const wings = ([1, -1] as const).map((sx) => {
    const w = k.joint(torso, [sx * 0.15, 0.12, 0]);
    k.shape(w, 'zapdos-wing', WING, 0.03, sparkMat, [0, 0, 0], [-Math.PI / 2 + 0.15, sx > 0 ? 0 : Math.PI, 0]).scale.set(1.15, 1.15, 1);
    // Black tips on the trailing edge.
    k.shape(w, 'zapdos-wing', WING, 0.03, BLACK, [0, -0.03, 0], [-Math.PI / 2 + 0.15, sx > 0 ? 0 : Math.PI, 0]).scale.set(1.2, 0.45, 1);
    return { w, sx };
  });
  // Spiky tail fan.
  const tail = k.joint(torso, [0, -0.08, -0.33], [1.9, 0, 0]);
  for (let i = 0; i < 5; i++) k.cone(tail, 0.05, 0.36, i % 2 ? BLACK : YELLOW, [(i - 2) * 0.06, 0.16, 0], [0, 0, (i - 2) * 0.3]);
  const muzzle = k.joint(head, [0, -0.02, 0.32]);

  return finishRig(k, {
    height: 1.45,
    flyHeight: 1.75,
    muzzle,
    attackStyle: 'cast',
    attackDuration: 0.55,
    animate(p) {
      const f = flap(p.t, 1.4);
      for (const { w, sx } of wings) w.rotation.z = sx * f * 0.6;
      body.position.set(0, -f * 0.12 + Math.sin(p.t * 1.1) * 0.05, 0);
      body.rotation.set(0.1 * Math.min(1, p.speed), 0, 0);
      tail.rotation.y = Math.sin(p.t * 2) * 0.15;
      // Thunder: wings flare wide and crackle.
      const s = strikeCurve(p.attack);
      const flare = p.attack < 0 ? 0 : clamp01(1 - Math.abs(p.attack - 0.3) / 0.4);
      for (const { w, sx } of wings) w.rotation.z += sx * flare * 0.5;
      sparkMat.emissiveIntensity = flare * 1.6 + (flare > 0 && Math.sin(p.t * 60) > 0 ? 0.6 : 0);
      neck.rotation.x = -0.55 + s * 0.35;
      squashStretch(torso, p);
      faintPose(k.root, body, p);
      if (p.faint >= 0) body.position.y -= Math.min(1, p.faint * 1.6) * 1.75;
    },
  });
}
