import * as THREE from 'three';
import {
  ARENA_W, CARDS, DEPLOY_MIN_Y, POCKET_MIN_Y, isValidDeploy, mirror, openPocketsFrom, statsOf,
  type CardId, type Entity, type GameEvent, type Point, type Team,
} from '@cop/shared';
import type { Session } from '../net.js';
import { buildArena, type Arena } from './arena.js';
import { toScene } from './coords.js';
import { Fx } from './fx.js';
import { INTERP_DELAY_MS } from './interp.js';
import { teamColor } from './palette.js';
import { buildRig } from './rigs/registry.js';
import type { Rig } from './rigs/kit.js';
import { Stage } from './stage.js';
import { ProjectileView, TowerView, UNIT_VISUAL_SCALE, UnitView, type FrameCtx } from './views.js';

export interface BarInfo {
  id: string;
  kind: Entity['kind'];
  mine: boolean;
  hp: number;
  maxHp: number;
  x: number;
  y: number;
  visible: boolean;
}

export interface BattleHooks {
  /** Called every frame with HP bar anchors in host pixels. */
  onBars(bars: BarInfo[]): void;
  /** Floating combat text ("It's super effective!") at host pixels. */
  onText(text: string, x: number, y: number, tone: 'super' | 'weak'): void;
}

interface Pending<T> {
  at: number;
  value: T;
}

/**
 * The 3D battle: mirrors server state into views, renders it ~100ms in the past for smooth
 * interpolation, and replays server events on that same delayed clock.
 */
export class BattleView {
  readonly stage: Stage;
  readonly team: Team;
  private readonly arena: Arena;
  private readonly fx = new Fx();
  private readonly units = new Map<string, UnitView>();
  private readonly fainting: UnitView[] = [];
  private readonly towers = new Map<string, TowerView>();
  private readonly projectiles = new Map<string, ProjectileView>();
  private readonly endingProjectiles: Array<Pending<ProjectileView>> = [];
  private readonly events: Array<Pending<GameEvent>> = [];
  private readonly removals: Array<Pending<string>> = [];
  private readonly zone: THREE.Group;
  private readonly ghostHolder = new THREE.Group();
  private readonly ghostRing: THREE.Mesh;
  private readonly ghostRigs = new Map<CardId, Rig>();
  private ghostCard: CardId | null = null;
  private readonly lastText = new Map<string, number>();
  private readonly unsubs: Array<() => void> = [];

