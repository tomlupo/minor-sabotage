// Sound-effect recipes. Each builds its graph into `out` starting at t and returns when it
// has rung out. Variation comes from the kit's random numbers (every shot, step and shard a
// little different) and from the caller's `rate`. startSfx() wraps a recipe in the voice
// chain (distance, pan, gain) and is shared by the engine and the offline renderer.
import { INSTRUMENTS } from "./instruments";
import { type Kit, type NoiseKind, filter, gain, hit, noise, osc, swell, sweep } from "./kit";
import { spatial } from "./spatial";
import type { PlayOpts, Sfx } from "./types";

export interface Vary {
  rate: number;
  rounds?: number;
}
export type Recipe = (k: Kit, out: AudioNode, t: number, v: Vary) => number;

export interface SfxDef {
  /** Stealing priority: 3 never yields to 2 or 1. */
  prio: 1 | 2 | 3;
  /** Most voices of this sound at once. */
  cap: number;
  /** Longest it can ring, in seconds (the offline render length). */
  len: number;
  play: Recipe;
}

// ---------------------------------------------------------------------------------------------
// Parts

/** A metallic ring: inharmonic partials with short decays (latches, bolts, door panels). */
function metal(k: Kit, out: AudioNode, t: number, f: number, peak: number, tau: number, ratios = [1, 1.47, 2.09, 2.91]): number {
  let end = t;
  ratios.forEach((r, i) => {
    const g = gain(k, 0, out);
    const e = hit(g.gain, t, peak / (1 + i * 0.6), tau / (1 + i * 0.35));
    osc(k, "sine", f * r, t, e, g);
    end = Math.max(end, e);
  });
  const c = gain(k, 0, out);
  hit(c.gain, t, peak * 1.6, 0.003);
  noise(k, "white", t, t + 0.03, filter(k, "highpass", 3000, 0.7, c));
  return end;
}

/** A dull body impact: a falling sine, low noise, and a mid knock a phone speaker can play. */
function thud(k: Kit, out: AudioNode, t: number, f: number, peak: number, tau = 0.06): number {
  const g = gain(k, 0, out);
  const e = hit(g.gain, t, peak, tau);
  const o = osc(k, "sine", f, t, e, g);
  sweep(o.frequency, t, [[0, f * 1.5], [tau * 2, f * 0.6]]);
  const n = gain(k, 0, out);
  hit(n.gain, t, peak * 1.6, tau * 0.8);
  noise(k, "brown", t, e, filter(k, "lowpass", f * 4, 0.7, n));
  const m = gain(k, 0, out);
  hit(m.gain, t, peak * 3, tau * 0.6);
  noise(k, "white", t, e, filter(k, "bandpass", Math.max(450, f * 7), 1.1, m));
  return e;
}

/** Shards of glass: bright pings at random pitches over `spread` seconds, and ringing noise. */
function tinkle(k: Kit, out: AudioNode, t: number, count: number, spread: number, peak: number): number {
  const end = t + spread + 0.45;
  const gs = [0, 1, 2].map(() => gain(k, 0, out));
  const os = gs.map((g) => osc(k, "sine", 4000, t, end, g));
  const ng = gain(k, 0, out);
  const res = filter(k, "bandpass", 5000, 14, ng);
  noise(k, "white", t, end, res);
  const times = Array.from({ length: count }, () => t + Math.pow(k.rnd(), 1.6) * spread).sort((a, b) => a - b);
  times.forEach((ti, i) => {
    const a = peak * (0.35 + 0.65 * k.rnd()) * (1 - (0.5 * (ti - t)) / spread);
    os[i % 3].frequency.setValueAtTime(2600 + k.rnd() * 4800, ti);
    hit(gs[i % 3].gain, ti, a, 0.02 + k.rnd() * 0.05);
    res.frequency.setValueAtTime(3000 + k.rnd() * 5000, ti);
    hit(ng.gain, ti, a * 5, 0.01 + k.rnd() * 0.02);
  });
  return end;
}

/** Filtered noise swept through a band: throws, swishes, flame. */
function whoosh(k: Kit, out: AudioNode, t: number, dur: number, f0: number, f1: number, f2: number, peak: number, q = 1, kind: NoiseKind = "pink"): number {
  const g = gain(k, 0, out);
  const bp = filter(k, "bandpass", f0, q, g);
  sweep(bp.frequency, t, [[0, f0], [dur * 0.45, f1], [dur, f2]]);
  const end = swell(g.gain, t, peak, dur * 0.45, 0, dur * 0.25);
  noise(k, kind, t, end, bp);
  return end;
}

/** Random spikes on one filtered noise chain: crackle, debris, grit. */
function spikes(k: Kit, out: AudioNode, t: number, span: number, count: number, peak: number, tau: number, hp: number, lp = 0, shape = 1.5): number {
  const g = gain(k, 0, out);
  const head: AudioNode = lp ? filter(k, "lowpass", lp, 0.7, g) : g;
  const f = filter(k, "highpass", hp, 0.7, head);
  const times = Array.from({ length: count }, () => t + Math.pow(k.rnd(), shape) * span).sort((a, b) => a - b);
  for (const ti of times) hit(g.gain, ti, peak * (0.2 + 0.8 * k.rnd()) * (1 - (0.7 * (ti - t)) / span), tau * (0.5 + k.rnd()));
  const end = t + span + tau * 10;
  noise(k, "white", t, end, f);
  return end;
}

/** Instrument notes for jingles: [delay, midi or midis, duration, velocity]. */
function notes(k: Kit, out: AudioNode, t: number, inst: keyof typeof INSTRUMENTS, list: [number, number | number[], number, number][]): number {
  let end = t;
  for (const [d, m, dur, vel] of list) {
    INSTRUMENTS[inst].play(k, out, t + d, Array.isArray(m) ? m : [m], dur, vel);
    end = Math.max(end, t + d + dur);
  }
  return end;
}

// ---------------------------------------------------------------------------------------------
// Guns: a crack (the transient), a blast band, a low body, a tail, the action's clack and,
// for the rifle, echoes off the house fronts. One round per call by default, because the sim
// emits a shot event per round; `rounds` plays a burst on one graph, retriggered per round,
// so a burst costs no more nodes than a single shot. Every call differs a little in pitch,
// band and level.

