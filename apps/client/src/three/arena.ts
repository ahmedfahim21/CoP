import * as THREE from 'three';
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
  group.add(buildBorder());
  group.add(buildSurroundings());
  return {
    group,
    update: (_dt, t) => water.update(t),
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
      g.fillStyle = hex(shade(base, (rnd() - 0.5) * 0.025));
      g.fillRect(x * TEX_PX, y * TEX_PX, TEX_PX, TEX_PX);
    }
  }
  // Blade speckle.
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = rnd() > 0.5 ? 'rgba(255,255,255,0.06)' : 'rgba(30,70,10,0.08)';
    g.fillRect(rnd() * canvas.width, rnd() * canvas.height, 2, 5);
  }

  // Dirt lanes: bridge → princess tower → king tower.
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const lane = (pts: Array<[number, number]>, width: number, color: string) => {
    g.strokeStyle = color;
    g.lineWidth = width * TEX_PX;
    g.beginPath();
    pts.forEach(([lx, ly], i) => {
      const p = at(lx, ly);
      if (i === 0) g.moveTo(p.x, p.y);
      else g.lineTo(p.x, p.y);
    });
    g.stroke();
  };
  for (const side of [PRINCESS_POS.left, PRINCESS_POS.right]) {
    const pts: Array<[number, number]> = [
      [side.x, RIVER_BOTTOM - 0.6],
      [side.x, side.y],
      [side.x + (KING_POS.x - side.x) * 0.5, KING_POS.y - 0.4],
      [KING_POS.x, KING_POS.y],
    ];
    lane(pts, 1.4, hex(PALETTE.pathEdge));
    lane(pts, 1.08, hex(PALETTE.path));
  }
  // Pebbles on the lanes.
  for (let i = 0; i < 160; i++) {
    const side = rnd() > 0.5 ? PRINCESS_POS.left : PRINCESS_POS.right;
    const p = at(side.x + (rnd() - 0.5) * 0.9, RIVER_BOTTOM + rnd() * (side.y - RIVER_BOTTOM));
    g.fillStyle = rnd() > 0.5 ? 'rgba(120,95,55,0.35)' : 'rgba(255,245,215,0.35)';
    g.beginPath();
    g.ellipse(p.x, p.y, 3 + rnd() * 3, 2 + rnd() * 2, rnd() * 3, 0, Math.PI * 2);
    g.fill();
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
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 }));
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
  const bed = new THREE.Mesh(new THREE.BoxGeometry(width, 0.1, RIVER_Z1 - RIVER_Z0), staticMat(0x2d5f7d));
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
  return { group, update: (t) => (uniforms.uTime.value = t) };
}

function buildBridge(cx: number): THREE.Group {
  const group = new THREE.Group();
  group.position.x = cx;
  const len = RIVER_Z1 - RIVER_Z0 + 1.1;
  const w = BRIDGE_HALF_WIDTH * 2 + 0.2;
  const rnd = seeded(Math.round(cx * 10) + 100);

  // Support beams under the deck.
  for (const x of [-w / 2 + 0.2, w / 2 - 0.2]) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.3, len), staticMat(PALETTE.woodDark));
    beam.position.set(x, -0.12, 0);
    beam.castShadow = true;
    group.add(beam);
  }
  // Planks across the span, each a little different.
  const plankGeo = new RoundedBoxGeometry(w, 0.12, 0.3, 1, 0.03);
  for (let z = -len / 2 + 0.17; z < len / 2 - 0.1; z += 0.34) {
    const color = rnd() > 0.5 ? PALETTE.wood : PALETTE.woodLight;
    const plank = new THREE.Mesh(plankGeo, staticMat(shade(color, (rnd() - 0.5) * 0.06)));
    plank.position.set((rnd() - 0.5) * 0.06, 0.03, z);
    plank.rotation.y = (rnd() - 0.5) * 0.03;
    plank.castShadow = true;
    plank.receiveShadow = true;
    group.add(plank);
  }
  // Rails: posts plus a top beam each side.
  for (const x of [-w / 2 - 0.05, w / 2 + 0.05]) {
    for (const z of [-len / 2 + 0.15, 0, len / 2 - 0.15]) {
      const post = new THREE.Mesh(new RoundedBoxGeometry(0.2, 0.62, 0.2, 1, 0.04), staticMat(PALETTE.woodDark));
      post.position.set(x, 0.3, z);
      post.castShadow = true;
      group.add(post);
    }
    const rail = new THREE.Mesh(new RoundedBoxGeometry(0.16, 0.12, len - 0.1, 1, 0.04), staticMat(PALETTE.wood));
    rail.position.set(x, 0.56, 0);
    rail.castShadow = true;
    group.add(rail);
  }
  return group;
}

