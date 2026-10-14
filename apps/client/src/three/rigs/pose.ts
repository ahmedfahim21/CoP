import type * as THREE from 'three';

/**
 * Everything an animation needs to know about one unit this frame. All rigs animate from
 * this alone, so a pose can be reproduced exactly (replays, previews, tests).
 */
export interface Pose {
  /** Seconds since the unit appeared. */
  t: number;
  /** Ground speed in tiles/second. */
  speed: number;
  /** Accumulated stride phase in radians; advances with distance travelled. */
  walk: number;
  /** -1 when not attacking, else progress 0..1 through the attack animation. */
  attack: number;
  /** 1 at the moment of being hit, decaying to 0. */
  hit: number;
  /** 1 at touchdown after deploying, decaying to 0. */
  land: number;
  /** -1 while alive, else progress 0..1 through the faint. */
  faint: number;
  /** Kings before they wake up. */
  dormant: boolean;
  /** Take Down primed: head down, full gallop. */
  charging: boolean;
  /** 0 on the ground, 1 at the top of a river leap. */
  airborne: number;
  /** 1 when a special ability fires (heal pulse, evolution glow), decaying to 0. */
  special: number;
  /** Rage is on. */
  enraged: boolean;
}

export const restPose = (): Pose => ({ t: 0, speed: 0, walk: 0, attack: -1, hit: 0, land: 0, faint: -1, dormant: false, charging: false, airborne: 0, special: 0, enraged: false });

export type AttackStyle = 'bite' | 'punch' | 'slam' | 'cast' | 'breath' | 'explode' | 'throw' | 'wing' | 'spin' | 'splash' | 'beam' | 'kick';

export interface Rig {
  /** Positioned and yawed by the owner. The model faces +Z. */
  root: THREE.Group;
  /** Approximate top of the model above its feet, for HP bars. */
  height: number;
  /** Hover height for flyers; 0 for walkers. */
  flyHeight: number;
  /** Where projectiles and breath effects come from. */
  muzzle: THREE.Object3D;
  attackStyle: AttackStyle;
  /** Seconds the attack animation takes. */
  attackDuration: number;
  animate(p: Pose, dt: number): void;
  /** 0..1 flash over the whole model, white unless a colour is given (icy blue when chilled). */
  flash(amount: number, color?: number): void;
  /** Fade the model out (0..1 opacity). */
  fade(opacity: number): void;
  dispose(): void;
}
