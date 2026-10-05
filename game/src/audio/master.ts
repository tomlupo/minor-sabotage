// The mix bus: music (with its reverb, a bass shelf and the duck stage) and sound effects
// (with ambience under them) meet in `sum`, pass a sub-sonic high-pass, a peak limiter and a
// soft clipper that can never output more than 0.97, then the mute gain.
//
//   cue players, reverb ─► musicIn ─► bass shelf ─► music (volume) ─► duck ──┐
//   voices, ambience ─► sfx (volume) ─────────────────────────────────────────┴─► sum
//   sum ─► high-pass 32 Hz ─► limiter ─► soft clip ─► out (mute) ─► speakers
import { type Kit, filter, gain, mulberry } from "./kit";

export const DEFAULT_MUSIC = 0.6;
export const DEFAULT_SFX = 1;

export interface Master {
  /** Every bus summed, before the limiter (the lab taps it to see how hard the limiter works). */
  sum: GainNode;
  musicIn: GainNode;
  /** Reverb send for music tracks. */
  verb: GainNode;
  music: GainNode;
  duck: GainNode;
  sfx: GainNode;
  amb: GainNode;
  out: GainNode;
}

function stereo(n: AudioNode): void {
  n.channelCount = 2;
  n.channelCountMode = "explicit";
  n.channelInterpretation = "speakers";
}

export function buildMaster(k: Kit, dest: AudioNode): Master {
  const ctx = k.ctx;
  const out = gain(k, 1, dest);
  stereo(out);
  const clip = ctx.createWaveShaper();
  clip.curve = softClipCurve();
  clip.oversample = "none";
  clip.connect(out);
  // the shaper's input is clamped to ±1, so it is fed at half level and its curve doubles
  // back: overshoots up to 2.0 saturate smoothly instead of hitting a hard clamp
  const pad = gain(k, 0.5, clip);
  const lim = ctx.createDynamicsCompressor();
  lim.threshold.value = -4;
  lim.knee.value = 1;
  lim.ratio.value = 20;
  lim.attack.value = 0.001;
  lim.release.value = 0.12;
  lim.connect(pad);
  const hp = filter(k, "highpass", 32, 0.6, lim);
  const sum = gain(k, 1, hp);
  stereo(sum);

  const duck = gain(k, 1, sum);
  const music = gain(k, DEFAULT_MUSIC, duck);
  // Music is written for a phone speaker's band; its bass is shelved down so that on
  // headphones it never sits on top of the gunfire.
  const shelf = filter(k, "lowshelf", 150, 0.7, music);
  shelf.gain.value = -5;
  const musicIn = gain(k, 1, shelf);
  stereo(musicIn);
  const verb = gain(k, 1);
  const conv = ctx.createConvolver();
  conv.normalize = false;
  conv.buffer = reverbIR(ctx);
  verb.connect(conv);
  conv.connect(musicIn);

  const sfx = gain(k, DEFAULT_SFX, sum);
  stereo(sfx);
  const amb = gain(k, 0.9, sfx);
  return { sum, musicIn, verb, music, duck, sfx, amb, out };
}

/**
 * For an input fed at half level: identity up to 0.8, then a tanh knee that approaches 0.97.
 * At the curve's end (an input of 2.0) it is 0.97, so the output never reaches 0.99.
 */
export function softClipCurve(): Float32Array<ArrayBuffer> {
  const n = 8192;
  const c = new Float32Array(n);
  const knee = 0.8;
  const room = 0.17;
  for (let i = 0; i < n; i++) {
    const x = ((i / (n - 1)) * 2 - 1) * 2;
    const ax = Math.abs(x);
    const y = ax <= knee ? ax : knee + room * Math.tanh((ax - knee) / room);
    c[i] = Math.sign(x) * y;
  }
  return c;
}

/** A small room: stereo-decorrelated noise, darker as it decays, unit energy per channel. */
function reverbIR(ctx: BaseAudioContext, sec = 1.5): AudioBuffer {
  const sr = ctx.sampleRate;
  const n = Math.floor(sr * sec);
  const pre = Math.floor(sr * 0.012);
  const b = ctx.createBuffer(2, n, sr);
  for (let ch = 0; ch < 2; ch++) {
    const r = mulberry(101 + ch);
    const d = b.getChannelData(ch);
    let lp = 0;
    let ss = 0;
    for (let i = pre; i < n; i++) {
      const t = (i - pre) / sr;
      const a = 0.85 * Math.exp(-t * 2.2) + 0.08;
      lp += a * (r() * 2 - 1 - lp);
      const v = lp * Math.exp((-6.9 * t) / (sec - 0.012));
      d[i] = v;
      ss += v * v;
    }
    const g = 1 / Math.sqrt(ss || 1);
    for (let i = 0; i < n; i++) d[i] *= g;
  }
  return b;
}
