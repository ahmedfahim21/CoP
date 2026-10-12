import { Kit, finishRig, type Rig } from '../kit.js';
import { bipedWalk, breath, clamp01, faintPose, squashStretch, strikeCurve } from '../motion.js';

const FUR = 0xf0e2c8;
const LIMB = 0x7a5a3a;
const NOSE = 0xe8a8a0;

/** Primeape: an angry ball of fur on stubby brown limbs; shakes with rage when hurt. */
export function buildPrimeape(): Rig {
  const k = new Kit();
  const body = k.joint(k.root);
  const legL = k.joint(body, [0.16, 0.3, 0]);
  const legR = k.joint(body, [-0.16, 0.3, 0]);
  for (const leg of [legL, legR]) {
    k.capsule(leg, 0.065, 0.14, LIMB, [0, -0.14, 0]);
    k.sphere(leg, 0.08, LIMB, [0, -0.28, 0.04], [1, 0.55, 1.4]);
  }
  const ball = k.joint(body, [0, 0.7, 0]);
  k.sphere(ball, 0.42, FUR, [0, 0, 0], [1, 0.95, 0.95], [0, 0, 0], { roughness: 0.95 });
  // Shaggy tufts around the silhouette.
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    k.cone(ball, 0.08, 0.16, FUR, [Math.cos(a) * 0.38, Math.sin(a) * 0.36, -0.06], [0, 0, a - Math.PI / 2], [1, 1, 0.7], { roughness: 1 });
  }
  k.sphere(ball, 0.11, NOSE, [0, -0.02, 0.38], [1.25, 0.85, 0.7]);
  for (const sx of [1, -1]) {
    k.sphere(ball, 0.022, 0x3a2216, [sx * 0.04, -0.02, 0.46]);
    k.eye(ball, [sx * 0.14, 0.12, 0.34], 0.04, { sclera: true, iris: 0x2a2a2a, yaw: sx * 0.35, tall: 0.6 });
    k.box(ball, [0.14, 0.035, 0.03], LIMB, [sx * 0.14, 0.2, 0.37], [0, 0, sx * 0.5]);
    k.cone(ball, 0.08, 0.14, FUR, [sx * 0.3, 0.32, 0], [0, 0, -sx * 0.6]);
  }
  const arms = ([1, -1] as const).map((sx) => {
    const arm = k.joint(ball, [sx * 0.4, -0.02, 0.06], [0, 0, -sx * 0.35]);
    k.capsule(arm, 0.06, 0.18, LIMB, [0, -0.15, 0]);
    k.sphere(arm, 0.08, LIMB, [0, -0.3, 0.02]);
    return arm;
  });
  const [armL, armR] = arms as [typeof arms[0], typeof arms[0]];
  const muzzle = k.joint(ball, [0, 0, 0.5]);

  return finishRig(k, {
    height: 1.15,
    muzzle,
    attackStyle: 'punch',
    attackDuration: 0.35,
    animate(p) {
      body.position.set(0, 0, 0);
      body.rotation.set(0, 0, 0);
      bipedWalk({ body, legL, legR, armL, armR }, p, { legSwing: 0.8, armSwing: 0.7, bob: 0.08 });
      ball.scale.y = 1 + breath(p, 3);
      // Rage: a constant furious tremble (the view tints it red).
      if (p.enraged) ball.position.x = Math.sin(p.t * 70) * 0.025;
      else ball.position.x = 0;
      // Punch flurry: alternating jabs.
      const s = strikeCurve(p.attack);
      const flurry = p.attack < 0 ? 0 : Math.sin(clamp01(p.attack) * Math.PI * 4);
      armL.rotation.x = -Math.max(0, flurry) * 1.5 + Math.min(0, s) * 0.4;
      armR.rotation.x = Math.min(0, flurry) * 1.5 + Math.min(0, s) * 0.4;
      squashStretch(body, p);
      faintPose(k.root, body, p);
    },
  });
}
