// Shared pieces for the HUD generators: the HUD's colours (all from docs/art/palette.json,
// groups hud and hud_extra), one-colour masks, and pixel-exact boxes and discs.
// Style guide §4: 1 px outlines, light from the top left, no dithering on the HUD.
import { PAL, colour, ramp, type RGB } from "./palette";
import { img, px, type PixelImage } from "./pixel";

const H = PAL.hud;
export const HUD = {
  outline: PAL.shared.outline,
  shadow: PAL.shared.shadow,
  gold: PAL.shared.select_gold,
  poppy: PAL.shared.poppy_red,
  chalk: PAL.shared.chalk,
  ghost: PAL.shared.ghost,
  steel: H.tag_steel[1],
  steelLo: H.tag_steel[0],
  steelHi: colour("hud_extra", "tag_steel_hi"),
  steelDark: ramp("hud_extra", "tag_steel_dark")[1],
  steelDeep: ramp("hud_extra", "tag_steel_dark")[0],
  ink: H.tag_ink,
  olive: H.button_olive[1],
  oliveLo: H.button_olive[0],
  oliveHi: colour("hud_extra", "button_olive_hi"),
  rim: H.button_rim,
  bink: H.button_ink,
  hpOk: H.hp_ok,
  hpLow: H.hp_low,
  paper: H.paper[1],
  paperLo: H.paper[0],
  paperShade: ramp("hud_extra", "paper_shade")[1],
  paperStain: ramp("hud_extra", "paper_shade")[0],
  pink: H.paper_ink,
  birchDark: PAL.forest.birch_bark[0],
  birchLight: PAL.forest.birch_bark[1],
  flagWhite: PAL.troopers.armband.white,
  flagRed: PAL.troopers.armband.red,
  squad: [H.squads.squad_1, H.squads.squad_2, H.squads.squad_3] as readonly RGB[],
  squadShade: [colour("hud_extra", "squad_1_shade"), colour("hud_extra", "squad_2_shade"), colour("hud_extra", "squad_3_shade")] as readonly RGB[],
} as const;

// ---------------------------------------------------------------- masks

/** A one-bit picture: 1 where there is ink. */
export interface Mask {
  w: number;
  h: number;
  bits: Uint8Array;
}

export function mask(w: number, h: number): Mask {
  return { w, h, bits: new Uint8Array(w * h) };
}

export const on = (m: Mask, x: number, y: number): boolean => x >= 0 && y >= 0 && x < m.w && y < m.h && m.bits[y * m.w + x] === 1;
export function set(m: Mask, x: number, y: number, v = 1): void {
  if (x >= 0 && y >= 0 && x < m.w && y < m.h) m.bits[y * m.w + x] = v;
}

/** A mask from rows of `#` and `.`. */
export function maskFrom(rows: readonly string[]): Mask {
  const m = mask(rows[0].length, rows.length);
  rows.forEach((r, y) => {
    if (r.length !== m.w) throw new Error(`mask row ${y} is ${r.length} wide, wants ${m.w}: "${r}"`);
    for (let x = 0; x < m.w; x++) if (r[x] === "#") set(m, x, y);
  });
  return m;
}

/** Paint a mask's ink at (x, y). */
export function stamp(im: PixelImage, m: Mask, x: number, y: number, c: RGB): void {
  for (let j = 0; j < m.h; j++) for (let i = 0; i < m.w; i++) if (m.bits[j * m.w + i]) px(im, x + i, y + j, c);
}

/** Paint a mask with a one-pixel drop (shadow or glint) toward the bottom right first. */
export function stampShadowed(im: PixelImage, m: Mask, x: number, y: number, c: RGB, drop: RGB, dx = 1, dy = 1): void {
  stamp(im, m, x + dx, y + dy, drop);
  stamp(im, m, x, y, c);
}

/** The mask as a picture in one colour. */
export function maskImage(m: Mask, c: RGB): PixelImage {
  const im = img(m.w, m.h);
  stamp(im, m, 0, 0, c);
  return im;
}

/** The pixels just outside a mask (4-connected), as a mask of the same size. */
export function ringOf(m: Mask, diagonal = false): Mask {
  const out = mask(m.w, m.h);
  const dirs = diagonal ? [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] : [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (let y = 0; y < m.h; y++) {
    for (let x = 0; x < m.w; x++) {
      if (on(m, x, y)) continue;
      if (dirs.some(([dx, dy]) => on(m, x + dx, y + dy))) set(out, x, y);
    }
  }
  return out;
}

/** Grow a mask into a larger canvas with a margin (so an outline has room). */
export function pad(m: Mask, p: number): Mask {
  const out = mask(m.w + p * 2, m.h + p * 2);
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) if (on(m, x, y)) set(out, x + p, y + p);
  return out;
}

