// Props, vehicles and effects (src/art/props.ts, vehicles.ts, fx.ts): every kind, state and frame
// exists; every opaque pixel is a palette colour (style guide §3) and none is reserved; the only
// see-through pixels are the baked shadow; the builders are deterministic; and the whole set is
// cheap enough to draw at boot.
import { describe, expect, it } from "vitest";
import type { PropKind, PropState, VehicleKind, VehicleState } from "../src/art/types";
import type { PixelImage, Sheet } from "../src/art/pixel";
import { buildProp, POLE_WIRE_POINT, PROP_KINDS, PROP_STATES } from "../src/art/props";
import { buildVehicleSheet, vehicleCell, VEHICLE_KINDS, VEHICLE_STATES } from "../src/art/vehicles";
import { buildFxSheet } from "../src/art/fx";
import { PAL } from "../src/art/palette";
import raw from "../../docs/art/palette.json";
import { offPalette, opaqueCount } from "./helpers/palette-check";

const ALL_KINDS: PropKind[] = [
  "lamp", "ad_column", "kiosk", "bench", "tree", "phone_pole", "phone_box", "sandbags", "barrier", "barrel",
  "crates", "cart", "hydrant", "tram_stop", "street_sign", "gate", "ghetto_wall", "bin", "snow_heap", "dorozka", "kit",
];
const ALL_STATES: PropState[] = ["intact", "destroyed", "burning"];
const VARIANTS: Partial<Record<PropKind, (number | string)[]>> = {
  street_sign: ["DŁUGA", "BIELAŃSKA", "NALEWKI", "ŚWIĘTOJERSKA", "ŻELAZNA"],
  tree: [1, 2, 3],
  bench: [0, 1],
  barrier: [0, 1],
  gate: [0, 1],
  ghetto_wall: ["ew", "ns", "ew3", "ns2"],
  snow_heap: [1, 2, 3],
  dorozka: [0, "w"],
};
const VEHICLES: VehicleKind[] = ["prison_truck", "car", "german_truck", "tram"];
const VSTATES: VehicleState[] = ["intact", "burning", "wreck", "doors_open"];
const FX_NAMES = [
  ...["s", "se", "e", "ne", "n"].flatMap((f) => [0, 1].map((i) => `muzzle_${f}_${i}`)),
  ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => `explosion_${i}`),
  ...[0, 1, 2, 3, 4, 5].map((i) => `fire_${i}`),
  ...[0, 1, 2, 3, 4, 5].map((i) => `smoke_${i}`),
  ...[0, 1, 2, 3].map((i) => `dust_${i}`),
  ...[0, 1, 2, 3].map((i) => `snow_${i}`),
  ...[0, 1, 2, 3].map((i) => `glass_${i}`),
  ...[0, 1, 2].map((i) => `spark_${i}`),
  ...[0, 1, 2, 3].map((i) => `blood_${i}`),
  ...[0, 1].map((i) => `scorch_${i}`),
  ...[0, 1, 2].map((i) => `bullet_hole_${i}`),
];

/** Style guide §3: reserved colours never appear in props, vehicles or effects. */
const RESERVED = new Set<string>();
{
  const p = raw as unknown as Record<string, Record<string, unknown>>;
  const add = (c: unknown) => { if (Array.isArray(c)) RESERVED.add(c.join(",")); };
  add(p.shared.poppy_red);
  add(p.shared.cone_yellow);
  add(p.shared.select_gold);
  for (const v of Object.values((p.hud as Record<string, Record<string, unknown>>).squads)) add(v);
  for (const [k, v] of Object.entries(p.hud_extra ?? {})) if (/^squad_\d+_shade$/.test(k)) add(v);
}
const SHADOW = PAL.shared.shadow.join(",");

function reservedCount(im: PixelImage): number {
  let n = 0;
  for (let i = 0; i < im.data.length; i += 4) if (im.data[i + 3] && RESERVED.has(`${im.data[i]},${im.data[i + 1]},${im.data[i + 2]}`)) n++;
  return n;
}

/** Pixels that are neither opaque nor empty must be the shadow colour (§4: one colour at ~27%). */
function strayTranslucent(im: PixelImage): number {
  let n = 0;
  for (let i = 0; i < im.data.length; i += 4) {
    const a = im.data[i + 3];
    if (a === 0 || a === 255) continue;
    if (`${im.data[i]},${im.data[i + 1]},${im.data[i + 2]}` !== SHADOW) n++;
  }
  return n;
}

function frameImage(s: Sheet, name: string): PixelImage {
  const f = s.frames.find((q) => q.name === name)!;
  const out = { w: f.w, h: f.h, data: new Uint8ClampedArray(f.w * f.h * 4) };
  for (let y = 0; y < f.h; y++) out.data.set(s.image.data.subarray(((f.y + y) * s.image.w + f.x) * 4, ((f.y + y) * s.image.w + f.x + f.w) * 4), y * f.w * 4);
  return out;
}

