import * as THREE from 'three';
import { litMat } from './style/toon.js';
import { seeded } from './palette.js';

/**
 * One GPU particle system per blend mode. Each particle is a camera-facing soft disc with its
 * own colour, size and fade; all of it lives in typed arrays, one draw call per system.
 */
class ParticleSystem {
  readonly points: THREE.Points;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly size: Float32Array;
  private readonly alpha: Float32Array;
  private readonly vel: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly startSize: Float32Array;
  private readonly endSize: Float32Array;
  private readonly gravity: Float32Array;
  private readonly drag: Float32Array;
  private cursor = 0;

  constructor(private readonly capacity: number, additive: boolean) {
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 3);
    this.size = new Float32Array(capacity);
    this.alpha = new Float32Array(capacity);
    this.vel = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.startSize = new Float32Array(capacity);
    this.endSize = new Float32Array(capacity);
    this.gravity = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      vertexColors: true,
      uniforms: { uScale: { value: 600 } },
      vertexShader: /* glsl */ `
        attribute float size;
        attribute float alpha;
        varying vec3 vColor;
        varying float vAlpha;
        uniform float uScale;
        void main() {
          vColor = color;
          vAlpha = alpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * uScale / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - 0.5) * 2.0;
          float a = smoothstep(1.0, 0.35, d) * vAlpha;
          if (a < 0.01) discard;
          gl_FragColor = vec4(vColor, a);
          #include <colorspace_fragment>
        }`,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 20 : 10;
  }

  setViewportScale(heightPx: number, fovDeg: number) {
    (this.points.material as THREE.ShaderMaterial).uniforms.uScale!.value = heightPx / (2 * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2));
  }

  emit(p: { x: number; y: number; z: number; vx: number; vy: number; vz: number; color: THREE.Color; life: number; size: number; endSize?: number; gravity?: number; drag?: number }) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.capacity;
    this.pos.set([p.x, p.y, p.z], i * 3);
    this.vel.set([p.vx, p.vy, p.vz], i * 3);
    this.col.set([p.color.r, p.color.g, p.color.b], i * 3);
    this.life[i] = p.life;
    this.maxLife[i] = p.life;
    this.startSize[i] = p.size;
    this.endSize[i] = p.endSize ?? p.size * 0.2;
    this.gravity[i] = p.gravity ?? 0;
    this.drag[i] = p.drag ?? 1.5;
  }

  update(dt: number) {
    for (let i = 0; i < this.capacity; i++) {
      if (this.life[i]! <= 0) {
        this.alpha[i] = 0;
        continue;
      }
      this.life[i]! -= dt;
      const k = Math.max(0, this.life[i]! / this.maxLife[i]!);
      const d = Math.exp(-this.drag[i]! * dt);
      this.vel[i * 3]! *= d;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1]! * d - this.gravity[i]! * dt;
      this.vel[i * 3 + 2]! *= d;
      this.pos[i * 3]! += this.vel[i * 3]! * dt;
      this.pos[i * 3 + 1] = Math.max(0.02, this.pos[i * 3 + 1]! + this.vel[i * 3 + 1]! * dt);
      this.pos[i * 3 + 2]! += this.vel[i * 3 + 2]! * dt;
      this.size[i] = this.endSize[i]! + (this.startSize[i]! - this.endSize[i]!) * k;
      // Quick fade in, long fade out.
      this.alpha[i] = Math.min(1, (1 - k) * 8) * k;
    }
    const geo = this.points.geometry;
    for (const name of ['position', 'color', 'size', 'alpha']) geo.attributes[name]!.needsUpdate = true;
  }
}

interface Debris {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  life: number;
}

interface Ring {
  mesh: THREE.Mesh;
  life: number;
  maxLife: number;
  maxScale: number;
}

const tmpColor = new THREE.Color();

