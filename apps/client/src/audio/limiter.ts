/**
 * Keeps a busy battle listenable: a cap on voices sounding at once, and a minimum gap
 * between repeats of the same sound (four Rattata hitting together is one hit, not four).
 */
export class VoiceLimiter {
  private readonly last = new Map<string, number>();
  private active = 0;

  constructor(private readonly maxVoices: number) {}

  get voices(): number {
    return this.active;
  }

  /** Whether `key` may start at `now` (ms); if so the voice is reserved until `release()`. */
  tryStart(key: string, now: number, minGapMs: number): boolean {
    if (this.active >= this.maxVoices) return false;
    const last = this.last.get(key);
    if (last !== undefined && now - last < minGapMs) return false;
    this.last.set(key, now);
    this.active++;
    return true;
  }

  release() {
    if (this.active === 0) throw new Error('VoiceLimiter released more voices than it started');
    this.active--;
  }
}
