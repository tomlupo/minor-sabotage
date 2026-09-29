// How big an art pixel is on a screen (src/render/view.ts, style guide §2): 1.5 pt on an
// iPhone 15 held sideways, steps in points on a dense screen, and on a PC the same map, the
// full-screen 1080p view, in any window (Tom, 2026-09-28).
import { describe, expect, it } from "vitest";
import { MIN_H, MIN_W, PC_H, PC_W, computeView, pickZoom } from "../src/render/view";

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
      // the view is the canvas in whole art pixels (a part-pixel left over is margin)
      expect(v.w * v.s, name).toBeLessThanOrEqual(v.canvasW + 1e-3);
      expect((v.w + 1) * v.s, name).toBeGreaterThan(v.canvasW);
      expect(v.h * v.s, name).toBeLessThanOrEqual(v.canvasH + 1e-3);
      expect((v.h + 1) * v.s, name).toBeGreaterThan(v.canvasH);
      expect(v.zoom * dpr, name).toBeCloseTo(v.s, 9);
    }
  });

  it("shows a PC the same map in any window: the full-screen 1080p view, fitted to it", () => {
    // Tom, 2026-09-28: "the screen should shows same map everywhere"
    for (const dpr of [1, 1.25, 1.5, 1.75]) {
      for (let w = 640; w <= 3840; w += 37) {
        for (let h = 360; h <= 2160; h += 29) {
          const v = computeView(w, h, dpr);
          const fitted = (v.w === PC_W && v.h >= PC_H) || (v.h === PC_H && v.w >= PC_W);
          expect(fitted, `${w} x ${h} at ${dpr}: ${v.w} x ${v.h}`).toBe(true);
        }
      }
    }
  });

  it("keeps a browser window that is not full screen at the full-screen view", () => {
    // review round 11: a maximised window under 960 px tall dropped to 3 px an art pixel and
    // showed 640 x 304, more map than full screen or the phone
    for (const [w, h, dpr] of [[1536, 730, 1.25], [1920, 945, 1], [1280, 610, 1.5], [1366, 650, 1]] as const) {
      expect(computeView(w, h, dpr).h, `${w} x ${h} at ${dpr}`).toBe(PC_H);
    }
  });

  it("shows a laptop at 125 % or 150 % the view of a desktop at 1080p, 4 px to an art pixel", () => {
    const desk = computeView(1920, 1080, 1);
    expect([desk.w, desk.h, desk.s]).toEqual([PC_W, PC_H, 4]);
    for (const [w, h, dpr] of [[1536, 864, 1.25], [1280, 720, 1.5]] as const) {
      const v = computeView(w, h, dpr);
      expect([v.w, v.h, v.s], `${w} x ${h} at ${dpr}`).toEqual([desk.w, desk.h, desk.s]);
    }
  });

  it("never draws an art pixel smaller than a physical pixel", () => {
    expect(computeView(400, 300, 1)).toMatchObject({ s: 1, w: 400, h: 300 });
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

  it("picks the largest point step that still shows the designed view on a dense screen", () => {
    for (const [name, w, h, dpr] of SCREENS) {
      if (dpr < 2) continue;
      const v = computeView(w, h, dpr);
      const fits = (s: number) => Math.floor(v.canvasW / s) >= MIN_W && Math.floor(v.canvasH / s) >= MIN_H;
      if (fits(dpr)) expect(v.w >= MIN_W && v.h >= MIN_H, `${name}: ${v.w} x ${v.h}`).toBe(true);
      const next = (v.zoom === 1 ? 1.5 : v.zoom === 1.5 ? 2 : v.zoom + 1) * dpr;
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