/** Effects library: every call is fire-and-forget, positioned in scene space. */
export class Fx {
  readonly group = new THREE.Group();
  private readonly glow = new ParticleSystem(1400, true);
  private readonly soft = new ParticleSystem(900, false);
  private readonly debris: Debris[] = [];
  private readonly rings: Ring[] = [];
  private readonly rnd = seeded(99);
  private readonly debrisGeo = new THREE.DodecahedronGeometry(0.09, 0);
  private readonly ringGeo = new THREE.RingGeometry(0.82, 1, 40);

  constructor() {
    this.group.add(this.glow.points, this.soft.points);
  }

  setViewport(heightPx: number, fovDeg: number) {
    this.glow.setViewportScale(heightPx, fovDeg);
    this.soft.setViewportScale(heightPx, fovDeg);
  }

  update(dt: number) {
    this.glow.update(dt);
    this.soft.update(dt);
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i]!;
      d.life -= dt;
      d.vel.y -= 12 * dt;
      d.mesh.position.addScaledVector(d.vel, dt);
      if (d.mesh.position.y < 0.05) {
        d.mesh.position.y = 0.05;
        d.vel.multiplyScalar(0.4);
        d.vel.y = Math.abs(d.vel.y) * 0.3;
      }
      d.mesh.rotation.x += d.spin.x * dt;
      d.mesh.rotation.y += d.spin.y * dt;
      if (d.life < 0.4) d.mesh.scale.setScalar(Math.max(0.001, d.life / 0.4) * d.mesh.userData.s);
      if (d.life <= 0) {
        this.group.remove(d.mesh);
        this.debris.splice(i, 1);
      }
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i]!;
      r.life -= dt;
      const k = 1 - r.life / r.maxLife;
      r.mesh.scale.setScalar(0.2 + (r.maxScale - 0.2) * (1 - (1 - k) ** 3));
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - k) * 0.85;
      if (r.life <= 0) {
        this.group.remove(r.mesh);
        (r.mesh.material as THREE.Material).dispose();
        this.rings.splice(i, 1);
      }
    }
  }

  private r(a = 1) {
    return (this.rnd() - 0.5) * 2 * a;
  }

  /** Puff of dust kicked up from the ground. */
  dust(at: THREE.Vector3, count = 14, spread = 0.6, color = 0xe9dcc0) {
    for (let i = 0; i < count; i++) {
      const a = this.rnd() * Math.PI * 2;
      const sp = 0.8 + this.rnd() * 1.6;
      this.soft.emit({
        x: at.x + Math.cos(a) * spread * 0.4, y: 0.1, z: at.z + Math.sin(a) * spread * 0.4,
        vx: Math.cos(a) * sp, vy: 0.5 + this.rnd() * 0.8, vz: Math.sin(a) * sp,
        color: tmpColor.set(color), life: 0.5 + this.rnd() * 0.4, size: 0.35 + this.rnd() * 0.3, endSize: 0.7, drag: 3,
      });
    }
  }

  /** Bright sparks on impact. */
  sparks(at: THREE.Vector3, color: number, count = 12, speed = 3) {
    for (let i = 0; i < count; i++) {
      this.glow.emit({
        x: at.x, y: at.y, z: at.z,
        vx: this.r(speed), vy: this.rnd() * speed, vz: this.r(speed),
        color: tmpColor.set(color), life: 0.25 + this.rnd() * 0.25, size: 0.18 + this.rnd() * 0.12, gravity: 6, drag: 2,
      });
    }
  }

  /** A soft glowing mote — trails, muzzle flashes, embers. */
  mote(at: THREE.Vector3, color: number, size = 0.3, life = 0.3, vel?: THREE.Vector3) {
    this.glow.emit({
      x: at.x, y: at.y, z: at.z, vx: vel?.x ?? this.r(0.2), vy: vel?.y ?? this.r(0.2), vz: vel?.z ?? this.r(0.2),
      color: tmpColor.set(color), life, size, endSize: size * 0.1, drag: 2,
    });
  }

  smoke(at: THREE.Vector3, count = 10, color = 0x8b857a) {
    for (let i = 0; i < count; i++) {
      this.soft.emit({
        x: at.x + this.r(0.4), y: at.y + this.rnd() * 0.4, z: at.z + this.r(0.4),
        vx: this.r(0.5), vy: 0.8 + this.rnd() * 1.2, vz: this.r(0.5),
        color: tmpColor.set(color), life: 0.9 + this.rnd() * 0.8, size: 0.5 + this.rnd() * 0.4, endSize: 1.4, drag: 1.2,
      });
    }
  }

  /** Fire burst: hot core sparks plus rising smoke. */
  fireBurst(at: THREE.Vector3, scale = 1) {
    for (let i = 0; i < 18 * scale; i++) {
      const c = this.rnd() > 0.4 ? 0xff7a1a : 0xffd24a;
      this.glow.emit({
        x: at.x, y: at.y, z: at.z, vx: this.r(2.2 * scale), vy: this.rnd() * 2.5 * scale, vz: this.r(2.2 * scale),
        color: tmpColor.set(c), life: 0.35 + this.rnd() * 0.3, size: 0.4 * scale + this.rnd() * 0.25, endSize: 0.05, drag: 3,
      });
    }
    this.smoke(at, Math.round(5 * scale), 0x5e5953);
  }

  splash(at: THREE.Vector3) {
    for (let i = 0; i < 16; i++) {
      this.glow.emit({
        x: at.x, y: at.y, z: at.z, vx: this.r(2), vy: 1.5 + this.rnd() * 2.5, vz: this.r(2),
        color: tmpColor.set(this.rnd() > 0.5 ? 0x8fd4ff : 0xe0f6ff), life: 0.45, size: 0.16 + this.rnd() * 0.1, gravity: 9, drag: 1,
      });
    }
  }

  leaves(at: THREE.Vector3) {
    for (let i = 0; i < 10; i++) {
      this.soft.emit({
        x: at.x, y: at.y, z: at.z, vx: this.r(2), vy: this.rnd() * 2, vz: this.r(2),
        color: tmpColor.set(this.rnd() > 0.5 ? 0x5ab44a : 0x8fd14f), life: 0.6, size: 0.18, endSize: 0.12, gravity: 3, drag: 2.5,
      });
    }
  }

  frost(at: THREE.Vector3) {
    this.sparks(at, 0xbff3ff, 14, 2.5);
    this.mote(at, 0xe8fbff, 1.1, 0.25);
  }

  electric(at: THREE.Vector3) {
    this.sparks(at, 0xfff07a, 16, 4);
    this.mote(at, 0xffffc0, 1.2, 0.18);
  }

  /** Expanding ring on the ground (shockwaves, deploy landings, explosions). */
  ring(at: THREE.Vector3, color: number, radius: number, life = 0.45) {
    const mesh = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(at.x, 0.06, at.z);
    mesh.renderOrder = 5;
    this.group.add(mesh);
    this.rings.push({ mesh, life, maxLife: life, maxScale: radius });
  }

  /** Stone chunks flying out of a destroyed tower. */
  rubble(at: THREE.Vector3, color: number, count = 22, power = 1) {
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(this.debrisGeo, litMat({ color, roughness: 0.9 }));
      const s = 0.8 + this.rnd() * 1.8;
      mesh.userData.s = s;
      mesh.scale.setScalar(s);
      mesh.position.set(at.x + this.r(0.6), at.y + this.rnd() * 1.2, at.z + this.r(0.6));
      mesh.castShadow = true;
      this.group.add(mesh);
      this.debris.push({
        mesh,
        vel: new THREE.Vector3(this.r(4 * power), 3 + this.rnd() * 5 * power, this.r(4 * power)),
        spin: new THREE.Vector3(this.r(10), this.r(10), 0),
        life: 1.4 + this.rnd() * 0.8,
      });
    }
  }

  /** Big explosion: flash, fire, smoke, ring. */
  explosion(at: THREE.Vector3, radius: number) {
    this.mote(at, 0xffffff, radius * 2.2, 0.15);
    this.fireBurst(at, 1.6);
    this.sparks(at, 0xffe27a, 26, 5);
    this.ring(at, 0xffd27a, radius, 0.5);
    this.dust(at, 18, radius);
  }
}
