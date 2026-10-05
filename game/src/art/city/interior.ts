// Pieces shared by the cut versions of buildings (style guide §7, "The street cut"): knee-high
// walls with a sawn cut_cap top, floors, ground-floor furniture, and the ghost outline.
//
// Coordinates are image pixels of a building image (roof rectangle over south wall, RH = 9 d
// rows of roof, WH = round(7.5 h) rows of wall). A point on the floor at local (lx, ly) metres
// lands at column 12 lx, row 9 ly + WH; a height z shifts it up by 7.5 z px. Boxes take their
// footprint as columns [x0, x1) and ground rows [r0, r1) plus a height in px.
import type { RGB, Ramp } from "../palette";
import { PAL } from "../palette";
import type { PixelImage } from "../pixel";
import { alphaAt, hash2, hline, px, rect, vline } from "../pixel";
import { X as XTRA } from "./common";

const C = PAL.city_1943, S = PAL.shared;

/** The cut height: 1 m, about 8 px (style guide §7). */
export const KNEE = 8;

/** A box standing on the floor. Top face in `top`, south face in `face`; the top's far and
 *  left edges catch the light (`lit`), the right and bottom edges get the outline (§4). */
export function box(
  im: PixelImage, x0: number, x1: number, r0: number, r1: number, hz: number,
  top: RGB, face: RGB, lit: RGB | null = null, line: RGB | null = S.outline,
): void {
  if (x1 <= x0 || r1 <= r0) return;
  const t0 = r0 - hz, t1 = r1 - hz;
  rect(im, x0, t0, x1 - x0, t1 - t0, top);
  if (hz > 0) rect(im, x0, t1, x1 - x0, hz, face);
  if (lit) { hline(im, x0, x1 - 1, t0, lit); vline(im, x0, t0, t1 - 1, lit); }
  if (line) { vline(im, x1 - 1, t0, r1 - 1, line); if (hz > 0) hline(im, x0, x1 - 1, r1 - 1, line); }
}

/** The sawn top of a knee wall seen from above, a little mottled like cut brickwork. */
export function cap(im: PixelImage, x0: number, x1: number, y0: number, y1: number, seed: number): void {
  const k = C.cut_cap;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    let c = k[1];
    if (y === y0 || x === x0) c = k[2];
    else if (y === y1 - 1 || x === x1 - 1) c = k[0];
    else {
      const r = hash2(x, y, seed) * 16;
      if (r < 1.2) c = k[0];
      else if (r < 2) c = k[2];
    }
    px(im, x, y, c);
  }
}

/** An east-west knee wall: sawn cap on top, its south face (plaster `face` ramp) below. */
export function wallEW(
  im: PixelImage, x0: number, x1: number, r0: number, r1: number, face: Ramp, seed: number,
  opts: { plinth?: Ramp; skirting?: RGB } = {},
): void {
  if (x1 <= x0) return;
  cap(im, x0, x1, r0 - KNEE, r1 - KNEE, seed);
  const f0 = r1 - KNEE;
  rect(im, x0, f0, x1 - x0, KNEE, face[1]);
  hline(im, x0, x1 - 1, f0, face[0]); // the cap's shadow on the face
  if (opts.plinth) {
    rect(im, x0, r1 - 3, x1 - x0, 3, opts.plinth[1]);
    hline(im, x0, x1 - 1, r1 - 3, opts.plinth[2]);
  }
  if (opts.skirting) hline(im, x0, x1 - 1, r1 - 1, opts.skirting);
  vline(im, x1 - 1, f0, r1 - 1, face[0]);
}

/** A north-south knee wall: its sawn cap, and the small south end face when `face` is given
 *  (the east and west faces are never drawn). */
export function wallNS(im: PixelImage, x0: number, x1: number, r0: number, r1: number, seed: number, face?: Ramp): void {
  if (r1 <= r0) return;
  cap(im, x0, x1, r0 - KNEE, r1 - KNEE, seed);
  if (face) {
    rect(im, x0, r1 - KNEE, x1 - x0, KNEE, face[1]);
    vline(im, x1 - 1, r1 - KNEE, r1 - 1, face[0]);
    hline(im, x0, x1 - 1, r1 - 1, S.outline);
  }
}

