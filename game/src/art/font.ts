// Pixel fonts for the HUD and the screens (style guide §8, §9). Three faces, all drawn here
// as glyph sheets, none copied from an existing font:
//   FONT        proportional text face, cap height 7, line height 10: full Latin, Polish,
//               German, digits, punctuation and the game's symbols (★ ✝ → ←).
//   FONT_SMALL  capitals for identity tags: cap height 5, line height 7.
//   FONT_BIG    a stencil display face, cap height 12: titles and the GO button.
//
// Metrics. `y` in drawText is the top of the line box. Capitals start `top` rows below it and
// are `cap` rows tall, so the baseline is at y + top + cap. Accents on capitals sit in the
// `top` rows with a row of air under them; lowercase accents sit where the dot of i does, so
// running text at the stated line height never has a descender touching an accent below it.
// Several lines of accented capitals want `lineGap: 1`. The atlas maps onto Phaser's
// BitmapFontData: `yoff` is from the top of the line box, `adv` includes the letter spacing,
// and `size` is what BitmapText's fontSize must be for 1:1 pixels.
import { colour, type RGB } from "./palette";
import { img, px, type PixelImage } from "./pixel";
import { SMALL_SHEETS, SMALL_MARKS } from "./font-small";
import { TEXT_SHEETS, TEXT_MARKS } from "./font-text";
import { BIG_SHEETS, BIG_MARKS } from "./font-big";

export interface Glyph {
  /** The ink box, in px (0 x 0 for a space). */
  w: number;
  h: number;
  /** Ink box offset from the pen (x) and from the top of the line box (y). */
  xoff: number;
  yoff: number;
  /** Pen advance, letter spacing included. */
  adv: number;
  /** w * h, 1 where there is ink. */
  bits: Uint8Array;
}

export interface PixelFont {
  name: string;
  /** Phaser BitmapFontData.size: pass it as BitmapText's fontSize for 1:1 pixels. */
  size: number;
  lineHeight: number;
  /** Capital height, and the rows from the top of the line box down to the capitals. */
  cap: number;
  top: number;
  /** Letter spacing, already included in every advance. */
  spacing: number;
  glyphs: Map<number, Glyph>;
}

// ---------------------------------------------------------------- building fonts from sheets

/** One glyph as designed: its advance width without spacing, and its ink relative to the
 *  pen position (x) and the top of the capitals (y; negative is above, cap and more below). */
export interface GlyphDef {
  w: number;
  ink: [number, number][];
}

/**
 * Parse glyph sheets. A sheet is a block of lines: the first names the characters (separated
 * by spaces), then `rows` lines draw them, one token per character, `#` ink and `.` empty.
 * Row 0 is the top of the capitals. Blocks follow each other; blank lines are ignored.
 */
