import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { PALETTE, seeded, shade, staticMat, teamColor, teamDark } from './palette.js';

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

/** Banner cloth with a Poké Ball emblem, team coloured. */
function bannerTexture(color: number, crown: boolean): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 192;
  const g = c.getContext('2d')!;
  const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
  g.fillStyle = hex(color);
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(128, 0);
  g.lineTo(128, 160);
  g.lineTo(64, 192);
  g.lineTo(0, 160);
  g.closePath();
  g.fill();
  g.strokeStyle = hex(PALETTE.gold);
  g.lineWidth = 8;
  g.stroke();
  // Emblem.
  const cx = 64;
  const cy = 80;
  g.fillStyle = '#f4f1ea';
  g.beginPath();
  g.arc(cx, cy, 34, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = crown ? hex(PALETTE.gold) : hex(shade(color, 0.12));
  g.beginPath();
  g.arc(cx, cy, 34, Math.PI, 0);
  g.fill();
  g.fillStyle = '#2a2a2a';
  g.fillRect(cx - 34, cy - 4, 68, 8);
  g.beginPath();
  g.arc(cx, cy, 12, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#f4f1ea';
  g.beginPath();
  g.arc(cx, cy, 7, 0, Math.PI * 2);
  g.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * A tower is a plinth, a masonry drum, a team-coloured trim band, a crenellated parapet and a
 * wooden deck the occupant stands on. The king tower is larger, with gold trim, a gate and
 * two flags. `facing` is +1 when the tower's owner looks from +Z (team 0), -1 otherwise.
 */
export function buildTower(kind: TowerKind, mine: boolean, facing: 1 | -1): TowerModel {
  const king = kind === 'king';
  const group = new THREE.Group();
  const intact = new THREE.Group();
  group.add(intact);
  const size = king ? 3.5 : 2.7;
  const bodyH = king ? 2.9 : 2.45;
  const plinthH = 0.32;
  const color = teamColor(mine);
  const dark = teamDark(mine);
  const trim = king ? PALETTE.gold : color;
  const rnd = seeded((king ? 7 : 3) + (mine ? 0 : 50));

  const add = (mesh: THREE.Mesh, parent: THREE.Object3D = intact) => {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };

  // Plinth.
  const plinth = add(new THREE.Mesh(new RoundedBoxGeometry(size + 0.5, plinthH, size + 0.5, 2, 0.08), staticMat(PALETTE.stoneDeep)));
  plinth.position.y = plinthH / 2;

  // Masonry body, slightly tapered by stacking two boxes.
  const tex = masonryTexture(PALETTE.stone, kind).clone();
  tex.needsUpdate = true;
  tex.repeat.set(size / 1.4, bodyH / 1.2);
  const bodyMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.92 });
  const body = add(new THREE.Mesh(new RoundedBoxGeometry(size, bodyH, size, 3, 0.14), bodyMat));
  body.position.y = plinthH + bodyH / 2;
  // Corner buttresses.
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    const b = add(new THREE.Mesh(new RoundedBoxGeometry(0.5, bodyH + 0.1, 0.5, 2, 0.08), staticMat(PALETTE.stoneLight)));
    b.position.set((x * size) / 2, plinthH + bodyH / 2, (z * size) / 2);
  }

  const topY = plinthH + bodyH;
  // Trim band.
  const band = add(new THREE.Mesh(new RoundedBoxGeometry(size + 0.22, 0.24, size + 0.22, 2, 0.06), staticMat(trim, { roughness: king ? 0.45 : 0.7, metalness: king ? 0.35 : 0 })));
  band.position.y = topY + 0.08;
  const band2 = add(new THREE.Mesh(new RoundedBoxGeometry(size + 0.1, 0.1, size + 0.1, 1, 0.04), staticMat(dark)));
  band2.position.y = topY - 0.12;

  // Deck.
  const deck = add(new THREE.Mesh(new THREE.BoxGeometry(size - 0.3, 0.08, size - 0.3), staticMat(PALETTE.woodLight)));
  deck.position.y = topY + 0.22;
  for (let i = -2; i <= 2; i++) {
    const seam = add(new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.09, size - 0.3), staticMat(PALETTE.woodDark)));
    seam.position.set((i * (size - 0.3)) / 5, topY + 0.225, 0);
  }

  // Crenellations around the parapet.
  const merlonGeo = new RoundedBoxGeometry(0.42, 0.42, 0.34, 2, 0.06);
  const n = king ? 5 : 4;
  for (let i = 0; i < n; i++) {
    const t = -size / 2 + 0.26 + (i * (size - 0.52)) / (n - 1);
    for (const [x, z, ry] of [[t, -size / 2, 0], [t, size / 2, 0], [-size / 2, t, Math.PI / 2], [size / 2, t, Math.PI / 2]] as const) {
      const m = add(new THREE.Mesh(merlonGeo, staticMat(shade(PALETTE.stoneLight, (rnd() - 0.5) * 0.05))));
      m.position.set(x, topY + 0.42, z);
      m.rotation.y = ry;
    }
  }

  // Banners hang on the face toward each camera.
  const banner = new THREE.MeshStandardMaterial({ map: bannerTexture(color, king), transparent: true, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9 });
  for (const f of [1, -1]) {
    const geo = new THREE.PlaneGeometry(king ? 1.1 : 0.85, king ? 1.6 : 1.25);
    const m = add(new THREE.Mesh(geo, banner));
    m.position.set(0, topY - (king ? 0.95 : 0.8), f * (size / 2 + 0.03));
    if (f < 0) m.rotation.y = Math.PI;
    m.castShadow = false;
  }

  // King's gate on the owner's side.
  if (king) {
    const gate = add(new THREE.Mesh(new RoundedBoxGeometry(1.1, 1.0, 0.2, 2, 0.08), staticMat(PALETTE.woodDark)));
    gate.position.set(0, plinthH + 0.5, facing * (size / 2 + 0.02));
    const arch = add(new THREE.Mesh(new THREE.TorusGeometry(0.58, 0.1, 6, 16, Math.PI), staticMat(PALETTE.stoneLight)));
    arch.position.set(0, plinthH + 1.0, facing * (size / 2 + 0.06));
    // Gate banner sits above the arch instead, so move the owner-side banner up.
  }

  // Flags on poles: waving cloth driven per frame.
  const flags: Array<{ geo: THREE.PlaneGeometry; base: Float32Array; phase: number }> = [];
  const poleSpots: Array<[number, number]> = king
    ? [[-size / 2 + 0.2, -facing * (size / 2 - 0.2)], [size / 2 - 0.2, -facing * (size / 2 - 0.2)]]
    : [[size / 2 - 0.2, -facing * (size / 2 - 0.2)]];
  for (const [x, z] of poleSpots) {
    const poleH = king ? 2.3 : 1.8;
    const pole = add(new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.06, poleH, 6), staticMat(PALETTE.woodDark)));
    pole.position.set(x, topY + poleH / 2, z);
    const knob = add(new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), staticMat(PALETTE.gold, { roughness: 0.4, metalness: 0.4 })));
    knob.position.set(x, topY + poleH + 0.05, z);
    const geo = new THREE.PlaneGeometry(0.9, 0.55, 10, 3);
    geo.translate(0.45, 0, 0);
    const flag = add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide, roughness: 0.85 })));
    flag.position.set(x + 0.04, topY + poleH - 0.32, z);
    flags.push({ geo, base: Float32Array.from(geo.attributes.position!.array as Float32Array), phase: rnd() * 6 });
  }

  // Rubble, hidden until the tower falls.
  const rubble = new THREE.Group();
  rubble.visible = false;
  group.add(rubble);
  const rr = seeded(king ? 404 : 303);
  const stoneGeo = new THREE.DodecahedronGeometry(1, 0);
  for (let i = 0; i < (king ? 18 : 13); i++) {
    const r = 0.25 + rr() * 0.45;
    const m = new THREE.Mesh(stoneGeo, staticMat(shade(PALETTE.stone, (rr() - 0.6) * 0.18), { roughness: 0.95 }));
    m.scale.set(r, r * 0.7, r * (0.8 + rr() * 0.4));
    const a = rr() * Math.PI * 2;
    const d = rr() * size * 0.42;
    m.position.set(Math.cos(a) * d, r * 0.45 + (d < size * 0.2 ? 0.3 : 0), Math.sin(a) * d);
    m.rotation.set(rr() * 3, rr() * 3, rr() * 3);
    m.castShadow = true;
    m.receiveShadow = true;
    rubble.add(m);
  }
  const scorch = new THREE.Mesh(new THREE.CircleGeometry(size * 0.62, 24), new THREE.MeshStandardMaterial({ color: 0x3b352d, transparent: true, opacity: 0.55 }));
  scorch.rotation.x = -Math.PI / 2;
  scorch.position.y = 0.02;
  rubble.add(scorch);

  return {
    group,
    standY: topY + 0.26,
    topY: topY + (king ? 2.6 : 2.2),
    ruin() {
      intact.visible = false;
      rubble.visible = true;
    },
    update(_dt, t) {
      for (const f of flags) {
        const pos = f.geo.attributes.position!;
        const arr = pos.array as Float32Array;
        for (let i = 0; i < arr.length; i += 3) {
          const x = f.base[i]!;
          arr[i + 2] = Math.sin(x * 5 - t * 6 + f.phase) * 0.09 * x;
          arr[i + 1] = f.base[i + 1]! - x * 0.05;
        }
        pos.needsUpdate = true;
        f.geo.computeVertexNormals();
      }
    },
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
