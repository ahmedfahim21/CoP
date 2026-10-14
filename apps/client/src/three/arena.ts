import * as THREE from 'three';
import { litMat } from './style/toon.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import {
  ARENA_H, ARENA_W, BRIDGE_HALF_WIDTH, BRIDGE_XS, KING_POS, PRINCESS_POS, RIVER_BOTTOM, RIVER_TOP, mirror,
} from '@cop/shared';
import { toScene } from './coords.js';
import { PALETTE, seeded, shade, staticMat } from './palette.js';

const TEX_PX = 64; // texture pixels per tile
const HALF_W = ARENA_W / 2;
const HALF_H = ARENA_H / 2;
const RIVER_Z0 = RIVER_TOP - HALF_H; // -1
const RIVER_Z1 = RIVER_BOTTOM - HALF_H; // +1
const WATER_Y = -0.32;
const BANK_DEPTH = 0.55;

export interface Arena {
  group: THREE.Group;
  update(dt: number, t: number): void;
}

export function buildArena(): Arena {
  const group = new THREE.Group();
  group.name = 'arena';
  group.add(buildGround());
  const water = buildRiver();
  group.add(water.group);
  for (const bx of BRIDGE_XS) group.add(buildBridge(bx - HALF_W));
  const border = buildBorder();
  group.add(border.group);
  group.add(buildSurroundings());
  return {
    group,
    update: (_dt, t) => {
      water.update(t);
      border.update(t);
    },
  };
}

// --- Ground ---------------------------------------------------------------

/**
 * Paints the near half of the field (team-0 local rows 17..32) onto a canvas. The arena is
 * point-symmetric, so the far half reuses the same painting rotated 180°.
 */
