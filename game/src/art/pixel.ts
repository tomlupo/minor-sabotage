// Tiny pixel-art toolkit shared by every art generator. Pure functions over RGBA buffers, so
// generators run in the browser (at boot) and in Node (tests, contact sheets) alike.
// Coordinates are art pixels. Colours come from palette.ts, never literals.
import type { RGB } from "./palette";

export interface PixelImage {
  w: number;
  h: number;
  data: Uint8ClampedArray; // RGBA, row-major
}

export function img(w: number, h: number): PixelImage {
  return { w, h, data: new Uint8ClampedArray(w * h * 4) };
}

export function clone(im: PixelImage): PixelImage {
  return { w: im.w, h: im.h, data: new Uint8ClampedArray(im.data) };
}

export function inside(im: PixelImage, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < im.w && y < im.h;
}

/** Write one pixel. alpha 0..255; below 255 it blends over what is there. */
export function px(im: PixelImage, x: number, y: number, c: RGB, alpha = 255): void {
  x |= 0;
  y |= 0;
  if (x < 0 || y < 0 || x >= im.w || y >= im.h) return;
  const i = (y * im.w + x) * 4;
  const d = im.data;
  if (alpha >= 255) {
    d[i] = c[0];
    d[i + 1] = c[1];
    d[i + 2] = c[2];
    d[i + 3] = 255;
    return;
  }
  if (alpha <= 0) return;
  const a = alpha / 255;
  const da = d[i + 3] / 255;
  const oa = a + da * (1 - a);
  if (oa <= 0) return;
  d[i] = (c[0] * a + d[i] * da * (1 - a)) / oa;
  d[i + 1] = (c[1] * a + d[i + 1] * da * (1 - a)) / oa;
  d[i + 2] = (c[2] * a + d[i + 2] * da * (1 - a)) / oa;
  d[i + 3] = oa * 255;
}

export function get(im: PixelImage, x: number, y: number): [number, number, number, number] {
  if (!inside(im, x, y)) return [0, 0, 0, 0];
  const i = (y * im.w + x) * 4;
  return [im.data[i], im.data[i + 1], im.data[i + 2], im.data[i + 3]];
}

export function alphaAt(im: PixelImage, x: number, y: number): number {
  if (!inside(im, x, y)) return 0;
  return im.data[(y * im.w + x) * 4 + 3];
}

export function clear(im: PixelImage, x: number, y: number): void {
  if (!inside(im, x, y)) return;
  const i = (y * im.w + x) * 4;
  im.data[i] = im.data[i + 1] = im.data[i + 2] = im.data[i + 3] = 0;
}

export function rect(im: PixelImage, x: number, y: number, w: number, h: number, c: RGB, alpha = 255): void {
  const x0 = Math.max(0, Math.floor(x)), y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(im.w, Math.floor(x + w)), y1 = Math.min(im.h, Math.floor(y + h));
  for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) px(im, xx, yy, c, alpha);
}

export function hline(im: PixelImage, x0: number, x1: number, y: number, c: RGB, alpha = 255): void {
  if (x1 < x0) [x0, x1] = [x1, x0];
  for (let x = Math.floor(x0); x <= Math.floor(x1); x++) px(im, x, y, c, alpha);
}

export function vline(im: PixelImage, x: number, y0: number, y1: number, c: RGB, alpha = 255): void {
  if (y1 < y0) [y0, y1] = [y1, y0];
  for (let y = Math.floor(y0); y <= Math.floor(y1); y++) px(im, x, y, c, alpha);
}

/** Bresenham line. `every` > 1 draws a dotted line (every n-th pixel). */
export function line(im: PixelImage, x0: number, y0: number, x1: number, y1: number, c: RGB, alpha = 255, every = 1): void {
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
  let err = dx + dy, n = 0;
  for (;;) {
    if (n++ % every === 0) px(im, x0, y0, c, alpha);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

export function ellipse(im: PixelImage, cx: number, cy: number, rx: number, ry: number, c: RGB, alpha = 255, fill = true): void {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const nx = (x + 0.5 - cx) / rx, ny = (y + 0.5 - cy) / ry;
      const d = nx * nx + ny * ny;
      if (fill ? d <= 1 : d <= 1 && d > 0.6) px(im, x, y, c, alpha);
    }
  }
}

