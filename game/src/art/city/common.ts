// Shared helpers for the city generators (ground, tenements, the Arsenal). Pure functions,
// colours only from docs/art/palette.json.
import type { RGB, Ramp } from "../palette";
import { PAL, ramp } from "../palette";
import type { PixelImage } from "../pixel";
import { hash2 } from "../pixel";
import type { PlasterKind, RoofKind } from "../types";

// ------------------------------------------------------------------ packed colours (fast paths)

const LITTLE = new Uint8Array(new Uint32Array([0x01020304]).buffer)[0] === 0x04;
/** An opaque RGB as one 32-bit word in the byte order of a Uint32Array over RGBA data. */
export function pack(c: RGB): number {
  return LITTLE ? ((255 << 24) | (c[2] << 16) | (c[1] << 8) | c[0]) >>> 0 : ((c[0] << 24) | (c[1] << 16) | (c[2] << 8) | 255) >>> 0;
}
export function words(im: PixelImage): Uint32Array {
  return new Uint32Array(im.data.buffer, im.data.byteOffset, im.w * im.h);
}
/** Signed variant for hot loops: with alpha 255 in the top byte the value is a small
 *  negative int, which V8 keeps unboxed (a uint32 above 2^31 would be a heap double). */
export function packI(c: RGB): number {
  return pack(c) | 0;
}
export function wordsI(im: PixelImage): Int32Array {
  return new Int32Array(im.data.buffer, im.data.byteOffset, im.w * im.h);
}

/** 4x4 Bayer thresholds 0..15 (style guide §4: dither only ground and foliage). */
export const BAYER16 = new Uint8Array([0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]);

// ------------------------------------------------------------------ value noise texture

export const NOISE_BITS = 8;
export const NOISE_N = 1 << NOISE_BITS; // 256, tileable
let noise: Uint8Array | null = null;

/** A 256 x 256 tileable value-noise texture with an even histogram (every value 0..255
 *  about equally common), built once from hash2. Sampled with seed offsets, so patterns
 *  never line up with the metre grid. */
export function noiseTex(): Uint8Array {
  if (noise) return noise;
  const N = NOISE_N;
  const acc = new Float32Array(N * N);
  const octaves: [number, number][] = [[64, 0.5], [32, 0.27], [16, 0.15], [8, 0.08]];
  // separable bilinear value noise: per column and per row the lattice cells and smoothstep
  // weights are computed once, the inner loop is four loads and a few multiplies
  const i0s = new Int32Array(N), i1s = new Int32Array(N), sxs = new Float32Array(N);
  for (const [period, amp] of octaves) {
    const cells = N / period;
    const lat = new Float32Array(cells * cells);
    for (let j = 0; j < cells; j++) for (let i = 0; i < cells; i++) lat[j * cells + i] = hash2(i, j, 7919 + period) * amp;
    for (let x = 0; x < N; x++) {
      const i0 = Math.floor(x / period), f = x / period - i0;
      i0s[x] = i0; i1s[x] = (i0 + 1) % cells; sxs[x] = f * f * (3 - 2 * f);
    }
    for (let y = 0; y < N; y++) {
      const j0 = Math.floor(y / period), f = y / period - j0, sy = f * f * (3 - 2 * f);
      const r0 = j0 * cells, r1 = ((j0 + 1) % cells) * cells, o = y * N;
      for (let x = 0; x < N; x++) {
        const i0 = i0s[x], i1 = i1s[x], sx = sxs[x];
        const top = lat[r0 + i0] + (lat[r0 + i1] - lat[r0 + i0]) * sx;
        const bot = lat[r1 + i0] + (lat[r1 + i1] - lat[r1 + i0]) * sx;
        acc[o + x] += top + (bot - top) * sy;
      }
    }
  }
  // Equalise through a 4096-bin histogram: value -> its rank -> 0..255, so a threshold t
  // passes about t/256 of the texture.
  const BINS = 4096, total = N * N;
  const bin = new Uint16Array(total), count = new Uint32Array(BINS), mid = new Uint8Array(BINS);
  for (let i = 0; i < total; i++) {
    const b = Math.min(BINS - 1, Math.max(0, Math.floor(acc[i] * BINS)));
    bin[i] = b;
    count[b]++;
  }
  for (let b = 0, below = 0; b < BINS; b++) {
    mid[b] = Math.min(255, Math.floor(((below + count[b] / 2) * 256) / total));
    below += count[b];
  }
  const out = new Uint8Array(total);
  for (let i = 0; i < total; i++) out[i] = mid[bin[i]];
  noise = out;
  return out;
}

let lump: Uint8Array | null = null;
/** Lumpy relief for snow and slush, 256 x 256: 0 = a hollow in shade, 1 = flat, 2 = the lit
 *  top-left of a lump (an emboss of the noise texture, light from the top left). */
export function lumpTex(): Uint8Array {
  if (lump) return lump;
  const N = NOISE_N, nt = noiseTex();
  const out = new Uint8Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const e = nt[y * N + x] - nt[((y + 1) & (N - 1)) * N + ((x + 1) & (N - 1))];
    out[y * N + x] = e > 11 ? 2 : e < -11 ? 0 : 1;
  }
  lump = out;
  return out;
}

/** Deterministic integer hash of two ints and a salt, 0..65535 (cheap, for per-pixel use). */
export function ihash(x: number, y: number, s: number): number {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(s, 0x3c6ef372);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= h >>> 13;
  return (h >>> 8) & 0xffff;
}

// ------------------------------------------------------------------ materials

const C = PAL.city_1943;

/** Facade ramp (dark, mid, light) for a plaster kind. */
export function wallRamp(kind: PlasterKind): Ramp {
  switch (kind) {
    case "ochre": return C.plaster_ochre;
    case "green": return C.plaster_green;
    case "cream": return C.plaster_cream;
    case "brick": return C.brick;
    case "stone": return C.stone_grey;
  }
}

/** Trim ramp (surrounds, cornices, sills): plastered houses use their own light tones,
 *  brick houses get stone trims, stone houses a lighter stone. */
export function trimRamp(kind: PlasterKind): Ramp {
  switch (kind) {
    case "brick": return C.plaster_cream;
    case "stone": return C.stone_grey;
    case "cream": return C.plaster_cream;
    case "green": return C.plaster_cream;
    case "ochre": return C.plaster_ochre;
  }
}

export function roofRamp(kind: RoofKind): Ramp {
  switch (kind) {
    case "tin": return C.tin_roof;
    case "tar": return C.soot;
    case "tile": return C.brick;
  }
}

/** Colours this module adds to the palette (docs/art/palette.json, group city_extra). */
export const X = {
  earth: () => ramp("city_extra", "earth"),
  deadGrass: () => ramp("city_extra", "dead_grass"),
  paintGreen: () => ramp("city_extra", "paint_green"),
};