function paintGround(seed: number): HTMLCanvasElement {
  const rows = ARENA_H - RIVER_BOTTOM; // 15
  const canvas = document.createElement('canvas');
  canvas.width = ARENA_W * TEX_PX;
  canvas.height = rows * TEX_PX;
  const g = canvas.getContext('2d')!;
  const rnd = seeded(seed);
  const at = (lx: number, ly: number) => ({ x: lx * TEX_PX, y: (ly - RIVER_BOTTOM) * TEX_PX });

  // Checkerboard turf with per-tile tonal noise, like freshly mown squares.
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < ARENA_W; x++) {
      const base = (x + y) % 2 === 0 ? PALETTE.grassA : PALETTE.grassB;
      g.fillStyle = hex(shade(base, (rnd() - 0.5) * 0.015));
      g.fillRect(x * TEX_PX, y * TEX_PX, TEX_PX, TEX_PX);
    }
  }
  // Grass tufts like GBA route tiles: little dark "v" marks with a light tip, a few per tile.
  for (let i = 0; i < 520; i++) {
    const x = rnd() * canvas.width;
    const y = rnd() * canvas.height;
    g.fillStyle = 'rgba(40,96,30,0.55)';
    g.fillRect(x, y, 6, 10);
    g.fillRect(x + 9, y + 2, 6, 8);
    g.fillStyle = 'rgba(220,255,170,0.35)';
    g.fillRect(x, y - 4, 6, 4);
  }

  // Cobbled stone lanes: bridge → princess tower → king tower.
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const lanes: Array<Array<[number, number]>> = [];
  for (const side of [PRINCESS_POS.left, PRINCESS_POS.right]) {
    const pts: Array<[number, number]> = [
      [side.x, RIVER_BOTTOM - 0.6],
      [side.x, side.y],
      [side.x + (KING_POS.x - side.x) * 0.5, KING_POS.y - 0.4],
      [KING_POS.x, KING_POS.y],
    ];
    lanes.push(pts);
    g.strokeStyle = hex(PALETTE.pathEdge);
    g.lineWidth = 1.5 * TEX_PX;
    g.beginPath();
    pts.forEach(([lx, ly], i) => {
      const p = at(lx, ly);
      if (i === 0) g.moveTo(p.x, p.y);
      else g.lineTo(p.x, p.y);
    });
    g.stroke();
  }
  // Lay square cobbles along each lane, a few per row, with slight jitter and tone.
  const cobble = TEX_PX * 0.42;
  for (const pts of lanes) {
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, ay] = pts[i]!;
      const [bx, by] = pts[i + 1]!;
      const len = Math.hypot(bx - ax, by - ay);
      const ux = (bx - ax) / len;
      const uy = (by - ay) / len;
      for (let d = 0; d <= len; d += 0.46) {
        for (let k = -1; k <= 1; k++) {
          const off = k * 0.44 + (Math.floor(d / 0.46) % 2 ? 0.22 : 0) * (k === 1 ? 0 : 1);
          const p = at(ax + ux * d - uy * off, ay + uy * d + ux * off);
          g.fillStyle = hex(shade(PALETTE.path, (rnd() - 0.5) * 0.08));
          g.save();
          g.translate(p.x, p.y);
          g.rotate(Math.atan2(uy, ux) + (rnd() - 0.5) * 0.12);
          roundRect(g, -cobble / 2, -cobble / 2, cobble, cobble, 6);
          g.fill();
          g.fillStyle = 'rgba(255,255,255,0.18)';
          g.fillRect(-cobble / 2 + 4, -cobble / 2 + 3, cobble - 8, 3);
          g.restore();
        }
      }
    }
  }

  // Stone plazas under the towers.
  const plaza = (cx: number, cy: number, halfSize: number) => {
    const p = at(cx - halfSize, cy - halfSize);
    const size = halfSize * 2 * TEX_PX;
    g.fillStyle = hex(PALETTE.plazaJoint);
    roundRect(g, p.x - 6, p.y - 6, size + 12, size + 12, 18);
    g.fill();
    const n = Math.round(halfSize * 2);
    const cell = size / n;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        g.fillStyle = hex(shade(PALETTE.plaza, (rnd() - 0.5) * 0.06));
        roundRect(g, p.x + i * cell + 3, p.y + j * cell + 3, cell - 6, cell - 6, 8);
        g.fill();
      }
    }
  };
  plaza(PRINCESS_POS.left.x, PRINCESS_POS.left.y, 2);
  plaza(PRINCESS_POS.right.x, PRINCESS_POS.right.y, 2);
  plaza(KING_POS.x, KING_POS.y, 2.5);

  // Soft darkening along the side edges, so the field reads as bounded before the wall does.
  for (const flip of [false, true]) {
    g.save();
    if (flip) {
      g.translate(canvas.width, 0);
      g.scale(-1, 1);
    }
    const edge = g.createLinearGradient(0, 0, 40, 0);
    edge.addColorStop(0, 'rgba(20,60,10,0.25)');
    edge.addColorStop(1, 'rgba(20,60,10,0)');
    g.fillStyle = edge;
    g.fillRect(0, 0, 40, canvas.height);
    g.restore();
  }
  return canvas;
}

function buildGround(): THREE.Group {
  const group = new THREE.Group();
  for (const half of ['near', 'far'] as const) {
    const tex = new THREE.CanvasTexture(paintGround(half === 'near' ? 11 : 29));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const depth = RIVER_TOP;
    const geo = new THREE.PlaneGeometry(ARENA_W, depth);
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, litMat({ map: tex, roughness: 0.95 }));
    mesh.receiveShadow = true;
    // Near half spans z = +1..+16; the far half is the same painting turned 180°.
    mesh.position.z = half === 'near' ? RIVER_Z1 + depth / 2 : RIVER_Z0 - depth / 2;
    if (half === 'far') mesh.rotation.y = Math.PI;
    group.add(mesh);
  }
  return group;
}

// --- River ----------------------------------------------------------------

