import * as THREE from 'three';
import {
  ARENA_W, CARDS, DEPLOY_MIN_Y, FORMS, POCKET_MIN_Y, RIVER_BOTTOM, RIVER_TOP, canDeployCard, mirror, openPocketsFrom, statsOf, unitName,
  type CardId, type Entity, type FormId, type GameEvent, type Point, type Team, type UnitId,
} from '@cop/shared';
import { sound, type PlayOpts } from '../audio/sound.js';
/** Minimal map view shared by Colyseus MapSchema and plain Maps. */
export interface MapLike<V> {
  forEach(fn: (value: V, key: string) => void): void;
  values(): IterableIterator<V>;
  has(key: string): boolean;
}

export interface EntityLike {
  id: string; team: number; kind: string; defId: string; x: number; y: number; hp: number; maxHp: number;
  deploying: boolean; active: boolean; hidden: boolean; stunned: boolean; slowed: boolean; charging: boolean;
}

export interface ProjectileLike {
  id: string; team: number; sourceDefId: string; targetId: string; x: number; y: number;
}

/**
 * Everything the 3D battle needs from a match: who we are, the mirrored state, server
 * events and a change notification. The network Session implements it; so does the
 * animation sandbox, which runs the simulation locally.
 */
export interface BattleSource {
  readonly team: Team | undefined;
  readonly state: { entities: MapLike<EntityLike>; projectiles: MapLike<ProjectileLike> };
  on(event: 'fx', fn: (events: GameEvent[]) => void): () => void;
  onStateChange(fn: () => void): () => void;
}
import { buildArena, type Arena } from './arena.js';
import { toScene } from './coords.js';
import { Fx } from './fx.js';
import { flashArc } from './moves.js';
import { INTERP_DELAY_MS } from './interp.js';
import { teamColor } from './palette.js';
import { buildRig } from './rigs/registry.js';
import { restPose, type Rig } from './rigs/pose.js';
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
  onText(text: string, x: number, y: number, tone: 'super' | 'weak' | 'special'): void;
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

  constructor(host: HTMLElement, private readonly session: BattleSource, private readonly hooks: BattleHooks, zoom?: number) {
    const team = session.team;
    if (team === undefined) throw new Error('BattleView created before the player has a team');
    this.team = team;
    this.stage = new Stage(host, { team, framing: 'battle', shadows: true, zoom });
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
    this.unsubs.push(session.onStateChange(() => this.sync()));
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

  canDeployAt(local: Point, card: CardId): boolean {
    return canDeployCard(card, local, openPocketsFrom(this.session.state.entities.values(), this.team));
  }

  /** Shade the area the player can't deploy `card` into (diggers: only the river). */
  showZone(card: CardId | null) {
    this.zone.visible = card !== null;
    if (!card) return;
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
    if (CARDS[card].stats.ability?.kind === 'dig') {
      rect(0, RIVER_TOP, ARENA_W, RIVER_BOTTOM);
      return;
    }
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
    const valid = this.canDeployAt(local, card);
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
          const king = [...this.towers.values()].find((t) => t.team === e.team && t.kind === 'king');
          v = new UnitView(id, e.team as Team, e.defId as UnitId, mine, e.deploying, e.hp, e.maxHp, { digFrom: king?.position });
          this.units.set(id, v);
          this.stage.scene.add(v.holder);
          const s = toScene(e);
          v.holder.position.set(s.x, 0, s.z);
        }
        v.buffer.push(now, e.x, e.y);
        v.hp = e.hp;
        v.maxHp = e.maxHp;
        v.applyState(e);
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

    while (this.events.length > 0 && this.events[0]!.at <= now) {
      const ev = this.events.shift()!.value;
      this.eventSound(ev);
      this.applyEvent(ev);
    }
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
    this.updateBeams(ctx);
    for (const r of this.ghostRigs.values()) if (r.root.visible) r.animate({ ...restPose(), t }, dt);
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
          this.attackFx(u.rig.attackStyle, u.muzzleWorld(), ev.targetId, u.defId, u.id);
          // Instant ranged lightning (Magneton) has no projectile: arc straight to the target.
          const stats = statsOf({ kind: 'unit', defId: u.defId });
          const target = this.positionOf(ev.targetId);
          if (target && stats.move.type === 'electric' && stats.projectileSpeed === 0 && stats.range >= 2 && stats.ability?.kind !== 'chain') {
            flashArc(this.fx, u.muzzleWorld(), target, 0.2, 0.9);
          }
        }
        if (t) {
          t.attack(ev.targetId);
          this.attackFx(t.occupant.attackStyle, t.muzzleWorld(), ev.targetId, t.defId, t.id);
        }
        break;
      }
      case 'hit': {
        const at = this.positionOf(ev.targetId);
        if (ev.damage === 0) {
          // Magikarp's Splash.
          if (at) this.flavourText(ev.targetId, at, 'But nothing happened!', 'weak');
          break;
        }
        this.units.get(ev.targetId)?.hit();
        this.towers.get(ev.targetId)?.hit();
        if (at) {
          this.fx.sparks(at, ev.effectiveness === 'super' ? 0xffd93d : 0xffffff, ev.effectiveness === 'super' ? 14 : 7, 2.4);
          if (ev.status === 'stun') this.flavourText(ev.targetId, at, 'Paralyzed!', 'special');
          else if (ev.effectiveness !== 'neutral') this.effectivenessText(ev.targetId, at, ev.effectiveness);
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
          this.takeUnit(ev.id)?.dispose();
        }
        break;
      }
      case 'blast': {
        // Geodude's Explosion: no faint, just a rock-shattering blast.
        const s = toScene(ev);
        const at = new THREE.Vector3(s.x, 0.6, s.z);
        this.takeUnit(ev.id)?.dispose();
        this.fx.explosion(at, ev.radius * 1.4);
        this.fx.rubble(at, 0x9a8f80, 18, 0.9);
        this.stage.shake(0.4);
        break;
      }
      case 'heal': {
        const s = toScene(ev);
        const healer = this.units.get(ev.id);
        healer?.pulse();
        this.fx.ring(new THREE.Vector3(s.x, 0, s.z), 0xff9ec4, ev.radius, 0.7);
        for (const id of ev.healed) {
          const at = this.positionOf(id);
          if (!at) continue;
          for (let i = 0; i < 6; i++) this.fx.mote(at.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.8, Math.random() * 0.4, (Math.random() - 0.5) * 0.8)), i % 2 ? 0x9cf07a : 0xffb3d1, 0.3, 0.8, new THREE.Vector3(0, 1.2, 0));
        }
        break;
      }
      case 'charge': {
        const u = this.units.get(ev.id);
        if (u) {
          this.fx.dust(u.holder.position, 16, 0.8);
          this.fx.ring(u.holder.position, 0xfff3d6, 1.8, 0.35);
        }
        break;
      }
      case 'evolve': {
        const at = this.positionOf(ev.id);
        if (at) this.flavourText(ev.id, at, `What? ${unitName(ev.from)} is evolving!`, 'special', true);
        break;
      }
      case 'chain': {
        // Zapdos' Thunder: one arc from the caster, then a hop to each next target.
        const caster = this.units.get(ev.path[0]!);
        let from = caster ? caster.muzzleWorld() : this.positionOf(ev.path[0]!);
        for (const id of ev.path.slice(1)) {
          const to = this.positionOf(id);
          if (!from || !to) break;
          flashArc(this.fx, from, to, 0.3, 1.1);
          from = to;
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

  // --- Sound ---

  /** Volume and stereo position for a sound at a scene point: louder on our side. */
  private soundAt(at: THREE.Vector3 | null, mine: boolean, scale = 1): PlayOpts {
    const volume = (mine ? 0.8 : 0.6) * scale;
    if (!at) return { volume };
    const p = this.stage.project(at);
    return { volume, pan: ((p.x / Math.max(1, this.stage.host.clientWidth)) * 2 - 1) * 0.7 };
  }

  private sceneAt(p: Point): THREE.Vector3 {
    const s = toScene(p);
    return new THREE.Vector3(s.x, 0.5, s.z);
  }

  private teamOf(id: string): boolean {
    return (this.units.get(id) ?? this.towers.get(id))?.mine ?? false;
  }

  private eventSound(ev: GameEvent) {
    switch (ev.type) {
      case 'attack': {
        const u = this.units.get(ev.id);
        const t = this.towers.get(ev.id);
        const who = u ?? t;
        if (!who) break;
        const stats = statsOf(u ? { kind: 'unit', defId: u.defId } : { kind: t!.kind, defId: t!.defId as Entity['defId'] });
        // Towers fire constantly; keep them under the troops.
        sound.move(stats.move.type, this.soundAt(this.positionOf(ev.id), who.mine, t ? 0.5 : 1));
        break;
      }
      case 'hit': {
        if (ev.damage === 0) break;
        const opts = this.soundAt(this.sceneAt(ev), !this.teamOf(ev.targetId));
        sound.play(ev.effectiveness === 'super' ? 'hitSuper' : ev.effectiveness === 'neutral' ? 'hit' : 'hitWeak', opts);
        if (ev.status === 'stun') sound.play('paralyze', opts);
        break;
      }
      case 'death': {
        const opts = this.soundAt(this.sceneAt(ev), ev.team === this.team);
        const u = this.units.get(ev.id);
        if (ev.kind === 'king') sound.play('kingDown', { ...opts, volume: 1 });
        else if (ev.kind === 'princess') sound.play('towerDown', { ...opts, volume: 1 });
        else if (u?.rig.attackStyle === 'explode') sound.play('explosion', opts);
        else sound.play('faint', opts);
        break;
      }
      case 'blast':
        sound.play('explosion', this.soundAt(this.sceneAt(ev), ev.team === this.team));
        break;
      case 'heal':
        sound.play('heal', this.soundAt(this.sceneAt(ev), this.teamOf(ev.id), 0.8));
        break;
      case 'charge':
        sound.play('charge', this.soundAt(this.positionOf(ev.id), this.teamOf(ev.id)));
        break;
      case 'evolve': {
        const opts = this.soundAt(this.sceneAt(ev), this.teamOf(ev.id));
        sound.play('evolve', opts);
        const form = FORMS[ev.into as FormId];
        if (form) window.setTimeout(() => sound.cry(form.dex, opts), 950);
        break;
      }
      case 'spawn': {
        // The Poké Ball lands and pops, then the Pokémon calls out.
        const opts = this.soundAt(this.sceneAt(ev), ev.team === this.team);
        sound.play('deploy', opts);
        window.setTimeout(() => sound.cry(CARDS[ev.cardId].dex, opts), 260);
        break;
      }
      case 'jump':
        sound.move('flying', this.soundAt(this.sceneAt(ev), this.teamOf(ev.id)));
        break;
      case 'slam':
        sound.play('slam', this.soundAt(this.sceneAt(ev), this.teamOf(ev.id)));
        break;
      case 'rage':
        sound.play('rage', this.soundAt(this.positionOf(ev.id), this.teamOf(ev.id)));
        break;
      case 'shieldBreak':
        sound.play('shieldBreak', this.soundAt(this.positionOf(ev.id), this.teamOf(ev.id)));
        break;
      case 'chain':
        sound.play('paralyze', this.soundAt(this.positionOf(ev.id), this.teamOf(ev.id), 0.8));
        break;
      case 'cloud':
        sound.move('poison', this.soundAt(this.sceneAt(ev), ev.team === this.team));
        break;
      case 'knock':
        sound.play('hit', this.soundAt(this.positionOf(ev.id), this.teamOf(ev.id)));
        break;
    }
  }

  /** Wind-up visuals that don't belong to a projectile: breath cones, slams, punches. */
  private attackFx(style: Rig['attackStyle'], muzzle: THREE.Vector3, targetId: string, defId: string, attackerId: string) {
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
      case 'kick':
        if (target) this.fx.sparks(target, defId === 'gengar' ? 0xb88aff : 0xffffff, 6, 2);
        if (defId === 'gengar' && target) this.fx.mote(target, 0x7a4ad8, 0.9, 0.3);
        break;
      case 'spin': {
        // Fury Cutter: a white slash ring sweeping around the attacker.
        const u = this.units.get(attackerId);
        const at = u ? u.holder.position.clone() : muzzle.clone().setY(0);
        this.fx.ring(at, 0xf4ffe8, 2.3, 0.3);
        this.fx.sparks(at.clone().setY(0.8), 0xe8fff0, 10, 3);
        break;
      }
      case 'splash':
        this.fx.splash(muzzle);
        break;
      case 'beam':
        this.feedBeam(attackerId, targetId);
        break;
      default:
        break;
    }
  }

  /** Remove a unit wherever it is (alive or mid-faint) so a blast can replace its faint. */
  private takeUnit(id: string): UnitView | undefined {
    const u = this.units.get(id);
    if (u) {
      this.units.delete(id);
      return u;
    }
    const i = this.fainting.findIndex((f) => f.id === id);
    return i >= 0 ? this.fainting.splice(i, 1)[0] : undefined;
  }

  private flavourText(id: string, at: THREE.Vector3, text: string, tone: 'weak' | 'special', always = false) {
    const now = performance.now();
    const key = `${id}:${text}`;
    if (!always && (this.lastText.get(key) ?? 0) > now - 2200) return;
    this.lastText.set(key, now);
    const p = this.stage.project(at.clone().add(new THREE.Vector3(0, 1.2, 0)));
    if (p.visible) this.hooks.onText(text, p.x, p.y, tone);
  }

  // --- Fire Spin beams ---

  private readonly beams = new Map<string, { group: THREE.Group; outer: THREE.Mesh; core: THREE.Mesh; targetId: string; hits: number; last: number; attacker: string }>();

  private feedBeam(attackerId: string, targetId: string) {
    const u = this.units.get(attackerId);
    if (!u) return;
    let b = this.beams.get(u.id);
    if (!b) {
      const geo = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true);
      geo.translate(0, 0.5, 0);
      geo.rotateX(Math.PI / 2);
      const outer = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xff7a1a, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
      const core = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
      const group = new THREE.Group();
      group.add(outer, core);
      this.stage.scene.add(group);
      b = { group, outer, core, targetId, hits: 0, last: 0, attacker: u.id };
      this.beams.set(u.id, b);
    }
    // Mirrors the server's ramp: consecutive hits on one target heat the stream up.
    b.hits = b.targetId === targetId ? b.hits + 1 : 0;
    b.targetId = targetId;
    b.last = performance.now();
  }

  private updateBeams(ctx: FrameCtx) {
    const now = performance.now();
    for (const [id, b] of this.beams) {
      const u = this.units.get(b.attacker);
      const target = this.positionOf(b.targetId);
      if (!u || !target || now - b.last > 550) {
        b.group.removeFromParent();
        b.outer.geometry.dispose();
        (b.outer.material as THREE.Material).dispose();
        (b.core.material as THREE.Material).dispose();
        this.beams.delete(id);
        continue;
      }
      const from = u.muzzleWorld();
      const len = from.distanceTo(target);
      const stage = Math.min(2, Math.floor(b.hits / 5));
      const width = [0.08, 0.15, 0.26][stage]! * (1 + Math.sin(ctx.t * 40) * 0.15);
      b.group.position.copy(from);
      b.group.lookAt(target);
      b.outer.scale.set(width * 1.8, width * 1.8, len);
      b.core.scale.set(width * 0.7, width * 0.7, len);
      (b.outer.material as THREE.MeshBasicMaterial).color.set([0xff7a1a, 0xff5a10, 0xff3a1a][stage]!);
      if (Math.random() < 0.6) this.fx.mote(from.clone().lerp(target, Math.random()), 0xffb04a, 0.25 + stage * 0.12, 0.25);
      if (Math.random() < 0.3 + stage * 0.2) this.fx.fireBurst(target, 0.25 + stage * 0.15);
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
      out.push({ id: u.id, kind: 'unit', mine: u.mine, hp: u.hp, maxHp: u.maxHp, x: p.x, y: p.y, visible: p.visible && u.barVisible && u.hp < u.maxHp });
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
