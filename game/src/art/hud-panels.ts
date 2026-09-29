// Paper and panels for the HUD and the screens (style guide §8, §9): the briefing's paper
// with creases and stains, the pause banner, task cards pinned to the plan, and the dark
// HUD panel. Seeds make every sheet different and every build the same.
import type { RGB } from "./palette";
import { img, px, rng, type PixelImage } from "./pixel";
import { FONT, drawText, fitText } from "./font";
import { HUD, discMask, edgeOf, ellipseRing, maskFrom, on, roundBox, stamp, stampShadowed, union, type Mask } from "./hud-kit";

function clearPx(im: PixelImage, x: number, y: number): void {
  if (x < 0 || y < 0 || x >= im.w || y >= im.h) return;
  im.data.fill(0, (y * im.w + x) * 4, (y * im.w + x) * 4 + 4);
}

const opaque = (im: PixelImage, x: number, y: number) => x >= 0 && y >= 0 && x < im.w && y < im.h && im.data[(y * im.w + x) * 4 + 3] > 0;

/** Only where the sheet already has paper (keeps stains off the torn edge). */
function onPaper(im: PixelImage, x: number, y: number, c: RGB): void {
  if (opaque(im, x, y)) px(im, x, y, c);
}

/**
 * A sheet of the underground's paper (hud.paper): a worn edge, fold creases where the sheet
 * is big enough to have been folded, a cup ring or a water mark, and a few specks.
 */
export function buildPaper(w: number, h: number, seed: number): PixelImage {
  const im = img(w, h);
  const r = rng(seed * 7919 + 17);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px(im, x, y, HUD.paper);
  // edge: a slightly darker rim, clipped corners, nicks
  for (let x = 0; x < w; x++) { px(im, x, 0, HUD.paperLo); px(im, x, h - 1, HUD.paperLo); }
  for (let y = 0; y < h; y++) { px(im, 0, y, HUD.paperLo); px(im, w - 1, y, HUD.paperLo); }
  for (const [cx, cy] of [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]]) clearPx(im, cx, cy);
  const nicks = Math.max(1, Math.floor((w + h) / 40));
  for (let i = 0; i < nicks; i++) {
    const side = Math.floor(r() * 4), t = r();
    const x = side < 2 ? 2 + Math.floor(t * (w - 4)) : side === 2 ? 0 : w - 1;
    const y = side >= 2 ? 2 + Math.floor(t * (h - 4)) : side === 0 ? 0 : h - 1;
    clearPx(im, x, y);
    // the paper just inside a nick is the edge now
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (opaque(im, x + dx, y + dy) && (x + dx) > 0 && (y + dy) > 0 && (x + dx) < w - 1 && (y + dy) < h - 1) px(im, x + dx, y + dy, HUD.paperLo);
  }
  // folds: a valley line, the lit ridge before it and the shaded facet after it
  const vfolds = w >= 120 ? [Math.round(w / 3), Math.round((2 * w) / 3)] : w >= 48 ? [Math.round(w / 2)] : [];
  const hfolds = h >= 40 ? [Math.round(h / 2)] : [];
  for (const fx of vfolds) {
    for (let y = 1; y < h - 1; y++) {
      onPaper(im, fx - 1, y, HUD.ghost);
      onPaper(im, fx, y, HUD.paperShade);
      onPaper(im, fx + 1, y, HUD.paperLo);
    }
  }
  for (const fy of hfolds) {
    for (let x = 1; x < w - 1; x++) {
      onPaper(im, x, fy - 1, HUD.ghost);
      onPaper(im, x, fy, HUD.paperShade);
      onPaper(im, x, fy + 1, HUD.paperLo);
    }
  }
  // a cup ring (broken in places) and a water mark
  if (w >= 40 && h >= 30) {
    const d = 10 + Math.floor(r() * 8);
    const ring = ellipseRing(d, Math.round(d * 0.8));
    const ox = 3 + Math.floor(r() * (w - d - 6)), oy = 3 + Math.floor(r() * (h - ring.h - 6));
    for (let y = 0; y < ring.h; y++) for (let x = 0; x < ring.w; x++) {
      if (on(ring, x, y) && r() > 0.18) onPaper(im, ox + x, oy + y, HUD.paperStain);
    }
  }
  const blots = w * h >= 2400 ? 2 : 1;
  for (let b = 0; b < blots; b++) {
    const bw = 5 + Math.floor(r() * 7), bh = 3 + Math.floor(r() * 4);
    const bx = 2 + Math.floor(r() * Math.max(1, w - bw - 4)), by = 2 + Math.floor(r() * Math.max(1, h - bh - 4));
    const blot = blob(bw, bh, r);
    for (let y = 0; y < blot.h; y++) for (let x = 0; x < blot.w; x++) if (on(blot, x, y)) onPaper(im, bx + x, by + y, HUD.paperLo);
    const rim = edgeOf(blot, 0, 1);
    for (let y = 0; y < rim.h; y++) for (let x = 0; x < rim.w; x++) if (on(rim, x, y)) onPaper(im, bx + x, by + y, HUD.paperShade);
  }
  // specks
  const specks = Math.floor((w * h) / 260);
  for (let i = 0; i < specks; i++) {
    const x = 2 + Math.floor(r() * (w - 4)), y = 2 + Math.floor(r() * (h - 4));
    onPaper(im, x, y, r() < 0.5 ? HUD.paperLo : HUD.paperShade);
  }
  return im;
}

