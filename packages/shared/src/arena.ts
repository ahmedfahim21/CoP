export type Team = 0 | 1;

export const ARENA_W = 18;
export const ARENA_H = 32;
/** River occupies y in (RIVER_TOP, RIVER_BOTTOM). */
export const RIVER_TOP = 15;
export const RIVER_BOTTOM = 17;
export const RIVER_MID = 16;
export const BRIDGE_XS = [3.5, 14.5] as const;
export const BRIDGE_HALF_WIDTH = 1;

export interface Point {
  x: number;
  y: number;
}

/**
 * Every client sees its own side at the bottom. Team 0 uses world coords as-is; team 1's
 * view is the arena rotated 180°. The rotation is its own inverse, so this converts both ways.
 */
export function mirror(team: Team, p: Point): Point {
  return team === 0 ? { x: p.x, y: p.y } : { x: ARENA_W - p.x, y: ARENA_H - p.y };
}

export type Lane = 'left' | 'right';

/** Tower layout in a team's own perspective (bottom of the screen). */
export const KING_POS: Point = { x: 9, y: 29 };
export const PRINCESS_POS: Record<Lane, Point> = {
  left: { x: 3.5, y: 25.5 },
  right: { x: 14.5, y: 25.5 },
};

/** Side of the river a world y is on: own-perspective "bottom" for team 0. */
export function riverSide(y: number): 'top' | 'bottom' {
  return y >= RIVER_MID ? 'bottom' : 'top';
}

export function inRiver(y: number): boolean {
  return y > RIVER_TOP && y < RIVER_BOTTOM;
}

export function onBridgeColumn(x: number): boolean {
  return BRIDGE_XS.some((bx) => Math.abs(x - bx) <= BRIDGE_HALF_WIDTH);
}

export function laneOf(localX: number): Lane {
  return localX < ARENA_W / 2 ? 'left' : 'right';
}

export const DEPLOY_MIN_Y = RIVER_BOTTOM; // own half, local coords
export const POCKET_MIN_Y = 10; // how far into enemy half a fallen princess tower opens up

/**
 * Whether a local-perspective point is a legal deploy spot.
 * `openPockets` are the lanes (own perspective) whose enemy princess tower has fallen.
 */
export function isValidDeploy(local: Point, openPockets: ReadonlySet<Lane>): boolean {
  if (!Number.isFinite(local.x) || !Number.isFinite(local.y)) return false;
  if (local.x < 0.5 || local.x > ARENA_W - 0.5 || local.y > ARENA_H - 0.5) return false;
  if (local.y >= DEPLOY_MIN_Y) return true;
  return local.y >= POCKET_MIN_Y && openPockets.has(laneOf(local.x));
}

export function dist(a: Point, b: Point): number {
  return hypot(a.x - b.x, a.y - b.y);
}

/**
 * Length of (x, y). Math.hypot isn't required to round the same way in every JS engine,
 * but sqrt and arithmetic are, so this keeps the simulation bit-identical everywhere
 * (replays recorded on the server play back the same in any browser).
 */
export function hypot(x: number, y: number): number {
  return Math.sqrt(x * x + y * y);
}
