import * as THREE from 'three';
import { litMat } from './style/toon.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import {
  ARENA_H, ARENA_W, BRIDGE_HALF_WIDTH, BRIDGE_XS, KING_POS, PRINCESS_POS, RIVER_BOTTOM, RIVER_TOP, mirror,
} from '@cop/shared';
import { toScene } from './coords.js';
import { PALETTE, seeded, shade, staticMat } from './palette.js';
import { THEMES, vary, type ArenaTheme } from './themes.js';

const TEX_PX = 64; // texture pixels per tile
const HALF_W = ARENA_W / 2;
const HALF_H = ARENA_H / 2;
const RIVER_Z0 = RIVER_TOP - HALF_H; // -1
const RIVER_Z1 = RIVER_BOTTOM - HALF_H; // +1
const WATER_Y = -0.32;
const BANK_DEPTH = 0.55;

export interface Arena {
  group: THREE.Group;
  theme: ArenaTheme;
  update(dt: number, t: number): void;
  /** Frees this arena's geometry and ground textures (shared materials stay). */
  dispose(): void;
}

export function buildArena(theme: ArenaTheme = THEMES.pallet): Arena {
  const group = new THREE.Group();
  group.name = `arena-${theme.id}`;
  const ground = buildGround(theme);
  group.add(ground);
  const water = buildRiver(theme);
  group.add(water.group);
  for (const bx of BRIDGE_XS) group.add(buildBridge(bx - HALF_W, theme));
  const border = buildBorder(theme);
  group.add(border.group);
  const beyond = buildSurroundings(theme);
  group.add(beyond.group);
  return {
    group,
    theme,
    update: (_dt, t) => {
      water.update(t);
      border.update(t);
      beyond.update(t);
    },
    dispose: () => {
      group.removeFromParent();
      group.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
      });
      ground.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          (o.material as THREE.MeshToonMaterial).map?.dispose();
          (o.material as THREE.Material).dispose();
        }
      });
    },
  };
}

// --- Ground ---------------------------------------------------------------

type LanePoints = Array<[number, number]>;

/** Calls `fn` every `step` tiles along a lane, with the lane's direction there. */
function walkLane(pts: LanePoints, step: number, fn: (x: number, y: number, ux: number, uy: number, row: number) => void) {
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i]!;
    const [bx, by] = pts[i + 1]!;
    const len = Math.hypot(bx - ax, by - ay);
    const ux = (bx - ax) / len;
    const uy = (by - ay) / len;
    for (let d = 0; d <= len; d += step) fn(ax + ux * d, ay + uy * d, ux, uy, Math.floor(d / step));
  }
}

/**
 * Paints the near half of the field (team-0 local rows 17..32) onto a canvas. The arena is
 * point-symmetric, so the far half reuses the same painting rotated 180°.
 */
