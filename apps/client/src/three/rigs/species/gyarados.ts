import * as THREE from 'three';
import { Kit, finishRig, type Rig } from '../kit.js';
import { breath, faintPose, squashStretch, strikeCurve, strideAmount } from '../motion.js';

const BLUE = 0x3c78c8;
const BELLY = 0xf2e2b4;
const CREST = 0xe9eef7;
const MOUTH = 0xa8263a;

/** Gyarados: a rearing sea serpent. The body is a chain of segments driven by one travelling wave. */
export function buildGyarados(): Rig {
  const k = new Kit();
  const body = k.joint(k.root);
  // Coil lying on the ground behind it.
  const coil = k.joint(body, [0, 0.3, -0.6]);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 1.4;
    k.sphere(coil, 0.32 - i * 0.04, BLUE, [Math.sin(a) * 0.45, 0, -Math.cos(a) * 0.35 - 0.1], [1, 0.8, 1]);
  }
  // Rising neck: each segment is a child of the previous, so bending one bends everything above.
  // Resting curve of each joint: leans back out of the coil, then arcs forward into an S.
  const REST = [-0.45, -0.25, 0.15, 0.4, 0.45, 0.3];
  const segs: THREE.Group[] = [];
  let parent: THREE.Object3D = body;
  let pos: [number, number, number] = [0, 0.3, -0.2];
  for (let i = 0; i < 6; i++) {
    const r = 0.34 - i * 0.025;
    const seg = k.joint(parent, pos, [REST[i]!, 0, 0]);
    k.sphere(seg, r, BLUE, [0, 0, 0], [1, 1.25, 1]);
    k.sphere(seg, r * 0.8, BELLY, [0, 0, r * 0.35], [0.85, 1.15, 0.6]);
    // A white fin ridge down the back.
    k.cone(seg, 0.06, 0.2, CREST, [0, r * 0.5, -r * 0.7], [-0.9, 0, 0], [0.4, 1, 1]);
    segs.push(seg);
    parent = seg;
    pos = [0, 0.3, 0];
  }
  // The head faces forward off the end of the curve.
  const head = k.joint(parent, [0, 0.32, 0.08], [-0.55, 0, 0]);
  k.sphere(head, 0.33, BLUE, [0, 0, 0.05], [1, 0.85, 1.2]);
  const jaw = k.joint(head, [0, -0.12, 0.05]);
  k.sphere(jaw, 0.26, BLUE, [0, -0.06, 0.2], [0.95, 0.4, 1.1]);
  k.sphere(jaw, 0.2, MOUTH, [0, 0.02, 0.22], [0.85, 0.25, 0.95]);
  for (const sx of [1, -1]) {
    k.cone(jaw, 0.03, 0.08, 0xfbf7ee, [sx * 0.12, 0.06, 0.38], [0, 0, 0]);
    k.eye(head, [sx * 0.16, 0.12, 0.25], 0.06, { sclera: true, iris: 0x2a2a2a, yaw: sx * 0.6, tall: 0.8 });
    k.box(head, [0.14, 0.03, 0.03], 0x223a6a, [sx * 0.15, 0.2, 0.27], [0, 0, sx * 0.45]);
    // Long whiskers and a crest fan.
    k.capsule(head, 0.02, 0.5, CREST, [sx * 0.3, -0.05, 0.25], [0.6, 0, sx * 1.1]);
    k.cone(head, 0.08, 0.34, BLUE, [sx * 0.12, 0.32, -0.12], [-0.6, 0, -sx * 0.4]);
  }
  k.shape(head, 'gyara-crest', [[0, 0], [0.12, 0.3], [0.04, 0.22], [0, 0.4], [-0.04, 0.22], [-0.12, 0.3]], 0.03, CREST, [0, 0.22, -0.18], [-0.4, 0, 0]);
  const muzzle = k.joint(jaw, [0, 0.02, 0.45]);

  return finishRig(k, {
    height: 2.8,
    muzzle,
    attackStyle: 'bite',
    attackDuration: 0.65,
    animate(p) {
      const g = strideAmount(p);
      body.position.set(0, breath(p, 1.3, 0.03), 0);
      body.rotation.set(0, 0, 0);
      // A wave travels up the neck; faster and bigger while moving.
      segs.forEach((seg, i) => {
        seg.rotation.x = REST[i]! + Math.sin(p.t * 2.2 - i * 0.7) * (0.06 + 0.06 * g);
        seg.rotation.z = Math.sin(p.t * 1.4 - i * 0.6 + p.walk * 0.3) * (0.05 + 0.08 * g);
      });
      coil.rotation.y = Math.sin(p.walk * 0.4) * 0.3 * g;
      // Hydro Pump: rear back, then lunge with the jaw wide.
      const s = strikeCurve(p.attack);
      segs[3]!.rotation.x += s * 0.35;
      segs[5]!.rotation.x += s * 0.3;
      head.rotation.x = -0.55 - s * 0.2;
      jaw.rotation.x = Math.max(0, s) * 0.55 + 0.08;
      squashStretch(body, p);
      faintPose(k.root, body, p);
    },
  });
}
