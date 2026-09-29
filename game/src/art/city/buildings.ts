// Warsaw tenements (kamienice) in March 1943, drawn as code (style guide §7).
//
// Only roofs and south walls are ever visible. The image is the roof rectangle (w*12 x d*9
// px) directly above the south wall (w*12 x round(h*7.5) px), h = storeys*3.2 + 0.8 m, so
// its top-left sits at screen (12x, 9y - 7.5h). A storey is 24 px, the top 6 px of the wall
// are the cornice and parapet. Light from the top left: roofs lit, the wall mid tone, darker
// low down and to the right, a 1 px outline (§4). The cut version (§7 "The street cut") has
// the same bounds: knee-high walls with a sawn cap, floorboards, partitions, furniture and
// shop counters, and the ghost of the full volume.
import type { RGB, Ramp } from "../palette";
import { PAL } from "../palette";
import type { PixelImage } from "../pixel";
import { hash2, hline, img, px, rect, rng, vline } from "../pixel";
import type { BuildingArt, BuildingBuilder, BuildingSpec } from "../types";
import { lumpTex, noiseTex, roofRamp, trimRamp, wallRamp, X as XTRA } from "./common";
import { drawText, measureText } from "./font";
import * as I from "./interior";

const C = PAL.city_1943, S = PAL.shared;

export const STOREY_PX = 24;
/** Wall height in metres (types.ts: storeys * 3.2 + 0.8). */
export const wallHeight = (storeys: number): number => storeys * 3.2 + 0.8;

type WinState = "glass" | "dark" | "lit";
interface Feature { kind: "shop" | "gate" | "door"; x0: number; x1: number; sign?: string }

/** Everything decided about one facade before a pixel is drawn. */
interface Facade {
  spec: BuildingSpec;
  W: number; RH: number; WH: number; H: number; n: number;
  P: Ramp; T: Ramp; R: Ramp;
  axes: number[];
  features: Feature[];
  groundAxes: number[];
  balconies: Set<string>;
  frame: RGB;
  rustic: boolean;
  heads: ("pediment" | "cornice" | "plain")[];
  cornice: "dentil" | "bracket";
  stringAll: boolean;
  lit: number;
  gable: boolean;
  signBoards: RGB[][];
  shopPaint: Ramp;
  bars: boolean;
  pocks: boolean;
}

const hashS = (a: number, b: number, s: number) => hash2(a, b, s * 7 + 13);

function plan(spec: BuildingSpec): Facade {
  const h = wallHeight(spec.storeys);
  const W = spec.w * 12, RH = spec.d * 9, WH = Math.round(h * 7.5);
  const r = rng(spec.seed * 2654435761 + 97);
  const P = wallRamp(spec.plaster), T = trimRamp(spec.plaster), R = roofRamp(spec.roof);
  const n = Math.max(1, Math.round((W - 24) / 31));
  const s = (W - 24) / n;
  const axes = Array.from({ length: n }, (_, i) => Math.round(12 + s * (i + 0.5)));
  const front = spec.front ?? {};
  const features: Feature[] = [];
  for (const sh of front.shops ?? []) features.push({ kind: "shop", x0: Math.round(sh.x * 12), x1: Math.round((sh.x + sh.w) * 12), sign: sh.sign });
  for (const g of front.gateways ?? []) features.push({ kind: "gate", x0: Math.round(g * 12), x1: Math.round(g * 12) + 36 });
  for (const d of front.doors ?? []) features.push({ kind: "door", x0: Math.round(d * 12), x1: Math.round(d * 12) + 13 });
  const blocked = (cx: number) => features.some((f) => cx + 8 > f.x0 - 2 && cx - 8 < f.x1 + 2);
  const groundAxes = axes.filter((cx) => !blocked(cx));
  const balconies = new Set<string>();
  if (front.balconies && spec.storeys >= 2) {
    const mid = n % 2 ? [(n - 1) / 2] : n >= 4 ? [n / 2 - 1, n / 2] : [Math.floor(n / 2)];
    const floors = spec.storeys >= 4 ? [1, 2] : [1];
    for (const f of floors) for (const a of mid) balconies.add(`${f}:${a}`);
    if (n >= 6 && r() < 0.6) for (const a of [0, n - 1]) balconies.add(`1:${a}`);
  }
  const frames: RGB[] = [C.cloth[2], C.cloth[2], C.wood[0], XTRA.paintGreen()[1]];
  const fancy = r();
  const heads: Facade["heads"] = [];
  for (let f = 0; f < spec.storeys; f++) {
    heads.push(f === 0 ? "plain" : f === 1 ? (fancy < 0.55 ? "pediment" : "cornice") : f === spec.storeys - 1 ? "plain" : fancy < 0.8 ? "cornice" : "plain");
  }
  const boards: RGB[][] = [
    // board, edge, letters
    [XTRA.paintGreen()[0], XTRA.paintGreen()[2], C.plaster_ochre[2]],
    [C.soot[0], C.soot[2], S.chalk],
    [C.brick[0], C.brick[2], C.tram_cream[1]],
    [C.wood[0], C.wood[2], C.tram_cream[1]],
    [C.plaster_cream[2], C.plaster_cream[0], C.soot[0]],
  ];
  const shopPaints: Ramp[] = [XTRA.paintGreen(), C.wood, C.soot];
  return {
    spec, W, RH, WH, H: RH + WH, n, P, T, R, axes, features, groundAxes, balconies,
    frame: frames[Math.floor(r() * frames.length)],
    rustic: spec.plaster !== "brick" && r() < 0.65,
    heads,
    cornice: r() < 0.5 ? "dentil" : "bracket",
    stringAll: r() < 0.35,
    lit: front.lit ?? 0.12,
    gable: r() < 0.6,
    signBoards: boards,
    shopPaint: shopPaints[Math.floor(r() * shopPaints.length)],
    bars: r() < 0.5,
    pocks: r() < 0.4,
  };
}

function winState(f: Facade, floor: number, axis: number): WinState {
  const q = hashS(axis * 7 + 3, floor * 13 + 5, f.spec.seed);
  if (q < f.lit) return "lit";
  return hashS(axis, floor, f.spec.seed + 1) < 0.24 ? "dark" : "glass";
}

// ------------------------------------------------------------------ windows and doors

const WIN = [
  "sssssssssss",
  "sFFFFFFFFFr",
  "sFhggFhggFr",
  "sFgggFgggFr",
  "sFFFFFFFFFr",
  "sFhggFhggFr",
  "sFghgFgggFr",
  "sFgggFgggFr",
  "sFgggFgggFr",
  "sFgggFgggFr",
  "sFFFFFFFFFr",
];

