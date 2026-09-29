// Music instruments: small synth voices with a real instrument's character. Chiptune-warm
// leads (pulse, fife), plucked and pizzicato strings, soft brass and horn, a tuba, a musette
// reed (the accordion), a lone piano, a glockenspiel, string pads, and a drum kit with a
// march snare, a clock tick and a pencil. Each call plays one note or chord into `out`.
import { type Kit, adsr, clamp, filter, gain, hit, mtof, noise, osc, vibrato } from "./kit";

export interface Instrument {
  /** Playable MIDI range; the score test keeps every note inside it. */
  range: [number, number];
  /** Percussion: written as a hit grid; a pitch is optional. */
  perc?: boolean;
  play(k: Kit, out: AudioNode, t: number, midis: number[], dur: number, vel: number): void;
}

// ---------------------------------------------------------------------------------------------
// Leads

const fife: Instrument = {
  range: [60, 100],
  play(k, out, t, midis, dur, vel) {
    for (const m of midis) {
      const f = mtof(m);
      const g = gain(k, 0, out);
      const lp = filter(k, "lowpass", Math.min(10000, f * 5), 0.6, g);
      const end = adsr(g.gain, t, dur, 0.2 * vel, 0.015, 0.1, 0.72, 0.06);
      const o = osc(k, "fife", f, t, end, lp);
      if (dur > 0.28) vibrato(k, t + 0.12, end, 5.6, 14).connect(o.detune);
      // the breath "chiff" at the start of each note
      const b = gain(k, 0, out);
      hit(b.gain, t, 0.05 * vel, 0.025, 0.004);
      noise(k, "white", t, t + 0.15, filter(k, "bandpass", f * 2, 1.2, b));
    }
  },
};

const pulse: Instrument = {
  range: [48, 100],
  play(k, out, t, midis, dur, vel) {
    for (const m of midis) {
      const f = mtof(m);
      const g = gain(k, 0, out);
      const lp = filter(k, "lowpass", Math.min(9000, f * 5), 0.9, g);
      const end = adsr(g.gain, t, dur, 0.13 * vel, 0.004, 0.12, 0.65, 0.05);
      const o = osc(k, "pulse25", f, t, end, lp);
      if (dur > 0.3) vibrato(k, t + 0.15, end, 6, 10).connect(o.detune);
    }
  },
};

// ---------------------------------------------------------------------------------------------
// Plucked strings

function plucked(range: [number, number], level: number, bright: number, ring: number): Instrument {
  return {
    range,
    play(k, out, t, midis, dur, vel) {
      for (const m of midis) {
        const f = mtof(m);
        const g = gain(k, 0, out);
        const lp = filter(k, "lowpass", Math.min(12000, f * bright), 1.1, g);
        lp.frequency.setValueAtTime(Math.min(12000, f * bright), t);
        lp.frequency.exponentialRampToValueAtTime(Math.max(300, f * 1.5), t + 0.18);
        const tau = ring * (0.12 + 30 / f);
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(level * vel, t + 0.002);
        g.gain.setTargetAtTime(0, t + 0.002, tau);
        const off = t + Math.max(dur, 0.06);
        g.gain.setTargetAtTime(0, off, 0.03);
        osc(k, "sawtooth", f, t, Math.min(off + 0.25, t + tau * 7), lp);
      }
    },
  };
}

const pluck = plucked([40, 90], 0.2, 10, 1);
const pizz = plucked([36, 86], 0.2, 6, 0.6);

// ---------------------------------------------------------------------------------------------
// Brass

function brassy(range: [number, number], level: number, bright: number, attack: number, vib: boolean): Instrument {
  return {
    range,
    play(k, out, t, midis, dur, vel) {
      const g = gain(k, 0, out);
      const end = adsr(g.gain, t, dur, (level * vel) / Math.sqrt(midis.length), attack, 0.2, 0.8, 0.1);
      const vb = vib && dur > 0.4 ? vibrato(k, t + 0.2, end, 5.2, 9) : null;
      for (const m of midis) {
        const f = mtof(m);
        const lp = filter(k, "lowpass", f * 1.2, 1, g);
        const top = Math.min(9000, Math.max(520, f * bright * (0.6 + 0.6 * vel)));
        lp.frequency.setValueAtTime(Math.max(200, f * 1.2), t);
        lp.frequency.linearRampToValueAtTime(top, t + attack * 1.5);
        lp.frequency.exponentialRampToValueAtTime(top * 0.75, t + attack * 1.5 + 0.5);
        const o1 = osc(k, "sawtooth", f, t, end, lp, -6);
        const o2 = osc(k, "sawtooth", f, t, end, lp, 6);
        if (vb) {
          vb.connect(o1.detune);
          vb.connect(o2.detune);
        }
      }
    },
  };
}

