// How big an art pixel is on a screen (src/render/view.ts, style guide §2): scaled up by a
// whole number or by 1.5, never by another step, and 1.5 on an iPhone 15 held sideways.
import { describe, expect, it } from "vitest";
import { MIN_H, MIN_W, computeView, pickZoom } from "../src/render/view";

const SCREENS: [string, number, number][] = [
  ["iPhone 15, landscape", 852, 393],
  ["iPhone SE, landscape", 667, 375],
  ["iPhone 15 Pro Max, landscape", 932, 430],
  ["iPad, landscape", 1180, 820],
  ["laptop", 1280, 720],
  ["laptop", 1366, 768],
  ["desktop", 1920, 1080],
  ["desktop", 2560, 1440],
  ["small window", 400, 300],
];

describe("view scale", () => {
  it("shows 568 x 262 art px at 1.5 on an iPhone 15 held sideways", () => {
    expect(computeView(852, 393)).toEqual({ w: 568, h: 262, zoom: 1.5 });
  });

  it("scales only by 1.5 or a whole number", () => {
    for (let w = 320; w <= 3840; w += 7) {
      for (let h = 240; h <= 2160; h += 11) {
        const { zoom } = computeView(w, h);
        expect(zoom === 1.5 || Number.isInteger(zoom), `${w} x ${h} -> ${zoom}`).toBe(true);
      }
    }
  });

  it("picks the largest allowed scale that still shows the designed view", () => {
    for (const [name, w, h] of SCREENS) {
      const v = computeView(w, h);
      const fit = Math.min(w / MIN_W, h / MIN_H);
      if (fit >= 1) expect(v.w >= MIN_W && v.h >= MIN_H, `${name}: ${v.w} x ${v.h}`).toBe(true);
      const next = v.zoom === 1 ? 1.5 : v.zoom === 1.5 ? 2 : v.zoom + 1;
      expect(next > fit, `${name}: ${v.zoom} while ${next} fits (${fit.toFixed(2)})`).toBe(true);
      expect(v.w * v.zoom).toBeGreaterThanOrEqual(w);
      expect(v.h * v.zoom).toBeGreaterThanOrEqual(h);
    }
  });

  it("never takes a half step above 2", () => {
    expect(pickZoom(2.5)).toBe(2);
    expect(pickZoom(2.99)).toBe(2);
    expect(pickZoom(3.5)).toBe(3);
    expect(pickZoom(1.99)).toBe(1.5);
    expect(pickZoom(1.49)).toBe(1);
    expect(pickZoom(0.8)).toBe(1);
    expect(computeView(1280, 720).zoom).toBe(2);
  });
});
