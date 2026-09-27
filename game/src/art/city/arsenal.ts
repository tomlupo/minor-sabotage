// The Royal Arsenal (Arsenał Królewski, ul. Długa 52), the demo's landmark: a 17th-century
// building of four wings round a courtyard, two tall storeys under a steep hipped roof of red
// tiles, clearly lower and older than the tenements round it (style guide §7: a unique set
// piece, not the building kit).
//
// Same bounds as every building (types.ts): the roof rectangle (w*12 x d*9 px) over the south
// wall (round(h*7.5) px), top-left at screen (12x, 9y - 7.5h), h = storeys*3.2 + 0.8. The
// steep roof stays inside that rectangle: at 45° its ridge projects below its own north eave.
// The roof is a heightfield (hips and valleys fall out of it), rendered column by column front
// to back, so the courtyard stays transparent and the inner south wall of the north wing shows
// across it.
import type { RGB, Ramp } from "../palette";
import { PAL } from "../palette";
import type { PixelImage } from "../pixel";
import { clear, hash2, hline, img, px, rect, vline } from "../pixel";
import type { BuildingArt, BuildingSpec } from "../types";
import { lumpTex, noiseTex, trimRamp, wallRamp } from "./common";
import { drawText, measureText } from "./font";
import * as I from "./interior";

const C = PAL.city_1943, S = PAL.shared;

export interface Courtyard { x: number; y: number; w: number; d: number }
export type ArsenalSpec = BuildingSpec & { courtyard?: Courtyard };

/** Roof pitch (rise per metre): 45°, steep, and still inside the roof rectangle (< 1.2). */
export const ARSENAL_PITCH = 1;

const FACE_S = 0, FACE_N = 1, FACE_W = 2, FACE_E = 3;
const ID_ROOF = 1, ID_WALL = 2, ID_INNER = 3, ID_COURT = 4; // 0: nothing drawn

interface Geo {
  w: number; d: number; h: number; W: number; RH: number; WH: number; H: number;
  court: Courtyard | null;
  inCourt: (xm: number, ym: number) => boolean;
  /** Roof height above the eave (m) at a point, the slope it lies on, and whether a ridge,
   *  hip or valley line runs through it. */
  roof: (xm: number, ym: number) => { rz: number; face: number; crease: boolean; valley: boolean };
}

function geometry(spec: ArsenalSpec): Geo {
  const { w, d } = spec;
  const h = spec.storeys * 3.2 + 0.8;
  const W = w * 12, RH = d * 9, WH = Math.round(h * 7.5);
  let court: Courtyard | null = spec.courtyard ?? null;
  if (court && (court.w <= 0 || court.d <= 0 || court.x < 1 || court.y < 1 || court.x + court.w > w - 1 || court.y + court.d > d - 1)) court = null;
  const inCourt = (xm: number, ym: number) => !!court && xm >= court.x && xm < court.x + court.w && ym >= court.y && ym < court.y + court.d;
  // one result object, reused: the raster calls this hundreds of thousands of times
  const out = { rz: 0, face: FACE_S, crease: false, valley: false };
  const roof = (xm: number, ym: number) => {
    // distance to the nearest eave: the outer walls, or the courtyard seen from outside
    let a = xm, fa = FACE_W, b = Infinity, valley = false, dist = w - xm;
    if (dist < a) { b = a; a = dist; fa = FACE_E; } else if (dist < b) b = dist;
    dist = ym;
    if (dist < a) { b = a; a = dist; fa = FACE_N; } else if (dist < b) b = dist;
    dist = d - ym;
    if (dist < a) { b = a; a = dist; fa = FACE_S; } else if (dist < b) b = dist;
    if (court) {
      const dx = xm < court.x ? court.x - xm : xm > court.x + court.w ? xm - court.x - court.w : 0;
      const dy = ym < court.y ? court.y - ym : ym > court.y + court.d ? ym - court.y - court.d : 0;
      dist = dx > dy ? dx : dy;
      if (dist < a) {
        b = a; a = dist;
        fa = dy >= dx ? (ym < court.y ? FACE_S : FACE_N) : xm < court.x ? FACE_E : FACE_W;
        valley = dx > 0 && dy > 0 && Math.abs(dx - dy) < 0.15;
      } else if (dist < b) b = dist;
    }
    out.rz = a * ARSENAL_PITCH; out.face = fa; out.crease = b - a < 0.14; out.valley = valley;
    return out;
  };
  return { w, d, h, W, RH, WH, H: RH + WH, court, inCourt, roof };
}