interface GunSpec {
  /** Seconds between rounds of a burst. */
  gap: number;
  crack: number;
  crackHp: number;
  blast: number;
  blastF: number;
  blastQ: number;
  blastTau: number;
  body: number;
  bodyF: number;
  bodyTau: number;
  tail: number;
  tailF: number;
  tailTau: number;
  mech: number;
  mechF: number;
  echo: number;
}

function gun(s: GunSpec): Recipe {
  return (k, out, t, v) => {
    const r = v.rate;
    const n = Math.max(1, Math.min(12, Math.round(v.rounds ?? 1)));
    const times: number[] = [];
    let tt = t;
    for (let i = 0; i < n; i++) {
      times.push(tt);
      tt += (s.gap * (0.94 + 0.12 * k.rnd())) / r;
    }
    const end = times[n - 1] + Math.max(s.tailTau * 7, s.echo ? 0.8 : 0) + 0.05;

    const crackG = gain(k, 0, out);
    noise(k, "white", t, end, filter(k, "highpass", s.crackHp * r, 0.7, crackG));
    const blastG = gain(k, 0, out);
    const blastF = filter(k, "bandpass", s.blastF * r, s.blastQ, blastG);
    noise(k, "white", t, end, blastF);
    const bodyG = gain(k, 0, out);
    const body = osc(k, "sine", s.bodyF * r, t, end, bodyG);
    const tailG = gain(k, 0, out);
    noise(k, "pink", t, end, filter(k, "bandpass", s.tailF * r, 0.6, tailG));
    const mechG = s.mech > 0 ? gain(k, 0, out) : null;
    if (mechG) noise(k, "white", t, end, filter(k, "bandpass", s.mechF * r, 3, mechG));
    const echoG = s.echo > 0 ? gain(k, 0, out) : null;
    if (echoG) noise(k, "pink", t, end, filter(k, "highpass", 350, 0.7, filter(k, "lowpass", 2000, 0.7, echoG)));

    times.forEach((ti, i) => {
      const j = 1 + (k.rnd() - 0.5) * 0.16;
      const a = i === 0 && n > 1 ? 1 : 0.84 + 0.16 * k.rnd();
      hit(crackG.gain, ti, s.crack * a, 0.005);
      blastF.frequency.setValueAtTime(s.blastF * r * j, ti);
      hit(blastG.gain, ti, s.blast * a, s.blastTau);
      body.frequency.setValueAtTime(s.bodyF * r * j, ti);
      body.frequency.exponentialRampToValueAtTime(s.bodyF * r * j * 0.5, ti + 0.06);
      hit(bodyG.gain, ti, s.body * a, s.bodyTau);
      hit(tailG.gain, ti, s.tail * a, s.tailTau, 0.012);
      if (mechG) hit(mechG.gain, ti + 0.007, s.mech * a, 0.004);
    });
    if (echoG) {
      // the street answers the last round: the near house front, the far one, the corner
      const tl = times[n - 1];
      [0.085, 0.16, 0.27, 0.41].forEach((d, e) =>
        hit(echoG.gain, tl + d * (0.9 + 0.2 * k.rnd()), s.echo * [0.55, 0.38, 0.24, 0.13][e], 0.03 + 0.02 * e, 0.006),
      );
    }
    return end;
  };
}

const sten = gun({
  gap: 0.085,
  crack: 1, crackHp: 2600,
  blast: 3.6, blastF: 1500, blastQ: 0.7, blastTau: 0.03,
  body: 0.35, bodyF: 150, bodyTau: 0.025,
  tail: 1.3, tailF: 1100, tailTau: 0.06,
  mech: 0.9, mechF: 3800, echo: 0,
});
const mp40 = gun({
  gap: 0.11,
  crack: 0.9, crackHp: 2000,
  blast: 3.8, blastF: 1100, blastQ: 0.65, blastTau: 0.034,
  body: 0.45, bodyF: 120, bodyTau: 0.03,
  tail: 1.3, tailF: 850, tailTau: 0.07,
  mech: 0.6, mechF: 2600, echo: 0,
});
const pistol = gun({
  gap: 0.4,
  crack: 0.8, crackHp: 3000,
  blast: 2.6, blastF: 1900, blastQ: 0.8, blastTau: 0.026,
  body: 0.25, bodyF: 170, bodyTau: 0.02,
  tail: 0.9, tailF: 1200, tailTau: 0.06,
  mech: 0.35, mechF: 4500, echo: 0.5,
});
const rifleShot = gun({
  gap: 1.2,
  crack: 1.5, crackHp: 2200,
  blast: 4.4, blastF: 1000, blastQ: 0.6, blastTau: 0.042,
  body: 0.5, bodyF: 95, bodyTau: 0.05,
  tail: 1.8, tailF: 800, tailTau: 0.14,
  mech: 0, mechF: 0, echo: 2.2,
});

/** The Kar98k: the shot, the street's echo, then the bolt worked (click-clack). */
const rifle: Recipe = (k, out, t, v) => {
  let end = rifleShot(k, out, t, v);
  const n = Math.max(1, v.rounds ?? 1);
  if (n === 1) {
    const b = t + 0.55 + 0.1 * k.rnd();
    metal(k, out, b, 1900, 0.05, 0.02);
    end = Math.max(end, metal(k, out, b + 0.16, 1450, 0.06, 0.025));
  }
  return end;
};

// ---------------------------------------------------------------------------------------------
// Explosions