export function parseSheets(src: string, rows: number, where: string): Map<string, GlyphDef> {
  const lines = src.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  const out = new Map<string, GlyphDef>();
  for (let i = 0; i < lines.length; i += rows + 1) {
    const names = lines[i].split(/\s+/);
    const body = lines.slice(i + 1, i + 1 + rows).map((l) => l.split(/\s+/));
    if (body.length !== rows) throw new Error(`${where}: block "${lines[i]}" has ${body.length} rows, wants ${rows}`);
    names.forEach((ch, k) => {
      const w = body[0][k]?.length ?? -1;
      const ink: [number, number][] = [];
      body.forEach((row, y) => {
        const tok = row[k];
        if (tok === undefined || tok.length !== w || /[^#.]/.test(tok)) {
          throw new Error(`${where}: glyph "${ch}" row ${y} is "${tok}" (block "${lines[i]}")`);
        }
        for (let x = 0; x < w; x++) if (tok[x] === "#") ink.push([x, y]);
      });
      if (out.has(ch)) throw new Error(`${where}: glyph "${ch}" drawn twice`);
      out.set(ch, { w, ink });
    });
  }
  return out;
}

/** A composed glyph: a base plus marks (accents, ogonek), each a list of ink pixels. */
export interface MarkSpec {
  ch: string;
  base: string;
  add?: [number, number][];
  /** Pixels of the base to clear first (Ł's stem, a notch for a tail). */
  cut?: [number, number][];
}

function compose(defs: Map<string, GlyphDef>, marks: MarkSpec[], where: string): void {
  for (const m of marks) {
    const b = defs.get(m.base);
    if (!b) throw new Error(`${where}: "${m.ch}" composes on a missing "${m.base}"`);
    const cut = new Set((m.cut ?? []).map(([x, y]) => `${x},${y}`));
    const ink = b.ink.filter(([x, y]) => !cut.has(`${x},${y}`)).concat(m.add ?? []);
    defs.set(m.ch, { w: b.w, ink });
  }
}

function finish(def: GlyphDef, top: number, spacing: number): Glyph {
  if (!def.ink.length) return { w: 0, h: 0, xoff: 0, yoff: 0, adv: def.w + spacing, bits: new Uint8Array(0) };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of def.ink) {
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const bits = new Uint8Array(w * h);
  for (const [x, y] of def.ink) bits[(y - y0) * w + (x - x0)] = 1;
  return { w, h, xoff: x0, yoff: y0 + top, adv: def.w + spacing, bits };
}

function makeFont(o: {
  name: string;
  cap: number;
  top: number;
  lineHeight: number;
  spacing: number;
  space: number;
  rows: number;
  sheets: string;
  marks: MarkSpec[];
}): PixelFont {
  const defs = parseSheets(o.sheets, o.rows, o.name);
  compose(defs, o.marks, o.name);
  defs.set(" ", { w: o.space, ink: [] });
  const glyphs = new Map<number, Glyph>();
  for (const [ch, def] of defs) glyphs.set(ch.codePointAt(0)!, finish(def, o.top, o.spacing));
  return { name: o.name, size: o.lineHeight, lineHeight: o.lineHeight, cap: o.cap, top: o.top, spacing: o.spacing, glyphs };
}

export const FONT: PixelFont = makeFont({
  name: "text", cap: 7, top: 2, lineHeight: 10, spacing: 1, space: 3, rows: 9, sheets: TEXT_SHEETS, marks: TEXT_MARKS,
});
export const FONT_SMALL: PixelFont = makeFont({
  name: "small", cap: 5, top: 2, lineHeight: 7, spacing: 1, space: 2, rows: 6, sheets: SMALL_SHEETS, marks: SMALL_MARKS,
});
export const FONT_BIG: PixelFont = makeFont({
  name: "big", cap: 12, top: 3, lineHeight: 17, spacing: 1, space: 5, rows: 14, sheets: BIG_SHEETS, marks: BIG_MARKS,
});

// ---------------------------------------------------------------- the character sets

/** What each face promises to draw (the tests hold every face to its set). */
export const CHARSETS = {
  text:
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz" +
    "ąćęłńóśźżĄĆĘŁŃÓŚŹŻäöüßÄÖÜ" +
    "0123456789" +
    ".,:;!?'\"()-–—/+%&*#@…„”«»°★✝→← " +
    "“‘’×·$<>=[]_|~^{}\\`",
  small: "ABCDEFGHIJKLMNOPQRSTUVWXYZĄĆĘŁŃÓŚŹŻ0123456789.,:;!?'\"()-–—/+%&#*…×° ",
  big: "ABCDEFGHIJKLMNOPQRSTUVWXYZĄĆĘŁŃÓŚŹŻ0123456789.,:;!?'\"()-/ ",
} as const;

// ---------------------------------------------------------------- lookup with fallbacks

const FALLBACK: Record<string, string> = {
  "‘": "'", "’": "'", "‚": ",", "“": '"', "”": '"', "„": '"', "«": '"', "»": '"',
  "–": "-", "—": "-", "…": "...", "×": "x", "·": ".", "\t": " ", " ": " ",
};

/** The glyphs that draw one character: itself, or a stand-in the face can draw. */
function glyphsFor(font: PixelFont, ch: string): Glyph[] {
  const g = font.glyphs.get(ch.codePointAt(0)!);
  if (g) return [g];
  const tries = [ch.toUpperCase(), ch.normalize("NFD").replace(/[̀-ͯ]/g, ""), FALLBACK[ch]];
  for (const t of tries) {
    if (!t || t === ch) continue;
    const gs = [...t].map((c) => font.glyphs.get(c.codePointAt(0)!) ?? font.glyphs.get(c.toUpperCase().codePointAt(0)!));
    if (gs.every((x): x is Glyph => !!x)) return gs;
  }
  const q = font.glyphs.get(63); // "?"
  return q ? [q] : [];
}

/** Whether the face draws this character itself (no stand-in). */
export function hasGlyph(font: PixelFont, ch: string): boolean {
  return font.glyphs.has(ch.codePointAt(0)!);
}

// ---------------------------------------------------------------- measure, draw, wrap

function lineWidth(font: PixelFont, line: string): number {
  let w = 0, any = false;
  for (const ch of line) for (const g of glyphsFor(font, ch)) { w += g.adv; any = true; }
  return any ? w - font.spacing : 0;
}

/** Width in px of the widest line of `text` (lines split on "\n"), without trailing spacing. */
export function measure(font: PixelFont, text: string): number {
  let w = 0;
  for (const line of text.split("\n")) w = Math.max(w, lineWidth(font, line));
  return w;
}

export interface TextOpts {
  /** x is the left edge, the centre or the right edge of each line. */
  align?: "left" | "center" | "right";
  /** A one-pixel drop shadow toward the bottom right (a light one reads as stamped in). */
  shadow?: RGB;
  /** Shadow offset, default [1, 1]. */
  shadowOffset?: readonly [number, number];
  /** Extra pixels between lines. Capitals carry their accents in the line box's top rows, so
   *  several lines of capitals with Polish accents read best with 1 (Phaser: lineSpacing). */
  lineGap?: number;
}

function drawLine(im: PixelImage, font: PixelFont, x: number, y: number, line: string, c: RGB): void {
  let pen = x;
  for (const ch of line) {
    for (const g of glyphsFor(font, ch)) {
      for (let j = 0; j < g.h; j++) {
        for (let i = 0; i < g.w; i++) if (g.bits[j * g.w + i]) px(im, pen + g.xoff + i, y + g.yoff + j, c);
      }
      pen += g.adv;
    }
  }
}

/**
 * Draw text with its line box's top at y. Lines split on "\n" and step by the line height.
 * Returns the width of the widest line.
 */
export function drawText(im: PixelImage, font: PixelFont, x: number, y: number, text: string, c: RGB, opts: TextOpts = {}): number {
  const lines = text.split("\n");
  const [sx, sy] = opts.shadowOffset ?? [1, 1];
  const step = font.lineHeight + (opts.lineGap ?? 0);
  let widest = 0;
  const starts = lines.map((line) => {
    const w = lineWidth(font, line);
    widest = Math.max(widest, w);
    const a = opts.align ?? "left";
    return a === "center" ? Math.round(x - w / 2) : a === "right" ? x - w : x;
  });
  if (opts.shadow) lines.forEach((line, i) => drawLine(im, font, starts[i] + sx, y + i * step + sy, line, opts.shadow!));
  lines.forEach((line, i) => drawLine(im, font, starts[i], y + i * step, line, c));
  return widest;
}

/**
 * Break text into lines no wider than maxWidth: on spaces, keeping "\n" breaks, and cutting a
 * word that alone is too wide. Never returns an empty list.
 */
export function wrapText(font: PixelFont, text: string, maxWidth: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    const words = para.split(" ").filter((w) => w.length > 0);
    let line = "";
    for (let word of words) {
      const trial = line ? `${line} ${word}` : word;
      if (measure(font, trial) <= maxWidth) { line = trial; continue; }
      if (line) { out.push(line); line = ""; }
      // a single word wider than the line: cut it
      while (measure(font, word) > maxWidth && [...word].length > 1) {
        const chars = [...word];
        let n = chars.length - 1;
        while (n > 1 && measure(font, chars.slice(0, n).join("")) > maxWidth) n--;
        out.push(chars.slice(0, n).join(""));
        word = chars.slice(n).join("");
      }
      line = word;
    }
    out.push(line);
  }
  return out.length ? out : [""];
}