// ------------------------------------------------------------------ the roof and walls

interface Raster { id: Uint8Array; ym: Float32Array; rz: Float32Array }

/** Front-to-back march down every column: the south wall, the roof, the courtyard (left
 *  empty), the north wing's inner wall. Records what each pixel shows. */
function raster(im: PixelImage, g: Geo, seed: number): Raster {
  const { W, H, RH, WH, d } = g;
  const id = new Uint8Array(W * H), ymA = new Float32Array(W * H), rzA = new Float32Array(W * H);
  const T = C.brick, NT = noiseTex(), lumps = lumpTex(), data = im.data;
  const step = 1 / 18;
  for (let x = 0; x < W; x++) {
    const xm = (x + 0.5) / 12;
    for (let y = RH; y < H; y++) { id[y * W + x] = ID_WALL; ymA[y * W + x] = d; }
    let top = RH;
    let wasCourt = false;
    for (let ym = d - step / 2; ym > 0; ym -= step) {
      if (g.inCourt(xm, ym)) {
        const row = Math.round(9 * ym + WH);
        for (let y = Math.max(0, row); y < top; y++) id[y * W + x] = ID_COURT;
        if (row < top) top = Math.max(0, row);
        wasCourt = true;
        continue;
      }
      if (wasCourt) {
        // just crossed the courtyard's north edge: the inner wall of the north wing
        const eave = Math.round(9 * (ym + step / 2));
        for (let y = Math.max(0, eave); y < top; y++) { id[y * W + x] = ID_INNER; ymA[y * W + x] = ym + step / 2; }
        if (eave < top) top = Math.max(0, eave);
        wasCourt = false;
      }
      const r = g.roof(xm, ym);
      const row = Math.round(9 * ym - 7.5 * r.rz);
      if (row >= top) continue;
      // tiles: courses follow the contour lines; south slopes show the tiles' ends
      const tone = r.face === FACE_S ? 1 : r.face === FACE_E ? 0 : 2;
      let c: RGB = T[tone];
      const course = Math.floor(r.rz / 0.36);
      const tile = r.face === FACE_S || r.face === FACE_N ? Math.floor((x + course * 2) / 5) : Math.floor(ym * 3);
      if (r.face === FACE_S || r.face === FACE_N) {
        const cf = r.rz / 0.36 - course;
        if (r.face === FACE_S && cf < 0.2) c = T[0];
        else if (r.face === FACE_S && (x + course * 2) % 5 === 0) c = T[0];
      } else if (r.rz / 0.36 - course < 0.3) c = tone === 0 ? C.cut_cap[0] : T[1];
      // an odd weathered or replaced tile; snow left on the shaded slopes and in the valleys
      const q = hash2(tile, course * 4 + r.face, seed);
      if (q < 0.05 && c !== T[0]) c = tone === 2 ? T[1] : T[0];
      else if (q > 0.97 && tone < 2) c = T[tone + 1];
      if (r.crease) c = r.valley ? C.cut_cap[0] : tone === 0 ? T[1] : T[2];
      // snow left in broken patches, sampled in screen space so it lies flat on every slope:
      // most on the shaded north slopes and in the valleys, a little elsewhere
      const lim = r.face === FACE_N ? 128 : r.valley ? 168 : r.face === FACE_E ? 212 : r.face === FACE_S ? (r.rz < 0.5 ? 206 : 242) : 234;
      for (let y = Math.max(0, row); y < top; y++) {
        let cc = c;
        const nv = NT[(((y * 2 + seed) & 255) << 8) | ((x * 2 + seed * 3) & 255)];
        if (nv > lim) {
          const nf = NT[(((y * 3 + seed * 7) & 255) << 8) | ((x * 3 + seed) & 255)];
          if (nf > 130) {
            const l = lumps[(((y + seed) & 255) << 8) | ((x + seed) & 255)];
            cc = nv - lim < 6 || nf < 130 ? C.dirty_snow[0] : C.dirty_snow[l === 2 ? 2 : l === 0 ? 0 : 1];
          }
        }
        const o = (y * W + x) * 4;
        data[o] = cc[0]; data[o + 1] = cc[1]; data[o + 2] = cc[2]; data[o + 3] = 255;
        id[y * W + x] = ID_ROOF; ymA[y * W + x] = ym; rzA[y * W + x] = r.rz;
      }
      top = Math.max(0, row);
    }
  }
  return { id, ym: ymA, rz: rzA };
}

