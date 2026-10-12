import * as THREE from 'three';

export type V3 = readonly [number, number, number];

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
}

export const restPose = (): Pose => ({ t: 0, speed: 0, walk: 0, attack: -1, hit: 0, land: 0, faint: -1, dormant: false });

export type AttackStyle = 'bite' | 'punch' | 'slam' | 'cast' | 'breath' | 'explode' | 'throw' | 'wing';

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
  /** 0..1 white flash over the whole model. */
  flash(amount: number): void;
  /** Fade the model out (0..1 opacity). */
  fade(opacity: number): void;
  dispose(): void;
}

const geoCache = new Map<string, THREE.BufferGeometry>();
function geo(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = geoCache.get(key);
  if (!g) {
    g = make();
    geoCache.set(key, g);
  }
  return g;
}

export interface MatOpts {
  roughness?: number;
  metalness?: number;
  emissive?: number;
  emissiveIntensity?: number;
}

/**
 * Builds one rig: primitives parented to named joints. Materials are per rig, so flashing or
 * fading one unit never touches another; geometry is shared by everyone.
 */
export class Kit {
  readonly root = new THREE.Group();
  private readonly mats = new Map<string, THREE.MeshStandardMaterial>();
  private readonly baseEmissive = new Map<THREE.MeshStandardMaterial, THREE.Color>();

  mat(color: number, o: MatOpts = {}): THREE.MeshStandardMaterial {
    const key = `${color}|${o.roughness ?? 0.6}|${o.metalness ?? 0}|${o.emissive ?? 0}|${o.emissiveIntensity ?? 1}`;
    let m = this.mats.get(key);
    if (!m) {
      m = new THREE.MeshStandardMaterial({
        color,
        roughness: o.roughness ?? 0.6,
        metalness: o.metalness ?? 0,
        emissive: o.emissive ?? 0x000000,
        emissiveIntensity: o.emissiveIntensity ?? 1,
      });
      this.mats.set(key, m);
      this.baseEmissive.set(m, m.emissive.clone());
    }
    return m;
  }

