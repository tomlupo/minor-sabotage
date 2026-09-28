// Arrows to what the phase asks of you off the screen (src/ui/pointers.ts, style guide §8).
// Tom, 2026-09-28: "dont reealy know where is it, the other places where easier to spot".
import { describe, expect, it } from "vitest";
import { REACH, arrowMask, placeArrows, type Box } from "../src/ui/pointers";

const W = 480, H = 270;
const NONE = { top: 0, right: 0, bottom: 0, left: 0 };
const pad = REACH + 3;

describe("arrows to what is off the screen", () => {
  it("draws none for a mark already on the screen", () => {
    expect(placeArrows([{ key: "phone", x: 300, y: 150 }], W, H, NONE, [])).toEqual([]);
  });

  it("points at a mark off the screen, from inside the screen", () => {
    const [a] = placeArrows([{ key: "phone", x: 1200, y: -300 }], W, H, NONE, []);
    expect(a.key).toBe("phone");
    expect(a.angle).toBeCloseTo(Math.atan2(-300 - 135, 1200 - 240), 5);
    expect(a.x - pad).toBeGreaterThanOrEqual(0);
    expect(a.x + pad).toBeLessThanOrEqual(W);
    expect(a.y - pad).toBeGreaterThanOrEqual(0);
    // it goes out as far as it can: to the edge it points at
    expect(Math.min(a.y - pad, W - (a.x + pad))).toBeLessThanOrEqual(1);
  });

  it("draws one arrow for a job several places can do, at the nearest, and none if one is on the screen", () => {
    const wire = [{ key: "wire", x: -400, y: 100 }, { key: "wire", x: 700, y: 140 }, { key: "wire", x: 240, y: -900 }];
    const arrows = placeArrows(wire, W, H, NONE, []);
    expect(arrows).toHaveLength(1);
    expect(Math.cos(arrows[0].angle)).toBeGreaterThan(0.9);
    expect(placeArrows([...wire, { key: "wire", x: 100, y: 100 }], W, H, NONE, [])).toEqual([]);
  });

  it("keeps an arrow clear of the HUD's boxes in its way", () => {
    // the objectives' box up the right, FIRE at the bottom left, and a box on the right edge
    // just where the way to the mark on the right leaves the screen
    const boxes: Box[] = [{ x: 330, y: 38, w: 140, h: 32 }, { x: 8, y: 220, w: 44, h: 44 }, { x: 420, y: 100, w: 60, h: 80 }];
    for (const [x, y] of [[900, -200], [-300, 600], [240, -800], [1200, 150]]) {
      const [a] = placeArrows([{ key: "k", x, y }], W, H, NONE, boxes);
      for (const b of boxes) {
        const clear = a.x + pad <= b.x || a.x - pad >= b.x + b.w || a.y + pad <= b.y || a.y - pad >= b.y + b.h;
        expect(clear, `arrow at ${a.x},${a.y} towards ${x},${y}`).toBe(true);
      }
    }
  });

  it("stays out at the screen's edge past a box nearer the middle", () => {
    // the first-time hint sits above the middle of the screen: an arrow up and to the left
    // passes under it and goes on to the left edge, rather than stopping mid-street beneath it
    const hint = { x: 130, y: 88, w: 220, h: 20 };
    const [a] = placeArrows([{ key: "gate", x: -300, y: -60 }], W, H, NONE, [hint]);
    expect(a.x - pad).toBeLessThanOrEqual(1);
  });

  it("counts a mark under a HUD box as unseen, and points at it", () => {
    const box = { x: 330, y: 38, w: 140, h: 32 };
    const arrows = placeArrows([{ key: "wire", x: 432, y: 37 + 10 }], W, H, NONE, [box]);
    expect(arrows).toHaveLength(1);
  });

  it("keeps out of the phone's safe insets", () => {
    const safe = { top: 0, right: 40, bottom: 14, left: 40 };
    const [a] = placeArrows([{ key: "k", x: -500, y: 140 }], 568, 262, safe, []);
    expect(a.x - pad).toBeGreaterThanOrEqual(safe.left);
  });
});

describe("the arrow's pixels", () => {
  it("points the way it is asked, in 8 ways, with a dark edge all round the chalk", () => {
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * 2 * Math.PI;
      const m = arrowMask(a);
      const c = Math.cos(a), s = Math.sin(a);
      const along = ([x, y]: [number, number]) => x * c + y * s;
      const across = ([x, y]: [number, number]) => -x * s + y * c;
      // narrow in front, broad behind: the front is one pixel on the axis it points along, and the
      // back row reaches across it (a shape broad at every corner points nowhere)
      const front = Math.max(...m.fill.map(along)), back = Math.min(...m.fill.map(along));
      const tip = m.fill.filter((p) => along(p) > front - 1e-9);
      expect(tip, `way ${k}`).toHaveLength(1);
      expect(Math.abs(across(tip[0])), `way ${k}`).toBeLessThan(1e-9);
      expect(m.fill.filter((p) => along(p) < back + 1e-9).length, `way ${k}`).toBeGreaterThanOrEqual(6);
      // a way between two of the eight is drawn as the nearer one
      expect(arrowMask(a + 0.3)).toBe(m);
      // every chalk pixel's neighbours are chalk or edge, so it reads on any ground
      const lit = new Set([...m.fill, ...m.edge].map(([x, y]) => `${x},${y}`));
      for (const [x, y] of m.fill) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        expect(lit.has(`${x + dx},${y + dy}`), `way ${k} at ${x},${y}`).toBe(true);
      }
      for (const [x, y] of [...m.fill, ...m.edge]) expect(Math.max(Math.abs(x), Math.abs(y))).toBeLessThanOrEqual(REACH);
    }
  });
});