const explosion: Recipe = (k, out, t, v) => {
  const r = v.rate;
  const c = gain(k, 0, out);
  hit(c.gain, t, 1.2, 0.03);
  noise(k, "white", t, t + 0.3, filter(k, "lowpass", 7000 * r, 0.7, c));
  // the thump for headphones (kept modest: sub-bass only eats the limiter's headroom)...
  const b = gain(k, 0, out);
  const bo = osc(k, "sine", 90 * r, t, t + 2, b);
  sweep(bo.frequency, t, [[0, 90 * r], [0.5, 38 * r]]);
  hit(b.gain, t, 0.4, 0.28, 0.004);
  // ...and the boom a phone speaker can actually play
  const m = gain(k, 0, out);
  hit(m.gain, t, 6, 0.26, 0.014);
  noise(k, "pink", t, t + 2, filter(k, "bandpass", 520 * r, 0.8, m));
  const m2 = gain(k, 0, out);
  hit(m2.gain, t, 5, 0.15, 0.006);
  noise(k, "white", t, t + 1.2, filter(k, "bandpass", 1100 * r, 0.8, m2));
  const ru = gain(k, 0, out);
  hit(ru.gain, t, 0.6, 0.6, 0.06);
  noise(k, "brown", t, t + 4.5, filter(k, "lowpass", 160 * r, 0.7, ru));
  // stones and glass pattering down, and a few heavier pieces
  spikes(k, out, t + 0.12, 1.4, 34, 1.1, 0.006, 2200, 7000, 1.4);
  const d = gain(k, 0, out);
  noise(k, "pink", t, t + 1.8, filter(k, "bandpass", 700, 1.2, d));
  for (let i = 0; i < 7; i++) hit(d.gain, t + 0.25 + Math.pow(k.rnd(), 1.3) * 1.1, 1.6 * (0.4 + 0.6 * k.rnd()), 0.025);
  return t + 3.2;
};

const explosionFar: Recipe = (k, out, t, v) => {
  const r = v.rate;
  const mu = filter(k, "lowpass", 750 * r, 0.7, out);
  const b = gain(k, 0, mu);
  const bo = osc(k, "sine", 60 * r, t, t + 2.5, b);
  sweep(bo.frequency, t, [[0, 60 * r], [0.6, 36 * r]]);
  hit(b.gain, t, 0.3, 0.45, 0.02);
  const m = gain(k, 0, mu);
  hit(m.gain, t, 2, 0.35, 0.015);
  noise(k, "pink", t, t + 2.5, filter(k, "bandpass", 400 * r, 0.8, m));
  const ru = gain(k, 0, mu);
  ru.gain.setTargetAtTime(0.5, t, 0.05);
  ru.gain.setTargetAtTime(0.3, t + 0.3, 0.2);
  ru.gain.setTargetAtTime(0.42, t + 0.45, 0.08); // the echo rolling back off the houses
  ru.gain.setTargetAtTime(0, t + 0.6, 0.6);
  noise(k, "brown", t, t + 4.5, filter(k, "lowpass", 200 * r, 0.7, ru));
  return t + 4.5;
};

// ---------------------------------------------------------------------------------------------
// Throwables

const grenadeThrow: Recipe = (k, out, t, v) => {
  const r = v.rate;
  metal(k, out, t, 3100 * r, 0.05, 0.05, [1, 1.52, 2.3]); // the spoon flies off
  return whoosh(k, out, t + 0.06, 0.35 / r, 700 * r, 2400 * r, 900 * r, 0.9, 1.5);
};

const bottleThrow: Recipe = (k, out, t, v) => {
  const r = v.rate;
  const end = whoosh(k, out, t, 0.4 / r, 450 * r, 1300 * r, 600 * r, 0.8, 1.2);
  // petrol sloshing: a few bubble chirps
  const g = gain(k, 0, out);
  const o = osc(k, "sine", 500, t, t + 0.4, g);
  for (let i = 0; i < 4; i++) {
    const ti = t + 0.02 + i * 0.07 + k.rnd() * 0.03;
    const f = (350 + k.rnd() * 350) * r;
    o.frequency.setValueAtTime(f, ti);
    o.frequency.exponentialRampToValueAtTime(f * 1.7, ti + 0.035);
    hit(g.gain, ti, 0.1, 0.018, 0.004);
  }
  return end;
};

/** The flame catching: a low fwoomp and a band of noise opening and closing. */
function ignite(k: Kit, out: AudioNode, t: number, r: number, peak: number): number {
  const w = gain(k, 0, out);
  const wo = osc(k, "sine", 70 * r, t, t + 0.8, w);
  sweep(wo.frequency, t, [[0, 70 * r], [0.4, 40 * r]]);
  hit(w.gain, t, 0.3 * peak, 0.15, 0.03);
  const g = gain(k, 0, out);
  const lp = filter(k, "lowpass", 300, 0.9, g);
  sweep(lp.frequency, t, [[0, 300 * r], [0.12, 2800 * r], [0.9, 500 * r]]);
  const end = swell(g.gain, t, 1.6 * peak, 0.12, 0.05, 0.3);
  noise(k, "pink", t, end, lp);
  spikes(k, out, t + 0.08, 0.8, 12, 0.5 * peak, 0.004, 2000);
  return end;
}

const bottleSmash: Recipe = (k, out, t, v) => {
  const r = v.rate;
  const c = gain(k, 0, out);
  hit(c.gain, t, 1, 0.05);
  noise(k, "white", t, t + 0.4, filter(k, "highpass", 3000 * r, 0.7, c));
  tinkle(k, out, t, 22, 0.35, 0.12);
  thud(k, out, t, 120 * r, 0.18, 0.04);
  return Math.max(t + 0.8, ignite(k, out, t + 0.07, r, 0.62));
};

const fireWhoosh: Recipe = (k, out, t, v) => ignite(k, out, t, v.rate, 0.6);

// ---------------------------------------------------------------------------------------------
// Bodies and impacts

const knife: Recipe = (k, out, t, v) => {
  const r = v.rate;
  const g = gain(k, 0, out);
  const bp = filter(k, "bandpass", 2000 * r, 2, g);
  sweep(bp.frequency, t, [[0, 2000 * r], [0.07, 5500 * r]]);
  swell(g.gain, t, 1.2, 0.02, 0.01, 0.03);
  noise(k, "white", t, t + 0.25, bp);
  return Math.max(t + 0.3, thud(k, out, t + 0.06, 130 * r, 0.3, 0.035));
};