  /** A fresh material that the species animates itself (glowing cheeks, flame tips). */
  ownMat(color: number, o: MatOpts = {}): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({
      color, roughness: o.roughness ?? 0.6, metalness: o.metalness ?? 0, emissive: o.emissive ?? 0, emissiveIntensity: o.emissiveIntensity ?? 1,
    });
    this.mats.set(`own:${this.mats.size}`, m);
    this.baseEmissive.set(m, m.emissive.clone());
    return m;
  }

  joint(parent: THREE.Object3D, pos: V3 = [0, 0, 0], rot: V3 = [0, 0, 0]): THREE.Group {
    const j = new THREE.Group();
    j.position.set(...pos);
    j.rotation.set(...rot);
    parent.add(j);
    return j;
  }

  private mesh(parent: THREE.Object3D, g: THREE.BufferGeometry, m: THREE.Material, pos: V3, rot: V3, scale: V3): THREE.Mesh {
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set(...pos);
    mesh.rotation.set(...rot);
    mesh.scale.set(...scale);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  }

  /** Ellipsoid: radius r, stretched by `scale`. */
  sphere(parent: THREE.Object3D, r: number, color: number | THREE.Material, pos: V3, scale: V3 = [1, 1, 1], rot: V3 = [0, 0, 0], o?: MatOpts): THREE.Mesh {
    const g = geo('sphere', () => new THREE.SphereGeometry(1, 22, 16));
    return this.mesh(parent, g, this.m(color, o), pos, rot, [r * scale[0], r * scale[1], r * scale[2]]);
  }

  /** Capsule along local Y, total length `len` + 2r, centred on pos. */
  capsule(parent: THREE.Object3D, r: number, len: number, color: number | THREE.Material, pos: V3, rot: V3 = [0, 0, 0], scale: V3 = [1, 1, 1], o?: MatOpts): THREE.Mesh {
    const key = `capsule:${(len / r).toFixed(2)}`;
    const g = geo(key, () => new THREE.CapsuleGeometry(1, len / r, 6, 14));
    return this.mesh(parent, g, this.m(color, o), pos, rot, [r * scale[0], r * scale[1], r * scale[2]]);
  }

  /** Cone pointing +Y with its base centred `h/2` below pos. */
  cone(parent: THREE.Object3D, r: number, h: number, color: number | THREE.Material, pos: V3, rot: V3 = [0, 0, 0], scale: V3 = [1, 1, 1], o?: MatOpts): THREE.Mesh {
    const g = geo('cone', () => new THREE.ConeGeometry(1, 1, 16));
    return this.mesh(parent, g, this.m(color, o), pos, rot, [r * scale[0], h * scale[1], r * scale[2]]);
  }

  cylinder(parent: THREE.Object3D, rTop: number, rBottom: number, h: number, color: number | THREE.Material, pos: V3, rot: V3 = [0, 0, 0], o?: MatOpts): THREE.Mesh {
    const key = `cyl:${(rTop / rBottom).toFixed(2)}`;
    const g = geo(key, () => new THREE.CylinderGeometry(rTop / rBottom, 1, 1, 16));
    return this.mesh(parent, g, this.m(color, o), pos, rot, [rBottom, h, rBottom]);
  }

  box(parent: THREE.Object3D, size: V3, color: number | THREE.Material, pos: V3, rot: V3 = [0, 0, 0], o?: MatOpts): THREE.Mesh {
    const g = geo('box', () => new THREE.BoxGeometry(1, 1, 1));
    return this.mesh(parent, g, this.m(color, o), pos, rot, size);
  }

  /** Hemisphere (top half) — shells, Voltorb's halves, caps. */
  dome(parent: THREE.Object3D, r: number, color: number | THREE.Material, pos: V3, scale: V3 = [1, 1, 1], rot: V3 = [0, 0, 0], o?: MatOpts): THREE.Mesh {
    const g = geo('dome', () => new THREE.SphereGeometry(1, 22, 12, 0, Math.PI * 2, 0, Math.PI / 2));
    return this.mesh(parent, g, this.m(color, o), pos, rot, [r * scale[0], r * scale[1], r * scale[2]]);
  }

  torus(parent: THREE.Object3D, r: number, tube: number, color: number | THREE.Material, pos: V3, rot: V3 = [0, 0, 0], arc = Math.PI * 2, o?: MatOpts): THREE.Mesh {
    const key = `torus:${(tube / r).toFixed(3)}:${arc.toFixed(2)}`;
    const g = geo(key, () => new THREE.TorusGeometry(1, tube / r, 8, 24, arc));
    return this.mesh(parent, g, this.m(color, o), pos, rot, [r, r, r]);
  }

  /** A flat shape extruded thinly — wings, leaves, flames, lightning tails. */
  shape(parent: THREE.Object3D, key: string, outline: Array<[number, number]>, depth: number, color: number | THREE.Material, pos: V3, rot: V3 = [0, 0, 0], o?: MatOpts): THREE.Mesh {
    const g = geo(`shape:${key}`, () => {
      const s = new THREE.Shape();
      outline.forEach(([x, y], i) => (i === 0 ? s.moveTo(x, y) : s.lineTo(x, y)));
      s.closePath();
      const e = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelSize: depth * 0.4, bevelThickness: depth * 0.4, bevelSegments: 1 });
      e.translate(0, 0, -depth / 2);
      return e;
    });
    const mesh = this.mesh(parent, g, this.m(color, o), pos, rot, [1, 1, 1]);
    return mesh;
  }

  /**
   * A Pokémon eye: dark oval with a bright catchlight, optionally on a white sclera and with a
   * coloured iris. Faces +Z of `parent`; `yaw` turns it outward on the head.
   */
  eye(parent: THREE.Object3D, pos: V3, r: number, opts: { sclera?: boolean; iris?: number; yaw?: number; tall?: number } = {}): THREE.Group {
    const j = this.joint(parent, pos, [0, opts.yaw ?? 0, 0]);
    const tall = opts.tall ?? 1.3;
    if (opts.sclera) this.sphere(j, r * 1.25, 0xf7f7f2, [0, 0, -r * 0.2], [1, tall, 0.5], [0, 0, 0], { roughness: 0.3 });
    if (opts.iris !== undefined) this.sphere(j, r, opts.iris, [0, 0, 0], [0.85, tall * 0.9, 0.5], [0, 0, 0], { roughness: 0.3 });
    this.sphere(j, opts.iris !== undefined ? r * 0.55 : r, 0x1c1c22, [0, 0, r * 0.12], [1, tall, 0.5], [0, 0, 0], { roughness: 0.25 });
    this.sphere(j, r * 0.32, 0xffffff, [r * 0.3, r * 0.45, r * 0.38], [1, 1, 0.5], [0, 0, 0], { roughness: 0.1, emissive: 0xffffff, emissiveIntensity: 0.4 });
    return j;
  }

  private m(color: number | THREE.Material, o?: MatOpts): THREE.Material {
    return typeof color === 'number' ? this.mat(color, o) : color;
  }

  flash(amount: number) {
    for (const [m, base] of this.baseEmissive) {
      m.emissive.copy(base).lerp(WHITE, amount);
    }
  }

  fade(opacity: number) {
    for (const m of this.baseEmissive.keys()) {
      m.transparent = opacity < 1;
      m.opacity = opacity;
      m.depthWrite = opacity >= 1;
    }
  }

  dispose() {
    for (const m of this.baseEmissive.keys()) m.dispose();
  }
}

const WHITE = new THREE.Color(0xffffff);

export interface RigParts {
  height: number;
  flyHeight?: number;
  muzzle: THREE.Object3D;
  attackStyle: AttackStyle;
  attackDuration?: number;
  animate(p: Pose, dt: number): void;
}

/** Wraps a built kit into a Rig. */
export function finishRig(kit: Kit, parts: RigParts): Rig {
  return {
    root: kit.root,
    height: parts.height,
    flyHeight: parts.flyHeight ?? 0,
    muzzle: parts.muzzle,
    attackStyle: parts.attackStyle,
    attackDuration: parts.attackDuration ?? 0.5,
    animate: parts.animate,
    flash: (a) => kit.flash(a),
    fade: (o) => kit.fade(o),
    dispose: () => kit.dispose(),
  };
}
