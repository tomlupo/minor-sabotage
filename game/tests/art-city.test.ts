// The city generators (src/art/city): image sizes per the contract in src/art/types.ts, full and
// cut versions with the same bounds, only palette colours (style guide §3), determinism, and
// the ground painter on a demo-sized map: its size everywhere, its speed off CI only.
import { describe, expect, it } from "vitest";
import { buildArsenal, type ArsenalSpec } from "../src/art/city/arsenal";
import { buildBuilding, wallHeight } from "../src/art/city/buildings";
import { drawText, FONT_CHARS, GLYPHS, measureText } from "../src/art/city/font";
import { GAUGE, paintGround } from "../src/art/city/ground";
import { PAL } from "../src/art/palette";
import type { PixelImage } from "../src/art/pixel";
import { img } from "../src/art/pixel";
import type { BuildingSpec, GroundGrid, GroundMat } from "../src/art/types";
import { offPalette, opaqueCount } from "./helpers/palette-check";
import { judgesTime } from "./helpers/timing";

const LEGEND: GroundMat[] = ["road", "walk", "yard", "rail_ew", "rail_ns", "under", "square"];
const M = Object.fromEntries(LEGEND.map((m, i) => [m, i])) as Record<GroundMat, number>;

function grid(w: number, h: number, fill: GroundMat, rects: [number, number, number, number, GroundMat][] = []): GroundGrid {
  const cells = new Uint8Array(w * h).fill(M[fill]);
  for (const [x0, y0, x1, y1, m] of rects) for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) cells[y * w + x] = M[m];
  return { w, h, cells, legend: LEGEND };
}

/** A street crossing with every material, as on the demo map. */
function crossing(): GroundGrid {
  return grid(48, 40, "under", [
    [0, 0, 48, 8, "yard"], [0, 32, 48, 40, "yard"],
    [18, 0, 20, 40, "walk"], [28, 0, 30, 40, "walk"], [20, 0, 28, 40, "rail_ns"],
    [0, 12, 48, 16, "walk"], [0, 24, 48, 28, "walk"], [0, 16, 48, 24, "road"], [0, 18, 48, 22, "rail_ew"],
    [34, 28, 48, 32, "square"],
  ]);
}

/** A demo-sized map: 250 x 180 m of blocks, streets, tram lines, yards and a square. */
function demoMap(): GroundGrid {
  const W = 250, H = 180;
  const r: [number, number, number, number, GroundMat][] = [];
  for (let by = 0; by < H; by += 44) for (let bx = 0; bx < W; bx += 56) {
    r.push([bx, by, bx + 56, by + 44, "yard"], [bx + 16, by + 16, bx + 56, by + 30, "under"], [bx + 16, by + 16, bx + 30, by + 44, "under"]);
  }
  for (let y = 0; y < H; y += 44) r.push([0, y, W, y + 16, "walk"], [0, y + 3, W, y + 13, "road"], [0, y + 5, W, y + 11, "rail_ew"]);
  for (let x = 0; x < W; x += 56) r.push([x, 0, x + 16, H, "walk"], [x + 3, 0, x + 13, H, "road"]);
  r.push([100, 100, 130, 120, "square"]);
  return grid(W, H, "under", r.map(([a, b, c, d, m]) => [Math.max(0, a), Math.max(0, b), Math.min(W, c), Math.min(H, d), m]));
}

const same = (a: PixelImage, b: PixelImage) => a.w === b.w && a.h === b.h && Buffer.from(a.data).equals(Buffer.from(b.data));
const key = (c: readonly number[]) => c.join(",");
const at = (im: PixelImage, x: number, y: number) => {
  const i = (y * im.w + x) * 4;
  return [im.data[i], im.data[i + 1], im.data[i + 2], im.data[i + 3]];
};

