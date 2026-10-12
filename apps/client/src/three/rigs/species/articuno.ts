import * as THREE from 'three';
import { Kit, finishRig, type Rig } from '../kit.js';
import { faintPose, flap, squashStretch, strikeCurve } from '../motion.js';

const ICE = 0x7cc6f0;
const ICE_DARK = 0x4a8fc8;
const WHITE = 0xeaf6ff;
const BEAK = 0x8a8f98;

const WING: Array<[number, number]> = [[0, 0.06], [0.35, 0.18], [0.8, 0.22], [1.15, 0.12], [1.05, 0.02], [0.95, -0.06], [0.82, 0.0], [0.7, -0.1], [0.55, -0.02], [0.4, -0.12], [0.25, -0.04], [0.08, -0.1]];

/** Articuno: an elegant ice bird with long ribbon tail feathers; Freeze slows what it hits. */
export function buildArticuno(): Rig {
  const k = new Kit();
  const body = k.joint(k.root);
  const torso = k.joint(body, [0, 0.4, 0], [0.3, 0, 0]);
  k.sphere(torso, 0.28, ICE, [0, 0, 0], [0.85, 1.05, 1.3]);
  k.sphere(torso, 0.22, WHITE, [0, -0.05, 0.12], [0.8, 0.9, 1]);
  const neck = k.joint(torso, [0, 0.22, 0.25], [-0.6, 0, 0]);
  k.capsule(neck, 0.09, 0.22, ICE, [0, 0.14, 0]);
  const head = k.joint(neck, [0, 0.34, 0.02], [0.5, 0, 0]);
  k.sphere(head, 0.15, ICE, [0, 0, 0.03], [0.9, 0.9, 1.15]);
  k.cone(head, 0.05, 0.14, BEAK, [0, -0.02, 0.2], [Math.PI / 2, 0, 0]);
  for (const sx of [1, -1]) k.eye(head, [sx * 0.08, 0.03, 0.11], 0.035, { sclera: true, iris: 0x8a2a3a, yaw: sx * 0.7, tall: 0.75 });
  // Crest plume.
  for (let i = 0; i < 3; i++) k.cone(head, 0.04, 0.3 - i * 0.05, ICE_DARK, [0, 0.12 + i * 0.03, -0.06 - i * 0.06], [-1.1 - i * 0.2, 0, 0]);
  const wings = ([1, -1] as const).map((sx) => {
    const w = k.joint(torso, [sx * 0.16, 0.12, 0]);
    const outer = k.shape(w, 'articuno-wing', WING, 0.03, ICE, [0, 0, 0], [-Math.PI / 2 + 0.15, sx > 0 ? 0 : Math.PI, 0]);
    outer.scale.set(1.1, 1.1, 1);
    const tips = k.shape(w, 'articuno-wing', WING, 0.03, WHITE, [0, -0.03, 0], [-Math.PI / 2 + 0.15, sx > 0 ? 0 : Math.PI, 0]);
    tips.scale.set(1.15, 0.6, 1);
    return { w, sx };
  });
  // Ribbon tail: three long chained streamers that ripple behind.
  const ribbons: THREE.Group[][] = [];
  for (const sx of [-1, 0, 1]) {
    const chain: THREE.Group[] = [];
    let parent: THREE.Object3D = torso;
    let pos: [number, number, number] = [sx * 0.08, -0.08, -0.35];
    for (let i = 0; i < 5; i++) {
      const seg = k.joint(parent, pos, [i === 0 ? 1.3 : 0, sx * 0.15, 0]);
      k.box(seg, [0.09 - i * 0.008, 0.26, 0.02], i % 2 ? ICE_DARK : ICE, [0, 0.13, 0]);
      chain.push(seg);
      parent = seg;
      pos = [0, 0.26, 0];
    }
    ribbons.push(chain);
  }
  const muzzle = k.joint(head, [0, -0.02, 0.28]);

  return finishRig(k, {
    height: 1.4,
    flyHeight: 1.7,
    muzzle,
    attackStyle: 'cast',
    attackDuration: 0.6,
    animate(p) {
      // Slow, majestic flaps with a glide at the top.
      const f = flap(p.t, 0.9);
      for (const { w, sx } of wings) w.rotation.z = sx * f * 0.6;
      body.position.set(0, -f * 0.12 + Math.sin(p.t * 0.8) * 0.06, 0);
      body.rotation.set(0.1 * Math.min(1, p.speed), 0, Math.sin(p.t * 0.6) * 0.06);
      ribbons.forEach((chain, c) => chain.forEach((seg, i) => (seg.rotation.x = (i === 0 ? 1.3 : 0) + Math.sin(p.t * 3 - i * 0.8 + c) * 0.18)));
      const s = strikeCurve(p.attack);
      neck.rotation.x = -0.6 + s * 0.45;
      head.rotation.x = 0.5 - s * 0.2;
      squashStretch(torso, p);
      faintPose(k.root, body, p);
      if (p.faint >= 0) body.position.y -= Math.min(1, p.faint * 1.6) * 1.7;
    },
  });
}