function paintGround(seed: number, t: ArenaTheme): HTMLCanvasElement {
  const rows = ARENA_H - RIVER_BOTTOM; // 15
  const canvas = document.createElement('canvas');
  canvas.width = ARENA_W * TEX_PX;
  canvas.height = rows * TEX_PX;
  const g = canvas.getContext('2d')!;
  const rnd = seeded(seed);
  const at = (lx: number, ly: number) => ({ x: lx * TEX_PX, y: (ly - RIVER_BOTTOM) * TEX_PX });

  paintTurf(g, rows, t, rnd);

  const marks = t.marks;
  if (marks.kind === 'tufts') {
    // Grass tufts like GBA route tiles: little dark "v" marks with a light tip, a few per tile.
    for (let i = 0; i < marks.count; i++) {
      const x = rnd() * canvas.width;
      const y = rnd() * canvas.height;
      g.fillStyle = marks.dark;
      g.fillRect(x, y, 6, 10);
      g.fillRect(x + 9, y + 2, 6, 8);
      g.fillStyle = marks.light;
      g.fillRect(x, y - 4, 6, 4);
    }
    if (marks.leaves) {
      const fall = ['rgba(217,164,65,0.85)', 'rgba(201,118,47,0.85)', 'rgba(231,199,90,0.8)'];
      for (let i = 0; i < 110; i++) {
        g.save();
        g.translate(rnd() * canvas.width, rnd() * canvas.height);
        g.rotate(rnd() * Math.PI);
        g.fillStyle = fall[Math.floor(rnd() * fall.length)]!;
        g.beginPath();
        g.ellipse(0, 0, 8, 4, 0, 0, Math.PI * 2);
        g.fill();
        g.restore();
      }
    }
    if (marks.flowers) {
      // Little five-dot blooms scattered over the lawn.
      for (let i = 0; i < 140; i++) {
        const x = rnd() * canvas.width;
        const y = rnd() * canvas.height;
        g.fillStyle = marks.flowers[Math.floor(rnd() * marks.flowers.length)]!;
        for (let k = 0; k < 5; k++) {
          const a = (k / 5) * Math.PI * 2;
          g.beginPath();
          g.arc(x + Math.cos(a) * 4, y + Math.sin(a) * 4, 3, 0, Math.PI * 2);
          g.fill();
        }
        g.fillStyle = '#f2c14e';
        g.beginPath();
        g.arc(x, y, 2.5, 0, Math.PI * 2);
        g.fill();
      }
    }
  } else if (marks.kind === 'sand') {
    // Wind ripples in the sand, and the odd shell.
    g.lineWidth = 3;
    for (let i = 0; i < marks.count; i++) {
      const x = rnd() * canvas.width;
      const y = rnd() * canvas.height;
      const w = 20 + rnd() * 30;
      g.strokeStyle = rnd() > 0.5 ? 'rgba(190,150,90,0.35)' : 'rgba(255,250,230,0.5)';
      g.beginPath();
      g.moveTo(x, y);
      g.quadraticCurveTo(x + w / 2, y - 6, x + w, y);
      g.stroke();
    }
    const shells = ['#fbe3d8', '#f7c6b5', '#fff6e8', '#e8d6f0'];
    for (let i = 0; i < 40; i++) {
      const x = rnd() * canvas.width;
      const y = rnd() * canvas.height;
      g.fillStyle = shells[Math.floor(rnd() * shells.length)]!;
      g.beginPath();
      g.arc(x, y, 6, Math.PI, 0);
      g.closePath();
      g.fill();
      g.strokeStyle = 'rgba(150,110,90,0.5)';
      g.lineWidth = 1.5;
      for (const dx of [-3, 0, 3]) {
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + dx, y - 5);
        g.stroke();
      }
    }
  } else if (marks.kind === 'embers') {
    // Basalt split by glowing seams: a wide orange stroke under a thin yellow core.
    for (let i = 0; i < marks.count; i++) {
      let x = rnd() * canvas.width;
      let y = rnd() * canvas.height;
      const pts: Array<[number, number]> = [[x, y]];
      for (let k = 0; k < 4; k++) {
        x += (rnd() - 0.5) * 50;
        y += (rnd() - 0.5) * 50;
        pts.push([x, y]);
      }
      for (const [color, width] of [['rgba(255,90,20,0.55)', 7], ['rgba(255,200,80,0.95)', 2.5]] as const) {
        g.strokeStyle = color;
        g.lineWidth = width;
        g.beginPath();
        pts.forEach(([px, py], k) => (k === 0 ? g.moveTo(px, py) : g.lineTo(px, py)));
        g.stroke();
      }
    }
  } else if (marks.kind === 'pebbles') {
    // A rock floor: hairline cracks and loose pebbles.
    g.lineWidth = 2;
    g.strokeStyle = 'rgba(92,62,32,0.35)';
    for (let i = 0; i < 60; i++) {
      let x = rnd() * canvas.width;
      let y = rnd() * canvas.height;
      g.beginPath();
      g.moveTo(x, y);
      for (let k = 0; k < 3; k++) {
        x += (rnd() - 0.5) * 36;
        y += (rnd() - 0.5) * 36;
        g.lineTo(x, y);
      }
      g.stroke();
    }
    for (let i = 0; i < marks.count; i++) {
      const r = 2.5 + rnd() * 4.5;
      const x = rnd() * canvas.width;
      const y = rnd() * canvas.height;
      g.fillStyle = 'rgba(80,60,40,0.4)';
      g.beginPath();
      g.ellipse(x + 1.5, y + 1.5, r, r * 0.7, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = rnd() > 0.5 ? 'rgba(236,224,200,0.8)' : 'rgba(150,140,128,0.85)';
      g.beginPath();
      g.ellipse(x, y, r, r * 0.7, 0, 0, Math.PI * 2);
      g.fill();
    }
  }

  // Lanes: bridge → princess tower → king tower.
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const lanes: LanePoints[] = [];
  for (const side of [PRINCESS_POS.left, PRINCESS_POS.right]) {
    const pts: LanePoints = [
      [side.x, RIVER_BOTTOM - 0.6],
      [side.x, side.y],
      [side.x + (KING_POS.x - side.x) * 0.5, KING_POS.y - 0.4],
      [KING_POS.x, KING_POS.y],
    ];
    lanes.push(pts);
    const stroke = (color: number, width: number) => {
      g.strokeStyle = hex(color);
      g.lineWidth = width * TEX_PX;
      g.beginPath();
      pts.forEach(([lx, ly], i) => {
        const p = at(lx, ly);
        if (i === 0) g.moveTo(p.x, p.y);
        else g.lineTo(p.x, p.y);
      });
      g.stroke();
    };
    stroke(t.lane.edge, t.lane.kind === 'dirt' ? 1.7 : 1.5);
    if (t.lane.kind === 'dirt') stroke(t.lane.color, 1.25);
  }
  for (const pts of lanes) {
    if (t.lane.kind === 'cobble') {
      // Square cobbles, a few per row, with slight jitter and tone.
      const cobble = TEX_PX * 0.42;
      walkLane(pts, 0.46, (x, y, ux, uy, row) => {
        for (let k = -1; k <= 1; k++) {
          const off = k * 0.44 + (row % 2 ? 0.22 : 0) * (k === 1 ? 0 : 1);
          const p = at(x - uy * off, y + ux * off);
          g.fillStyle = hex(shade(t.lane.color, (rnd() - 0.5) * 0.08));
          g.save();
          g.translate(p.x, p.y);
          g.rotate(Math.atan2(uy, ux) + (rnd() - 0.5) * 0.12);
          roundRect(g, -cobble / 2, -cobble / 2, cobble, cobble, 6);
          g.fill();
          g.fillStyle = 'rgba(255,255,255,0.18)';
          g.fillRect(-cobble / 2 + 4, -cobble / 2 + 3, cobble - 8, 3);
          g.restore();
        }
      });
    } else if (t.lane.kind === 'dirt') {
      // Packed earth: speckles of grit, and a darker worn line down the middle.
      walkLane(pts, 0.05, (x, y, ux, uy) => {
        const off = (rnd() - 0.5) * 1.1;
        const p = at(x - uy * off, y + ux * off);
        g.fillStyle = hex(shade(t.lane.color, (rnd() - 0.5) * 0.18));
        g.fillRect(p.x, p.y, 3 + rnd() * 3, 3 + rnd() * 3);
        if (rnd() < 0.25) {
          const q = at(x - uy * (rnd() - 0.5) * 0.3, y + ux * (rnd() - 0.5) * 0.3);
          g.fillStyle = 'rgba(70,45,20,0.18)';
          g.fillRect(q.x, q.y, 6, 6);
        }
      });
    } else if (t.lane.kind === 'boardwalk') {
      // Boards laid across the lane, each a little different, two nails at each end.
      const len = TEX_PX * 1.3;
      const wide = TEX_PX * 0.2;
      walkLane(pts, 0.24, (x, y, ux, uy) => {
        const p = at(x, y);
        g.save();
        g.translate(p.x, p.y);
        g.rotate(Math.atan2(uy, ux) + Math.PI / 2 + (rnd() - 0.5) * 0.04);
        g.fillStyle = hex(shade(t.lane.color, (rnd() - 0.5) * 0.1));
        g.fillRect(-len / 2, -wide / 2, len, wide);
        g.fillStyle = 'rgba(255,255,255,0.15)';
        g.fillRect(-len / 2, -wide / 2, len, 2);
        g.fillStyle = 'rgba(40,25,10,0.5)';
        for (const nx of [-len / 2 + 5, len / 2 - 8]) {
          g.fillRect(nx, -4, 3, 3);
          g.fillRect(nx, 2, 3, 3);
        }
        g.restore();
      });
    } else if (t.lane.kind === 'steel') {
      // Riveted deck plates, a hazard-yellow edge showing either side.
      const side = TEX_PX * 1.1;
      walkLane(pts, 0.92, (x, y, ux, uy) => {
        const p = at(x, y);
        g.save();
        g.translate(p.x, p.y);
        g.rotate(Math.atan2(uy, ux));
        g.fillStyle = hex(shade(t.lane.color, (rnd() - 0.5) * 0.08));
        roundRect(g, -side * 0.42, -side / 2, side * 0.84, side, 4);
        g.fill();
        // Tread: rows of short diagonal ridges.
        g.strokeStyle = 'rgba(255,255,255,0.22)';
        g.lineWidth = 2;
        for (let i = -3; i <= 3; i++) {
          for (let j = -3; j <= 3; j++) {
            const cx = i * 7.5;
            const cy = j * 9;
            g.beginPath();
            g.moveTo(cx - 2.5 * ((i + j) % 2 ? 1 : -1), cy - 3);
            g.lineTo(cx + 2.5 * ((i + j) % 2 ? 1 : -1), cy + 3);
            g.stroke();
          }
        }
        g.fillStyle = 'rgba(30,30,35,0.6)';
        for (const [rx, ry] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
          g.beginPath();
          g.arc(rx * side * 0.34, ry * side * 0.42, 3, 0, Math.PI * 2);
          g.fill();
        }
        g.restore();
      });
    } else if (t.lane.kind === 'slabs') {
      // Square paving slabs, two abreast, the joint colour showing between them.
      const s = TEX_PX * 0.56;
      walkLane(pts, 0.62, (x, y, ux, uy) => {
        for (const sideOff of [-0.3, 0.3]) {
          const p = at(x - uy * sideOff, y + ux * sideOff);
          g.save();
          g.translate(p.x, p.y);
          g.rotate(Math.atan2(uy, ux));
          g.fillStyle = hex(shade(t.lane.color, (rnd() - 0.5) * 0.05));
          roundRect(g, -s / 2, -s / 2, s, s, 4);
          g.fill();
          g.fillStyle = 'rgba(255,255,255,0.25)';
          g.fillRect(-s / 2 + 4, -s / 2 + 3, s - 8, 3);
          g.restore();
        }
      });
    } else {
      // Flagstones: irregular slabs, two abreast, staggered row to row.
      walkLane(pts, 0.6, (x, y, ux, uy, row) => {
        for (const side of [-1, 1]) {
          const off = side * 0.3 + (row % 2 ? 0.08 : -0.08);
          const p = at(x - uy * off, y + ux * off);
          const r = TEX_PX * (0.27 + rnd() * 0.04);
          g.fillStyle = hex(shade(t.lane.color, (rnd() - 0.5) * 0.1));
          g.strokeStyle = 'rgba(40,30,20,0.25)';
          g.lineWidth = 3;
          g.beginPath();
          const n = 6;
          const spin = rnd() * Math.PI;
          for (let k = 0; k < n; k++) {
            const a = spin + (k / n) * Math.PI * 2;
            const rr = r * (0.82 + rnd() * 0.3);
            const vx = p.x + Math.cos(a) * rr;
            const vy = p.y + Math.sin(a) * rr;
            if (k === 0) g.moveTo(vx, vy);
            else g.lineTo(vx, vy);
          }
          g.closePath();
          g.fill();
          g.stroke();
        }
      });
    }
  }

  // Stone plazas under the towers.
  const plaza = (cx: number, cy: number, halfSize: number) => {
    const p = at(cx - halfSize, cy - halfSize);
    const size = halfSize * 2 * TEX_PX;
    g.fillStyle = hex(t.plazaJoint);
    roundRect(g, p.x - 6, p.y - 6, size + 12, size + 12, 18);
    g.fill();
    const n = Math.round(halfSize * 2);
    const cell = size / n;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        g.fillStyle = hex(shade(t.plaza, (rnd() - 0.5) * 0.06));
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
    edge.addColorStop(0, `rgba(${t.edgeShade},0.25)`);
    edge.addColorStop(1, `rgba(${t.edgeShade},0)`);
    g.fillStyle = edge;
    g.fillRect(0, 0, 40, canvas.height);
    g.restore();
  }
  return canvas;
}

/** The floor under everything: mown squares or stripes, deck boards, or tatami mats. */
function paintTurf(g: CanvasRenderingContext2D, rows: number, t: ArenaTheme, rnd: () => number) {
  const { pattern, colors, noise, grout } = t.turf;
  const tone = (base: number) => hex(shade(base, (rnd() - 0.5) * noise));
  if (pattern === 'planks') {
    // Deck boards running along the field, a tile wide, with staggered butt joints.
    for (let x = 0; x < ARENA_W; x++) {
      let y = -(x % 3) * 0.7;
      while (y < rows) {
        const len = 2 + rnd() * 1.5;
        g.fillStyle = tone(colors[x % 2]!);
        g.fillRect(x * TEX_PX, y * TEX_PX, TEX_PX, len * TEX_PX);
        // Grain: a few long faint streaks.
        g.fillStyle = 'rgba(60,35,15,0.12)';
        for (let k = 0; k < 3; k++) g.fillRect(x * TEX_PX + 8 + rnd() * (TEX_PX - 16), y * TEX_PX, 2, len * TEX_PX);
        if (grout) {
          g.fillStyle = grout;
          g.fillRect(x * TEX_PX, y * TEX_PX, TEX_PX, 3);
          g.fillRect(x * TEX_PX + 6, y * TEX_PX + 7, 3, 3);
          g.fillRect(x * TEX_PX + TEX_PX - 9, y * TEX_PX + 7, 3, 3);
        }
        y += len;
      }
      if (grout) {
        g.fillStyle = grout;
        g.fillRect(x * TEX_PX, 0, 3, rows * TEX_PX);
      }
    }
    return;
  }
  if (pattern === 'tatami') {
    // Mats two tiles by one, alternating direction in a 2×2 block, each edged with dark cloth.
    for (let by = 0; by < rows; by += 2) {
      for (let bx = 0; bx < ARENA_W; bx += 2) {
        const across = ((bx + by) / 2) % 2 === 0;
        const mats = across ? [[bx, by, 2, 1], [bx, by + 1, 2, 1]] : [[bx, by, 1, 2], [bx + 1, by, 1, 2]];
        mats.forEach(([mx, my, mw, mh], i) => {
          const px = mx! * TEX_PX;
          const py = my! * TEX_PX;
          g.fillStyle = tone(colors[i]!);
          g.fillRect(px, py, mw! * TEX_PX, mh! * TEX_PX);
          g.fillStyle = 'rgba(120,110,60,0.12)';
          const lengthwise = mw! > mh!;
          for (let k = 4; k < (lengthwise ? TEX_PX : TEX_PX * 2) - 2; k += 6) {
            if (lengthwise) g.fillRect(px, py + k, mw! * TEX_PX, 1.5);
            else g.fillRect(px + k, py, 1.5, mh! * TEX_PX);
          }
          if (grout) {
            g.strokeStyle = grout;
            g.lineWidth = 5;
            g.strokeRect(px + 2.5, py + 2.5, mw! * TEX_PX - 5, mh! * TEX_PX - 5);
          }
        });
      }
    }
    return;
  }
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < ARENA_W; x++) {
      const even = pattern === 'stripes' ? y % 2 === 0 : (x + y) % 2 === 0;
      g.fillStyle = tone(even ? colors[0] : colors[1]);
      g.fillRect(x * TEX_PX, y * TEX_PX, TEX_PX, TEX_PX);
    }
  }
  if (grout) {
    g.strokeStyle = grout;
    g.lineWidth = 3;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < ARENA_W; x++) g.strokeRect(x * TEX_PX + 1.5, y * TEX_PX + 1.5, TEX_PX - 3, TEX_PX - 3);
    }
  }
}