/** Cut text to fit maxWidth, ending in `mark` (default ".", the Polish abbreviation dot). */
export function fitText(font: PixelFont, text: string, maxWidth: number, mark = "."): string {
  if (measure(font, text) <= maxWidth) return text;
  const chars = [...text];
  for (let n = chars.length - 1; n > 0; n--) {
    const t = chars.slice(0, n).join("").trimEnd() + mark;
    if (measure(font, t) <= maxWidth) return t;
  }
  return "";
}

// ---------------------------------------------------------------- atlas for Phaser

export interface FontAtlas {
  image: PixelImage;
  lineHeight: number;
  size: number;
  chars: Record<number, { x: number; y: number; w: number; h: number; xoff: number; yoff: number; adv: number }>;
}

/**
 * Every glyph packed white-on-transparent (so the game tints it), in code-point order with a
 * pixel of padding. `chars` maps a code point to its cell and metrics, as BitmapFontData wants.
 */
export function buildFontAtlas(font: PixelFont, width = 128): FontAtlas {
  const tint = colour("hud_extra", "tint");
  const codes = [...font.glyphs.keys()].sort((a, b) => a - b);
  const cells: { code: number; x: number; y: number }[] = [];
  let x = 1, y = 1, rowH = 0;
  for (const code of codes) {
    const g = font.glyphs.get(code)!;
    if (x + g.w + 1 > width) { x = 1; y += rowH + 1; rowH = 0; }
    cells.push({ code, x, y });
    x += g.w + 1;
    rowH = Math.max(rowH, g.h);
  }
  const image = img(width, y + rowH + 1);
  const chars: FontAtlas["chars"] = {};
  for (const { code, x: cx, y: cy } of cells) {
    const g = font.glyphs.get(code)!;
    for (let j = 0; j < g.h; j++) for (let i = 0; i < g.w; i++) if (g.bits[j * g.w + i]) px(image, cx + i, cy + j, tint);
    chars[code] = { x: cx, y: cy, w: g.w, h: g.h, xoff: g.xoff, yoff: g.yoff, adv: g.adv };
  }
  return { image, lineHeight: font.lineHeight, size: font.size, chars };
}