describe("ground painter", () => {
  it("paints w*12 x h*9 art px, fully opaque, for any grid shape", () => {
    for (const [w, h] of [[1, 1], [3, 7], [48, 40]] as const) {
      const im = paintGround(w === 48 ? crossing() : grid(w, h, "road"), 1);
      expect([im.w, im.h]).toEqual([w * 12, h * 9]);
      expect(opaqueCount(im)).toBe(im.w * im.h);
    }
  });

  it("uses only palette colours, for every material and border", () => {
    for (const seed of [1, 2, 1943]) {
      const off = offPalette(paintGround(crossing(), seed));
      expect(off.count, `seed ${seed}: ${off.examples.join(" ")}`).toBe(0);
    }
  });

  it("is deterministic in its seed, and the seed matters", () => {
    const a = paintGround(crossing(), 7), b = paintGround(crossing(), 7), c = paintGround(crossing(), 8);
    expect(same(a, b)).toBe(true);
    expect(same(a, c)).toBe(false);
  });

  it("lays the two rails of a tram track a gauge apart", () => {
    // a two-cell band of rail_ew in open road: one track centred on the band
    const im = paintGround(grid(20, 12, "road", [[0, 5, 20, 7, "rail_ew"]]), 3);
    const rail = key(PAL.city_1943.rail);
    const rows: number[] = [];
    for (let y = 0; y < im.h; y++) {
      let n = 0;
      for (let x = 0; x < im.w; x++) if (key(at(im, x, y).slice(0, 3)) === rail) n++;
      if (n > im.w * 0.9) rows.push(y);
    }
    expect(rows.length).toBe(2);
    expect(rows[1] - rows[0]).toBe(Math.round((6 + GAUGE / 2) * 9) - Math.round((6 - GAUGE / 2) * 9));
  });

  it("paints a 250 x 180 m map at 3000 x 1620 art px", () => {
    const im = paintGround(demoMap(), 2);
    expect([im.w, im.h]).toEqual([3000, 1620]);
  });

  it.runIf(judgesTime)("paints a 250 x 180 m map in under 400 ms", () => {
    paintGround(grid(40, 30, "road", [[0, 0, 40, 10, "walk"], [0, 20, 40, 30, "yard"], [10, 10, 20, 20, "square"]]), 1); // warm up
    const g = demoMap();
    const t0 = performance.now();
    paintGround(g, 2);
    expect(performance.now() - t0).toBeLessThan(400);
  });
});

const SPECS: BuildingSpec[] = [
  { id: "a", x: 3, y: 10, w: 14, d: 12, storeys: 4, roof: "tin", plaster: "ochre", front: { shops: [{ x: 1, w: 2, sign: "PIEKARNIA" }], gateways: [6], balconies: true, lit: 0.2 }, cuttable: true, seed: 11 },
  { id: "b", x: 0, y: 0, w: 12, d: 12, storeys: 5, roof: "tar", plaster: "cream", front: { shops: [{ x: 1, w: 1.8, sign: "APTEKA" }, { x: 8.5, w: 2, sign: "FRYZJER" }], doors: [5], balconies: true }, cuttable: true, seed: 22 },
  { id: "c", x: 0, y: 0, w: 10, d: 12, storeys: 3, roof: "tin", plaster: "green", front: { doors: [4] }, cuttable: false, seed: 33 },
  { id: "d", x: 0, y: 0, w: 16, d: 13, storeys: 4, roof: "tin", plaster: "brick", front: { shops: [{ x: 1.5, w: 2, sign: "ZEGARMISTRZ" }], gateways: [9] }, cuttable: true, seed: 44 },
  { id: "e", x: 0, y: 0, w: 12, d: 12, storeys: 5, roof: "tar", plaster: "stone", front: { shops: [{ x: 7, w: 2, sign: "KAWIARNIA" }], doors: [2], lit: 1 }, cuttable: true, seed: 55 },
  { id: "f", x: 0, y: 0, w: 5, d: 6, storeys: 1, roof: "tile", plaster: "ochre", cuttable: true, seed: 66 },
  { id: "g", x: 0, y: 0, w: 8, d: 10, storeys: 3, roof: "tile", plaster: "cream", front: { shops: [{ x: 1, w: 2, sign: "SKLEP SPOŻYWCZY" }] }, cuttable: true, seed: 77 },
];