const bodyFall: Recipe = (k, out, t, v) => {
  const r = v.rate;
  thud(k, out, t, 85 * r, 0.32, 0.07);
  const rustle = gain(k, 0, out);
  swell(rustle.gain, t, 1, 0.03, 0.02, 0.05);
  noise(k, "pink", t, t + 0.4, filter(k, "bandpass", 1400 * r, 0.7, rustle));
  thud(k, out, t + 0.12, 110 * r, 0.18, 0.05);
  // the rifle hits the cobbles: a woody clack
  const cl = gain(k, 0, out);
  hit(cl.gain, t + 0.19, 1.4, 0.02);
  noise(k, "white", t + 0.18, t + 0.4, filter(k, "bandpass", 750 * r, 3, cl));
  return t + 0.7;
};

const hitSfx: Recipe = (k, out, t, v) => {
  const r = v.rate;
  const g = gain(k, 0, out);
  hit(g.gain, t, 4.5, 0.026);
  noise(k, "white", t, t + 0.25, filter(k, "bandpass", 750 * r, 1.1, g));
  const g2 = gain(k, 0, out);
  hit(g2.gain, t, 2, 0.012);
  noise(k, "white", t, t + 0.15, filter(k, "bandpass", 1600 * r, 1.4, g2));
  const b = gain(k, 0, out);
  const o = osc(k, "sine", 160 * r, t, t + 0.2, b);
  sweep(o.frequency, t, [[0, 160 * r], [0.05, 75 * r]]);
  hit(b.gain, t, 0.25, 0.03);
  const c = gain(k, 0, out);
  hit(c.gain, t, 0.25, 0.002);
  noise(k, "white", t, t + 0.02, filter(k, "highpass", 4000, 0.7, c));
  return t + 0.25;
};

const ricochet: Recipe = (k, out, t, v) => {
  const r = v.rate;
  const c = gain(k, 0, out);
  hit(c.gain, t, 0.8, 0.004);
  noise(k, "white", t, t + 0.03, filter(k, "highpass", 2500, 0.7, c));
  const f0 = (2400 + k.rnd() * 1200) * r;
  const g = gain(k, 0, out);
  const o = osc(k, "triangle", f0, t, t + 0.75, g);
  sweep(o.frequency, t, [[0, f0], [0.45, f0 * 0.45]]);
  const wob = gain(k, 40);
  wob.connect(o.detune);
  osc(k, "sine", 26 + k.rnd() * 8, t, t + 0.75, wob);
  hit(g.gain, t + 0.005, 0.2, 0.14, 0.01);
  return t + 0.8;
};

const glass: Recipe = (k, out, t, v) => {
  const r = v.rate;
  const c = gain(k, 0, out);
  hit(c.gain, t, 1.1, 0.08);
  noise(k, "white", t, t + 0.6, filter(k, "highpass", 2500 * r, 0.7, c));
  const c2 = gain(k, 0, out);
  hit(c2.gain, t, 0.9, 0.15);
  noise(k, "white", t, t + 1, filter(k, "bandpass", 5000 * r, 1, c2));
  tinkle(k, out, t, 18, 0.25, 0.13);
  return tinkle(k, out, t + 0.35, 14, 0.75, 0.07); // the shards landing
};

const step: Recipe = (k, out, t, v) => {
  const r = v.rate * (0.88 + 0.24 * k.rnd());
  const slush = 0.3 + 0.7 * k.rnd();
  const h = gain(k, 0, out);
  hit(h.gain, t, 0.5, 0.018);
  noise(k, "brown", t, t + 0.15, filter(k, "lowpass", 380 * r, 0.8, h));
  const b = gain(k, 0, out);
  hit(b.gain, t, 0.08, 0.012);
  osc(k, "sine", 95 * r, t, t + 0.1, b);
  const s = gain(k, 0, out);
  const bp = filter(k, "bandpass", 1600 * r, 1.8, s);
  sweep(bp.frequency, t, [[0, 1600 * r], [0.05, 900 * r]]);
  hit(s.gain, t + 0.005, 0.9 * slush + 0.15, 0.03, 0.006);
  noise(k, "white", t, t + 0.2, bp);
  const gr = gain(k, 0, out);
  hit(gr.gain, t + 0.01, 0.3 * (1 - slush) + 0.06, 0.004);
  noise(k, "white", t, t + 0.05, filter(k, "highpass", 4000, 0.7, gr));
  return t + 0.2;
};

// ---------------------------------------------------------------------------------------------
// Voices of the street

/** The Schupo's two-tone pea whistle: two blasts, the pea trilling both tones. */
const whistle: Recipe = (k, out, t, v) => {
  const r = v.rate;
  const f1 = 2850 * r * (1 + (k.rnd() - 0.5) * 0.03);
  const f2 = f1 * 1.13;
  const end = t + 1.75;
  const env = gain(k, 0, out);
  const am = gain(k, 0.62, env);
  const tone = gain(k, 1, am);
  const o1 = osc(k, "sine", f1, t, end, tone);
  const o2 = osc(k, "triangle", f2, t, end, gain(k, 0.55, tone));
  const pea = 21 + k.rnd() * 6;
  const lfo = osc(k, "sine", pea, t, end, gain(k, 0.38, am.gain));
  const fm1 = gain(k, f1 * 0.035, o1.frequency);
  const fm2 = gain(k, f2 * 0.035, o2.frequency);
  lfo.connect(fm1);
  lfo.connect(fm2);
  const breath = gain(k, 0.09, env);
  noise(k, "white", t, end, filter(k, "bandpass", f1, 2, breath));
  for (const [s, len] of [[0, 0.5], [0.66, 0.95]]) {
    const ts = t + s;
    o1.frequency.setValueAtTime(f1 * 0.94, ts);
    o1.frequency.setTargetAtTime(f1, ts, 0.02);
    o2.frequency.setValueAtTime(f2 * 0.94, ts);
    o2.frequency.setTargetAtTime(f2, ts, 0.02);
    env.gain.setTargetAtTime(0.24, ts, 0.006);
    env.gain.setTargetAtTime(0, ts + len, 0.02);
  }
  return end;
};

