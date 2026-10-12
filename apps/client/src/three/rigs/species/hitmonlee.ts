import { Kit, finishRig, type Rig } from '../kit.js';
import { breath, clamp01, faintPose, squashStretch, strikeCurve } from '../motion.js';

const BROWN = 0xb08a5a;
const CREAM = 0xf0e2c0;

/** Hitmonlee: a torso on long springy legs; tucks mid-air and lands a flying kick. */
export function buildHitmonlee(): Rig {
  const k = new Kit();
  const body = k.joint(k.root);
  const legs = ([1, -1] as const).map((sx) => {
    const hip = k.joint(body, [sx * 0.14, 0.82, 0]);
    k.capsule(hip, 0.08, 0.22, BROWN, [0, -0.2, 0]);
    // Coil rings on the thighs: its legs extend like springs.
    for (const y of [-0.1, -0.2, -0.3]) k.torus(hip, 0.085, 0.015, 0x8a6a42, [0, y, 0], [Math.PI / 2, 0, 0]);
    const knee = k.joint(hip, [0, -0.42, 0]);
    k.capsule(knee, 0.06, 0.22, BROWN, [0, -0.18, 0]);
    k.sphere(knee, 0.1, CREAM, [0, -0.38, 0.07], [1, 0.5, 1.6]);
    return { hip, knee };
  });
  const [legL, legR] = legs as [typeof legs[0], typeof legs[0]];
  const torso = k.joint(body, [0, 1.1, 0]);
  k.sphere(torso, 0.3, BROWN, [0, 0, 0], [1, 1.1, 0.9]);
  for (const sx of [1, -1]) k.eye(torso, [sx * 0.1, 0.18, 0.24], 0.045, { sclera: true, iris: 0x2a2a2a, yaw: sx * 0.35, tall: 0.7 });
  k.box(torso, [0.3, 0.05, 0.05], 0x5a4228, [0, 0.27, 0.22], [0.2, 0, 0]);
  const arms = ([1, -1] as const).map((sx) => {
    const arm = k.joint(torso, [sx * 0.3, 0, 0.04], [0.4, 0, -sx * 0.5]);
    k.capsule(arm, 0.05, 0.18, BROWN, [0, -0.15, 0]);
    k.sphere(arm, 0.07, CREAM, [0, -0.3, 0]);
    return arm;
  });
  const [armL, armR] = arms as [typeof arms[0], typeof arms[0]];
  const muzzle = k.joint(legR.knee, [0, -0.4, 0.1]);

  return finishRig(k, {
    height: 1.55,
    muzzle,
    attackStyle: 'kick',
    attackDuration: 0.45,
    animate(p) {
      const g = Math.min(1, p.speed / 1.1);
      const s = Math.sin(p.walk);
      // Bouncy springing gait.
      body.position.set(0, Math.abs(Math.cos(p.walk)) * 0.1 * g, 0);
      body.rotation.set(0.08 * g, 0, 0);
      legL.hip.rotation.x = s * 0.6 * g;
      legR.hip.rotation.x = -s * 0.6 * g;
      legL.knee.rotation.x = Math.max(0, -s) * 0.7 * g;
      legR.knee.rotation.x = Math.max(0, s) * 0.7 * g;
      armL.rotation.x = 0.4 - s * 0.4 * g;
      armR.rotation.x = 0.4 + s * 0.4 * g;
      torso.scale.y = 1 + breath(p);
      // Airborne (Jump Kick): knees tuck, then the right leg shoots out for the landing.
      const air = clamp01(p.airborne);
      legL.hip.rotation.x -= air * 1.3;
      legL.knee.rotation.x += air * 2;
      legR.hip.rotation.x -= air * (air > 0.6 ? 0.4 : 1.3);
      legR.knee.rotation.x += air * (air > 0.6 ? 0 : 2);
      // Ground kick.
      const k2 = strikeCurve(p.attack);
      legR.hip.rotation.x -= Math.max(0, k2) * 1.6;
      body.rotation.x -= Math.max(0, k2) * 0.25;
      squashStretch(body, p);
      faintPose(k.root, body, p);
    },
  });
}
