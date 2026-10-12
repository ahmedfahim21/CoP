import { Kit, finishRig, type Rig } from '../kit.js';
import { seeded } from '../../palette.js';
import { bipedWalk, breath, faintPose, squashStretch, strikeCurve } from '../motion.js';

const SHELL = 0x8a8f7a;
const SHELL_DARK = 0x6c7060;
const SKIN = 0xb08a5a;

/** Golem: a walking boulder; heaves rocks two-handed to send them rolling. */
export function buildGolem(): Rig {
  const k = new Kit();
  const rnd = seeded(76);
  const body = k.joint(k.root);
  const legL = k.joint(body, [0.24, 0.32, 0]);
  const legR = k.joint(body, [-0.24, 0.32, 0]);
  for (const leg of [legL, legR]) {
    k.capsule(leg, 0.11, 0.14, SKIN, [0, -0.14, 0]);
    k.sphere(leg, 0.13, SKIN, [0, -0.3, 0.06], [1, 0.5, 1.3]);
  }
  const shell = k.joint(body, [0, 0.82, 0]);
  k.sphere(shell, 0.58, SHELL, [0, 0, 0], [1, 0.92, 0.95], [0, 0, 0], { roughness: 0.95 });
  // Boulder plates.
  for (let i = 0; i < 12; i++) {
    const a = rnd() * Math.PI * 2;
    const b = (rnd() - 0.2) * 1.3;
    k.sphere(shell, 0.14 + rnd() * 0.06, rnd() > 0.5 ? SHELL_DARK : SHELL, [Math.cos(a) * Math.cos(b) * 0.52, Math.sin(b) * 0.5, Math.sin(a) * Math.cos(b) * 0.5], [1, 0.6, 1], [rnd(), rnd(), 0], { roughness: 1 });
  }
  // A small head peeks out of the front.
  const head = k.joint(shell, [0, 0.12, 0.5]);
  k.sphere(head, 0.17, SKIN, [0, 0, 0], [1.05, 0.85, 0.9]);
  for (const sx of [1, -1]) {
    k.eye(head, [sx * 0.07, 0.04, 0.13], 0.03, { sclera: true, iris: 0xa82a2a, yaw: sx * 0.4, tall: 0.8 });
    k.box(head, [0.08, 0.02, 0.02], 0x4a3a2a, [sx * 0.07, 0.09, 0.15], [0, 0, sx * 0.4]);
  }
  k.capsule(head, 0.012, 0.08, 0x4a3a2a, [0, -0.05, 0.15], [0, 0, Math.PI / 2]);
  const arms = ([1, -1] as const).map((sx) => {
    const arm = k.joint(shell, [sx * 0.52, -0.05, 0.15], [0, 0, -sx * 0.4]);
    k.capsule(arm, 0.1, 0.2, SKIN, [0, -0.16, 0]);
    k.sphere(arm, 0.13, SKIN, [0, -0.34, 0.02], [1, 0.9, 1.1]);
    return arm;
  });
  const [armL, armR] = arms as [typeof arms[0], typeof arms[0]];
  // The rock it hurls, held overhead during the wind-up.
  const rock = k.joint(shell, [0, 0.75, 0.15]);
  k.sphere(rock, 0.22, SHELL_DARK, [0, 0, 0], [1, 0.9, 1], [0.3, 0.6, 0], { roughness: 1 });
  const muzzle = k.joint(shell, [0, -0.3, 0.6]);

  return finishRig(k, {
    height: 1.7,
    muzzle,
    attackStyle: 'throw',
    attackDuration: 0.8,
    animate(p) {
      body.position.set(0, 0, 0);
      body.rotation.set(0, 0, 0);
      bipedWalk({ body, legL, legR, armL, armR }, p, { legSwing: 0.45, armSwing: 0.3, bob: 0.06, lean: 0.05 });
      shell.scale.y = 1 + breath(p, 1.4, 0.02);
      // Rollout: lift a boulder overhead with both hands, then bowl it.
      const s = strikeCurve(p.attack);
      const lift = Math.max(0, -s) / 0.55;
      rock.visible = p.attack >= 0 && p.attack < 0.4;
      armL.rotation.x = -lift * 2.6 + Math.max(0, s) * -1.2;
      armR.rotation.x = armL.rotation.x;
      shell.rotation.x = Math.max(0, s) * 0.35 - lift * 0.15;
      squashStretch(body, p);
      faintPose(k.root, body, p);
    },
  });
}
