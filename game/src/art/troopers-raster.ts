// The trooper puppet's canvas. A frame is drawn into a 24 x 24 "cel" of colour SLOTS (0 = empty,
// 1 = outline, the rest are a look's materials), then outlined and written out as RGBA through
// the look's slot table. Slots instead of RGB keep the drawing code free of colours (style guide
// §3) and keep a frame cheap: 576 bytes, no blending, no allocation per pixel.
import type { RGB } from "./palette";
import type { PixelImage } from "./pixel";

export const CW = 24;
export const CH = 24;
export const EMPTY = 0;
export const OUTLINE = 1;

/** Sides for `edge`: where a part's inner line goes. */
export const LEFT = 1, RIGHT = 2, UP = 4, DOWN = 8;

export class Cel {
  readonly d = new Uint8Array(CW * CH);
  /** Which part drew each pixel, so a part can draw a dark line where it lies over another. */
  readonly own = new Uint8Array(CW * CH);
  private part = 1;
  private bx0 = CW; private by0 = CH; private bx1 = -1; private by1 = -1;

  clear(): void {
    this.d.fill(0);
    this.own.fill(0);
    this.part = 1;
    this.bx0 = CW; this.by0 = CH; this.bx1 = -1; this.by1 = -1;
  }

  /** Start a new part (for `edge`). */
  begin(): void {
    this.part = this.part >= 255 ? 1 : this.part + 1;
    this.bx0 = CW; this.by0 = CH; this.bx1 = -1; this.by1 = -1;
  }

  set(x: number, y: number, c: number): void {
    if (!c || x < 0 || y < 0 || x >= CW || y >= CH) return;
    const i = y * CW + x;
    this.d[i] = c;
    this.own[i] = this.part;
    if (x < this.bx0) this.bx0 = x;
    if (x > this.bx1) this.bx1 = x;
    if (y < this.by0) this.by0 = y;
    if (y > this.by1) this.by1 = y;
  }

  /**
   * Inner outline: where the current part (since `begin`) borders pixels an earlier part drew,
   * on the given sides, those pixels become outline. This is what separates an arm from the
   * torso it crosses, or the near leg from the far one, without growing the silhouette.
   */
  edge(sides: number, onto: Uint8Array | null = null, slot = OUTLINE): void {
    if (this.bx1 < 0) return;
    const d = this.d, own = this.own, p = this.part;
    let n = 0;
    for (let y = this.by0; y <= this.by1; y++) {
      for (let x = this.bx0; x <= this.bx1; x++) {
        const i = y * CW + x;
        if (own[i] !== p || d[i] <= OUTLINE) continue;
        if (sides & LEFT && x > 0) n = mark(d, own, p, onto, i - 1, n);
        if (sides & RIGHT && x < CW - 1) n = mark(d, own, p, onto, i + 1, n);
        if (sides & UP && y > 0) n = mark(d, own, p, onto, i - CW, n);
        if (sides & DOWN && y < CH - 1) n = mark(d, own, p, onto, i + CW, n);
      }
    }
    for (let k = 0; k < n; k++) d[MARK[k]] = slot;
  }

  rect(x: number, y: number, w: number, h: number, c: number): void {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.set(xx, yy, c);
  }

  /** Bresenham, 1 px. */
  line(x0: number, y0: number, x1: number, y1: number, c: number): void {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
    const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.set(x0, y0, c);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }

