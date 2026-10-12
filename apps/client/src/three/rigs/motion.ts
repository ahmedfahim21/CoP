import type * as THREE from 'three';
import type { Pose } from './kit.js';

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
export const easeOut = (t: number) => 1 - (1 - t) ** 3;
export const easeIn = (t: number) => t * t * t;
export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
export const smooth = (t: number) => t * t * (3 - 2 * t);

/** How much of a full stride animation to play: 0 standing still, 1 at a brisk walk. */
export const strideAmount = (p: Pose) => clamp01(p.speed / 1.1);

/**
 * The shape of every attack: a quick anticipation pull-back, a snap through the strike,
 * then a slower settle. Returns -1..1: negative is wind-up, positive is follow-through.
 */
export function strikeCurve(a: number): number {
  if (a < 0) return 0;
  if (a < 0.22) return -Math.sin((a / 0.22) * (Math.PI / 2)) * 0.55;
  if (a < 0.38) return -0.55 + 1.55 * easeOut((a - 0.22) / 0.16);
  return 1 - easeInOut((a - 0.38) / 0.62);
}

/** Squash on landing and on being hit; stretch while winding up. Applied to a body joint. */
export function squashStretch(body: THREE.Object3D, p: Pose, extraStretch = 0) {
  const squash = p.land * 0.28 + p.hit * 0.16;
  const stretch = extraStretch;
  body.scale.set(1 + squash * 0.7 - stretch * 0.3, 1 - squash + stretch, 1 + squash * 0.7 - stretch * 0.3);
}

/** Idle breathing: a gentle vertical scale pulse. */
export const breath = (p: Pose, rate = 2.2, depth = 0.025) => Math.sin(p.t * rate) * depth;

/**
 * Two-legged walk. Legs and arms swing in opposition, the body bobs twice per stride and
 * leans into the direction of travel. Joints are optional so stubby species can skip arms.
 */
export function bipedWalk(
  j: { body: THREE.Object3D; legL: THREE.Object3D; legR: THREE.Object3D; armL?: THREE.Object3D; armR?: THREE.Object3D; head?: THREE.Object3D },
  p: Pose,
  o: { legSwing?: number; armSwing?: number; bob?: number; lean?: number; baseY?: number } = {},
) {
  const k = strideAmount(p);
  const s = Math.sin(p.walk);
  j.legL.rotation.x = s * (o.legSwing ?? 0.7) * k;
  j.legR.rotation.x = -s * (o.legSwing ?? 0.7) * k;
  if (j.armL) j.armL.rotation.x = -s * (o.armSwing ?? 0.6) * k;
  if (j.armR) j.armR.rotation.x = s * (o.armSwing ?? 0.6) * k;
  j.body.position.y = (o.baseY ?? 0) + Math.abs(Math.cos(p.walk)) * (o.bob ?? 0.05) * k;
  j.body.rotation.x = (o.lean ?? 0.12) * k;
  // A little side-to-side roll sells the weight transfer.
  j.body.rotation.z = Math.sin(p.walk) * 0.05 * k;
  if (j.head) j.head.rotation.x = -(o.lean ?? 0.12) * k * 0.6;
}

/** Four-legged trot: diagonal pairs move together. */
export function quadWalk(
  j: { body: THREE.Object3D; legFL: THREE.Object3D; legFR: THREE.Object3D; legBL: THREE.Object3D; legBR: THREE.Object3D; head?: THREE.Object3D },
  p: Pose,
  o: { swing?: number; bob?: number; baseY?: number } = {},
) {
  const k = strideAmount(p);
  const s = Math.sin(p.walk);
  const a = (o.swing ?? 0.65) * k;
  j.legFL.rotation.x = s * a;
  j.legBR.rotation.x = s * a;
  j.legFR.rotation.x = -s * a;
  j.legBL.rotation.x = -s * a;
  j.body.position.y = (o.baseY ?? 0) + Math.abs(Math.cos(p.walk)) * (o.bob ?? 0.04) * k;
  j.body.rotation.x = Math.sin(p.walk * 2) * 0.04 * k;
  if (j.head) j.head.rotation.x = Math.sin(p.walk * 2 + 1) * 0.06 * k;
}

/** Wing flap: down-stroke faster than the up-stroke, like a real flier. */
export function flap(t: number, rate: number): number {
  const c = (t * rate) % 1;
  return c < 0.4 ? -Math.cos((c / 0.4) * Math.PI) : Math.cos(((c - 0.4) / 0.6) * Math.PI);
}

/** Fainting: tip over sideways, sink, and settle. Returns true once fully down. */
export function faintPose(root: THREE.Object3D, body: THREE.Object3D, p: Pose): boolean {
  if (p.faint < 0) return false;
  const f = easeIn(clamp01(p.faint / 0.6));
  body.rotation.z = f * 1.35;
  body.position.y -= f * 0.15;
  root.scale.setScalar(1 - clamp01((p.faint - 0.7) / 0.3) * 0.6);
  return p.faint >= 1;
}