/** A gruff bark of alarm: two wordless syllables through vowel formants. */
const shout: Recipe = (k, out, t, v) => {
  const r = v.rate * (0.92 + 0.16 * k.rnd());
  const end = t + 1.05;
  const src = gain(k, 1);
  const saw = osc(k, "sawtooth", 170 * r, t, end, src);
  const saw2 = osc(k, "sawtooth", 173 * r, t, end, gain(k, 0.5, src));
  const breath = gain(k, 0, src);
  noise(k, "white", t, end, breath);
  const env = gain(k, 0, out);
  const formants: [number, number, number][] = [[750, 6, 1.3], [1250, 8, 0.9], [2600, 10, 0.5]];
  const fs = formants.map(([f, q, a]) => {
    const bp = filter(k, "bandpass", f * r, q, gain(k, a * 2.2, env));
    src.connect(bp);
    return bp;
  });
  const syll: [number, number, number, [number, number, number]][] = [
    [0, 0.3, 1, [750, 1250, 2600]],
    [0.42, 0.34, 0.9, [480, 1850, 2550]],
  ];
  for (const [d, len, a, vowel] of syll) {
    const ts = t + 0.05 + d; // each syllable's breath starts 40 ms before its voice
    breath.gain.setValueAtTime(0.9, ts - 0.04);
    breath.gain.setTargetAtTime(0.15, ts, 0.02);
    for (const o of [saw, saw2]) {
      o.frequency.setValueAtTime(175 * r, ts);
      o.frequency.linearRampToValueAtTime(215 * r, ts + len * 0.35);
      o.frequency.linearRampToValueAtTime(160 * r, ts + len);
    }
    fs.forEach((bp, i) => bp.frequency.setTargetAtTime(vowel[i] * r, ts, 0.03));
    env.gain.setValueAtTime(0, ts - 0.04);
    env.gain.linearRampToValueAtTime(0.45 * a, ts + 0.03);
    env.gain.setTargetAtTime(0.36 * a, ts + 0.03, 0.08);
    env.gain.setTargetAtTime(0, ts + len, 0.03);
  }
  return end;
};

// ---------------------------------------------------------------------------------------------
// Vehicles

const truckBrake: Recipe = (k, out, t, v) => {
  const r = v.rate;
  const sq = gain(k, 0, out);
  const vib = gain(k, 0.01 * 1650 * r);
  osc(k, "sine", 6 + k.rnd() * 3, t, t + 1.2, vib);
  for (const [f, a] of [[1650, 1], [2480, 0.55], [3310, 0.25]]) {
    const o = osc(k, "sine", f * r, t, t + 1.2, gain(k, a, sq));
    sweep(o.frequency, t, [[0, f * r], [0.75, f * r * 0.96]]);
    vib.connect(o.frequency);
  }
  swell(sq.gain, t + 0.05, 0.11, 0.12, 0.45, 0.1);
  // tyres scrubbing over cobbles
  const sk = gain(k, 0, out);
  const cob = gain(k, 0.4);
  cob.connect(sk.gain);
  osc(k, "square", 16, t, t + 1.1, filter(k, "lowpass", 60, 0.7, cob));
  swell(sk.gain, t, 0.55, 0.05, 0.3, 0.25);
  noise(k, "brown", t, t + 1.3, filter(k, "lowpass", 450 * r, 0.7, sk));
  const sc = gain(k, 0, out);
  swell(sc.gain, t, 0.5, 0.05, 0.35, 0.2);
  noise(k, "white", t, t + 1.3, filter(k, "bandpass", 900 * r, 0.6, sc));
  // the truck rocks to a stop
  thud(k, out, t + 0.95, 90 * r, 0.2, 0.08);
  return metal(k, out, t + 0.97, 520 * r, 0.03, 0.1);
};

const carDoor: Recipe = (k, out, t, v) => {
  const r = v.rate;
  const c = gain(k, 0, out);
  hit(c.gain, t, 0.5, 0.004);
  noise(k, "white", t, t + 0.03, filter(k, "highpass", 3500, 0.7, c));
  thud(k, out, t + 0.012, 115 * r, 0.3, 0.045);
  const s = gain(k, 0, out);
  hit(s.gain, t + 0.012, 3.4, 0.05);
  noise(k, "white", t, t + 0.4, filter(k, "bandpass", 480 * r, 2.5, s));
  return Math.max(t + 0.5, metal(k, out, t + 0.012, 390 * r, 0.06, 0.1, [1, 2.33, 3.1]));
};

const truckDoors: Recipe = (k, out, t, v) => {
  const r = v.rate;
  metal(k, out, t, 1100 * r, 0.1, 0.05);
  const slide = gain(k, 0, out);
  swell(slide.gain, t + 0.08, 0.35, 0.05, 0.06, 0.04);
  noise(k, "white", t, t + 0.35, filter(k, "bandpass", 2200 * r, 3, slide));
  // the hinges creak: a stick-slip buzz through a narrow band
  const cr = gain(k, 0, out);
  const co = osc(k, "sawtooth", 240 * r, t + 0.25, t + 0.85, filter(k, "bandpass", 1100 * r, 5, cr));
  sweep(co.frequency, t + 0.25, [[0, 240 * r], [0.5, 175 * r]]);
  const slip = gain(k, 0.5);
  slip.connect(cr.gain);
  osc(k, "square", 22 + k.rnd() * 6, t + 0.25, t + 0.85, filter(k, "lowpass", 90, 0.7, slip));
  swell(cr.gain, t + 0.25, 0.5, 0.1, 0.4, 0.05);
  // both doors swing to
  thud(k, out, t + 0.82, 95 * r, 0.3, 0.08);
  metal(k, out, t + 0.82, 310 * r, 0.12, 0.18, [1, 1.72, 2.51, 3.3]);
  thud(k, out, t + 0.99, 105 * r, 0.22, 0.07);
  return metal(k, out, t + 0.99, 335 * r, 0.08, 0.16, [1, 1.72, 2.51, 3.3]);
};

