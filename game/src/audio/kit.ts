// The building blocks every sound is made of: a per-context kit (noise, control and crackle
// buffers, periodic waves), node factories and envelopes. The live engine and the offline
// renderer behind the audio lab's report build the very same graphs from these.
//
// Nothing here is a recording: the buffers are computed once per AudioContext from seeded
// random numbers and reused by every voice, which keeps an iPhone's CPU and memory low.

export type Rnd = () => number;

/** mulberry32: a float in [0, 1). */
export function mulberry(seed: number): Rnd {
  let s = seed >>> 0 || 0x9e3779b9;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type NoiseKind = "white" | "pink" | "brown";
export type WaveName = "pulse25" | "pulse12" | "piano" | "reed" | "fife";
type OscType = "sine" | "square" | "sawtooth" | "triangle" | WaveName;

export interface Kit {
  readonly ctx: BaseAudioContext;
  readonly white: AudioBuffer;
  readonly pink: AudioBuffer;
  readonly brown: AudioBuffer;
  /** Smoothed random control signal in [-1, 1] (12 s at 8 kHz): flicker, gusts, babble, wander. */
  readonly ctrl: AudioBuffer;
  /** Sparse fire crackle, 4 s. */
  readonly crackle: AudioBuffer;
  rnd: Rnd;
  /** While a voice is built every source started is collected here, so it can be stopped early. */
  sources: AudioScheduledSourceNode[] | null;
  /** The latest stop time scheduled so far: a voice is over when its last source is. */
  until: number;
  wave(name: WaveName): PeriodicWave;
}

export function makeKit(ctx: BaseAudioContext, rnd: Rnd = Math.random): Kit {
  const waves = new Map<WaveName, PeriodicWave>();
  return {
    ctx,
    white: noiseBuffer(ctx, "white", 2, 11),
    pink: noiseBuffer(ctx, "pink", 3, 12),
    brown: noiseBuffer(ctx, "brown", 3, 13),
    ctrl: ctrlBuffer(ctx, 14),
    crackle: crackleBuffer(ctx, 15),
    rnd,
    sources: null,
    until: 0,
    wave(name) {
      let w = waves.get(name);
      if (!w) {
        w = makeWave(ctx, name);
        waves.set(name, w);
      }
      return w;
    },
  };
}

/** Runs `fn` collecting the sources it starts (and hands them on to an outer collector). */
export function collect(k: Kit, fn: () => void): AudioScheduledSourceNode[] {
  const outer = k.sources;
  const mine: AudioScheduledSourceNode[] = [];
  k.sources = mine;
  try {
    fn();
  } finally {
    k.sources = outer;
  }
  outer?.push(...mine);
  return mine;
}

// ---------------------------------------------------------------------------------------------
// Buffers

function noiseBuffer(ctx: BaseAudioContext, kind: NoiseKind, sec: number, seed: number): AudioBuffer {
  const sr = ctx.sampleRate;
  const n = Math.floor(sr * sec);
  const fade = Math.floor(sr * 0.05);
  const r = mulberry(seed);
  const raw = new Float32Array(n + fade);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, br = 0;
  for (let i = 0; i < raw.length; i++) {
    const w = r() * 2 - 1;
    if (kind === "white") raw[i] = w;
    else if (kind === "pink") {
      // Paul Kellet's refined pink filter
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      raw[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
      b6 = w * 0.115926;
    } else {
      br = (br + 0.02 * w) / 1.02;
      raw[i] = br;
    }
  }
  // Seamless loop: the head is crossfaded with the stream's own continuation past the end.
  for (let i = 0; i < fade; i++) {
    const a = i / fade;
    raw[i] = raw[i] * a + raw[n + i] * (1 - a);
  }
  let mean = 0;
  for (let i = 0; i < n; i++) mean += raw[i];
  mean /= n;
  let ss = 0;
  for (let i = 0; i < n; i++) {
    raw[i] -= mean;
    ss += raw[i] * raw[i];
  }
  // Every kind at the same RMS, so gains mean the same thing across them.
  const g = 0.3 / Math.sqrt(ss / n || 1);
  const b = ctx.createBuffer(1, n, sr);
  const d = b.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = raw[i] * g;
  return b;
}

/** A random point every 0.1 s, cosine-interpolated, looping seamlessly. */
function ctrlBuffer(ctx: BaseAudioContext, seed: number): AudioBuffer {
  const sr = 8000;
  const sec = 12;
  const n = sr * sec;
  const step = sr / 10;
  const r = mulberry(seed);
  const pts = Array.from({ length: sec * 10 }, () => r() * 2 - 1);
  pts.push(pts[0]);
  const b = ctx.createBuffer(1, n, sr);
  const d = b.getChannelData(0);
  for (let i = 0; i < n; i++) {
    const x = i / step;
    const j = Math.floor(x);
    const w = (1 - Math.cos(Math.PI * (x - j))) / 2;
    d[i] = pts[j] * (1 - w) + pts[j + 1] * w;
  }
  return b;
}

function crackleBuffer(ctx: BaseAudioContext, seed: number): AudioBuffer {
  const sr = ctx.sampleRate;
  const n = Math.floor(sr * 4);
  const r = mulberry(seed);
  const b = ctx.createBuffer(1, n, sr);
  const d = b.getChannelData(0);
  const count = 4 * 26;
  for (let c = 0; c < count; c++) {
    const at = Math.floor(r() * (n - sr * 0.05));
    const amp = 0.08 + 0.92 * Math.pow(r(), 3);
    if (r() < 0.12) {
      // a pop: a damped low sine (sap bursting)
      const f = 120 + r() * 260;
      const len = Math.floor(sr * 0.03);
      for (let j = 0; j < len; j++) d[at + j] += amp * Math.sin((2 * Math.PI * f * j) / sr) * Math.exp(-j / (sr * 0.006));
    } else {
      // a tick: a short decaying noise burst
      const len = Math.floor(sr * (0.0008 + r() * 0.004));
      const tau = len / 3;
      for (let j = 0; j < len; j++) d[at + j] += amp * (r() * 2 - 1) * Math.exp(-j / tau);
    }
  }
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(d[i]));
  const g = 0.9 / (peak || 1);
  for (let i = 0; i < n; i++) d[i] *= g;
  return b;
}

function makeWave(ctx: BaseAudioContext, name: WaveName): PeriodicWave {
  const N = 40;
  const re = new Float32Array(N);
  const im = new Float32Array(N);
  if (name === "pulse25" || name === "pulse12") {
    const duty = name === "pulse25" ? 0.25 : 0.125;
    for (let h = 1; h < N; h++) re[h] = (2 / (h * Math.PI)) * Math.sin(h * Math.PI * duty);
  } else {
    const amps: Record<"piano" | "reed" | "fife", number[]> = {
      piano: [1, 0.62, 0.38, 0.24, 0.2, 0.12, 0.08, 0.07, 0.045, 0.03, 0.022, 0.015],
      reed: [1, 0.45, 0.72, 0.3, 0.46, 0.25, 0.3, 0.15, 0.18, 0.1, 0.1, 0.06, 0.05],
      fife: [1, 0.3, 0.2, 0.06, 0.05, 0.02],
    };
    amps[name].forEach((a, i) => (im[i + 1] = a));
  }
  return ctx.createPeriodicWave(re, im);
}

// ---------------------------------------------------------------------------------------------
// Nodes

export const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** A gain node, connected to a node or (as a modulator) added to a param. */
export function gain(k: Kit, v: number, to?: AudioNode | AudioParam): GainNode {
  const g = k.ctx.createGain();
  g.gain.value = v;
  if (to) {
    if ("connect" in to) g.connect(to);
    else g.connect(to);
  }
  return g;
}

export function filter(k: Kit, type: BiquadFilterType, f: number, q = 0.707, to?: AudioNode): BiquadFilterNode {
  const b = k.ctx.createBiquadFilter();
  b.type = type;
  b.frequency.value = clamp(f, 10, k.ctx.sampleRate * 0.45);
  b.Q.value = q;
  if (to) b.connect(to);
  return b;
}

function stopAt(k: Kit, s: AudioScheduledSourceNode, end: number): void {
  s.stop(end);
  if (end > k.until) k.until = end;
}

/** An oscillator started at t; `end` Infinity leaves it running until stopped by its owner. */
export function osc(k: Kit, type: OscType, f: number, t: number, end: number, to: AudioNode, detune = 0): OscillatorNode {
  const o = k.ctx.createOscillator();
  if (type === "sine" || type === "square" || type === "sawtooth" || type === "triangle") o.type = type;
  else o.setPeriodicWave(k.wave(type));
  o.frequency.value = f;
  if (detune) o.detune.value = detune;
  o.connect(to);
  o.start(t);
  if (Number.isFinite(end)) stopAt(k, o, Math.max(end, t + 0.01));
  k.sources?.push(o);
  return o;
}

/** Looping noise from a random offset; `end` Infinity leaves it running. */
export function noise(k: Kit, kind: NoiseKind, t: number, end: number, to: AudioNode, rate = 1): AudioBufferSourceNode {
  const s = k.ctx.createBufferSource();
  const buf = k[kind];
  s.buffer = buf;
  s.loop = true;
  if (rate !== 1) s.playbackRate.value = rate;
  s.connect(to);
  s.start(t, k.rnd() * (buf.duration - 0.05));
  if (Number.isFinite(end)) stopAt(k, s, Math.max(end, t + 0.01));
  k.sources?.push(s);
  return s;
}

/** Adds the smoothed random control signal (times `depth`) to `param`. `rate` 1 wanders at about 5 Hz. */
export function wander(k: Kit, param: AudioParam, t: number, end: number, rate: number, depth: number): AudioBufferSourceNode {
  const s = k.ctx.createBufferSource();
  s.buffer = k.ctrl;
  s.loop = true;
  s.playbackRate.value = rate;
  const g = gain(k, depth);
  s.connect(g);
  g.connect(param);
  s.start(t, k.rnd() * (k.ctrl.duration - 0.2));
  if (Number.isFinite(end)) stopAt(k, s, Math.max(end, t + 0.01));
  k.sources?.push(s);
  return s;
}

/** A delayed vibrato: returns a gain node (in cents) to connect to one or more detune params. */
export function vibrato(k: Kit, t: number, end: number, rate: number, cents: number): GainNode {
  const d = gain(k, 0);
  d.gain.setValueAtTime(0, t);
  d.gain.linearRampToValueAtTime(cents, t + 0.3);
  osc(k, "sine", rate * (0.95 + 0.1 * k.rnd()), t, end, d);
  return d;
}

// ---------------------------------------------------------------------------------------------
// Envelopes (all scheduled ahead, no cancelAndHold, so they behave the same in every browser)

/**
 * A hit: jumps to `peak` at t (or glides there over `a` s), then decays exponentially with
 * time constant `tau`. Retriggerable on the same param. Returns when it is 60 dB down.
 */
export function hit(p: AudioParam, t: number, peak: number, tau: number, a = 0): number {
  if (a > 0) {
    p.setTargetAtTime(peak, t, a / 3);
    p.setTargetAtTime(0, t + a, tau);
    return t + a + tau * 6.9;
  }
  p.setValueAtTime(peak, t);
  p.setTargetAtTime(0, t, tau);
  return t + tau * 6.9;
}

/** Linear rise to `peak` over `a`, hold, then an exponential release. For a fresh param only. */
export function swell(p: AudioParam, t: number, peak: number, a: number, hold: number, tau: number): number {
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(peak, t + a);
  p.setValueAtTime(peak, t + a + hold);
  p.setTargetAtTime(0, t + a + hold, tau);
  return t + a + hold + tau * 6.9;
}

/** Exponential glides through [time offset, value] points. */
export function sweep(p: AudioParam, t: number, pts: [number, number][]): void {
  p.setValueAtTime(pts[0][1], t + pts[0][0]);
  for (let i = 1; i < pts.length; i++) p.exponentialRampToValueAtTime(pts[i][1], t + pts[i][0]);
}

/**
 * A note envelope: attack `a` to `peak`, decay (about `d` s) to `s`·peak, held until note-off
 * at t + dur, then released over about `r` s. Returns when the voice can be stopped.
 */
export function adsr(p: AudioParam, t: number, dur: number, peak: number, a: number, d: number, s: number, r: number): number {
  const tPeak = t + a;
  const tOff = Math.max(t + dur, tPeak);
  const sus = peak * s;
  const tauD = Math.max(0.001, d / 3);
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(peak, tPeak);
  p.setTargetAtTime(sus, tPeak, tauD);
  const lvl = sus + (peak - sus) * Math.exp(-(tOff - tPeak) / tauD);
  p.setValueAtTime(lvl, tOff);
  p.setTargetAtTime(0, tOff, Math.max(0.001, r / 4));
  return tOff + r * 1.75;
}