const brass = brassy([40, 86], 0.16, 4, 0.035, true);
const horn = brassy([40, 80], 0.15, 2.6, 0.07, true);
const tuba = brassy([28, 60], 0.17, 5, 0.025, false);

// ---------------------------------------------------------------------------------------------
// Reed (a musette accordion: two reeds per note, the second tuned a little sharp)

const reed: Instrument = {
  range: [48, 90],
  play(k, out, t, midis, dur, vel) {
    const g = gain(k, 0, out);
    const lp = filter(k, "lowpass", 3000, 0.7, g);
    const pk = filter(k, "peaking", 1400, 1, lp);
    pk.gain.value = 5;
    const end = adsr(g.gain, t, dur, (0.09 * vel) / Math.sqrt(midis.length), 0.02, 0.12, 0.85, 0.06);
    for (const m of midis) {
      const f = mtof(m);
      osc(k, "reed", f, t, end, pk);
      osc(k, "reed", f, t, end, pk, 9);
    }
  },
};

// ---------------------------------------------------------------------------------------------
// Piano (two slightly detuned strings, a darkening filter, a two-stage decay and a hammer)

const piano: Instrument = {
  range: [21, 108],
  play(k, out, t, midis, dur, vel) {
    for (const m of midis) {
      const f = mtof(m);
      const g = gain(k, 0, out);
      const lp = filter(k, "lowpass", Math.min(14000, f * (6 + 8 * vel)), 0.5, g);
      lp.frequency.setValueAtTime(Math.min(14000, f * (6 + 8 * vel)), t);
      lp.frequency.exponentialRampToValueAtTime(Math.max(f * 2.2, 700), t + 1.2);
      const tau = clamp(1.4 * Math.pow(262 / f, 0.5), 0.3, 3.2);
      const peak = 0.2 * vel;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(peak, t + 0.003);
      g.gain.setTargetAtTime(peak * 0.45, t + 0.003, 0.08);
      g.gain.setTargetAtTime(0, t + 0.12, tau);
      const off = t + Math.max(dur, 0.12);
      g.gain.setTargetAtTime(0, off, 0.1);
      const end = Math.min(off + 0.6, t + 0.12 + tau * 7);
      osc(k, "piano", f, t, end, lp, -1.5);
      osc(k, "piano", f, t, end, lp, 2);
      const h = gain(k, 0, out);
      hit(h.gain, t, 0.035 * vel, 0.006);
      noise(k, "white", t, t + 0.05, filter(k, "bandpass", Math.min(6000, f * 6), 0.8, h));
    }
  },
};

// ---------------------------------------------------------------------------------------------
// Glockenspiel (a bar's inharmonic partials)

const glock: Instrument = {
  range: [67, 108],
  play(k, out, t, midis, _dur, vel) {
    for (const m of midis) {
      const f = mtof(m);
      for (const [r, a, tau] of [[1, 1, 0.45], [2.76, 0.32, 0.1], [5.4, 0.12, 0.03]]) {
        const g = gain(k, 0, out);
        osc(k, "sine", f * r, t, hit(g.gain, t, 0.09 * vel * a, tau, 0.0015), g);
      }
    }
  },
};

// ---------------------------------------------------------------------------------------------
// Bowed strings

const strings: Instrument = {
  range: [36, 96],
  play(k, out, t, midis, dur, vel) {
    const g = gain(k, 0, out);
    const lp = filter(k, "lowpass", 1200 + 1200 * vel, 0.5, g);
    const end = adsr(g.gain, t, dur, (0.075 * vel) / Math.sqrt(midis.length), 0.4, 0.6, 0.9, 0.9);
    for (const m of midis) {
      const f = mtof(m);
      osc(k, "sawtooth", f, t, end, lp, -8);
      osc(k, "sawtooth", f, t, end, lp, 7);
    }
  },
};