/** Something to draw in a cut interior, sorted by the ground row of its south edge. */
export interface Drawable { key: number; draw: () => void }
export function drawSorted(list: Drawable[]): void {
  list.map((d, i) => [d, i] as const).sort((a, b) => a[0].key - b[0].key || a[1] - b[1]).forEach(([d]) => d.draw());
}

/** Floorboards (wood ramp) running east-west, board ends staggered. */
export function boards(im: PixelImage, x0: number, x1: number, y0: number, y1: number, seed: number, vertical = false): void {
  const w = C.wood;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const a = vertical ? x - x0 : y - y0, b = vertical ? y - y0 : x - x0;
    const board = Math.floor(a / 3), inBoard = a % 3;
    const len = 18 + Math.floor(hash2(board, 0, seed) * 14);
    const shift = Math.floor(hash2(board, 1, seed) * len);
    const seg = Math.floor((b + shift) / len);
    let c = w[1];
    if (inBoard === 2) c = w[0];
    else if ((b + shift) % len === 0) c = w[0];
    else if (hash2(board, seg, seed + 5) < 0.22) c = w[2];
    else if (hash2(board, seg, seed + 6) < 0.12 && inBoard === 1) c = w[0];
    px(im, x, y, c);
  }
}

/** Old stone flags or setts (a passage, the Arsenal's halls). */
export function flags(im: PixelImage, x0: number, x1: number, y0: number, y1: number, seed: number, ramp: Ramp, joint: RGB, big = false): void {
  const bw = big ? 10 : 4, bh = big ? 6 : 3;
  for (let y = y0; y < y1; y++) {
    const row = Math.floor((y - y0) / bh), off = (row % 2) * (bw >> 1);
    for (let x = x0; x < x1; x++) {
      const col = Math.floor((x - x0 + off) / bw);
      const jx = (x - x0 + off) % bw === 0, jy = (y - y0) % bh === 0;
      let c = ramp[1];
      if (jx || jy) c = joint;
      else {
        const r = hash2(col, row, seed);
        c = r < 0.2 ? ramp[0] : r > 0.82 ? ramp[2] : ramp[1];
      }
      px(im, x, y, c);
    }
  }
}

/** Only on transparent pixels: the ghost dots must not blend into opaque art. */
function ghostDot(im: PixelImage, x: number, y: number): void {
  if (alphaAt(im, x, y) === 0) px(im, x, y, S.ghost, 204);
}

/** The ghost (style guide §7): the full volume's roof rectangle and its two front corners,
 *  dotted every 3rd pixel in `ghost` at 80%. */
export function ghost(im: PixelImage, W: number, RH: number, H: number): void {
  let n = 0;
  const step = (x: number, y: number) => { if (n++ % 3 === 0) ghostDot(im, x, y); };
  for (let x = 0; x < W; x++) step(x, 0);
  for (let y = 1; y < RH; y++) step(W - 1, y);
  for (let x = W - 2; x >= 0; x--) step(x, RH - 1);
  for (let y = RH - 2; y > 0; y--) step(0, y);
  n = 0;
  for (let y = RH; y < H; y++) { if (n++ % 3 === 0) { ghostDot(im, 0, y); ghostDot(im, W - 1, y); } }
}

// ------------------------------------------------------------------ furniture
// Each piece takes the column and ground row of its footprint's north-west corner.

const wood = C.wood;

export function table(im: PixelImage, x: number, r: number, w = 14, d = 7): void {
  // top at 0.75 m (6 px), apron and four legs
  const hz = 6, t0 = r - hz;
  for (const lx of [x + 1, x + w - 2]) vline(im, lx, t0 + 2, r + d - 1, S.outline); // far legs
  rect(im, x, t0, w, d, wood[2]);
  hline(im, x, x + w - 1, t0 + d - 1, wood[1]);
  hline(im, x, x + w - 1, t0 + d, wood[0]); // apron
  for (const lx of [x, x + w - 1]) vline(im, lx, t0 + d, r + d - 1, S.outline); // near legs
}

