import { Kit, finishRig, type Rig } from '../kit.js';
import { bipedWalk, breath, faintPose, squashStretch, strikeCurve } from '../motion.js';

const BLUE = 0x7cc7ea;
const SHELL = 0xb07a3c;
const RIM = 0xf2e1b4;
const BELLY = 0xf4d67c;

/** Squirtle: shell on its back, plated belly, curled tail; spits Water Gun. */
export function buildSquirtle(): Rig {
  const k = new Kit();
  const body = k.joint(k.root);
  const legL = k.joint(body, [0.12, 0.24, 0]);
  const legR = k.joint(body, [-0.12, 0.24, 0]);
  for (const leg of [legL, legR]) {
    k.capsule(leg, 0.075, 0.09, BLUE, [0, -0.09, 0]);
    k.sphere(leg, 0.08, BLUE, [0, -0.2, 0.05], [1, 0.55, 1.4]);
  }
  const torso = k.joint(body, [0, 0.46, 0]);
  k.sphere(torso, 0.24, BLUE, [0, 0, 0], [1, 1.12, 0.9]);
  k.dome(torso, 0.27, SHELL, [0, 0, -0.04], [1, 1.15, 0.9], [-Math.PI / 2, 0, 0], { roughness: 0.55 });
  k.torus(torso, 0.25, 0.04, RIM, [0, 0, -0.04], [0, 0, 0], Math.PI * 2, { roughness: 0.6 });
  k.sphere(torso, 0.2, BELLY, [0, -0.02, 0.1], [0.95, 1.05, 0.62]);
  for (const y of [0.06, -0.06]) k.box(torso, [0.2, 0.012, 0.02], 0xc9a64e, [0, y, 0.215]);
  const arms = ([1, -1] as const).map((sx) => {
    const arm = k.joint(torso, [sx * 0.22, 0.08, 0.06], [0.5, 0, -sx * 0.5]);
    k.capsule(arm, 0.055, 0.12, BLUE, [0, -0.09, 0]);
    return arm;
  });
  const [armL, armR] = arms as [typeof arms[0], typeof arms[0]];
  const head = k.joint(body, [0, 0.8, 0.03]);
  k.sphere(head, 0.26, BLUE, [0, 0.08, 0], [1.02, 0.95, 1.02]);
  for (const sx of [1, -1]) k.eye(head, [sx * 0.11, 0.13, 0.21], 0.052, { sclera: true, iris: 0x7b3a2a, yaw: sx * 0.4, tall: 1.2 });
  const jaw = k.joint(head, [0, -0.02, 0.15]);
  k.sphere(jaw, 0.08, BLUE, [0, -0.01, 0.04], [1.15, 0.4, 0.75]);
  k.capsule(head, 0.01, 0.12, 0x2c4f66, [0, 0.0, 0.27], [0, 0, Math.PI / 2]);
  const tail = k.joint(body, [0, 0.28, -0.22], [0, 0, 0]);
  k.torus(tail, 0.1, 0.045, BLUE, [0, 0.06, -0.08], [0, Math.PI / 2, 0], Math.PI * 1.6);
  const muzzle = k.joint(head, [0, 0.0, 0.32]);

  return finishRig(k, {
    height: 1.2,
    muzzle,
    attackStyle: 'cast',
    attackDuration: 0.5,
    animate(p) {
      body.position.set(0, 0, 0);
      body.rotation.set(0, 0, 0);
      bipedWalk({ body, legL, legR, armL, armR, head }, p, { legSwing: 0.7, bob: 0.06 });
      torso.scale.y = 1 + breath(p);
      tail.rotation.y = Math.sin(p.t * 2.6) * 0.3;
      const s = strikeCurve(p.attack);
      body.rotation.x += s * 0.25;
      head.rotation.x = -s * 0.22;
      jaw.rotation.x = Math.max(0, s) * 0.4;
      squashStretch(body, p);
      faintPose(k.root, body, p);
    },
  });
}
