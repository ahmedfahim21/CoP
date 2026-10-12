import { Kit, finishRig, type Rig } from '../kit.js';
import { faintPose, squashStretch, strikeCurve, strideAmount } from '../motion.js';
import { seeded } from '../../palette.js';

const ROCK = 0x9a8f80;
const ROCK_DARK = 0x7a7064;

/** Geodude: a floating boulder that hauls itself along on its fists. */
export function buildGeodude(): Rig {
  const k = new Kit();
  const rnd = seeded(74);
  const body = k.joint(k.root);
  const rock = k.joint(body, [0, 0.62, 0]);
  k.sphere(rock, 0.38, ROCK, [0, 0, 0], [1, 0.95, 1], [0, 0, 0], { roughness: 0.95 });
  // Lumps and cracks so it reads as stone, not a ball.
  for (let i = 0; i < 9; i++) {
    const a = rnd() * Math.PI * 2;
    const b = (rnd() - 0.3) * 1.2;
    k.sphere(rock, 0.09 + rnd() * 0.06, ROCK_DARK, [Math.cos(a) * Math.cos(b) * 0.33, Math.sin(b) * 0.33, Math.sin(a) * Math.cos(b) * 0.33], [1, 0.7, 1], [rnd(), rnd(), 0], { roughness: 1 });
  }
  for (const sx of [1, -1]) {
    k.eye(rock, [sx * 0.12, 0.08, 0.33], 0.045, { sclera: true, iris: 0x2a2a2a, yaw: sx * 0.35, tall: 0.75 });
    k.box(rock, [0.16, 0.04, 0.05], 0x4a4238, [sx * 0.12, 0.17, 0.34], [0, 0, sx * 0.4]);
  }
  k.capsule(rock, 0.015, 0.16, 0x4a4238, [0, -0.08, 0.37], [0, 0, Math.PI / 2]);
  const arms = ([1, -1] as const).map((sx) => {
    // Positive Z-roll swings a hanging arm outward on the +X side.
    const shoulder = k.joint(rock, [sx * 0.34, -0.02, 0.05], [0, 0, sx * 0.9]);
    k.capsule(shoulder, 0.09, 0.2, ROCK, [0, -0.15, 0]);
    const fist = k.joint(shoulder, [0, -0.36, 0]);
    k.sphere(fist, 0.13, ROCK, [0, 0, 0.02], [1, 0.9, 1.1], [0, 0, 0], { roughness: 0.95 });
    for (const dx of [-0.05, 0, 0.05]) k.sphere(fist, 0.035, ROCK_DARK, [dx, 0.03, 0.12]);
    return shoulder;
  });
  const [armL, armR] = arms as [typeof arms[0], typeof arms[0]];
  const muzzle = k.joint(rock, [0, 0, 0.45]);

  return finishRig(k, {
    height: 1.15,
    muzzle,
    attackStyle: 'punch',
    attackDuration: 0.5,
    animate(p) {
      const g = strideAmount(p);
      // Hovering bob, and a forward lurch with each haul of the arms.
      body.position.set(0, Math.sin(p.t * 2.4) * 0.05 + Math.max(0, Math.sin(p.walk)) * 0.05 * g, 0);
      rock.rotation.set(Math.sin(p.walk) * 0.12 * g + 0.05, 0, Math.sin(p.t * 1.7) * 0.05);
      armL.rotation.x = -Math.sin(p.walk) * 0.9 * g;
      armR.rotation.x = Math.sin(p.walk) * 0.9 * g;
      const s = strikeCurve(p.attack);
      if (p.attack >= 0) {
        // Double hammer: both fists up and slammed down together.
        armL.rotation.x = -0.4 + Math.min(0, s) * 2 - Math.max(0, s) * -0.6;
        armR.rotation.x = armL.rotation.x;
        armL.rotation.z = 0.9 + Math.min(0, s) * 0.6;
        armR.rotation.z = -0.9 - Math.min(0, s) * 0.6;
      } else {
        armL.rotation.z = 0.9;
        armR.rotation.z = -0.9;
      }
      squashStretch(rock, p);
      faintPose(k.root, body, p);
    },
  });
}