function glazing(im: PixelImage, f: Facade, x0: number, y0: number, rows: string[], state: WinState, variant: number): void {
  const pane = state === "lit" ? S.window_lit : state === "dark" ? S.glass_dark : S.glass;
  const hi = state === "lit" ? S.fire[2] : state === "dark" ? C.soot[0] : C.puddle[1];
  const frame = state === "lit" ? C.wood[0] : f.frame;
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const k = row[x];
      const c = k === "s" ? S.outline : k === "r" ? f.T[1] : k === "F" ? frame : k === "h" ? hi : pane;
      px(im, x0 + x, y0 + y, c);
    }
  });
  // curtains: lace half-curtains, side curtains, or a lamp-lit curtain
  const bottom = y0 + rows.length - 2;
  if (state === "glass" && variant % 3 === 1) {
    for (let x = x0 + 2; x <= x0 + 8; x++) if (x !== x0 + 5) { px(im, x, y0 + 5, C.cloth[2]); if ((x & 1) === 0) px(im, x, y0 + 6, C.cloth[1]); }
  } else if (state === "glass" && variant % 3 === 2) {
    for (let y = y0 + 2; y <= bottom; y++) { px(im, x0 + 2, y, C.cloth[1]); px(im, x0 + 8, y, C.cloth[1]); }
  } else if (state === "lit") {
    for (let y = y0 + 2; y <= bottom; y++) px(im, x0 + (variant & 1 ? 2 : 8), y, C.plaster_ochre[2]);
  }
}

function window(im: PixelImage, f: Facade, cx: number, y0: number, floor: number, axis: number, ground = false): void {
  const { P, T } = f;
  const x0 = cx - 5;
  const variant = Math.floor(hashS(axis, floor, f.spec.seed + 2) * 9);
  // surround: lit top and left, shade right
  hline(im, x0 - 1, x0 + 11, y0 - 1, T[2]);
  vline(im, x0 - 1, y0 - 1, y0 + 10, T[2]);
  vline(im, x0 + 11, y0 - 1, y0 + 10, P[0]);
  const head = f.heads[floor];
  if (head === "cornice") {
    hline(im, x0 - 2, x0 + 12, y0 - 3, T[2]);
    hline(im, x0 - 2, x0 + 12, y0 - 2, P[0]);
  } else if (head === "pediment") {
    for (let i = 0; i < 4; i++) {
      const yy = y0 - 2 - i, half = 7 - i * 2;
      hline(im, cx - half, cx + half, yy, i === 0 ? P[0] : T[1]);
      px(im, cx - half, yy, T[2]);
      px(im, cx + half, yy, P[0]);
    }
    px(im, cx, y0 - 6, T[2]);
  }
  glazing(im, f, x0, y0, WIN, winState(f, floor, axis), variant);
  if (ground && f.bars) for (let x = x0 + 2; x <= x0 + 8; x += 2) if (x !== x0 + 5) vline(im, x, y0 + 1, y0 + 9, S.outline);
  // sill, its shadow, snow lying on it, and the dirt it washes down the wall
  hline(im, x0 - 1, x0 + 11, y0 + 11, T[2]);
  hline(im, x0, x0 + 11, y0 + 12, P[0]);
  const snow = hashS(axis, floor, f.spec.seed + 3);
  if (snow < 0.55) {
    const a = x0 + Math.floor(snow * 8), b = Math.min(x0 + 11, a + 3 + Math.floor(snow * 13));
    hline(im, a, b, y0 + 11, C.dirty_snow[2]);
    if (b - a > 4) px(im, a + 2, y0 + 10 + 0, C.dirty_snow[1]);
  }
  if (hashS(axis, floor, f.spec.seed + 4) < 0.45) {
    const len = 2 + Math.floor(hashS(axis, floor, f.spec.seed + 5) * 5);
    vline(im, x0 + (snow < 0.3 ? 0 : 10), y0 + 13, y0 + 12 + len, P[0]);
  }
}

function balcony(im: PixelImage, f: Facade, cx: number, y0: number, floorLine: number, floor: number, axis: number): void {
  const { P, T } = f;
  const x0 = cx - 5;
  // the French window reaches the floor
  const rows = ["sssssssssss", "sFFFFFFFFFr", "sFhggFhggFr", "sFgggFgggFr", "sFFFFFFFFFr"];
  for (let y = 5; y < floorLine - y0; y++) rows.push(y === floorLine - y0 - 1 ? "sFFFFFFFFFr" : y % 6 === 4 ? "sFFFFFFFFFr" : "sFgggFgggFr");
  hline(im, x0 - 1, x0 + 11, y0 - 1, T[2]);
  vline(im, x0 - 1, y0 - 1, floorLine - 1, T[2]);
  vline(im, x0 + 11, y0 - 1, floorLine - 1, P[0]);
  hline(im, x0 - 2, x0 + 12, y0 - 3, T[2]);
  hline(im, x0 - 2, x0 + 12, y0 - 2, P[0]);
  glazing(im, f, x0, y0, rows, winState(f, floor, axis), 1);
  // slab (0.6 m deep, seen from above), its shadow on the wall, two brackets
  const bx0 = x0 - 6, bx1 = x0 + 16;
  rect(im, bx0, floorLine, bx1 - bx0 + 1, 4, T[1]);
  hline(im, bx0, bx1, floorLine, T[2]);
  hline(im, bx0, bx1, floorLine + 4, S.outline);
  hline(im, bx0 + 1, bx1 + 1, floorLine + 5, P[0]);
  hline(im, bx0 + 1, bx1 + 1, floorLine + 6, P[0]);
  for (const kx of [bx0 + 2, bx1 - 3]) { rect(im, kx, floorLine + 5, 2, 3, T[1]); vline(im, kx + 2, floorLine + 5, floorLine + 7, P[0]); }
  // wrought-iron railing on the slab's front edge, 1 m tall
  const top = floorLine + 4 - 7;
  hline(im, bx0, bx1, top, S.outline);
  hline(im, bx0, bx1, floorLine + 3, S.outline);
  for (let x = bx0; x <= bx1; x += 2) vline(im, x, top, floorLine + 3, S.outline);
  for (let x = bx0 + 3; x < bx1 - 1; x += 6) { px(im, x, top + 3, S.outline); px(im, x + 1, top + 2, S.outline); px(im, x + 1, top + 4, S.outline); }
  if (hashS(axis, floor, f.spec.seed + 6) < 0.6) hline(im, bx0 + 1, bx1 - 2, top - 1, C.dirty_snow[2]); // snow on the rail
  if (hashS(axis, floor, f.spec.seed + 7) < 0.4) { rect(im, bx1 - 5, floorLine + 1, 3, 2, C.brick[1]); px(im, bx1 - 4, floorLine, C.plaster_green[0]); } // a flower box, bare
}

