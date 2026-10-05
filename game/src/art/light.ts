// Pools of light (style guide §5): light added over the finished frame, in three stepped bands
// whose edges are dithered with the 4x4 Bayer table, never a smooth glow. At night the pools are
// where you get seen, so their edges have to read as edges. The colour and the reach come from
// docs/art/palette.json (light.pool.*): rgb as 0..1 multipliers, radius in metres.
import { PAL } from "./palette";
import { BAYER4, img, type PixelImage } from "./pixel";

/** The three bands, inside out: where each ends (a fraction of the radius) and how much light
 *  it adds (the texture's opacity, drawn with additive blending). */
export const POOL_BANDS: readonly { edge: number; alpha: number }[] = [
  { edge: 0.38, alpha: 0.36 },
  { edge: 0.68, alpha: 0.22 },
  { edge: 1, alpha: 0.1 },
];
/** Half the width of the dithered seam at each band's edge, in art px. */
export const POOL_SEAM = 2;

/** Art px per metre across and into the screen (style guide §2). */
const PX_X = 12, PX_Y = 9;

export type PoolKind = "lamp" | "fire" | "window" | "flare";

/**
 * A pool of light with radii rx by ry art px, in the pool's colour: the three bands of
 * POOL_BANDS, each seam between two bands (and the outer edge) Bayer-dithered over
 * 2 * POOL_SEAM px. Centred in the image (the image is 2 * ceil(r + seam + 1) each way).
 */
export function buildLightPool(rgb: readonly [number, number, number], rx: number, ry: number): PixelImage {
  const pad = POOL_SEAM + 1;
  const w = 2 * Math.ceil(rx + pad), h = 2 * Math.ceil(ry + pad);
  const im = img(w, h);
  const c = rgb.map((v) => Math.max(0, Math.min(255, Math.round(v * 255))));
  const cx = w / 2, cy = h / 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
      const d = Math.hypot(dx / rx, dy / ry); // 0 at the centre, 1 on the outer edge
      const p = Math.hypot(dx, dy);
      const rb = d > 0 ? p / d : rx; // the radius in px along this direction
      const seam = POOL_SEAM / rb;
      let band = POOL_BANDS.length;
      for (let i = 0; i < POOL_BANDS.length; i++) {
        const e = POOL_BANDS[i].edge;
        if (d < e - seam) { band = i; break; }
        if (d < e + seam) {
          // in the seam: the inner band's share falls from 1 to 0 across it, thresholded by Bayer
          const inner = (e + seam - d) / (2 * seam);
          band = BAYER4[((y & 3) << 2) | (x & 3)] / 16 < inner ? i : i + 1;
          break;
        }
      }
      if (band >= POOL_BANDS.length) continue;
      const o = (y * w + x) * 4;
      im.data[o] = c[0];
      im.data[o + 1] = c[1];
      im.data[o + 2] = c[2];
      im.data[o + 3] = Math.round(POOL_BANDS[band].alpha * 255);
    }
  }
  return im;
}

/** A pool from the palette (light.pool[kind]), its reach scaled by `k` (a flash is wider). */
export function buildPalettePool(kind: PoolKind, k = 1): PixelImage {
  const pool = PAL.light.pool[kind];
  if (!pool?.radius_m) throw new Error(`palette: no light.pool.${kind} with a radius_m`);
  const r = pool.radius_m * k;
  return buildLightPool(pool.rgb, r * PX_X, r * PX_Y);
}
