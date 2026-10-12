import { Kit, finishRig, type Rig } from '../kit.js';
import { faintPose, flap, squashStretch, strikeCurve } from '../motion.js';

const BLUE = 0x5a8fd8;
const MEMBRANE = 0x8c6fd1;
const MOUTH = 0x5a1a2e;

const WING: Array<[number, number]> = [[0, 0.06], [0.22, 0.14], [0.46, 0.12], [0.6, 0.02], [0.5, -0.06], [0.42, 0.0], [0.33, -0.1], [0.24, -0.02], [0.13, -0.1], [0.04, -0.04]];

/** Zubat: eyeless blue ball of a bat with tall ears, a gaping fanged mouth and frantic wings. */
export function buildZubat(): Rig {
  const k = new Kit();
  const body = k.joint(k.root);
  const core = k.joint(body, [0, 0.25, 0]);
  k.sphere(core, 0.22, BLUE, [0, 0, 0], [1, 1.08, 0.95]);
  // Mouth with fangs.
  k.sphere(core, 0.13, MOUTH, [0, -0.04, 0.17], [1, 0.75, 0.45]);
  k.cone(core, 0.025, 0.06, 0xfbf7ee, [0.05, 0.04, 0.215], [Math.PI, 0, 0]);
  k.cone(core, 0.025, 0.06, 0xfbf7ee, [-0.05, 0.04, 0.215], [Math.PI, 0, 0]);
  for (const sx of [1, -1]) {
    const ear = k.joint(core, [sx * 0.11, 0.17, -0.02], [0, 0, -sx * 0.3]);
    k.cone(ear, 0.09, 0.32, BLUE, [0, 0.15, 0], [0, 0, 0], [1, 1, 0.45]);
    k.cone(ear, 0.055, 0.22, MEMBRANE, [0, 0.13, 0.025], [0, 0, 0], [1, 1, 0.3]);
    // Long thin legs dangling below.
    k.capsule(core, 0.02, 0.32, BLUE, [sx * 0.07, -0.37, -0.03], [0.2, 0, 0]);
  }
  const wingL = k.joint(core, [0.17, 0.03, -0.02]);
  const wingR = k.joint(core, [-0.17, 0.03, -0.02]);
  k.shape(wingL, 'zubat-wing', WING, 0.02, MEMBRANE, [0, 0, 0], [-Math.PI / 2, 0, 0]);
  k.shape(wingR, 'zubat-wing', WING, 0.02, MEMBRANE, [0, 0, 0], [-Math.PI / 2, Math.PI, 0]);
  const muzzle = k.joint(core, [0, -0.04, 0.22]);

  return finishRig(k, {
    height: 0.75,
    flyHeight: 1.45,
    muzzle,
    attackStyle: 'bite',
    attackDuration: 0.4,
    animate(p) {
      const f = flap(p.t + p.walk * 0.02, 5.5);
      wingL.rotation.z = f * 0.85;
      wingR.rotation.z = -f * 0.85;
      body.position.set(0, -f * 0.05 + Math.sin(p.t * 2.3) * 0.06, 0);
      body.rotation.set(0.15 * Math.min(1, p.speed), 0, Math.sin(p.t * 1.7) * 0.08);
      const s = strikeCurve(p.attack);
      body.position.z = s * 0.25;
      body.position.y -= Math.max(0, s) * 0.3;
      body.rotation.x += s * 0.5;
      squashStretch(core, p);
      faintPose(k.root, body, p);
      if (p.faint >= 0) body.position.y -= Math.min(1, p.faint * 1.6) * 1.4; // falls out of the sky
    },
  });
}
