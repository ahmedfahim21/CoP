import * as THREE from 'three';
import { Kit, finishRig, type Rig } from '../kit.js';
import { clamp01, faintPose, squashStretch } from '../motion.js';

const STEEL = 0xb4bcc8;
const RED = 0xd8344a;
const BLUE = 0x3a6ad8;

/** Magneton: three linked Magnemite hovering in a triangle, turning slowly like a turret. */
export function buildMagneton(): Rig {
  const k = new Kit();
  const body = k.joint(k.root);
  const cluster = k.joint(body, [0, 0.9, 0]);
  const eyeMat = k.ownMat(0xf3f1ea, { roughness: 0.3, emissive: 0xfff3a0, emissiveIntensity: 0 });
  const mites: THREE.Group[] = [];
  for (const [x, y, z, s] of [[0, 0.32, 0.05, 1.1], [0.32, -0.15, 0, 1], [-0.32, -0.15, 0, 1]] as const) {
    const m = k.joint(cluster, [x, y, z]);
    m.scale.setScalar(s);
    k.sphere(m, 0.2, STEEL, [0, 0, 0], [1, 1, 1], [0, 0, 0], { roughness: 0.35, metalness: 0.6 });
    // The single big eye.
    k.sphere(m, 0.09, eyeMat, [0, 0.01, 0.16], [1, 1, 0.5]);
    k.sphere(m, 0.04, 0x1c1c22, [0, 0.01, 0.2], [1, 1, 0.4]);
    // Horseshoe magnets either side, red and blue tips.
    for (const sx of [1, -1]) {
      k.torus(m, 0.09, 0.03, STEEL, [sx * 0.26, 0, 0], [0, Math.PI / 2, sx > 0 ? Math.PI / 2 : -Math.PI / 2], Math.PI, { metalness: 0.6, roughness: 0.3 });
      k.box(m, [0.06, 0.05, 0.06], RED, [sx * 0.26, 0.09, 0.0]);
      k.box(m, [0.06, 0.05, 0.06], BLUE, [sx * 0.26, -0.09, 0.0]);
    }
    k.cylinder(m, 0.025, 0.025, 0.1, 0x8a929e, [0, 0.22, 0], [0, 0, 0], { metalness: 0.7 });
    mites.push(m);
  }
  const muzzle = k.joint(cluster, [0, 0.1, 0.3]);

  return finishRig(k, {
    height: 1.6,
    muzzle,
    attackStyle: 'cast',
    attackDuration: 0.3,
    animate(p) {
      body.position.set(0, Math.sin(p.t * 2) * 0.06, 0);
      cluster.rotation.y = Math.sin(p.t * 0.8) * 0.25;
      mites.forEach((m, i) => (m.rotation.z = Math.sin(p.t * 3 + i * 2) * 0.15));
      // Zap: the eyes flare.
      eyeMat.emissiveIntensity = p.attack < 0 ? 0 : (1 - clamp01(p.attack)) * 2.2;
      squashStretch(cluster, p);
      faintPose(k.root, body, p);
    },
  });
}