  constructor(host: HTMLElement, private readonly session: Session, private readonly hooks: BattleHooks) {
    const team = session.team;
    if (team === undefined) throw new Error('BattleView created before the player has a team');
    this.team = team;
    this.stage = new Stage(host, { team, framing: 'battle', shadows: true });
    this.arena = buildArena();
    this.stage.scene.add(this.arena.group, this.fx.group);

    this.zone = new THREE.Group();
    this.zone.visible = false;
    this.stage.scene.add(this.zone);

    this.ghostRing = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 40), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthWrite: false }));
    this.ghostRing.rotation.x = -Math.PI / 2;
    this.ghostRing.position.y = 0.05;
    this.ghostHolder.add(this.ghostRing);
    this.ghostHolder.visible = false;
    this.stage.scene.add(this.ghostHolder);

    this.sync();
    const onState = () => this.sync();
    session.room.onStateChange(onState);
    this.unsubs.push(() => session.room.onStateChange.remove(onState));
    this.unsubs.push(session.on('fx', (events) => {
      const at = performance.now() + INTERP_DELAY_MS;
      for (const ev of events) this.events.push({ at, value: ev });
    }));
    this.unsubs.push(this.stage.onFrame((dt, t) => this.frame(dt, t)));
    this.stage.start();
  }

  dispose() {
    for (const u of this.unsubs) u();
    for (const v of this.units.values()) v.dispose();
    for (const v of this.fainting) v.dispose();
    for (const p of this.projectiles.values()) p.dispose();
    for (const r of this.ghostRigs.values()) r.dispose();
    this.stage.dispose();
  }

  // --- Input helpers for the HUD ---

  /** Own-perspective tile point under the pointer, or null off the ground. */
  pickLocal(clientX: number, clientY: number): Point | null {
    const world = this.stage.pickGround(clientX, clientY);
    return world ? mirror(this.team, world) : null;
  }

  canDeployAt(local: Point): boolean {
    return isValidDeploy(local, openPocketsFrom(this.session.state.entities.values(), this.team));
  }

  /** Shade the area the player can't deploy into. */
  showZone(show: boolean) {
    this.zone.visible = show;
    if (!show) return;
    this.zone.clear();
    const pockets = openPocketsFrom(this.session.state.entities.values(), this.team);
    const mat = zoneMaterial();
    const rect = (x0: number, y0: number, x1: number, y1: number) => {
      const a = toScene(mirror(this.team, { x: x0, y: y0 }));
      const b = toScene(mirror(this.team, { x: x1, y: y1 }));
      const w = Math.abs(b.x - a.x);
      const d = Math.abs(b.z - a.z);
      const geo = new THREE.PlaneGeometry(w, d);
      geo.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(geo, mat);
      m.position.set((a.x + b.x) / 2, 0.07, (a.z + b.z) / 2);
      m.renderOrder = 6;
      this.zone.add(m);
    };
    rect(0, 0, ARENA_W, POCKET_MIN_Y);
    if (!pockets.has('left')) rect(0, POCKET_MIN_Y, ARENA_W / 2, DEPLOY_MIN_Y);
    if (!pockets.has('right')) rect(ARENA_W / 2, POCKET_MIN_Y, ARENA_W, DEPLOY_MIN_Y);
  }

  /** Translucent preview of the card being placed. */
  setGhost(card: CardId | null, local: Point | null) {
    if (this.ghostCard !== card) {
      for (const r of this.ghostRigs.values()) r.root.visible = false;
      this.ghostCard = card;
    }
    if (!card || !local) {
      this.ghostHolder.visible = false;
      return;
    }
    let rig = this.ghostRigs.get(card);
    if (!rig) {
      rig = buildRig(card);
      rig.fade(0.55);
      this.ghostRigs.set(card, rig);
      this.ghostHolder.add(rig.root);
    }
    rig.root.visible = true;
    rig.root.scale.setScalar(UNIT_VISUAL_SCALE);
    rig.root.position.y = rig.flyHeight;
    rig.root.rotation.y = this.team === 0 ? Math.PI : 0;
    const s = toScene(mirror(this.team, local));
    this.ghostHolder.position.set(s.x, 0, s.z);
    this.ghostHolder.visible = true;
    const valid = this.canDeployAt(local);
    const stats = CARDS[card].stats;
    this.ghostRing.scale.setScalar(stats.radius * 1.2 + (CARDS[card].count > 1 ? 0.7 : 0.25));
    (this.ghostRing.material as THREE.MeshBasicMaterial).color.set(valid ? 0xffffff : 0xff4a3d);
  }

  // --- State mirroring ---

  private sync() {
    const now = performance.now();
    const state = this.session.state;
    const seen = new Set<string>();
    state.entities.forEach((e, id) => {
      seen.add(id);
      const mine = e.team === this.team;
      if (e.kind === 'unit') {
        let v = this.units.get(id);
        if (!v) {
          v = new UnitView(id, e.team as Team, e.defId as CardId, mine, e.deploying, e.hp, e.maxHp);
          this.units.set(id, v);
          this.stage.scene.add(v.holder);
          const s = toScene(e);
          v.holder.position.set(s.x, 0, s.z);
        }
        v.buffer.push(now, e.x, e.y);
        v.hp = e.hp;
        v.maxHp = e.maxHp;
      } else {
        let t = this.towers.get(id);
        if (!t) {
          const s = toScene(e);
          t = new TowerView(id, e.team as Team, e.kind as Entity['kind'], e.defId, mine, s.x, s.z, e.hp, e.maxHp, e.active);
          this.towers.set(id, t);
          this.stage.scene.add(t.model.group);
        }
        t.hp = e.hp;
        t.setActive(e.active, this.fx);
      }
    });
    for (const id of [...this.units.keys(), ...this.towers.keys()]) {
      if (!seen.has(id) && !this.removals.some((r) => r.value === id)) this.removals.push({ at: now + INTERP_DELAY_MS, value: id });
    }

    const flying = new Set<string>();
    state.projectiles.forEach((p, id) => {
      flying.add(id);
      let v = this.projectiles.get(id);
      if (!v) {
        const s = toScene(p);
        const serverPos = new THREE.Vector3(s.x, 0, s.z);
        v = new ProjectileView(id, p.targetId, p.sourceDefId, this.muzzleFor(p.sourceDefId, p.team as Team, serverPos), serverPos);
        this.projectiles.set(id, v);
        this.stage.scene.add(v.group);
      }
      v.buffer.push(now, p.x, p.y);
    });
    for (const [id, v] of this.projectiles) {
      if (flying.has(id)) continue;
      this.projectiles.delete(id);
      this.endingProjectiles.push({ at: now + INTERP_DELAY_MS, value: v });
    }
  }

  /** The firing view's muzzle: the nearest unit or tower of that team and species. */
  private muzzleFor(defId: string, team: Team, near: THREE.Vector3): THREE.Vector3 | null {
    let best: { d: number; p: THREE.Vector3 } | null = null;
    const consider = (pos: THREE.Vector3, muzzle: () => THREE.Vector3) => {
      const d = Math.hypot(pos.x - near.x, pos.z - near.z);
      if (d < 2.5 && (!best || d < best.d)) best = { d, p: muzzle() };
    };
    for (const u of this.units.values()) if (u.team === team && u.defId === defId) consider(u.holder.position, () => u.muzzleWorld());
    for (const t of this.towers.values()) {
      if (t.team !== team) continue;
      if (t.defId === defId || (defId === 'trainer' && t.kind === 'king')) consider(t.position, () => t.muzzleWorld());
    }
    return (best as { d: number; p: THREE.Vector3 } | null)?.p ?? null;
  }

  private positionOf = (id: string): THREE.Vector3 | null => {
    const u = this.units.get(id);
    if (u) return new THREE.Vector3(u.holder.position.x, u.rig.root.position.y + u.rig.height * UNIT_VISUAL_SCALE * 0.45, u.holder.position.z);
    const t = this.towers.get(id);
    if (t) return t.bodyPoint();
    return null;
  };

  // --- Frame ---

  private frame(dt: number, t: number) {
    const now = performance.now();
    const ctx: FrameCtx = { renderTime: now - INTERP_DELAY_MS, dt, t, fx: this.fx, positionOf: this.positionOf };

    while (this.events.length > 0 && this.events[0]!.at <= now) this.applyEvent(this.events.shift()!.value);
    for (let i = this.removals.length - 1; i >= 0; i--) {
      const r = this.removals[i]!;
      if (r.at > now) continue;
      this.removals.splice(i, 1);
      const u = this.units.get(r.value);
      if (u) {
        this.units.delete(r.value);
        u.faint();
        this.fainting.push(u);
      }
      const tw = this.towers.get(r.value);
      if (tw) {
        tw.ruin(this.fx);
        this.stage.shake(tw.kind === 'king' ? 0.6 : 0.35);
      }
    }
    for (let i = this.endingProjectiles.length - 1; i >= 0; i--) {
      const p = this.endingProjectiles[i]!;
      if (p.at > now) {
        p.value.update(ctx);
        continue;
      }
      p.value.impact(this.fx);
      p.value.dispose();
      this.endingProjectiles.splice(i, 1);
    }

    this.arena.update(dt, t);
    for (const v of this.units.values()) v.update(ctx);
    for (let i = this.fainting.length - 1; i >= 0; i--) {
      const v = this.fainting[i]!;
      v.update(ctx);
      if (v.done) {
        v.dispose();
        this.fainting.splice(i, 1);
      }
    }
    for (const v of this.towers.values()) v.update(ctx);
    for (const p of this.projectiles.values()) p.update(ctx);
    for (const r of this.ghostRigs.values()) if (r.root.visible) r.animate({ t, speed: 0, walk: 0, attack: -1, hit: 0, land: 0, faint: -1, dormant: false }, dt);
    this.fx.setViewport(this.stage.host.clientHeight, this.stage.camera.fov);
    this.fx.update(dt);

    this.hooks.onBars(this.collectBars());
  }

  private applyEvent(ev: GameEvent) {
    switch (ev.type) {
      case 'attack': {
        const u = this.units.get(ev.id);
        const t = this.towers.get(ev.id);
        if (u) {
          u.attack(ev.targetId);
          this.attackFx(u.rig.attackStyle, u.muzzleWorld(), ev.targetId, u.defId);
        }
        if (t) {
          t.attack(ev.targetId);
          this.attackFx(t.occupant.attackStyle, t.muzzleWorld(), ev.targetId, t.defId);
        }
        break;
      }
      case 'hit': {
        const u = this.units.get(ev.targetId);
        const t = this.towers.get(ev.targetId);
        u?.hit();
        t?.hit();
        const at = this.positionOf(ev.targetId);
        if (at) {
          this.fx.sparks(at, ev.effectiveness === 'super' ? 0xffd93d : 0xffffff, ev.effectiveness === 'super' ? 14 : 7, 2.4);
          if (ev.effectiveness === 'super' || ev.effectiveness === 'weak' || ev.effectiveness === 'immune') this.effectivenessText(ev.targetId, at, ev.effectiveness);
        }
        break;
      }
      case 'death': {
        const at = new THREE.Vector3(toScene(ev).x, 0.5, toScene(ev).z);
        const u = this.units.get(ev.id);
        if (u && u.rig.attackStyle === 'explode') {
          this.fx.explosion(at, statsOf({ kind: 'unit', defId: u.defId }).splashRadius * 1.6);
          this.stage.shake(0.3);
          // Voltorb vanishes in its own blast instead of fainting.
          this.units.delete(ev.id);
          u.dispose();
        }
        break;
      }
      case 'spawn': {
        const s = toScene(ev);
        this.fx.ring(new THREE.Vector3(s.x, 0, s.z), teamColor(ev.team === this.team), 1.6, 0.35);
        break;
      }
    }
  }

  /** Wind-up visuals that don't belong to a projectile: breath cones, slams, punches. */
  private attackFx(style: Rig['attackStyle'], muzzle: THREE.Vector3, targetId: string, defId: string) {
    const target = this.positionOf(targetId);
    switch (style) {
      case 'breath': {
        if (!target) break;
        const dir = target.clone().sub(muzzle).normalize();
        const big = defId === 'charizard';
        for (let i = 0; i < (big ? 26 : 12); i++) {
          const v = dir.clone().multiplyScalar(3 + Math.random() * 4).add(new THREE.Vector3((Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 1.2));
          this.fx.mote(muzzle, Math.random() > 0.4 ? 0xff7a1a : 0xffd24a, big ? 0.5 : 0.32, 0.35 + Math.random() * 0.2, v);
        }
        break;
      }
      case 'cast':
        this.fx.mote(muzzle, defId === 'pikachu' ? 0xfff07a : defId === 'lapras' ? 0xd8f8ff : defId === 'squirtle' ? 0x8fd4ff : 0x9be86a, 0.8, 0.2);
        if (defId === 'pikachu') this.fx.sparks(muzzle, 0xfff07a, 8, 2);
        break;
      case 'slam':
        if (target) {
          const at = new THREE.Vector3(target.x, 0, target.z);
          setTimeout(() => {
            this.fx.ring(at, 0xf3e7c6, 2.6, 0.45);
            this.fx.dust(at, 18, 1.4);
            this.stage.shake(0.2);
          }, 260);
        }
        break;
      case 'punch':
      case 'bite':
        if (target) this.fx.sparks(target, 0xffffff, 6, 2);
        break;
      default:
        break;
    }
  }

  private effectivenessText(targetId: string, at: THREE.Vector3, kind: 'super' | 'weak' | 'immune') {
    const now = performance.now();
    if ((this.lastText.get(targetId) ?? 0) > now - 1400) return;
    this.lastText.set(targetId, now);
    const p = this.stage.project(at.clone().add(new THREE.Vector3(0, 1, 0)));
    if (!p.visible) return;
    this.hooks.onText(kind === 'super' ? "It's super effective!" : kind === 'weak' ? 'Not very effective…' : 'Barely any effect…', p.x, p.y, kind === 'super' ? 'super' : 'weak');
  }

  private collectBars(): BarInfo[] {
    const out: BarInfo[] = [];
    const v = new THREE.Vector3();
    for (const t of this.towers.values()) {
      if (!this.session.state.entities.has(t.id)) continue;
      const p = this.stage.project(t.barAnchor(v));
      out.push({ id: t.id, kind: t.kind, mine: t.mine, hp: t.hp, maxHp: t.maxHp, x: p.x, y: p.y, visible: p.visible });
    }
    for (const u of this.units.values()) {
      const p = this.stage.project(u.barAnchor(v));
      out.push({ id: u.id, kind: 'unit', mine: u.mine, hp: u.hp, maxHp: u.maxHp, x: p.x, y: p.y, visible: p.visible && u.hp < u.maxHp });
    }
    return out;
  }
}

let zoneMat: THREE.MeshBasicMaterial | null = null;

/** Red diagonal hatching for the no-deploy area. */
function zoneMaterial(): THREE.MeshBasicMaterial {
  if (zoneMat) return zoneMat;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(214,52,44,0.32)';
  g.fillRect(0, 0, 64, 64);
  g.strokeStyle = 'rgba(255,90,80,0.45)';
  g.lineWidth = 10;
  for (let i = -64; i < 128; i += 32) {
    g.beginPath();
    g.moveTo(i, 64);
    g.lineTo(i + 64, 0);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(8, 8);
  zoneMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
  return zoneMat;
}