export interface EngineSpec {
  f0: number;
  lp: number;
  lpRate: number;
  lope: number;
  mech: number;
  mechF: number;
  rasp: number;
  level: number;
  whine: number;
  body: number;
  sub: number;
}
export const TRUCK: EngineSpec = { f0: 30, lp: 300, lpRate: 180, lope: 0.45, mech: 1, mechF: 1700, rasp: 1.5, level: 0.5, whine: 0.02, body: 0.25, sub: 0.15 };
export const CAR: EngineSpec = { f0: 42, lp: 480, lpRate: 260, lope: 0.25, mech: 0.8, mechF: 2400, rasp: 1.3, level: 0.5, whine: 0.015, body: 0.28, sub: 0.12 };

/** An engine: firing harmonics, a half-order lope, tappet clatter and exhaust rasp that pulse with it. */
export function engineVoice(k: Kit, out: AudioNode, t: number, end: number, s: EngineSpec, rate: number): (r: number, at: number, tau?: number) => void {
  const mix = gain(k, s.level, out);
  const body = gain(k, s.body, mix);
  const lp1 = filter(k, "lowpass", s.lp + s.lpRate * rate, 1.6, body);
  const o1 = osc(k, "sawtooth", s.f0 * rate, t, end, lp1);
  const sub = gain(k, s.sub, mix);
  const lp2 = filter(k, "lowpass", 160 + 60 * rate, 1, sub);
  const o2 = osc(k, "square", s.f0 * rate * 0.5, t, end, lp2);
  // uneven firing: the body's level wobbles by ±lope of itself at a quarter of the firing rate
  const lope = gain(k, s.lope * s.body);
  lope.connect(body.gain);
  const o3 = osc(k, "sine", s.f0 * rate * 0.25, t, end, lope);
  const mg = gain(k, s.mech * 0.5, mix);
  const mbp = filter(k, "bandpass", s.mechF * Math.sqrt(rate), 1.4, mg);
  noise(k, "white", t, end, mbp);
  const mAm = gain(k, s.mech * 0.5);
  mAm.connect(mg.gain);
  o1.connect(mAm);
  const rg = gain(k, s.rasp * 0.5, mix);
  const rbp = filter(k, "bandpass", 420 + 90 * rate, 1.1, rg);
  noise(k, "pink", t, end, rbp);
  const rAm = gain(k, s.rasp * 0.5);
  rAm.connect(rg.gain);
  o2.connect(rAm);
  const wg = gain(k, s.whine * Math.max(0, rate - 1), mix);
  const o4 = osc(k, "triangle", s.f0 * rate * 9, t, end, wg);
  return (r, at, tau = 0.25) => {
    const f = s.f0 * r;
    o1.frequency.setTargetAtTime(f, at, tau);
    o2.frequency.setTargetAtTime(f * 0.5, at, tau);
    o3.frequency.setTargetAtTime(f * 0.25, at, tau);
    o4.frequency.setTargetAtTime(f * 9, at, tau);
    lp1.frequency.setTargetAtTime(s.lp + s.lpRate * r, at, tau);
    lp2.frequency.setTargetAtTime(160 + 60 * r, at, tau);
    mbp.frequency.setTargetAtTime(s.mechF * Math.sqrt(r), at, tau);
    rbp.frequency.setTargetAtTime(420 + 90 * r, at, tau);
    wg.gain.setTargetAtTime(s.whine * Math.max(0, r - 1), at, tau);
  };
}

const carStart: Recipe = (k, out, t, v) => {
  const r = v.rate;
  // the starter cranks against compression: rr-rr-rr
  const cg = gain(k, 0, out);
  const am = gain(k, 0.5);
  am.connect(cg.gain);
  osc(k, "square", 6.5, t, t + 0.95, filter(k, "lowpass", 40, 0.7, am));
  osc(k, "sawtooth", 140 * r, t, t + 0.95, filter(k, "lowpass", 900, 0.8, cg));
  osc(k, "sine", 900 * r, t, t + 0.95, gain(k, 0.06, cg));
  swell(cg.gain, t, 0.35, 0.05, 0.75, 0.04);
  // it catches, flares and settles to idle
  const eg = gain(k, 0, out);
  const end = t + 2.6;
  const set = engineVoice(k, eg, t + 0.85, end, CAR, 1);
  set(2.2, t + 0.9, 0.08);
  set(1.2, t + 1.35, 0.25);
  eg.gain.setValueAtTime(0, t + 0.85);
  eg.gain.linearRampToValueAtTime(0.7, t + 0.95);
  eg.gain.setTargetAtTime(0.5, t + 1.4, 0.2);
  eg.gain.setTargetAtTime(0, t + 2.1, 0.12);
  return end;
};

// ---------------------------------------------------------------------------------------------
// The city

/** A struck bell: modal partials, retriggered for each strike. */
export function bell(k: Kit, out: AudioNode, t: number, f: number, strikes: number[], parts: [number, number, number][], peak: number): number {
  const last = t + strikes[strikes.length - 1];
  const end = last + Math.max(...parts.map((p) => p[2])) * 6.9;
  const gs = parts.map(([ratio]) => {
    const g = gain(k, 0, out);
    osc(k, "sine", f * ratio, t, end, g);
    return g;
  });
  for (const s of strikes) parts.forEach(([, a, tau], j) => hit(gs[j].gain, t + s, peak * a, tau, 0.002));
  return end;
}

const TRAM_BELL: [number, number, number][] = [[1, 1, 0.6], [2.02, 0.5, 0.4], [2.74, 0.4, 0.3], [3.9, 0.25, 0.15], [5.2, 0.15, 0.08]];

const tramBell: Recipe = (k, out, t, v) => {
  const r = v.rate;
  const c = gain(k, 0, out);
  hit(c.gain, t, 0.5, 0.003);
  hit(c.gain, t + 0.26, 0.45, 0.003);
  noise(k, "white", t, t + 0.35, filter(k, "highpass", 3000, 0.7, c));
  return bell(k, out, t, 1180 * r, [0, 0.26], TRAM_BELL, 0.13);
};