function buildRiver(): { group: THREE.Group; update(t: number): void } {
  const group = new THREE.Group();
  // The river runs out to the horizon on both sides; fog hides its ends.
  const width = 120;

  // Bed and banks: the channel is cut into the ground, so you see its stone walls.
  const bed = new THREE.Mesh(new THREE.BoxGeometry(width, 0.1, RIVER_Z1 - RIVER_Z0), staticMat(0x16808f));
  bed.position.y = -BANK_DEPTH - 0.05;
  group.add(bed);
  for (const z of [RIVER_Z0, RIVER_Z1]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(width, BANK_DEPTH, 0.12), staticMat(PALETTE.stoneDark));
    wall.position.set(0, -BANK_DEPTH / 2, z + (z < 0 ? 0.06 : -0.06));
    wall.receiveShadow = true;
    group.add(wall);
  }

  const uniforms = {
    uTime: { value: 0 },
    uDeep: { value: new THREE.Color(PALETTE.waterDeep) },
    uShallow: { value: new THREE.Color(PALETTE.water) },
    uFoam: { value: new THREE.Color(PALETTE.foam) },
  };
  const waterMat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vWorld;
      uniform float uTime;
      void main() {
        vUv = uv;
        vec3 p = position;
        p.z += sin(p.x * 1.7 + uTime * 2.0) * 0.015;
        vec4 w = modelMatrix * vec4(p, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vWorld;
      uniform float uTime;
      uniform vec3 uDeep;
      uniform vec3 uShallow;
      uniform vec3 uFoam;
      void main() {
        float edge = min(vUv.y, 1.0 - vUv.y);
        // Flowing ripples: two interfering bands drifting downstream.
        float r1 = sin(vWorld.x * 2.3 - uTime * 2.2 + sin(vWorld.z * 6.0 + uTime) * 0.8);
        float r2 = sin(vWorld.x * 4.1 - uTime * 3.1 + vWorld.z * 3.0);
        float ripple = smoothstep(0.75, 1.0, r1 * 0.6 + r2 * 0.4);
        vec3 col = mix(uDeep, uShallow, smoothstep(0.0, 0.45, edge) * 0.5 + 0.35);
        col = mix(col, uFoam, ripple * 0.35);
        // Foam where water meets the banks.
        float foam = 1.0 - smoothstep(0.0, 0.12, edge + sin(vWorld.x * 5.0 + uTime * 2.5) * 0.02);
        col = mix(col, uFoam, foam * 0.75);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const waterGeo = new THREE.PlaneGeometry(width, RIVER_Z1 - RIVER_Z0 - 0.02, 64, 4);
  waterGeo.rotateX(-Math.PI / 2);
  const water = new THREE.Mesh(waterGeo, waterMat);
  water.position.y = WATER_Y;
  group.add(water);

  // Stone coping along both banks, broken where the bridges land.
  const rnd = seeded(5);
  const coping = new RoundedBoxGeometry(0.62, 0.22, 0.42, 2, 0.06);
  for (const z of [RIVER_Z0 - 0.12, RIVER_Z1 + 0.12]) {
    for (let x = -30; x < 30; x += 0.66) {
      const tileX = x + HALF_W;
      if (BRIDGE_XS.some((bx) => Math.abs(tileX - bx) < BRIDGE_HALF_WIDTH + 0.25)) continue;
      const m = new THREE.Mesh(coping, staticMat(shade(PALETTE.stone, (rnd() - 0.5) * 0.08)));
      m.position.set(x, 0.05, z);
      m.rotation.y = (rnd() - 0.5) * 0.06;
      m.castShadow = true;
      m.receiveShadow = true;
      group.add(m);
    }
  }
  // Lily pads drift and bob; a few carry a pink flower.
  const pads: Array<{ m: THREE.Object3D; phase: number; x: number }> = [];
  const padGeo = new THREE.CircleGeometry(0.34, 18, 0.35, Math.PI * 2 - 0.7);
  padGeo.rotateX(-Math.PI / 2);
  for (let i = 0; i < 16; i++) {
    const x = -14 + rnd() * 28;
    const tileX = x + HALF_W;
    if (BRIDGE_XS.some((bx) => Math.abs(tileX - bx) < BRIDGE_HALF_WIDTH + 0.9)) continue;
    const pad = new THREE.Group();
    const leaf = new THREE.Mesh(padGeo, staticMat(shade(PALETTE.lily, (rnd() - 0.5) * 0.1), { roughness: 0.6 }));
    leaf.receiveShadow = true;
    pad.add(leaf);
    if (rnd() < 0.35) {
      for (let k = 0; k < 5; k++) {
        const petal = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), staticMat(0xff9ec8, { roughness: 0.5 }));
        petal.scale.set(1, 0.6, 1.6);
        const a = (k / 5) * Math.PI * 2;
        petal.position.set(Math.cos(a) * 0.07, 0.06, Math.sin(a) * 0.07);
        petal.rotation.y = -a;
        pad.add(petal);
      }
      const heart = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), staticMat(PALETTE.gold));
      heart.position.y = 0.08;
      pad.add(heart);
    }
    const z = RIVER_Z0 + 0.35 + rnd() * (RIVER_Z1 - RIVER_Z0 - 0.7);
    pad.position.set(x, WATER_Y + 0.02, z);
    pad.rotation.y = rnd() * Math.PI * 2;
    pad.scale.setScalar(0.75 + rnd() * 0.5);
    group.add(pad);
    pads.push({ m: pad, phase: rnd() * 6, x });
  }
  return {
    group,
    update: (t) => {
      uniforms.uTime.value = t;
      for (const p of pads) {
        p.m.position.y = WATER_Y + 0.02 + Math.sin(t * 1.6 + p.phase) * 0.012;
        p.m.position.x = p.x + Math.sin(t * 0.25 + p.phase) * 0.15;
        p.m.rotation.y += 0.0015;
      }
    },
  };
}