/** The screen row of the roof surface at a point, and the slope there (for dormers etc). */
function surfaceRow(g: Geo, xm: number, ym: number): number {
  return Math.round(9 * ym - 7.5 * g.roof(xm, ym).rz);
}

// ------------------------------------------------------------------ facades

interface Style { P: Ramp; T: Ramp; stone: Ramp; axes: number[]; gate: [number, number] }

/** A round-arched window of the upper floor: 11 x 15 px, keystone and stone surround. */
function archWindow(im: PixelImage, st: Style, cx: number, y0: number, state: number): void {
  const { P, T, stone } = st;
  const x0 = cx - 5;
  const pane: RGB = state === 2 ? S.window_lit : state === 1 ? S.glass_dark : S.glass;
  const frame: RGB = state === 2 ? C.wood[0] : C.cloth[2];
  const arch = (x: number) => (x === 0 || x === 10 ? 3 : x === 1 || x === 9 ? 1 : 0);
  // surround
  for (let x = -1; x <= 11; x++) {
    const a = x < 0 || x > 10 ? 4 : arch(x);
    px(im, x0 + x, y0 + a - 1, stone[2]);
  }
  vline(im, x0 - 1, y0 + 3, y0 + 14, stone[2]);
  vline(im, x0 + 11, y0 + 3, y0 + 14, P[0]);
  rect(im, cx - 1, y0 - 3, 3, 3, stone[2]); // keystone
  px(im, cx + 1, y0 - 1, P[0]);
  for (let x = 0; x <= 10; x++) {
    for (let y = y0 + arch(x); y < y0 + 15; y++) {
      const edge = x === 0 || y === y0 + arch(x);
      let c: RGB = pane;
      if (edge) c = S.outline;
      else if (x === 10) c = T[1];
      else if (x === 1 || x === 9 || x === 5 || y === y0 + 6 || y === y0 + 14) c = frame;
      else if ((x === 2 || x === 6) && (y === y0 + 7 || y === y0 + 3)) c = state === 2 ? S.fire[2] : C.puddle[1];
      px(im, x0 + x, y, c);
    }
  }
  hline(im, x0 - 1, x0 + 11, y0 + 15, stone[2]);
  hline(im, x0, x0 + 11, y0 + 16, P[0]);
  if (state === 0 && (cx & 1)) hline(im, x0 + 1, x0 + 6, y0 + 15, C.dirty_snow[2]);
}

/** A barred, square-headed ground-floor window in a heavy stone frame. */
function barredWindow(im: PixelImage, st: Style, cx: number, y0: number, lit: boolean): void {
  const { P, stone } = st;
  const x0 = cx - 5;
  rect(im, x0 - 2, y0 - 2, 15, 14, stone[1]);
  hline(im, x0 - 2, x0 + 12, y0 - 2, stone[2]);
  vline(im, x0 - 2, y0 - 2, y0 + 11, stone[2]);
  vline(im, x0 + 12, y0 - 2, y0 + 11, P[0]);
  rect(im, x0, y0, 11, 10, lit ? S.window_lit : S.glass);
  hline(im, x0, x0 + 10, y0, S.outline);
  vline(im, x0, y0, y0 + 9, S.outline);
  px(im, x0 + 2, y0 + 2, lit ? S.fire[2] : C.puddle[1]);
  for (let x = x0 + 2; x < x0 + 11; x += 2) vline(im, x, y0 + 1, y0 + 9, S.outline);
  hline(im, x0 + 1, x0 + 10, y0 + 5, S.outline);
  hline(im, x0 - 2, x0 + 12, y0 + 12, stone[2]);
  hline(im, x0 - 1, x0 + 12, y0 + 13, P[0]);
}