/** Shrink a mask by one pixel (4-connected), so `m` minus `erode(m)` is an even 1 px rim. */
export function erode(m: Mask): Mask {
  const out = mask(m.w, m.h);
  for (let y = 0; y < m.h; y++) {
    for (let x = 0; x < m.w; x++) {
      if (on(m, x, y) && on(m, x + 1, y) && on(m, x - 1, y) && on(m, x, y + 1) && on(m, x, y - 1)) set(out, x, y);
    }
  }
  return out;
}

/** Pixels of `m` whose neighbour in direction (dx, dy) is empty: the lit or shaded rim. */
export function edgeOf(m: Mask, dx: number, dy: number): Mask {
  const out = mask(m.w, m.h);
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) if (on(m, x, y) && !on(m, x + dx, y + dy)) set(out, x, y);
  return out;
}

// ---------------------------------------------------------------- shapes

/**
 * A box with pixel-rounded corners: r = 0 square, 1 a clipped corner pixel, 2 and 3 the
 * usual small-radius steps. Returned as a mask of the box's own size.
 */
export function roundBox(w: number, h: number, r: number): Mask {
  const m = mask(w, h);
  const steps: Record<number, number[]> = { 0: [], 1: [1], 2: [2, 1], 3: [3, 1, 1], 4: [4, 2, 1, 1], 5: [5, 3, 2, 1, 1] };
  const cut = steps[Math.min(r, 5)];
  for (let y = 0; y < h; y++) {
    const fromTop = Math.min(y, h - 1 - y);
    const inset = fromTop < cut.length ? cut[fromTop] : 0;
    for (let x = inset; x < w - inset; x++) set(m, x, y);
  }
  return m;
}

/** A filled disc of diameter d (pixel-centred, symmetric). */
export function discMask(d: number): Mask {
  const m = mask(d, d);
  const c = (d - 1) / 2, r = d / 2;
  for (let y = 0; y < d; y++) {
    for (let x = 0; x < d; x++) {
      const dx = x - c, dy = y - c;
      if (dx * dx + dy * dy <= (r - 0.35) * (r - 0.35)) set(m, x, y);
    }
  }
  return m;
}

/** An ellipse ring one pixel thick, w x h, pixel-exact and symmetric. */
export function ellipseRing(w: number, h: number): Mask {
  const fill = mask(w, h);
  const cx = (w - 1) / 2, cy = (h - 1) / 2, rx = w / 2 - 0.3, ry = h / 2 - 0.3;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const nx = (x - cx) / rx, ny = (y - cy) / ry;
      if (nx * nx + ny * ny <= 1) set(fill, x, y);
    }
  }
  // the ring is the fill's pixels that touch the outside (8-connected, so it stays 1 px)
  const out = mask(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!on(fill, x, y)) continue;
      if (!on(fill, x + 1, y) || !on(fill, x - 1, y) || !on(fill, x, y + 1) || !on(fill, x, y - 1)) set(out, x, y);
    }
  }
  return out;
}

/** Mask algebra. */
export function union(a: Mask, b: Mask, bx = 0, by = 0): Mask {
  const out = { w: a.w, h: a.h, bits: new Uint8Array(a.bits) };
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) if (on(b, x, y)) set(out, x + bx, y + by);
  return out;
}
export function minus(a: Mask, b: Mask, bx = 0, by = 0): Mask {
  const out = { w: a.w, h: a.h, bits: new Uint8Array(a.bits) };
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) if (on(b, x, y)) set(out, x + bx, y + by, 0);
  return out;
}
export function shift(m: Mask, dx: number, dy: number, w = m.w, h = m.h): Mask {
  const out = mask(w, h);
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) if (on(m, x, y)) set(out, x + dx, y + dy);
  return out;
}

/** Replace one exact colour with another in place (for re-inking a finished piece). */
export function recolour(im: PixelImage, from: RGB, to: RGB): void {
  const d = im.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] && d[i] === from[0] && d[i + 1] === from[1] && d[i + 2] === from[2]) {
      d[i] = to[0]; d[i + 1] = to[1]; d[i + 2] = to[2];
    }
  }
}