const pigeons: Recipe = (k, out, t, v) => {
  const r = v.rate;
  let end = t;
  for (const [delay, f] of [[0, 1300], [0.035, 1750]]) {
    const g = gain(k, 0, out);
    const bp = filter(k, "bandpass", f * r, 0.9, g);
    let tt = t + delay;
    const n = 14 + Math.floor(k.rnd() * 5);
    for (let i = 0; i < n; i++) {
      const fade = 1 - i / n;
      bp.frequency.setValueAtTime(f * r * (0.85 + 0.3 * k.rnd()), tt);
      hit(g.gain, tt, 1.3 * (0.3 + 0.7 * fade) * (0.7 + 0.3 * k.rnd()), 0.025, 0.004);
      tt += 0.065 + k.rnd() * 0.02;
    }
    noise(k, "white", t, tt + 0.2, bp);
    end = Math.max(end, tt + 0.2);
  }
  return end;
};

// ---------------------------------------------------------------------------------------------
// Interface: soft mechanical clicks, a typewriter, paper, a rubber stamp

function click(k: Kit, out: AudioNode, t: number, f: number, peak: number, tau = 0.004): void {
  const c = gain(k, 0, out);
  hit(c.gain, t, peak, tau);
  noise(k, "white", t, t + 0.04, filter(k, "bandpass", f, 1.5, c));
}

function tink(k: Kit, out: AudioNode, t: number, f: number, peak: number, tau: number): number {
  const g = gain(k, 0, out);
  const e = hit(g.gain, t, peak, tau, 0.002);
  osc(k, "sine", f, t, e, g);
  return e;
}

const uiTap: Recipe = (k, out, t) => {
  click(k, out, t, 2600, 3, 0.006);
  return tink(k, out, t, 1150, 0.1, 0.014);
};

const uiOk: Recipe = (k, out, t) => {
  click(k, out, t, 2400, 0.7);
  click(k, out, t + 0.05, 3400, 0.7);
  return tink(k, out, t + 0.05, 1318.5, 0.065, 0.06);
};

const uiBack: Recipe = (k, out, t) => {
  click(k, out, t, 3000, 0.9);
  click(k, out, t + 0.05, 2000, 0.9);
  return tink(k, out, t + 0.05, 880, 0.06, 0.05);
};

const uiPause: Recipe = (k, out, t) => {
  const g = gain(k, 0, out);
  const o = osc(k, "sine", 200, t, t + 0.25, g);
  sweep(o.frequency, t, [[0, 210], [0.05, 150]]);
  hit(g.gain, t, 0.12, 0.03);
  const w = gain(k, 0, out);
  osc(k, "sine", 620, t, hit(w.gain, t, 0.06, 0.02), w);
  click(k, out, t, 900, 3.4, 0.008);
  click(k, out, t + 0.02, 2600, 0.9);
  return t + 0.3;
};

/** The go-code: a rifle bolt worked, ka-chak, and a small rising blip. */
const uiGo: Recipe = (k, out, t) => {
  metal(k, out, t, 2300, 0.05, 0.018);
  click(k, out, t, 1800, 0.6);
  metal(k, out, t + 0.09, 1700, 0.06, 0.022);
  click(k, out, t + 0.09, 900, 0.7);
  return notes(k, out, t + 0.13, "pulse", [[0, 79, 0.06, 0.45], [0.07, 86, 0.1, 0.5]]) + 0.2;
};

const uiAlert: Recipe = (k, out, t) => notes(k, out, t, "pulse", [[0, 81, 0.07, 0.6], [0.11, 88, 0.09, 0.6]]) + 0.15;

const typewriter: Recipe = (k, out, t) => {
  const a = 1.4 + 0.6 * k.rnd();
  const c = gain(k, 0, out);
  hit(c.gain, t, 0.5 * a, 0.003);
  noise(k, "white", t, t + 0.03, filter(k, "highpass", 2500, 0.7, c));
  const s = gain(k, 0, out);
  hit(s.gain, t + 0.004, 1.8 * a, 0.012);
  noise(k, "white", t, t + 0.1, filter(k, "bandpass", 1000 + k.rnd() * 400, 3, s));
  const p = gain(k, 0, out);
  hit(p.gain, t + 0.004, 0.06 * a, 0.01);
  osc(k, "sine", 170, t, t + 0.08, p);
  return t + 0.1;
};

const paper: Recipe = (k, out, t, v) => {
  const r = v.rate;
  const g = gain(k, 0, out);
  const bp = filter(k, "bandpass", 2600 * r, 0.8, g);
  const hp = filter(k, "highpass", 900, 0.7, bp);
  let tt = t;
  for (let i = 0; i < 7; i++) {
    g.gain.setTargetAtTime((0.4 + 0.6 * k.rnd()) * 0.3, tt, 0.004);
    g.gain.setTargetAtTime(0, tt + 0.015, 0.02);
    tt += 0.03 + k.rnd() * 0.05;
  }
  noise(k, "pink", t, tt + 0.15, hp);
  const end = whoosh(k, out, t, 0.3, 1500 * r, 3500 * r, 2500 * r, 0.25, 0.8, "white");
  return Math.max(end, tt + 0.15);
};

/** The rubber stamp on the identity tag, and a small cheerful fanfare. */
const promotion: Recipe = (k, out, t) => {
  click(k, out, t, 3000, 0.4);
  thud(k, out, t + 0.03, 110, 0.45, 0.05);
  const p = gain(k, 0, out);
  hit(p.gain, t + 0.03, 0.9, 0.015);
  noise(k, "white", t, t + 0.12, filter(k, "bandpass", 1500, 1, p));
  notes(k, out, t + 0.28, "brass", [[0, 72, 0.1, 0.8], [0.12, 77, 0.1, 0.85], [0.24, 81, 0.5, 0.95]]);
  return notes(k, out, t + 0.52, "glock", [[0, 93, 0.3, 0.9]]) + 0.9;
};

/** A soldier falls: a muted horn, a falling fifth, and a low piano under the second note. */
const fallen: Recipe = (k, out, t) => {
  notes(k, out, t, "horn", [[0, 69, 0.45, 0.75], [0.55, 62, 1.2, 0.7]]);
  return notes(k, out, t + 0.55, "piano", [[0, [38, 50], 1.4, 0.3]]) + 0.8;
};

