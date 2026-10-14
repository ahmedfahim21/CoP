import { describe, expect, it } from 'vitest';
import { clearanceAt, type Obstacle } from './views.js';

const tower: Obstacle = { x: 0, z: 0, radius: 2, top: 4.5 };

describe('flier clearance over towers', () => {
  it('clears the full tower height anywhere over its footprint', () => {
    expect(clearanceAt(0, 0, [tower])).toBe(4.5);
    expect(clearanceAt(1.9, 0, [tower])).toBe(4.5);
    expect(clearanceAt(0, -2, [tower])).toBe(4.5);
  });

  it('eases off smoothly around it and is zero away from towers', () => {
    const near = clearanceAt(2.5, 0, [tower]);
    const far = clearanceAt(3.4, 0, [tower]);
    expect(near).toBeGreaterThan(far);
    expect(far).toBeGreaterThan(0);
    expect(clearanceAt(3.8, 0, [tower])).toBe(0);
    expect(clearanceAt(10, 10, [tower])).toBe(0);
    expect(clearanceAt(0, 0, [])).toBe(0);
  });

  it('takes the tallest requirement where towers overlap', () => {
    const king: Obstacle = { x: 3, z: 0, radius: 2.4, top: 5.2 };
    expect(clearanceAt(1.5, 0, [tower, king])).toBe(5.2);
  });
});
