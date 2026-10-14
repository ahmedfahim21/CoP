import * as THREE from 'three';
import type { Fx } from './fx.js';
import { litMat } from './style/toon.js';

/**
 * What each move looks like in flight. A projectile's head is placed and aimed by
 * ProjectileView; anything that spans from the attacker to the head (a water jet, an
 * electric arc, an ice beam) lives in world space beside it.
 */

export type MoveLook = 'water' | 'electric' | 'fire' | 'grass' | 'ice' | 'psychic' | 'stars' | 'pokeball' | 'boulder' | 'plain';

export interface MoveFrame {
  /** Where the shot left the attacker. */
  origin: THREE.Vector3;
  /** The head, this frame. */
  head: THREE.Vector3;
  /** 0 at the muzzle, 1 on the target. */
  progress: number;
  dt: number;
  t: number;
  fx: Fx;
}

export interface MoveVisual {
  /** Placed at the head and aimed along the flight. */
  readonly head: THREE.Group;
  /** World-space extras (jets, arcs, beams); never moved. */
  readonly span: THREE.Group;
  update(f: MoveFrame): void;
  impact(fx: Fx, at: THREE.Vector3): void;
  dispose(): void;
}

// --- A tube whose centre line and radius are rewritten in place every frame ---------

const RADIAL = 7;

/** Tube along a polyline with per-point radius; positions are rewritten in place, no reallocation. */
export class LiveTube {
  readonly mesh: THREE.Mesh;
  private readonly pos: Float32Array;
  private readonly n: number;
  private readonly tangent = new THREE.Vector3();
  private readonly side = new THREE.Vector3();
  private readonly up = new THREE.Vector3();

  constructor(points: number, material: THREE.Material) {
    this.n = points;
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(points * RADIAL * 3);
    const uv = new Float32Array(points * RADIAL * 2);
    const index: number[] = [];
    for (let i = 0; i < points; i++) {
      for (let j = 0; j < RADIAL; j++) {
        uv[(i * RADIAL + j) * 2] = i / (points - 1);
        uv[(i * RADIAL + j) * 2 + 1] = j / RADIAL;
        if (i < points - 1) {
          const a = i * RADIAL + j;
          const b = i * RADIAL + ((j + 1) % RADIAL);
          index.push(a, a + RADIAL, b, b, a + RADIAL, b + RADIAL);
        }
      }
    }
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(index);
    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.frustumCulled = false;
  }

  /** `at(i)` fills the i-th centre point; `radius(u)` is the radius at u in 0..1. */
  set(at: (i: number, out: THREE.Vector3) => void, radius: (u: number) => number) {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < this.n; i++) {
      const p = new THREE.Vector3();
      at(i, p);
      pts.push(p);
    }
    for (let i = 0; i < this.n; i++) {
      const a = pts[Math.max(0, i - 1)]!;
      const b = pts[Math.min(this.n - 1, i + 1)]!;
      this.tangent.subVectors(b, a).normalize();
      // Any vector not parallel to the tangent gives a stable frame for a short span.
      this.side.set(0, 1, 0).cross(this.tangent);
      if (this.side.lengthSq() < 1e-6) this.side.set(1, 0, 0);
      this.side.normalize();
      this.up.crossVectors(this.tangent, this.side).normalize();
      const r = radius(i / (this.n - 1));
      for (let j = 0; j < RADIAL; j++) {
        const a2 = (j / RADIAL) * Math.PI * 2;
        const c = Math.cos(a2) * r;
        const s = Math.sin(a2) * r;
        const k = (i * RADIAL + j) * 3;
        this.pos[k] = pts[i]!.x + this.side.x * c + this.up.x * s;
        this.pos[k + 1] = pts[i]!.y + this.side.y * c + this.up.y * s;
        this.pos[k + 2] = pts[i]!.z + this.side.z * c + this.up.z * s;
      }
    }
    const attr = this.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    attr.needsUpdate = true;
  }

  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

// --- Materials ------------------------------------------------------------------------

/**
 * Light, not matter: glowing parts never write depth, so the outline pass leaves them alone
 * and they read as bright energy. Translucent glow adds, so overlapping strands bloom.
 */