function door(im: PixelImage, f: Facade, x0: number, bottom: number, paint: Ramp): void {
  const { P, T } = f;
  const top = bottom - 19;
  hline(im, x0 - 1, x0 + 13, top - 1, T[2]);
  hline(im, x0 - 2, x0 + 14, top - 3, T[2]);
  hline(im, x0 - 2, x0 + 14, top - 2, P[0]);
  vline(im, x0 - 1, top - 1, bottom - 1, T[2]);
  vline(im, x0 + 13, top - 1, bottom - 1, P[0]);
  // fanlight
  rect(im, x0, top, 13, 4, S.outline);
  rect(im, x0 + 1, top + 1, 11, 2, S.glass);
  px(im, x0 + 2, top + 1, C.puddle[1]);
  vline(im, x0 + 6, top + 1, top + 2, paint[0]);
  // two leaves with raised panels
  rect(im, x0, top + 4, 13, 15, paint[1]);
  vline(im, x0, top + 4, bottom - 1, S.outline);
  vline(im, x0 + 6, top + 4, bottom - 1, paint[0]);
  vline(im, x0 + 12, top + 4, bottom - 1, paint[0]);
  for (const lx of [x0 + 2, x0 + 8]) {
    rect(im, lx, top + 6, 3, 5, paint[0]); hline(im, lx, lx + 2, top + 6, paint[2]);
    rect(im, lx, top + 13, 3, 4, paint[0]); hline(im, lx, lx + 2, top + 13, paint[2]);
  }
  px(im, x0 + 5, top + 12, C.plaster_ochre[2]); // brass handle
  hline(im, x0 - 1, x0 + 13, bottom, C.stone_grey[2]); // the step
}

/** A cast-iron downpipe standing off the wall: hopper, brackets, its shadow, a shoe at the
 *  foot with a lump of ice under it. */
function downpipe(im: PixelImage, f: Facade, x: number, top: number, bottom: number): void {
  const t = C.tin_roof;
  rect(im, x - 1, top, 4, 3, t[1]);
  hline(im, x - 1, x + 2, top, t[2]);
  vline(im, x + 3, top, top + 2, S.outline);
  for (let y = top + 3; y < bottom; y++) { px(im, x, y, t[2]); px(im, x + 1, y, t[0]); px(im, x + 2, y, f.P[0]); }
  for (let y = top + 10; y < bottom - 3; y += 14) { px(im, x - 1, y, S.outline); px(im, x + 2, y, S.outline); }
  px(im, x + 2, bottom - 1, t[1]);
  px(im, x + 3, bottom - 1, t[0]);
  hline(im, x - 1, x + 3, bottom, C.dirty_snow[1]);
  px(im, x + 1, bottom + 1, C.dirty_snow[0]);
}

/** A notice posted on the wall (red-framed like the occupier's proclamations, or black),
 *  lines of print, a torn corner. */
function notice(im: PixelImage, x: number, y: number, red: boolean): void {
  const paper = C.tram_cream[1], frame = red ? C.brick[2] : C.soot[1];
  rect(im, x, y, 6, 8, paper);
  hline(im, x, x + 5, y, frame);
  hline(im, x, x + 5, y + 7, frame);
  vline(im, x, y, y + 7, frame);
  vline(im, x + 5, y, y + 7, frame);
  hline(im, x + 1, x + 4, y + 2, C.soot[0]);
  for (let yy = y + 4; yy < y + 7; yy++) for (let xx = x + 1; xx < x + 5; xx++) if ((xx + yy) % 3 !== 0) px(im, xx, yy, C.cloth[0]);
  px(im, x + 5, y + 7, C.cloth[1]); // the torn corner
  vline(im, x + 6, y + 1, y + 8, S.outline);
}

function gateway(im: PixelImage, f: Facade, x0: number, bottom: number): void {
  const { P, T } = f;
  const w = 36, spring = bottom - 17, rise = 6;
  const archTop = (x: number) => {
    const t = (x + 0.5 - w / 2) / (w / 2);
    return Math.round(spring - rise * Math.sqrt(Math.max(0, 1 - t * t)));
  };
  // rusticated surround: voussoirs round the arch, blocks down the jambs
  for (let x = -3; x < w + 3; x++) {
    const inner = x >= 0 && x < w;
    const yTop = inner ? archTop(x) : spring;
    for (let d = 1; d <= 3; d++) {
      const y = yTop - d;
      const c = d === 3 ? T[2] : ((x + 40) % 5 === 0 ? P[0] : T[1]);
      px(im, x0 + x, y, c);
    }
  }
  for (let y = spring - 1; y < bottom; y++) {
    const band = ((bottom - y) / 4) | 0;
    for (const [a, b2] of [[-3, -1], [w, w + 2]]) for (let x = a; x <= b2; x++) {
      const joint = (bottom - y) % 4 === 0;
      px(im, x0 + x, y, joint ? P[0] : x === a ? T[2] : band % 2 ? T[1] : T[2]);
    }
  }
  // keystone
  rect(im, x0 + w / 2 - 2, spring - rise - 5, 4, 5, T[2]);
  vline(im, x0 + w / 2 + 1, spring - rise - 4, spring - rise - 1, P[0]);
  // the dark passage: setts receding into the gloom, gate leaves folded back
  for (let x = 0; x < w; x++) {
    for (let y = archTop(x); y < bottom; y++) {
      const depth = bottom - y; // 0 at the street, up to ~22 in the dark
      let c: RGB = S.glass_dark;
      if (depth < 9) {
        const row = (depth / 3) | 0, joint = depth % 3 === 0 || (x + row * 2) % 5 === 0;
        c = joint ? C.mortar : depth < 4 ? C.cobble[1] : C.cobble[0];
      } else if (depth < 13) c = (x + y) % 2 ? C.soot[0] : S.outline;
      else c = S.glass_dark;
      px(im, x0 + x, y, c);
    }
  }
  for (const [a, b2] of [[0, 2], [w - 3, w - 1]]) {
    for (let x = a; x <= b2; x++) for (let y = spring - 2; y < bottom; y++) px(im, x0 + x, y, x === a ? C.wood[0] : C.wood[1]);
  }
  hline(im, x0, x0 + w - 1, bottom, C.stone_grey[2]); // worn threshold stone
}

