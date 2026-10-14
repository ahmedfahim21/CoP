import type { PokeType } from '@cop/shared';

/**
 * Original 8-bit sound effects, synthesized live with WebAudio: square, triangle and sine
 * voices plus Game Boy–style stepped noise, shaped by short envelopes. Each recipe schedules
 * its notes from `v.t` into `v.out` and returns its length in seconds.
 */
export interface Voice {
  ctx: AudioContext;
  out: AudioNode;
  t: number;
}
type Recipe = (v: Voice) => number;

// --- Building blocks ---

const SILENT = 0.0001;

function envelope(v: Voice, start: number, dur: number, peak: number, attack = 0.004): GainNode {
  const g = v.ctx.createGain();
  g.gain.setValueAtTime(SILENT, start);
  g.gain.exponentialRampToValueAtTime(peak, start + attack);
  g.gain.exponentialRampToValueAtTime(SILENT, start + dur);
  g.connect(v.out);
  return g;
}

interface ToneOpts {
  /** Linear glide instead of exponential. */
  linear?: boolean;
  /** [rate Hz, depth Hz] frequency wobble. */
  vibrato?: [number, number];
  attack?: number;
}

function tone(v: Voice, type: OscillatorType, f0: number, f1: number, at: number, dur: number, peak: number, opts: ToneOpts = {}) {
  const start = v.t + at;
  const o = v.ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, start);
  if (f1 !== f0) {
    if (opts.linear) o.frequency.linearRampToValueAtTime(f1, start + dur);
    else o.frequency.exponentialRampToValueAtTime(f1, start + dur);
  }
  if (opts.vibrato) {
    const lfo = v.ctx.createOscillator();
    const depth = v.ctx.createGain();
    lfo.frequency.value = opts.vibrato[0];
    depth.gain.value = opts.vibrato[1];
    lfo.connect(depth).connect(o.frequency);
    lfo.start(start);
    lfo.stop(start + dur + 0.05);
  }
  o.connect(envelope(v, start, dur, peak, opts.attack));
  o.start(start);
  o.stop(start + dur + 0.05);
}

const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>();

/** Stepped noise like the Game Boy's LFSR channel: random levels held for a few samples. */
function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  let buf = noiseBuffers.get(ctx);
  if (buf) return buf;
  buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 1.5), ctx.sampleRate);
  const data = buf.getChannelData(0);
  const hold = Math.max(1, Math.round(ctx.sampleRate / 14000));
  let level = 0;
  for (let i = 0; i < data.length; i++) {
    if (i % hold === 0) level = Math.random() > 0.5 ? 1 : -1;
    data[i] = level;
  }
  noiseBuffers.set(ctx, buf);
  return buf;
}

function noise(v: Voice, at: number, dur: number, peak: number, type: BiquadFilterType, f0: number, f1 = f0, q = 1) {
  const start = v.t + at;
  const src = v.ctx.createBufferSource();
  src.buffer = noiseBuffer(v.ctx);
  const filter = v.ctx.createBiquadFilter();
  filter.type = type;
  filter.Q.value = q;
  filter.frequency.setValueAtTime(f0, start);
  if (f1 !== f0) filter.frequency.exponentialRampToValueAtTime(f1, start + dur);
  src.connect(filter).connect(envelope(v, start, dur, peak));
  src.start(start, Math.random() * 0.5);
  src.stop(start + dur + 0.05);
}

/** Notes by name, equal temperament from A4 = 440. */
const NOTE: Record<string, number> = {};
['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'].forEach((n, i) => {
  for (let oct = 2; oct <= 7; oct++) NOTE[`${n}${oct}`] = 440 * 2 ** ((i - 9) / 12 + (oct - 4));
});
const n = (name: string) => {
  const f = NOTE[name];
  if (!f) throw new Error(`Unknown note ${name}`);
  return f;
};

/** A run of notes: [note, start, length]. */
function melody(v: Voice, type: OscillatorType, notes: Array<[string, number, number]>, peak: number): number {
  let end = 0;
  for (const [note, at, dur] of notes) {
    tone(v, type, n(note), n(note), at, dur, peak);
    end = Math.max(end, at + dur);
  }
  return end;
}

// --- Move sounds, one per type ---

