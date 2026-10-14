import * as THREE from 'three';
import { litMat } from './style/toon.js';

/** One palette for the whole arena: no pure white, shared accents, sun upper-left. */
export const PALETTE = {
  grassA: 0x86cc4c,
  grassB: 0x6fb83e,
  grassEdge: 0x6fae3c,
  outerGrass: 0x5f9e3a,
  path: 0xcfcabd,
  pathEdge: 0xaaa497,
  plaza: 0xc9c3b5,
  plazaJoint: 0xaaa293,
  stone: 0xc8c1b2,
  towerStone: 0xe7e3da,
  stoneLight: 0xded8ca,
  stoneDark: 0x8f8778,
  stoneDeep: 0x6c6558,
  wood: 0xa8703f,
  woodLight: 0xc48a52,
  woodDark: 0x7a4c27,
  water: 0x35d3d6,
  waterDeep: 0x1aa5b8,
  foam: 0xe4fffb,
  lily: 0x4fae3a,
  roofGreen: 0x3f9a55,
  roofRed: 0xc2483a,
  gold: 0xf2c14e,
  goldDark: 0xc4912a,
  mine: 0x3b82f6,
  mineDark: 0x1e4fb8,
  enemy: 0xe5483f,
  enemyDark: 0xa82720,
  leaf: 0x4f9f3a,
  leafDark: 0x3a7d2c,
  trunk: 0x7b5233,
  rock: 0x9c9a92,
  shadow: 0x1b2a12,
} as const;

export const teamColor = (mine: boolean) => (mine ? PALETTE.mine : PALETTE.enemy);
export const teamDark = (mine: boolean) => (mine ? PALETTE.mineDark : PALETTE.enemyDark);

const shared = new Map<string, THREE.MeshToonMaterial>();

/** Shared material for static scenery. Never mutate one of these at runtime. */
export function staticMat(color: number, opts: { roughness?: number; metalness?: number; emissive?: number } = {}): THREE.MeshToonMaterial {
  const key = `${color}:${opts.roughness ?? 0.85}:${opts.metalness ?? 0}:${opts.emissive ?? 0}`;
  let m = shared.get(key);
  if (!m) {
    m = litMat({
      color, roughness: opts.roughness ?? 0.85, metalness: opts.metalness ?? 0, emissive: opts.emissive ?? 0x000000,
    });
    shared.set(key, m);
  }
  return m;
}

/** Deterministic PRNG so scenery is identical on every client and every load. */
export function seeded(seed: number) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shade(color: number, amount: number): number {
  const c = new THREE.Color(color);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, Math.min(1, Math.max(0, hsl.l + amount)));
  return c.getHex();
}
