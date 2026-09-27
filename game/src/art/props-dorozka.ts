// A parked dorożka: the Warsaw horse cab, a black four-wheeled carriage with its hood up against
// the late-winter cold, and a chestnut horse in a blanket with its nosebag on. Built from primitives
// like the vehicles, so facing west is the same model turned, lit from the same top-left light.
import type { PropArt } from "./types";
import { PAL, ramp, type Ramp } from "./palette";
import { Mesh, bounds, fitCell, render, toneOf, type Mat } from "./vehicles-3d";
import { C, S, IRON, PROP_SHADOW, flat } from "./props-kit";

const LACQUER: Ramp = ramp("props_extra", "car_black");
const HORSE: Ramp = PAL.troopers.partisan_jackets[1];
const MANE: Ramp = [S.outline, C.bark[0]];
const RUG: Ramp = C.cloth;
const PLUSH: Ramp = C.cut_cap;

function spokedWheel(m: Mesh, x: number, r: number, y0: number, y1: number): void {
  m.newPart();
  const cap: Mat = {
    ramp: IRON,
    tex: (h) => {
      const dx = h.x - x, dz = h.z - r, d = Math.hypot(dx, dz);
      if (d > r - 0.07) return toneOf(IRON, h.t);
      if (d < 0.08) return toneOf(LACQUER, h.t + 1);
      const a = Math.atan2(dz, dx) / (Math.PI / 6);
      return a - Math.floor(a) < 0.35 ? toneOf(LACQUER, h.t + 1) : S.glass_dark;
    },
  };
  m.cylY(x, r, r, y0, y1, 14, flat(IRON), cap);
}

export function dorozka(variant: number | string | undefined): PropArt {
  const west = variant === 1 || variant === "w" || variant === "west";
  const m = new Mesh();
  const lac = flat(LACQUER);
  // ---- carriage (rear at x = -2.7)
  const cx = -1.2;
  for (const s of [1, -1]) {
    spokedWheel(m, cx - 0.75, 0.56, s > 0 ? 0.62 : -0.68, s > 0 ? 0.68 : -0.62);
    spokedWheel(m, cx + 0.85, 0.43, s > 0 ? 0.54 : -0.6, s > 0 ? 0.6 : -0.54);
  }
  m.newPart();
  m.rod([cx - 0.75, 0, 0.5], [cx + 0.85, 0, 0.45], 0.04, 5, flat(IRON)); // the perch
  m.box(cx - 0.8, cx - 0.7, -0.66, 0.66, 0.52, 0.6, flat(IRON)); // axles
  m.box(cx + 0.8, cx + 0.9, -0.58, 0.58, 0.4, 0.48, flat(IRON));
  // body tub with the red plush seat inside
  m.newPart();
  const tub: Mat = { ramp: LACQUER, tex: (h) => (h.nz > 0.9 ? (h.x < cx - 0.35 ? toneOf(PLUSH, h.t) : toneOf(PLUSH, 0)) : undefined) };
  m.box(cx - 1.05, cx + 0.15, -0.56, 0.56, 0.62, 1.02, tub);
  m.box(cx - 1.05, cx - 0.75, -0.56, 0.56, 1.02, 1.3, lac); // seat back
  // the folding hood, up
  m.newPart();
  const hood: Mat = { ramp: [S.glass_dark, S.outline, C.soot[0], C.soot[1]], tex: (h) => (Math.abs(h.ny) > 0.9 && ((h.x - cx + 2) / 0.22) % 1 < 0.15 ? S.glass_dark : undefined) };
  m.prismY([[cx - 1.1, 1.02], [cx - 1.12, 1.52], [cx - 0.95, 1.78], [cx - 0.62, 1.86], [cx - 0.36, 1.8], [cx - 0.34, 1.7], [cx - 0.64, 1.74], [cx - 0.9, 1.64], [cx - 0.98, 1.4], [cx - 0.98, 1.02]], -0.6, 0.6, hood);
  // the coachman's box and footboard
  m.newPart();
  m.box(cx + 0.2, cx + 0.62, -0.46, 0.46, 0.9, 1.38, lac);
  m.box(cx + 0.24, cx + 0.6, -0.42, 0.42, 1.38, 1.44, { ramp: PLUSH });
  m.box(cx + 0.62, cx + 1.0, -0.4, 0.4, 0.74, 0.8, lac);
  m.box(cx + 0.98, cx + 1.04, -0.4, 0.4, 0.8, 1.12, lac);
  for (const s of [1, -1]) m.dot([cx + 0.18, s * 0.6, 1.3], C.puddle[1]); // carriage lamps
  // shafts to the horse
  m.newPart();
  for (const s of [1, -1]) m.rod([cx + 0.9, s * 0.42, 0.72], [cx + 3.3, s * 0.36, 1.08], 0.03, 4, lac);
  // ---- horse (chest at x ~ 2.2)
  const hx = cx + 3.2;
  m.newPart();
  const coat = flat(HORSE);
  for (const [lx, s] of [[hx - 1.28, 1], [hx - 1.28, -1], [hx - 0.08, 1], [hx - 0.08, -1]] as [number, number][]) {
    m.rod([lx, s * 0.15, 1.05], [lx + 0.03, s * 0.15, 0.12], 0.055, 5, coat);
    m.rod([lx + 0.03, s * 0.15, 0.12], [lx + 0.05, s * 0.15, 0.0], 0.06, 5, flat(MANE)); // hooves
  }
  m.newPart();
  m.cylX(0, 1.28, 0.33, hx - 1.45, hx + 0.05, 10, coat, coat);
  m.rod([hx - 0.02, 0, 1.36], [hx + 0.42, 0, 1.9], 0.17, 8, coat); // neck
  m.rod([hx + 0.38, 0, 1.95], [hx + 0.7, 0, 1.5], 0.11, 8, coat); // head, lowered to the bag
  m.rod([hx + 0.64, 0, 1.52], [hx + 0.74, 0, 1.36], 0.13, 8, { ramp: PAL.forest.sandbag }); // nosebag
  m.dot([hx + 0.4, -0.06, 2.1], MANE[0]);
  m.dot([hx + 0.4, 0.06, 2.1], MANE[1]);
  m.seg([hx - 0.02, 0, 1.58], [hx + 0.36, 0, 2.08], MANE[0], 0.12); // mane
  m.rod([hx - 1.46, 0, 1.4], [hx - 1.56, 0, 0.7], 0.06, 5, flat(MANE)); // tail
  // blanket and collar
  m.newPart();
  const rug: Mat = { ramp: RUG, tex: (h) => (Math.abs(h.x - (hx - 0.72)) > 0.5 ? toneOf(PLUSH, h.t) : undefined) };
  m.prismX([[-0.36, 1.18], [0.36, 1.18], [0.37, 1.45], [0.22, 1.63], [-0.22, 1.63], [-0.37, 1.45]], hx - 1.3, hx - 0.18, rug);
  m.rod([hx - 0.05, 0, 1.3], [hx + 0.07, 0, 1.46], 0.24, 8, { ramp: PAL.troopers.headgear.cap });
  const yaw = west ? Math.PI : 0;
  const cell = fitCell(bounds(m, yaw, PROP_SHADOW), 2);
  const r = render(m, { yaw, cell, outline: "br", edge: 0.12, shadow: PROP_SHADOW });
  return { image: r.image, ax: r.ax, ay: r.ay };
}
