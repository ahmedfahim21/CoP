import * as THREE from 'three';
import { CARDS, STARTERS, statsOf, type CardId, type Entity, type StarterId, type Team } from '@cop/shared';
import { toScene, dampAngle } from './coords.js';
import { SnapshotBuffer } from './interp.js';
import type { Fx } from './fx.js';
import { PALETTE, teamColor } from './palette.js';
import { restPose, type Pose, type Rig } from './rigs/kit.js';
import { buildRig } from './rigs/registry.js';
import { buildTower, type TowerModel } from './towers.js';

/** Shared per-frame inputs for every view. */
export interface FrameCtx {
  /** Render clock in ms (performance.now based), already delayed for interpolation. */
  renderTime: number;
  dt: number;
  t: number;
  fx: Fx;
  /** Scene position of another entity, for facing attack targets. */
  positionOf(id: string): THREE.Vector3 | null;
}

const ringGeo = new THREE.RingGeometry(0.78, 1, 36);
/** Troops are drawn larger than their hitboxes so they read at battle zoom, as in Clash Royale. */
export const UNIT_VISUAL_SCALE = 1.5;

/** Where a unit should face by default: toward the opponent's side. */
const homeYaw = (team: Team) => (team === 0 ? Math.PI : 0);

export class UnitView {
  readonly holder = new THREE.Group();
  readonly rig: Rig;
  readonly buffer = new SnapshotBuffer();
  readonly flying: boolean;
  readonly radius: number;
  private readonly pose: Pose = restPose();
  private readonly ring: THREE.Mesh;
  private readonly clock: THREE.Mesh;
  private yaw: number;
  private last: THREE.Vector3 | null = null;
  private dropT: number;
  private attackT = -1;
  private attackTarget: string | null = null;
  private faintT = -1;
  private flashT = 0;
  private deployLeft: number;
  private readonly strideLength: number;
  hp: number;
  maxHp: number;
  /** True once the faint has fully played; the owner removes the view. */
  done = false;