function buildGround(t: ArenaTheme): THREE.Group {
  const group = new THREE.Group();
  for (const half of ['near', 'far'] as const) {
    const tex = new THREE.CanvasTexture(paintGround(half === 'near' ? 11 : 29, t));
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

const nearBridge = (x: number, margin: number) => BRIDGE_XS.some((bx) => Math.abs(x + HALF_W - bx) < BRIDGE_HALF_WIDTH + margin);

function buildRiver(t: ArenaTheme): { group: THREE.Group; update(t: number): void } {
  const group = new THREE.Group();
  // The river runs out to the horizon on both sides; fog hides its ends.
  const width = 120;

  // Bed and banks: the channel is cut into the ground, so you see its stone walls.
  const bed = new THREE.Mesh(new THREE.BoxGeometry(width, 0.1, RIVER_Z1 - RIVER_Z0), staticMat(t.water.bed));
  bed.position.y = -BANK_DEPTH - 0.05;
  group.add(bed);
  for (const z of [RIVER_Z0, RIVER_Z1]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(width, BANK_DEPTH, 0.12), staticMat(t.bank));
    wall.position.set(0, -BANK_DEPTH / 2, z + (z < 0 ? 0.06 : -0.06));
    wall.receiveShadow = true;
    group.add(wall);
  }

  const uniforms = {
    uTime: { value: 0 },
    uDeep: { value: new THREE.Color(t.water.deep) },
    uShallow: { value: new THREE.Color(t.water.shallow) },
    uFoam: { value: new THREE.Color(t.water.foam) },
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
      if (nearBridge(x, 0.25)) continue;
      const m = new THREE.Mesh(coping, staticMat(shade(t.coping, (rnd() - 0.5) * 0.08)));
      m.position.set(x, 0.05, z);
      m.rotation.y = (rnd() - 0.5) * 0.06;
      m.castShadow = true;
      m.receiveShadow = true;
      group.add(m);
    }
  }

  const pads: Array<{ m: THREE.Object3D; phase: number; x: number }> = [];
  if (t.floaters.kind === 'lilies') {
    // Lily pads drift and bob; a few carry a pink flower.
    const padGeo = new THREE.CircleGeometry(0.34, 18, 0.35, Math.PI * 2 - 0.7);
    padGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < t.floaters.count; i++) {
      const x = -14 + rnd() * 28;
      if (nearBridge(x, 0.9)) continue;
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
  } else if (t.floaters.kind === 'rocks') {
    // Stones breaking the surface, with a ring of foam where the current hits them.
    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    const ringGeo = new THREE.RingGeometry(1, 1.35, 16);
    ringGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < t.floaters.count; i++) {
      const x = -14 + rnd() * 28;
      if (nearBridge(x, 0.7)) continue;
      const r = 0.16 + rnd() * 0.2;
      const z = RIVER_Z0 + 0.4 + rnd() * (RIVER_Z1 - RIVER_Z0 - 0.8);
      const rock = new THREE.Mesh(rockGeo, staticMat(vary(t.rock, rnd, 0.14)));
      rock.position.set(x, WATER_Y + r * 0.25, z);
      rock.scale.set(r * 1.3, r, r);
      rock.rotation.set(rnd(), rnd() * 3, rnd());
      rock.castShadow = true;
      group.add(rock);
      const ring = new THREE.Mesh(ringGeo, staticMat(t.water.foam, { roughness: 0.4 }));
      ring.position.set(x, WATER_Y + 0.01, z);
      ring.scale.setScalar(r * 1.1);
      group.add(ring);
    }
  }
  return {
    group,
    update: (time) => {
      uniforms.uTime.value = time;
      for (const p of pads) {
        p.m.position.y = WATER_Y + 0.02 + Math.sin(time * 1.6 + p.phase) * 0.012;
        p.m.position.x = p.x + Math.sin(time * 0.25 + p.phase) * 0.15;
        p.m.rotation.y += 0.0015;
      }
    },
  };
}

function buildBridge(cx: number, t: ArenaTheme): THREE.Group {
  const group = new THREE.Group();
  group.position.x = cx;
  const len = RIVER_Z1 - RIVER_Z0 + 1.2;
  const w = BRIDGE_HALF_WIDTH * 2 + 0.7;
  const rnd = seeded(Math.round(cx * 10) + 100);
  const add = (geo: THREE.BufferGeometry, color: number, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(geo, staticMat(color));
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
    return m;
  };

  if (t.bridge === 'slabs') {
    // Stone: two piers in the channel, three heavy slabs, and stone kerbs.
    for (const x of [-w / 2 + 0.3, w / 2 - 0.3]) add(new THREE.BoxGeometry(0.4, 0.5, len), shade(t.bank, -0.04), x, -0.2, 0);
    const n = 3;
    const slab = new RoundedBoxGeometry(w, 0.24, len / n - 0.06, 2, 0.05);
    for (let i = 0; i < n; i++) add(slab, vary(t.coping, rnd, 0.1), 0, 0.02, -len / 2 + (i + 0.5) * (len / n));
    for (const x of [-w / 2 - 0.04, w / 2 + 0.04]) add(new RoundedBoxGeometry(0.24, 0.26, len, 2, 0.05), t.kerb ?? shade(t.bank, 0.06), x, 0.16, 0);
    return group;
  }

  // Support beams under the deck.
  for (const x of [-w / 2 + 0.25, 0, w / 2 - 0.25]) add(new THREE.BoxGeometry(0.24, 0.3, len), t.wood.dark, x, -0.14, 0);

  if (t.bridge === 'logs') {
    // Round logs laid across, some with moss, and a log rail along each side.
    const log = new THREE.CylinderGeometry(0.19, 0.19, w + 0.15, 9);
    log.rotateZ(Math.PI / 2);
    const moss = new THREE.SphereGeometry(1, 8, 6);
    for (let z = -len / 2 + 0.2; z < len / 2 - 0.1; z += 0.4) {
      add(log, vary(t.wood.base, rnd, 0.1), (rnd() - 0.5) * 0.08, 0.06, z).rotation.y = (rnd() - 0.5) * 0.05;
      if (rnd() < 0.3) {
        const m = add(moss, 0x5d9236, (rnd() - 0.5) * w * 0.7, 0.2, z);
        m.scale.set(0.22, 0.06, 0.14);
      }
    }
    const rail = new THREE.CylinderGeometry(0.12, 0.12, len, 8);
    rail.rotateX(Math.PI / 2);
    for (const x of [-w / 2 - 0.02, w / 2 + 0.02]) add(rail, t.wood.dark, x, 0.24, 0);
    return group;
  }

  // Wide planks across the span, each a little different, like the concept's plank decks.
  const plankGeo = new RoundedBoxGeometry(w, 0.13, 0.36, 1, 0.04);
  for (let z = -len / 2 + 0.2; z < len / 2 - 0.1; z += 0.39) {
    const color = rnd() > 0.5 ? t.wood.light : t.wood.alt;
    add(plankGeo, shade(color, (rnd() - 0.5) * 0.07), (rnd() - 0.5) * 0.08, 0.04, z).rotation.y = (rnd() - 0.5) * 0.035;
  }
  // Low curbs along both edges instead of rails, so troops stay readable crossing.
  for (const x of [-w / 2 - 0.02, w / 2 + 0.02]) add(new RoundedBoxGeometry(0.18, 0.2, len, 1, 0.05), t.wood.dark, x, 0.14, 0);
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
  /** Shapes that don't cast shadows: tall far scenery would darken the whole field. */
  private readonly shadowless = new Set(['tower', 'peak', 'volcano', 'hill', 'mast', 'lampRig', 'craneLeg', 'craneCab', 'craneArm', 'craneCable', 'craneHook', 'pagodaWall', 'pagodaRoof', 'pagodaSpire']);

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
    for (const [key, set] of this.sets) {
      const mesh = new THREE.InstancedMesh(set.geo, set.mat, set.items.length);
      set.items.forEach((it, i) => {
        mesh.setMatrixAt(i, it.m);
        mesh.setColorAt(i, it.c);
      });
      mesh.castShadow = !this.shadowless.has(key);
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      g.add(mesh);
    }
    return g;
  }
}