export function chair(im: PixelImage, x: number, r: number, back: "n" | "s" = "n"): void {
  const hz = 4, t0 = r - hz;
  if (back === "n") { rect(im, x, t0 - 5, 5, 5, wood[0]); hline(im, x, x + 4, t0 - 5, wood[1]); }
  rect(im, x, t0, 5, 4, wood[1]);
  hline(im, x, x + 4, t0, wood[2]);
  vline(im, x, t0 + 4, r + 3, S.outline);
  vline(im, x + 4, t0 + 4, r + 3, S.outline);
  if (back === "s") { rect(im, x, t0 + 1, 5, 6, wood[0]); hline(im, x, x + 4, t0 + 1, wood[1]); }
}

export function bed(im: PixelImage, x: number, r: number, blanket: RGB, w = 12, d = 17): void {
  // along north-south, head against the north wall
  box(im, x, x + w, r, r + d, 4, C.cloth[2], wood[0], null);
  rect(im, x + 1, r - 4 + 5, w - 2, d - 7, blanket);
  hline(im, x + 1, x + w - 2, r - 4 + 5, C.cloth[2]);
  rect(im, x + 2, r - 3, w - 4, 3, S.chalk); // pillow
  rect(im, x, r - 8, w, 4, wood[1]); // headboard
  hline(im, x, x + w - 1, r - 8, wood[2]);
  vline(im, x + w - 1, r - 8, r + d - 1, S.outline);
}

/** The white tiled stove (piec kaflowy) of every Warsaw flat, in a corner. */
export function tiledStove(im: PixelImage, x: number, r: number, tone: Ramp = C.cloth): void {
  const w = 7, d = 5, hz = 15;
  box(im, x, x + w, r, r + d, hz, tone[1], tone[2], S.chalk);
  const f0 = r + d - hz;
  for (let y = f0 + 3; y < r + d - 1; y += 3) hline(im, x, x + w - 2, y, tone[0]);
  vline(im, x + 3, f0, r + d - 2, tone[0]);
  rect(im, x + 2, r + d - 5, 3, 2, C.soot[0]); // the iron door
  hline(im, x - 1, x + w, r - hz, tone[2]); // crown moulding
}

export function kitchenStove(im: PixelImage, x: number, r: number): void {
  box(im, x, x + 12, r, r + 6, 6, C.soot[1], C.soot[0], C.soot[2]);
  px(im, x + 3, r - 4, C.soot[0]);
  px(im, x + 8, r - 4, C.soot[0]);
  rect(im, x + 6, r - 9, 4, 3, C.stone_grey[1]); // a pot
  hline(im, x + 6, x + 9, r - 9, C.stone_grey[2]);
  rect(im, x + 2, r + 1, 3, 2, C.tram[0]); // glow behind the fire door
}

export function counter(im: PixelImage, x: number, r: number, w: number): void {
  box(im, x, x + w, r, r + 5, 8, wood[2], wood[1], null);
  for (let lx = x + 4; lx < x + w - 2; lx += 6) vline(im, lx, r + 5 - 8 + 1, r + 3, wood[0]);
  hline(im, x, x + w - 1, r - 3, wood[2]);
}

/** Shelves against a wall, full of goods: palette colours picked by the seed. */
export function shelves(im: PixelImage, x: number, r: number, w: number, seed: number, goods: RGB[]): void {
  const hz = 14, d = 3;
  box(im, x, x + w, r, r + d, hz, wood[1], wood[0], null);
  const f0 = r + d - hz;
  for (let y = f0 + 1; y < r + d - 1; y++) {
    const shelf = (y - f0) % 4 === 0;
    for (let lx = x + 1; lx < x + w - 1; lx++) {
      if (shelf) { px(im, lx, y, wood[2]); continue; }
      const q = hash2(lx, Math.floor((y - f0) / 4), seed);
      if (q < 0.7) px(im, lx, y, goods[Math.floor(q * 10) % goods.length]);
    }
  }
}

