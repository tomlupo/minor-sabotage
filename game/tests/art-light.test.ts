// Light and dither (style guide §4, §5): a pool of light is three stepped bands with a dithered
// seam between them, never a smooth glow; smoke and dust are never dithered (dither is for the
// ground and foliage only).
import { describe, expect, it } from "vitest";
import { buildLightPool, buildPalettePool, POOL_BANDS } from "../src/art/light";
import { buildFxSheet } from "../src/art/fx";
import { PAL } from "../src/art/palette";
import type { PixelImage, Sheet } from "../src/art/pixel";

const alphaAt = (im: PixelImage, x: number, y: number) => im.data[(y * im.w + x) * 4 + 3];

describe("light pools", () => {
  const pool = buildPalettePool("fire");
  const rx = PAL.light.pool.fire.radius_m! * 12, ry = PAL.light.pool.fire.radius_m! * 9;
  const levels = POOL_BANDS.map((b) => Math.round(b.alpha * 255));

  it("reaches as far as the palette says, in its colour", () => {
    const c = PAL.light.pool.fire.rgb.map((v) => Math.round(v * 255));
    let x0 = pool.w, x1 = -1, y0 = pool.h, y1 = -1;
    for (let y = 0; y < pool.h; y++) for (let x = 0; x < pool.w; x++) {
      const o = (y * pool.w + x) * 4;
      if (!pool.data[o + 3]) continue;
      expect([pool.data[o], pool.data[o + 1], pool.data[o + 2]]).toEqual(c);
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    expect(Math.abs((x1 - x0 + 1) / 2 - rx)).toBeLessThanOrEqual(3);
    expect(Math.abs((y1 - y0 + 1) / 2 - ry)).toBeLessThanOrEqual(3);
  });

  it("adds light in three steps, and only those (never a smooth ramp)", () => {
    const seen = new Set<number>();
    for (let i = 3; i < pool.data.length; i += 4) if (pool.data[i]) seen.add(pool.data[i]);
    expect([...seen].sort((a, b) => a - b)).toEqual([...levels].sort((a, b) => a - b));
  });

  it("is brightest in the middle and steps down outward", () => {
    const cy = pool.h / 2, cx = pool.w / 2;
    const at = (k: number) => alphaAt(pool, Math.floor(cx + k * rx), Math.floor(cy));
    expect(at(0)).toBe(levels[0]);
    expect(at(0.2)).toBe(levels[0]);
    expect(at(0.53)).toBe(levels[1]);
    expect(at(0.84)).toBe(levels[2]);
    expect(alphaAt(pool, pool.w - 1, Math.floor(cy))).toBe(0);
  });

  it("dithers the seam between bands, so an edge reads as an edge", () => {
    // two bands meeting in a checker: a pixel of each on each diagonal of a 2 x 2 block
    let checker = 0;
    for (let y = 0; y + 1 < pool.h; y++) for (let x = 0; x + 1 < pool.w; x++) {
      const a = alphaAt(pool, x, y), b = alphaAt(pool, x + 1, y), c = alphaAt(pool, x, y + 1), d = alphaAt(pool, x + 1, y + 1);
      if (a === d && b === c && a !== b) checker++;
    }
    expect(checker).toBeGreaterThan(40);
    // and the seams are narrow: most of the pool is flat band
    const im = buildLightPool([1, 1, 1], 60, 45);
    let flat = 0, lit = 0;
    for (let y = 1; y + 1 < im.h; y++) for (let x = 1; x + 1 < im.w; x++) {
      const a = alphaAt(im, x, y);
      if (!a) continue;
      lit++;
      if (alphaAt(im, x + 1, y) === a && alphaAt(im, x - 1, y) === a && alphaAt(im, x, y + 1) === a && alphaAt(im, x, y - 1) === a) flat++;
    }
    expect(flat / lit).toBeGreaterThan(0.7);
  });
});

describe("no dither on smoke and dust (§4)", () => {
  const s = buildFxSheet();
  /** Holes (an empty pixel inside ink on all four sides) and 2 x 2 checkers: what a dither leaves. */
  function ditherMarks(sheet: Sheet, name: string): { holes: number; checker: number } {
    const f = sheet.frames.find((q) => q.name === name)!;
    const on = (x: number, y: number) => x >= 0 && y >= 0 && x < f.w && y < f.h && sheet.image.data[((f.y + y) * sheet.image.w + f.x + x) * 4 + 3] > 127;
    let holes = 0, checker = 0;
    for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) {
      if (!on(x, y) && on(x + 1, y) && on(x - 1, y) && on(x, y + 1) && on(x, y - 1)) holes++;
      const p = [on(x, y), on(x + 1, y), on(x, y + 1), on(x + 1, y + 1)];
      if (x + 1 < f.w && y + 1 < f.h && p[0] === p[3] && p[1] === p[2] && p[0] !== p[1]) checker++;
    }
    return { holes, checker };
  }

  const names = [
    ...[0, 1, 2, 3, 4, 5].map((i) => `smoke_${i}`),
    ...[0, 1, 2, 3].map((i) => `dust_${i}`),
    ...[4, 5, 6, 7].map((i) => `explosion_${i}`),
  ];
  for (const n of names) {
    it(`${n} thins without a dither`, () => {
      const m = ditherMarks(s, n);
      expect(m.holes, `${n} holes`).toBeLessThanOrEqual(3);
      expect(m.checker, `${n} checker blocks`).toBeLessThanOrEqual(3);
    });
  }
});
