import { Kit, finishRig, type Rig } from '../kit.js';
import { clamp01, faintPose, squashStretch, strideAmount } from '../motion.js';

const PURPLE = 0x7a5aaa;
const GOLD = 0xd8b84a;

function star(r: number, inner: number): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
    const rr = i % 2 === 0 ? r : inner;
    pts.push([Math.cos(a) * rr, Math.sin(a) * rr]);
  }
  return pts;
}

/** Starmie: a purple star over a gold one, spinning on edge with a glowing core gem. */
export function buildStarmie(): Rig {
  const k = new Kit();
  const body = k.joint(k.root);
  const wheel = k.joint(body, [0, 0.72, 0]);
  const front = k.joint(wheel);
  k.shape(front, 'starmie-front', star(0.6, 0.24), 0.08, PURPLE, [0, 0, 0.03], [0, 0, 0], { roughness: 0.45 });
  const back = k.joint(wheel, [0, 0, -0.06], [0, 0, Math.PI / 5]);
  k.shape(back, 'starmie-back', star(0.52, 0.22), 0.06, GOLD, [0, 0, 0], [0, 0, 0], { roughness: 0.4, metalness: 0.3 });
  const gemMat = k.ownMat(0xe0304a, { roughness: 0.15, metalness: 0.2, emissive: 0xff3050, emissiveIntensity: 0.4 });
  k.sphere(wheel, 0.13, gemMat, [0, 0, 0.1], [1, 1, 0.6]);
  k.torus(wheel, 0.14, 0.03, GOLD, [0, 0, 0.09], [0, 0, 0], Math.PI * 2, { metalness: 0.5, roughness: 0.3 });
  const muzzle = k.joint(wheel, [0, 0, 0.2]);

  return finishRig(k, {
    height: 1.4,
    muzzle,
    attackStyle: 'cast',
    attackDuration: 0.35,
    animate(p) {
      const g = strideAmount(p);
      // Stands on edge and rolls/glides; the stars counter-rotate.
      body.position.set(0, Math.sin(p.t * 2.5) * 0.05, 0);
      front.rotation.z = p.t * (0.8 + g * 4);
      back.rotation.z = Math.PI / 5 - p.t * (0.5 + g * 2);
      wheel.rotation.x = -0.15 * g;
      gemMat.emissiveIntensity = 0.4 + Math.sin(p.t * 4) * 0.2 + (p.attack < 0 ? 0 : (1 - clamp01(p.attack)) * 2.5);
      squashStretch(wheel, p);
      faintPose(k.root, body, p);
    },
  });
}