// --- Border & surroundings -------------------------------------------------

function buildBorder(): THREE.Group {
  const group = new THREE.Group();
  const rnd = seeded(77);
  const blockGeo = new RoundedBoxGeometry(1, 0.55, 0.55, 2, 0.08);
  const capGeo = new RoundedBoxGeometry(1.04, 0.14, 0.62, 2, 0.05);
  const place = (x: number, z: number, rotY: number) => {
    const tone = (rnd() - 0.5) * 0.07;
    const b = new THREE.Mesh(blockGeo, staticMat(shade(PALETTE.stone, tone)));
    b.position.set(x, 0.27, z);
    b.rotation.y = rotY;
    b.castShadow = true;
    b.receiveShadow = true;
    const cap = new THREE.Mesh(capGeo, staticMat(shade(PALETTE.stoneLight, tone)));
    cap.position.set(x, 0.6, z);
    cap.rotation.y = rotY;
    cap.castShadow = true;
    group.add(b, cap);
  };
  const ox = HALF_W + 0.35;
  const oz = HALF_H + 0.35;
  for (let z = -HALF_H; z <= HALF_H; z += 1.02) {
    if (z > RIVER_Z0 - 0.4 && z < RIVER_Z1 + 0.4) continue;
    place(-ox, z + 0.5, Math.PI / 2);
    place(ox, z + 0.5, Math.PI / 2);
  }
  for (let x = -HALF_W; x < HALF_W; x += 1.02) {
    place(x + 0.5, -oz, 0);
    place(x + 0.5, oz, 0);
  }
  // Corner pillars with gold caps.
  for (const [x, z] of [[-ox, -oz], [ox, -oz], [-ox, oz], [ox, oz]] as const) {
    const pillar = new THREE.Mesh(new RoundedBoxGeometry(0.9, 1.3, 0.9, 2, 0.1), staticMat(PALETTE.stoneDark));
    pillar.position.set(x, 0.65, z);
    pillar.castShadow = true;
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.55, 0.5, 4), staticMat(PALETTE.gold, { roughness: 0.5, metalness: 0.3 }));
    cap.position.set(x, 1.55, z);
    cap.rotation.y = Math.PI / 4;
    cap.castShadow = true;
    group.add(pillar, cap);
  }
  return group;
}

function buildSurroundings(): THREE.Group {
  const group = new THREE.Group();
  const rnd = seeded(2024);
  // Outer ground and the apron just outside the wall, each split around the river channel
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
  banded(ARENA_W + 3.2, ARENA_H + 3.2, -0.01, 0x78a443);

  // Houses flank the field like spectator stands, two per side per half.
  for (const sx of [-1, 1]) {
    for (const z of [-11, -4.2, 4.2, 11]) {
      const house = buildHouse(rnd, sx);
      house.position.set(sx * (HALF_W + 3.4), 0, z + (rnd() - 0.5) * 0.8);
      group.add(house);
    }
  }
  // Trees and rocks scattered beyond the houses and behind each king.
  const spots: Array<[number, number]> = [];
  for (let i = 0; i < 70; i++) {
    const sx = rnd() > 0.5 ? 1 : -1;
    spots.push([sx * (HALF_W + 6 + rnd() * 10), (rnd() - 0.5) * 44]);
  }
  for (let i = 0; i < 26; i++) spots.push([(rnd() - 0.5) * 30, (rnd() > 0.5 ? 1 : -1) * (HALF_H + 2.2 + rnd() * 8)]);
  for (const [x, z] of spots) {
    const r = rnd();
    if (Math.abs(z) < RIVER_Z1 + 1.2) continue; // keep the river clear
    const obj = r < 0.7 ? buildTree(rnd) : r < 0.85 ? buildBush(rnd) : buildRock(rnd);
    obj.position.set(x, 0, z);
    group.add(obj);
  }
  // A few bushes and rocks hugging the wall.
  for (let i = 0; i < 18; i++) {
    const sx = rnd() > 0.5 ? 1 : -1;
    const obj = rnd() > 0.5 ? buildBush(rnd) : buildRock(rnd);
    obj.position.set(sx * (HALF_W + 1.3 + rnd() * 0.6), 0, (rnd() - 0.5) * (ARENA_H - 2));
    obj.scale.multiplyScalar(0.7);
    group.add(obj);
  }
  return group;
}

