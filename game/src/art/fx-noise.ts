// Smooth value noise for the art generators (scorch and rust on vehicles, smoke, dust, snow):
// a fixed permutation table built from a seeded PRNG, so it is fast, deterministic and the same
// in the browser and in Node.
import { rng } from "./pixel";

const PERM = new Uint8Array(512);
const VAL = new Float32Array(256);
{
  const r = rng(1943);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    const t = p[i]; p[i] = p[j]; p[j] = t;
  }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
  for (let i = 0; i < 256; i++) VAL[i] = r();
}

/** 3D value noise in [0, 1), smooth between integer lattice points; `seed` shifts the field. */
export function vnoise(x: number, y: number, z: number, seed = 0): number {
  x += seed * 17.13;
  y += seed * 7.31;
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const fx = x - xi, fy = y - yi, fz = z - zi;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
  const X = xi & 255, Y = yi & 255, Z = zi & 255;
  const a = PERM[X] + Y, aa = PERM[a] + Z, ab = PERM[a + 1] + Z;
  const b = PERM[X + 1] + Y, ba = PERM[b] + Z, bb = PERM[b + 1] + Z;
  const x00 = VAL[PERM[aa]] + (VAL[PERM[ba]] - VAL[PERM[aa]]) * u;
  const x10 = VAL[PERM[ab]] + (VAL[PERM[bb]] - VAL[PERM[ab]]) * u;
  const x01 = VAL[PERM[aa + 1]] + (VAL[PERM[ba + 1]] - VAL[PERM[aa + 1]]) * u;
  const x11 = VAL[PERM[ab + 1]] + (VAL[PERM[bb + 1]] - VAL[PERM[ab + 1]]) * u;
  const y0 = x00 + (x10 - x00) * v, y1 = x01 + (x11 - x01) * v;
  return y0 + (y1 - y0) * w;
}

/** Two octaves of value noise, roughly in [0, 1). */
export function fbm(x: number, y: number, z: number, seed = 0): number {
  return vnoise(x, y, z, seed) * 0.66 + vnoise(x * 2.03, y * 2.03, z * 2.03, seed + 31) * 0.34;
}