/** A soft irregular blob, w x h, from overlapping ellipses. */
function blob(w: number, h: number, r: () => number): Mask {
  const m = { w, h, bits: new Uint8Array(w * h) };
  const parts = 3;
  for (let p = 0; p < parts; p++) {
    const cx = w * (0.3 + r() * 0.4), cy = h * (0.3 + r() * 0.4), rx = w * (0.25 + r() * 0.25), ry = h * (0.3 + r() * 0.25);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const nx = (x + 0.5 - cx) / rx, ny = (y + 0.5 - cy) / ry;
      if (nx * nx + ny * ny <= 1) m.bits[y * w + x] = 1;
    }
  }
  return m;
}

const BANG = maskFrom(["###", "###", "###", "###", "###", ".#.", "...", "###", "###"]);

/**
 * The pause banner: a strip of telegram tape pasted across the screen, a red tab with "!",
 * and who was hit and where in capitals (cut with "…" when it will not fit). 18 px tall.
 */
export function buildBanner(w: number, text: string): PixelImage {
  const h = 18;
  const im = img(w, h);
  // tape with torn ends: alternate rows step in by a pixel
  for (let y = 0; y < h - 1; y++) {
    const l = y % 3 === 1 ? 1 : 0, rr = y % 3 === 2 ? 1 : 0;
    for (let x = l; x < w - rr; x++) px(im, x, y, HUD.paper);
  }
  for (let x = 1; x < w - 1; x++) { px(im, x, 0, HUD.ghost); px(im, x, h - 2, HUD.paperLo); px(im, x, h - 1, HUD.outline); }
  // the red tab
  const tab = roundBox(13, 13, 1);
  stamp(im, tab, 3, 2, HUD.poppy);
  stamp(im, edgeOf(tab, 0, 1), 3, 2, HUD.outline);
  stampShadowed(im, BANG, 8, 4, HUD.chalk, HUD.outline);
  // the words
  const left = 21, room = w - left - 5;
  const t = fitText(FONT, text.toUpperCase(), room, "…");
  drawText(im, FONT, left, 5 - FONT.top, t, HUD.pink);
  return im;
}

/** A task card pinned to the briefing plan: paper with a header rule, a steel pin at the top
 *  and a shadow under it. The game writes the task on it. */
export function buildCard(w: number, h: number, seed: number): PixelImage {
  const im = img(w, h);
  const r = rng(seed * 104729 + 3);
  const bw = w - 1, bh = h - 3;
  // shadow, then the card (a little lighter than the plan it lies on)
  for (let y = 3; y < h; y++) px(im, bw, y, HUD.outline);
  for (let x = 1; x < w; x++) px(im, x, h - 1, HUD.outline);
  const body = roundBox(bw, bh, 1);
  stamp(im, body, 0, 2, HUD.paper);
  stamp(im, union(edgeOf(body, 0, 1), edgeOf(body, 1, 0)), 0, 2, HUD.paperLo);
  stamp(im, union(edgeOf(body, 0, -1), edgeOf(body, -1, 0)), 0, 2, HUD.ghost);
  // header rule
  for (let x = 3; x < bw - 3; x++) px(im, x, 13, HUD.paperShade);
  // a dog-eared corner on some cards
  if (r() < 0.5 && bw > 16 && bh > 16) {
    const x0 = bw - 1, y0 = h - 2;
    for (let k = 0; k < 4; k++) for (let j = 0; j <= k; j++) px(im, x0 - (3 - k), y0 - j, HUD.paperShade);
    for (let k = 0; k < 4; k++) px(im, x0 - k, y0 - (3 - k), HUD.paperLo);
    px(im, x0, y0, HUD.outline);
  }
  // a speck or two
  for (let i = 0; i < 2; i++) px(im, 3 + Math.floor(r() * (bw - 6)), 16 + Math.floor(r() * Math.max(1, bh - 18)), HUD.paperLo);
  // the pin: a domed steel head with a glint, and its shadow on the card
  const cx = Math.floor(bw / 2) - 3;
  const head = discMask(7);
  stamp(im, head, cx + 1, 1, HUD.outline);
  stamp(im, head, cx, 0, HUD.ink);
  const dome = discMask(5);
  stamp(im, dome, cx + 1, 1, HUD.steelLo);
  stamp(im, discMask(3), cx + 1, 1, HUD.steel);
  px(im, cx + 2, 2, HUD.steelHi);
  return im;
}

/** A dark HUD panel with a bevel and rivets, for text over the map. */
export function buildPanel(w: number, h: number): PixelImage {
  const im = img(w, h);
  stamp(im, roundBox(w, h, 2), 0, 0, HUD.outline);
  const inner = roundBox(w - 2, h - 2, 1);
  stamp(im, inner, 1, 1, HUD.rim);
  stamp(im, union(edgeOf(inner, 0, -1), edgeOf(inner, -1, 0)), 1, 1, HUD.oliveLo);
  stamp(im, union(edgeOf(inner, 0, 1), edgeOf(inner, 1, 0)), 1, 1, HUD.shadow);
  if (w >= 20 && h >= 14) {
    for (const [x, y] of [[3, 3], [w - 5, 3], [3, h - 5], [w - 5, h - 5]]) {
      px(im, x, y, HUD.steelHi); px(im, x + 1, y, HUD.steelLo);
      px(im, x, y + 1, HUD.steelLo); px(im, x + 1, y + 1, HUD.shadow);
    }
  }
  return im;
}


