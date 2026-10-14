import { describe, expect, it } from 'vitest';
import { VoiceLimiter } from './limiter.js';

describe('VoiceLimiter', () => {
  it('drops repeats of the same sound inside the gap, but not other sounds', () => {
    const l = new VoiceLimiter(10);
    expect(l.tryStart('hit', 0, 50)).toBe(true);
    expect(l.tryStart('hit', 30, 50)).toBe(false);
    expect(l.tryStart('faint', 30, 50)).toBe(true);
    expect(l.tryStart('hit', 50, 50)).toBe(true);
    expect(l.voices).toBe(3);
  });

  it('caps voices sounding at once and frees them on release', () => {
    const l = new VoiceLimiter(2);
    expect(l.tryStart('a', 0, 0)).toBe(true);
    expect(l.tryStart('b', 0, 0)).toBe(true);
    expect(l.tryStart('c', 0, 0)).toBe(false);
    l.release();
    expect(l.tryStart('c', 0, 0)).toBe(true);
    expect(l.voices).toBe(2);
  });

  it('a refused start does not count as the last play', () => {
    const l = new VoiceLimiter(1);
    expect(l.tryStart('a', 0, 100)).toBe(true);
    expect(l.tryStart('b', 10, 100)).toBe(false); // refused: voices full
    l.release();
    expect(l.tryStart('b', 20, 100)).toBe(true); // so b isn't held back by the refusal
  });

  it('fails loudly on unbalanced releases', () => {
    expect(() => new VoiceLimiter(1).release()).toThrow();
  });
});
