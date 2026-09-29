// A tiny capital pixel font for shop signs and plaques: glyphs are 3 px wide and 5 px tall
// (M, N, W and Ł are wider so they stay legible), plus one row above the cap line for the
// Polish acute and dot (Ć Ń Ó Ś Ź Ż) and one row below for the ogonek (Ą Ę).
// Advance = glyph width + 1 px. Lower case is drawn as capitals.
import type { RGB } from "../palette";
import type { PixelImage } from "../pixel";
import { px } from "../pixel";

interface Glyph {
  w: number;
  /** Body rows, top to bottom, "#" = ink. */
  rows: string[];
  /** Extra pixels outside the body: [x, y] with y = -1 above the cap line, 5 below. */
  marks?: [number, number][];
}

const G = (rows: string, marks?: [number, number][]): Glyph => {
  const r = rows.split(" ");
  return { w: r[0].length, rows: r, marks };
};

const BASE: Record<string, Glyph> = {
  A: G(".#. #.# ### #.# #.#"),
  B: G("##. #.# ##. #.# ##."),
  C: G(".## #.. #.. #.. .##"),
  D: G("##. #.# #.# #.# ##."),
  E: G("### #.. ##. #.. ###"),
  F: G("### #.. ##. #.. #.."),
  G: G(".## #.. #.# #.# .##"),
  H: G("#.# #.# ### #.# #.#"),
  I: G("### .#. .#. .#. ###"),
  J: G("..# ..# ..# #.# .#."),
  K: G("#.# #.# ##. #.# #.#"),
  L: G("#.. #.. #.. #.. ###"),
  M: G("#...# ##.## #.#.# #...# #...#"),
  N: G("#..# ##.# #.## #..# #..#"),
  O: G(".#. #.# #.# #.# .#."),
  P: G("##. #.# ##. #.. #.."),
  Q: G(".#. #.# #.# ##. .##"),
  R: G("##. #.# ##. #.# #.#"),
  S: G(".## #.. .#. ..# ##."),
  T: G("### .#. .#. .#. .#."),
  U: G("#.# #.# #.# #.# ###"),
  V: G("#.# #.# #.# #.# .#."),
  W: G("#...# #...# #.#.# ##.## #...#"),
  X: G("#.# #.# .#. #.# #.#"),
  Y: G("#.# #.# .#. .#. .#."),
  Z: G("### ..# .#. #.. ###"),
  "0": G("### #.# #.# #.# ###"),
  "1": G(".#. ##. .#. .#. ###"),
  "2": G("##. ..# .#. #.. ###"),
  "3": G("##. ..# .#. ..# ##."),
  "4": G("#.# #.# ### ..# ..#"),
  "5": G("### #.. ##. ..# ##."),
  "6": G(".## #.. ### #.# ###"),
  "7": G("### ..# .#. .#. .#."),
  "8": G("### #.# ### #.# ###"),
  "9": G("### #.# ### ..# ##."),
  ".": G(". . . . #"),
  ",": G(". . . . #", [[0, 5]]),
  ":": G(". # . # ."),
  "-": G("... ... ### ... ..."),
  "'": G("# # . . ."),
  '"': G("#.# #.# ... ... ..."),
  "/": G("..# ..# .#. #.. #.."),
  "&": G(".#. #.# .#. #.# .##"),
  "!": G("# # # . #"),
  "?": G("##. ..# .#. ... .#."),
  "(": G(".# #. #. #. .#"),
  ")": G("#. .# .# .# #."),
  "+": G("... .#. ### .#. ..."),
  " ": G(".. .. .. .. .."),
};

const acute = (g: Glyph, x = g.w - 1): Glyph => ({ ...g, marks: [...(g.marks ?? []), [x, -1]] });
const dot = (g: Glyph, x = Math.floor(g.w / 2)): Glyph => ({ ...g, marks: [...(g.marks ?? []), [x, -1]] });
const ogonek = (g: Glyph): Glyph => ({ ...g, marks: [...(g.marks ?? []), [g.w - 1, 5]] });

export const GLYPHS: Record<string, Glyph> = {
  ...BASE,
  Ą: ogonek(BASE.A),
  Ć: acute(BASE.C),
  Ę: ogonek(BASE.E),
  Ł: G(".#.. .#.. .##. ##.. .###"),
  Ń: acute(BASE.N, 2),
  Ó: acute(BASE.O),
  Ś: acute(BASE.S),
  Ź: acute(BASE.Z),
  Ż: dot(BASE.Z),
};

function glyphOf(ch: string): Glyph | undefined {
  return GLYPHS[ch] ?? GLYPHS[ch.toUpperCase()];
}

export interface TextMetrics {
  /** Width in px of the inked run (no trailing space). */
  w: number;
  /** True when some glyph uses the row above the cap line (acute, dot). */
  above: boolean;
  /** True when some glyph uses the row below the base line (ogonek, comma). */
  below: boolean;
}

export function measureText(text: string): TextMetrics {
  let w = 0, above = false, below = false, n = 0;
  for (const ch of text) {
    const g = glyphOf(ch);
    if (!g) continue;
    w += g.w + (n++ ? 1 : 0);
    for (const [, y] of g.marks ?? []) {
      if (y < 0) above = true;
      if (y > 4) below = true;
    }
  }
  return { w, above, below };
}

/** Draw `text` with the cap line's top-left at (x, y). Unknown characters are skipped. */
export function drawText(im: PixelImage, text: string, x: number, y: number, c: RGB): number {
  let cx = x, n = 0;
  for (const ch of text) {
    const g = glyphOf(ch);
    if (!g) continue;
    if (n++) cx += 1;
    g.rows.forEach((row, ry) => {
      for (let rx = 0; rx < row.length; rx++) if (row[rx] === "#") px(im, cx + rx, y + ry, c);
    });
    for (const [mx, my] of g.marks ?? []) px(im, cx + mx, y + my, c);
    cx += g.w;
  }
  return cx - x;
}

/** Every character the font can draw (for tests). */
export const FONT_CHARS = Object.keys(GLYPHS).join("");
