// Title art (style guide §7, §9): the logo and the minor-sabotage turtle. Wall stencils and
// slogans, never the Kotwica (the Fighting Poland anchor is protected by the act of 2014).
import type { RGB } from "./palette";
import { img, px, type PixelImage } from "./pixel";
import { FONT, FONT_BIG, FONT_SMALL, drawText, measure, type PixelFont } from "./font";
import { HUD, edgeOf, mask, maskFrom, on, ringOf, set, shift, stamp, union, type Mask } from "./hud-kit";

/** One capital of a font as a mask, cap height tall, as wide as its ink. */
function glyphMask(font: PixelFont, ch: string): Mask {
  const g = font.glyphs.get(ch.codePointAt(0)!);
  if (!g) throw new Error(`title: no glyph "${ch}" in ${font.name}`);
  const m = mask(g.w, font.cap);
  for (let j = 0; j < g.h; j++) for (let i = 0; i < g.w; i++) if (g.bits[j * g.w + i]) set(m, i, g.yoff - font.top + j);
  return m;
}

/** Text in one font as a mask, cropped to its ink. */
function textMask(font: PixelFont, text: string): Mask {
  const w = measure(font, text) + 2, h = font.lineHeight + 4;
  const im = img(w, h);
  drawText(im, font, 1, 1, text, HUD.chalk);
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (im.data[(y * w + x) * 4 + 3]) {
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  const m = mask(x1 - x0 + 1, y1 - y0 + 1);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (im.data[(y * w + x) * 4 + 3]) set(m, x - x0, y - y0);
  return m;
}

/** Scale2x (EPX): doubles a mask and rounds its diagonals, so the big letters keep a 1 px
 *  edge instead of turning into 2 px steps. */
export function scale2x(m: Mask): Mask {
  const out = mask(m.w * 2, m.h * 2);
  const g = (x: number, y: number) => (on(m, x, y) ? 1 : 0);
  for (let y = 0; y < m.h; y++) {
    for (let x = 0; x < m.w; x++) {
      const P = g(x, y), A = g(x, y - 1), B = g(x + 1, y), C = g(x - 1, y), D = g(x, y + 1);
      let e0 = P, e1 = P, e2 = P, e3 = P;
      if (C === A && C !== D && A !== B) e0 = A;
      if (A === B && A !== C && B !== D) e1 = B;
      if (D === C && D !== B && C !== A) e2 = C;
      if (B === D && B !== A && D !== C) e3 = D;
      set(out, x * 2, y * 2, e0);
      set(out, x * 2 + 1, y * 2, e1);
      set(out, x * 2, y * 2 + 1, e2);
      set(out, x * 2 + 1, y * 2 + 1, e3);
    }
  }
  return out;
}

const TITLE = "MINOR SABOTAGE";
/** Paint runs: [letter index in TITLE, x in the doubled glyph, length]. Long and thin, and only
 *  under M, I and G, clear of the subtitle, so a run never reads as a diacritic (Ą, Ę, Ţ). */
const DRIPS: [number, number, number][] = [[0, 2, 9], [1, 3, 6], [12, 9, 8]];

/**
 * "MINOR SABOTAGE" in big stencil capitals (the display face doubled with Scale2x), painted
 * in chalk with a dark block shadow and a few paint runs, and "MAŁY SABOTAŻ" beneath between
 * two white-and-red armband bars. 251 x 54.
 */
export function buildLogo(): PixelImage {
  const track = 1, space = 7;
  const glyphs = [...TITLE].map((ch) => (ch === " " ? null : scale2x(glyphMask(FONT_BIG, ch))));
  const titleW = glyphs.reduce((s, g) => s + (g ? g.w + track : space), 0) - track;
  const titleH = FONT_BIG.cap * 2;
  const sub = textMask(FONT_BIG, "MAŁY SABOTAŻ");
  const W = titleW + 5, top = 1;
  const subY = top + titleH + 10;
  const H = subY + sub.h + 4;
  const im = img(W, H);
  // letters and their paint runs
  let face = mask(W, H), x = 1;
  const starts: number[] = [];
  for (const g of glyphs) {
    starts.push(x);
    if (!g) { x += space; continue; }
    face = union(face, g, x, top);
    x += g.w + track;
  }
  const letters: Mask = { w: face.w, h: face.h, bits: new Uint8Array(face.bits) };
  for (const [i, dx, len] of DRIPS) {
    const cx = starts[i] + dx, y0 = top + titleH;
    for (let k = 0; k < len; k++) set(face, cx, y0 + k);
    for (const [ox, oy] of [[0, len], [1, len - 1], [1, len]]) set(face, cx + ox, y0 + oy);
  }
  // block shadow two pixels deep, then the outline around everything, the chalk, and its light
  const block = union(union(shift(face, 1, 1), shift(face, 2, 2)), face);
  stamp(im, ringOf(block), 0, 0, HUD.outline);
  stamp(im, block, 0, 0, HUD.outline);
  stamp(im, face, 0, 0, HUD.chalk);
  stamp(im, edgeOf(face, 0, -1), 0, 0, HUD.ghost);
  stamp(im, edgeOf(letters, 0, 1), 0, 0, HUD.paperLo);
  // subtitle between armband bars
  const sx = Math.round((W - sub.w) / 2), sy = subY;
  const s = shift(sub, sx, sy, W, H);
  stamp(im, ringOf(union(s, shift(s, 1, 1))), 0, 0, HUD.outline);
  stamp(im, shift(s, 1, 1), 0, 0, HUD.outline);
  stamp(im, s, 0, 0, HUD.chalk);
  const barW = 16, barY = sy + Math.floor(sub.h / 2) - 2;
  for (const bx of [sx - barW - 7, sx + sub.w + 7]) armband(im, bx, barY, barW);
  return im;
}

function armband(im: PixelImage, x: number, y: number, w: number): void {
  for (let i = -1; i <= w; i++) for (let j = -1; j <= 4; j++) px(im, x + i, y + j, HUD.outline);
  for (let i = 0; i < w; i++) {
    px(im, x + i, y, HUD.flagWhite); px(im, x + i, y + 1, HUD.flagWhite);
    px(im, x + i, y + 2, HUD.flagRed); px(im, x + i, y + 3, HUD.flagRed);
  }
}

// ---------------------------------------------------------------- the turtle

export interface TurtleOpts {
  /** Paint colour; chalk by default (the turtle was chalked and painted on walls). */
  colour?: RGB;
  /** Add "PRACUJ POWOLI" (work slowly) under the turtle. */
  caption?: boolean;
}

/** The small turtle, drawn by hand: at 16 px the shapes need every pixel placed. */
const TURTLE_16 = maskFrom([
  "................",
  ".......##.......",
  "......####......",
  "................",
  ".##..######..##.",
  "..#.########.#..",
  "....########....",
  "....########....",
  "....########....",
  "....########....",
  "..#.########.#..",
  ".##..######..##.",
  "................",
  ".......##.......",
  "................",
  "................",
]);

/**
 * The minor-sabotage turtle ("Pracuj powoli", work slowly) as a wall stencil seen from above:
 * a shell cut into plates, and head, legs and tail standing apart from it the way a stencil
 * needs bridges. `size` is the turtle's height in px (16 and up; below 22 it is drawn by hand);
 * the image is size x size, taller by a caption line when asked.
 */
export function buildTurtle(size: number, opts: TurtleOpts = {}): PixelImage {
  const s = Math.max(16, Math.round(size));
  const c = opts.colour ?? HUD.chalk;
  const capFont = s >= 48 ? FONT : FONT_SMALL;
  const capH = opts.caption ? capFont.lineHeight + 2 : 0;
  const im = img(Math.max(s, opts.caption ? measure(capFont, "PRACUJ POWOLI") + 2 : 0), s + capH);
  const ox = Math.floor((im.w - s) / 2);
  if (s < 22) {
    const o = Math.floor((s - 16) / 2);
    stamp(im, TURTLE_16, ox + o, o, c);
  } else {
    paintTurtle(im, s, ox, c);
  }
  if (opts.caption) drawText(im, capFont, Math.floor(im.w / 2), s + 1, "PRACUJ POWOLI", c, { align: "center" });
  return im;
}

function paintTurtle(im: PixelImage, s: number, ox: number, c: RGB): void {
  const gap = Math.max(1, Math.round(s / 22)) / s; // a stencil bridge, in turtle units
  const shell = { cx: 0.5, cy: 0.54, rx: 0.29, ry: 0.33 };
  const e = (x: number, y: number) => ((x - shell.cx) / shell.rx) ** 2 + ((y - shell.cy) / shell.ry) ** 2;
  const rim = (x: number, y: number) => (Math.sqrt(e(x, y)) - 1) * Math.min(shell.rx, shell.ry);
  const inEll = (x: number, y: number, cx: number, cy: number, rx: number, ry: number, a = 0) => {
    const dx = x - cx, dy = y - cy, ca = Math.cos(a), sa = Math.sin(a);
    const u = (dx * ca + dy * sa) / rx, v = (-dx * sa + dy * ca) / ry;
    return u * u + v * v <= 1;
  };
  // plate seams: a hexagon in the middle of the shell and spokes out to the rim
  const hex: [number, number][] = [];
  for (let k = 0; k < 6; k++) {
    const a = (Math.PI / 3) * k + Math.PI / 6;
    hex.push([shell.cx + Math.cos(a) * shell.rx * 0.42, shell.cy + Math.sin(a) * shell.ry * 0.42]);
  }
  const segDist = (x: number, y: number, ax: number, ay: number, bx: number, by: number) => {
    const dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
  };
  const seam = (x: number, y: number) => {
    const w = gap * 0.55;
    for (let k = 0; k < 6; k++) {
      const [ax, ay] = hex[k], [bx, by] = hex[(k + 1) % 6];
      if (segDist(x, y, ax, ay, bx, by) < w) return true;
      const a = (Math.PI / 3) * k + Math.PI / 6;
      const ex = shell.cx + Math.cos(a) * shell.rx * 1.2, ey = shell.cy + Math.sin(a) * shell.ry * 1.2;
      if (segDist(x, y, ax, ay, ex, ey) < w) return true;
    }
    return false;
  };
  const limbs = (x: number, y: number) =>
    inEll(x, y, 0.5, 0.13, 0.085, 0.1) || // head
    inEll(x, y, 0.22, 0.33, 0.1, 0.065, -0.6) || inEll(x, y, 0.78, 0.33, 0.1, 0.065, 0.6) || // fore legs
    inEll(x, y, 0.23, 0.78, 0.095, 0.06, 0.6) || inEll(x, y, 0.77, 0.78, 0.095, 0.06, -0.6) || // hind legs
    (y > 0.84 && y < 0.95 && Math.abs(x - 0.5) < (0.95 - y) * 0.45); // tail
  for (let j = 0; j < s; j++) {
    for (let i = 0; i < s; i++) {
      const x = (i + 0.5) / s, y = (j + 0.5) / s;
      const paint = e(x, y) <= 1 ? !seam(x, y) : limbs(x, y) && rim(x, y) > gap;
      if (paint) px(im, ox + i, j, c);
    }
  }
}
