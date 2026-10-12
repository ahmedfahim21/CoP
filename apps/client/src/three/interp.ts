/**
 * Snapshot interpolation: the server sends positions ~20 times a second; the client renders
 * a little in the past and blends between the two real samples around that moment, so motion
 * is smooth without ever guessing ahead of the server.
 */
export const INTERP_DELAY_MS = 100;

export interface Sample {
  t: number;
  x: number;
  y: number;
}

export class SnapshotBuffer {
  private readonly samples: Sample[] = [];

  constructor(private readonly capacity = 16) {}

  push(t: number, x: number, y: number) {
    const last = this.samples[this.samples.length - 1];
    if (last && t <= last.t) {
      // Same patch delivered twice (or a clock hiccup): keep the newest values.
      last.x = x;
      last.y = y;
      return;
    }
    this.samples.push({ t, x, y });
    if (this.samples.length > this.capacity) this.samples.shift();
  }

  get latest(): Sample | undefined {
    return this.samples[this.samples.length - 1];
  }

  /** Position at time `t`; holds the oldest/newest sample outside the buffered range. */
  sample(t: number): { x: number; y: number } {
    const s = this.samples;
    if (s.length === 0) throw new Error('SnapshotBuffer.sample called before any push');
    if (t <= s[0]!.t) return { x: s[0]!.x, y: s[0]!.y };
    for (let i = s.length - 1; i > 0; i--) {
      const a = s[i - 1]!;
      const b = s[i]!;
      if (t >= a.t) {
        if (t >= b.t) return { x: b.x, y: b.y };
        const k = (t - a.t) / (b.t - a.t);
        return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
      }
    }
    return { x: s[0]!.x, y: s[0]!.y };
  }
}