describe("tenements", () => {
  for (const spec of SPECS) {
    describe(`${spec.plaster}, ${spec.storeys} storeys, ${spec.roof} (${spec.id})`, () => {
      const art = buildBuilding(spec);
      const h = spec.storeys * 3.2 + 0.8;
      it("has the contract's bounds and wall height", () => {
        expect(art.h).toBeCloseTo(h, 9);
        expect(wallHeight(spec.storeys)).toBeCloseTo(h, 9);
        expect([art.full.w, art.full.h]).toEqual([spec.w * 12, spec.d * 9 + Math.round(h * 7.5)]);
        expect(opaqueCount(art.full)).toBe(art.full.w * art.full.h); // roof and wall fill the image
      });
      it("has a cut version exactly when it is cuttable, with the same bounds", () => {
        expect(!!art.cut).toBe(spec.cuttable);
        if (art.cut) expect([art.cut.w, art.cut.h]).toEqual([art.full.w, art.full.h]);
      });
      it("uses only palette colours", () => {
        const off = offPalette(art.full);
        expect(off.count, off.examples.join(" ")).toBe(0);
        if (art.cut) {
          const offCut = offPalette(art.cut);
          expect(offCut.count, offCut.examples.join(" ")).toBe(0);
        }
      });
      it("is deterministic", () => {
        const again = buildBuilding(spec);
        expect(same(art.full, again.full)).toBe(true);
        if (art.cut) expect(same(art.cut, again.cut!)).toBe(true);
      });
      if (spec.cuttable) {
        it("cuts to knee height and draws the ghost of the full volume", () => {
          const cut = art.cut!;
          const W = cut.w, RH = spec.d * 9, WH = Math.round(h * 7.5);
          const ghost = key(PAL.shared.ghost);
          const isDot = (x: number, y: number) => { const p = at(cut, x, y); return p[3] === 204 && key(p.slice(0, 3)) === ghost; };
          // every semi-transparent pixel is a ghost dot (ghost colour at 80%)
          let other = 0;
          for (let i = 0; i < cut.data.length; i += 4) {
            const a = cut.data[i + 3];
            if (a !== 0 && a !== 255 && !(a === 204 && key([cut.data[i], cut.data[i + 1], cut.data[i + 2]]) === ghost)) other++;
          }
          expect(other).toBe(0);
          // nothing opaque above the knee walls (the north wall's cap starts KNEE = 8 px up)
          const top = WH - 8;
          for (let y = 0; y < top; y++) for (let x = 0; x < W; x++) expect(at(cut, x, y)[3]).not.toBe(255);
          // the floor and the walls fill the rest
          expect(opaqueCount(cut)).toBeGreaterThan(W * (cut.h - top) * 0.95);
          // the roof rectangle's far edge is dotted every 3rd pixel...
          let edge = 0;
          for (let x = 0; x < W; x++) if (isDot(x, 0)) edge++;
          expect(edge).toBeGreaterThanOrEqual(Math.floor(W / 3));
          // ...and both sides are dotted wherever the cut leaves them clear: the rectangle's
          // sides, then the front corners running down from its south corners
          for (const x of [0, W - 1]) {
            const clearRows = Array.from({ length: top - 1 }, (_, i) => i + 1);
            const dotted = clearRows.filter((y) => isDot(x, y)).length;
            expect(dotted).toBeGreaterThanOrEqual(Math.floor(clearRows.length / 3) - 1);
          }
          if (RH + 3 < top) expect([RH, RH + 1, RH + 2].some((y) => isDot(0, y) && true) || [RH, RH + 1, RH + 2].some((y) => isDot(W - 1, y))).toBe(true);
        });
      }
    });
  }

  it("differs by seed", () => {
    const a = buildBuilding(SPECS[0]).full, b = buildBuilding({ ...SPECS[0], seed: 12 }).full;
    expect(same(a, b)).toBe(false);
  });

  it("copes with odd specs: tiny, tall, features at and past the edges", () => {
    const odd: BuildingSpec[] = [
      { id: "tiny", x: 0, y: 0, w: 2, d: 2, storeys: 1, roof: "tar", plaster: "stone", cuttable: true, seed: 1 },
      { id: "tall", x: 0, y: 0, w: 9, d: 16, storeys: 7, roof: "tin", plaster: "green", front: { balconies: true, lit: 0.5 }, cuttable: true, seed: 2 },
      { id: "edges", x: 0, y: 0, w: 8, d: 9, storeys: 3, roof: "tile", plaster: "brick", cuttable: true, seed: 3,
        front: { gateways: [0, 6], doors: [7.5], shops: [{ x: -1, w: 2, sign: "ŻÓŁĆ GĘŚLĄ JAŹŃ" }, { x: 5, w: 4, sign: "X" }] } },
    ];
    for (const spec of odd) {
      const art = buildBuilding(spec);
      expect([art.full.w, art.full.h]).toEqual([spec.w * 12, spec.d * 9 + Math.round(wallHeight(spec.storeys) * 7.5)]);
      expect(offPalette(art.full).count).toBe(0);
      expect(offPalette(art.cut!).count).toBe(0);
    }
  });
});

