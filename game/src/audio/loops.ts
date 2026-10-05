// Continuous sounds the game starts, moves and stops by id: the prison truck's engine, the
// getaway car, a fire, a panicking crowd. A loop's sources run until it is stopped; `rate`
// changes are glided. startLoop() wraps a builder in the positional chain and is shared by
// the engine and the offline renderer.
import { type Kit, filter, gain, noise, osc, wander } from "./kit";
import { CAR, TRUCK, engineVoice } from "./sfx";
import { spatial } from "./spatial";
import type { Loop, LoopOpts } from "./types";

/** Builds a loop into `out` from t; returns a function that glides it to a new rate. */
export type LoopBuilder = (k: Kit, out: AudioNode, t: number, rate: number) => (r: number, at: number) => void;

const fire: LoopBuilder = (k, out, t, rate) => {
  const mix = gain(k, 0.65, out);
  const roar = gain(k, 0.3, mix);
  const rlp = filter(k, "lowpass", 380 + 120 * rate, 0.8, roar);
  noise(k, "brown", t, Infinity, rlp);
  wander(k, roar.gain, t, Infinity, 1.4, 0.15);
  const flame = gain(k, 0.5, mix);
  noise(k, "pink", t, Infinity, filter(k, "bandpass", 1100, 0.7, flame));
  wander(k, flame.gain, t, Infinity, 2.3, 0.3);
  const cr = gain(k, 0.8 * rate, mix);
  const src = k.ctx.createBufferSource();
  src.buffer = k.crackle;
  src.loop = true;
  src.playbackRate.value = 0.9 + 0.2 * k.rnd();
  src.connect(filter(k, "highpass", 1300, 0.7, cr));
  src.start(t, k.rnd() * 3.5);
  k.sources?.push(src);
  return (r, at) => {
    roar.gain.setTargetAtTime(0.3 * Math.min(2, r), at, 0.3);
    rlp.frequency.setTargetAtTime(380 + 120 * r, at, 0.3);
    cr.gain.setTargetAtTime(0.8 * r, at, 0.3);
  };
};

/** Walla of a crowd in panic: formant-filtered babble and a few voices crying out. */
const crowd: LoopBuilder = (k, out, t, rate) => {
  const mix = gain(k, 0.9, out);
  const src = gain(k, 1);
  noise(k, "pink", t, Infinity, src);
  const syll: [AudioBufferSourceNode, number][] = [];
  for (const [f, q, a] of [[600, 3, 1.4], [1300, 4, 1.1], [2500, 5, 0.7]]) {
    const g = gain(k, a * 0.5, mix);
    const bp = filter(k, "bandpass", f, q, g);
    src.connect(bp);
    syll.push([wander(k, g.gain, t, Infinity, 5 * rate, a * 0.5), 5]);
    wander(k, bp.frequency, t, Infinity, 0.6, f * 0.25);
  }
  const vf = gain(k, 1);
  vf.connect(filter(k, "bandpass", 850, 4, gain(k, 1.4, mix)));
  vf.connect(filter(k, "bandpass", 1500, 5, gain(k, 0.7, mix)));
  for (const base of [230, 290, 185]) {
    const vg = gain(k, 0.06, vf);
    const o = osc(k, "sawtooth", base, t, Infinity, vg);
    syll.push([wander(k, o.frequency, t, Infinity, 1.6 * rate, base * 0.3), 1.6]);
    syll.push([wander(k, vg.gain, t, Infinity, 2.2 * rate, 0.06), 2.2]);
  }
  return (r, at) => {
    for (const [s, base] of syll) s.playbackRate.setTargetAtTime(base * r, at, 0.5);
    mix.gain.setTargetAtTime(0.7 + 0.2 * Math.min(2, r), at, 0.5);
  };
};

export const LOOPS: Record<Loop, LoopBuilder> = {
  truck_engine: (k, out, t, rate) => engineVoice(k, out, t, Infinity, TRUCK, rate),
  car_engine: (k, out, t, rate) => engineVoice(k, out, t, Infinity, CAR, rate),
  fire,
  crowd_panic: crowd,
};

export interface LoopHandle {
  l: Loop;
  gain: GainNode;
  pan: StereoPannerNode | null;
  lp: BiquadFilterNode;
  sources: AudioScheduledSourceNode[];
  setRate: (r: number, at: number) => void;
  o: LoopOpts;
}

function place(o: LoopOpts, lx: number, ly: number): { g: number; pan: number; cutoff: number } {
  const g = o.gain ?? 1;
  if (o.x === undefined || o.y === undefined) return { g, pan: 0, cutoff: 20000 };
  const s = spatial(o.x - lx, o.y - ly);
  return { g: g * s.gain, pan: s.pan, cutoff: s.gain > 0 ? s.cutoff : 800 };
}

export function startLoop(k: Kit, bus: AudioNode, l: Loop, t: number, o: LoopOpts, lx: number, ly: number): LoopHandle {
  const p = place(o, lx, ly);
  let head: AudioNode = bus;
  let pan: StereoPannerNode | null = null;
  if (k.ctx.createStereoPanner) {
    pan = k.ctx.createStereoPanner();
    pan.pan.value = p.pan;
    pan.connect(head);
    head = pan;
  }
  const lp = filter(k, "lowpass", Math.min(20000, p.cutoff), 0.5, head);
  const g = gain(k, 0, lp);
  g.gain.setTargetAtTime(p.g, t, 0.06);
  const outer = k.sources;
  const sources: AudioScheduledSourceNode[] = [];
  k.sources = sources;
  let setRate: (r: number, at: number) => void;
  try {
    setRate = LOOPS[l](k, g, t, o.rate ?? 1);
  } finally {
    k.sources = outer;
  }
  return { l, gain: g, pan, lp, sources, setRate, o: { ...o } };
}

export function updateLoop(h: LoopHandle, o: LoopOpts, lx: number, ly: number, now: number): void {
  const prevRate = h.o.rate ?? 1;
  h.o = { ...o };
  const p = place(o, lx, ly);
  h.gain.gain.setTargetAtTime(p.g, now, 0.08);
  h.pan?.pan.setTargetAtTime(p.pan, now, 0.08);
  h.lp.frequency.setTargetAtTime(Math.min(20000, p.cutoff), now, 0.08);
  const r = o.rate ?? 1;
  if (r !== prevRate) h.setRate(r, now);
}

export function stopLoop(h: LoopHandle, now: number): void {
  h.gain.gain.setTargetAtTime(0, now, 0.08);
  for (const s of h.sources) {
    try {
      s.stop(now + 0.6);
    } catch {
      // already stopped
    }
  }
  setTimeout(() => {
    try {
      h.gain.disconnect();
      h.lp.disconnect();
      h.pan?.disconnect();
    } catch {
      // already gone
    }
  }, 800);
}