function shopFront(im: PixelImage, f: Facade, ft: Feature, bottom: number, k: number): void {
  const paint = f.shopPaint;
  const x0 = ft.x0, x1 = ft.x1, w = x1 - x0;
  const top = bottom - 20;
  // frame and bulkhead
  rect(im, x0 - 1, top - 1, w + 2, 21, paint[0]);
  hline(im, x0 - 1, x1, top - 1, paint[2]);
  rect(im, x0, bottom - 3, w, 3, paint[1]);
  hline(im, x0, x1 - 1, bottom - 3, paint[2]);
  hline(im, x0 - 1, x1, bottom, C.stone_grey[2]);
  // glass, a shop door at one end when the front is wide enough
  const doorW = w >= 20 ? 8 : 0;
  const doorAtLeft = hashS(k, 3, f.spec.seed) < 0.5;
  const gx0 = doorAtLeft ? x0 + doorW : x0, gx1 = doorAtLeft ? x1 : x1 - doorW;
  rect(im, gx0 + 1, top + 1, gx1 - gx0 - 2, 15, S.glass);
  // the display: a shelf of goods, a reflection across the pane
  const goods = I.goodsFor(ft.sign);
  hline(im, gx0 + 1, gx1 - 2, top + 11, paint[2]);
  for (let x = gx0 + 2; x < gx1 - 2; x++) {
    const q = hash2(x, k, f.spec.seed + 8);
    if (q < 0.62) { const c = goods[Math.floor(q * 17) % goods.length]; px(im, x, top + 10, c); if (q < 0.3) px(im, x, top + 9, c); }
    if (q > 0.75) px(im, x, top + 13, goods[Math.floor(q * 23) % goods.length]);
  }
  for (let i = 0; i < 5; i++) { const x = gx0 + 3 + i, y = top + 2 + i; if (x < gx1 - 1) px(im, x, y, C.puddle[1]); }
  for (let i = 0; i < 3; i++) { const x = gx0 + 6 + i, y = top + 2 + i; if (x < gx1 - 1) px(im, x, y, C.puddle[1]); }
  if (doorW) {
    const dx = doorAtLeft ? x0 : x1 - doorW;
    rect(im, dx, top, doorW, 20, paint[0]);
    rect(im, dx + 2, top + 2, doorW - 4, 8, S.glass);
    px(im, dx + 2, top + 2, C.puddle[1]);
    rect(im, dx + 2, top + 12, doorW - 4, 5, paint[1]);
    px(im, doorAtLeft ? dx + doorW - 2 : dx + 1, top + 11, C.plaster_ochre[2]);
  }
  // a rolled-up awning over the window
  hline(im, x0 - 1, x1, top - 3, C.cloth[1]);
  hline(im, x0 - 1, x1, top - 2, C.cloth[0]);
  for (let x = x0; x < x1; x += 4) px(im, x, top - 3, C.tram[1]);
  // the sign board over the shop, the name in the pixel font
  if (ft.sign) {
    const text = ft.sign.toUpperCase();
    const m = measureText(text);
    const bh = 7 + (m.above ? 1 : 0) + (m.below ? 1 : 0);
    const need = m.w + 6;
    const cxm = (x0 + x1) >> 1;
    const bw = Math.max(w + 2, need);
    let bx0 = Math.round(cxm - bw / 2);
    bx0 = Math.max(1, Math.min(f.W - 2 - bw, bx0));
    const by1 = top - 4, by0 = by1 - bh;
    const [board, edge, ink] = f.signBoards[Math.floor(hashS(k, 1, f.spec.seed) * f.signBoards.length)];
    rect(im, bx0, by0, bw, bh, board);
    hline(im, bx0, bx0 + bw - 1, by0, edge);
    vline(im, bx0, by0, by1 - 1, edge);
    hline(im, bx0, bx0 + bw - 1, by1, S.outline);
    vline(im, bx0 + bw, by0, by1, S.outline);
    drawText(im, text, bx0 + Math.floor((bw - m.w) / 2), by0 + 1 + (m.above ? 1 : 0) + 0, ink);
  }
}

// ------------------------------------------------------------------ the facade

