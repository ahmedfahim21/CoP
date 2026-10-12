import { Kit, finishRig, type Rig } from '../kit.js';
import { breath, clamp01, faintPose, quadWalk, squashStretch, strikeCurve } from '../motion.js';

const TEAL = 0x6cc7ac;
const SPOT = 0x3b8f78;
const BULB = 0x5ab44a;
const BULB_DARK = 0x3e8c34;

/** Bulbasaur: squat quadruped with a wide face and the bulb on its back that launches leaves. */
export function buildBulbasaur(): Rig {
  const k = new Kit();
  const body = k.joint(k.root);
  const torso = k.joint(body, [0, 0.32, 0]);
  k.sphere(torso, 0.3, TEAL, [0, 0, 0], [1.08, 0.78, 1.18]);
  for (const [x, z] of [[0.18, 0.05], [-0.2, -0.08], [0.05, -0.22]] as const) k.sphere(torso, 0.06, SPOT, [x, 0.17, z], [1.3, 0.4, 1]);
  const legs = ([[0.18, 0.18], [-0.18, 0.18], [0.19, -0.18], [-0.19, -0.18]] as const).map(([x, z]) => {
    const leg = k.joint(body, [x, 0.22, z]);
    k.capsule(leg, 0.08, 0.06, TEAL, [0, -0.08, 0]);
    for (const dx of [-0.04, 0.04]) k.cone(leg, 0.018, 0.05, 0xfbf7ee, [dx, -0.17, 0.08], [Math.PI / 2, 0, 0]);
    return leg;
  });
  const [legFL, legFR, legBL, legBR] = legs as [typeof legs[0], typeof legs[0], typeof legs[0], typeof legs[0]];

  const head = k.joint(body, [0, 0.48, 0.32]);
  k.sphere(head, 0.27, TEAL, [0, 0, 0], [1.18, 0.88, 1]);
  k.sphere(head, 0.05, SPOT, [0.12, 0.17, 0.08], [1.2, 0.4, 1]);
  k.sphere(head, 0.04, SPOT, [-0.14, 0.15, 0.1], [1.2, 0.4, 1]);
  for (const sx of [1, -1]) {
    k.cone(head, 0.07, 0.13, TEAL, [sx * 0.2, 0.22, -0.02], [0, 0, -sx * 0.5]);
    k.eye(head, [sx * 0.14, 0.04, 0.2], 0.055, { sclera: true, iris: 0xd2333a, yaw: sx * 0.5, tall: 1.05 });
  }
  k.capsule(head, 0.014, 0.2, 0x2c5a4e, [0, -0.1, 0.25], [0, 0, Math.PI / 2]);
  const mouth = k.ownMat(0xd8536b, { roughness: 0.6 });
  const mouthMesh = k.sphere(head, 0.06, mouth, [0, -0.12, 0.24], [1.6, 0.1, 0.4]);

  const bulb = k.joint(body, [0, 0.55, -0.1]);
  k.sphere(bulb, 0.27, BULB, [0, 0.08, 0], [1, 1.05, 1]);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    k.sphere(bulb, 0.16, BULB_DARK, [Math.cos(a) * 0.18, 0.1, Math.sin(a) * 0.18], [0.35, 1.1, 0.55], [0, -a, 0]);
  }
  k.cone(bulb, 0.06, 0.12, BULB, [0, 0.38, 0]);
  const muzzle = k.joint(bulb, [0, 0.35, 0]);

  return finishRig(k, {
    height: 1.1,
    muzzle,
    attackStyle: 'cast',
    attackDuration: 0.55,
    animate(p) {
      body.position.set(0, 0, 0);
      body.rotation.set(0, 0, 0);
      quadWalk({ body, legFL, legFR, legBL, legBR, head }, p, { swing: 0.55, bob: 0.03 });
      torso.scale.y = 1 + breath(p, 1.8);
      // Bulb breathes on its own rhythm and pumps when launching leaves.
      const s = strikeCurve(p.attack);
      const pump = p.attack < 0 ? 0 : clamp01(1 - Math.abs(p.attack - 0.35) / 0.3);
      bulb.scale.setScalar(1 + Math.sin(p.t * 1.3) * 0.03 + pump * 0.18);
      body.position.y -= Math.max(0, -s) * 0.06;
      head.rotation.x = -s * 0.15;
      mouthMesh.scale.y = 0.006 + Math.max(0, s) * 0.04;
      squashStretch(body, p);
      faintPose(k.root, body, p);
    },
  });
}
