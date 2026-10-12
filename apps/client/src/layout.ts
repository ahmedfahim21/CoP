import { ARENA_H, ARENA_W, mirror, type Point, type Team } from '@cop/shared';

/** Logical canvas size; Phaser scales it to fit the window. */
export const TILE = 28;
export const TOP_HUD = 64;
export const ARENA_PX_W = ARENA_W * TILE;
export const ARENA_PX_H = ARENA_H * TILE;
export const BOTTOM_HUD = 214;
export const GAME_W = ARENA_PX_W;
export const GAME_H = TOP_HUD + ARENA_PX_H + BOTTOM_HUD;

/** World tile coords → screen px for the viewing team (own side at the bottom). */
export function toScreen(team: Team, world: Point): Point {
  const local = mirror(team, world);
  return { x: local.x * TILE, y: TOP_HUD + local.y * TILE };
}

/** Screen px → own-perspective tile coords. */
export function screenToLocal(px: Point): Point {
  return { x: px.x / TILE, y: (px.y - TOP_HUD) / TILE };
}

export function inArena(px: Point): boolean {
  return px.x >= 0 && px.x <= ARENA_PX_W && px.y >= TOP_HUD && px.y <= TOP_HUD + ARENA_PX_H;
}

export const COLORS = {
  grassA: 0x7cc35a,
  grassB: 0x73b952,
  border: 0x4f7f3a,
  river: 0x4aa3df,
  riverEdge: 0x3a86bd,
  bridge: 0xb5835a,
  bridgePlank: 0x9a6c46,
  path: 0xd8c08a,
  mine: 0x3d7be0,
  enemy: 0xe0483d,
  stone: 0xc9c2b4,
  stoneDark: 0x948c7d,
  hpBg: 0x2b2b2b,
  hud: 0x1f2433,
  hudCard: 0x343c55,
  elixir: 0xd14fd8,
  elixirBg: 0x3a2142,
  text: 0xffffff,
} as const;

export const TYPE_COLORS: Record<string, number> = {
  normal: 0xf4f1e8, fire: 0xff8a3d, water: 0x4fa3ff, electric: 0xffd93d, grass: 0x6cd65a,
  ice: 0x9be8f2, fighting: 0xd0583a, poison: 0xa95ad6, flying: 0xb7c4ff,
};