  constructor(readonly id: string, readonly team: Team, readonly defId: CardId, readonly mine: boolean, deploying: boolean, hp: number, maxHp: number) {
    this.rig = buildRig(defId);
    const stats = statsOf({ kind: 'unit', defId });
    this.flying = stats.flying;
    this.radius = stats.radius;
    this.hp = hp;
    this.maxHp = maxHp;
    this.yaw = homeYaw(team);
    // Stride scales with the drawn size so feet don't skate across the grass.
    this.strideLength = (0.35 + this.rig.height * 0.22) * UNIT_VISUAL_SCALE;
    this.dropT = deploying ? 0 : 1;
    this.deployLeft = deploying ? 1 : 0;

    const color = teamColor(mine);
    this.ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false }));
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.04;
    this.ring.scale.setScalar(this.radius * 1.15 + 0.18);
    this.ring.renderOrder = 4;
    // Own geometry: the clock reveals itself with setDrawRange, which must not leak to other units.
    this.clock = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.72, 36, 1, Math.PI / 2, Math.PI * 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false }));
    this.clock.rotation.x = -Math.PI / 2;
    this.clock.position.y = 0.05;
    this.clock.scale.setScalar(this.radius * 1.15 + 0.18);
    this.clock.visible = deploying;
    this.clock.renderOrder = 4;
    this.rig.root.scale.setScalar(UNIT_VISUAL_SCALE);
    this.holder.add(this.ring, this.clock, this.rig.root);
  }

  /** Scene position of the muzzle, for projectiles. */
  muzzleWorld(out = new THREE.Vector3()): THREE.Vector3 {
    return this.rig.muzzle.getWorldPosition(out);
  }

  get alive() {
    return this.faintT < 0;
  }

  attack(targetId: string) {
    this.attackT = 0;
    this.attackTarget = targetId;
  }

  hit() {
    this.pose.hit = 1;
    this.flashT = 1;
  }

  faint() {
    if (this.faintT < 0) this.faintT = 0;
  }

  update(ctx: FrameCtx) {
    const { dt } = ctx;
    this.pose.t += dt;

    // Position from the snapshot buffer.
    if (this.buffer.latest && this.faintT < 0) {
      const p = this.buffer.sample(ctx.renderTime);
      const s = toScene(p);
      this.holder.position.set(s.x, 0, s.z);
    }
    const pos = this.holder.position;
    let speed = 0;
    if (this.last && dt > 0) {
      const dx = pos.x - this.last.x;
      const dz = pos.z - this.last.z;
      const dist = Math.hypot(dx, dz);
      speed = dist / dt;
      this.pose.walk += (dist / this.strideLength) * Math.PI * 2 * 0.5;
      if (speed > 0.15 && this.attackT < 0) this.yaw = dampAngle(this.yaw, Math.atan2(dx, dz), 10, dt);
    }
    this.last = pos.clone();
    this.pose.speed += (speed - this.pose.speed) * Math.min(1, dt * 10);

    // Face the target while attacking.
    if (this.attackT >= 0 && this.attackTarget) {
      const tp = ctx.positionOf(this.attackTarget);
      if (tp) this.yaw = dampAngle(this.yaw, Math.atan2(tp.x - pos.x, tp.z - pos.z), 18, dt);
      this.attackT += dt / this.rig.attackDuration;
      if (this.attackT >= 1) this.attackT = -1;
    }
    this.pose.attack = this.attackT;
    this.rig.root.rotation.y = this.yaw;

    // Deploy: drop from the sky, land with a squash and a puff of dust.
    let lift = this.rig.flyHeight;
    if (this.dropT < 1) {
      this.dropT = Math.min(1, this.dropT + dt / 0.32);
      lift += (1 - this.dropT ** 2) * 4;
      if (this.dropT >= 1) {
        this.pose.land = 1;
        ctx.fx.dust(new THREE.Vector3(pos.x, 0, pos.z), 12, this.radius + 0.4);
        ctx.fx.ring(new THREE.Vector3(pos.x, 0, pos.z), teamColor(this.mine), this.radius * 2 + 1, 0.4);
      }
    }
    if (this.deployLeft > 0) {
      this.deployLeft = Math.max(0, this.deployLeft - dt);
      const segs = Math.ceil(36 * (1 - this.deployLeft));
      (this.clock.geometry as THREE.BufferGeometry).setDrawRange(0, segs * 6);
      this.clock.visible = this.deployLeft > 0;
    }
    this.rig.root.position.y = lift;
    this.pose.land = Math.max(0, this.pose.land - dt * 4);
    this.pose.hit = Math.max(0, this.pose.hit - dt * 5);

    // Faint.
    if (this.faintT >= 0) {
      this.faintT += dt / 0.95;
      this.pose.faint = Math.min(1, this.faintT);
      (this.ring.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.85 * (1 - this.faintT * 2));
      if (this.faintT > 0.75) this.rig.fade(Math.max(0, 1 - (this.faintT - 0.75) / 0.25));
      if (this.faintT >= 1 && !this.done) {
        this.done = true;
        ctx.fx.smoke(new THREE.Vector3(pos.x, 0.3 + lift, pos.z), 8, 0xf0ece4);
      }
    }

    this.flashT = Math.max(0, this.flashT - dt * 9);
    this.rig.flash(this.flashT * 0.8);
    this.rig.animate(this.pose, dt);
  }

  /** Top of the model in scene space, for the HP bar. */
  barAnchor(out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(this.holder.position.x, this.rig.root.position.y + this.rig.height * UNIT_VISUAL_SCALE + 0.2, this.holder.position.z);
  }

  dispose() {
    this.rig.dispose();
    (this.ring.material as THREE.Material).dispose();
    (this.clock.material as THREE.Material).dispose();
    this.clock.geometry.dispose();
    this.holder.removeFromParent();
  }
}