function southFacade(im: PixelImage, g: Geo, st: Style, spec: ArsenalSpec): void {
  const { W, RH, WH, H } = g;
  const { P, T, stone } = st;
  const y0 = RH;
  const lit = spec.front?.lit ?? 0.1;
  rect(im, 0, y0, W, WH, P[1]);
  // ground floor: banded rustication in stone colour; upper floor plain plaster
  const gTop = H - 26;
  for (let y = gTop; y < H - 4; y++) {
    const band = (y - gTop) % 4;
    hline(im, 0, W - 1, y, band === 0 ? P[0] : band === 1 ? T[2] : P[1]);
  }
  // plinth of big stone blocks
  rect(im, 0, H - 5, W, 5, stone[1]);
  hline(im, 0, W - 1, H - 5, stone[2]);
  for (let x = 3; x < W; x += 11) vline(im, x, H - 4, H - 2, stone[0]);
  // a string course between the floors
  hline(im, 0, W - 1, gTop - 2, T[2]);
  hline(im, 0, W - 1, gTop - 1, P[0]);
  // pilasters between the bays of the upper floor, quoins at the corners
  const bays = st.axes;
  for (let i = 0; i + 1 < bays.length; i++) {
    const px0 = Math.round((bays[i] + bays[i + 1]) / 2) - 2;
    if (px0 + 4 > st.gate[0] - 4 && px0 < st.gate[1] + 4) continue;
    rect(im, px0, y0 + 6, 5, gTop - 2 - (y0 + 6), P[1]);
    vline(im, px0, y0 + 6, gTop - 3, T[2]);
    vline(im, px0 + 4, y0 + 6, gTop - 3, P[0]);
    hline(im, px0 - 1, px0 + 5, y0 + 7, T[2]); // capital
  }
  for (const qx of [0, W - 7]) {
    for (let y = y0 + 6; y < H - 5; y++) {
      const blk = Math.floor((y - y0 - 6) / 4), long = blk % 2 === 0;
      const x0 = qx === 0 ? 0 : long ? W - 8 : W - 6, x1 = qx === 0 ? (long ? 7 : 5) : W - 1;
      const joint = (y - y0 - 6) % 4 === 0;
      hline(im, x0, x1, y, joint ? P[0] : stone[2]);
      if (!joint) px(im, x1, y, P[0]);
    }
  }
  // windows: arched above, barred below
  bays.forEach((cx, i) => {
    const q = hash2(i, 1, spec.seed);
    const state = q < lit ? 2 : hash2(i, 2, spec.seed) < 0.25 ? 1 : 0;
    archWindow(im, st, cx, y0 + 10, state);
    if (cx + 8 < st.gate[0] - 3 || cx - 8 > st.gate[1] + 3) barredWindow(im, st, cx, gTop + 7, hash2(i, 3, spec.seed) < lit * 0.5);
  });
  // the main cornice under the eaves: a heavy profile with modillions
  hline(im, 0, W - 1, y0, stone[2]);
  hline(im, 0, W - 1, y0 + 1, stone[1]);
  hline(im, 0, W - 1, y0 + 2, S.outline);
  hline(im, 0, W - 1, y0 + 3, P[0]);
  for (let x = 2; x < W - 2; x += 6) { rect(im, x, y0 + 2, 2, 2, stone[2]); px(im, x + 2, y0 + 3, S.outline); }
  hline(im, 0, W - 1, y0 + 4, P[1]);
  hline(im, 0, W - 1, y0 + 5, P[0]);
  // centuries of grime running down from the cornice and the sills
  for (let x = 0; x < W; x++) {
    const q = hash2(x, 9, spec.seed + 3);
    if (q < 0.12) vline(im, x, y0 + 6, y0 + 7 + Math.floor(q * 50), P[0]);
  }
  // the gate
  grandGate(im, st, st.gate[0], H - 1);
  // east end in shade, outline right and bottom
  vline(im, W - 2, y0, H - 1, P[0]);
  vline(im, W - 1, y0, H - 1, S.outline);
  hline(im, 0, W - 1, H - 1, S.outline);
}

/** The central gate: a tall round arch of rusticated voussoirs, a keystone, the dark
 *  vaulted passage to the courtyard, and a plaque above. */
