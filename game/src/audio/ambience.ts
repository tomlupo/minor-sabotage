// Warsaw, a late March afternoon in 1943: wind in the street, the city's hum, and now and then
// something far off: a tram (its bell), a dog, a cab horse's hooves on the setts, a car
// passing, sparrows, pigeons, and rarely church bells. A continuous bed plus random events,
// scheduled by the engine's look-ahead loop.
import { type Kit, collect, filter, gain, hit, noise, osc, wander } from "./kit";
import { CAR, SFX, bell, engineVoice } from "./sfx";

export const AMB_EVENTS = ["tram", "dog", "cart", "car", "sparrows", "pigeons", "bells"] as const;
export type AmbEvent = (typeof AMB_EVENTS)[number];

/** Seconds between events: [first after start, min gap, max gap]. */
const SPACING: Record<AmbEvent, [number, number, number]> = {
  sparrows: [3, 7, 20],
  dog: [9, 18, 45],
  tram: [14, 30, 70],
  cart: [22, 35, 80],
  car: [32, 40, 90],
  pigeons: [40, 45, 100],
  bells: [50, 150, 300],
};

function tram(k: Kit, out: AudioNode, t: number): number {
  const dur = 8;
  const rg = gain(k, 0, out);
  noise(k, "brown", t, t + dur, filter(k, "lowpass", 260, 0.8, rg));
  rg.gain.setValueAtTime(0, t);
  rg.gain.linearRampToValueAtTime(0.3, t + 3);
  rg.gain.linearRampToValueAtTime(0, t + dur - 0.3);
  const mid = gain(k, 0, out);
  noise(k, "pink", t, t + dur, filter(k, "bandpass", 500, 0.8, mid));
  mid.gain.setValueAtTime(0, t);
  mid.gain.linearRampToValueAtTime(0.12, t + 3);
  mid.gain.linearRampToValueAtTime(0, t + dur - 0.3);
  // rail joints under the bogies
  const j = gain(k, 0, out);
  noise(k, "white", t, t + dur, filter(k, "bandpass", 900, 2, j));
  for (let tt = t + 1.2; tt < t + dur - 1.5; tt += 0.95) {
    hit(j.gain, tt, 0.12, 0.012);
    hit(j.gain, tt + 0.16, 0.1, 0.012);
  }
  // the flange squeals on the curve
  const sq = gain(k, 0, out);
  const so = osc(k, "sine", 2900 + 400 * k.rnd(), t + 2.4, t + 5.2, sq);
  wander(k, so.frequency, t + 2.4, t + 5.2, 1.5, 40);
  sq.gain.setValueAtTime(0, t + 2.5);
  sq.gain.linearRampToValueAtTime(0.01, t + 2.9);
  sq.gain.setTargetAtTime(0, t + 3.9, 0.3);
  SFX.tram_bell.play(k, gain(k, 0.35, out), t + 1.4, { rate: 1 });
  return t + dur;
}

function dog(k: Kit, out: AudioNode, t: number): number {
  const n = 2 + Math.floor(k.rnd() * 3);
  const f0 = 380 + k.rnd() * 160;
  const end = t + n * 0.5 + 0.4;
  const g = gain(k, 0, out);
  const src = gain(k, 1);
  src.connect(filter(k, "bandpass", 900, 3, g));
  src.connect(filter(k, "bandpass", 1900, 4, gain(k, 0.6, g)));
  const o = osc(k, "sawtooth", f0, t, end, src);
  noise(k, "white", t, end, gain(k, 0.4, src));
  let tt = t;
  for (let i = 0; i < n; i++) {
    o.frequency.setValueAtTime(f0 * 1.25, tt);
    o.frequency.exponentialRampToValueAtTime(f0 * 0.8, tt + 0.12);
    g.gain.setTargetAtTime(0.3, tt, 0.008);
    g.gain.setTargetAtTime(0, tt + 0.1, 0.03);
    tt += 0.28 + k.rnd() * 0.15;
  }
  return end;
}

/** A dorożka: a cab horse trotting past, iron tyres on the setts. */
function cart(k: Kit, out: AudioNode, t: number): number {
  const dur = 7;
  const pass = gain(k, 0, out);
  pass.gain.setValueAtTime(0, t);
  pass.gain.linearRampToValueAtTime(0.7, t + dur * 0.5);
  pass.gain.linearRampToValueAtTime(0, t + dur);
  const hg = gain(k, 0, pass);
  const hbp = filter(k, "bandpass", 900, 3.5, hg);
  noise(k, "white", t, t + dur, hbp);
  const kg = gain(k, 0, pass);
  const ko = osc(k, "sine", 280, t, t + dur, kg);
  let tt = t + 0.1;
  for (let i = 0; tt < t + dur - 0.1; i++) {
    hbp.frequency.setValueAtTime(750 + k.rnd() * 500, tt);
    hit(hg.gain, tt, 2.8 * (0.7 + 0.3 * k.rnd()), 0.018);
    ko.frequency.setValueAtTime(240 + k.rnd() * 80, tt);
    hit(kg.gain, tt, 0.05, 0.02);
    tt += (i % 2 === 0 ? 0.13 : 0.29) + k.rnd() * 0.02;
  }
  const wg = gain(k, 0.15, pass);
  const am = gain(k, 0.12);
  am.connect(wg.gain);
  osc(k, "square", 11, t, t + dur, filter(k, "lowpass", 40, 0.7, am));
  noise(k, "brown", t, t + dur, filter(k, "lowpass", 500, 0.7, wg));
  return t + dur;
}