export class TowerView {
  readonly model: TowerModel;
  readonly occupant: Rig;
  readonly kind: 'king' | 'princess';
  private readonly pose: Pose = restPose();
  private readonly baseYaw: number;
  private yaw: number;
  private attackT = -1;
  private attackTarget: string | null = null;
  private flashT = 0;
  private wasActive: boolean;
  private ruined = false;
  hp: number;
  maxHp: number;

  constructor(readonly id: string, readonly team: Team, kind: Entity['kind'], readonly defId: string, readonly mine: boolean, x: number, z: number, hp: number, maxHp: number, active: boolean) {
    this.kind = kind === 'king' ? 'king' : 'princess';
    this.hp = hp;
    this.maxHp = maxHp;
    this.model = buildTower(this.kind, mine, team === 0 ? 1 : -1);
    this.model.group.position.set(x, 0, z);
    this.occupant = buildRig(this.kind === 'king' ? (mine ? 'red' : 'blue') : defId);
    // Towers are tall; scale the occupant so it reads from the top.
    this.occupant.root.scale.setScalar(this.kind === 'king' ? 1.3 : 1.75);
    this.occupant.root.position.y = this.model.standY;
    this.model.group.add(this.occupant.root);
    this.baseYaw = homeYaw(team);
    this.yaw = this.baseYaw;
    this.wasActive = active;
    this.pose.dormant = !active;
  }

  get position(): THREE.Vector3 {
    return this.model.group.position;
  }

  muzzleWorld(out = new THREE.Vector3()): THREE.Vector3 {
    return this.occupant.muzzle.getWorldPosition(out);
  }

  setActive(active: boolean, fx: Fx) {
    if (active && !this.wasActive && !this.ruined) {
      // The trainer wakes with a start.
      this.pose.land = 1;
      fx.sparks(this.occupant.root.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 2.2, 0)), PALETTE.gold, 14, 2);
    }
    this.wasActive = active;
    this.pose.dormant = !active;
  }

  attack(targetId: string) {
    this.attackT = 0;
    this.attackTarget = targetId;
  }

  hit() {
    this.flashT = 1;
    this.pose.hit = 0.6;
  }

  ruin(fx: Fx) {
    if (this.ruined) return;
    this.ruined = true;
    const at = this.position.clone();
    fx.rubble(at.clone().setY(1.5), PALETTE.stone, this.kind === 'king' ? 34 : 24, 1.2);
    fx.smoke(at.clone().setY(0.8), 26, 0x9a9488);
    fx.dust(at, 24, 2);
    fx.ring(at, 0xfff3d6, this.kind === 'king' ? 6 : 4.5, 0.6);
    this.model.ruin();
    this.occupant.root.visible = false;
  }

  update(ctx: FrameCtx) {
    const { dt } = ctx;
    this.model.update(dt, ctx.t);
    if (this.ruined) return;
    this.pose.t += dt;
    if (this.attackT >= 0) {
      const tp = this.attackTarget ? ctx.positionOf(this.attackTarget) : null;
      if (tp) this.yaw = dampAngle(this.yaw, Math.atan2(tp.x - this.position.x, tp.z - this.position.z), 14, dt);
      this.attackT += dt / this.occupant.attackDuration;
      if (this.attackT >= 1) this.attackT = -1;
    } else {
      // Drift back to watching the bridge, glancing around now and then.
      this.yaw = dampAngle(this.yaw, this.baseYaw + Math.sin(this.pose.t * 0.4) * 0.35, 2, dt);
    }
    this.pose.attack = this.attackT;
    this.pose.land = Math.max(0, this.pose.land - dt * 3);
    this.pose.hit = Math.max(0, this.pose.hit - dt * 5);
    this.occupant.root.rotation.y = this.yaw;
    this.flashT = Math.max(0, this.flashT - dt * 9);
    this.occupant.flash(this.flashT * 0.7);
    this.occupant.animate(this.pose, dt);
  }

  barAnchor(out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(this.position.x, this.model.topY + (this.kind === 'king' ? 0.4 : 0.3), this.position.z);
  }

  /** Point for effects on the tower itself (hits, sparks). */
  bodyPoint(out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(this.position.x, this.model.standY * 0.7, this.position.z);
  }
}

