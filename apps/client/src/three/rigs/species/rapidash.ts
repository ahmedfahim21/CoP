import * as THREE from 'three';
import { Kit, finishRig, type Rig } from '../kit.js';
import { faintPose, flicker, gallop, squashStretch, strikeCurve } from '../motion.js';

const COAT = 0xf6efe0;
const HOOF = 0x6a5a48;
const HORN = 0xe8e0cc;

/** Rapidash: a cream horse with a burning mane and tail; leaps the river at full gallop. */
export function buildRapidash(): Rig {
  const k = new Kit();
  const body = k.joint(k.root);
  const torso = k.joint(body, [0, 0.78, 0]);
  k.sphere(torso, 0.3, COAT, [0, 0, 0], [0.85, 0.85, 1.6]);
  const legs = ([[0.16, 0.32], [-0.16, 0.32], [0.16, -0.34], [-0.16, -0.34]] as const).map(([x, z]) => {
    const leg = k.joint(body, [x, 0.72, z]);
    k.capsule(leg, 0.07, 0.3, COAT, [0, -0.22, 0]);
    k.capsule(leg, 0.05, 0.2, COAT, [0, -0.5, 0]);
    k.cylinder(leg, 0.06, 0.07, 0.08, HOOF, [0, -0.67, 0]);
    return leg;
  });
  const [legFL, legFR, legBL, legBR] = legs as [typeof legs[0], typeof legs[0], typeof legs[0], typeof legs[0]];
  const neck = k.joint(torso, [0, 0.12, 0.38], [-0.7, 0, 0]);
  k.capsule(neck, 0.13, 0.32, COAT, [0, 0.2, 0]);
  const head = k.joint(neck, [0, 0.46, 0.04], [1.05, 0, 0]);
  k.sphere(head, 0.15, COAT, [0, 0, 0.1], [0.85, 0.85, 1.6]);
  k.cone(head, 0.05, 0.36, HORN, [0, 0.2, 0.08], [-0.35, 0, 0]);
  for (const sx of [1, -1]) {
    k.eye(head, [sx * 0.1, 0.06, 0.12], 0.04, { sclera: true, iris: 0xb23a2a, yaw: sx * 0.9, tall: 1 });
    k.cone(head, 0.05, 0.12, COAT, [sx * 0.08, 0.15, -0.06], [-0.3, 0, -sx * 0.2]);
  }
  // Flames: layered cones with their own materials so they glow and flicker.
  const outer = k.ownMat(0xff8c1a, { emissive: 0xff6a00, emissiveIntensity: 0.9, roughness: 1 });
  const inner = k.ownMat(0xffe07a, { emissive: 0xffc030, emissiveIntensity: 1.1, roughness: 1 });
  const flames: Array<{ j: THREE.Group; seed: number }> = [];
  const flame = (parent: THREE.Object3D, pos: [number, number, number], rot: [number, number, number], size: number) => {
    const j = k.joint(parent, pos, rot);
    k.cone(j, 0.1 * size, 0.38 * size, outer, [0, 0.16 * size, 0]).castShadow = false;
    k.cone(j, 0.055 * size, 0.24 * size, inner, [0, 0.1 * size, 0.02]).castShadow = false;
    flames.push({ j, seed: flames.length * 1.7 });
  };
  for (let i = 0; i < 5; i++) flame(neck, [0, 0.08 + i * 0.09, -0.11], [-0.6, 0, 0], 1 - i * 0.08);
  for (let i = 0; i < 3; i++) flame(torso, [0, 0.12, -0.42 - i * 0.05], [-1.9 + i * 0.25, 0, 0], 1.25 - i * 0.15);
  const muzzle = k.joint(head, [0, 0, 0.3]);

  return finishRig(k, {
    height: 1.75,
    muzzle,
    attackStyle: 'kick',
    attackDuration: 0.55,
    animate(p) {
      body.position.set(0, 0, 0);
      body.rotation.set(0, 0, 0);
      gallop({ body, legFL, legFR, legBL, legBR, head: neck }, p, { swing: 0.9, bob: 0.1 });
      for (const f of flames) {
        const s = flicker(p.t, f.seed) * (1 + Math.min(1, p.speed) * 0.25);
        f.j.scale.set(1 / s, s, 1 / s);
      }
      // Flame Charge: rear up, then stamp down onto the tower.
      const s = strikeCurve(p.attack);
      if (p.attack >= 0) {
        body.rotation.x = Math.min(0, s) * 0.6 + Math.max(0, s) * 0.15;
        legFL.rotation.x = Math.min(0, s) * 1.4;
        legFR.rotation.x = Math.min(0, s) * 1.2;
      }
      squashStretch(body, p);
      faintPose(k.root, body, p);
    },
  });
}