/** A cottage in the claude-clan manner: lit/shaded walls, pitched roof, chimney, door and windows. */
function buildHouse(rnd: () => number, facing: number): THREE.Group {
  const g = new THREE.Group();
  const w = 2.4 + rnd() * 0.6;
  const d = 2.6 + rnd() * 0.8;
  const h = 1.5 + rnd() * 0.5;
  const wallColor = [0xf0e2c4, 0xe9d3b0, 0xf2e9d8][Math.floor(rnd() * 3)]!;
  const roofColor = rnd() > 0.5 ? PALETTE.roofGreen : PALETTE.roofRed;

  const walls = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, 0.06), staticMat(wallColor));
  walls.position.y = h / 2;
  walls.castShadow = true;
  walls.receiveShadow = true;
  g.add(walls);
  // Timber corner posts.
  for (const [x, z] of [[-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2]] as const) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, h, 0.16), staticMat(PALETTE.woodDark));
    post.position.set(x, h / 2, z);
    g.add(post);
  }
  // Gable roof: a triangular prism along z.
  const roofShape = new THREE.Shape();
  const over = 0.3;
  roofShape.moveTo(-w / 2 - over, 0);
  roofShape.lineTo(0, 1.1 + w * 0.15);
  roofShape.lineTo(w / 2 + over, 0);
  roofShape.lineTo(-w / 2 - over, 0);
  const roofGeo = new THREE.ExtrudeGeometry(roofShape, { depth: d + over * 2, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.05, bevelSegments: 1 });
  roofGeo.translate(0, 0, -(d + over * 2) / 2);
  const roof = new THREE.Mesh(roofGeo, staticMat(roofColor, { roughness: 0.7 }));
  roof.position.y = h;
  roof.castShadow = true;
  g.add(roof);
  // Ridge cap.
  const ridge = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.18, d + over * 2 + 0.1), staticMat(shade(roofColor, -0.12)));
  ridge.position.y = h + 1.1 + w * 0.15;
  g.add(ridge);
  // Chimney.
  const chimney = new THREE.Mesh(new RoundedBoxGeometry(0.4, 1, 0.4, 1, 0.05), staticMat(PALETTE.stoneDark));
  chimney.position.set(w * 0.22, h + 0.8, -d * 0.2);
  chimney.castShadow = true;
  g.add(chimney);
  // Door and windows face the field.
  const front = -facing * (w / 2 + 0.01);
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.9, 0.6), staticMat(PALETTE.woodDark));
  door.position.set(front, 0.45, 0);
  g.add(door);
  for (const z of [-d * 0.3, d * 0.3]) {
    const win = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.45, 0.45), staticMat(0x9fd3f0, { roughness: 0.3, emissive: 0x1a3550 }));
    win.position.set(front, h * 0.62, z);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.55, 0.55), staticMat(PALETTE.woodDark));
    frame.position.set(front - Math.sign(front) * 0.005, h * 0.62, z);
    g.add(frame, win);
  }
  g.rotation.y = (rnd() - 0.5) * 0.15;
  return g;
}

function buildTree(rnd: () => number): THREE.Group {
  const g = new THREE.Group();
  const s = 0.8 + rnd() * 0.7;
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.14 * s, 0.2 * s, 1 * s, 6), staticMat(PALETTE.trunk));
  trunk.position.y = 0.5 * s;
  trunk.castShadow = true;
  g.add(trunk);
  // Rounded canopy from clustered spheres, the way Clash Royale's trees read as soft blobs.
  const leaf = rnd() > 0.3 ? PALETTE.leaf : 0x5aa83f;
  for (let i = 0; i < 4; i++) {
    const r = (0.55 + rnd() * 0.3) * s;
    const blob = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), staticMat(shade(leaf, (rnd() - 0.5) * 0.08)));
    blob.position.set((rnd() - 0.5) * 0.7 * s, (1.2 + rnd() * 0.6) * s, (rnd() - 0.5) * 0.7 * s);
    blob.castShadow = true;
    g.add(blob);
  }
  return g;
}

function buildBush(rnd: () => number): THREE.Group {
  const g = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const r = 0.3 + rnd() * 0.2;
    const blob = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), staticMat(shade(PALETTE.leafDark, (rnd() - 0.3) * 0.1)));
    blob.position.set((rnd() - 0.5) * 0.5, r * 0.8, (rnd() - 0.5) * 0.5);
    blob.castShadow = true;
    g.add(blob);
  }
  return g;
}

function buildRock(rnd: () => number): THREE.Group {
  const g = new THREE.Group();
  const r = 0.3 + rnd() * 0.35;
  const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), staticMat(shade(PALETTE.rock, (rnd() - 0.5) * 0.1), { roughness: 0.95 }));
  rock.scale.set(1, 0.65, 1.1);
  rock.position.y = r * 0.4;
  rock.rotation.set(rnd(), rnd() * 3, rnd());
  rock.castShadow = true;
  rock.receiveShadow = true;
  g.add(rock);
  return g;
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