function buildBridge(cx: number): THREE.Group {
  const group = new THREE.Group();
  group.position.x = cx;
  const len = RIVER_Z1 - RIVER_Z0 + 1.2;
  const w = BRIDGE_HALF_WIDTH * 2 + 0.7;
  const rnd = seeded(Math.round(cx * 10) + 100);

  // Support beams under the deck.
  for (const x of [-w / 2 + 0.25, 0, w / 2 - 0.25]) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.3, len), staticMat(PALETTE.woodDark));
    beam.position.set(x, -0.14, 0);
    beam.castShadow = true;
    group.add(beam);
  }
  // Wide planks across the span, each a little different, like the concept's plank decks.
  const plankGeo = new RoundedBoxGeometry(w, 0.13, 0.36, 1, 0.04);
  for (let z = -len / 2 + 0.2; z < len / 2 - 0.1; z += 0.39) {
    const color = rnd() > 0.5 ? PALETTE.woodLight : 0xd4a066;
    const plank = new THREE.Mesh(plankGeo, staticMat(shade(color, (rnd() - 0.5) * 0.07)));
    plank.position.set((rnd() - 0.5) * 0.08, 0.04, z);
    plank.rotation.y = (rnd() - 0.5) * 0.035;
    plank.castShadow = true;
    plank.receiveShadow = true;
    group.add(plank);
  }
  // Low curbs along both edges instead of rails, so troops stay readable crossing.
  for (const x of [-w / 2 - 0.02, w / 2 + 0.02]) {
    const curb = new THREE.Mesh(new RoundedBoxGeometry(0.18, 0.2, len, 1, 0.05), staticMat(PALETTE.woodDark));
    curb.position.set(x, 0.14, 0);
    curb.castShadow = true;
    group.add(curb);
  }
  return group;
}

// --- Border & surroundings -------------------------------------------------

/**
 * Collects many copies of a few shapes and emits one InstancedMesh per shape, so a forest or
 * a palisade costs a handful of draw calls.
 */
class Scatter {
  private readonly sets = new Map<string, { geo: THREE.BufferGeometry; mat: THREE.Material; items: Array<{ m: THREE.Matrix4; c: THREE.Color }> }>();
  private readonly tmp = new THREE.Object3D();

  add(key: string, geo: () => THREE.BufferGeometry, mat: THREE.Material, pos: THREE.Vector3Like, rot: THREE.EulerTuple | [number, number, number], scale: THREE.Vector3Like, color: number) {
    let set = this.sets.get(key);
    if (!set) {
      set = { geo: geo(), mat, items: [] };
      this.sets.set(key, set);
    }
    this.tmp.position.set(pos.x, pos.y, pos.z);
    this.tmp.rotation.set(rot[0], rot[1], rot[2]);
    this.tmp.scale.set(scale.x, scale.y, scale.z);
    this.tmp.updateMatrix();
    set.items.push({ m: this.tmp.matrix.clone(), c: new THREE.Color(color) });
  }