// --- Projectiles -------------------------------------------------------------

export type MoveType = 'fire' | 'water' | 'electric' | 'grass' | 'ice' | 'normal' | 'other';

export function moveTypeOf(defId: string): MoveType {
  const kind = defId === 'trainer' ? 'king' : defId in CARDS ? 'unit' : defId in STARTERS ? 'princess' : null;
  if (!kind) return 'other';
  const t = statsOf({ kind, defId: defId as CardId | StarterId | 'trainer' }).move.type;
  const known: readonly string[] = ['fire', 'water', 'electric', 'grass', 'ice', 'normal'];
  return known.includes(t) ? (t as MoveType) : 'other';
}

const projGeo = {
  sphere: new THREE.SphereGeometry(1, 14, 10),
  crystal: new THREE.OctahedronGeometry(1, 0),
  leaf: (() => {
    const s = new THREE.Shape();
    s.moveTo(0, -0.5);
    s.quadraticCurveTo(0.45, 0, 0, 0.5);
    s.quadraticCurveTo(-0.45, 0, 0, -0.5);
    return new THREE.ShapeGeometry(s);
  })(),
  dome: new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2),
};

export class ProjectileView {
  readonly group = new THREE.Group();
  readonly buffer = new SnapshotBuffer();
  private readonly startY: number;
  private readonly startOffset: THREE.Vector3;
  private startDist = -1;
  private spin = 0;
  readonly type: MoveType;
  lastPos = new THREE.Vector3();

  constructor(readonly id: string, readonly targetId: string, sourceDefId: string, muzzle: THREE.Vector3 | null, serverPos: THREE.Vector3) {
    this.type = moveTypeOf(sourceDefId);
    this.startY = muzzle?.y ?? 1;
    this.startOffset = muzzle ? new THREE.Vector3(muzzle.x - serverPos.x, 0, muzzle.z - serverPos.z) : new THREE.Vector3();
    const glowMat = (c: number) => new THREE.MeshBasicMaterial({ color: c, toneMapped: false });
    switch (this.type) {
      case 'fire': {
        this.group.add(mesh(projGeo.sphere, glowMat(0xffd24a), 0.16), mesh(projGeo.sphere, new THREE.MeshBasicMaterial({ color: 0xff7a1a, transparent: true, opacity: 0.6, toneMapped: false }), 0.26));
        break;
      }
      case 'water': {
        const m = mesh(projGeo.sphere, new THREE.MeshStandardMaterial({ color: 0x5ab8f5, roughness: 0.1, emissive: 0x1b5f9a }), 0.15);
        m.scale.set(0.15, 0.15, 0.32);
        this.group.add(m);
        break;
      }
      case 'electric':
        this.group.add(mesh(projGeo.sphere, glowMat(0xfff7b0), 0.13), mesh(projGeo.sphere, new THREE.MeshBasicMaterial({ color: 0xffe14a, transparent: true, opacity: 0.55, toneMapped: false }), 0.24));
        break;
      case 'grass':
        for (let i = 0; i < 3; i++) {
          const leaf = new THREE.Mesh(projGeo.leaf, new THREE.MeshStandardMaterial({ color: 0x5ab44a, side: THREE.DoubleSide, roughness: 0.6 }));
          leaf.scale.setScalar(0.32);
          leaf.position.set(Math.cos((i / 3) * Math.PI * 2) * 0.16, Math.sin((i / 3) * Math.PI * 2) * 0.16, 0);
          leaf.castShadow = true;
          this.group.add(leaf);
        }
        break;
      case 'ice': {
        const c = mesh(projGeo.crystal, new THREE.MeshStandardMaterial({ color: 0xc8f4ff, roughness: 0.15, metalness: 0.1, emissive: 0x4fc3e8, emissiveIntensity: 0.6 }), 0.17);
        c.scale.set(0.12, 0.12, 0.26);
        this.group.add(c);
        break;
      }
      case 'normal': {
        // Poké Ball.
        const top = mesh(projGeo.dome, new THREE.MeshStandardMaterial({ color: 0xe5483f, roughness: 0.3 }), 0.13);
        const bottom = mesh(projGeo.dome, new THREE.MeshStandardMaterial({ color: 0xf3f1ea, roughness: 0.3 }), 0.13);
        bottom.rotation.x = Math.PI;
        this.group.add(top, bottom);
        break;
      }
      default:
        this.group.add(mesh(projGeo.sphere, glowMat(0xffffff), 0.14));
    }
  }

