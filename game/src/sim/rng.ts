// Seeded random numbers for the rules. The sim never calls Math.random, so a snapshot plus
// the same inputs replays exactly (resume after the phone is locked, headless tests).

export interface RngState {
  s: number;
}

export function makeRng(seed: number): RngState {
  return { s: seed >>> 0 || 0x9e3779b9 };
}

/** mulberry32: a float in [0, 1). Mutates the state. */
export function rnd(r: RngState): number {
  r.s = (r.s + 0x6d2b79f5) | 0;
  let t = Math.imul(r.s ^ (r.s >>> 15), 1 | r.s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function rndRange(r: RngState, a: number, b: number): number {
  return a + (b - a) * rnd(r);
}

export function rndInt(r: RngState, n: number): number {
  return Math.floor(rnd(r) * n);
}

export function chance(r: RngState, p: number): boolean {
  return rnd(r) < p;
}

/** Approximately normal, mean 0, sd 1 (sum of uniforms). */
export function gauss(r: RngState): number {
  return rnd(r) + rnd(r) + rnd(r) + rnd(r) - 2;
}