/** Mission done: a snare roll into the march's opening arpeggio and a full F major chord. */
const missionDone: Recipe = (k, dest, t) => {
  const out = gain(k, 0.75, dest);
  for (let i = 0; i < 10; i++) INSTRUMENTS.snare.play(k, out, t + i * 0.035, [], 0.03, 0.25 + 0.05 * i);
  const t1 = t + 0.38;
  notes(k, out, t, "fife", [[0.02, 77, 0.1, 0.8], [0.14, 81, 0.1, 0.85], [0.26, 84, 0.1, 0.9], [0.38, 89, 0.9, 1]]);
  notes(k, out, t1, "brass", [[0, [53, 57, 60, 65], 1, 0.9]]);
  notes(k, out, t1, "tuba", [[0, 41, 1, 0.6]]);
  notes(k, out, t1, "glock", [[0, [89, 93], 0.6, 0.8]]);
  INSTRUMENTS.bassdrum.play(k, out, t1, [], 0.1, 0.6);
  INSTRUMENTS.crash.play(k, out, t1, [], 0.1, 0.8);
  return t1 + 2;
};

// ---------------------------------------------------------------------------------------------

export const SFX: Record<Sfx, SfxDef> = {
  sten: { prio: 2, cap: 6, len: 1, play: sten },
  pistol: { prio: 2, cap: 6, len: 1, play: pistol },
  rifle: { prio: 2, cap: 6, len: 1.2, play: rifle },
  mp40: { prio: 2, cap: 6, len: 1.2, play: mp40 },
  grenade_throw: { prio: 2, cap: 4, len: 0.95, play: grenadeThrow },
  explosion: { prio: 3, cap: 4, len: 4.6, play: explosion },
  explosion_far: { prio: 2, cap: 3, len: 4.6, play: explosionFar },
  bottle_throw: { prio: 2, cap: 4, len: 0.95, play: bottleThrow },
  bottle_smash: { prio: 2, cap: 4, len: 2.4, play: bottleSmash },
  fire_whoosh: { prio: 2, cap: 3, len: 2.3, play: fireWhoosh },
  knife: { prio: 2, cap: 3, len: 0.5, play: knife },
  body_fall: { prio: 2, cap: 4, len: 0.8, play: bodyFall },
  hit: { prio: 2, cap: 6, len: 0.4, play: hitSfx },
  ricochet: { prio: 1, cap: 4, len: 0.9, play: ricochet },
  glass: { prio: 2, cap: 3, len: 1.6, play: glass },
  step: { prio: 1, cap: 6, len: 0.3, play: step },
  whistle: { prio: 3, cap: 2, len: 1.9, play: whistle },
  shout: { prio: 2, cap: 3, len: 1.2, play: shout },
  truck_brake: { prio: 2, cap: 2, len: 1.9, play: truckBrake },
  car_door: { prio: 2, cap: 3, len: 0.75, play: carDoor },
  truck_doors: { prio: 2, cap: 2, len: 2.15, play: truckDoors },
  car_start: { prio: 2, cap: 2, len: 2.7, play: carStart },
  tram_bell: { prio: 2, cap: 2, len: 5, play: tramBell },
  pigeons: { prio: 1, cap: 2, len: 1.9, play: pigeons },
  ui_tap: { prio: 3, cap: 3, len: 0.2, play: uiTap },
  ui_ok: { prio: 3, cap: 2, len: 0.6, play: uiOk },
  ui_back: { prio: 3, cap: 2, len: 0.5, play: uiBack },
  ui_pause: { prio: 3, cap: 2, len: 0.4, play: uiPause },
  ui_go: { prio: 3, cap: 2, len: 0.7, play: uiGo },
  ui_alert: { prio: 3, cap: 2, len: 0.6, play: uiAlert },
  typewriter: { prio: 1, cap: 3, len: 0.2, play: typewriter },
  paper: { prio: 1, cap: 2, len: 0.7, play: paper },
  promotion: { prio: 3, cap: 1, len: 3.7, play: promotion },
  fallen: { prio: 3, cap: 2, len: 3.4, play: fallen },
  mission_done: { prio: 3, cap: 1, len: 4.6, play: missionDone },
};

export interface StartedVoice {
  out: GainNode;
  chain: AudioNode[];
  sources: AudioScheduledSourceNode[];
  end: number;
}

/**
 * Plays a sound through its voice chain (gain, then distance low-pass and pan when x and y
 * are given) into `bus`. Returns null when it would be inaudible (beyond ~70 m).
 */
export function startSfx(k: Kit, bus: AudioNode, name: Sfx, t: number, o: PlayOpts, lx: number, ly: number): StartedVoice | null {
  const def = SFX[name];
  if (!def) return null;
  let g = o.gain ?? 1;
  let pan = 0;
  let cutoff = 0;
  let delay = 0;
  if (o.x !== undefined && o.y !== undefined) {
    const s = spatial(o.x - lx, o.y - ly);
    g *= s.gain;
    pan = s.pan;
    cutoff = s.cutoff;
    delay = s.delay;
  }
  if (!(g > 0.003)) return null;
  const chain: AudioNode[] = [];
  let head: AudioNode = bus;
  if (pan && k.ctx.createStereoPanner) {
    const p = k.ctx.createStereoPanner();
    p.pan.value = pan;
    p.connect(head);
    head = p;
    chain.push(p);
  }
  if (cutoff && cutoff < 16000) {
    head = filter(k, "lowpass", cutoff, 0.5, head);
    chain.push(head);
  }
  const out = gain(k, g, head);
  chain.push(out);
  const outer = k.sources;
  const sources: AudioScheduledSourceNode[] = [];
  k.sources = sources;
  k.until = 0;
  let end = t;
  try {
    // over when the recipe says so, or when its last source stops, whichever is later
    end = Math.max(def.play(k, out, t + delay, { rate: o.rate && o.rate > 0 ? o.rate : 1, rounds: o.rounds }), k.until);
  } finally {
    k.sources = outer;
  }
  return { out, chain, sources, end };
}
