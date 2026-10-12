import { Kit, finishRig, type Rig } from '../kit.js';
import { bipedWalk, breath, clamp01, easeInOut, faintPose, flap, squashStretch } from '../motion.js';

const GREEN = 0x7cc35a;
const CREAM = 0xf4ecc8;
const BLADE = 0xe8eef2;
const WING = 0xf4f8ff;

const SCYTHE: Array<[number, number]> = [[0, 0], [0.08, 0.06], [0.2, 0.22], [0.3, 0.45], [0.32, 0.6], [0.24, 0.42], [0.1, 0.2], [-0.02, 0.06]];

/** Scyther: a mantis with scythe arms; Fury Cutter whirls it through a full circle. */
export function buildScyther(): Rig {
  const k = new Kit();
  const body = k.joint(k.root);
  const spin = k.joint(body);
  const legL = k.joint(spin, [0.12, 0.42, -0.05]);
  const legR = k.joint(spin, [-0.12, 0.42, -0.05]);
  for (const leg of [legL, legR]) {
    k.capsule(leg, 0.06, 0.18, GREEN, [0, -0.15, 0.04], [0.25, 0, 0]);
    k.capsule(leg, 0.045, 0.14, GREEN, [0, -0.33, -0.02], [-0.3, 0, 0]);
    k.sphere(leg, 0.06, CREAM, [0, -0.42, 0.04], [1, 0.4, 1.6]);
  }
  const torso = k.joint(spin, [0, 0.72, 0], [0.25, 0, 0]);
  k.sphere(torso, 0.2, GREEN, [0, 0, 0], [0.95, 1.35, 0.85]);
  for (let i = 0; i < 4; i++) k.sphere(torso, 0.15 - i * 0.012, CREAM, [0, -0.08 - i * 0.07, 0.1], [1.1, 0.35, 0.6]);
  const head = k.joint(torso, [0, 0.38, 0.05]);
  k.sphere(head, 0.17, GREEN, [0, 0, 0.04], [0.9, 0.85, 1.2]);
  k.cone(head, 0.05, 0.2, GREEN, [0, 0.16, -0.06], [-0.9, 0, 0]);
  for (const sx of [1, -1]) {
    k.eye(head, [sx * 0.09, 0.04, 0.14], 0.045, { sclera: true, iris: 0x2a2a2a, yaw: sx * 0.55, tall: 0.85 });
    k.box(head, [0.1, 0.025, 0.02], 0x3a6a2a, [sx * 0.09, 0.1, 0.16], [0, 0, sx * 0.45]);
  }
  const arms = ([1, -1] as const).map((sx) => {
    const arm = k.joint(torso, [sx * 0.18, 0.14, 0.06], [0.4, 0, -sx * 0.5]);
    k.capsule(arm, 0.05, 0.16, GREEN, [0, -0.12, 0]);
    const blade = k.joint(arm, [0, -0.28, 0]);
    // The blade's outline runs up its local Y; tipping it +90° about X points it forward.
    // Mirroring for the right arm is a yaw, so the length axis still ends up pointing forward.
    k.shape(blade, 'scyther-blade', SCYTHE, 0.02, BLADE, [0, 0, 0], [Math.PI / 2, sx > 0 ? 0 : Math.PI, 0], { roughness: 0.25, metalness: 0.4 });
    return { arm, blade };
  });
  const [armL, armR] = arms as [typeof arms[0], typeof arms[0]];
  const wingMat = k.ownMat(WING, { roughness: 0.2 });
  wingMat.transparent = true;
  wingMat.opacity = 0.7;
  const wings = ([1, -1] as const).map((sx) => {
    const w = k.joint(torso, [sx * 0.08, 0.16, -0.16], [0, 0, 0]);
    const m = k.sphere(w, 0.32, wingMat, [sx * 0.16, 0.05, -0.04], [0.55, 0.12, 1], [0.2, sx * 0.4, 0]);
    m.castShadow = false;
    return { w, sx };
  });
  const muzzle = k.joint(armR.blade, [0, -0.3, 0]);

  return finishRig(k, {
    height: 1.4,
    muzzle,
    attackStyle: 'spin',
    attackDuration: 0.55,
    animate(p) {
      body.position.set(0, 0, 0);
      body.rotation.set(0, 0, 0);
      bipedWalk({ body: spin, legL, legR, armL: armL.arm, armR: armR.arm, head }, p, { legSwing: 0.7, armSwing: 0.25, bob: 0.06 });
      torso.scale.y = 1 + breath(p, 2.4);
      // Blades held forward and ready, like a mantis.
      armL.blade.rotation.x = -0.9;
      armR.blade.rotation.x = -0.9;
      for (const { w, sx } of wings) w.rotation.z = sx * (0.15 + flap(p.t, 9) * 0.06);
      // Fury Cutter: a full pirouette with blades thrown wide.
      if (p.attack >= 0) {
        const a = clamp01(p.attack);
        spin.rotation.y = easeInOut(a) * Math.PI * 2;
        const wide = Math.sin(a * Math.PI);
        armL.arm.rotation.z = -0.5 - wide * 0.9;
        armR.arm.rotation.z = 0.5 + wide * 0.9;
        body.position.y = wide * 0.15;
      } else {
        spin.rotation.y = 0;
        armL.arm.rotation.z = -0.5;
        armR.arm.rotation.z = 0.5;
      }
      squashStretch(body, p);
      faintPose(k.root, body, p);
    },
  });
}