/** Strings bowed in fast tremolo: the tension layer. */
const trem: Instrument = {
  range: [40, 92],
  play(k, out, t, midis, dur, vel) {
    const g = gain(k, 0, out);
    const am = gain(k, 0.5, g);
    const lp = filter(k, "lowpass", 2400, 0.6, am);
    const end = adsr(g.gain, t, dur, (0.1 * vel) / Math.sqrt(midis.length), 0.15, 0.3, 0.9, 0.4);
    const depth = gain(k, 0.5);
    depth.connect(am.gain);
    osc(k, "triangle", 11.5 + k.rnd(), t, end, depth);
    for (const m of midis) {
      const f = mtof(m);
      osc(k, "sawtooth", f, t, end, lp, -6);
      osc(k, "sawtooth", f, t, end, lp, 6);
    }
  },
};

// ---------------------------------------------------------------------------------------------
// Bass

const bass: Instrument = {
  range: [26, 64],
  play(k, out, t, midis, dur, vel) {
    for (const m of midis) {
      const f = mtof(m);
      const g = gain(k, 0, out);
      const lp = filter(k, "lowpass", f * 8, 4, g);
      lp.frequency.setValueAtTime(Math.min(8000, f * (8 + 10 * vel)), t);
      lp.frequency.exponentialRampToValueAtTime(Math.max(f * 3, 350), t + 0.2);
      const end = adsr(g.gain, t, dur, 0.15 * vel, 0.004, 0.14, 0.6, 0.05);
      osc(k, "sawtooth", f, t, end, lp);
      osc(k, "triangle", f, t, end, g);
    }
  },
};

// ---------------------------------------------------------------------------------------------
// Drums

const ANY: [number, number] = [0, 127];

const kick: Instrument = {
  range: ANY,
  perc: true,
  play(k, out, t, _m, _d, vel) {
    const g = gain(k, 0, out);
    const end = hit(g.gain, t, 0.42 * vel, 0.07);
    const o = osc(k, "sine", 155, t, end, g);
    o.frequency.setValueAtTime(155, t);
    o.frequency.exponentialRampToValueAtTime(48, t + 0.09);
    const c = gain(k, 0, out);
    hit(c.gain, t, 0.12 * vel, 0.004);
    noise(k, "white", t, t + 0.03, filter(k, "highpass", 1800, 0.7, c));
  },
};

/** The concert bass drum of a street band. */
const bassdrum: Instrument = {
  range: ANY,
  perc: true,
  play(k, out, t, _m, _d, vel) {
    const g = gain(k, 0, out);
    const end = hit(g.gain, t, 0.35 * vel, 0.18, 0.004);
    const o = osc(k, "sine", 95, t, end, g);
    o.frequency.setValueAtTime(95, t);
    o.frequency.exponentialRampToValueAtTime(52, t + 0.12);
    const f = gain(k, 0, out);
    hit(f.gain, t, 0.25 * vel, 0.06);
    noise(k, "brown", t, t + 0.4, filter(k, "lowpass", 250, 0.7, f));
    const mid = gain(k, 0, out);
    hit(mid.gain, t, 0.3 * vel, 0.05);
    noise(k, "pink", t, t + 0.35, filter(k, "bandpass", 300, 1.2, mid));
  },
};

const snare: Instrument = {
  range: ANY,
  perc: true,
  play(k, out, t, _m, _d, vel) {
    const w = gain(k, 0, out);
    hit(w.gain, t, 0.32 * vel, 0.055 + 0.03 * vel);
    const hp = filter(k, "highpass", 1700, 0.7, w);
    const pk = filter(k, "peaking", 4800, 1, hp);
    pk.gain.value = 4;
    noise(k, "white", t, t + 0.6, pk);
    const b = gain(k, 0, out);
    hit(b.gain, t, 0.28 * vel, 0.035);
    const o = osc(k, "triangle", 210, t, t + 0.3, b);
    o.frequency.setValueAtTime(210, t);
    o.frequency.exponentialRampToValueAtTime(165, t + 0.05);
    const s = gain(k, 0, out);
    hit(s.gain, t, 0.18 * vel, 0.018);
    noise(k, "white", t, t + 0.15, filter(k, "bandpass", 950, 1.3, s));
  },
};

function noiseHit(type: BiquadFilterType, f: number, q: number, level: number, tau: number, a = 0): Instrument {
  return {
    range: ANY,
    perc: true,
    play(k, out, t, _m, _d, vel) {
      const g = gain(k, 0, out);
      const end = hit(g.gain, t, level * vel, tau, a);
      noise(k, "white", t, end, filter(k, type, f, q, g));
    },
  };
}