function paintFacade(im: PixelImage, f: Facade): void {
  const { W, RH, WH, H, P, T, spec } = f;
  const y0 = RH; // top of the wall
  const n = spec.storeys;
  const NT = noiseTex();
  // the wall: plaster, brick courses or ashlar
  rect(im, 0, y0, W, WH, P[1]);
  if (spec.plaster === "brick") {
    for (let y = y0 + 6; y < H; y++) {
      const course = y - y0;
      if (course % 3 === 0) { hline(im, 0, W - 1, y, P[0]); continue; }
      const off = (Math.floor(course / 3) % 2) * 4;
      for (let x = off; x < W; x += 8) px(im, x, y, P[0]);
      for (let x = 0; x < W; x++) if (hash2(x, y, spec.seed) < 0.05) px(im, x, y, P[2]);
    }
  } else if (spec.plaster === "stone") {
    for (let y = y0 + 6; y < H; y++) {
      const course = Math.floor((y - y0) / 6), joint = (y - y0) % 6 === 0;
      if (joint) { hline(im, 0, W - 1, y, P[0]); continue; }
      const off = course % 2 ? 7 : 0;
      for (let x = off; x < W; x += 14) px(im, x, y, P[0]);
      if ((y - y0) % 6 === 1) for (let x = 0; x < W; x++) if ((x - off + 14) % 14 !== 0) px(im, x, y, P[2]);
    }
  } else {
    // weathered plaster: a few small damp stains, and the dirty splash zone near the street
    for (let y = y0 + 6; y < H - 4; y++) for (let x = 0; x < W; x++) {
      const nv = NT[(((y * 3 + spec.seed * 17) & 255) << 8) | ((x * 2 + spec.seed * 29) & 255)];
      if (nv < 4) px(im, x, y, P[0]);
    }
    for (let x = 0; x < W; x++) {
      const up = Math.floor(hash2(x >> 1, 3, spec.seed + 21) * 5);
      for (let y = H - 6 - up; y < H - 5; y++) if (hash2(x, y, spec.seed + 22) < 0.5) px(im, x, y, P[0]);
    }
  }
  // ground floor: rustication grooves, then the plinth
  const gTop = y0 + WH - STOREY_PX;
  if (f.rustic) for (let y = gTop + 3; y < H - 5; y += 4) { hline(im, 0, W - 1, y, P[0]); hline(im, 0, W - 1, y + 1, T[2]); }
  rect(im, 0, H - 5, W, 5, C.stone_grey[1]);
  hline(im, 0, W - 1, H - 5, C.stone_grey[2]);
  for (let x = 0; x < W; x += 9) vline(im, x, H - 4, H - 2, C.stone_grey[0]);
  // mud splashed up the plinth from the slushy street
  for (let x = 0; x < W; x++) {
    const q = hash2(x, 1, spec.seed + 20);
    if (q < 0.4) px(im, x, H - 2, C.stone_grey[0]);
    if (q < 0.12) px(im, x, H - 3, C.stone_grey[0]);
    if (q > 0.93) px(im, x, H - 6, P[0]);
  }
  // string courses
  const course = (y: number) => { hline(im, 0, W - 1, y, T[2]); hline(im, 0, W - 1, y + 1, P[0]); };
  course(gTop - 1);
  if (f.stringAll) for (let k = 2; k < n; k++) hline(im, 0, W - 1, y0 + WH - STOREY_PX * k - 1, T[2]);
  // plaster fallen away, bare brick beneath (rare on a stone or brick front)
  if (spec.plaster !== "brick" && spec.plaster !== "stone") {
    const patches = Math.floor(hashS(1, 2, spec.seed) * 2.6);
    for (let p = 0; p < patches; p++) {
      const pw = 9 + Math.floor(hashS(p, 7, spec.seed) * 8), ph = 5 + Math.floor(hashS(p, 8, spec.seed) * 4);
      const px0 = Math.floor(hashS(p, 5, spec.seed) * (W - pw - 8)) + 4;
      const py0 = y0 + 10 + Math.floor(hashS(p, 6, spec.seed) * (WH - 44));
      const inside = (x: number, y: number) => {
        const dx = (x + 0.5 - pw / 2) / (pw / 2), dy = (y + 0.5 - ph / 2) / (ph / 2);
        return dx * dx + dy * dy < 0.8 + hash2(x >> 1, y, spec.seed + p) * 0.4;
      };
      for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
        if (!inside(x, y)) continue;
        const mortar = y % 2 === 0 || (x + (y >> 1) * 2) % 4 === 0;
        px(im, px0 + x, py0 + y, !inside(x, y - 1) ? P[0] : mortar ? C.brick[0] : C.brick[1]);
        if (!inside(x, y + 1)) px(im, px0 + x, py0 + y + 1, P[2]); // the broken plaster's lit lip
      }
    }
  }
  // September 1939: shrapnel pocks, patched or not
  if (f.pocks) {
    const cxp = hashS(3, 3, spec.seed) * W, cyp = y0 + 10 + hashS(3, 4, spec.seed) * (WH - 30);
    for (let i = 0; i < 14; i++) {
      const x = Math.round(cxp + (hashS(i, 9, spec.seed) - 0.5) * 30), y = Math.round(cyp + (hashS(i, 10, spec.seed) - 0.5) * 14);
      px(im, x, y, P[0]);
      px(im, x + 1, y + 1, T[2]);
    }
  }
  // upper floors: windows and balconies
  for (let k = 1; k < n; k++) {
    const sTop = y0 + WH - STOREY_PX * (k + 1);
    f.axes.forEach((cx, a) => {
      if (f.balconies.has(`${k}:${a}`)) balcony(im, f, cx, sTop + 6, sTop + STOREY_PX, k, a);
      else window(im, f, cx, sTop + 6, k, a);
    });
  }
  // ground floor: windows between the shops, gateways and doors
  for (const cx of f.groundAxes) window(im, f, cx, gTop + 6, 0, f.axes.indexOf(cx), true);
  const doorPaints: Ramp[] = [XTRA.paintGreen(), C.wood, C.wood];
  f.features.forEach((ft, k) => {
    if (ft.kind === "gate") gateway(im, f, ft.x0, H - 1);
    else if (ft.kind === "door") door(im, f, ft.x0, H - 1, doorPaints[Math.floor(hashS(k, 11, spec.seed) * 3)]);
  });
  // cast-iron downpipes from the roof gutter at one or both ends of the front
  const pipes = hashS(9, 1, spec.seed) < 0.5 ? [3] : hashS(9, 2, spec.seed) < 0.5 ? [W - 7] : [3, W - 7];
  for (const x of pipes) downpipe(im, f, x, y0 + 4, H - 5);
  f.features.forEach((ft, k) => { if (ft.kind === "shop") shopFront(im, f, ft, H - 1, k); });
  // notices posted by the occupier and pasted over, at eye height beside a door or gateway
  const posts = f.features.filter((ft) => ft.kind !== "shop");
  posts.forEach((ft, k) => {
    if (hashS(k, 12, spec.seed) > 0.55) return;
    const left = hashS(k, 13, spec.seed) < 0.5;
    const nx = left ? ft.x0 - 12 : ft.x1 + 5;
    if (nx < 6 || nx + 7 > W - 4 || f.features.some((o) => o !== ft && nx + 8 > o.x0 - 1 && nx - 1 < o.x1)) return;
    if (f.groundAxes.some((cx) => nx + 8 > cx - 7 && nx - 1 < cx + 7)) return;
    notice(im, nx, H - 18, hashS(k, 14, spec.seed) < 0.5);
  });
  // the cornice and the parapet over it
  hline(im, 0, W - 1, y0, T[2]);
  hline(im, 0, W - 1, y0 + 1, P[1]);
  hline(im, 0, W - 1, y0 + 2, T[2]);
  hline(im, 0, W - 1, y0 + 3, T[1]);
  if (f.cornice === "dentil") for (let x = 1; x < W; x += 3) px(im, x, y0 + 3, P[0]);
  hline(im, 0, W - 1, y0 + 4, S.outline);
  hline(im, 0, W - 1, y0 + 5, P[0]);
  if (f.cornice === "bracket") for (let x = 6; x < W - 4; x += 12) { rect(im, x, y0 + 4, 2, 3, T[1]); px(im, x + 2, y0 + 5, P[0]); px(im, x + 2, y0 + 6, P[0]); }
  // soot and rain streaks from the cornice
  for (let x = 0; x < W; x++) {
    const q = hash2(x, 7, spec.seed + 30);
    if (q < 0.1) vline(im, x, y0 + 6, y0 + 7 + Math.floor(q * 60), P[0]);
  }
  // the east end in shade, the west edge catching the light, outline right and bottom
  vline(im, W - 2, y0, H - 1, P[0]);
  vline(im, 0, y0 + 6, H - 6, T[2]);
  vline(im, W - 1, y0, H - 1, S.outline);
  hline(im, 0, W - 1, H - 1, S.outline);
}

// ------------------------------------------------------------------ the roof