export const MOVE_SFX: Record<PokeType, Recipe> = {
  normal: (v) => {
    tone(v, 'square', 900, 480, 0, 0.09, 0.12);
    return 0.1;
  },
  fire: (v) => {
    noise(v, 0, 0.32, 0.22, 'bandpass', 900, 260, 0.8);
    noise(v, 0.04, 0.24, 0.12, 'lowpass', 500, 200);
    return 0.34;
  },
  water: (v) => {
    for (let i = 0; i < 3; i++) tone(v, 'sine', 700 + i * 160, 1400 + i * 200, i * 0.05, 0.06, 0.16);
    noise(v, 0, 0.12, 0.05, 'highpass', 3000);
    return 0.2;
  },
  electric: (v) => {
    tone(v, 'square', 1500, 900, 0, 0.2, 0.09, { vibrato: [55, 700] });
    noise(v, 0, 0.16, 0.08, 'highpass', 4000);
    return 0.22;
  },
  grass: (v) => {
    tone(v, 'triangle', 2100, 2600, 0, 0.05, 0.12);
    tone(v, 'triangle', 2400, 3000, 0.06, 0.05, 0.1);
    noise(v, 0, 0.1, 0.06, 'highpass', 5000);
    return 0.12;
  },
  ice: (v) => {
    tone(v, 'sine', 2600, 2400, 0, 0.3, 0.07, { vibrato: [18, 60] });
    tone(v, 'sine', 3300, 3100, 0.03, 0.26, 0.05);
    noise(v, 0, 0.2, 0.04, 'highpass', 7000);
    return 0.32;
  },
  fighting: (v) => {
    noise(v, 0, 0.05, 0.25, 'lowpass', 2500);
    tone(v, 'square', 320, 140, 0, 0.07, 0.12);
    return 0.08;
  },
  poison: (v) => {
    tone(v, 'square', 140, 110, 0, 0.22, 0.08, { vibrato: [22, 40] });
    noise(v, 0.02, 0.18, 0.08, 'lowpass', 700, 300);
    return 0.24;
  },
  ground: (v) => {
    noise(v, 0, 0.24, 0.25, 'lowpass', 500, 120);
    tone(v, 'sine', 95, 45, 0, 0.24, 0.3);
    return 0.26;
  },
  flying: (v) => {
    noise(v, 0, 0.22, 0.14, 'bandpass', 1100, 2600, 1.4);
    return 0.24;
  },
  psychic: (v) => {
    tone(v, 'sine', 380, 1150, 0, 0.32, 0.1, { vibrato: [9, 40] });
    tone(v, 'triangle', 760, 2300, 0, 0.32, 0.04);
    return 0.34;
  },
  bug: (v) => {
    for (let i = 0; i < 4; i++) tone(v, 'square', 2900, 2700, i * 0.03, 0.02, 0.06);
    return 0.13;
  },
  rock: (v) => {
    noise(v, 0, 0.16, 0.24, 'lowpass', 900, 200);
    tone(v, 'square', 160, 70, 0, 0.12, 0.1);
    return 0.18;
  },
  ghost: (v) => {
    tone(v, 'triangle', 330, 190, 0, 0.38, 0.12, { vibrato: [6, 14], linear: true });
    return 0.4;
  },
  dragon: (v) => {
    tone(v, 'sawtooth', 160, 90, 0, 0.3, 0.08, { vibrato: [12, 10] });
    noise(v, 0, 0.26, 0.1, 'lowpass', 800, 250);
    return 0.32;
  },
  dark: (v) => {
    tone(v, 'square', 220, 110, 0, 0.18, 0.08, { linear: true });
    noise(v, 0, 0.14, 0.06, 'bandpass', 600, 300);
    return 0.2;
  },
  steel: (v) => {
    tone(v, 'triangle', 1800, 1750, 0, 0.24, 0.12);
    tone(v, 'square', 2700, 2650, 0, 0.12, 0.04);
    return 0.26;
  },
  fairy: (v) => melody(v, 'sine', [['E6', 0, 0.06], ['G#6', 0.05, 0.06], ['B6', 0.1, 0.12]], 0.09),
};

// --- Everything else ---

function towerDown(v: Voice): number {
  noise(v, 0, 1.3, 0.35, 'lowpass', 1400, 90);
  tone(v, 'sine', 70, 38, 0, 1, 0.35);
  for (let i = 0; i < 6; i++) noise(v, 0.15 + i * 0.13 + Math.random() * 0.05, 0.08, 0.12, 'bandpass', 900 + Math.random() * 900, 400, 2);
  return 1.35;
}