function grandGate(im: PixelImage, st: Style, x0: number, bottom: number): void {
  const { P, stone } = st;
  const w = st.gate[1] - st.gate[0];
  const spring = bottom - 17, rise = Math.min(14, Math.floor(w / 2) - 2);
  const archTop = (x: number) => {
    const t = (x + 0.5 - w / 2) / (w / 2);
    return Math.round(spring - rise * Math.sqrt(Math.max(0, 1 - t * t)));
  };
  // voussoirs round the arch, rusticated jambs
  for (let x = -4; x < w + 4; x++) {
    const inner = x >= 0 && x < w;
    const yTop = inner ? archTop(x) : spring;
    for (let dd = 1; dd <= 4; dd++) {
      const c = dd === 4 ? stone[2] : (x + 64) % 4 === 0 ? P[0] : dd === 1 ? stone[1] : stone[2];
      px(im, x0 + x, yTop - dd, c);
    }
  }
  for (let y = spring - 1; y < bottom; y++) {
    const joint = (bottom - y) % 5 === 0, long = Math.floor((bottom - y) / 5) % 2 === 0;
    for (const [a, b] of [[long ? -6 : -4, -1], [w, w + (long ? 5 : 3)]]) for (let x = a; x <= b; x++) {
      px(im, x0 + x, y, joint ? P[0] : x === a ? stone[2] : stone[1]);
    }
  }
  const crown = spring - rise;
  rect(im, x0 + (w >> 1) - 2, crown - 6, 5, 6, stone[2]);
  vline(im, x0 + (w >> 1) + 2, crown - 5, crown - 1, P[0]);
  // the passage: setts in the light at the street, then the gloom under the vault
  for (let x = 0; x < w; x++) {
    for (let y = archTop(x); y < bottom; y++) {
      const depth = bottom - y;
      let c: RGB = S.glass_dark;
      if (depth < 8) {
        const joint = depth % 3 === 0 || (x + ((depth / 3) | 0) * 2) % 5 === 0;
        c = joint ? C.mortar : depth < 4 ? C.cobble[1] : C.cobble[0];
      } else if (depth < 12) c = (x + y) % 2 ? C.soot[0] : S.outline;
      px(im, x0 + x, y, c);
    }
  }
  // heavy gate leaves folded back, iron-studded
  for (const [a, b] of [[0, 3], [w - 4, w - 1]]) {
    for (let x = a; x <= b; x++) for (let y = spring - 4; y < bottom; y++) {
      const stud = (y - spring) % 4 === 0 && (x === a + 1 || x === b - 1);
      px(im, x0 + x, y, stud ? S.outline : x === a ? C.wood[1] : C.wood[0]);
    }
  }
  hline(im, x0 - 4, x0 + w + 3, bottom, stone[2]);
  // a stone plaque over the arch with the date in the pixel font
  const text = "1643";
  const m = measureText(text);
  const pw = m.w + 6, pxs = x0 + Math.round((w - pw) / 2), py = crown - 15;
  rect(im, pxs, py, pw, 9, stone[1]);
  hline(im, pxs, pxs + pw - 1, py, stone[2]);
  vline(im, pxs, py, py + 8, stone[2]);
  hline(im, pxs, pxs + pw - 1, py + 9, S.outline);
  vline(im, pxs + pw, py, py + 9, S.outline);
  drawText(im, text, pxs + 3, py + 2, C.soot[0]);
}

/** The inner south wall of the north wing, seen across the courtyard: an arcade below,
 *  windows above. Only pixels the raster gave to that wall are painted. */
function innerFacade(im: PixelImage, g: Geo, st: Style, ras: Raster, spec: ArsenalSpec): void {
  if (!g.court) return;
  const { W, WH } = g;
  const { P, T, stone } = st;
  const top = Math.round(9 * g.court.y); // the wall's eave row
  const x0 = Math.round(g.court.x * 12), x1 = Math.round((g.court.x + g.court.w) * 12);
  const scratch = img(W, WH);
  rect(scratch, 0, 0, W, WH, P[1]);
  hline(scratch, 0, W - 1, 0, stone[2]);
  hline(scratch, 0, W - 1, 1, S.outline);
  hline(scratch, 0, W - 1, 2, P[0]);
  const gTop = WH - 24;
  hline(scratch, 0, W - 1, gTop - 1, T[2]);
  hline(scratch, 0, W - 1, gTop, P[0]);
  // the arcade: round arches on square piers, dark behind
  const span = 26;
  for (let ax = x0 + 3; ax + span - 6 <= x1; ax += span) {
    const aw = span - 8, spring = WH - 12, rise = aw >> 1;
    for (let x = 0; x < aw; x++) {
      const t = (x + 0.5 - aw / 2) / (aw / 2);
      const yt = Math.round(spring - rise * Math.sqrt(Math.max(0, 1 - t * t)));
      for (let y = yt; y < WH - 1; y++) px(scratch, ax + 4 + x, y, y < yt + 1 ? S.outline : (y - yt) < 3 ? C.soot[0] : S.glass_dark);
      px(scratch, ax + 4 + x, yt - 1, stone[2]);
    }
    vline(scratch, ax + 3, spring, WH - 2, T[2]);
  }
  // windows above
  for (let cx = x0 + 16; cx < x1 - 8; cx += 26) {
    const q = hash2(cx, 5, spec.seed);
    archWindow(scratch, st, cx, 8, q < (spec.front?.lit ?? 0.1) ? 2 : q > 0.8 ? 1 : 0);
  }
  hline(scratch, 0, W - 1, WH - 1, S.outline);
  for (let y = 0; y < WH; y++) for (let x = x0; x < x1; x++) {
    const yy = top + y;
    if (yy < 0 || yy >= g.H || ras.id[yy * W + x] !== ID_INNER) continue;
    const i = (y * W + x) * 4;
    px(im, x, yy, [scratch.data[i], scratch.data[i + 1], scratch.data[i + 2]]);
  }
}