  /**
   * A 2 px limb from joint to joint. The lit side (`a`) is the left of a steep limb or the top
   * of a flat one, the shaded side (`b`) the other: light from the top left (style guide §4).
   * Coordinates are the limb's centre line; the pair of pixels straddles it.
   */
  limb(x0: number, y0: number, x1: number, y1: number, a: number, b: number): void {
    const steep = Math.abs(y1 - y0) >= Math.abs(x1 - x0);
    const ox = steep ? 0.5 : 0, oy = steep ? 0 : 0.5;
    let ax = Math.floor(x0 - ox), ay = Math.floor(y0 - oy);
    const bx = Math.floor(x1 - ox), by = Math.floor(y1 - oy);
    const dx = Math.abs(bx - ax), sx = ax < bx ? 1 : -1;
    const dy = -Math.abs(by - ay), sy = ay < by ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.set(ax, ay, a);
      if (steep) this.set(ax + 1, ay, b); else this.set(ax, ay + 1, b);
      if (ax === bx && ay === by) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; ax += sx; }
      if (e2 <= dx) { err += dx; ay += sy; }
    }
  }

  /**
   * Stamp a template so that its anchor lands on (x, y). `rot` turns it by quarter turns
   * clockwise before the optional mirror. Template '.' is skipped.
   */
  stamp(t: Tpl, x: number, y: number, map: Uint8Array, flip = false, rot = 0): void {
    const r = rot & 3;
    for (let ty = 0; ty < t.h; ty++) {
      for (let tx = 0; tx < t.w; tx++) {
        const ch = t.c[ty * t.w + tx];
        if (!ch) continue;
        const slot = map[ch];
        if (!slot) continue;
        // position relative to the anchor, turned, then mirrored
        let dx = tx - t.ax, dy = ty - t.ay;
        if (r === 1) [dx, dy] = [-dy, dx];
        else if (r === 2) [dx, dy] = [-dx, -dy];
        else if (r === 3) [dx, dy] = [dy, -dx];
        if (flip) dx = -dx;
        this.set(x + dx, y + dy, slot);
      }
    }
  }

  /** Style guide §4: a 1 px outline around the silhouette. Outline pixels already drawn (inner
   *  lines, template edges) count as outside, so a template's own edge is never doubled. */
  outline(slot = OUTLINE): void {
    const d = this.d;
    const mark = MARK;
    let n = 0;
    for (let y = 0; y < CH; y++) {
      for (let x = 0; x < CW; x++) {
        const i = y * CW + x;
        if (d[i]) continue;
        if (
          (x > 0 && d[i - 1] > OUTLINE) ||
          (x < CW - 1 && d[i + 1] > OUTLINE) ||
          (y > 0 && d[i - CW] > OUTLINE) ||
          (y < CH - 1 && d[i + CW] > OUTLINE)
        ) mark[n++] = i;
      }
    }
    for (let k = 0; k < n; k++) d[mark[k]] = slot;
  }

  /** Mirror in place around the cell's centre line (x = 12.0). */
  flipX(): void {
    const d = this.d;
    for (let y = 0; y < CH; y++) {
      const r = y * CW;
      for (let x = 0; x < CW >> 1; x++) {
        const t = d[r + x];
        d[r + x] = d[r + CW - 1 - x];
        d[r + CW - 1 - x] = t;
      }
    }
  }

  /** Write the cel into an RGBA image at (ox, oy) through the slot table. */
  writeRGBA(lut: readonly (RGB | undefined)[], dst: PixelImage, ox: number, oy: number): void {
    const d = this.d, out = dst.data;
    for (let y = 0; y < CH; y++) {
      const dy = oy + y;
      if (dy < 0 || dy >= dst.h) continue;
      for (let x = 0; x < CW; x++) {
        const s = d[y * CW + x];
        if (!s) continue;
        const c = lut[s];
        if (!c) continue;
        const dx = ox + x;
        if (dx < 0 || dx >= dst.w) continue;
        const i = (dy * dst.w + dx) * 4;
        out[i] = c[0];
        out[i + 1] = c[1];
        out[i + 2] = c[2];
        out[i + 3] = 255;
      }
    }
  }

  /** The drawn area [x0, y0, x1, y1], inclusive, or null when empty. */
  bbox(): [number, number, number, number] | null {
    let x0 = CW, y0 = CH, x1 = -1, y1 = -1;
    const d = this.d;
    for (let y = 0; y < CH; y++) {
      for (let x = 0; x < CW; x++) {
        if (!d[y * CW + x]) continue;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    return x1 < 0 ? null : [x0, y0, x1, y1];
  }

}

const MARK = new Int32Array(CW * CH * 4);

function mark(d: Uint8Array, own: Uint8Array, p: number, onto: Uint8Array | null, j: number, n: number): number {
  if (own[j] !== p && d[j] > OUTLINE && (!onto || onto[d[j]])) MARK[n++] = j;
  return n;
}

/** A set of slots, for `edge(..., onto)`. */
export function slotSet(slots: number[]): Uint8Array {
  const m = new Uint8Array(256);
  for (const q of slots) m[q] = 1;
  return m;
}

// ------------------------------------------------------------------------------ templates

/** A hand-written pixel template: one character per pixel, '.' empty. The anchor (ax, ay) is
 *  the template pixel that lands on the stamp point. */
export interface Tpl {
  w: number;
  h: number;
  ax: number;
  ay: number;
  /** Character codes, 0 where '.'. */
  c: Uint8Array;
}

export function tpl(rows: readonly string[], ax: number, ay: number): Tpl {
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const c = new Uint8Array(w * h);
  rows.forEach((r, y) => {
    for (let x = 0; x < r.length; x++) {
      const ch = r.charCodeAt(x);
      c[y * w + x] = ch === 46 /* . */ || ch === 32 ? 0 : ch;
    }
  });
  return { w, h, ax, ay, c };
}

/** Paint `over` onto a copy of `base` (same size and anchor); '.' in `over` keeps the base and
 *  '_' clears it. Used to put headgear on a head at build time, not per frame. */
export function overlay(base: Tpl, over: Tpl): Tpl {
  const c = new Uint8Array(base.c);
  const ox = base.ax - over.ax, oy = base.ay - over.ay;
  for (let y = 0; y < over.h; y++) {
    for (let x = 0; x < over.w; x++) {
      const ch = over.c[y * over.w + x];
      if (!ch) continue;
      const bx = x + ox, by = y + oy;
      if (bx < 0 || by < 0 || bx >= base.w || by >= base.h) continue;
      c[by * base.w + bx] = ch === 95 /* _ */ ? 0 : ch;
    }
  }
  return { w: base.w, h: base.h, ax: base.ax, ay: base.ay, c };
}

/** Character → slot table for stamping templates. */
export function charMap(pairs: Record<string, number>): Uint8Array {
  const m = new Uint8Array(128);
  for (const [k, v] of Object.entries(pairs)) m[k.charCodeAt(0)] = v;
  return m;
}
