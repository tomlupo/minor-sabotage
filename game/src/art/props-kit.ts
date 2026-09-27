// Shared tools of the prop painters (props.ts and props-*.ts): the renderer set up for props
// (style guide §4: outline on the bottom and right, a cast shadow to the south-east at 27%),
// materials that char and glow when a prop burns, a heightfield painter for snow heaps and
// sandbag tops, and small 2D helpers for hand-placed pixels in the game's projection.
import type { PropArt, PropState } from "./types";
import { PAL, ramp, type RGB, type Ramp } from "./palette";
import { hash2, img, px, type PixelImage } from "./pixel";
import { vnoise } from "./fx-noise";
import { bounds, fitCell, render, silhouette, toneOf, type Cell, type Hit, type Mat, type Mesh, type Shadow, type Tex } from "./vehicles-3d";

export const C = PAL.city_1943, S = PAL.shared, F = PAL.forest;
export const EMBER: Ramp = ramp("props_extra", "ember");
export const GREY: Ramp = ramp("props_extra", "vehicle_grey");
export const IRON: Ramp = [S.outline, C.soot[0], C.soot[1], C.soot[2]];
export const CHAR: Ramp = [S.glass_dark, S.outline, C.soot[0], C.soot[1]];
export const RUST: Ramp = [F.trunk[0], F.trunk[1], C.wood[0]];

/** Props cast the same shadow as vehicles: 0.32 m east and 0.24 m south per metre of height. */
export const PROP_SHADOW: Shadow = { kx: 0.32, ky: 0.24, alpha: 69 };

export interface PropRender {
  outline?: "all" | "br" | "none";
  shadow?: Shadow | null;
  edge?: number;
  margin?: number;
  cell?: Cell;
}

/** Render a prop's mesh at its fixed orientation, anchor = its ground point. */
export function renderProp(m: Mesh, o: PropRender = {}): PropArt {
  const shadow = o.shadow === undefined ? PROP_SHADOW : o.shadow;
  const cell = o.cell ?? fitCell(bounds(m, 0, shadow), o.margin ?? 2);
  const r = render(m, { yaw: 0, cell, outline: o.outline ?? "br", edge: o.edge ?? 0.12, shadow });
  return { image: r.image, ax: r.ax, ay: r.ay };
}

/** Screen pixel of a local point (metres) for an image anchored at (ax, ay). */
export function P(a: { ax: number; ay: number }, x: number, y: number, z: number): [number, number] {
  return [Math.floor(a.ax + x * 12), Math.floor(a.ay + y * 9 - z * 7.5)];
}

export const flat = (r: Ramp, fixed?: number): Mat => (fixed === undefined ? { ramp: r } : { ramp: r, fixed });

/**
 * A material that, burning, blackens from the top down with glowing seams, and destroyed is a
 * charred ruin; `detail` adds a tone shift, a colour or a hole on top of the plain tone.
 */
export function mat(base: Ramp, st: PropState = "intact", seed = 0, detail?: (h: Hit) => number | RGB | null | undefined, top = 2): Mat {
  const tex: Tex = (h) => {
    const d = detail ? detail(h) : undefined;
    if (d === null) return null;
    if (typeof d === "object") return d;
    const shift = d ?? 0;
    if (st === "burning") {
      const k = vnoise(h.x * 4, h.y * 4, h.z * 3, seed) * 0.7 + (h.z / top) * 0.4;
      if (k > 0.78) return hash2(h.px, h.py, seed) < 0.3 ? EMBER[1] : EMBER[0];
      if (k > 0.52) return toneOf(CHAR, h.t + shift);
      return toneOf(base, h.t + shift);
    }
    if (st === "destroyed") {
      const k = vnoise(h.x * 5, h.y * 5, h.z * 5, seed + 7);
      if (k > 0.72 && hash2(h.px, h.py, seed) < 0.18) return EMBER[0];
      return toneOf(k > 0.6 ? RUST : CHAR, h.t + shift);
    }
    return toneOf(base, h.t + shift);
  };
  return { ramp: base, tex };
}