// ------------------------------------------------------------------ roof furniture

function dormer(im: PixelImage, g: Geo, xm: number, ym: number, lit: boolean): void {
  const row = surfaceRow(g, xm, ym);
  const cx = Math.round(xm * 12);
  const T = C.brick;
  // a small gabled dormer: front wall with a window, its own little tiled roof
  rect(im, cx - 5, row - 9, 11, 9, C.plaster_cream[1]);
  rect(im, cx - 3, row - 7, 7, 6, lit ? S.window_lit : S.glass);
  vline(im, cx, row - 7, row - 2, C.cloth[2]);
  hline(im, cx - 3, cx + 3, row - 5, C.cloth[2]);
  for (let i = 0; i < 5; i++) hline(im, cx - 6 + i, cx + 6 - i, row - 10 - i, i === 4 ? T[2] : T[1]);
  for (let i = 0; i < 5; i++) { px(im, cx - 6 + i, row - 10 - i, T[2]); px(im, cx + 6 - i, row - 10 - i, T[0]); }
  vline(im, cx + 6, row - 10, row - 1, S.outline);
  hline(im, cx - 5, cx + 6, row, S.outline);
  px(im, cx - 4, row - 11, C.dirty_snow[2]);
}

function chimney(im: PixelImage, g: Geo, xm: number, ym: number): void {
  const row = surfaceRow(g, xm, ym);
  const cx = Math.round(xm * 12);
  const b = C.brick;
  rect(im, cx - 3, row - 12, 7, 12, b[1]);
  for (let y = row - 12; y < row; y += 3) hline(im, cx - 3, cx + 3, y, b[0]);
  vline(im, cx + 3, row - 12, row - 1, b[0]);
  rect(im, cx - 4, row - 16, 9, 4, C.stone_grey[1]);
  hline(im, cx - 4, cx + 4, row - 16, C.stone_grey[2]);
  px(im, cx - 1, row - 15, S.outline);
  px(im, cx + 1, row - 15, S.outline);
  vline(im, cx + 5, row - 16, row - 1, S.outline);
}

/** A small ridge turret (sygnaturka) over the gate: louvred lantern, copper spire, finial. */
function turret(im: PixelImage, g: Geo, xm: number, ym: number): void {
  const row = surfaceRow(g, xm, ym);
  const cx = Math.round(xm * 12);
  const cu = [C.plaster_green[0], C.plaster_green[1], C.plaster_green[2]] as const;
  rect(im, cx - 4, row - 12, 9, 12, C.wood[0]);
  for (let y = row - 10; y < row - 2; y += 2) hline(im, cx - 3, cx + 3, y, C.soot[0]);
  vline(im, cx - 4, row - 12, row - 1, C.wood[1]);
  vline(im, cx + 4, row - 12, row - 1, S.outline);
  for (let i = 0; i < 16; i++) {
    const half = Math.max(0, 5 - Math.floor(i / 3));
    hline(im, cx - half, cx + half, row - 13 - i, cu[1]);
    px(im, cx - half, row - 13 - i, cu[2]);
    px(im, cx + half, row - 13 - i, cu[0]);
  }
  // the finial: a gilt ball on an iron spike
  vline(im, cx, row - 35, row - 29, S.outline);
  rect(im, cx - 1, row - 32, 3, 2, C.plaster_ochre[1]);
  px(im, cx - 1, row - 32, C.plaster_ochre[2]);
}

