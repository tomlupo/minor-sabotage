// How big an art pixel is on a screen (src/render/view.ts, style guide §2): every art pixel
// the same size, 1.5 pt on an iPhone 15 held sideways, and a whole number of physical pixels
// wherever one physical pixel can be seen.
import { describe, expect, it } from "vitest";
import { MIN_H, MIN_W, computeView, pickZoom } from "../src/render/view";

// [name, CSS width, CSS height, device pixel ratio]
const SCREENS: [string, number, number, number][] = [
  ["iPhone 15, landscape", 852, 393, 3],
  ["iPhone SE, landscape", 667, 375, 2],
  ["iPhone 15 Pro Max, landscape", 932, 430, 3],
  ["iPad, landscape", 1180, 820, 2],
  ["MacBook", 1440, 900, 2],
  ["laptop at 100 %", 1366, 768, 1],
  ["laptop at 125 %", 1536, 864, 1.25],
  ["laptop at 150 %", 1280, 720, 1.5],
  ["desktop", 1920, 1080, 1],
  ["desktop", 2560, 1440, 1],
  ["small window", 400, 300, 1],
];

describe("view scale", () => {
  it("shows 568 x 262 art px at 1.5 pt on an iPhone 15 held sideways", () => {
    const v = computeView(852, 393, 3);
    expect(v).toMatchObject({ w: 568, h: 262, zoom: 1.5, s: 4.5 });
  });

  it("draws the canvas at the screen's own resolution, over the whole window", () => {
    for (const [name, w, h, dpr] of SCREENS) {
      const v = computeView(w, h, dpr);
      expect([v.canvasW, v.canvasH], name).toEqual([Math.round(w * dpr), Math.round(h * dpr)]);
      // the view is the canvas in art pixels (the last part-pixel is margin)
      expect(v.w, name).toBe(Math.floor(v.canvasW / v.s));
      expect(v.h, name).toBe(Math.floor(v.canvasH / v.s));
      expect(v.zoom * dpr, name).toBeCloseTo(v.s, 9);
    }
  });

  it("makes every art pixel a whole number of physical pixels where one physical pixel shows", () => {
    // review: at 125 % a 3-point step drew art pixels 3 and 4 physical pixels wide by turns
    for (const dpr of [1, 1.25, 1.5, 1.75]) {
      for (let w = 320; w <= 3840; w += 13) {
        for (let h = 240; h <= 2160; h += 17) {
          const { s } = computeView(w, h, dpr);
          expect(Number.isInteger(s), `${w} x ${h} at ${dpr}: ${s}`).toBe(true);
        }
      }
    }
  });

  it("shows a laptop at 125 % or 150 % the same view as a desktop at 1080p", () => {
    const desk = computeView(1920, 1080, 1);
    for (const [w, h, dpr] of [[1536, 864, 1.25], [1280, 720, 1.5]] as const) {
      const v = computeView(w, h, dpr);
      expect([v.w, v.h, v.s], `${w} x ${h} at ${dpr}`).toEqual([desk.w, desk.h, desk.s]);
    }
  });

  it("counts the step in points on a dense screen (1, 1.5, 2, 3...), as the style guide does", () => {
    for (const dpr of [2, 3]) {
      for (let w = 320; w <= 1400; w += 11) {
        for (let h = 240; h <= 1000; h += 13) {
          const { zoom } = computeView(w, h, dpr);
          expect(zoom === 1.5 || Number.isInteger(zoom), `${w} x ${h} at ${dpr}: ${zoom}`).toBe(true);
        }
      }
    }
  });

  it("picks the largest step that still shows the designed view", () => {
    for (const [name, w, h, dpr] of SCREENS) {
      const v = computeView(w, h, dpr);
      const fits = (s: number) => Math.floor(v.canvasW / s) >= MIN_W && Math.floor(v.canvasH / s) >= MIN_H;
      if (fits(dpr < 2 ? 1 : dpr)) expect(v.w >= MIN_W && v.h >= MIN_H, `${name}: ${v.w} x ${v.h}`).toBe(true);
      const next = dpr < 2 ? v.s + 1 : (v.zoom === 1 ? 1.5 : v.zoom === 1.5 ? 2 : v.zoom + 1) * dpr;
      expect(fits(next), `${name}: ${v.s} while ${next} fits`).toBe(false);
    }
  });

  it("never takes a half step above 2 points", () => {
    expect(pickZoom(2.5)).toBe(2);
    expect(pickZoom(2.99)).toBe(2);
    expect(pickZoom(3.5)).toBe(3);
    expect(pickZoom(1.99)).toBe(1.5);
    expect(pickZoom(1.49)).toBe(1);
    expect(pickZoom(0.8)).toBe(1);
  });
});
