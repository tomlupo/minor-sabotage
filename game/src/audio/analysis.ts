// Measuring a render, since nobody can listen in a headless browser. Pure functions over
// sample arrays, so the tests check them in Node.
//
// loudDb is the loudest 100 ms (a momentary loudness, flat); phoneDb is the same through a
// phone speaker's band (350 Hz to 12 kHz), which is what an iPhone held sideways can play.

export interface Stats {
  /** Seconds until the last sample above -60 dBFS. */
  dur: number;
  peak: number;
  /** Peak of the sum before the limiter (above 1 means the limiter or clipper worked). */
  peakPre: number;
  rmsDb: number;
  loudDb: number;
  phoneDb: number;
  /** Spectral centroid in Hz. */
  centroid: number;
  clips: boolean;
  silent: boolean;
}

const db = (x: number) => (x > 1e-9 ? 20 * Math.log10(x) : -180);

/** RBJ biquad coefficients, normalised. */
function biquad(type: "highpass" | "lowpass", f: number, sr: number, q = Math.SQRT1_2): number[] {
  const w = (2 * Math.PI * f) / sr;
  const cos = Math.cos(w);
  const alpha = Math.sin(w) / (2 * q);
  const a0 = 1 + alpha;
  const b =
    type === "lowpass"
      ? [(1 - cos) / 2, 1 - cos, (1 - cos) / 2]
      : [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2];
  return [b[0] / a0, b[1] / a0, b[2] / a0, (-2 * cos) / a0, (1 - alpha) / a0];
}

function runBiquad(x: Float32Array, c: number[]): Float32Array {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = c[0] * x[i] + c[1] * x1 + c[2] * x2 - c[3] * y1 - c[4] * y2;
    x2 = x1;
    x1 = x[i];
    y2 = y1;
    y1 = v;
    y[i] = v;
  }
  return y;
}

/** Loudest RMS over `win`-second windows (hop win/4), mean-square over the channels. */
function momentary(chs: Float32Array[], sr: number, end: number, win = 0.1): number {
  const w = Math.max(1, Math.floor(sr * win));
  const hop = Math.max(1, Math.floor(w / 4));
  let best = 0;
  for (let s = 0; s < Math.max(1, end - w + 1); s += hop) {
    let ss = 0;
    const e = Math.min(end, s + w);
    for (const c of chs) for (let i = s; i < e; i++) ss += c[i] * c[i];
    best = Math.max(best, ss / (w * chs.length));
  }
  return Math.sqrt(best);
}

/** In-place radix-2 FFT. */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const a = i + j;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

/** Magnitude-weighted mean frequency over Hann-windowed frames. */
export function centroid(x: Float32Array, sr: number, end = x.length): number {
  const N = 2048;
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  const mag = new Float64Array(N / 2);
  for (let s = 0; s < Math.max(1, end - N + 1); s += N / 2) {
    for (let i = 0; i < N; i++) {
      const v = s + i < end ? x[s + i] : 0;
      re[i] = v * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
      im[i] = 0;
    }
    fft(re, im);
    for (let b = 0; b < N / 2; b++) mag[b] += Math.hypot(re[b], im[b]);
  }
  let num = 0;
  let den = 0;
  for (let b = 1; b < N / 2; b++) {
    num += ((b * sr) / N) * mag[b];
    den += mag[b];
  }
  return den > 0 ? num / den : 0;
}

/**
 * Energy per pitch class (0 = C .. 11 = B) between 110 Hz and 1.8 kHz, summing to 1: what key
 * the music is actually sounding in, heard from the render rather than read from the score.
 */
export function chroma(x: Float32Array, sr: number): number[] {
  const N = 8192;
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  const pc = new Array<number>(12).fill(0);
  const lo = Math.ceil((110 * N) / sr);
  const hi = Math.floor((1800 * N) / sr);
  for (let s = 0; s + N <= x.length; s += N / 2) {
    for (let i = 0; i < N; i++) {
      re[i] = x[s + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
      im[i] = 0;
    }
    fft(re, im);
    for (let b = lo; b <= hi; b++) {
      const midi = 69 + 12 * Math.log2((b * sr) / N / 440);
      pc[((Math.round(midi) % 12) + 12) % 12] += re[b] * re[b] + im[b] * im[b];
    }
  }
  const sum = pc.reduce((a, b) => a + b, 0) || 1;
  return pc.map((v) => v / sum);
}

export function analyse(post: Float32Array[], sr: number, pre: Float32Array[] = []): Stats {
  const n = post[0].length;
  let peak = 0;
  let last = -1;
  for (const c of post)
    for (let i = 0; i < n; i++) {
      const a = Math.abs(c[i]);
      if (a > peak) peak = a;
      if (a > 0.001 && i > last) last = i;
    }
  let peakPre = 0;
  for (const c of pre) for (let i = 0; i < c.length; i++) peakPre = Math.max(peakPre, Math.abs(c[i]));
  const end = Math.max(1, last + 1);
  let ss = 0;
  for (const c of post) for (let i = 0; i < end; i++) ss += c[i] * c[i];
  const mono = new Float32Array(end);
  for (const c of post) for (let i = 0; i < end; i++) mono[i] += c[i] / post.length;
  const hp = biquad("highpass", 350, sr);
  const lp = biquad("lowpass", 12000, sr);
  const phone = post.map((c) => runBiquad(runBiquad(runBiquad(c.subarray(0, end), hp), hp), lp));
  return {
    dur: end / sr,
    peak,
    peakPre,
    rmsDb: db(Math.sqrt(ss / (end * post.length))),
    loudDb: db(momentary(post, sr, end)),
    phoneDb: db(momentary(phone, sr, end)),
    centroid: centroid(mono, sr),
    clips: peak >= 0.99,
    silent: peak < 0.003,
  };
}
