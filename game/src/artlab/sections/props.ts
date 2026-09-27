// Art lab: props in every drawn state, the four vehicles turning through 16 headings in every
// state, the effects sheet, and a street at 1x to judge them together.
//   ?only=props                      this file
//   &part=props|vehicles|fx|scene    one part of it (default: all)
import type { LabItem, LabSection } from "../main";
import type { PropKind, VehicleKind } from "../../art/types";
import { PAL, css } from "../../art/palette";
import { blit, crop, img, px, type PixelImage, type Sheet } from "../../art/pixel";
import { buildProp, PROP_KINDS, PROP_STATES } from "../../art/props";
import { buildVehicleSheet, VEHICLE_KINDS, VEHICLE_STATES, vehicleCell } from "../../art/vehicles";
import { buildFxSheet } from "../../art/fx";
import { hash2 } from "../../art/pixel";

const C = PAL.city_1943;
const PAVE = css(C.pavement[0]);
const COBBLE = css(C.cobble[1]);

const VARIANTS: Partial<Record<PropKind, (number | string)[]>> = {
  street_sign: ["DŁUGA", "BIELAŃSKA", "NALEWKI", "ŚWIĘTOJERSKA"],
  tree: [1, 2, 3],
  bench: [0, 1],
  barrier: [0, 1],
  gate: [0, 1],
  ghetto_wall: ["ew", "ns"],
  snow_heap: [1, 2, 3],
  dorozka: [0, "w"],
};

function frameOf(sheet: Sheet, name: string): PixelImage {
  const f = sheet.frames.find((q) => q.name === name)!;
  return crop(sheet.image, f.x, f.y, f.w, f.h);
}

/** Frames laid in a row with a 1 px gap. */
function strip(ims: PixelImage[], gap = 1): PixelImage {
  const w = ims.reduce((s, i) => s + i.w + gap, -gap), h = Math.max(...ims.map((i) => i.h));
  const out = img(w, h);
  let x = 0;
  for (const i of ims) { blit(out, i, x, 0); x += i.w + gap; }
  return out;
}

function propsSection(): LabSection[] {
  const items: LabItem[] = [];
  for (const kind of PROP_KINDS) {
    for (const st of PROP_STATES[kind]) {
      for (const v of VARIANTS[kind] ?? [undefined]) {
        const a = buildProp(kind, st, v);
        items.push({ label: `${kind} ${st}${v !== undefined ? ` ${v}` : ""} @${a.ax},${a.ay}`, image: a.image, bg: PAVE });
      }
    }
  }
  // the ghetto wall tiled: four east-west segments, three north-south
  const ew = buildProp("ghetto_wall", "intact", "ew"), ns = buildProp("ghetto_wall", "intact", "ns");
  const row = img(ew.image.w * 4, ew.image.h);
  for (let i = 0; i < 4; i++) blit(row, buildProp("ghetto_wall", "intact", `ew${i + 1}`).image, i * 24, 0);
  const col = img(ns.image.w, ns.image.h + 18 * 2);
  for (let i = 0; i < 3; i++) blit(col, buildProp("ghetto_wall", "intact", `ns${i + 1}`).image, 0, i * 18);
  return [
    { title: "props: every kind in its drawn states (label: anchor)", items },
    { title: "ghetto wall tiled (east-west x4, north-south x3)", items: [{ label: "ew x4", image: row, bg: COBBLE }, { label: "ns x3", image: col, bg: COBBLE }] },
  ];
}

/** The 16 headings of a sheet in a grid, each frame trimmed to the box every frame of the kind fits. */
function headingGrid(sheet: Sheet, cols: number, box: { x0: number; y0: number; x1: number; y1: number }): PixelImage {
  const w = box.x1 - box.x0, h = box.y1 - box.y0, rows = Math.ceil(sheet.frames.length / cols);
  const out = img(cols * (w + 1) - 1, rows * (h + 1) - 1);
  sheet.frames.forEach((f) => {
    const n = Number(f.name.slice(1));
    blit(out, crop(sheet.image, f.x + box.x0, f.y + box.y0, w, h), (n % cols) * (w + 1), Math.floor(n / cols) * (h + 1));
  });
  return out;
}

function vehiclesSection(only: string | null): LabSection[] {
  const out: LabSection[] = [];
  for (const kind of VEHICLE_KINDS) {
    if (only && only !== kind) continue;
    const cell = vehicleCell(kind);
    const sheets = VEHICLE_STATES.map((st) => buildVehicleSheet(kind, st));
    // the box that holds every drawn pixel of every frame, so the grids stay compact
    const box = { x0: cell.w, y0: cell.h, x1: 0, y1: 0 };
    for (const s of sheets) for (const f of s.frames) {
      for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) {
        if (!s.image.data[((f.y + y) * s.image.w + f.x + x) * 4 + 3]) continue;
        box.x0 = Math.min(box.x0, x); box.y0 = Math.min(box.y0, y); box.x1 = Math.max(box.x1, x + 1); box.y1 = Math.max(box.y1, y + 1);
      }
    }
    const items: LabItem[] = sheets.map((s, i) => ({
      label: `${kind} ${VEHICLE_STATES[i]}: h0..h15${i ? "" : ` (cell ${cell.w}x${cell.h}, anchor ${cell.ax},${cell.ay})`}`,
      image: headingGrid(s, i ? 8 : 4, box),
      scale: i ? 1 : 2,
      bg: COBBLE,
    }));
    out.push({ title: `vehicle ${kind}`, items });
  }
  return out;
}