export const SFX = {
  tap: (v) => {
    tone(v, 'square', 1250, 1650, 0, 0.035, 0.06);
    return 0.04;
  },
  select: (v) => melody(v, 'square', [['E5', 0, 0.04], ['B5', 0.045, 0.06]], 0.07),
  denied: (v) => {
    tone(v, 'square', 200, 200, 0, 0.07, 0.09);
    tone(v, 'square', 160, 160, 0.09, 0.1, 0.09);
    return 0.2;
  },
  /** A Poké Ball thrown, then popping open. */
  deploy: (v) => {
    noise(v, 0, 0.16, 0.08, 'bandpass', 600, 3200, 1.2);
    tone(v, 'square', 1300, 2300, 0.15, 0.05, 0.09);
    noise(v, 0.15, 0.08, 0.12, 'highpass', 2500);
    return 0.24;
  },
  hit: (v) => {
    noise(v, 0, 0.09, 0.2, 'lowpass', 2600, 600);
    tone(v, 'square', 190, 90, 0, 0.05, 0.08);
    return 0.1;
  },
  hitSuper: (v) => {
    noise(v, 0, 0.12, 0.3, 'lowpass', 3800, 700);
    tone(v, 'square', 240, 100, 0, 0.08, 0.12);
    melody(v, 'square', [['C6', 0.05, 0.04], ['E6', 0.09, 0.04], ['G6', 0.13, 0.08]], 0.06);
    return 0.22;
  },
  hitWeak: (v) => {
    noise(v, 0, 0.07, 0.12, 'lowpass', 900, 300);
    return 0.08;
  },
  /** The descending swoop of a fainting Pokémon. */
  faint: (v) => {
    tone(v, 'square', 880, 110, 0, 0.55, 0.09, { linear: true });
    return 0.6;
  },
  explosion: (v) => {
    noise(v, 0, 0.9, 0.32, 'lowpass', 3200, 120);
    tone(v, 'sine', 80, 32, 0, 0.7, 0.34);
    return 0.95;
  },
  towerDown,
  kingDown: (v) => {
    towerDown(v);
    melody(v, 'square', [['G4', 0.3, 0.14], ['D4', 0.46, 0.14], ['G3', 0.62, 0.4]], 0.08);
    return 1.4;
  },
  heal: (v) => melody(v, 'triangle', [['C5', 0, 0.08], ['E5', 0.07, 0.08], ['G5', 0.14, 0.08], ['C6', 0.21, 0.2]], 0.1),
  paralyze: (v) => {
    tone(v, 'square', 75, 70, 0, 0.26, 0.08, { vibrato: [32, 30] });
    noise(v, 0, 0.22, 0.06, 'highpass', 5000);
    return 0.28;
  },
  evolve: (v) => {
    const run = ['C4', 'E4', 'G4', 'C5', 'E5', 'G5', 'C6'];
    melody(v, 'square', run.map((note, i): [string, number, number] => [note, i * 0.07, 0.07]), 0.07);
    tone(v, 'sine', n('C6'), n('C7'), 0.5, 0.5, 0.06);
    return 1;
  },
  charge: (v) => {
    noise(v, 0, 0.25, 0.14, 'lowpass', 300, 1200);
    tone(v, 'square', 180, 620, 0, 0.25, 0.07);
    return 0.27;
  },
  slam: (v) => {
    tone(v, 'sine', 90, 36, 0, 0.35, 0.4);
    noise(v, 0, 0.25, 0.25, 'lowpass', 1200, 150);
    return 0.37;
  },
  rage: (v) => {
    tone(v, 'sawtooth', 110, 150, 0, 0.3, 0.07, { vibrato: [14, 18] });
    return 0.32;
  },
  shieldBreak: (v) => {
    noise(v, 0, 0.18, 0.14, 'highpass', 4500, 2500);
    for (let i = 0; i < 4; i++) tone(v, 'triangle', 3000 - i * 400, 2600 - i * 400, i * 0.04, 0.06, 0.06);
    return 0.24;
  },
  count: (v) => {
    tone(v, 'square', n('A5'), n('A5'), 0, 0.12, 0.09);
    return 0.13;
  },
  fight: (v) => {
    tone(v, 'square', n('A6'), n('A6'), 0, 0.32, 0.08);
    tone(v, 'square', n('E6'), n('E6'), 0, 0.32, 0.06);
    return 0.33;
  },
  alert: (v) => melody(v, 'square', [['E6', 0, 0.09], ['C6', 0.11, 0.09], ['E6', 0.22, 0.09], ['C6', 0.33, 0.12]], 0.06),
  crown: (v) => {
    tone(v, 'triangle', n('E6'), n('E6'), 0, 0.5, 0.12);
    tone(v, 'sine', n('B6'), n('B6'), 0.06, 0.45, 0.06);
    return 0.56;
  },
  tick: (v) => {
    tone(v, 'square', 1500, 1500, 0, 0.025, 0.04);
    return 0.03;
  },
  victory: (v) => {
    melody(v, 'square', [['G4', 0, 0.1], ['C5', 0.1, 0.1], ['E5', 0.2, 0.1], ['G5', 0.3, 0.18], ['E5', 0.5, 0.1], ['G5', 0.6, 0.12], ['C6', 0.72, 0.7]], 0.08);
    melody(v, 'triangle', [['C3', 0, 0.3], ['G3', 0.3, 0.3], ['C4', 0.72, 0.7]], 0.14);
    return 1.45;
  },
  defeat: (v) => {
    melody(v, 'square', [['E5', 0, 0.22], ['D#5', 0.24, 0.22], ['D5', 0.48, 0.22], ['C#5', 0.72, 0.6]], 0.06);
    melody(v, 'triangle', [['A2', 0, 0.48], ['F2', 0.48, 0.84]], 0.12);
    return 1.35;
  },
  draw: (v) => melody(v, 'square', [['C5', 0, 0.16], ['G4', 0.18, 0.16], ['C5', 0.36, 0.4]], 0.06),
} satisfies Record<string, Recipe>;

export type SfxName = keyof typeof SFX;
