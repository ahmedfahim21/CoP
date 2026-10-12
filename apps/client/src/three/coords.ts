import { ARENA_H, ARENA_W, type Point } from '@cop/shared';

/**
 * World tiles (x across, y down the arena from team 1's back wall to team 0's) map onto the
 * three.js ground plane with the arena centred on the origin: X = x - 9, Z = y - 16, Y up.
 * One tile is one scene unit. Team 0 looks from +Z, team 1 from -Z.
 */
export function toScene(p: Point): { x: number; z: number } {
  return { x: p.x - ARENA_W / 2, z: p.y - ARENA_H / 2 };
}

export function fromScene(x: number, z: number): Point {
  return { x: x + ARENA_W / 2, y: z + ARENA_H / 2 };
}

/** Shortest signed difference between two angles, in (-π, π]. */
export function angleDelta(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

/** Frame-rate independent exponential approach: `rate` is how many e-foldings per second. */
export function damp(current: number, target: number, rate: number, dt: number): number {
  return target + (current - target) * Math.exp(-rate * dt);
}

export function dampAngle(current: number, target: number, rate: number, dt: number): number {
  return current + angleDelta(current, target) * (1 - Math.exp(-rate * dt));
}