function expectClean(label: string, im: PixelImage): void {
  const off = offPalette(im);
  expect(off.count, `${label} off-palette ${off.examples.join(" ")}`).toBe(0);
  expect(reservedCount(im), `${label} uses a reserved colour`).toBe(0);
  expect(strayTranslucent(im), `${label} has see-through pixels that are not the shadow`).toBe(0);
}

describe("art: props, vehicles, effects", () => {
  // first, while the builders are cold, as they are at boot: every prop kind in each drawn state,
  // all 16 vehicle sheets, the effects sheet. A shared box can be busy, so the budget is held by
  // the better of the cold build and an immediate second one; both are printed.
  it("builds every prop, vehicle sheet and the effects sheet in about 300 ms", () => {
    const build = () => {
      const t0 = performance.now();
      for (const kind of ALL_KINDS) for (const st of PROP_STATES[kind]) buildProp(kind, st);
      const t1 = performance.now();
      for (const kind of VEHICLES) for (const st of VSTATES) buildVehicleSheet(kind, st);
      const t2 = performance.now();
      buildFxSheet();
      const t3 = performance.now();
      return { ms: t3 - t0, props: t1 - t0, vehicles: t2 - t1, fx: t3 - t2 };
    };
    const cold = build(), warm = build();
    const f = (b: typeof cold) => `${b.ms.toFixed(0)} ms (props ${b.props.toFixed(0)}, vehicles ${b.vehicles.toFixed(0)}, fx ${b.fx.toFixed(0)})`;
    console.log(`art build: cold ${f(cold)}; warm ${f(warm)}`);
    expect(Math.min(cold.ms, warm.ms)).toBeLessThan(300);
  });

  it("lists every prop kind", () => {
    expect([...PROP_KINDS].sort()).toEqual([...ALL_KINDS].sort());
    for (const k of ALL_KINDS) expect(PROP_STATES[k]).toContain("intact");
    expect(PROP_STATES.phone_pole).toEqual(expect.arrayContaining(["intact", "destroyed"]));
    expect(PROP_STATES.phone_box).toEqual(expect.arrayContaining(["intact", "destroyed"]));
    for (const k of ["barrel", "crates"] as PropKind[]) expect(PROP_STATES[k]).toEqual(expect.arrayContaining(["intact", "burning", "destroyed"]));
    expect(PROP_STATES.kiosk).toEqual(expect.arrayContaining(["intact", "burning"]));
  });

  describe("props", () => {
    for (const kind of ALL_KINDS) {
      it(`${kind}: every state and variant draws, anchored inside, from the palette`, () => {
        for (const st of ALL_STATES) {
          for (const v of VARIANTS[kind] ?? [undefined]) {
            const a = buildProp(kind, st, v);
            const label = `${kind}/${st}/${v ?? ""}`;
            expect(a.image.w, label).toBeGreaterThan(0);
            expect(a.ax >= 0 && a.ax < a.image.w && a.ay >= 0 && a.ay < a.image.h, `${label} anchor ${a.ax},${a.ay} in ${a.image.w}x${a.image.h}`).toBe(true);
            expect(opaqueCount(a.image), label).toBeGreaterThan(20);
            expectClean(label, a.image);
          }
        }
      });
    }

    it("draws meaningful states differently from intact", () => {
      for (const kind of ALL_KINDS) for (const st of PROP_STATES[kind]) {
        if (st === "intact") continue;
        const a = buildProp(kind, "intact"), b = buildProp(kind, st);
        expect(Buffer.from(a.image.data).equals(Buffer.from(b.image.data)), `${kind}/${st}`).toBe(false);
      }
    });

    it("puts the wire point on an insulator of the intact pole", () => {
      const pole = buildProp("phone_pole", "intact");
      const [x, y] = POLE_WIRE_POINT;
      const i = (y * pole.image.w + x) * 4;
      expect(pole.image.data[i + 3]).toBe(255);
      expect([pole.image.data[i], pole.image.data[i + 1], pole.image.data[i + 2]]).toEqual([...PAL.shared.chalk]);
      expect(y).toBeLessThan(pole.ay - 40); // up on the crossarm, not at the foot
    });

    it("writes the street name on the plate", () => {
      const a = buildProp("street_sign", "intact", "DŁUGA"), b = buildProp("street_sign", "intact", "BIELAŃSKA");
      expect(b.image.w).toBeGreaterThan(a.image.w);
      const plate = PAL.shared.chalk.join(",");
      let letters = 0;
      for (let i = 0; i < a.image.data.length; i += 4) if (`${a.image.data[i]},${a.image.data[i + 1]},${a.image.data[i + 2]}` === plate) letters++;
      expect(letters).toBeGreaterThan(30);
    });

    it("tiles the ghetto wall: 2 m east-west segments are 24 px wide", () => {
      const ew = buildProp("ghetto_wall", "intact", "ew");
      expect(ew.image.w).toBe(24);
      expect(ew.ax).toBe(12);
      // the brickwork, ground line and shadow band run edge to edge, so segments join without a seam
      const a = (x: number, y: number) => ew.image.data[(y * 24 + x) * 4 + 3];
      const top = ew.ay - 22; // just under the coping
      for (let y = top; y < ew.image.h; y++) {
        expect(a(0, y), `row ${y}`).toBe(a(12, y));
        expect(a(23, y), `row ${y}`).toBe(a(12, y));
      }
    });
  });

  describe("vehicles", () => {
    for (const kind of VEHICLES) {
      it(`${kind}: 16 headings per state, one cell, from the palette`, () => {
        const cell = vehicleCell(kind);
        expect(VEHICLE_KINDS).toContain(kind);
        for (const st of VSTATES) {
          expect(VEHICLE_STATES).toContain(st);
          const s = buildVehicleSheet(kind, st);
          expect(s.frames.map((f) => f.name)).toEqual(Array.from({ length: 16 }, (_, i) => `h${i}`));
          const seen = new Set<string>();
          for (const f of s.frames) {
            expect([f.w, f.h, f.ax, f.ay]).toEqual([cell.w, cell.h, cell.ax, cell.ay]);
            const im = frameImage(s, f.name);
            expect(opaqueCount(im), `${kind}/${st}/${f.name}`).toBeGreaterThan(150);
            seen.add(Buffer.from(im.data).toString("base64"));
          }
          expect(seen.size, `${kind}/${st}: every heading is a different drawing`).toBe(16);
          expectClean(`${kind}/${st}`, s.image);
        }
      });
    }

    it("points h0 east and h4 south", () => {
      // east: wider than tall; south: taller than wide (the drawn pixels of the car)
      const s = buildVehicleSheet("car", "intact");
      const extent = (name: string) => {
        const im = frameImage(s, name);
        let x0 = im.w, x1 = 0, y0 = im.h, y1 = 0;
        for (let y = 0; y < im.h; y++) for (let x = 0; x < im.w; x++) if (im.data[(y * im.w + x) * 4 + 3] === 255) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
        return [x1 - x0, y1 - y0];
      };
      const [we, he] = extent("h0"), [ws, hs] = extent("h4");
      expect(we).toBeGreaterThan(he * 1.6);
      expect(hs).toBeGreaterThan(ws);
    });
  });

  describe("effects", () => {
    it("has every frame named in types.ts, each drawn and anchored", () => {
      const s = buildFxSheet();
      const names = s.frames.map((f) => f.name);
      for (const n of FX_NAMES) expect(names, n).toContain(n);
      for (const f of s.frames) {
        expect(f.ax >= 0 && f.ax < f.w && f.ay >= 0 && f.ay < f.h, `${f.name} anchor`).toBe(true);
        expect(opaqueCount(frameImage(s, f.name)), f.name).toBeGreaterThan(2);
      }
      expectClean("fx", s.image);
    });

    it("centres each muzzle flash on the muzzle, so a flipped west facing still starts at the gun", () => {
      const s = buildFxSheet();
      for (const f of s.frames.filter((q) => q.name.startsWith("muzzle_"))) expect(f.w, f.name).toBe(2 * f.ax);
    });

    it("paints blood with dark brick tones, never poppy red", () => {
      const s = buildFxSheet();
      const dark = new Set([...PAL.city_1943.cut_cap, ...PAL.city_1943.brick].map((c) => c.join(",")));
      for (const n of ["blood_0", "blood_1", "blood_2", "blood_3"]) {
        const im = frameImage(s, n);
        for (let i = 0; i < im.data.length; i += 4) if (im.data[i + 3]) expect(dark.has(`${im.data[i]},${im.data[i + 1]},${im.data[i + 2]}`), n).toBe(true);
      }
    });
  });

  it("is deterministic", () => {
    const same = (a: PixelImage, b: PixelImage) => Buffer.from(a.data).equals(Buffer.from(b.data));
    for (const kind of ALL_KINDS) expect(same(buildProp(kind, "intact", VARIANTS[kind]?.[0]).image, buildProp(kind, "intact", VARIANTS[kind]?.[0]).image), kind).toBe(true);
    expect(same(buildVehicleSheet("tram", "burning").image, buildVehicleSheet("tram", "burning").image)).toBe(true);
    expect(same(buildFxSheet().image, buildFxSheet().image)).toBe(true);
  });
});