/** Scanline polygon fill (even-odd). Points in art px. */
export function poly(im: PixelImage, pts: [number, number][], c: RGB, alpha = 255): void {
  if (pts.length < 3) return;
  let minY = Infinity, maxY = -Infinity;
  for (const [, y] of pts) { minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
    const sy = y + 0.5;
    const xs: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      const [ax, ay] = pts[i];
      const [bx, by] = pts[(i + 1) % pts.length];
      if ((ay <= sy && by > sy) || (by <= sy && ay > sy)) xs.push(ax + ((sy - ay) / (by - ay)) * (bx - ax));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      for (let x = Math.ceil(xs[k] - 0.5); x < Math.ceil(xs[k + 1] - 0.5); x++) px(im, x, y, c, alpha);
    }
  }
}

export interface BlitOpts {
  flipX?: boolean;
  flipY?: boolean;
  alpha?: number; // 0..1 multiplier
  /** Source rectangle; defaults to the whole image. */
  sx?: number; sy?: number; sw?: number; sh?: number;
}

export function blit(dst: PixelImage, src: PixelImage, dx: number, dy: number, o: BlitOpts = {}): void {
  const sx0 = o.sx ?? 0, sy0 = o.sy ?? 0;
  const sw = o.sw ?? src.w, sh = o.sh ?? src.h;
  const am = o.alpha ?? 1;
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const sxx = o.flipX ? sx0 + sw - 1 - x : sx0 + x;
      const syy = o.flipY ? sy0 + sh - 1 - y : sy0 + y;
      const i = (syy * src.w + sxx) * 4;
      const a = src.data[i + 3];
      if (!a) continue;
      px(dst, dx + x, dy + y, [src.data[i], src.data[i + 1], src.data[i + 2]], a * am);
    }
  }
}

export function crop(src: PixelImage, x: number, y: number, w: number, h: number): PixelImage {
  const out = img(w, h);
  blit(out, src, 0, 0, { sx: x, sy: y, sw: w, sh: h });
  return out;
}

export function mirrorX(src: PixelImage): PixelImage {
  const out = img(src.w, src.h);
  blit(out, src, 0, 0, { flipX: true });
  return out;
}

/**
 * Style guide §4: a 1 px outline in `outline` around every opaque shape. With
 * sides "br" only the bottom and right edges get it (props facing top-left light).
 */
export function outline(im: PixelImage, c: RGB, sides: "all" | "br" = "all"): void {
  const mark: number[] = [];
  const dirs = sides === "all" ? [[1, 0], [-1, 0], [0, 1], [0, -1]] : [[-1, 0], [0, -1]];
  for (let y = 0; y < im.h; y++) {
    for (let x = 0; x < im.w; x++) {
      if (alphaAt(im, x, y)) continue;
      // a transparent pixel next to an opaque one becomes outline
      for (const [ddx, ddy] of dirs) {
        if (alphaAt(im, x + ddx, y + ddy) > 127) { mark.push(x, y); break; }
      }
    }
  }
  for (let i = 0; i < mark.length; i += 2) px(im, mark[i], mark[i + 1], c);
}

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
/** 4x4 Bayer threshold in [0, 1). Style guide §4: dither only ground and foliage. */
export function bayer(x: number, y: number): number {
  return BAYER4[((y & 3) << 2) | (x & 3)] / 16;
}

/** Deterministic 2D hash noise in [0,1), for texture variation without Math.random. */
export function hash2(x: number, y: number, seed = 0): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Small seeded PRNG (mulberry32) for generators. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Browser only: turn a pixel image into a canvas for Phaser textures or the art lab. */
export function toCanvas(im: PixelImage): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = im.w;
  c.height = im.h;
  const ctx = c.getContext("2d")!;
  const id = ctx.createImageData(im.w, im.h);
  id.data.set(im.data);
  ctx.putImageData(id, 0, 0);
  return c;
}

/** A named rectangle in a sheet, with the anchor (feet, ground point) in frame pixels. */
export interface Frame {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  ax: number;
  ay: number;
}

export interface Sheet {
  image: PixelImage;
  frames: Frame[];
}

/** Pack equally sized cells into a sheet, row-major. */
export function packCells(cells: { name: string; im: PixelImage; ax: number; ay: number }[], cols = 16): Sheet {
  if (!cells.length) return { image: img(1, 1), frames: [] };
  const cw = Math.max(...cells.map((c) => c.im.w));
  const ch = Math.max(...cells.map((c) => c.im.h));
  const rows = Math.ceil(cells.length / cols);
  const image = img(cw * Math.min(cols, cells.length), ch * rows);
  const frames: Frame[] = cells.map((c, i) => {
    const x = (i % cols) * cw, y = Math.floor(i / cols) * ch;
    blit(image, c.im, x, y);
    return { name: c.name, x, y, w: c.im.w, h: c.im.h, ax: c.ax, ay: c.ay };
  });
  return { image, frames };
}