/** White material whose per-instance colour comes from Scatter. */
const tintMat = (roughness = 0.85) => litMat({ color: 0xffffff, roughness });

const bannerTex = new Map<string, THREE.CanvasTexture>();

/** A pennant with the arena's emblem, like the banners along the concept art's fences. */
function banner(t: ArenaTheme): THREE.CanvasTexture {
  const cached = bannerTex.get(t.id);
  if (cached) return cached;
  const { field, band, trim, emblem } = t.banner;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 224;
  const g = c.getContext('2d')!;
  g.fillStyle = field;
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(128, 0);
  g.lineTo(128, 190);
  g.lineTo(64, 224);
  g.lineTo(0, 190);
  g.closePath();
  g.fill();
  g.fillStyle = band;
  g.fillRect(0, 0, 128, 14);
  g.strokeStyle = trim;
  g.lineWidth = 6;
  g.strokeRect(10, 22, 108, 160);
  const cx = 64;
  const cy = 104;
  if (emblem === 'pokeball') {
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
  } else {
    // The Boulder Badge: a grey octagon with a lighter facet in the middle.
    const octagon = (r: number) => {
      g.beginPath();
      for (let k = 0; k < 8; k++) {
        const a = Math.PI / 8 + (k / 8) * Math.PI * 2;
        if (k === 0) g.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
        else g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      }
      g.closePath();
    };
    g.fillStyle = '#1d1d22';
    octagon(42);
    g.fill();
    g.fillStyle = '#8d8d96';
    octagon(36);
    g.fill();
    g.fillStyle = '#c4c4cc';
    octagon(20);
    g.fill();
    g.strokeStyle = '#5c5c66';
    g.lineWidth = 3;
    for (let k = 0; k < 8; k++) {
      const a = Math.PI / 8 + (k / 8) * Math.PI * 2;
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * 20, cy + Math.sin(a) * 20);
      g.lineTo(cx + Math.cos(a) * 36, cy + Math.sin(a) * 36);
      g.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  bannerTex.set(t.id, tex);
  return tex;
}

function buildBorder(t: ArenaTheme): { group: THREE.Group; update(t: number): void } {
  const group = new THREE.Group();
  const rnd = seeded(77);
  const scatter = new Scatter();
  const logMat = tintMat(0.9);
  const stoneMat = tintMat(0.95);
  const ox = HALF_W + 0.55;
  const oz = HALF_H + 0.6;
  const block = () => new RoundedBoxGeometry(1, 1, 1, 2, 0.1);

  const box = () => new THREE.BoxGeometry(1, 1, 1);
  /** Calls `fn` for each side-wall stretch: two per side, broken where the river runs. */
  const sideRuns = (gap: number, fn: (sx: number, z0: number, z1: number) => void) => {
    for (const sx of [-1, 1]) {
      fn(sx, -HALF_H - 0.2, RIVER_Z0 - gap);
      fn(sx, RIVER_Z1 + gap, HALF_H + 0.2);
    }
  };

  const border = t.border;
  if (border.kind === 'palisade') {
    // Side palisades: logs (or bamboo canes) of uneven height, gapped where the river runs.
    const { radius, spacing, tip } = border;
    for (const sx of [-1, 1]) {
      for (let z = -HALF_H - 0.2; z <= HALF_H + 0.2; z += spacing) {
        if (z > RIVER_Z0 - 0.5 && z < RIVER_Z1 + 0.5) continue;
        const h = 1.3 + rnd() * 0.45;
        const r = radius + rnd() * radius * 0.2;
        const tone = shade(t.wood.base, (rnd() - 0.5) * 0.12);
        const x = sx * (ox + (rnd() - 0.5) * 0.06);
        scatter.add('log', () => new THREE.CylinderGeometry(1, 1, 1, 7), logMat, { x, y: h / 2, z }, [0, rnd() * 3, (rnd() - 0.5) * 0.05], { x: r, y: h, z: r }, tone);
        if (tip === 'flat') {
          // Bamboo: joints instead of a point.
          for (const f of [0.3, 0.62, 0.94]) {
            scatter.add('node', () => new THREE.CylinderGeometry(1, 1, 1, 7), logMat, { x, y: h * f, z }, [0, 0, 0], { x: r * 1.18, y: 0.05, z: r * 1.18 }, shade(tone, -0.08));
          }
        } else {
          scatter.add('tip', () => new THREE.ConeGeometry(1, 1, 7), logMat, { x, y: h + 0.17, z }, [0, rnd() * 3, 0], { x: r, y: 0.34, z: r }, tip === null ? shade(tone, 0.06) : vary(tip, rnd, 0.08));
        }
      }
    }
    // A cross rail behind the logs.
    sideRuns(0.5, (sx, z0, z1) => {
      scatter.add('rail', box, logMat, { x: sx * (ox + 0.24), y: 0.85, z: (z0 + z1) / 2 }, [0, 0, 0], { x: 0.12, y: 0.16, z: z1 - z0 }, t.wood.dark);
    });
    // End fences: posts and two rails, low enough not to hide the king towers.
    for (const sz of [-1, 1]) {
      const z = sz * oz;
      for (let x = -HALF_W - 0.3; x <= HALF_W + 0.3; x += 1.2) {
        scatter.add('post', () => new RoundedBoxGeometry(1, 1, 1, 2, 0.12), logMat, { x, y: 0.42, z }, [0, (rnd() - 0.5) * 0.1, 0], { x: 0.22, y: 0.84, z: 0.22 }, t.wood.dark);
      }
      for (const y of [0.36, 0.7]) {
        scatter.add('endRail', box, logMat, { x: 0, y, z }, [0, 0, 0], { x: ARENA_W + 1.2, y: 0.12, z: 0.1 }, shade(t.wood.base, y > 0.5 ? 0.04 : -0.02));
      }
    }
  } else if (border.kind === 'rockwall') {
    // Dry-stone walls: two staggered courses of blocks on the sides, one and a cap at the ends.
    const stone = border.stone;
    for (const sx of [-1, 1]) {
      for (const [course, y, h, shift] of [[0, 0.3, 0.6, 0], [1, 0.86, 0.52, 0.34]] as const) {
        for (let z = -HALF_H - 0.2 + shift; z <= HALF_H + 0.2; z += 0.68) {
          if (z > RIVER_Z0 - 0.6 && z < RIVER_Z1 + 0.6) continue;
          scatter.add('block', block, stoneMat, { x: sx * (ox + (rnd() - 0.5) * 0.05), y, z }, [0, (rnd() - 0.5) * 0.08, 0], { x: 0.55 - course * 0.04, y: h, z: 0.64 + rnd() * 0.04 }, vary(stone, rnd, 0.12));
        }
      }
    }
    for (const sz of [-1, 1]) {
      const z = sz * oz;
      for (let x = -HALF_W - 0.3; x <= HALF_W + 0.3; x += 0.74) {
        scatter.add('block', block, stoneMat, { x, y: 0.26, z }, [0, (rnd() - 0.5) * 0.08, 0], { x: 0.7 + rnd() * 0.04, y: 0.52, z: 0.42 }, vary(stone, rnd, 0.12));
      }
      for (let x = -HALF_W - 0.1; x <= HALF_W + 0.1; x += 1.1) {
        scatter.add('block', block, stoneMat, { x, y: 0.64, z }, [0, (rnd() - 0.5) * 0.1, 0], { x: 1.02, y: 0.24, z: 0.38 }, vary(shade(stone, 0.05), rnd, 0.08));
      }
    }
  } else if (border.kind === 'posts') {
    // Posts with a top rail, and either a second rail (rope, railings) or a panel (glass, paper).
    const { post, rail, panel, round, spacing } = border;
    const postGeo = round ? () => new THREE.CylinderGeometry(1, 1, 1, 10) : () => new RoundedBoxGeometry(1, 1, 1, 2, 0.12);
    const line = (a0: number, a1: number, along: 'x' | 'z', fixed: number, h: number) => {
      const len = a1 - a0;
      const n = Math.max(1, Math.round(len / spacing));
      const at = (a: number, y: number) => (along === 'z' ? { x: fixed, y, z: a } : { x: a, y, z: fixed });
      const span = (thick: number, tall: number) => (along === 'z' ? { x: thick, y: tall, z: len } : { x: len, y: tall, z: thick });
      for (let i = 0; i <= n; i++) {
        const a = a0 + (len * i) / n;
        scatter.add('post', postGeo, logMat, at(a, h / 2), [0, 0, 0], { x: round ? 0.1 : 0.18, y: h, z: round ? 0.1 : 0.18 }, post);
        if (round) scatter.add('postCap', () => new THREE.SphereGeometry(1, 10, 6), logMat, at(a, h), [0, 0, 0], { x: 0.13, y: 0.09, z: 0.13 }, shade(post, 0.04));
      }
      const mid = (a0 + a1) / 2;
      scatter.add('railTop', box, logMat, at(mid, h - 0.05), [0, 0, 0], span(0.12, 0.09), rail);
      if (panel === null) scatter.add('railMid', box, logMat, at(mid, h * 0.5), [0, 0, 0], span(0.08, 0.06), rail);
      else scatter.add('panel', box, tintMat(0.4), at(mid, h * 0.5), [0, 0, 0], span(0.05, h * 0.78), panel);
    };
    sideRuns(0.5, (sx, z0, z1) => line(z0, z1, 'z', sx * ox, 1.05));
    for (const sz of [-1, 1]) line(-HALF_W - 0.3, HALF_W + 0.3, 'x', sz * oz, 0.8);
  } else {
    // A working dock: crates (some stacked) and barrels along the sides, bollards and chain at the ends.
    const crateTones = [0xb98a55, 0xa47447, 0x8f6a44, 0x6f8a5a];
    const barrelTones = [0xc2483a, 0x3b6fb6, 0x4a4f57];
    for (const sx of [-1, 1]) {
      for (let z = -HALF_H - 0.1; z <= HALF_H + 0.1;) {
        const s = 0.62 + rnd() * 0.3;
        if (z + s / 2 > RIVER_Z0 - 0.5 && z - s / 2 < RIVER_Z1 + 0.5) {
          z += s;
          continue;
        }
        const x = sx * (ox + 0.1 + (rnd() - 0.5) * 0.1);
        if (rnd() < 0.2) {
          scatter.add('barrel', () => new THREE.CylinderGeometry(1, 1, 1, 12), logMat, { x, y: 0.42, z }, [0, 0, 0], { x: s * 0.4, y: 0.84, z: s * 0.4 }, barrelTones[Math.floor(rnd() * barrelTones.length)]!);
        } else {
          const tone = crateTones[Math.floor(rnd() * crateTones.length)]!;
          scatter.add('crate', block, logMat, { x, y: s / 2, z }, [0, (rnd() - 0.5) * 0.2, 0], { x: s, y: s, z: s }, vary(tone, rnd, 0.08));
          if (rnd() < 0.45) {
            const s2 = s * (0.65 + rnd() * 0.2);
            scatter.add('crate', block, logMat, { x, y: s + s2 / 2, z }, [0, (rnd() - 0.5) * 0.5, 0], { x: s2, y: s2, z: s2 }, vary(crateTones[Math.floor(rnd() * crateTones.length)]!, rnd, 0.08));
          }
        }
        z += s + 0.04;
      }
    }
    for (const sz of [-1, 1]) {
      const z = sz * oz;
      for (let x = -HALF_W - 0.3; x <= HALF_W + 0.3; x += 1.2) {
        scatter.add('bollard', () => new THREE.CylinderGeometry(0.8, 1, 1, 10), logMat, { x, y: 0.32, z }, [0, 0, 0], { x: 0.18, y: 0.64, z: 0.18 }, 0x2e3238);
        scatter.add('bollardCap', () => new THREE.CylinderGeometry(1, 1, 1, 10), logMat, { x, y: 0.66, z }, [0, 0, 0], { x: 0.22, y: 0.07, z: 0.22 }, 0x3a3f46);
      }
      scatter.add('chain', box, logMat, { x: 0, y: 0.5, z }, [0, 0, 0], { x: ARENA_W + 0.6, y: 0.05, z: 0.05 }, 0xf2c14e);
    }
  }

  const banners = litMat({ map: banner(t), transparent: true, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9 });
  const flames: THREE.Mesh[] = [];
  const flameMat = litMat({ color: 0xffb03a, emissive: 0xff7a1a, emissiveIntensity: 1.6, roughness: 0.4, toneMapped: false });
  const stoneTorch = t.torch === 'stone';
  for (const sz of [-1, 1]) {
    const z = sz * oz;
    // Banner poles at the corners and beside the king, each with the arena's pennant.
    for (const bx of [-HALF_W - 0.4, -4.6, 4.6, HALF_W + 0.4]) {
      const corner = Math.abs(bx) > HALF_W;
      const poleH = corner ? 2.6 : 2.1;
      scatter.add('pole', () => new THREE.CylinderGeometry(1, 1, 1, 8), logMat, { x: bx, y: poleH / 2, z: z + sz * 0.15 }, [0, 0, 0], { x: 0.07, y: poleH, z: 0.07 }, t.wood.dark);
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 1.3), banners);
      flag.position.set(bx, poleH - 0.75, z + sz * 0.24);
      flag.rotation.y = sz > 0 ? 0 : Math.PI;
      group.add(flag);
    }
    // Torches flanking the king's end: wooden posts, or stone braziers in the gym.
    for (const tx of [-2.6, 2.6]) {
      if (stoneTorch) {
        scatter.add('pillar', block, stoneMat, { x: tx, y: 0.6, z: z - sz * 0.1 }, [0, 0, 0], { x: 0.32, y: 1.2, z: 0.32 }, shade(t.bank, 0.04));
      } else {
        scatter.add('torch', () => new THREE.CylinderGeometry(0.6, 1, 1, 8), logMat, { x: tx, y: 0.6, z: z - sz * 0.1 }, [0, 0, 0], { x: 0.1, y: 1.2, z: 0.1 }, t.wood.dark);
      }
      scatter.add('bowl', () => new THREE.CylinderGeometry(1, 0.6, 1, 10), logMat, { x: tx, y: 1.26, z: z - sz * 0.1 }, [0, 0, 0], { x: 0.2, y: 0.16, z: 0.2 }, 0x4a4a52);
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.42, 8), flameMat);
      flame.position.set(tx, 1.52, z - sz * 0.1);
      flame.castShadow = false;
      group.add(flame);
      flames.push(flame);
    }
    // Boulders behind the fence, the big one centred on the king.
    for (const [bx, r] of [[0, 1.1], [-1.9, 0.6], [1.9, 0.65], [-6.6, 0.55], [6.8, 0.5]] as const) {
      scatter.add('boulder', () => new THREE.DodecahedronGeometry(1, 1), tintMat(0.95), { x: bx + (rnd() - 0.5) * 0.3, y: r * 0.45, z: z + sz * (0.9 + r * 0.6) }, [rnd(), rnd() * 3, rnd()], { x: r * 1.2, y: r * 0.8, z: r }, shade(t.rock, (rnd() - 0.5) * 0.1));
    }
  }
  group.add(scatter.build());
  return {
    group,
    update(time) {
      flames.forEach((f, i) => {
        const flicker = 1 + Math.sin(time * 17 + i * 2.3) * 0.12 + Math.sin(time * 29 + i) * 0.06;
        f.scale.set(1 / flicker, flicker, 1 / flicker);
      });
      flameMat.emissiveIntensity = 1.5 + Math.sin(time * 23) * 0.2;
    },
  };
}

