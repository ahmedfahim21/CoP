import { describe, expect, it } from 'vitest';
import { SnapshotBuffer } from './interp.js';

describe('SnapshotBuffer', () => {
  it('blends linearly between the two samples around the render time', () => {
    const b = new SnapshotBuffer();
    b.push(0, 0, 0);
    b.push(50, 1, 2);
    b.push(100, 3, 2);
    expect(b.sample(25)).toEqual({ x: 0.5, y: 1 });
    expect(b.sample(75)).toEqual({ x: 2, y: 2 });
    expect(b.sample(50)).toEqual({ x: 1, y: 2 });
  });

  it('holds the oldest and newest samples instead of extrapolating', () => {
    const b = new SnapshotBuffer();
    b.push(10, 1, 1);
    b.push(20, 2, 2);
    expect(b.sample(0)).toEqual({ x: 1, y: 1 });
    expect(b.sample(500)).toEqual({ x: 2, y: 2 });
  });

  it('replaces a sample with the same or older timestamp rather than appending', () => {
    const b = new SnapshotBuffer();
    b.push(10, 1, 1);
    b.push(10, 5, 5);
    b.push(9, 6, 6);
    expect(b.latest).toEqual({ t: 10, x: 6, y: 6 });
    expect(b.sample(0)).toEqual({ x: 6, y: 6 });
  });

  it('keeps only the newest `capacity` samples', () => {
    const b = new SnapshotBuffer(3);
    for (let i = 0; i < 6; i++) b.push(i * 10, i, i);
    // Oldest kept is t=30, so anything earlier clamps to it.
    expect(b.sample(0)).toEqual({ x: 3, y: 3 });
  });

  it('refuses to sample an empty buffer', () => {
    expect(() => new SnapshotBuffer().sample(0)).toThrow(/before any push/);
  });
});