  build(): THREE.Group {
    const g = new THREE.Group();
    for (const set of this.sets.values()) {
      const mesh = new THREE.InstancedMesh(set.geo, set.mat, set.items.length);
      set.items.forEach((it, i) => {
        mesh.setMatrixAt(i, it.m);
        mesh.setColorAt(i, it.c);
      });
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      g.add(mesh);
    }
    return g;
  }
}

/** White material whose per-instance colour comes from Scatter. */
const tintMat = (roughness = 0.85) => litMat({ color: 0xffffff, roughness });

let bannerTex: THREE.CanvasTexture | null = null;

/** Red pennant with a Poké Ball, like the banners along the concept art's fences. */
function pokeBallBanner(): THREE.CanvasTexture {
  if (bannerTex) return bannerTex;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 224;
  const g = c.getContext('2d')!;
  g.fillStyle = '#c8322c';
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(128, 0);
  g.lineTo(128, 190);
  g.lineTo(64, 224);
  g.lineTo(0, 190);
  g.closePath();
  g.fill();
  g.fillStyle = '#a3241f';
  g.fillRect(0, 0, 128, 14);
  g.strokeStyle = '#f2c14e';
  g.lineWidth = 6;
  g.strokeRect(10, 22, 108, 160);
  const cx = 64;
  const cy = 104;
  g.fillStyle = '#f4f1ea';
  g.beginPath();
  g.arc(cx, cy, 38, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#e8463e';
  g.beginPath();
  g.arc(cx, cy, 38, Math.PI, 0);
  g.fill();
  g.fillStyle = '#1d1d22';
  g.fillRect(cx - 38, cy - 5, 76, 10);
  g.beginPath();
  g.arc(cx, cy, 13, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#f4f1ea';
  g.beginPath();
  g.arc(cx, cy, 7, 0, Math.PI * 2);
  g.fill();
  bannerTex = new THREE.CanvasTexture(c);
  bannerTex.colorSpace = THREE.SRGBColorSpace;
  return bannerTex;
}

function buildBorder(): { group: THREE.Group; update(t: number): void } {
  const group = new THREE.Group();
  const rnd = seeded(77);
  const scatter = new Scatter();
  const logMat = tintMat(0.9);
  const ox = HALF_W + 0.55;
  const oz = HALF_H + 0.6;

  // Side palisades: sharpened logs of uneven height, gapped where the river runs.
  for (const sx of [-1, 1]) {
    for (let z = -HALF_H - 0.2; z <= HALF_H + 0.2; z += 0.42) {
      if (z > RIVER_Z0 - 0.5 && z < RIVER_Z1 + 0.5) continue;
      const h = 1.3 + rnd() * 0.45;
      const r = 0.2 + rnd() * 0.04;
      const tone = shade(PALETTE.wood, (rnd() - 0.5) * 0.12);
      const x = sx * (ox + (rnd() - 0.5) * 0.06);
      scatter.add('log', () => new THREE.CylinderGeometry(1, 1, 1, 7), logMat, { x, y: h / 2, z }, [0, rnd() * 3, (rnd() - 0.5) * 0.05], { x: r, y: h, z: r }, tone);
      scatter.add('tip', () => new THREE.ConeGeometry(1, 1, 7), logMat, { x, y: h + 0.17, z }, [0, rnd() * 3, 0], { x: r, y: 0.34, z: r }, shade(tone, 0.06));
    }
    // A cross rail behind the logs.
    for (const zs of [-1, 1]) {
      const z0 = zs * (RIVER_Z1 + 0.5);
      const z1 = zs * (HALF_H + 0.2);
      const len = Math.abs(z1 - z0);
      scatter.add('rail', () => new THREE.BoxGeometry(1, 1, 1), logMat, { x: sx * (ox + 0.24), y: 0.85, z: (z0 + z1) / 2 }, [0, 0, 0], { x: 0.12, y: 0.16, z: len }, PALETTE.woodDark);
    }
  }

  // End fences: posts and two rails, low enough not to hide the king towers.
  const banners = litMat({ map: pokeBallBanner(), transparent: true, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9 });
  const flames: THREE.Mesh[] = [];
  const flameMat = litMat({ color: 0xffb03a, emissive: 0xff7a1a, emissiveIntensity: 1.6, roughness: 0.4, toneMapped: false });
  for (const sz of [-1, 1]) {
    const z = sz * oz;
    for (let x = -HALF_W - 0.3; x <= HALF_W + 0.3; x += 1.2) {
      scatter.add('post', () => new RoundedBoxGeometry(1, 1, 1, 2, 0.12), logMat, { x, y: 0.42, z }, [0, (rnd() - 0.5) * 0.1, 0], { x: 0.22, y: 0.84, z: 0.22 }, PALETTE.woodDark);
    }
    for (const y of [0.36, 0.7]) {
      scatter.add('endRail', () => new THREE.BoxGeometry(1, 1, 1), logMat, { x: 0, y, z }, [0, 0, 0], { x: ARENA_W + 1.2, y: 0.12, z: 0.1 }, shade(PALETTE.wood, y > 0.5 ? 0.04 : -0.02));
    }
    // Banner poles at the corners and beside the king, each with a Poké Ball pennant.
    for (const bx of [-HALF_W - 0.4, -4.6, 4.6, HALF_W + 0.4]) {
      const corner = Math.abs(bx) > HALF_W;
      const poleH = corner ? 2.6 : 2.1;
      scatter.add('pole', () => new THREE.CylinderGeometry(1, 1, 1, 8), logMat, { x: bx, y: poleH / 2, z: z + sz * 0.15 }, [0, 0, 0], { x: 0.07, y: poleH, z: 0.07 }, PALETTE.woodDark);
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 1.3), banners);
      flag.position.set(bx, poleH - 0.75, z + sz * 0.24);
      flag.rotation.y = sz > 0 ? 0 : Math.PI;
      group.add(flag);
    }
    // Torches flanking the king's end.
    for (const tx of [-2.6, 2.6]) {
      scatter.add('torch', () => new THREE.CylinderGeometry(0.6, 1, 1, 8), logMat, { x: tx, y: 0.6, z: z - sz * 0.1 }, [0, 0, 0], { x: 0.1, y: 1.2, z: 0.1 }, PALETTE.woodDark);
      scatter.add('bowl', () => new THREE.CylinderGeometry(1, 0.6, 1, 10), logMat, { x: tx, y: 1.26, z: z - sz * 0.1 }, [0, 0, 0], { x: 0.2, y: 0.16, z: 0.2 }, 0x4a4a52);
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.42, 8), flameMat);
      flame.position.set(tx, 1.52, z - sz * 0.1);
      flame.castShadow = false;
      group.add(flame);
      flames.push(flame);
    }
    // Boulders behind the fence, the big one centred on the king.
    for (const [bx, r] of [[0, 1.1], [-1.9, 0.6], [1.9, 0.65], [-6.6, 0.55], [6.8, 0.5]] as const) {
      scatter.add('boulder', () => new THREE.DodecahedronGeometry(1, 1), tintMat(0.95), { x: bx + (rnd() - 0.5) * 0.3, y: r * 0.45, z: z + sz * (0.9 + r * 0.6) }, [rnd(), rnd() * 3, rnd()], { x: r * 1.2, y: r * 0.8, z: r }, shade(PALETTE.rock, (rnd() - 0.5) * 0.1));
    }
  }
  group.add(scatter.build());
  return {
    group,
    update(t) {
      flames.forEach((f, i) => {
        const flicker = 1 + Math.sin(t * 17 + i * 2.3) * 0.12 + Math.sin(t * 29 + i) * 0.06;
        f.scale.set(1 / flicker, flicker, 1 / flicker);
      });
      flameMat.emissiveIntensity = 1.5 + Math.sin(t * 23) * 0.2;
    },
  };
}