function buildSurroundings(t: ArenaTheme): { group: THREE.Group; update(t: number): void } {
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
  banded(120, 120, -0.02, t.outer);
  banded(ARENA_W + 3.2, ARENA_H + 3.4, -0.01, t.apron);

  const scatter = new Scatter();
  const leafMat = tintMat(0.8);
  /** Rows along both sides and past both ends, skipping the river mouth. */
  const rows = (sideRows: number, endRows: number, spacing: number, place: (x: number, z: number, row: number) => void) => {
    for (const sx of [-1, 1]) {
      for (let row = 0; row < sideRows; row++) {
        for (let z = -HALF_H - 4; z <= HALF_H + 4; z += spacing + rnd() * 0.6) {
          if (Math.abs(z) < RIVER_Z1 + 1.4) continue;
          place(sx * (HALF_W + 2 + row * 1.7 + rnd() * 0.8), z + (rnd() - 0.5) * 0.6, row);
        }
      }
    }
    for (const sz of [-1, 1]) {
      for (let row = 0; row < endRows; row++) {
        for (let x = -HALF_W - 6; x <= HALF_W + 6; x += spacing + 0.1 + rnd() * 0.6) {
          place(x + (rnd() - 0.5) * 0.6, sz * (HALF_H + 3.6 + row * 1.7 + rnd() * 0.6), row);
        }
      }
    }
  };
  /** Spots just outside the fence line, for bushes, flowers, grass and mushrooms. */
  const hugging = (count: number, place: (x: number, z: number) => void) => {
    for (let i = 0; i < count; i++) {
      const sx = rnd() > 0.5 ? 1 : -1;
      const z = (rnd() - 0.5) * (ARENA_H + 2);
      if (Math.abs(z) < RIVER_Z1 + 0.8) continue;
      place(sx * (HALF_W + 1.2 + rnd() * 0.7), z);
    }
  };
  const bush = (x: number, z: number, color: number) => {
    const r = 0.28 + rnd() * 0.2;
    scatter.add('bush', () => new THREE.IcosahedronGeometry(1, 1), leafMat, { x, y: r * 0.8, z }, [rnd(), rnd(), rnd()], { x: r, y: r * 0.85, z: r }, shade(color, (rnd() - 0.3) * 0.1));
  };

  const box = () => new THREE.BoxGeometry(1, 1, 1);
  const block = () => new RoundedBoxGeometry(1, 1, 1, 2, 0.08);
  const rubble = (x: number, z: number, r: number) => {
    scatter.add('rubble', () => new THREE.DodecahedronGeometry(1, 0), tintMat(0.95), { x, y: r * 0.45, z }, [rnd(), rnd() * 3, rnd()], { x: r * 1.2, y: r * 0.8, z: r }, vary(t.rock, rnd, 0.16));
  };
  /** Mountains in a ring on the horizon. */
  const peaks = (n: number, color: number, base: number, spread: number) => {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rnd() * 0.3;
      const dist = 34 + rnd() * 14;
      const s = base + rnd() * spread;
      scatter.add('peak', () => new THREE.ConeGeometry(1, 1, 7), tintMat(0.95), { x: Math.cos(a) * dist, y: s * 0.45, z: Math.sin(a) * dist * 1.2 }, [0, rnd() * 3, 0], { x: s, y: s * (0.8 + rnd() * 0.4), z: s }, vary(color, rnd, 0.1));
    }
  };
  const lavaGeo = new THREE.CircleGeometry(1, 14);
  lavaGeo.rotateX(-Math.PI / 2);
  const lavaPool = (x: number, z: number, r: number) => {
    const pool = new THREE.Mesh(lavaGeo, glowMat(rnd() > 0.5 ? 0xff7a1a : 0xff9a2a));
    pool.position.set(x, 0.005, z);
    pool.scale.set(r * 1.3, 1, r);
    group.add(pool);
  };

  if (t.beyond === 'meadow') {
    // Forest: dense rows of soft trees behind the palisades and past each end.
    const tree = (x: number, z: number, size: number) => {
      const s = size * (0.85 + rnd() * 0.4);
      scatter.add('trunk', () => new THREE.CylinderGeometry(0.7, 1, 1, 6), tintMat(), { x, y: 0.5 * s, z }, [0, 0, 0], { x: 0.18 * s, y: s, z: 0.18 * s }, PALETTE.trunk);
      const leaf = rnd() > 0.35 ? PALETTE.leaf : rnd() > 0.5 ? 0x5aa83f : 0x3f8a3a;
      for (let i = 0; i < 3; i++) {
        const r = (0.6 + rnd() * 0.3) * s;
        scatter.add('canopy', () => new THREE.IcosahedronGeometry(1, 1), leafMat, { x: x + (rnd() - 0.5) * 0.7 * s, y: (1.25 + rnd() * 0.6) * s, z: z + (rnd() - 0.5) * 0.7 * s }, [rnd(), rnd(), rnd()], { x: r, y: r * 0.92, z: r }, shade(leaf, (rnd() - 0.5) * 0.08));
      }
    };
    rows(4, 3, 1.5, (x, z, row) => tree(x, z, (Math.abs(z) > HALF_H + 3 ? 1.05 : 1) + row * 0.15));
    // Bushes and flowers hugging the palisades inside the forest line.
    const flowerColors = [0xff9ec8, 0xffe36b, 0xffffff, 0xff7a6b];
    hugging(70, (x, z) => {
      if (rnd() < 0.55) bush(x, z, PALETTE.leafDark);
      else scatter.add('flower', () => new THREE.SphereGeometry(1, 8, 6), tintMat(0.6), { x, y: 0.12, z }, [0, 0, 0], { x: 0.09, y: 0.07, z: 0.09 }, flowerColors[Math.floor(rnd() * flowerColors.length)]!);
    });
  } else if (t.beyond === 'pines') {
    // Viridian's pines: tall, dark and packed close, with tall grass and mushrooms at their feet.
    const needles = [0x2f6b2c, 0x3a7a31, 0x24592a, 0x2c6430];
    const pine = (x: number, z: number, size: number) => {
      const s = size * (0.85 + rnd() * 0.45);
      scatter.add('pineTrunk', () => new THREE.CylinderGeometry(0.7, 1, 1, 6), tintMat(), { x, y: 0.35 * s, z }, [0, 0, 0], { x: 0.16 * s, y: 0.7 * s, z: 0.16 * s }, 0x5e3d22);
      const color = needles[Math.floor(rnd() * needles.length)]!;
      for (let k = 0; k < 3; k++) {
        const r = (0.95 - k * 0.24) * s;
        scatter.add('pineTier', () => new THREE.ConeGeometry(1, 1, 7), leafMat, { x, y: (0.95 + k * 0.62) * s, z }, [0, rnd() * 3, 0], { x: r, y: 1.05 * s, z: r }, shade(color, k * 0.03 + (rnd() - 0.5) * 0.05));
      }
    };
    rows(5, 4, 1.25, (x, z, row) => pine(x, z, 1.1 + row * 0.2));
    hugging(90, (x, z) => {
      const roll = rnd();
      if (roll < 0.4) {
        // A clump of tall grass, the kind wild Pokémon jump out of.
        for (let k = 0; k < 5; k++) {
          const h = 0.32 + rnd() * 0.22;
          scatter.add('blade', () => new THREE.ConeGeometry(1, 1, 4), leafMat, { x: x + (rnd() - 0.5) * 0.35, y: h / 2, z: z + (rnd() - 0.5) * 0.35 }, [(rnd() - 0.5) * 0.4, rnd() * 3, (rnd() - 0.5) * 0.4], { x: 0.07, y: h, z: 0.07 }, vary(0x4f9a35, rnd, 0.12));
        }
      } else if (roll < 0.62) {
        // A mushroom: pale stem, red or tan cap.
        const s = 0.7 + rnd() * 0.6;
        scatter.add('stem', () => new THREE.CylinderGeometry(0.8, 1, 1, 8), tintMat(0.7), { x, y: 0.09 * s, z }, [0, 0, 0], { x: 0.05 * s, y: 0.18 * s, z: 0.05 * s }, 0xefe6d2);
        scatter.add('cap', () => new THREE.SphereGeometry(1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), tintMat(0.6), { x, y: 0.17 * s, z }, [0, 0, 0], { x: 0.14 * s, y: 0.1 * s, z: 0.14 * s }, rnd() > 0.4 ? 0xd8452f : 0xc99a5b);
      } else {
        bush(x, z, 0x2f6b2c);
      }
    });
  } else if (t.beyond === 'crags') {
    // Pewter's crags: rock spires and boulders, with Mt. Moon's peaks on the horizon.
    rows(3, 3, 2.1, (x, z, row) => {
      const h = 1.2 + rnd() * (1.4 + row * 0.6);
      const r = 0.55 + rnd() * 0.35 + row * 0.1;
      scatter.add('spire', () => new THREE.DodecahedronGeometry(1, 0), tintMat(0.95), { x, y: h * 0.45, z }, [rnd() * 0.3, rnd() * 3, rnd() * 0.3], { x: r, y: h, z: r * 0.9 }, vary(t.rock, rnd, 0.14));
      if (rnd() < 0.5) rubble(x + (rnd() - 0.5) * 1.4, z + (rnd() - 0.5) * 1.4, 0.3 + rnd() * 0.3);
    });
    hugging(60, (x, z) => {
      if (rnd() < 0.7) rubble(x, z, 0.08 + rnd() * 0.16);
      else bush(x, z, 0x7a8a4a);
    });
    peaks(14, 0x7d6d58, 9, 7);
  } else if (t.beyond === 'beach') {
    // Cerulean Cape: a strip of beach, palms leaning seaward, parasols, then open sea.
    banded(ARENA_W + 13, ARENA_H + 12, -0.015, 0xe9d39c);
    const palm = (x: number, z: number) => {
      const s = 0.9 + rnd() * 0.4;
      const lean = (x > 0 ? 1 : -1) * (0.12 + rnd() * 0.1);
      let px = x;
      let py = 0;
      for (let k = 0; k < 6; k++) {
        const seg = 0.42 * s;
        scatter.add('palmTrunk', () => new THREE.CylinderGeometry(0.85, 1, 1, 7), tintMat(), { x: px, y: py + seg / 2, z }, [0, 0, -lean * k * 0.5], { x: 0.13 * s, y: seg, z: 0.13 * s }, vary(0x9c7a4e, rnd, 0.1));
        px += Math.sin(lean * k * 0.5) * seg;
        py += Math.cos(lean * k * 0.5) * seg;
      }
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * Math.PI * 2 + rnd() * 0.3;
        scatter.add('frond', () => new THREE.SphereGeometry(1, 8, 4), leafMat, { x: px + Math.cos(a) * 0.55 * s, y: py - 0.12, z: z + Math.sin(a) * 0.55 * s }, [0, -a, 0.35], { x: 0.75 * s, y: 0.06 * s, z: 0.2 * s }, vary(0x4f9a3a, rnd, 0.12));
      }
      scatter.add('coconut', () => new THREE.SphereGeometry(1, 8, 6), tintMat(), { x: px, y: py - 0.12, z }, [0, 0, 0], { x: 0.14, y: 0.14, z: 0.14 }, 0x6b4a2a);
    };
    rows(2, 1, 2.8, (x, z) => palm(x, z));
    const stripes = [0xe8463e, 0x2f7fd0, 0xf2c14e];
    hugging(40, (x, z) => {
      const roll = rnd();
      if (roll < 0.25) {
        scatter.add('parasolPole', () => new THREE.CylinderGeometry(1, 1, 1, 6), tintMat(), { x, y: 0.6, z }, [0, 0, 0], { x: 0.03, y: 1.2, z: 0.03 }, 0xf4f1ea);
        scatter.add('parasol', () => new THREE.ConeGeometry(1, 1, 8), tintMat(0.6), { x, y: 1.25, z }, [0, rnd() * 3, 0], { x: 0.6, y: 0.28, z: 0.6 }, stripes[Math.floor(rnd() * stripes.length)]!);
      } else if (roll < 0.6) {
        scatter.add('shell', () => new THREE.SphereGeometry(1, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), tintMat(0.5), { x, y: 0, z }, [0, rnd() * 3, 0], { x: 0.1, y: 0.06, z: 0.08 }, rnd() > 0.5 ? 0xf7c6b5 : 0xfff6e8);
      } else {
        rubble(x, z, 0.12 + rnd() * 0.18);
      }
    });
  } else if (t.beyond === 'docks') {
    // Vermilion's harbour: the deck runs on, crates and shipping containers stack up, cranes stand over the water.
    banded(ARENA_W + 12, ARENA_H + 11, -0.015, 0x6f4c30);
    const containers = [0xc2483a, 0x3b6fb6, 0x4f8a4a, 0xe07b1f, 0x8a8f96];
    rows(2, 2, 2.6, (x, z, row) => {
      if (Math.abs(z) > HALF_H + 3) {
        // Containers past the ends, long side facing the field, sometimes two high.
        const c = containers[Math.floor(rnd() * containers.length)]!;
        scatter.add('container', block, tintMat(0.7), { x, y: 0.6, z }, [0, (rnd() - 0.5) * 0.1, 0], { x: 2.4, y: 1.2, z: 1.05 }, c);
        if (rnd() < 0.45 + row * 0.2) scatter.add('container', block, tintMat(0.7), { x: x + (rnd() - 0.5) * 0.4, y: 1.8, z }, [0, (rnd() - 0.5) * 0.1, 0], { x: 2.4, y: 1.2, z: 1.05 }, containers[Math.floor(rnd() * containers.length)]!);
      } else {
        const n = 1 + Math.floor(rnd() * 3);
        let y = 0;
        for (let k = 0; k < n; k++) {
          const s = (1.05 - k * 0.18) * (0.9 + rnd() * 0.2);
          scatter.add('crate', block, tintMat(), { x: x + (rnd() - 0.5) * 0.2, y: y + s / 2, z: z + (rnd() - 0.5) * 0.2 }, [0, rnd() * 0.6, 0], { x: s, y: s, z: s }, vary(0xa47447, rnd, 0.12));
          y += s;
        }
      }
    });
    // Two dockside cranes, arms reaching out over the river.
    for (const [cx, cz] of [[-(HALF_W + 5), -(RIVER_Z1 + 3.5)], [HALF_W + 5, RIVER_Z1 + 3.5]] as const) {
      const out = cx < 0 ? 1 : -1;
      for (const [dx, dz] of [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]] as const) {
        scatter.add('craneLeg', box, tintMat(0.7), { x: cx + dx, y: 3.5, z: cz + dz }, [0, 0, 0], { x: 0.22, y: 7, z: 0.22 }, 0xe07b1f);
      }
      scatter.add('craneCab', block, tintMat(0.7), { x: cx, y: 7.4, z: cz }, [0, 0, 0], { x: 1.8, y: 0.9, z: 1.6 }, 0xe8e4da);
      scatter.add('craneArm', box, tintMat(0.7), { x: cx + out * 3.4, y: 7.9, z: cz }, [0, 0, 0], { x: 7, y: 0.32, z: 0.4 }, 0xe07b1f);
      scatter.add('craneCable', box, tintMat(0.7), { x: cx + out * 6.2, y: 6.2, z: cz }, [0, 0, 0], { x: 0.04, y: 3.2, z: 0.04 }, 0x2e3238);
      scatter.add('craneHook', block, tintMat(0.7), { x: cx + out * 6.2, y: 4.5, z: cz }, [0, 0, 0], { x: 0.3, y: 0.3, z: 0.3 }, 0x2e3238);
    }
  } else if (t.beyond === 'city') {
    // Celadon's skyline around the roof: towers with lit windows, planters along the railing.
    const towerMat = litMat({ map: windowTexture(), roughness: 0.6 });
    const facades = [0xdcd6ec, 0xc9d9ea, 0xece0c8, 0xb9c2ce, 0xe6c9c0];
    for (let i = 0; i < 46; i++) {
      const a = (i / 46) * Math.PI * 2 + rnd() * 0.1;
      const dist = 17 + rnd() * 14;
      const w = 3 + rnd() * 3;
      const h = 5 + rnd() * 12;
      scatter.add('tower', () => new THREE.BoxGeometry(1, 1, 1), towerMat, { x: Math.cos(a) * dist, y: h / 2 - 3, z: Math.sin(a) * dist * 1.25 }, [0, rnd() * 0.3, 0], { x: w, y: h, z: w }, facades[Math.floor(rnd() * facades.length)]!);
    }
    hugging(60, (x, z) => {
      const roll = rnd();
      if (roll < 0.45) {
        scatter.add('planter', block, tintMat(), { x, y: 0.2, z }, [0, 0, 0], { x: 0.6, y: 0.4, z: 0.6 }, 0x6a6f76);
        bush(x, z + 0.02, 0x4f9f3a);
      } else if (roll < 0.7) {
        scatter.add('vent', block, tintMat(0.6), { x, y: 0.3, z }, [0, 0, 0], { x: 0.7, y: 0.6, z: 0.5 }, 0xb9bec4);
      } else {
        scatter.add('tank', () => new THREE.CylinderGeometry(1, 1, 1, 12), tintMat(), { x, y: 0.5, z }, [0, 0, 0], { x: 0.35, y: 1, z: 0.35 }, 0x9aa0a8);
      }
    });
  } else if (t.beyond === 'savanna') {
    // The Safari Zone: flat-topped acacias, termite mounds, golden grass and low hills.
    const acacia = (x: number, z: number) => {
      const s = 0.9 + rnd() * 0.5;
      scatter.add('acaciaTrunk', () => new THREE.CylinderGeometry(0.6, 1, 1, 6), tintMat(), { x, y: 0.9 * s, z }, [(rnd() - 0.5) * 0.2, 0, (rnd() - 0.5) * 0.2], { x: 0.12 * s, y: 1.8 * s, z: 0.12 * s }, 0x6b4a2e);
      scatter.add('acaciaTop', () => new THREE.SphereGeometry(1, 10, 6), leafMat, { x, y: 1.9 * s, z }, [0, rnd() * 3, 0], { x: 1.5 * s, y: 0.32 * s, z: 1.2 * s }, vary(0x6f8f3a, rnd, 0.1));
    };
    const grass = (x: number, z: number, n: number) => {
      for (let k = 0; k < n; k++) {
        const h = 0.35 + rnd() * 0.3;
        scatter.add('blade', () => new THREE.ConeGeometry(1, 1, 4), leafMat, { x: x + (rnd() - 0.5) * 0.45, y: h / 2, z: z + (rnd() - 0.5) * 0.45 }, [(rnd() - 0.5) * 0.4, rnd() * 3, (rnd() - 0.5) * 0.4], { x: 0.07, y: h, z: 0.07 }, vary(0xc4b04a, rnd, 0.14));
      }
    };
    rows(3, 2, 2.4, (x, z, row) => {
      const roll = rnd();
      if (roll < 0.35 + row * 0.1) acacia(x, z);
      else if (roll < 0.5) scatter.add('mound', () => new THREE.ConeGeometry(1, 1, 7), tintMat(0.95), { x, y: 0.5, z }, [0, rnd() * 3, 0], { x: 0.45, y: 1, z: 0.45 }, vary(0xa0754a, rnd, 0.1));
      else if (roll < 0.62) rubble(x, z, 0.4 + rnd() * 0.4);
      else grass(x, z, 7);
    });
    hugging(50, (x, z) => grass(x, z, 5));
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + rnd() * 0.3;
      const dist = 36 + rnd() * 10;
      const s = 10 + rnd() * 8;
      scatter.add('hill', () => new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), tintMat(0.95), { x: Math.cos(a) * dist, y: -0.5, z: Math.sin(a) * dist * 1.2 }, [0, 0, 0], { x: s, y: s * 0.35, z: s }, vary(0xa89a48, rnd, 0.08));
    }
  } else if (t.beyond === 'garden') {
    // Saffron's dojo garden: cherry trees in bloom, stone lanterns, and a pagoda past each end.
    const blossom = [0xf6b3cf, 0xf9c6da, 0xef9fc0, 0xfbd8e6];
    const cherry = (x: number, z: number, size: number) => {
      const s = size * (0.85 + rnd() * 0.35);
      scatter.add('trunk', () => new THREE.CylinderGeometry(0.7, 1, 1, 6), tintMat(), { x, y: 0.5 * s, z }, [(rnd() - 0.5) * 0.25, 0, (rnd() - 0.5) * 0.25], { x: 0.15 * s, y: s, z: 0.15 * s }, 0x4a3028);
      for (let i = 0; i < 4; i++) {
        const r = (0.5 + rnd() * 0.3) * s;
        scatter.add('canopy', () => new THREE.IcosahedronGeometry(1, 1), leafMat, { x: x + (rnd() - 0.5) * 0.9 * s, y: (1.15 + rnd() * 0.5) * s, z: z + (rnd() - 0.5) * 0.9 * s }, [rnd(), rnd(), rnd()], { x: r, y: r * 0.85, z: r }, blossom[Math.floor(rnd() * blossom.length)]!);
      }
    };
    rows(3, 1, 2.0, (x, z, row) => cherry(x, z, 1 + row * 0.15));
    hugging(16, (x, z) => {
      const stone = 0x9a948c;
      scatter.add('lanternBase', block, tintMat(0.95), { x, y: 0.08, z }, [0, 0, 0], { x: 0.36, y: 0.16, z: 0.36 }, stone);
      scatter.add('lanternPost', () => new THREE.CylinderGeometry(1, 1, 1, 6), tintMat(0.95), { x, y: 0.4, z }, [0, 0, 0], { x: 0.08, y: 0.5, z: 0.08 }, stone);
      scatter.add('lanternBox', block, tintMat(0.6), { x, y: 0.75, z }, [0, 0, 0], { x: 0.26, y: 0.22, z: 0.26 }, 0xffe3a0);
      scatter.add('lanternRoof', () => new THREE.ConeGeometry(1, 1, 4), tintMat(0.95), { x, y: 0.95, z }, [0, Math.PI / 4, 0], { x: 0.3, y: 0.2, z: 0.3 }, shade(stone, -0.08));
    });
    for (const sz of [-1, 1]) {
      const pz = sz * (HALF_H + 8.5);
      let y = 0;
      for (let k = 0; k < 4; k++) {
        const w = 3.2 - k * 0.6;
        const h = 1.1;
        scatter.add('pagodaWall', box, tintMat(0.7), { x: 0, y: y + h / 2, z: pz }, [0, 0, 0], { x: w, y: h, z: w }, 0xb83a2e);
        scatter.add('pagodaRoof', () => new THREE.ConeGeometry(1, 1, 4), tintMat(0.7), { x: 0, y: y + h + 0.2, z: pz }, [0, Math.PI / 4, 0], { x: w * 0.95, y: 0.6, z: w * 0.95 }, 0x3a3a48);
        y += h + 0.35;
      }
      scatter.add('pagodaSpire', () => new THREE.CylinderGeometry(0.3, 1, 1, 8), tintMat(0.4), { x: 0, y: y + 0.6, z: pz }, [0, 0, 0], { x: 0.1, y: 1.4, z: 0.1 }, 0xf2c14e);
    }
  } else if (t.beyond === 'volcano') {
    // Cinnabar: black spires, pools of lava, and volcanoes glowing on the horizon.
    rows(3, 3, 2.0, (x, z, row) => {
      const h = 1.4 + rnd() * (1.6 + row * 0.6);
      const r = 0.5 + rnd() * 0.35 + row * 0.1;
      scatter.add('spire', () => new THREE.DodecahedronGeometry(1, 0), tintMat(0.95), { x, y: h * 0.45, z }, [rnd() * 0.3, rnd() * 3, rnd() * 0.3], { x: r, y: h, z: r * 0.9 }, vary(t.rock, rnd, 0.1));
    });
    hugging(40, (x, z) => (rnd() < 0.6 ? rubble(x, z, 0.1 + rnd() * 0.2) : lavaPool(x, z, 0.3 + rnd() * 0.35)));
    for (let i = 0; i < 10; i++) lavaPool((rnd() > 0.5 ? 1 : -1) * (HALF_W + 3 + rnd() * 5), (rnd() - 0.5) * (ARENA_H + 6), 0.5 + rnd() * 0.8);
    const craters = new THREE.CircleGeometry(1, 16);
    craters.rotateX(-Math.PI / 2);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + rnd() * 0.4;
      const dist = 36 + rnd() * 10;
      const s = 10 + rnd() * 8;
      const h = s * (0.9 + rnd() * 0.3);
      const x = Math.cos(a) * dist;
      const z = Math.sin(a) * dist * 1.2;
      // A truncated cone, so the crater has a rim to glow in.
      scatter.add('volcano', () => new THREE.CylinderGeometry(0.18, 1, 1, 9), tintMat(0.95), { x, y: h / 2, z }, [0, rnd() * 3, 0], { x: s, y: h, z: s }, vary(0x3a3032, rnd, 0.08));
      const crater = new THREE.Mesh(craters, glowMat(0xff7a1a));
      crater.position.set(x, h + 0.05, z);
      crater.scale.setScalar(s * 0.17);
      group.add(crater);
    }
  } else {
    // The Indigo Plateau stadium: tiered stands packed with fans, floodlights at the corners.
    const seats = [0x3b3f8a, 0x4a50a0];
    const fans = [0xe8463e, 0x3b82f6, 0xf2c14e, 0xf4f1ea, 0x4fae3a, 0xff9ec8, 0x2a2a30];
    const tiers = 6;
    const stand = (along: 'x' | 'z', a0: number, a1: number, out: number, sign: number) => {
      const len = a1 - a0;
      const mid = (a0 + a1) / 2;
      for (let k = 0; k < tiers; k++) {
        const d = out + k * 0.9;
        const top = 0.45 + k * 0.55;
        const at = (a: number, y: number) => (along === 'z' ? { x: sign * d, y, z: a } : { x: a, y, z: sign * d });
        scatter.add('tier', box, tintMat(0.8), at(mid, top / 2), [0, 0, 0], along === 'z' ? { x: 0.9, y: top, z: len } : { x: len, y: top, z: 0.9 }, seats[k % 2]!);
        for (let a = a0 + 0.2; a < a1 - 0.1; a += 0.34) {
          if (rnd() < 0.18) continue;
          scatter.add('fan', block, tintMat(0.7), at(a + (rnd() - 0.5) * 0.08, top + 0.17), [0, 0, 0], { x: 0.2, y: 0.34, z: 0.2 }, fans[Math.floor(rnd() * fans.length)]!);
        }
      }
    };
    for (const sx of [-1, 1]) {
      stand('z', -HALF_H - 2, RIVER_Z0 - 1.2, HALF_W + 2.4, sx);
      stand('z', RIVER_Z1 + 1.2, HALF_H + 2, HALF_W + 2.4, sx);
    }
    for (const sz of [-1, 1]) stand('x', -HALF_W - 2, HALF_W + 2, HALF_H + 3.2, sz);
    for (const [fx, fz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
      const x = fx * (HALF_W + 8.5);
      const z = fz * (HALF_H + 7);
      scatter.add('mast', box, tintMat(0.6), { x, y: 5, z }, [0, 0, 0], { x: 0.35, y: 10, z: 0.35 }, 0x8a8f96);
      scatter.add('lampRig', box, tintMat(0.6), { x, y: 10.2, z }, [0, Math.atan2(fx, fz), 0], { x: 2.2, y: 1.2, z: 0.3 }, 0x5b6168);
      const lamps = new THREE.Mesh(new THREE.PlaneGeometry(2, 1), glowMat(0xfff4d0));
      lamps.position.set(x - fx * 0.2, 10.2, z - fz * 0.2);
      lamps.lookAt(0, 6, 0);
      group.add(lamps);
    }
    peaks(12, 0x5a5f8a, 11, 7);
  }

  // Ambient specks: fireflies drift, embers rise, petals and confetti fall.
  const specks: Array<{ m: THREE.Mesh; x: number; y: number; z: number; phase: number }> = [];
  const motion = t.particles?.motion;
  if (t.particles) {
    const p = t.particles;
    const flat = p.motion === 'fall';
    const mat = p.glow
      ? litMat({ color: p.color, emissive: p.glow, emissiveIntensity: 2, toneMapped: false })
      : litMat({ color: p.color, roughness: 0.6, side: THREE.DoubleSide });
    const geo = flat ? new THREE.PlaneGeometry(p.size * 2, p.size * 1.4) : new THREE.SphereGeometry(p.size, 6, 4);
    for (let i = 0; i < p.count; i++) {
      const m = new THREE.Mesh(geo, mat);
      const edge = p.motion === 'drift';
      const x = edge ? (rnd() > 0.5 ? 1 : -1) * (HALF_W - 1 + rnd() * 4) : (rnd() - 0.5) * (ARENA_W + 8);
      const z = (rnd() - 0.5) * (ARENA_H + 4);
      const y = 0.5 + rnd() * 1.8;
      m.position.set(x, y, z);
      group.add(m);
      specks.push({ m, x, y, z, phase: rnd() * 10 });
    }
  }
  group.add(scatter.build());
  return {
    group,
    update(time) {
      for (const s of specks) {
        if (motion === 'drift') {
          s.m.position.set(s.x + Math.sin(time * 0.4 + s.phase) * 0.6, s.y + Math.sin(time * 0.9 + s.phase * 2) * 0.25, s.z + Math.cos(time * 0.3 + s.phase) * 0.6);
          s.m.scale.setScalar(0.4 + Math.max(0, Math.sin(time * 1.7 + s.phase)) * 0.8);
        } else if (motion === 'rise') {
          const k = (time * 0.18 + s.phase) % 1;
          s.m.position.set(s.x + Math.sin(time * 1.3 + s.phase) * 0.25, k * 4, s.z);
          s.m.scale.setScalar(Math.sin(k * Math.PI));
        } else {
          const k = (time * 0.09 + s.phase) % 1;
          s.m.position.set(s.x + Math.sin(time * 0.8 + s.phase) * 0.7, 4.5 - k * 4.5, s.z + Math.cos(time * 0.5 + s.phase) * 0.4);
          s.m.rotation.set(time * 1.3 + s.phase, time * 0.9, time * 0.7 + s.phase);
        }
      }
    },
  };
}

/** Unlit glowing material: lava, craters, floodlights. */
function glowMat(color: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color, toneMapped: false, side: THREE.DoubleSide });
}

let windowTex: THREE.CanvasTexture | null = null;

/** A façade of lit and dark windows, tinted per building by the instance colour. */
function windowTexture(): THREE.CanvasTexture {
  if (windowTex) return windowTex;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 64, 128);
  const rnd = seeded(404);
  for (let y = 6; y < 124; y += 12) {
    for (let x = 5; x < 60; x += 11) {
      g.fillStyle = rnd() > 0.7 ? '#fff1b8' : '#5d6f86';
      g.fillRect(x, y, 7, 7);
    }
  }
  windowTex = new THREE.CanvasTexture(c);
  windowTex.colorSpace = THREE.SRGBColorSpace;
  windowTex.magFilter = THREE.NearestFilter;
  return windowTex;
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