function paintRoof(im: PixelImage, f: Facade): void {
  const { W, RH, R, T, P, spec } = f;
  const lumps = lumpTex(), NT = noiseTex();
  const ridge = f.gable ? Math.round(RH * 0.36) : -1;
  // per sheet and lap of a tin roof: a paler replaced sheet, or rust at the lap
  const sheets = (W >> 3) + 1, laps = Math.ceil((RH + 12) / 18) + 1;
  const sheetKind = new Uint8Array(sheets * laps);
  if (spec.roof === "tin") for (let s = 0; s < sheets; s++) for (let l = 0; l < laps; l++) {
    sheetKind[s * laps + l] = (hash2(s, l, spec.seed + 40) < 0.12 ? 1 : 0) | (hash2(s, l, spec.seed + 41) < 0.16 ? 2 : 0);
  }
  // slopes: the north one faces the light, the south one (towards us) is a tone darker
  for (let y = 0; y < RH; y++) {
    const north = f.gable ? y < ridge : false;
    for (let x = 0; x < W; x++) {
      let c = north ? R[2] : R[1];
      if (spec.roof === "tin") {
        // standing seams every 8 px, a paler replaced sheet here and there, rust at the laps
        const seam = x & 7, sheet = x >> 3, yy = y + (sheet % 3) * 6, kind = sheetKind[sheet * laps + Math.floor(yy / 18)];
        if (seam === 0) c = north ? R[1] : R[2];
        else if (kind & 1) c = north ? R[1] : R[2];
        if (kind & 2 && seam === 1 + (sheet % 5) && yy % 18 > 11) c = C.wood[north ? 1 : 0];
      } else if (spec.roof === "tar") {
        // tar paper laid in 1 m strips, the laps catching the light, fresh tar in soft stains
        const strip = y % 9;
        c = strip === 0 ? R[2] : strip === 1 ? R[0] : R[1];
        const stain = NT[(((y * 3 + spec.seed * 5) & 255) << 8) | ((x * 2 + spec.seed * 9) & 255)];
        if (strip > 1 && stain < 30) c = R[0];
        else if (strip > 1 && stain > 244) c = R[2];
      } else {
        const courseY = y % 3;
        c = courseY === 0 ? R[0] : north ? R[2] : R[1];
        if (courseY !== 0 && (x + Math.floor(y / 3) * 2) % 4 === 0) c = R[0];
      }
      px(im, x, y, c);
    }
  }
  if (f.gable) { hline(im, 0, W - 1, ridge, R[2]); hline(im, 0, W - 1, ridge + 1, R[0]); }
  // the rear eave and gutter, the fire walls on both sides, the parapet coping at the front
  hline(im, 0, W - 1, 0, S.outline);
  hline(im, 0, W - 1, 1, R[0]);
  const fw = spec.plaster === "brick" ? C.brick : P;
  for (let y = 1; y < RH; y++) {
    px(im, 0, y, T[2]); px(im, 1, y, fw[2]); px(im, 2, y, fw[1]); px(im, 3, y, R[0]);
    px(im, W - 3, y, fw[2]); px(im, W - 2, y, fw[1]); px(im, W - 1, y, S.outline);
  }
  rect(im, 0, RH - 3, W - 1, 2, T[2]);
  hline(im, 0, W - 1, RH - 1, T[1]);
  hline(im, 2, W - 3, RH - 4, R[0]);
  // chimney stacks on the fire walls and the spine, a hatch, a skylight over the stairs
  const stacks: [number, number, number, number][] = [];
  const depth = spec.d;
  const along = Math.min(3, Math.max(1, Math.round(depth / 6)));
  for (let i = 0; i < along; i++) {
    const ry = Math.round(((i + 0.5) / along) * (RH - 30)) + 8;
    if (hashS(i, 20, spec.seed) < 0.8) stacks.push([2, ry, 8, 10]);
    if (hashS(i, 21, spec.seed) < 0.8) stacks.push([W - 10, ry + 4, 8, 10]);
  }
  const mids = Math.max(1, Math.floor(spec.w / 7));
  for (let i = 0; i < mids; i++) {
    if (hashS(i, 22, spec.seed) < 0.45) continue;
    const cx = Math.round(((i + 0.5) / mids) * (W - 30)) + 12;
    stacks.push([cx, Math.max(4, ridge - 6), 7, 7]);
  }
  const gate = f.features.find((ft) => ft.kind === "gate");
  const skyX = gate ? Math.min(W - 20, gate.x1 + 2) : Math.round(W * 0.3);
  skylight(im, skyX, Math.max(6, ridge + 4));
  if (spec.w > 10) hatch(im, f, Math.round(W * 0.66), Math.max(5, ridge - 5));
  // snow: a drift against the parapet, a line along the fire walls, patches left on the
  // shaded northern slope; dark tar paper warms and keeps less
  const keep = spec.roof === "tar" ? 0.55 : 1;
  const snowAt = (x: number, y: number): boolean => {
    if (y < 2 || y >= RH - 4 || x < 4 || x >= W - 3) return false;
    const nv = NT[(((y * 2 + spec.seed * 13) & 255) << 8) | ((x + spec.seed * 7) & 255)];
    const nf = NT[(((y * 5 + spec.seed * 3) & 255) << 8) | ((x * 3 + spec.seed * 11) & 255)];
    const fromFront = RH - 5 - y, fromSide = Math.min(x - 4, W - 4 - x);
    if (fromFront < (1 + (nv >> 5)) * keep - (nf >> 6)) return true;
    if (fromSide < (nv >> 6) * keep - (nf >> 7)) return true;
    // the shaded northern slope keeps broken patches, lying along the seams
    const shade = y < (f.gable ? ridge : RH * 0.4);
    const seamy = spec.roof === "tin" && x % 8 > 2 ? 18 : 0;
    if (shade && nv > 150 && nf > 256 - (80 + seamy) * keep) return true;
    return nf > 256 - 10 * keep && nv > 120;
  };
  const mask = new Uint8Array(W * RH);
  for (let y = 2; y < RH - 4; y++) for (let x = 4; x < W - 3; x++) if (snowAt(x, y)) mask[y * W + x] = 1;
  for (let y = 2; y < RH - 4; y++) for (let x = 4; x < W - 3; x++) {
    if (!mask[y * W + x]) continue;
    const l = lumps[(((y + spec.seed) & 255) << 8) | ((x + spec.seed * 3) & 255)];
    // the melting rim is grey, the lumps lit from the top left
    const rim = !mask[(y + 1) * W + x] || !mask[y * W + x + 1];
    px(im, x, y, rim ? C.dirty_snow[0] : C.dirty_snow[l === 2 ? 2 : l === 0 ? 0 : 1]);
  }
  for (const [x, y, w, d] of stacks) chimney(im, f, x, y, w, d);
}

