import { Kit, finishRig, type Rig } from '../kit.js';
import { clamp01, faintPose, squashStretch } from '../motion.js';

const RED = 0xe23b2f;
const WHITE = 0xf3f1ea;

/** Voltorb: a living Poké Ball that hop-rolls toward towers and blows itself up. */
export function buildVoltorb(): Rig {
  const k = new Kit();
  const body = k.joint(k.root);
  const ball = k.joint(body, [0, 0.4, 0]);
  const shell = k.ownMat(RED, { roughness: 0.3, emissive: 0xffffff, emissiveIntensity: 0 });
  k.dome(ball, 0.4, shell, [0, 0, 0]);
  k.dome(ball, 0.4, WHITE, [0, 0, 0], [1, 1, 1], [Math.PI, 0, 0], { roughness: 0.35 });
  k.torus(ball, 0.4, 0.014, 0x2a2a2a, [0, 0, 0], [Math.PI / 2, 0, 0]);
  // Angry eyes straddling the seam.
  for (const sx of [1, -1]) {
    const eye = k.joint(ball, [sx * 0.13, 0.05, 0.355], [0, sx * 0.35, 0]);
    k.sphere(eye, 0.08, WHITE, [0, 0, 0], [1, 0.75, 0.35], [0, 0, 0], { roughness: 0.2 });
    k.sphere(eye, 0.035, 0x1c1c22, [-sx * 0.015, -0.005, 0.02], [1, 1.1, 0.4]);
    k.box(eye, [0.15, 0.03, 0.03], 0x1c1c22, [0, 0.075, 0.01], [0, 0, sx * 0.35]);
  }
  const muzzle = k.joint(ball, [0, 0, 0.4]);

  return finishRig(k, {
    height: 0.95,
    muzzle,
    attackStyle: 'explode',
    attackDuration: 0.35,
    animate(p) {
      // Hop-roll: rock forward and bounce, so the face stays readable.
      const hop = Math.abs(Math.sin(p.walk * 0.8)) * 0.14 * Math.min(1, p.speed);
      body.position.set(0, hop, 0);
      ball.rotation.x = Math.sin(p.walk * 0.8) * 0.35 * Math.min(1, p.speed);
      ball.rotation.z = Math.sin(p.t * 9) * 0.02;
      // Self-destruct: swell, tremble, glow white.
      const a = p.attack < 0 ? 0 : clamp01(p.attack);
      ball.scale.setScalar(1 + a * 0.45 + (a > 0 ? Math.sin(p.t * 60) * 0.03 : 0));
      shell.emissiveIntensity = a * 1.6;
      squashStretch(body, p);
      faintPose(k.root, body, p);
    },
  });
}