function car(k: Kit, out: AudioNode, t: number): number {
  const dur = 6;
  const g = gain(k, 0, out);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.8, t + dur * 0.5);
  g.gain.linearRampToValueAtTime(0, t + dur);
  const set = engineVoice(k, filter(k, "lowpass", 1400, 0.7, g), t, t + dur, CAR, 1.4);
  set(1.1, t + dur * 0.55);
  return t + dur;
}

function sparrows(k: Kit, out: AudioNode, t: number): number {
  const n = 3 + Math.floor(k.rnd() * 5);
  const g = gain(k, 0, out);
  const o = osc(k, "sine", 4500, t, t + n * 0.4 + 0.3, g);
  let tt = t;
  for (let i = 0; i < n; i++) {
    const f = 3800 + k.rnd() * 1800;
    o.frequency.setValueAtTime(f, tt);
    o.frequency.exponentialRampToValueAtTime(f * (1.15 + k.rnd() * 0.2), tt + 0.03);
    o.frequency.exponentialRampToValueAtTime(f * 0.85, tt + 0.06);
    hit(g.gain, tt, 0.08 * (0.6 + 0.4 * k.rnd()), 0.02, 0.004);
    tt += 0.09 + k.rnd() * 0.25;
  }
  return tt + 0.3;
}

function bells(k: Kit, out: AudioNode, t: number): number {
  const f = 196 * (1 + (k.rnd() - 0.5) * 0.06);
  const strikes = 5 + Math.floor(k.rnd() * 4);
  const parts: [number, number, number][] = [
    [0.5, 0.35, 4.5], [1, 0.6, 3.5], [1.19, 0.45, 2.6], [1.5, 0.25, 2],
    [2, 0.7, 2.4], [2.51, 0.2, 1.2], [3.01, 0.15, 0.9], [4.1, 0.08, 0.5],
  ];
  return bell(k, filter(k, "lowpass", 2400, 0.7, out), t, f, Array.from({ length: strikes }, (_, i) => i * 1.9), parts, 0.085);
}

const EVENT: Record<AmbEvent, (k: Kit, out: AudioNode, t: number) => number> = {
  tram,
  dog,
  cart,
  car,
  sparrows,
  pigeons: (k, out, t) => SFX.pigeons.play(k, gain(k, 0.35, out), t, { rate: 1 }),
  bells,
};

/** One event, placed somewhere off to the side and far away. */
export function playAmbEvent(k: Kit, out: AudioNode, e: AmbEvent, t: number, pan = (k.rnd() * 2 - 1) * 0.8): number {
  let head: AudioNode = out;
  if (k.ctx.createStereoPanner) {
    const p = k.ctx.createStereoPanner();
    p.pan.value = pan;
    p.connect(head);
    head = p;
  }
  const far = filter(k, "lowpass", e === "sparrows" ? 9000 : 3500, 0.6, head);
  return EVENT[e](k, far, t);
}

export class Ambience {
  private out: GainNode;
  private sources: AudioScheduledSourceNode[];
  private next = {} as Record<AmbEvent, number>;

  constructor(
    private k: Kit,
    dest: AudioNode,
    t: number,
  ) {
    this.out = gain(k, 0, dest);
    this.out.gain.setTargetAtTime(1, t, 0.8);
    this.sources = collect(k, () => {
      // wind: a band of noise that gusts and wanders
      const wind = gain(k, 0.12, this.out);
      const wbp = filter(k, "bandpass", 550, 0.7, wind);
      noise(k, "pink", t, Infinity, wbp);
      wander(k, wbp.frequency, t, Infinity, 0.07, 250);
      wander(k, wind.gain, t, Infinity, 0.11, 0.09);
      // wind whistling past a corner, faint
      const wh = gain(k, 0.012, this.out);
      const whp = filter(k, "bandpass", 950, 9, wh);
      noise(k, "white", t, Infinity, whp);
      wander(k, wh.gain, t, Infinity, 0.09, 0.012);
      wander(k, whp.frequency, t, Infinity, 0.05, 120);
      // the city: a low hum, and its hiss for small speakers
      noise(k, "brown", t, Infinity, filter(k, "lowpass", 220, 0.7, gain(k, 0.12, this.out)));
      noise(k, "pink", t, Infinity, filter(k, "bandpass", 700, 0.5, gain(k, 0.03, this.out)));
    });
    for (const e of AMB_EVENTS) this.next[e] = t + SPACING[e][0] * (0.6 + 0.8 * k.rnd());
  }

  /** Schedules every event due before `until`. */
  schedule(until: number): void {
    for (const e of AMB_EVENTS) {
      while (this.next[e] < until) {
        const at = this.next[e];
        playAmbEvent(this.k, this.out, e, at);
        const [, lo, hi] = SPACING[e];
        this.next[e] = at + lo + (hi - lo) * this.k.rnd();
      }
    }
  }

  stop(now: number): void {
    this.out.gain.setTargetAtTime(0, now, 0.4);
    for (const s of this.sources) {
      try {
        s.stop(now + 2.5);
      } catch {
        // already stopped
      }
    }
    const out = this.out;
    setTimeout(() => out.disconnect(), 3000);
  }
}