function chimney(im: PixelImage, f: Facade, x: number, y: number, w: number, d: number): void {
  const hz = 11;
  const brick = C.brick;
  // shadow on the roof to the south-east
  rect(im, x + w, y - hz + 3, 3, d + 4, f.R[0]);
  // the south face: brick courses
  rect(im, x, y + d - hz, w, hz, brick[1]);
  for (let yy = y + d - hz; yy < y + d; yy++) {
    if ((yy - y) % 3 === 0) hline(im, x, x + w - 1, yy, brick[0]);
    else for (let xx = x + ((yy >> 1) % 2) * 2; xx < x + w; xx += 4) px(im, xx, yy, brick[0]);
  }
  vline(im, x + w - 1, y + d - hz, y + d - 1, brick[0]);
  // the top: a concrete cap with the flues, soot, a crust of snow
  const t0 = y - hz;
  rect(im, x, t0, w, d, C.stone_grey[1]);
  hline(im, x, x + w - 1, t0, C.stone_grey[2]);
  vline(im, x, t0, t0 + d - 1, C.stone_grey[2]);
  for (let fy = t0 + 2; fy < t0 + d - 1; fy += 3) for (let fx = x + 2; fx < x + w - 2; fx += 3) { px(im, fx, fy, S.outline); px(im, fx + 1, fy, C.soot[0]); }
  px(im, x + 1, t0 + 1, C.dirty_snow[2]);
  hline(im, x, x + w - 1, t0 + d, C.stone_grey[0]);
  // outline right and bottom
  vline(im, x + w, t0, y + d - 1, S.outline);
  hline(im, x, x + w, y + d, S.outline);
}

function skylight(im: PixelImage, x: number, y: number): void {
  // a glazed ridge light over the staircase
  I.box(im, x, x + 14, y + 4, y + 12, 3, S.glass, C.soot[1], C.puddle[1]);
  for (let xx = x + 3; xx < x + 13; xx += 4) vline(im, xx, y + 1, y + 8, C.soot[1]);
  px(im, x + 2, y + 2, C.dirty_snow[2]);
}

function hatch(im: PixelImage, f: Facade, x: number, y: number): void {
  I.box(im, x, x + 8, y + 3, y + 9, 4, f.R[2], f.R[0], null);
  hline(im, x, x + 7, y - 1, C.dirty_snow[1]);
}

// ------------------------------------------------------------------ the cut

function paintCut(f: Facade): PixelImage {
  const { W, RH, WH, H, spec } = f;
  const im = img(W, H);
  const K = I.KNEE;
  const F0 = WH, F1 = H; // the footprint's ground rows
  const tEW = 5, tNS = 6; // outer walls: rows deep, columns wide
  const inner = [C.plaster_cream, C.plaster_green, C.plaster_ochre, C.cloth];
  const r = rng(spec.seed * 31 + 7);
  const floorTop = F0 + tEW, floorBot = F1 - tEW;
  // floors: boards everywhere, then the passages paved
  I.boards(im, tNS, W - tNS, F0 - K, F1 - K, spec.seed);
  const spineY = Math.round(F0 + (F1 - F0) * (0.46 + r() * 0.1));
  const gates = f.features.filter((ft) => ft.kind === "gate");
  for (const g of gates) I.flags(im, g.x0, g.x1, F0 - K, F1, spec.seed, C.cobble, C.mortar);
  // cross walls: at the gateways' sides, then every 4-6 m
  const cross: number[] = [];
  for (const g of gates) cross.push(g.x0 - 3, g.x1);
  let cx = tNS + 48 + Math.floor(r() * 24);
  while (cx < W - tNS - 30) {
    if (!gates.some((g) => cx > g.x0 - 30 && cx < g.x1 + 24) && !f.features.some((ft) => ft.kind === "shop" && cx > ft.x0 - 6 && cx < ft.x1 + 6)) cross.push(cx);
    cx += 48 + Math.floor(r() * 24);
  }
  cross.sort((a, b) => a - b);
  // rooms between the cross walls, front (south) and back (north) of the spine
  const edges = [tNS, ...cross.flatMap((x) => [x, x + 3]), W - tNS];
  const rooms: { x0: number; x1: number; back: boolean }[] = [];
  for (let i = 0; i + 1 < edges.length; i += 2) {
    const x0 = edges[i], x1 = edges[i + 1];
    if (x1 - x0 < 8 || gates.some((g) => x0 >= g.x0 && x1 <= g.x1)) continue;
    rooms.push({ x0, x1, back: true }, { x0, x1, back: false });
  }
  // everything else is drawn back to front, by the ground row of its south edge
  const list: I.Drawable[] = [];
  const add = (key: number, draw: () => void) => list.push({ key, draw });
  const stairsAt = gates.length ? gates[0].x1 + 3 : -1;
  const roomFace = () => inner[Math.floor(r() * inner.length)];
  // outer walls: north (its inner face shows), west and east (caps), south (plaster face)
  const northFace = roomFace();
  add(F0 + tEW, () => wallRun(im, 0, W, F0, F0 + tEW, northFace, spec.seed + 2, gates, () => []));
  add(F1 - 1, () => { I.wallNS(im, 0, tNS, F0, F1, spec.seed + 3); I.wallNS(im, W - tNS, W, F0, F1, spec.seed + 4); });
  add(F1, () => southWall(im, f, F1 - tEW, F1));
  // the spine wall with doorways
  const spineFace = roomFace();
  add(spineY, () => wallRun(im, tNS, W - tNS, spineY - 4, spineY, spineFace, spec.seed + 1, gates, (x0, x1) => {
    const gaps: [number, number][] = [];
    for (let x = x0 + 8; x < x1 - 14; x += 40 + Math.floor(hash2(x, 3, spec.seed) * 20)) gaps.push([x, x + 11]);
    return gaps;
  }));
  // cross walls, with a doorway each side of the spine (not along the passages)
  for (const x of cross) {
    const passage = gates.some((g) => x === g.x0 - 3 || x === g.x1);
    const segs: [number, number][] = passage
      ? [[floorTop, spineY - 4], [spineY, floorBot]]
      : [[floorTop, floorTop + 6], [floorTop + 15, spineY - 4], [spineY, floorBot - 17], [floorBot - 8, floorBot]];
    const face = roomFace();
    for (const [a, b] of segs) if (b > a) add(b, () => I.wallNS(im, x, x + 3, a, b, spec.seed + x + a, face));
  }
  // furniture
  for (const room of rooms) furnish(add, im, f, room.x0, room.x1, room.back ? floorTop : spineY + 1, room.back ? spineY - 4 : floorBot, room.back, r, stairsAt);
  I.drawSorted(list);
  I.ghost(im, W, RH, H);
  return im;
}

/** An east-west knee wall across the building, broken by the passages and by doorways. */
function wallRun(
  im: PixelImage, x0: number, x1: number, r0: number, r1: number, face: Ramp, seed: number,
  gates: Feature[], doorways: (a: number, b: number) => [number, number][],
): void {
  const spans: [number, number][] = [];
  let a = x0;
  for (const g of [...gates].sort((p, q) => p.x0 - q.x0)) { if (g.x0 > a) spans.push([a, g.x0]); a = Math.max(a, g.x1); }
  if (a < x1) spans.push([a, x1]);
  for (const [s0, s1] of spans) {
    const gaps = doorways(s0, s1);
    let p = s0;
    for (const [g0, g1] of gaps) { I.wallEW(im, p, g0, r0, r1, face, seed, { skirting: C.wood[0] }); p = g1; }
    I.wallEW(im, p, s1, r0, r1, face, seed, { skirting: C.wood[0] });
  }
}

