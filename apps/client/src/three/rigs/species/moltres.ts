import * as THREE from 'three';
import { Kit, finishRig, type Rig } from '../kit.js';
import { clamp01, faintPose, flap, flicker, squashStretch } from '../motion.js';

const GOLD = 0xf3c43a;
const BEAK = 0xb0905a;

const WING: Array<[number, number]> = [[0, 0.04], [0.3, 0.2], [0.7, 0.3], [1.1, 0.26], [0.95, 0.12], [1.05, 0.04], [0.82, 0.02], [0.88, -0.1], [0.6, -0.04], [0.5, -0.14], [0.3, -0.04], [0.1, -0.1]];

/** Moltres: a firebird whose wings are made of flame; Fire Spin is a stream that grows hotter. */
export function buildMoltres(): Rig {
  const k = new Kit();
  const body = k.joint(k.root);
  const torso = k.joint(body, [0, 0.4, 0], [0.3, 0, 0]);
  k.sphere(torso, 0.27, GOLD, [0, 0, 0], [0.85, 1.05, 1.3]);
  const neck = k.joint(torso, [0, 0.22, 0.25], [-0.55, 0, 0]);
  k.capsule(neck, 0.085, 0.22, GOLD, [0, 0.14, 0]);
  const head = k.joint(neck, [0, 0.34, 0.02], [0.45, 0, 0]);
  k.sphere(head, 0.14, GOLD, [0, 0, 0.03], [0.9, 0.9, 1.15]);
  k.cone(head, 0.05, 0.16, BEAK, [0, -0.02, 0.2], [Math.PI / 2, 0, 0]);
  for (const sx of [1, -1]) k.eye(head, [sx * 0.08, 0.03, 0.11], 0.035, { sclera: true, iris: 0x2a2a2a, yaw: sx * 0.7, tall: 0.75 });

  const outer = k.ownMat(0xff8c1a, { emissive: 0xff6a00, emissiveIntensity: 0.9, roughness: 1 });
  const inner = k.ownMat(0xffe07a, { emissive: 0xffc030, emissiveIntensity: 1.1, roughness: 1 });
  const flames: Array<{ j: THREE.Group; seed: number }> = [];
  const flame = (parent: THREE.Object3D, pos: [number, number, number], rot: [number, number, number], size: number) => {
    const j = k.joint(parent, pos, rot);
    k.cone(j, 0.1 * size, 0.4 * size, outer, [0, 0.17 * size, 0]).castShadow = false;
    k.cone(j, 0.055 * size, 0.26 * size, inner, [0, 0.11 * size, 0.02]).castShadow = false;
    flames.push({ j, seed: flames.length * 1.3 });
  };
  // Crest of fire and a burning tail.
  for (let i = 0; i < 4; i++) flame(head, [0, 0.1 + i * 0.02, -0.04 - i * 0.07], [-0.9 - i * 0.2, 0, 0], 0.9 - i * 0.12);
  for (let i = 0; i < 4; i++) flame(torso, [(i - 1.5) * 0.08, -0.05, -0.35], [1.9, 0, (i - 1.5) * 0.25], 1.3);
  // Wings: a golden base with flames along the trailing edge.
  const wings = ([1, -1] as const).map((sx) => {
    const w = k.joint(torso, [sx * 0.15, 0.12, 0]);
    k.shape(w, 'moltres-wing', WING, 0.03, GOLD, [0, 0, 0], [-Math.PI / 2 + 0.15, sx > 0 ? 0 : Math.PI, 0]).scale.set(1.05, 1.05, 1);
    for (let i = 0; i < 5; i++) flame(w, [sx * (0.25 + i * 0.18), 0.02, -0.08 - (i % 2) * 0.04], [-1.5, 0, -sx * 0.2], 0.9);
    return { w, sx };
  });
  const muzzle = k.joint(head, [0, -0.02, 0.3]);

  return finishRig(k, {
    height: 1.4,
    flyHeight: 1.6,
    muzzle,
    attackStyle: 'beam',
    attackDuration: 0.4,
    animate(p) {
      const f = flap(p.t, 1.2);
      for (const { w, sx } of wings) w.rotation.z = sx * f * 0.55;
      body.position.set(0, -f * 0.12 + Math.sin(p.t * 0.9) * 0.05, 0);
      body.rotation.set(0.1 * Math.min(1, p.speed), 0, 0);
      // Flames roar while it attacks.
      const roar = p.attack >= 0 ? 1.35 : 1;
      for (const fl of flames) {
        const s = flicker(p.t, fl.seed) * roar;
        fl.j.scale.set(1 / Math.sqrt(s), s, 1 / Math.sqrt(s));
      }
      neck.rotation.x = -0.55 + (p.attack >= 0 ? 0.3 : 0) + Math.sin(p.t * 1.1) * 0.04;
      outer.emissiveIntensity = 0.9 + clamp01(p.special) * 0.8;
      squashStretch(torso, p);
      faintPose(k.root, body, p);
      if (p.faint >= 0) body.position.y -= Math.min(1, p.faint * 1.6) * 1.6;
    },
  });
}