function buildSurroundings(): THREE.Group {
  const group = new THREE.Group();
  const rnd = seeded(2024);
  // Outer ground and the apron just outside the fence, each split around the river channel
  // so the recessed water stays visible.
  const banded = (w: number, depth: number, y: number, color: number) => {
    for (const sz of [-1, 1]) {
      const d = depth / 2 - RIVER_Z1;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), staticMat(color));
      m.rotation.x = -Math.PI / 2;
      m.position.set(0, y, sz * (RIVER_Z1 + d / 2));
      m.receiveShadow = true;
      group.add(m);
    }
  };
  banded(120, 120, -0.02, PALETTE.outerGrass);
  banded(ARENA_W + 3.2, ARENA_H + 3.4, -0.01, 0x78a443);

  // Forest: dense rows of soft trees behind the palisades and past each end.
  const scatter = new Scatter();
  const leafMat = tintMat(0.8);
  const tree = (x: number, z: number, size: number) => {
    const s = size * (0.85 + rnd() * 0.4);
    scatter.add('trunk', () => new THREE.CylinderGeometry(0.7, 1, 1, 6), tintMat(), { x, y: 0.5 * s, z }, [0, 0, 0], { x: 0.18 * s, y: s, z: 0.18 * s }, PALETTE.trunk);
    const leaf = rnd() > 0.35 ? PALETTE.leaf : rnd() > 0.5 ? 0x5aa83f : 0x3f8a3a;
    for (let i = 0; i < 3; i++) {
      const r = (0.6 + rnd() * 0.3) * s;
      scatter.add('canopy', () => new THREE.IcosahedronGeometry(1, 1), leafMat, { x: x + (rnd() - 0.5) * 0.7 * s, y: (1.25 + rnd() * 0.6) * s, z: z + (rnd() - 0.5) * 0.7 * s }, [rnd(), rnd(), rnd()], { x: r, y: r * 0.92, z: r }, shade(leaf, (rnd() - 0.5) * 0.08));
    }
  };
  for (const sx of [-1, 1]) {
    for (let row = 0; row < 4; row++) {
      for (let z = -HALF_H - 4; z <= HALF_H + 4; z += 1.5 + rnd() * 0.6) {
        if (Math.abs(z) < RIVER_Z1 + 1.4) continue; // keep the river mouth open
        tree(sx * (HALF_W + 2 + row * 1.7 + rnd() * 0.8), z + (rnd() - 0.5) * 0.6, 1 + row * 0.15);
      }
    }
  }
  for (const sz of [-1, 1]) {
    for (let row = 0; row < 3; row++) {
      for (let x = -HALF_W - 6; x <= HALF_W + 6; x += 1.6 + rnd() * 0.6) {
        tree(x + (rnd() - 0.5) * 0.6, sz * (HALF_H + 3.6 + row * 1.7 + rnd() * 0.6), 1.05 + row * 0.15);
      }
    }
  }
  // Bushes and flowers hugging the palisades inside the forest line.
  const flowerColors = [0xff9ec8, 0xffe36b, 0xffffff, 0xff7a6b];
  for (let i = 0; i < 70; i++) {
    const sx = rnd() > 0.5 ? 1 : -1;
    const z = (rnd() - 0.5) * (ARENA_H + 2);
    if (Math.abs(z) < RIVER_Z1 + 0.8) continue;
    const x = sx * (HALF_W + 1.2 + rnd() * 0.7);
    if (rnd() < 0.55) {
      const r = 0.28 + rnd() * 0.2;
      scatter.add('bush', () => new THREE.IcosahedronGeometry(1, 1), leafMat, { x, y: r * 0.8, z }, [rnd(), rnd(), rnd()], { x: r, y: r * 0.85, z: r }, shade(PALETTE.leafDark, (rnd() - 0.3) * 0.1));
    } else {
      scatter.add('flower', () => new THREE.SphereGeometry(1, 8, 6), tintMat(0.6), { x, y: 0.12, z }, [0, 0, 0], { x: 0.09, y: 0.07, z: 0.09 }, flowerColors[Math.floor(rnd() * flowerColors.length)]!);
    }
  }
  group.add(scatter.build());
  return group;
}

// --- Helpers ----------------------------------------------------------------

function hex(c: number): string {
  return `#${c.toString(16).padStart(6, '0')}`;
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** Tower centres in scene space for a team, used by the tower builder and the diorama. */
export function towerScenePositions(team: 0 | 1) {
  return {
    king: toScene(mirror(team, KING_POS)),
    left: toScene(mirror(team, PRINCESS_POS.left)),
    right: toScene(mirror(team, PRINCESS_POS.right)),
  };
}