function southWall(im: PixelImage, f: Facade, r0: number, r1: number): void {
  const { W, P, T, spec } = f;
  const K = I.KNEE;
  const open = f.features.filter((ft) => ft.kind !== "shop").map((ft) => [ft.x0, ft.x1] as [number, number]);
  const spans: [number, number][] = [];
  let a = 0;
  for (const [g0, g1] of open.sort((p, q) => p[0] - q[0])) { if (g0 > a) spans.push([a, g0]); a = Math.max(a, g1); }
  if (a < W) spans.push([a, W]);
  for (const [s0, s1] of spans) I.wallEW(im, s0, s1, r0, r1, P, spec.seed + 5, { plinth: C.stone_grey });
  // window sills show as notches of trim in the cap
  for (const cx of f.groundAxes) hline(im, cx - 5, cx + 5, r1 - K - 1, T[2]);
  // shop fronts: a low bulkhead and the display glass, cut at knee height
  const paint = f.shopPaint;
  for (const ft of f.features.filter((q) => q.kind === "shop")) {
    rect(im, ft.x0, r0 - K, ft.x1 - ft.x0, r1 - r0, S.glass);
    hline(im, ft.x0, ft.x1 - 1, r0 - K, paint[2]);
    rect(im, ft.x0, r1 - 4, ft.x1 - ft.x0, 4, paint[1]);
    hline(im, ft.x0, ft.x1 - 1, r1 - 4, paint[2]);
    rect(im, ft.x0, r1 - K, ft.x1 - ft.x0, K - 4, S.glass);
    for (let i = 0; i < 3; i++) px(im, ft.x0 + 2 + i, r1 - K + 1 + i, C.puddle[1]);
    hline(im, ft.x0, ft.x1 - 1, r1 - 1, S.outline);
  }
  // thresholds of the doors and gateways
  for (const [g0, g1] of open) hline(im, g0, g1 - 1, r1 - 1, C.stone_grey[2]);
}

/** A few pieces of ground-floor furniture for one room, queued with their south edges. */
function furnish(
  add: (key: number, draw: () => void) => void,
  im: PixelImage, f: Facade, x0: number, x1: number, r0: number, r1: number, back: boolean,
  r: () => number, stairsAt: number,
): void {
  const w = x1 - x0, d = r1 - r0;
  if (w < 16 || d < 14) return;
  const shop = !back ? f.features.find((ft) => ft.kind === "shop" && ft.x0 < x1 && ft.x1 > x0) : undefined;
  if (stairsAt >= 0 && back && x0 === stairsAt) {
    const sw = Math.min(24, w - 4), sd = Math.min(24, d - 4);
    add(r0 + 4 + sd, () => I.stairs(im, x0 + 2, r0 + 4, sw, sd));
    return;
  }
  if (shop) {
    const goods = I.goodsFor(shop.sign);
    add(r0 + 6, () => I.shelves(im, x0 + 2, r0 + 3, w - 4, f.spec.seed + x0, goods));
    const sign = (shop.sign ?? "").toUpperCase();
    if (sign.includes("FRYZJER")) {
      add(r0 + 17, () => I.barberChair(im, x0 + 4, r0 + 10));
      if (w > 26) add(r0 + 17, () => I.barberChair(im, x0 + 15, r0 + 10));
      return;
    }
    if (sign.includes("KAWIAR")) {
      add(r1 - 7, () => I.table(im, x0 + 4, r1 - 12, 9, 5));
      add(r1 - 7, () => I.chair(im, x0 + 14, r1 - 11, "s"));
    }
    const cw = Math.max(10, Math.min(w - 10, Math.round(w * 0.6)));
    add(r1 - 4, () => I.counter(im, x1 - 4 - cw, r1 - 9, cw));
    return;
  }
  const kind = Math.floor(r() * 4);
  const blankets: RGB[] = [C.brick[1], C.plaster_green[1], C.tram[0], C.plaster_ochre[0]];
  if (back) {
    // against the north wall: a tiled stove, beds, a kitchen range, a wardrobe, a piano
    const tone = r() < 0.7 ? C.cloth : C.plaster_green;
    add(r0 + 7, () => I.tiledStove(im, x1 - 9, r0 + 2, tone));
    if (kind === 0 && w > 30) add(r0 + 7, () => I.piano(im, x0 + 3, r0 + 2));
    else if (kind === 1) {
      const bd = Math.min(17, d - 5), b1 = blankets[Math.floor(r() * 4)], b2 = blankets[Math.floor(r() * 4)];
      add(r0 + 3 + bd, () => I.bed(im, x0 + 3, r0 + 3, b1, 11, bd));
      if (w > 34) add(r0 + 3 + bd, () => I.bed(im, x0 + 16, r0 + 3, b2, 11, bd));
    } else if (kind === 2) {
      add(r0 + 8, () => I.kitchenStove(im, x0 + 3, r0 + 2));
      if (w > 34) add(r0 + 4, () => I.shelves(im, x0 + 17, r0 + 1, Math.min(10, w - 28), f.spec.seed + x0, [C.cloth[2], C.stone_grey[2], C.wood[2]]));
    } else add(r0 + 6, () => I.wardrobe(im, x0 + 3, r0 + 2));
  } else {
    // front rooms: a table with chairs on a rug, a sofa or a wardrobe
    const tx = x0 + Math.max(3, (w >> 1) - 7), ty = r0 + Math.max(5, (d >> 1) - 3);
    if (kind !== 3) add(0, () => I.rug(im, tx - 4, ty - 7, 22, 12, C.brick[1], C.plaster_ochre[1]));
    add(ty + 2, () => I.chair(im, tx + 4, ty - 2, "n"));
    add(ty + 9, () => I.table(im, tx, ty + 2, 14, 7));
    add(ty + 14, () => I.chair(im, tx + 5, ty + 10, "s"));
    if (kind === 1 && w > 36) add(r0 + 9, () => I.sofa(im, x0 + 3, r0 + 4, C.plaster_green[1], 14));
    if (kind === 2 && w > 36) add(r0 + 6, () => I.wardrobe(im, x1 - 13, r0 + 2));
  }
}

// ------------------------------------------------------------------ the builder

export const buildBuilding: BuildingBuilder = (spec: BuildingSpec): BuildingArt => {
  const f = plan(spec);
  const full = img(f.W, f.H);
  paintRoof(full, f);
  paintFacade(full, f);
  const art: BuildingArt = { full, h: wallHeight(spec.storeys) };
  if (spec.cuttable) art.cut = paintCut(f);
  return art;
};