describe("the Arsenal", () => {
  const spec: ArsenalSpec = {
    id: "arsenal", x: 38, y: 0, w: 38, d: 26, storeys: 2, roof: "tile", plaster: "cream",
    front: { lit: 0.1 }, cuttable: true, seed: 1643, courtyard: { x: 10, y: 7, w: 18, d: 11 },
  };
  const art = buildArsenal(spec);
  const h = spec.storeys * 3.2 + 0.8;
  const W = spec.w * 12, RH = spec.d * 9, WH = Math.round(h * 7.5);

  it("has the contract's bounds, and a cut with the same bounds", () => {
    expect(art.h).toBeCloseTo(h, 9);
    expect([art.full.w, art.full.h]).toEqual([W, RH + WH]);
    expect([art.cut!.w, art.cut!.h]).toEqual([W, RH + WH]);
  });

  it("uses only palette colours", () => {
    for (const im of [art.full, art.cut!]) {
      const off = offPalette(im);
      expect(off.count, off.examples.join(" ")).toBe(0);
    }
  });

  it("leaves the courtyard transparent and shows the north wing's inner wall across it", () => {
    const c = spec.courtyard!;
    const x0 = c.x * 12 + 2, x1 = (c.x + c.w) * 12 - 2;
    // the inner wall stands on the courtyard's north edge, from the eave down to the ground
    const wallTop = c.y * 9, wallFoot = c.y * 9 + WH;
    let wall = 0, hole = 0;
    for (let x = x0; x < x1; x++) {
      for (let y = wallTop + 2; y < wallFoot - 2; y++) if (at(art.full, x, y)[3] === 255) wall++;
      for (let y = wallFoot + 2; y < wallFoot + 8; y++) if (at(art.full, x, y)[3] === 0) hole++;
    }
    expect(wall).toBe((x1 - x0) * (wallFoot - 4 - wallTop));
    expect(hole).toBe((x1 - x0) * 6);
    // outside the courtyard's columns the building is solid
    for (const x of [5, W - 6]) for (let y = 0; y < art.full.h; y++) expect(at(art.full, x, y)[3]).toBe(255);
  });

  it("without a courtyard it is solid", () => {
    const solid = buildArsenal({ ...spec, courtyard: undefined });
    expect(opaqueCount(solid.full)).toBe(W * (RH + WH));
  });

  it("copes with small sizes and a courtyard that does not fit", () => {
    for (const s of [
      { ...spec, w: 8, d: 6, courtyard: undefined },
      { ...spec, w: 12, d: 10, courtyard: { x: 0, y: 0, w: 20, d: 20 } },
      { ...spec, w: 20, d: 16, storeys: 3, courtyard: { x: 5, y: 4, w: 10, d: 6 }, front: { gateways: [2] } },
    ]) {
      const a = buildArsenal(s);
      expect([a.full.w, a.full.h]).toEqual([s.w * 12, s.d * 9 + Math.round((s.storeys * 3.2 + 0.8) * 7.5)]);
      expect(offPalette(a.full).count).toBe(0);
      expect(offPalette(a.cut!).count).toBe(0);
    }
  });

  it("is deterministic", () => {
    const again = buildArsenal(spec);
    expect(same(art.full, again.full)).toBe(true);
    expect(same(art.cut!, again.cut!)).toBe(true);
  });
});

describe("sign font", () => {
  it("has every Polish capital and the digits", () => {
    for (const ch of "AĄBCĆDEĘFGHIJKLŁMNŃOÓPRSŚTUWYZŹŻ0123456789") expect(GLYPHS[ch], ch).toBeDefined();
    expect(FONT_CHARS.length).toBeGreaterThan(40);
  });

  it("measures and draws in one colour, lower case as capitals", () => {
    const m = measureText("SPOŻYWCZY Ąę");
    expect(m.above).toBe(true);
    expect(m.below).toBe(true);
    const im = img(80, 9);
    const w = drawText(im, "Zegarmistrz", 0, 1, PAL.shared.chalk);
    expect(w).toBe(measureText("ZEGARMISTRZ").w);
    const inks = new Set<string>();
    for (let i = 0; i < im.data.length; i += 4) if (im.data[i + 3]) inks.add(`${im.data[i]},${im.data[i + 1]},${im.data[i + 2]}`);
    expect([...inks]).toEqual([key(PAL.shared.chalk)]);
  });
});