/** Glass: sky reflection with a glint, unlit (style guide: the city at five o'clock). */
export function glassTex(h: Hit): RGB {
  const g = (h.px + h.py) % 6;
  if (h.t >= 2) return g < 2 ? C.puddle[1] : S.glass;
  return g < 2 ? S.glass : S.glass_dark;
}

// ---------------------------------------------------------------- heightfield mounds

/**
 * Paint a mound (snow heap, rubble) from a height function over the ground rectangle
 * [x0, x1] x [y0, y1] metres: splatted back to front, lit by its slope from the top left,
 * coloured by `shade(tone 0..3, slope, x, y, z)`. Draws into `im` around (ax, ay).
 */
export function mound(
  im: PixelImage, ax: number, ay: number,
  x0: number, x1: number, y0: number, y1: number,
  height: (x: number, y: number) => number,
  shade: (t: number, x: number, y: number, z: number, sx: number, sy: number) => RGB | null,
): void {
  const step = 1 / 24;
  const W = im.w, H = im.h;
  for (let y = y0; y <= y1; y += step) {
    for (let x = x0; x <= x1; x += step / 1.5) {
      const z = height(x, y);
      if (z <= 0) continue;
      const e = 0.05;
      const dzx = (height(x + e, y) - height(x - e, y)) / (2 * e);
      const dzy = (height(x, y + e) - height(x, y - e)) / (2 * e);
      // normal (-dzx, -dzy, 1) against the light from the north-west and above
      const l = Math.sqrt(dzx * dzx + dzy * dzy + 1);
      const i = (dzx * 0.45 + dzy * 0.35 + 0.82) / l;
      const t = i > 0.9 ? 3 : i > 0.72 ? 2 : i > 0.45 ? 1 : 0;
      const sx = Math.floor(ax + x * 12);
      const syTop = Math.floor(ay + y * 9 - z * 7.5);
      const syGround = Math.floor(ay + y * 9);
      if (sx < 0 || sx >= W) continue;
      for (let sy = Math.max(0, syTop); sy <= Math.min(H - 1, syGround); sy++) {
        const c = shade(sy === syTop ? t : Math.min(t, 1), x, y, z, sx, sy);
        if (c) px(im, sx, sy, c);
      }
    }
  }
}

// ---------------------------------------------------------------- 2D helpers

/** A 1 px line in a colour, between two local points (metres). */
export function line3(im: PixelImage, a: { ax: number; ay: number }, p: [number, number, number], q: [number, number, number], c: RGB, every = 1): void {
  const [x0, y0] = P(a, p[0], p[1], p[2]);
  const [x1, y1] = P(a, q[0], q[1], q[2]);
  let x = x0, y = y0;
  const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1, dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
  let err = dx + dy, n = 0;
  for (;;) {
    if (n++ % every === 0) px(im, x, y, c);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
}

/** Grow an image by a margin on each side (moving the anchor with it). */
export function pad(a: PropArt, l: number, t: number, r: number, b: number): PropArt {
  const out = img(a.image.w + l + r, a.image.h + t + b);
  const s = a.image.data, d = out.data;
  for (let y = 0; y < a.image.h; y++) d.set(s.subarray(y * a.image.w * 4, (y + 1) * a.image.w * 4), ((y + t) * out.w + l) * 4);
  return { image: out, ax: a.ax + l, ay: a.ay + t };
}

/** Outline what was hand-painted into an image (bottom and right, like the renderer's props). */
export function outlineBR(im: PixelImage): void {
  silhouette(im.data, im.w, im.h, "br");
}

/** The shadow colour at the prop shadow's alpha, for hand-painted shadows. */
export function shadowPx(im: PixelImage, x: number, y: number): void {
  if (x < 0 || y < 0 || x >= im.w || y >= im.h) return;
  const i = (y * im.w + x) * 4;
  if (im.data[i + 3]) return;
  const c = S.shadow;
  im.data[i] = c[0]; im.data[i + 1] = c[1]; im.data[i + 2] = c[2]; im.data[i + 3] = PROP_SHADOW.alpha;
}