function fxSection(): LabSection[] {
  const sheet = buildFxSheet();
  const fam = (p: string) => strip(sheet.frames.filter((f) => f.name.startsWith(p)).map((f) => crop(sheet.image, f.x, f.y, f.w, f.h)), 2);
  const items: LabItem[] = [{ label: `fx sheet ${sheet.image.w}x${sheet.image.h}, ${sheet.frames.length} frames`, image: sheet.image, bg: COBBLE }];
  for (const p of ["muzzle_", "explosion_", "fire_", "smoke_", "dust_", "snow_", "glass_", "spark_", "blood_", "scorch_", "bullet_hole_"]) items.push({ label: p.slice(0, -1), image: fam(p), bg: p === "bullet_hole_" ? css(C.plaster_ochre[1]) : COBBLE });
  return [{ title: "effects", items }];
}

/** A stretch of Długa at 1x: cobbles, pavement, props, the prison van, the car, fire and smoke. */
function sceneSection(): LabSection[] {
  const W = 400, H = 200;
  const im = img(W, H);
  // a quiet stand-in for the ground painter: slabs on the pavements, cobbles in rows on the road
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const walk = y < 44 || y > 170;
    if (walk) {
      const joint = x % 12 === 0 || y % 9 === 0;
      px(im, x, y, joint ? C.pavement[0] : hash2(x / 12 | 0, y / 9 | 0, 3) < 0.3 ? C.pavement[0] : C.pavement[1]);
    } else {
      const row = y >> 1, off = row % 2 ? 1 : 0, col = (x + off) >> 1;
      const edge = y % 2 === 1 || (x + off) % 2 === 1;
      px(im, x, y, edge ? C.cobble[0] : hash2(col, row, 9) < 0.25 ? C.cobble[2] : C.cobble[1]);
    }
  }
  const put = (a: { image: PixelImage; ax: number; ay: number }, x: number, y: number) => blit(im, a.image, x - a.ax, y - a.ay);
  const fx = buildFxSheet();
  const fxAt = (name: string, x: number, y: number) => {
    const f = fx.frames.find((q) => q.name === name)!;
    blit(im, crop(fx.image, f.x, f.y, f.w, f.h), x - f.ax, y - f.ay);
  };
  fxAt("scorch_0", 250, 120);
  fxAt("blood_1", 150, 150);
  put(buildProp("ghetto_wall", "intact", "ew1"), 12, 40);
  for (let i = 1; i < 6; i++) put(buildProp("ghetto_wall", "intact", `ew${i + 1}`), 12 + i * 24, 40);
  put(buildProp("tree", "intact", 2), 190, 42);
  put(buildProp("phone_pole", "intact"), 250, 40);
  put(buildProp("phone_pole", "destroyed"), 330, 40);
  put(buildProp("street_sign", "intact", "DŁUGA"), 170, 42);
  put(buildProp("ad_column", "intact"), 290, 40);
  put(buildProp("kiosk", "intact"), 360, 42);
  put(buildProp("snow_heap", "intact", 2), 60, 176);
  put(buildProp("lamp", "intact"), 30, 180);
  put(buildProp("sandbags", "intact"), 120, 186);
  put(buildProp("barrel", "burning"), 210, 184);
  put(buildProp("crates", "intact"), 240, 188);
  put(buildProp("dorozka", "intact", 0), 320, 186);
  const van = buildVehicleSheet("prison_truck", "burning");
  put({ image: frameOf(van, "h1"), ax: van.frames[1].ax, ay: van.frames[1].ay }, 250, 118);
  fxAt("fire_2", 262, 104);
  fxAt("smoke_3", 240, 80);
  const car = buildVehicleSheet("car", "doors_open");
  put({ image: frameOf(car, "h8"), ax: car.frames[8].ax, ay: car.frames[8].ay }, 120, 100);
  const tram = buildVehicleSheet("tram", "intact");
  put({ image: frameOf(tram, "h0"), ax: tram.frames[0].ax, ay: tram.frames[0].ay }, 330, 144);
  const blitz = buildVehicleSheet("german_truck", "wreck");
  put({ image: frameOf(blitz, "h13"), ax: blitz.frames[13].ax, ay: blitz.frames[13].ay }, 36, 88);
  put(buildProp("phone_box", "destroyed"), 150, 40);
  put(buildProp("bench", "intact", 0), 100, 186);
  put(buildProp("barrier", "intact", 0), 270, 186);
  fxAt("fire_4", 210, 184);
  fxAt("muzzle_e_0", 180, 150);
  fxAt("spark_1", 230, 140);
  fxAt("explosion_3", 60, 160);
  return [{ title: "a stretch of Długa at 1x (and 2x)", items: [{ label: "scene", image: im, scale: 2 }] }];
}

export default function (): LabSection[] {
  const q = new URLSearchParams(typeof location !== "undefined" ? location.search : "");
  const part = q.get("part") ?? "all";
  const out: LabSection[] = [];
  if (part === "all" || part === "scene") out.push(...sceneSection());
  if (part === "all" || part === "props") out.push(...propsSection());
  if (part === "all" || part === "vehicles") out.push(...vehiclesSection(q.get("kind") as VehicleKind | null));
  if (part === "all" || part === "fx") out.push(...fxSection());
  return out;
}
