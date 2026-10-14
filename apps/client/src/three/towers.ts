import * as THREE from 'three';
import { litMat } from './style/toon.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { PALETTE, seeded, shade, staticMat, teamColor } from './palette.js';

export type TowerKind = 'king' | 'princess';

export interface TowerModel {
  group: THREE.Group;
  /** Where the Pokémon or trainer stands, in the tower's local space. */
  standY: number;
  /** Top of the model, for the HP bar anchor. */
  topY: number;
  /** Swap the intact tower for a rubble heap (idempotent). */
  ruin(): void;
  update(dt: number, t: number): void;
}

const brickTextures = new Map<string, THREE.CanvasTexture>();

/** Ashlar masonry: staggered courses of slightly varied stones with mortar joints. */
function masonryTexture(base: number, key: string): THREE.CanvasTexture {
  const cached = brickTextures.get(key);
  if (cached) return cached;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const g = c.getContext('2d')!;
  const rnd = seeded(key.length * 97 + base);
  g.fillStyle = `#${shade(base, -0.16).toString(16).padStart(6, '0')}`;
  g.fillRect(0, 0, 256, 256);
  const rows = 6;
  const h = 256 / rows;
  for (let r = 0; r < rows; r++) {
    const offset = r % 2 === 0 ? 0 : -32;
    for (let x = offset; x < 256; x += 64) {
      const tone = shade(base, (rnd() - 0.5) * 0.08);
      g.fillStyle = `#${tone.toString(16).padStart(6, '0')}`;
      const pad = 3;
      roundRect(g, x + pad, r * h + pad, 64 - pad * 2, h - pad * 2, 6);
      g.fill();
      // Top highlight and bottom shadow on each stone give it relief.
      g.fillStyle = 'rgba(255,255,255,0.18)';
      g.fillRect(x + pad + 4, r * h + pad + 2, 64 - pad * 2 - 8, 3);
      g.fillStyle = 'rgba(0,0,0,0.12)';
      g.fillRect(x + pad + 4, r * h + h - pad - 5, 64 - pad * 2 - 8, 3);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  brickTextures.set(key, tex);
  return tex;
}

const emblemTextures = new Map<number, THREE.CanvasTexture>();

/** A Poké Ball face: top half in the team colour, white below, black band and button ring. */
function emblemTexture(top: number): THREE.CanvasTexture {
  const cached = emblemTextures.get(top);
  if (cached) return cached;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const g = c.getContext('2d')!;
  const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
  const cx = 128;
  const r = 124;
  g.fillStyle = '#f6f3ec';
  g.beginPath();
  g.arc(cx, cx, r, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = hex(top);
  g.beginPath();
  g.arc(cx, cx, r, Math.PI, 0);
  g.fill();
  // Gloss on the top half.
  g.fillStyle = 'rgba(255,255,255,0.28)';
  g.beginPath();
  g.ellipse(cx - 40, cx - 66, 36, 18, -0.5, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#1d1d22';
  g.fillRect(cx - r, cx - 13, r * 2, 26);
  g.beginPath();
  g.arc(cx, cx, 44, 0, Math.PI * 2);
  g.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  emblemTextures.set(top, tex);
  return tex;
}

/** A Poké Ball emblem facing +Z: printed disc, dark rim and a raised white button. */
function emblem(radius: number, top: number): THREE.Group {
  const g = new THREE.Group();
  const face = new THREE.Mesh(new THREE.CircleGeometry(radius, 40), litMat({ map: emblemTexture(top), roughness: 0.5 }));
  face.position.z = 0.02;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(radius, radius * 0.07, 8, 40), staticMat(0x1d1d22, { roughness: 0.6 }));
  const button = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.22, radius * 0.24, radius * 0.16, 24), staticMat(0xf6f3ec, { roughness: 0.4 }));
  button.rotation.x = Math.PI / 2;
  button.position.z = radius * 0.08;
  for (const m of [face, rim, button]) {
    m.castShadow = false;
    m.receiveShadow = true;
    g.add(m);
  }
  return g;
}

/**
 * A tower in the style of the concept art: a squat block of pale masonry on a slab, a big
 * Poké Ball emblem on its faces, and a parapet basin with team-coloured corner cushions that
 * the starter (or the trainer, on the king tower) sits down inside. `facing` is +1 when the
 * tower's owner looks from +Z (team 0), -1 otherwise.
 */
export function buildTower(kind: TowerKind, mine: boolean, facing: 1 | -1): TowerModel {
  const king = kind === 'king';
  const group = new THREE.Group();
  const intact = new THREE.Group();
  group.add(intact);
  const size = king ? 3.4 : 2.6;
  const bodyH = king ? 2.4 : 2.0;
  const plinthH = 0.26;
  const color = teamColor(mine);
  const rnd = seeded((king ? 7 : 3) + (mine ? 0 : 50));

  const add = (mesh: THREE.Mesh, parent: THREE.Object3D = intact) => {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };

  // Slab.
  const plinth = add(new THREE.Mesh(new RoundedBoxGeometry(size + 0.6, plinthH, size + 0.6, 2, 0.08), staticMat(PALETTE.stoneDark)));
  plinth.position.y = plinthH / 2;

  // Pale masonry body with a darker footing course.
  const tex = masonryTexture(PALETTE.towerStone, kind).clone();
  tex.needsUpdate = true;
  tex.repeat.set(size / 1.3, bodyH / 1.05);
  const body = add(new THREE.Mesh(new RoundedBoxGeometry(size, bodyH, size, 3, 0.12), litMat({ map: tex, roughness: 0.9 })));
  body.position.y = plinthH + bodyH / 2;
  const footing = add(new THREE.Mesh(new RoundedBoxGeometry(size + 0.12, 0.3, size + 0.12, 2, 0.06), staticMat(PALETTE.stone)));
  footing.position.y = plinthH + 0.15;

  const topY = plinthH + bodyH;
  // Team band under the parapet.
  const band = add(new THREE.Mesh(new RoundedBoxGeometry(size + 0.12, 0.12, size + 0.12, 2, 0.04), staticMat(color, { roughness: 0.55 })));
  band.position.y = topY - 0.1;

  // Parapet basin: stone walls capped in team colour, with big cushioned corners.
  const wallH = 0.26;
  const wallT = 0.26;
  const inner = size - 0.2;
  const wallMat = staticMat(shade(PALETTE.towerStone, -0.02));
  const capMat = staticMat(PALETTE.stoneLight);
  for (const [x, z, w, d] of [
    [0, -inner / 2 + wallT / 2, inner, wallT], [0, inner / 2 - wallT / 2, inner, wallT],
    [-inner / 2 + wallT / 2, 0, wallT, inner], [inner / 2 - wallT / 2, 0, wallT, inner],
  ] as const) {
    const wall = add(new THREE.Mesh(new RoundedBoxGeometry(w, wallH, d, 2, 0.05), wallMat));
    wall.position.set(x, topY + 0.08 + wallH / 2, z);
    const cap = add(new THREE.Mesh(new RoundedBoxGeometry(w + 0.04, 0.1, d + 0.04, 2, 0.04), capMat));
    cap.position.set(x, topY + 0.08 + wallH + 0.03, z);
  }
  const cushion = new RoundedBoxGeometry(king ? 0.62 : 0.52, king ? 0.5 : 0.44, king ? 0.62 : 0.52, 3, 0.14);
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    const c = add(new THREE.Mesh(cushion, staticMat(shade(color, (rnd() - 0.5) * 0.03), { roughness: 0.5 })));
    c.position.set((x * (size - 0.42)) / 2, topY + 0.08 + (king ? 0.25 : 0.22), (z * (size - 0.42)) / 2);
  }
  // Flagstone floor inside the basin.
  const deck = add(new THREE.Mesh(new THREE.BoxGeometry(inner - wallT * 2 + 0.05, 0.08, inner - wallT * 2 + 0.05), staticMat(PALETTE.stoneDark)));
  deck.position.y = topY + 0.12;

  // Poké Ball emblems on the two faces the cameras see.
  for (const f of [1, -1]) {
    const e = emblem(king ? 0.78 : 0.6, color);
    e.position.set(0, plinthH + bodyH * 0.5, f * (size / 2 + 0.01));
    if (f < 0) e.rotation.y = Math.PI;
    intact.add(e);
  }
  // The king's tower also wears gold Poké Ball finials on its front corners.
  if (king) {
    for (const x of [-1, 1]) {
      const finial = add(new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), staticMat(PALETTE.gold, { roughness: 0.35, metalness: 0.45 })));
      finial.position.set((x * (size - 0.42)) / 2, topY + 0.08 + 0.5 + 0.16, (facing * (size - 0.42)) / 2);
    }
  }

  // Rubble, hidden until the tower falls.
  const rubble = new THREE.Group();
  rubble.visible = false;
  group.add(rubble);
  const rr = seeded(king ? 404 : 303);
  const stoneGeo = new THREE.DodecahedronGeometry(1, 0);
  for (let i = 0; i < (king ? 18 : 13); i++) {
    const r = 0.25 + rr() * 0.45;
    const m = new THREE.Mesh(stoneGeo, staticMat(shade(PALETTE.towerStone, (rr() - 0.6) * 0.2), { roughness: 0.95 }));
    m.scale.set(r, r * 0.7, r * (0.8 + rr() * 0.4));
    const a = rr() * Math.PI * 2;
    const d = rr() * size * 0.42;
    m.position.set(Math.cos(a) * d, r * 0.45 + (d < size * 0.2 ? 0.3 : 0), Math.sin(a) * d);
    m.rotation.set(rr() * 3, rr() * 3, rr() * 3);
    m.castShadow = true;
    m.receiveShadow = true;
    rubble.add(m);
  }
  // A cracked cushion in the team colour marks whose tower it was.
  const broken = new THREE.Mesh(cushion, staticMat(color, { roughness: 0.6 }));
  broken.position.set(size * 0.18, 0.3, -size * 0.1);
  broken.rotation.set(0.5, 0.7, 0.3);
  broken.castShadow = true;
  rubble.add(broken);
  const scorch = new THREE.Mesh(new THREE.CircleGeometry(size * 0.62, 24), litMat({ color: 0x3b352d, transparent: true, opacity: 0.55 }));
  scorch.rotation.x = -Math.PI / 2;
  scorch.position.y = 0.02;
  rubble.add(scorch);

  return {
    group,
    // Feet sit below the parapet, so the occupant reads as sitting inside the tower.
    standY: topY + 0.22,
    topY: topY + (king ? 2.4 : 2.1),
    ruin() {
      intact.visible = false;
      rubble.visible = true;
    },
    update() {},
  };
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
