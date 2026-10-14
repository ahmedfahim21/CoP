import type { PokeType } from '@cop/shared';
import { VoiceLimiter } from './limiter.js';
import { MOVE_SFX, SFX, type SfxName, type Voice } from './synth.js';

/** Gen I cries, streamed from the PokeAPI cries repo at runtime (~6 KB each). */
const cryUrl = (dex: number) => `https://raw.githubusercontent.com/PokeAPI/cries/main/cries/pokemon/legacy/${dex}.ogg`;
const MUTE_KEY = 'cop:sound';

/** Minimum gap between repeats, so swarms and rapid fire don't stack into noise. */
const GAP_MS: Partial<Record<SfxName | 'move', number>> = { hit: 45, hitWeak: 45, hitSuper: 90, move: 60, tick: 0, faint: 80, tap: 30 };

export interface PlayOpts {
  volume?: number;
  /** -1 (left) .. 1 (right). */
  pan?: number;
}

/**
 * The game's audio: original synthesized effects (synth.ts) and Pokémon cries, through one
 * limiter and a master compressor. Nothing plays until `unlock()` runs inside a user gesture
 * (the title screen's tap). Muting is remembered per browser.
 */
class SoundSystem {
  private ctx: AudioContext | null = null;
  private sfxBus: GainNode | null = null;
  private cryBus: GainNode | null = null;
  private readonly limiter = new VoiceLimiter(18);
  private readonly cries = new Map<number, Promise<AudioBuffer | null>>();
  private readonly lastCry = new Map<number, number>();
  private criesPlaying = 0;
  private readonly listeners = new Set<() => void>();
  muted = readMuted();

  /** Must be called from a user gesture; safe to call repeatedly. */
  unlock() {
    if (!this.ctx) {
      const ctx = new AudioContext();
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 6;
      comp.connect(ctx.destination);
      this.sfxBus = ctx.createGain();
      this.sfxBus.gain.value = 0.9;
      this.sfxBus.connect(comp);
      this.cryBus = ctx.createGain();
      this.cryBus.gain.value = 0.55;
      this.cryBus.connect(comp);
      this.ctx = ctx;
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch((err: unknown) => console.error('Audio could not start', err));
    }
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    writeMuted(muted);
    if (!muted) this.unlock();
    for (const fn of this.listeners) fn();
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  play(name: SfxName, opts: PlayOpts = {}) {
    this.voice(name, GAP_MS[name] ?? 40, opts, (v) => SFX[name](v));
  }

  /** The sound of a move of this type being used. */
  move(type: PokeType, opts: PlayOpts = {}) {
    this.voice(`move:${type}`, GAP_MS.move!, opts, (v) => MOVE_SFX[type](v));
  }

  /** A Pokémon's cry. Fetched on first use and cached; a failure is logged and that cry skipped. */
  cry(dex: number, opts: PlayOpts = {}) {
    const ctx = this.ctx;
    if (!ctx || this.muted || ctx.state !== 'running') return;
    const now = performance.now();
    if (now - (this.lastCry.get(dex) ?? -Infinity) < 1200 || this.criesPlaying >= 2) return;
    this.lastCry.set(dex, now);
    void this.loadCry(dex).then((buf) => {
      if (!buf || this.muted) return;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(this.chain(ctx, this.cryBus!, opts));
      this.criesPlaying++;
      src.addEventListener('ended', () => this.criesPlaying--, { once: true });
      src.start();
    });
  }

  /** Warm the cache for cries we're about to need (e.g. the deck at battle start). */
  prefetchCries(dexes: Iterable<number>) {
    if (!this.ctx) return;
    for (const dex of dexes) void this.loadCry(dex);
  }

  private loadCry(dex: number): Promise<AudioBuffer | null> {
    let p = this.cries.get(dex);
    if (!p) {
      const ctx = this.ctx!;
      p = fetch(cryUrl(dex))
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.arrayBuffer();
        })
        .then((data) => ctx.decodeAudioData(data))
        .catch((err: unknown) => {
          console.error(`Cry #${dex} failed to load; it will stay silent`, err);
          return null;
        });
      this.cries.set(dex, p);
    }
    return p;
  }

  private voice(key: string, gapMs: number, opts: PlayOpts, recipe: (v: Voice) => number) {
    const ctx = this.ctx;
    if (!ctx || this.muted || ctx.state !== 'running') return;
    if (!this.limiter.tryStart(key, performance.now(), gapMs)) return;
    const out = this.chain(ctx, this.sfxBus!, opts);
    const seconds = recipe({ ctx, out, t: ctx.currentTime + 0.005 });
    window.setTimeout(() => {
      out.disconnect();
      this.limiter.release();
    }, (seconds + 0.15) * 1000);
  }

  /** gain → pan → bus. Returns the node a voice should play into. */
  private chain(ctx: AudioContext, bus: AudioNode, opts: PlayOpts): AudioNode {
    const gain = ctx.createGain();
    gain.gain.value = opts.volume ?? 1;
    if (opts.pan) {
      const pan = ctx.createStereoPanner();
      pan.pan.value = Math.max(-1, Math.min(1, opts.pan));
      gain.connect(pan).connect(bus);
    } else {
      gain.connect(bus);
    }
    return gain;
  }
}

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === 'off';
  } catch (err) {
    console.warn('Could not read the sound setting', err);
    return false;
  }
}

function writeMuted(muted: boolean) {
  try {
    localStorage.setItem(MUTE_KEY, muted ? 'off' : 'on');
  } catch (err) {
    console.warn('Could not save the sound setting', err);
  }
}

export const sound = new SoundSystem();
export type { SfxName };