const hat = noiseHit("highpass", 7000, 0.8, 0.12, 0.015);
const ohat = noiseHit("highpass", 6500, 0.8, 0.1, 0.12);
const shaker = noiseHit("bandpass", 5500, 1, 0.09, 0.03, 0.012);

const crash: Instrument = {
  range: ANY,
  perc: true,
  play(k, out, t, _m, _d, vel) {
    const g = gain(k, 0, out);
    noise(k, "white", t, hit(g.gain, t, 0.16 * vel, 0.5), filter(k, "highpass", 3800, 0.6, g));
    const g2 = gain(k, 0, out);
    noise(k, "white", t, hit(g2.gain, t, 0.07 * vel, 0.6), filter(k, "bandpass", 6500, 0.9, g2));
  },
};

/** A clock's escapement: a woody tick at the written pitch. */
const tick: Instrument = {
  range: [60, 110],
  perc: true,
  play(k, out, t, midis, _d, vel) {
    const f = mtof(midis[0] ?? 100);
    const g = gain(k, 0, out);
    osc(k, "sine", f, t, hit(g.gain, t, 0.08 * vel, 0.008), g);
    const n = gain(k, 0, out);
    noise(k, "white", t, hit(n.gain, t, 0.22 * vel, 0.006), filter(k, "bandpass", f * 1.3, 4, n));
  },
};

const timp: Instrument = {
  range: [33, 60],
  perc: true,
  play(k, out, t, midis, _d, vel) {
    const f = mtof(midis[0] ?? 38);
    const g = gain(k, 0, out);
    const o = osc(k, "sine", f * 1.04, t, hit(g.gain, t, 0.25 * vel, 0.55, 0.003), g);
    o.frequency.setTargetAtTime(f, t, 0.06);
    const g2 = gain(k, 0, out);
    osc(k, "sine", f * 1.5, t, hit(g2.gain, t, 0.14 * vel, 0.35, 0.003), g2);
    const g3 = gain(k, 0, out);
    osc(k, "sine", f * 2, t, hit(g3.gain, t, 0.08 * vel, 0.25, 0.003), g3);
    const m = gain(k, 0, out);
    noise(k, "brown", t, hit(m.gain, t, 0.3 * vel, 0.03), filter(k, "lowpass", 700, 0.7, m));
  },
};

/** A low, muffled drum (snares off): the heartbeat, the funeral roll. */
const tom: Instrument = {
  range: [30, 70],
  perc: true,
  play(k, out, t, midis, _d, vel) {
    const f = midis.length ? mtof(midis[0]) : 110;
    const g = gain(k, 0, out);
    const o = osc(k, "sine", f * 1.4, t, hit(g.gain, t, 0.3 * vel, 0.12), g);
    o.frequency.setValueAtTime(f * 1.4, t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.06);
    const n = gain(k, 0, out);
    noise(k, "white", t, hit(n.gain, t, 0.22 * vel, 0.04), filter(k, "bandpass", 420, 1.1, n));
  },
};

/** A pencil scribbling a note on the sketch map. */
const pencil: Instrument = {
  range: ANY,
  perc: true,
  play(k, out, t, _m, _d, vel) {
    const g = gain(k, 0, out);
    const bp = filter(k, "bandpass", 3200, 1.4, g);
    const hp = filter(k, "highpass", 1400, 0.7, bp);
    let tt = t;
    const strokes = 4 + Math.floor(k.rnd() * 4);
    for (let i = 0; i < strokes; i++) {
      const len = 0.03 + k.rnd() * 0.05;
      bp.frequency.setValueAtTime(2400 + k.rnd() * 2200, tt);
      g.gain.setTargetAtTime(0.07 * vel * (0.5 + k.rnd()), tt, 0.006);
      g.gain.setTargetAtTime(0, tt + len, 0.01);
      tt += len + 0.01 + k.rnd() * 0.03;
    }
    noise(k, "pink", t, tt + 0.1, hp);
  },
};

export const INSTRUMENTS = {
  fife, pulse, pluck, pizz, brass, horn, tuba, reed, piano, glock, strings, trem, bass,
  kick, bassdrum, snare, hat, ohat, shaker, crash, tick, timp, tom, pencil,
} satisfies Record<string, Instrument>;
export type InstrumentId = keyof typeof INSTRUMENTS;
