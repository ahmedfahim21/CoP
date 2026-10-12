import { describe, expect, it } from 'vitest';
import { angleDelta, damp, fromScene, toScene } from './coords.js';

describe('scene coordinates', () => {
  it('centres the arena on the origin and round-trips', () => {
    expect(toScene({ x: 9, y: 16 })).toEqual({ x: 0, z: 0 });
    expect(toScene({ x: 0, y: 32 })).toEqual({ x: -9, z: 16 });
    const p = { x: 3.25, y: 27.5 };
    const s = toScene(p);
    expect(fromScene(s.x, s.z)).toEqual(p);
  });

  it('angleDelta takes the short way round', () => {
    expect(angleDelta(0, Math.PI / 2)).toBeCloseTo(Math.PI / 2);
    expect(angleDelta(Math.PI * 0.9, -Math.PI * 0.9)).toBeCloseTo(Math.PI * 0.2);
    expect(angleDelta(-Math.PI * 0.9, Math.PI * 0.9)).toBeCloseTo(-Math.PI * 0.2);
  });

  it('damp converges and is frame-rate independent', () => {
    const one = damp(0, 10, 5, 0.1);
    const two = damp(damp(0, 10, 5, 0.05), 10, 5, 0.05);
    expect(one).toBeCloseTo(two, 10);
    expect(damp(0, 10, 5, 10)).toBeCloseTo(10, 5);
  });
});