// ------------------------------------------------------------------ the cut

function paintCut(g: Geo, st: Style, spec: ArsenalSpec): PixelImage {
  const { W, RH, WH, H, court } = g;
  const im = img(W, H);
  const K = I.KNEE;
  const tE = 10, tN = 14; // walls 1.1 m thick: rows deep (east-west walls), columns wide
  const F0 = WH, F1 = H;
  const col = (xm: number) => Math.round(xm * 12), row = (ym: number) => Math.round(ym * 9 + WH);
  const cx0 = court ? col(court.x) : -1, cx1 = court ? col(court.x + court.w) : -1;
  const cy0 = court ? row(court.y) : -1, cy1 = court ? row(court.y + court.d) : -1;
  // stone flags inside the wings; the courtyard's ground stays empty for the painted ground
  I.flags(im, 0, W, F0 - K, F1, spec.seed, C.stone_grey, C.soot[1], true);
  if (court) for (let y = cy0; y < cy1; y++) for (let x = cx0; x < cx1; x++) clear(im, x, y);
  const list: I.Drawable[] = [];
  const add = (key: number, draw: () => void) => list.push({ key, draw });
  const face = C.plaster_cream;
  // outer walls
  add(F0 + tE, () => I.wallEW(im, 0, W, F0, F0 + tE, face, spec.seed));
  add(F1 - 1, () => { I.wallNS(im, 0, tN, F0, F1, spec.seed + 1); I.wallNS(im, W - tN, W, F0, F1, spec.seed + 2); });
  add(F1, () => {
    I.wallEW(im, 0, st.gate[0], F1 - tE, F1, st.P, spec.seed + 3, { plinth: C.stone_grey });
    I.wallEW(im, st.gate[1], W, F1 - tE, F1, st.P, spec.seed + 4, { plinth: C.stone_grey });
    hline(im, st.gate[0], st.gate[1] - 1, F1 - 1, C.stone_grey[2]);
  });
  // courtyard walls: its south face (north wing) shows, the rest are caps
  if (court) {
    add(cy0, () => I.wallEW(im, cx0 - tN, cx1 + tN, cy0 - tE, cy0, st.P, spec.seed + 5, { plinth: C.stone_grey }));
    add(cy1 + tE, () => {
      I.wallEW(im, cx0 - tN, st.gate[0], cy1, cy1 + tE, face, spec.seed + 6);
      I.wallEW(im, st.gate[1], cx1 + tN, cy1, cy1 + tE, face, spec.seed + 7);
    });
    add(cy1, () => { I.wallNS(im, cx0 - tN, cx0, cy0, cy1, spec.seed + 8, st.P); I.wallNS(im, cx1, cx1 + tN, cy0, cy1, spec.seed + 9, st.P); });
    // the gate passage through the south wing
    add(F1 - tE, () => {
      I.flags(im, st.gate[0], st.gate[1], cy1 + tE - K, F1 - tE, spec.seed + 10, C.cobble, C.mortar);
      I.wallNS(im, st.gate[0] - 4, st.gate[0], cy1 + tE, F1 - tE, spec.seed + 11, face);
      I.wallNS(im, st.gate[1], st.gate[1] + 4, cy1 + tE, F1 - tE, spec.seed + 12, face);
    });
  }
  // vault piers down the middle of each wing; the City Archive's shelving in the bays
  const pier = (x: number, gr: number) => add(gr + 6, () => I.box(im, x - 4, x + 5, gr, gr + 6, K, C.cut_cap[1], C.plaster_cream[1], C.cut_cap[2]));
  const files: RGB[] = [C.cloth[2], C.cloth[1], C.tram_cream[1], C.plaster_ochre[2], C.wood[2], C.cloth[0]];
  const shelf = (x: number, gr: number, w: number) => add(gr + 3, () => I.shelves(im, x, gr, w, spec.seed + x * 3 + gr, files));
  // east-west wings: piers on the centre line, a shelf each side of it between the piers
  const ewWing = (r0: number, r1: number, skip: (x: number) => boolean) => {
    const mid = Math.round((r0 + r1) / 2);
    for (let x = tN + 26; x < W - tN - 16; x += 40) {
      if (skip(x)) continue;
      pier(x, mid - 3);
      if (x + 26 < W - tN - 8 && !skip(x + 20)) {
        if (mid - 12 - K > r0) shelf(x + 8, mid - 12, 24);
        if (mid + 14 < r1 - 2) shelf(x + 8, mid + 9, 24);
      }
    }
  };
  if (court) {
    ewWing(F0 + tE, cy0 - tE, () => false);
    ewWing(cy1 + tE, F1 - tE, (x) => x > st.gate[0] - 30 && x < st.gate[1] + 10);
    // north-south wings: shelves in rows across the wing
    for (const [a, b] of [[tN, cx0 - tN], [cx1 + tN, W - tN]] as [number, number][]) {
      if (b - a < 20) continue;
      for (let y = cy0 + 2; y < cy1 - 6; y += 22) shelf(a + 5, y, b - a - 10);
    }
  } else ewWing(F0 + tE, F1 - tE, (x) => x > st.gate[0] - 30 && x < st.gate[1] + 10);
  I.drawSorted(list);
  I.ghost(im, W, RH, H);
  return im;
}