const glow = (color: number, opacity = 1) =>
  new THREE.MeshBasicMaterial({
    color, toneMapped: false, transparent: true, opacity, depthWrite: false,
    blending: opacity < 1 ? THREE.AdditiveBlending : THREE.NormalBlending,
  });

/** Water: bright body with foam bands rushing along the stream. */
function waterMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    // Liquid, not a solid rod: no depth write, so the outline pass doesn't ink it.
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying vec2 vUv;
      void main() {
        float around = sin(vUv.y * 6.2832);
        // Foam streaks rushing down the stream, broken up around the circumference.
        float band = fract(vUv.x * 5.0 - uTime * 6.0 + around * 0.18);
        float streak = step(0.5, fract(vUv.y * 3.0 + vUv.x * 2.0 - uTime * 2.0));
        float foam = smoothstep(0.7, 0.82, band) * (1.0 - smoothstep(0.82, 0.92, band)) * streak;
        vec3 deep = vec3(0.04, 0.38, 0.9);
        vec3 mid = vec3(0.2, 0.66, 1.0);
        vec3 col = mix(deep, mid, 0.5 + 0.5 * around);
        col = mix(col, vec3(0.9, 0.98, 1.0), foam);
        gl_FragColor = vec4(col, 0.88);
      }`,
  });
}

// --- Shared geometry --------------------------------------------------------------------

const geo = {
  sphere: new THREE.SphereGeometry(1, 14, 10),
  cone: new THREE.ConeGeometry(1, 1, 10).rotateX(-Math.PI / 2).translate(0, 0, -0.5),
  crystal: new THREE.OctahedronGeometry(1, 0),
  dome: new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2),
  ring: new THREE.TorusGeometry(1, 0.16, 6, 24),
  rock: new THREE.DodecahedronGeometry(1, 0),
  leaf: (() => {
    const s = new THREE.Shape();
    s.moveTo(0, -0.5);
    s.quadraticCurveTo(0.45, 0, 0, 0.5);
    s.quadraticCurveTo(-0.45, 0, 0, -0.5);
    return new THREE.ShapeGeometry(s);
  })(),
  star: (() => {
    const s = new THREE.Shape();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? 1 : 0.45;
      const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
      if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      else s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    s.closePath();
    return new THREE.ExtrudeGeometry(s, { depth: 0.3, bevelEnabled: false }).translate(0, 0, -0.15);
  })(),
};

function part(g: THREE.BufferGeometry, m: THREE.Material, s: number): THREE.Mesh {
  const out = new THREE.Mesh(g, m);
  out.scale.setScalar(s);
  return out;
}

const tmp = new THREE.Vector3();
const across = new THREE.Vector3();
const lift = new THREE.Vector3();

/** Unit vectors perpendicular to a→b, for waving a line about its axis. */
function perpendiculars(a: THREE.Vector3, b: THREE.Vector3, outSide: THREE.Vector3, outUp: THREE.Vector3) {
  tmp.subVectors(b, a).normalize();
  outSide.set(0, 1, 0).cross(tmp);
  if (outSide.lengthSq() < 1e-6) outSide.set(1, 0, 0);
  outSide.normalize();
  outUp.crossVectors(tmp, outSide).normalize();
}

// --- Electricity: waving, crackling strands ------------------------------------------

/**
 * Lightning between two points drawn as waves: two strands that wind around the line in
 * sine waves, with jagged jitter re-rolled a few times a second so the arc crackles.
 */
export class Arc {
  readonly group = new THREE.Group();
  private readonly strands: Array<{ core: LiveTube; halo: LiveTube; phase: number; seed: number[] }> = [];
  private reroll = 0;
  private readonly points = 18;

  constructor(private readonly width = 1) {
    for (let k = 0; k < 2; k++) {
      const core = new LiveTube(this.points, glow(k === 0 ? 0xfffbe0 : 0xfff3a0));
      const halo = new LiveTube(this.points, glow(0xffc21a, 0.55));
      this.group.add(halo.mesh, core.mesh);
      this.strands.push({ core, halo, phase: k * Math.PI, seed: [] });
    }
  }

  /** Redraw from `a` to `b`. */
  update(a: THREE.Vector3, b: THREE.Vector3, dt: number, t: number) {
    this.reroll -= dt;
    const fresh = this.reroll <= 0;
    if (fresh) this.reroll = 0.06;
    perpendiculars(a, b, across, lift);
    const len = a.distanceTo(b);
    const waves = Math.max(1.5, len * 0.9);
    for (const s of this.strands) {
      if (fresh || s.seed.length === 0) s.seed = Array.from({ length: this.points }, () => Math.random() - 0.5);
      const at = (i: number, out: THREE.Vector3) => {
        const u = i / (this.points - 1);
        // Pinned at both ends, widest in the middle.
        const env = Math.sin(u * Math.PI);
        const w = Math.sin(u * Math.PI * waves * 2 - t * 26 + s.phase) * 0.22 * this.width * env;
        const jag = s.seed[i]! * 0.16 * this.width * env;
        out.lerpVectors(a, b, u).addScaledVector(across, w + jag).addScaledVector(lift, Math.cos(u * Math.PI * waves * 2 - t * 26 + s.phase) * 0.12 * this.width * env + jag * 0.6);
      };
      s.core.set(at, () => 0.05 * this.width);
      s.halo.set(at, () => 0.17 * this.width);
    }
  }

  dispose() {
    for (const s of this.strands) {
      s.core.dispose();
      s.halo.dispose();
    }
    this.group.removeFromParent();
  }
}

/** An instant arc between two points that fades out on its own (chain lightning, Thunder Shock). */
export function flashArc(fx: Fx, a: THREE.Vector3, b: THREE.Vector3, seconds = 0.22, width = 1) {
  const arc = new Arc(width);
  let life = seconds;
  let t = 0;
  arc.update(a, b, 0, 0);
  fx.addEffect({
    object: arc.group,
    update(dt) {
      life -= dt;
      t += dt;
      arc.update(a, b, dt, t);
      arc.group.visible = life > seconds * 0.15 || Math.sin(t * 90) > 0;
      return life > 0;
    },
    dispose: () => arc.dispose(),
  });
  fx.electric(b);
  electricWaves(fx, b);
}

/** Concentric electric rings pulsing out from a hit. */
function electricWaves(fx: Fx, at: THREE.Vector3) {
  fx.ring(at, 0xfff07a, 1.4, 0.3);
  fx.ring(at, 0xffd23a, 2.1, 0.45);
}

// --- Visuals per move -------------------------------------------------------------------

abstract class BaseVisual implements MoveVisual {
  readonly head = new THREE.Group();
  readonly span = new THREE.Group();
  abstract update(f: MoveFrame): void;
  abstract impact(fx: Fx, at: THREE.Vector3): void;
  dispose() {
    for (const root of [this.head, this.span]) {
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        // Shared geometry stays; materials are per projectile.
        (m.material as THREE.Material).dispose();
      });
      root.removeFromParent();
    }
  }
}

/** Water Gun / Hydro Pump: a real jet arcing from the mouth to the head, shedding droplets. */
class WaterVisual extends BaseVisual {
  private readonly jet = new LiveTube(16, waterMaterial());
  constructor(private readonly big: boolean) {
    super();
    this.span.add(this.jet.mesh);
    this.head.add(part(geo.sphere, glow(0xd6f4ff), big ? 0.26 : 0.18));
  }
  update(f: MoveFrame) {
    const mat = this.jet.mesh.material as THREE.ShaderMaterial;
    mat.uniforms.uTime!.value = f.t;
    // The tail of the stream catches up as the shot lands, so the jet detaches at the end.
    const tail = Math.max(0, f.progress - 0.55) / 0.45;
    const r = this.big ? 0.28 : 0.17;
    perpendiculars(f.origin, f.head, across, lift);
    const len = f.origin.distanceTo(f.head);
    this.jet.set(
      (i, out) => {
        const u = tail + (1 - tail) * (i / 15);
        out.lerpVectors(f.origin, f.head, u);
        // A slight upward bow like pressurised water, and a hose-like wobble along it.
        out.y += Math.sin(u * Math.PI) * 0.03 * len;
        const wobble = Math.sin(u * 14 - f.t * 22) * 0.06 * Math.sin(u * Math.PI);
        out.addScaledVector(across, wobble);
      },
      // Thin at the mouth, full at the front, pulsing in bulges as it surges.
      (u) => r * (0.5 + 0.5 * u) * (1 + Math.sin(u * 24 - f.t * 36) * 0.22),
    );
    // Spray: droplets thrown off the stream and a fizz around the leading edge.
    for (let k = 0; k < 2; k++) {
      const along = f.origin.clone().lerp(f.head, 0.25 + Math.random() * 0.75);
      f.fx.mote(along, Math.random() > 0.4 ? 0x7fcaff : 0xe6f7ff, 0.16, 0.45, new THREE.Vector3((Math.random() - 0.5) * 1.4, 0.6 + Math.random() * 1.2, (Math.random() - 0.5) * 1.4));
    }
    f.fx.mote(f.head, 0xeaf9ff, this.big ? 0.5 : 0.36, 0.12);
  }
  impact(fx: Fx, at: THREE.Vector3) {
    fx.splash(at);
    fx.splash(at);
    fx.ring(at, 0x8fd4ff, this.big ? 2 : 1.3, 0.5);
    fx.ring(at, 0xe0f6ff, this.big ? 1.2 : 0.8, 0.35);
  }
}

/** Thunderbolt / Thunder Shock: a crackling ball with waves of lightning trailing to the caster. */
class ElectricVisual extends BaseVisual {
  private readonly arc = new Arc(0.9);
  constructor() {
    super();
    this.span.add(this.arc.group);
    this.head.add(part(geo.sphere, glow(0xfffbe0), 0.14), part(geo.sphere, glow(0xffe14a, 0.5), 0.3));
  }
  update(f: MoveFrame) {
    this.arc.update(f.origin, f.head, f.dt, f.t);
    const pulse = 1 + Math.sin(f.t * 50) * 0.2;
    this.head.children[1]!.scale.setScalar(0.3 * pulse);
    if (Math.random() < 0.6) f.fx.sparks(f.head, 0xfff07a, 1, 2);
  }
  impact(fx: Fx, at: THREE.Vector3) {
    fx.electric(at);
    electricWaves(fx, at);
    // A last forked flash into the ground.
    flashArc(fx, at, at.clone().setY(0.05).add(new THREE.Vector3((Math.random() - 0.5) * 1.4, 0, (Math.random() - 0.5) * 1.4)), 0.15, 0.6);
  }
  override dispose() {
    this.arc.dispose();
    super.dispose();
  }
}

/** Ember: a fireball with flickering flame tongues and a trail of embers and smoke. */
class FireVisual extends BaseVisual {
  private readonly tongues: THREE.Mesh[];
  constructor() {
    super();
    const core = part(geo.sphere, glow(0xfff1a8), 0.15);
    const shell = part(geo.sphere, glow(0xffa12a, 0.75), 0.24);
    this.tongues = [part(geo.cone, glow(0xff7a1a, 0.8), 0.22), part(geo.cone, glow(0xe8401c, 0.6), 0.28)];
    this.head.add(...this.tongues, shell, core);
  }
  update(f: MoveFrame) {
    this.tongues.forEach((m, i) => {
      const k = 1 + Math.sin(f.t * (37 + i * 11)) * 0.25;
      m.scale.set(0.22 + i * 0.06, 0.22 + i * 0.06, (0.55 + i * 0.25) * k);
    });
    f.fx.mote(f.head, 0xff8a2a, 0.5, 0.28);
    f.fx.mote(f.head, 0xffd24a, 0.3, 0.42, new THREE.Vector3((Math.random() - 0.5) * 0.6, 0.6 + Math.random() * 0.6, (Math.random() - 0.5) * 0.6));
    if (Math.random() < 0.2) f.fx.smoke(f.head, 1, 0x6e6660);
  }
  impact(fx: Fx, at: THREE.Vector3) {
    fx.fireBurst(at, 1);
    fx.ring(at, 0xff9a3a, 1.2, 0.35);
  }
}

/** Razor Leaf: spinning blades leaving a green slipstream. */
class GrassVisual extends BaseVisual {
  private readonly spinner = new THREE.Group();
  constructor() {
    super();
    this.head.add(this.spinner);
    for (let i = 0; i < 3; i++) {
      const leaf = new THREE.Mesh(geo.leaf, litMat({ color: i === 1 ? 0x7fd14f : 0x4fae3a, side: THREE.DoubleSide, flat: false }));
      leaf.scale.setScalar(0.42);
      leaf.position.set(Math.cos((i / 3) * Math.PI * 2) * 0.2, Math.sin((i / 3) * Math.PI * 2) * 0.2, 0);
      leaf.rotation.z = (i / 3) * Math.PI * 2;
      this.spinner.add(leaf);
    }
  }
  update(f: MoveFrame) {
    this.spinner.rotation.z += f.dt * 22;
    f.fx.mote(f.head, 0x9be86a, 0.22, 0.3);
    if (Math.random() < 0.4) f.fx.mote(f.head, 0xd9ffb0, 0.14, 0.5);
  }
  impact(fx: Fx, at: THREE.Vector3) {
    fx.leaves(at);
    fx.leaves(at);
    fx.sparks(at, 0xd9ffb0, 6, 2.5);
  }
}

/** Ice Beam: a pale beam from the caster to a spinning crystal, frost blowing off it. */
class IceVisual extends BaseVisual {
  private readonly crystal: THREE.Mesh;
  private readonly beam = new LiveTube(8, glow(0x7fdcff, 0.65));
  private readonly core = new LiveTube(8, glow(0xf2fdff, 1));
  constructor() {
    super();
    this.span.add(this.beam.mesh, this.core.mesh);
    this.crystal = part(geo.crystal, litMat({ color: 0xd8f8ff, emissive: 0x4fc3e8, emissiveIntensity: 0.7 }), 0.2);
    this.crystal.scale.set(0.24, 0.24, 0.48);
    this.head.add(this.crystal);
  }
  update(f: MoveFrame) {
    const tail = Math.max(0, f.progress - 0.6) / 0.4;
    const at = (i: number, out: THREE.Vector3) => out.lerpVectors(f.origin, f.head, tail + (1 - tail) * (i / 7));
    this.beam.set(at, (u) => 0.17 * (0.7 + 0.3 * Math.sin(u * 20 - f.t * 30)));
    this.core.set(at, () => 0.06);
    this.crystal.rotation.z += f.dt * 9;
    if (Math.random() < 0.7) f.fx.mote(f.origin.clone().lerp(f.head, Math.random()), 0xe8fbff, 0.2, 0.5, new THREE.Vector3(0, -0.4, 0));
  }
  impact(fx: Fx, at: THREE.Vector3) {
    fx.frost(at);
    fx.ring(at, 0xc8f4ff, 1.4, 0.5);
  }
  override dispose() {
    this.beam.dispose();
    this.core.dispose();
    super.dispose();
  }
}

/** Psybeam: rings of shifting colour pulsing down the line. */
class PsychicVisual extends BaseVisual {
  private readonly rings: THREE.Mesh[] = [];
  constructor() {
    super();
    for (let i = 0; i < 4; i++) {
      const r = part(geo.ring, glow(0xff7ad9, 0.85), 0.24);
      r.position.z = -i * 0.4;
      this.rings.push(r);
      this.head.add(r);
    }
  }
  update(f: MoveFrame) {
    const hues = [0xff7ad9, 0xb07aff, 0x7ad6ff, 0xffe07a];
    this.rings.forEach((r, i) => {
      const k = (f.t * 3 + i * 0.25) % 1;
      r.scale.setScalar(0.28 + 0.2 * Math.sin(k * Math.PI));
      (r.material as THREE.MeshBasicMaterial).color.set(hues[(i + Math.floor(f.t * 8)) % hues.length]!);
    });
  }
  impact(fx: Fx, at: THREE.Vector3) {
    fx.sparks(at, 0xff9ee6, 12, 2.5);
    fx.ring(at, 0xd08aff, 1.6, 0.5);
    fx.ring(at, 0xff7ad9, 1, 0.35);
  }
}

/** Swift: a cluster of spinning gold stars that never misses. */
class StarsVisual extends BaseVisual {
  private readonly stars: THREE.Mesh[] = [];
  constructor() {
    super();
    for (let i = 0; i < 3; i++) {
      const s = part(geo.star, litMat({ color: 0xffd84a, emissive: 0xffb000, emissiveIntensity: 0.6, flat: false }), 0.27);
      this.stars.push(s);
      this.head.add(s);
    }
  }
  update(f: MoveFrame) {
    this.stars.forEach((s, i) => {
      const a = f.t * 9 + (i / 3) * Math.PI * 2;
      s.position.set(Math.cos(a) * 0.32, Math.sin(a) * 0.32, -i * 0.22);
      s.rotation.z = f.t * 14;
    });
    if (Math.random() < 0.6) f.fx.mote(f.head, 0xfff2a0, 0.2, 0.35);
  }
  impact(fx: Fx, at: THREE.Vector3) {
    fx.sparks(at, 0xffe27a, 14, 3);
    fx.mote(at, 0xffffff, 0.9, 0.15);
  }
}

/** The trainer's Poké Ball, lobbed end over end. */
class PokeBallVisual extends BaseVisual {
  private readonly spinner = new THREE.Group();
  constructor() {
    super();
    this.head.add(this.spinner);
    const top = part(geo.dome, litMat({ color: 0xe5483f, flat: false }), 0.15);
    const bottom = part(geo.dome, litMat({ color: 0xf3f1ea, flat: false }), 0.15);
    bottom.rotation.x = Math.PI;
    this.spinner.add(top, bottom);
  }
  update(f: MoveFrame) {
    this.spinner.rotation.x += f.dt * 14;
  }
  impact(fx: Fx, at: THREE.Vector3) {
    fx.sparks(at, 0xffffff, 10, 2.5);
    fx.mote(at, 0xffffff, 0.8, 0.12);
    fx.smoke(at, 3, 0xf0ece4);
  }
}

/** Rollout: a boulder bowling along the ground. */
class BoulderVisual extends BaseVisual {
  private readonly rock: THREE.Mesh;
  constructor() {
    super();
    this.rock = part(geo.rock, litMat({ color: 0x9c8f7a }), 0.42);
    this.head.add(this.rock);
  }
  update(f: MoveFrame) {
    this.rock.rotateX(f.dt * 9);
    if (Math.random() < 0.5) f.fx.dust(f.head.clone().setY(0), 2, 0.4);
  }
  impact(fx: Fx, at: THREE.Vector3) {
    fx.rubble(at.clone().setY(0.4), 0x9c8f7a, 8, 0.6);
    fx.dust(at, 12, 0.8);
  }
}

class PlainVisual extends BaseVisual {
  constructor(color: number) {
    super();
    this.head.add(part(geo.sphere, glow(0xffffff), 0.12), part(geo.sphere, glow(color, 0.6), 0.24));
  }
  update(f: MoveFrame) {
    f.fx.mote(f.head, 0xffffff, 0.25, 0.2);
  }
  impact(fx: Fx, at: THREE.Vector3) {
    fx.sparks(at, 0xffffff, 10, 2.5);
  }
}

export function moveVisual(look: MoveLook, big: boolean): MoveVisual {
  switch (look) {
    case 'water': return new WaterVisual(big);
    case 'electric': return new ElectricVisual();
    case 'fire': return new FireVisual();
    case 'grass': return new GrassVisual();
    case 'ice': return new IceVisual();
    case 'psychic': return new PsychicVisual();
    case 'stars': return new StarsVisual();
    case 'pokeball': return new PokeBallVisual();
    case 'boulder': return new BoulderVisual();
    case 'plain': return new PlainVisual(0xc8b8ff);
  }
}