  update(ctx: FrameCtx) {
    const p = this.buffer.sample(ctx.renderTime);
    const s = toScene(p);
    const target = ctx.positionOf(this.targetId);
    const flat = new THREE.Vector3(s.x, 0, s.z);
    let progress = 0;
    let targetY = 0.7;
    if (target) {
      targetY = Math.max(0.5, target.y);
      const d = Math.hypot(target.x - s.x, target.z - s.z);
      if (this.startDist < 0) this.startDist = Math.max(0.01, d);
      progress = 1 - Math.min(1, d / this.startDist);
    }
    // Leave from the muzzle, converge on the server path, and drop to the target's height.
    flat.addScaledVector(this.startOffset, 1 - progress);
    const arc = this.type === 'normal' ? Math.sin(progress * Math.PI) * 1.4 : this.type === 'grass' ? Math.sin(progress * Math.PI) * 0.4 : 0;
    flat.y = this.startY + (targetY - this.startY) * progress + arc;
    const dir = flat.clone().sub(this.group.position);
    this.group.position.copy(flat);
    if (dir.lengthSq() > 1e-6) this.group.lookAt(flat.clone().add(dir));
    this.spin += ctx.dt * (this.type === 'grass' ? 18 : this.type === 'normal' ? 14 : 6);
    if (this.type === 'grass' || this.type === 'ice') this.group.rotateZ(this.spin);
    if (this.type === 'normal') this.group.rotateX(this.spin);
    this.lastPos.copy(flat);
    // Trails.
    const fx = ctx.fx;
    if (this.type === 'fire') {
      fx.mote(flat, 0xff8a2a, 0.45, 0.25);
      if (Math.random() < 0.4) fx.mote(flat, 0xffd24a, 0.25, 0.4);
    } else if (this.type === 'electric') {
      fx.mote(flat, 0xfff07a, 0.35, 0.15);
      if (Math.random() < 0.5) fx.sparks(flat, 0xfff07a, 1, 1.5);
    } else if (this.type === 'water') {
      fx.mote(flat, 0x8fd4ff, 0.25, 0.25);
    } else if (this.type === 'ice') {
      fx.mote(flat, 0xd8f8ff, 0.3, 0.3);
    }
  }

  impact(fx: Fx) {
    const at = this.lastPos;
    switch (this.type) {
      case 'fire': fx.fireBurst(at, 0.8); break;
      case 'water': fx.splash(at); break;
      case 'electric': fx.electric(at); break;
      case 'grass': fx.leaves(at); break;
      case 'ice': fx.frost(at); break;
      default: fx.sparks(at, 0xffffff, 10, 2.5); fx.smoke(at, 3, 0xf0ece4);
    }
  }

  dispose() {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) (m.material as THREE.Material).dispose();
    });
    this.group.removeFromParent();
  }
}

function mesh(g: THREE.BufferGeometry, m: THREE.Material, s: number): THREE.Mesh {
  const out = new THREE.Mesh(g, m);
  out.scale.setScalar(s);
  return out;
}
