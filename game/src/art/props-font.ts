// A tiny capital pixel font for enamel street plates, shop boards and stencils: 5 px tall caps,
// 3 px wide (M, N and W wider), 1 px apart, with the Polish diacritics. Accents sit two rows above
// the cap line (one row gap, so an acute never reads as part of the letter) and the ogonek hangs one
// row below it. Pure data plus a painter; colours come from the caller.
import type { RGB } from "./palette";
import { px, type PixelImage } from "./pixel";

const G: Record<string, string[]> = {
  A: [".#.", "#.#", "###", "#.#", "#.#"],
  B: ["##.", "#.#", "##.", "#.#", "##."],
  C: [".##", "#..", "#..", "#..", ".##"],
  D: ["##.", "#.#", "#.#", "#.#", "##."],
  E: ["###", "#..", "##.", "#..", "###"],
  F: ["###", "#..", "##.", "#..", "#.."],
  G: [".##", "#..", "#.#", "#.#", ".##"],
  H: ["#.#", "#.#", "###", "#.#", "#.#"],
  I: ["###", ".#.", ".#.", ".#.", "###"],
  J: ["..#", "..#", "..#", "#.#", ".#."],
  K: ["#.#", "#.#", "##.", "#.#", "#.#"],
  L: ["#..", "#..", "#..", "#..", "###"],
  M: ["#...#", "##.##", "#.#.#", "#...#", "#...#"],
  N: ["#..#", "##.#", "#.##", "#..#", "#..#"],
  O: [".#.", "#.#", "#.#", "#.#", ".#."],
  P: ["##.", "#.#", "##.", "#..", "#.."],
  Q: [".#.", "#.#", "#.#", "##.", ".##"],
  R: ["##.", "#.#", "##.", "#.#", "#.#"],
  S: [".##", "#..", ".#.", "..#", "##."],
  T: ["###", ".#.", ".#.", ".#.", ".#."],
  U: ["#.#", "#.#", "#.#", "#.#", "###"],
  V: ["#.#", "#.#", "#.#", "#.#", ".#."],
  W: ["#...#", "#...#", "#.#.#", "##.##", "#...#"],
  X: ["#.#", "#.#", ".#.", "#.#", "#.#"],
  Y: ["#.#", "#.#", ".#.", ".#.", ".#."],
  Z: ["###", "..#", ".#.", "#..", "###"],
  Ł: ["#..", "#..", "##.", "#..", "###"],
  "0": ["###", "#.#", "#.#", "#.#", "###"],
  "1": [".#.", "##.", ".#.", ".#.", "###"],
  "2": ["##.", "..#", ".#.", "#..", "###"],
  "3": ["##.", "..#", ".#.", "..#", "##."],
  "4": ["#.#", "#.#", "###", "..#", "..#"],
  "5": ["###", "#..", "##.", "..#", "##."],
  "6": [".##", "#..", "###", "#.#", "###"],
  "7": ["###", "..#", ".#.", ".#.", ".#."],
  "8": ["###", "#.#", "###", "#.#", "###"],
  "9": ["###", "#.#", "###", "..#", "##."],
  ".": [".", ".", ".", ".", "#"],
  "-": ["...", "...", "###", "...", "..."],
  " ": ["..", "..", "..", "..", ".."],
};

/** Diacritics: the base letter and its mark. */
const MARKS: Record<string, [string, "acute" | "dot" | "ogonek"]> = {
  Ą: ["A", "ogonek"],
  Ć: ["C", "acute"],
  Ę: ["E", "ogonek"],
  Ń: ["N", "acute"],
  Ó: ["O", "acute"],
  Ś: ["S", "acute"],
  Ź: ["Z", "acute"],
  Ż: ["Z", "dot"],
};

function glyph(ch: string): { rows: string[]; mark?: "acute" | "dot" | "ogonek" } {
  const m = MARKS[ch];
  if (m) return { rows: G[m[0]], mark: m[1] };
  return { rows: G[ch] ?? G[" "] };
}

/** Upper-case a name the way a plate spells it (Polish letters kept). */
export function plateText(s: string): string {
  return s.toUpperCase();
}

export interface TextMetrics {
  w: number;
  /** Rows above the cap line used by accents (0 or 2) and below it by an ogonek (0 or 1). */
  above: number;
  below: number;
}

export function measure(s: string): TextMetrics {
  let w = 0, above = 0, below = 0;
  const t = plateText(s);
  for (let i = 0; i < t.length; i++) {
    const g = glyph(t[i]);
    w += g.rows[0].length + (i ? 1 : 0);
    if (g.mark === "acute" || g.mark === "dot") above = 2;
    if (g.mark === "ogonek") below = 1;
  }
  return { w, above, below };
}

/** Paint `s` with its cap line's top-left at (x, y). Returns the width drawn. */
export function drawText(im: PixelImage, x: number, y: number, s: string, c: RGB): number {
  const t = plateText(s);
  let cx = x;
  for (let i = 0; i < t.length; i++) {
    const g = glyph(t[i]);
    const gw = g.rows[0].length;
    g.rows.forEach((row, r) => {
      for (let k = 0; k < gw; k++) if (row[k] === "#") px(im, cx + k, y + r, c);
    });
    if (g.mark === "acute") px(im, cx + gw - 1, y - 2, c);
    else if (g.mark === "dot") px(im, cx + (gw >> 1), y - 2, c);
    else if (g.mark === "ogonek") px(im, cx + gw - 1, y + 5, c);
    cx += gw + 1;
  }
  return cx - x - 1;
}