/** The outline round the courtyard hole, the full image's only transparent pixels (the same
 *  result as pixel.outline over the whole image, scanning only the courtyard's columns). */
function holeOutline(im: PixelImage, g: Geo): void {
  if (!g.court) return;
  const { W, H } = g, d = im.data;
  const x0 = Math.max(0, Math.floor(g.court.x * 12) - 1), x1 = Math.min(W, Math.ceil((g.court.x + g.court.w) * 12) + 1);
  const op = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && d[(y * W + x) * 4 + 3] > 127;
  const mark: number[] = [];
  for (let y = 0; y < H; y++) for (let x = x0; x < x1; x++) {
    if (d[(y * W + x) * 4 + 3]) continue;
    if (op(x + 1, y) || op(x - 1, y) || op(x, y + 1) || op(x, y - 1)) mark.push(x, y);
  }
  for (let k = 0; k < mark.length; k += 2) px(im, mark[k], mark[k + 1], S.outline);
}

// ------------------------------------------------------------------ the builder

export function buildArsenal(spec: ArsenalSpec): BuildingArt {
  const g = geometry(spec);
  const P = wallRamp(spec.plaster), T = trimRamp(spec.plaster), stone = C.stone_grey;
  // bays about 3.4 m apart, the gate in the middle (or where the spec puts a gateway)
  const gw = 36;
  const gx = spec.front?.gateways?.length ? Math.round(spec.front.gateways[0] * 12) : Math.round(g.W / 2 - gw / 2);
  const gate: [number, number] = [gx, gx + gw];
  const nb = Math.max(2, Math.round((g.W - 24) / 40));
  const sp = (g.W - 24) / nb;
  const axes = Array.from({ length: nb }, (_, i) => Math.round(12 + sp * (i + 0.5))).filter((cx) => cx + 9 < gate[0] - 6 || cx - 9 > gate[1] + 6);
  const st: Style = { P, T, stone, axes, gate };
  const full = img(g.W, g.H);
  const ras = raster(full, g, spec.seed);
  southFacade(full, g, st, spec);
  innerFacade(full, g, st, ras, spec);
  // on the roof: dormers along the south slope, chimneys, the turret over the gate
  const southWing = g.court ? g.d - (g.court.y + g.court.d) : g.d;
  const ymDormer = g.d - Math.min(1.6, southWing * 0.2);
  for (let i = 0; i < axes.length; i += 2) dormer(full, g, axes[i] / 12, ymDormer, hash2(i, 7, spec.seed) < (spec.front?.lit ?? 0.1));
  const ridgeS = g.d - southWing / 2;
  for (const f of [0.18, 0.82]) chimney(full, g, (g.W * f) / 12, ridgeS + 0.4);
  if (g.court) chimney(full, g, (g.W * 0.5) / 12 + 3, g.court.y / 2);
  turret(full, g, (gate[0] + gate[1]) / 24, ridgeS);
  // silhouette: the outline round the outside and round the courtyard
  holeOutline(full, g);
  hline(full, 0, g.W - 1, 0, S.outline);
  vline(full, g.W - 1, 0, g.H - 1, S.outline);
  const art: BuildingArt = { full, h: g.h };
  if (spec.cuttable) art.cut = paintCut(g, st, spec);
  return art;
}