export function piano(im: PixelImage, x: number, r: number): void {
  box(im, x, x + 16, r, r + 5, 11, C.soot[1], C.soot[0], C.soot[2]);
  hline(im, x + 1, x + 14, r + 5 - 6, S.chalk); // keys
  for (let k = x + 2; k < x + 14; k += 2) if (k % 7 !== 3) px(im, k, r + 5 - 6, C.soot[0]);
  rect(im, x + 2, r - 11 - 2, 3, 2, C.cloth[2]); // sheet music
}

export function wardrobe(im: PixelImage, x: number, r: number, w = 10): void {
  box(im, x, x + w, r, r + 4, 15, wood[1], wood[0], wood[2]);
  vline(im, x + (w >> 1), r + 4 - 15 + 1, r + 2, S.outline);
  px(im, x + (w >> 1) - 1, r - 5, wood[2]);
}

export function sofa(im: PixelImage, x: number, r: number, cloth: RGB, w = 16): void {
  box(im, x, x + w, r - 3, r, 7, cloth, cloth, null); // back against the wall
  box(im, x, x + w, r, r + 5, 3, cloth, wood[0], null);
  hline(im, x, x + w - 1, r - 10, C.cloth[2]);
  vline(im, x + w - 1, r - 10, r + 4, S.outline);
}

export function rug(im: PixelImage, x: number, y: number, w: number, h: number, a: RGB, b: RGB): void {
  rect(im, x, y, w, h, a);
  for (let lx = x; lx < x + w; lx++) { px(im, lx, y, b); px(im, lx, y + h - 1, b); }
  for (let ly = y; ly < y + h; ly++) { px(im, x, ly, b); px(im, x + w - 1, ly, b); }
  for (let lx = x + 2; lx < x + w - 2; lx += 3) px(im, lx, y + (h >> 1), b);
}

/** A flight of stairs rising to the north, cut at knee height, with its banister. */
export function stairs(im: PixelImage, x: number, r0: number, w: number, d: number): void {
  const st = C.stone_grey;
  for (let y = r0; y < r0 + d; y++) {
    const step = Math.floor((r0 + d - y) / 2);
    const hz = Math.min(KNEE, step);
    const c = (r0 + d - y) % 2 === 0 ? st[0] : st[2];
    hline(im, x, x + w - 1, y - hz, c);
  }
  vline(im, x + w - 1, r0 - KNEE, r0 + d - 1, wood[0]);
}

/** A mirror and a chair: the barber's (FRYZJER). */
export function barberChair(im: PixelImage, x: number, r: number): void {
  rect(im, x + 1, r - 14, 7, 6, S.glass); // mirror on the wall
  hline(im, x + 1, x + 7, r - 14, PAL.shared.chalk);
  box(im, x + 2, x + 8, r + 2, r + 7, 5, C.tram[1], C.tram[0], null);
  rect(im, x + 2, r - 6, 6, 3, C.tram[1]);
}

/** Goods for a shop's shelves, by its sign. */
export function goodsFor(sign: string | undefined): RGB[] {
  const s = (sign ?? "").toUpperCase();
  if (s.includes("PIEKAR")) return [C.plaster_ochre[1], C.plaster_ochre[2], C.wood[2], C.plaster_ochre[0]];
  if (s.includes("APTEK")) return [S.chalk, S.glass, C.cloth[2], C.tram_cream[1], C.brick[2]];
  if (s.includes("ZEGAR")) return [S.chalk, C.wood[1], C.stone_grey[2], C.wood[0]];
  if (s.includes("KAWIAR") || s.includes("CUKIER")) return [C.cloth[2], C.tram[2], C.plaster_ochre[2], C.wood[1]];
  if (s.includes("MLECZ")) return [S.chalk, C.dirty_snow[2], C.cloth[2]];
  return [C.brick[2], C.plaster_green[2], C.tram_cream[1], C.wood[2], XTRA.paintGreen()[2], C.cloth[1]];
}
