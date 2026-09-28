// The effects sheet (types.ts FxBuilder): muzzle flashes per facing, the explosion, a looping fire
// for burning props, vehicles and petrol, smoke, dust, slush, a petrol bottle smashing, ricochet
// sparks, and ground and wall decals. Stepped palette colours only (style guide §3): the fire ramp
// with the ember steps under it, soot for smoke, cut_cap and dark brick for blood, never poppy red.
// Dither only on the ground (§4: the scorch marks' ragged edge): smoke and dust thin out as the
// edges of their lumps eat in, never through a dither pattern.
//
// Anchors: muzzle flashes at the muzzle (the flash points away from it); explosion, fire, smoke,
// dust, slush, glass and sparks at the effect's centre on the ground; decals at their centre.
// West-side muzzle facings are the east-side frames flipped, like the troopers: each muzzle frame
// is padded so the muzzle is its exact horizontal middle, and a flip keeps it on the gun.
import type { FxBuilder } from "./types";
import { PAL, ramp, type RGB } from "./palette";
import { bayer, hash2, img, px, rng, type Frame, type PixelImage, type Sheet } from "./pixel";
import { vnoise } from "./fx-noise";

const S = PAL.shared, C = PAL.city_1943;
const FIRE = S.fire; // orange, yellow, pale
const EMBER = ramp("props_extra", "ember"); // deep red-orange, red-orange
const SMOKE: RGB[] = [S.outline, C.soot[0], C.soot[1], C.soot[2], C.cobble[1]];
const BLOOD: RGB[] = [C.cut_cap[0], C.cut_cap[1], C.brick[0]];

interface Cell { name: string; im: PixelImage; ax: number; ay: number }

/** Heat 0..1 to a stepped fire colour, or null below the flame's edge. */
function heatColour(h: number): RGB | null {
  if (h > 0.82) return FIRE[2];
  if (h > 0.62) return FIRE[1];
  if (h > 0.42) return FIRE[0];
  if (h > 0.28) return EMBER[1];
  if (h > 0.18) return EMBER[0];
  return null;
}

// ---------------------------------------------------------------- muzzle flashes

/** Flash templates pointing east and south-east: p pale core, y yellow, o orange, e ember. */
const FLASH_E = [
  [
    "....o....",
    "..yy..o..",
    "ppyyyyoo.",
    "..yy..o..",
    "....o....",
  ],
  [
    ".........",
    "..y......",
    "ppyo.....",
    "..y......",
    ".........",
  ],
];
const FLASH_SE = [
  [
    "..o.....",
    "ppy..o..",
    "pyyy....",
    ".yyyy...",
    "..yyyo..",
    ".o.yoo..",
    ".....o..",
    "........",
  ],
  [
    "........",
    "pp......",
    "pyy.....",
    ".yyo....",
    "..o.....",
    "........",
    "........",
    "........",
  ],
];

function paintTemplate(rows: string[]): PixelImage {
  const im = img(rows[0].length, rows.length);
  const col: Record<string, RGB> = { p: FIRE[2], y: FIRE[1], o: FIRE[0], e: EMBER[1] };
  rows.forEach((r, y) => { for (let x = 0; x < r.length; x++) if (col[r[x]]) px(im, x, y, col[r[x]]); });
  return im;
}

function transform(im: PixelImage, f: (x: number, y: number) => [number, number], w: number, h: number): PixelImage {
  const out = img(w, h);
  for (let y = 0; y < im.h; y++) for (let x = 0; x < im.w; x++) {
    const i = (y * im.w + x) * 4;
    if (!im.data[i + 3]) continue;
    const [X, Y] = f(x, y);
    const o = (Y * w + X) * 4;
    out.data.set(im.data.subarray(i, i + 4), o);
  }
  return out;
}

/** Pad a frame sideways so its anchor is the exact horizontal middle (w = 2 * ax): flipped for a
 *  west facing about the frame's middle, the flash still starts at the muzzle. */
function centreX(c: Cell): Cell {
  const w = Math.max(c.ax, c.im.w - c.ax) * 2, left = w / 2 - c.ax;
  const im = img(w, c.im.h);
  for (let y = 0; y < c.im.h; y++) im.data.set(c.im.data.subarray(y * c.im.w * 4, (y + 1) * c.im.w * 4), (y * w + left) * 4);
  return { name: c.name, im, ax: w / 2, ay: c.ay };
}

function muzzles(): Cell[] {
  return muzzleCells().map(centreX);
}

function muzzleCells(): Cell[] {
  const out: Cell[] = [];
  for (let f = 0; f < 2; f++) {
    const e = paintTemplate(FLASH_E[f]);
    const se = paintTemplate(FLASH_SE[f]);
    // east: the muzzle at the core's left end
    out.push({ name: `muzzle_e_${f}`, im: e, ax: 0, ay: 2 });
    // south: east turned a quarter clockwise
    out.push({ name: `muzzle_s_${f}`, im: transform(e, (x, y) => [e.h - 1 - y, x], e.h, e.w), ax: 2, ay: 0 });
    // north: east turned a quarter anticlockwise
    out.push({ name: `muzzle_n_${f}`, im: transform(e, (x, y) => [y, e.w - 1 - x], e.h, e.w), ax: 2, ay: e.w - 1 });
    out.push({ name: `muzzle_se_${f}`, im: se, ax: 0, ay: 1 });
    // north-east: south-east flipped upside down
    out.push({ name: `muzzle_ne_${f}`, im: transform(se, (x, y) => [x, se.h - 1 - y], se.w, se.h), ax: 0, ay: se.h - 2 });
  }
  return out;
}

// ---------------------------------------------------------------- explosion

/** Eight frames: the flash, the fireball boiling up, fire going to smoke, smoke thinning out. */
function explosion(): Cell[] {
  const W = 56, H = 58, ax = 28, ay = 46;
  const r = rng(1943);
  const puffs = Array.from({ length: 11 }, (_, i) => ({
    a: (i / 11) * Math.PI * 2 + r() * 0.5,
    d: i === 0 ? 0 : 4 + r() * 7,
    r: 6 + r() * 5,
    rise: 0.6 + r() * 0.8,
  }));
  const debris = Array.from({ length: 14 }, () => ({ a: -Math.PI * (0.1 + r() * 0.8), v: 5 + r() * 9, c: r() < 0.5 ? S.outline : C.soot[1] }));
  const out: Cell[] = [];
  for (let f = 0; f < 8; f++) {
    const im = img(W, H);
    const t = f / 7;
    if (f === 0) {
      // the flash: a hot star hugging the ground
      for (let y = -8; y <= 8; y++) for (let x = -12; x <= 12; x++) {
        const d = Math.hypot(x, y * 1.5);
        const ray = Math.abs(x) < 1 || Math.abs(y) < 1 || Math.abs(Math.abs(x) - Math.abs(y * 1.5)) < 1.2 ? 4 : 0;
        const h = 1 - d / (7 + ray);
        const c = heatColour(h * 1.2);
        if (c) px(im, ax + x, ay - 5 + y, c);
      }
      out.push({ name: "explosion_0", im, ax, ay });
      continue;
    }
    // the fireball swells and stays white-hot for three frames, then cools from the top into smoke
    const grow = [0, 0.55, 0.82, 1.0, 1.1, 1.18, 1.25, 1.3][f];
    const heatFall = [0, 1.4, 1.3, 1.08, 0.8, 0.52, 0.3, 0.12][f];
    const lift = [0, 1, 3, 6, 9, 12, 15, 18][f];
    // this frame's puffs and the box they fill
    const pc = puffs.map((p) => {
      const rr = p.r * grow;
      return { cx: ax + Math.cos(p.a) * p.d * grow * 1.3, cy: ay - 9 - lift * p.rise + Math.sin(p.a) * p.d * grow * 0.7, rr, r2: rr * rr };
    });
    const cloudTop = Math.min(...pc.map((p) => p.cy - p.rr)), cloudH = ay - cloudTop;
    const bx0 = Math.max(0, Math.floor(Math.min(...pc.map((p) => p.cx - p.rr)))), bx1 = Math.min(W, Math.ceil(Math.max(...pc.map((p) => p.cx + p.rr))) + 1);
    const by0 = Math.max(0, Math.floor(Math.min(...pc.map((p) => p.cy - p.rr)))), by1 = Math.min(H, Math.ceil(Math.max(...pc.map((p) => p.cy + p.rr))) + 1);
    for (let y = by0; y < by1; y++) {
      for (let x = bx0; x < bx1; x++) {
        let dens = 0, core = 0;
        for (const p of pc) {
          const dx = x - p.cx, dy = (y - p.cy) * 1.1, d2 = dx * dx + dy * dy;
          if (d2 >= p.r2) continue;
          const dd = Math.sqrt(d2) / p.rr;
          if (1 - dd > dens) dens = 1 - dd;
          // light from the top left of each puff
          const lit = (1 - dd) * (1 + (-dx - dy / 1.1) / (p.rr * 3));
          if (lit > core) core = lit;
        }
        if (dens <= 0) continue;
        const n = vnoise(x * 0.35, y * 0.35, f * 0.7, 3);
        // the top of the cloud cools first
        const up = (ay - y) / cloudH;
        const heat = (dens * 1.1 + (n - 0.5) * 0.35) * heatFall * (1.15 - up * 0.45);
        const c = heatColour(heat);
        if (c) { px(im, x, y, c); continue; }
        // smoke, thinning with time: its thin edge is cut away, raggedly (no dither)
        const keep = dens * 1.5 - Math.max(0, t - 0.4) * 1.1 + (n - 0.5) * 0.3;
        if (keep <= (f >= 5 ? 0.1 + (f - 5) * 0.07 : 0)) continue;
        const lit = core * (1 + n * 0.4);
        const sc = lit > 0.95 ? SMOKE[4] : lit > 0.65 ? SMOKE[3] : lit > 0.38 ? SMOKE[2] : SMOKE[1];
        px(im, x, y, sc);
      }
    }
    // debris thrown out and falling back
    if (f <= 5) {
      for (const d of debris) {
        const tt = f * 0.9;
        const x = ax + Math.cos(d.a) * d.v * tt * 0.9;
        const y = ay - 6 + Math.sin(d.a) * d.v * tt * 0.8 + tt * tt * 1.5;
        if (y < H - 1) px(im, Math.round(x), Math.round(y), d.c);
      }
    }
    out.push({ name: `explosion_${f}`, im, ax, ay });
  }
  return out;
}

// ---------------------------------------------------------------- fire loop

/** Six frames of flames that loop: tongues rising and falling out of phase, sparks lifting off. */
function fire(): Cell[] {
  const W = 18, H = 24, ax = 9, ay = 22;
  const tongues = [
    { x: -5, h: 9, w: 3.0, ph: 0.0 },
    { x: -2, h: 15, w: 3.6, ph: 2.1 },
    { x: 1, h: 18, w: 4.0, ph: 4.2 },
    { x: 4, h: 13, w: 3.4, ph: 1.0 },
    { x: 6, h: 8, w: 2.6, ph: 3.3 },
  ];
  const out: Cell[] = [];
  for (let f = 0; f < 6; f++) {
    const im = img(W, H);
    const ph = (f / 6) * Math.PI * 2;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const lx = x + 0.5 - ax, ly = ay - (y + 0.5); // up from the ground
        if (ly < -1) continue;
        let heat = 0;
        for (const tg of tongues) {
          const hh = tg.h * (0.78 + 0.22 * Math.sin(ph + tg.ph));
          if (ly > hh) continue;
          const k = ly / hh; // 0 at the base, 1 at the tip
          const sway = Math.sin(ph * 1 + tg.ph + k * 3) * k * 1.6;
          const half = tg.w * (1 - k * k) * (k < 0.15 ? 0.8 + k : 1);
          const dx = Math.abs(lx - tg.x - sway);
          if (dx > half) continue;
          heat = Math.max(heat, (1 - dx / half) * (1 - k * 0.8) + 0.12);
        }
        // a glowing bed at the base
        if (ly < 2 && Math.abs(lx) < 7.5) heat = Math.max(heat, 0.45 - ly * 0.08);
        const c = heatColour(heat);
        if (c) px(im, x, y, c);
      }
    }
    // sparks drifting up, the same three every loop
    for (let s = 0; s < 3; s++) {
      const k = (f / 6 + s / 3) % 1;
      const x = ax + Math.round(Math.sin(s * 2.1 + k * 4) * 4);
      const y = ay - 12 - Math.round(k * 10);
      if (y >= 0) px(im, x, y, k < 0.5 ? FIRE[1] : EMBER[1]);
    }
    out.push({ name: `fire_${f}`, im, ax, ay });
  }
  return out;
}

// ---------------------------------------------------------------- smoke, dust, slush

/** A billow of round lumps, lit from the top left. As it ages the edge of every lump eats in,
 *  raggedly, so the billow breaks into smaller puffs (no dither: style guide §4). */
function billow(W: number, H: number, ax: number, ay: number, lumps: { x: number; y: number; r: number }[], age: number, tones: RGB[], seed: number): PixelImage {
  const im = img(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let dens = 0, lit = 0;
      for (const l of lumps) {
        const cx = ax + l.x, cy = ay + l.y;
        const dx = x + 0.5 - cx, dy = y + 0.5 - cy, d2 = dx * dx + dy * dy;
        if (d2 >= l.r * l.r) continue;
        const d = Math.sqrt(d2) / l.r;
        dens = Math.max(dens, 1 - d);
        lit = Math.max(lit, (1 - d) + ((cx - x) + (cy - y)) / (l.r * 2.5));
      }
      if (dens <= 0) continue;
      const n = vnoise(x * 0.5, y * 0.5, seed, seed);
      if (dens < age * 0.55 + (n - 0.5) * 0.35) continue;
      const k = lit + (n - 0.5) * 0.3;
      px(im, x, y, k > 1.0 ? tones[3] : k > 0.7 ? tones[2] : k > 0.35 ? tones[1] : tones[0]);
    }
  }
  return im;
}

function smoke(): Cell[] {
  const out: Cell[] = [];
  const W = 20, H = 22, ax = 10, ay = 20;
  const r = rng(77);
  const base = Array.from({ length: 5 }, () => ({ x: (r() - 0.5) * 6, y: -(r() * 4), r: 2.5 + r() * 2 }));
  for (let f = 0; f < 6; f++) {
    const t = f / 5;
    const lumps = base.map((l) => ({ x: l.x * (1 + t), y: l.y * (1 + t) - 4 - t * 8, r: l.r * (1 + t * 1.2) }));
    out.push({ name: `smoke_${f}`, im: billow(W, H, ax, ay, lumps, t * 0.9, [SMOKE[1], SMOKE[2], SMOKE[3], SMOKE[4]], 11 + f), ax, ay });
  }
  return out;
}

function dust(): Cell[] {
  const out: Cell[] = [];
  const W = 16, H = 14, ax = 8, ay = 12;
  const tones: RGB[] = [C.cobble[0], C.stone_grey[1], C.pavement[1], C.dirty_snow[0]];
  for (let f = 0; f < 4; f++) {
    const t = f / 3;
    const lumps = [
      { x: 0, y: -2 - t * 2, r: 2.2 + t * 3 },
      { x: -2.5 - t * 1.5, y: -1 - t, r: 1.8 + t * 2.2 },
      { x: 2.5 + t * 1.5, y: -1.2 - t, r: 1.8 + t * 2.2 },
    ];
    const im = billow(W, H, ax, ay, lumps, t * 0.85, tones, 31 + f);
    // grit thrown up with the first puff
    if (f < 2) for (const [dx, dy] of [[-3, -5], [2, -6], [4, -3], [-5, -2], [0, -7]]) px(im, ax + dx * (f + 1) * 0.7 | 0, ay + dy * (f + 1) * 0.6 | 0, C.cobble[0]);
    out.push({ name: `dust_${f}`, im, ax, ay });
  }
  return out;
}

/** Slush and snow kicked up: clods thrown out on arcs and falling back, a pale burst at first. */
function snow(): Cell[] {
  const out: Cell[] = [];
  const W = 16, H = 14, ax = 8, ay = 12;
  const r = rng(5);
  const clods = Array.from({ length: 12 }, () => ({ a: -Math.PI * (0.1 + r() * 0.8), v: 2 + r() * 3.5, c: [C.dirty_snow[2], C.dirty_snow[1], C.slush[1], C.slush[0]][Math.floor(r() * 4)] }));
  for (let f = 0; f < 4; f++) {
    const im = img(W, H);
    if (f <= 1) {
      // the burst, then a crown of slush around the hole
      const rr = f === 0 ? 3.2 : 4.6;
      for (let y = -4; y <= 0; y++) for (let x = -5; x <= 5; x++) {
        const d = Math.sqrt(x * x + y * y * 2.6);
        if (d < rr && (f === 0 || d > rr - 1.6)) px(im, ax + x, ay + y - 1, d < 1.6 && f === 0 ? C.dirty_snow[2] : y > -1 ? C.slush[1] : C.dirty_snow[1]);
      }
    } else {
      // what fell back: a grey splat of slush
      for (let x = -3 - f; x <= 3 + f; x++) if (hash2(x, f, 4) < 0.7) px(im, ax + x, ay - (Math.abs(x) < 2 ? 1 : 0), hash2(x, f, 6) < 0.5 ? C.slush[0] : C.slush[1]);
    }
    for (const c of clods) {
      const tt = 0.6 + f * 1.1;
      const x = Math.round(ax + Math.cos(c.a) * c.v * tt);
      const y = Math.round(Math.min(ay, ay - 1 + Math.sin(c.a) * c.v * tt + tt * tt * 0.55));
      px(im, x, y, c.c);
      if (f < 3 && y < ay) px(im, x, y + 1, C.slush[0]); // clods, not specks: a lit top over a dirty belly
    }
    out.push({ name: `snow_${f}`, im, ax, ay });
  }
  return out;
}

// ---------------------------------------------------------------- glass, sparks

/** A petrol bottle smashing: the burst, shards flying, the wet splash left with the shards. */
function glass(): Cell[] {
  const out: Cell[] = [];
  const W = 20, H = 16, ax = 10, ay = 12;
  const r = rng(19);
  const shards = Array.from({ length: 16 }, () => ({ a: -Math.PI * r(), v: 2 + r() * 4.5, c: [S.chalk, C.dirty_snow[2], C.puddle[1], S.glass][Math.floor(r() * 4)] }));
  for (let f = 0; f < 4; f++) {
    const im = img(W, H);
    // the petrol splash spreading on the ground
    const sr = [2.5, 4.5, 6, 6.5][f];
    for (let y = -4; y <= 4; y++) for (let x = -8; x <= 8; x++) {
      const d = Math.hypot(x, y * 1.7) + (hash2(x, y, 3) - 0.5) * 1.6;
      if (d < sr) px(im, ax + x, ay + y, d < sr - 1.2 ? C.puddle[0] : C.puddle[1]);
    }
    if (f === 0) {
      for (const [dx, dy, c] of [[0, -2, S.chalk], [-1, -1, C.dirty_snow[2]], [1, -1, C.dirty_snow[2]], [0, -1, S.chalk], [-2, -2, C.puddle[1]], [2, -3, S.glass]] as [number, number, RGB][]) px(im, ax + dx, ay + dy, c);
    }
    for (const s of shards) {
      const tt = f === 3 ? 2.2 : 0.5 + f * 0.8;
      const x = ax + Math.cos(s.a) * s.v * tt * 0.9;
      const y = ay - 1 + Math.sin(s.a) * s.v * tt * 0.5 + tt * tt * 0.6;
      px(im, Math.round(x), Math.round(Math.min(y, ay + 3)), s.c);
    }
    out.push({ name: `glass_${f}`, im, ax, ay });
  }
  return out;
}

/** A ricochet: a hot point, streaks flying off, a few dying sparks. */
function sparks(): Cell[] {
  const out: Cell[] = [];
  const W = 13, H = 11, ax = 6, ay = 6;
  const dirs = [[-1, -1], [1, -1], [2, -1], [-2, 0], [1, 1], [0, -2]];
  for (let f = 0; f < 3; f++) {
    const im = img(W, H);
    if (f === 0) {
      px(im, ax, ay, FIRE[2]);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) px(im, ax + dx, ay + dy, FIRE[1]);
      for (const [dx, dy] of [[2, 0], [-2, 0], [0, -2]]) px(im, ax + dx, ay + dy, FIRE[0]);
    } else {
      dirs.forEach(([dx, dy], i) => {
        const k = f === 1 ? 2 : 3;
        const len = f === 1 ? 2 : 1;
        for (let j = 0; j < len; j++) px(im, ax + dx * (k - j), ay + dy * (k - j) + (f === 2 ? 1 : 0), j === 0 ? (f === 1 ? FIRE[1] : EMBER[1]) : FIRE[0]);
        if (f === 2 && i % 2) px(im, ax + dx, ay + dy + 2, EMBER[0]);
      });
    }
    out.push({ name: `spark_${f}`, im, ax, ay });
  }
  return out;
}

// ---------------------------------------------------------------- decals

/** Small dark blood splats on the ground (never poppy red). */
function blood(): Cell[] {
  const out: Cell[] = [];
  for (let v = 0; v < 4; v++) {
    const W = 12, H = 8, ax = 6, ay = 4;
    const im = img(W, H);
    const r = rng(101 + v * 7);
    const blobs = Array.from({ length: 2 + v % 2 }, (_, i) => ({ x: i === 0 ? 0 : (r() - 0.5) * 5, y: i === 0 ? 0 : (r() - 0.5) * 3, r: i === 0 ? 1.8 + v * 0.35 : 0.8 + r() * 1.1 }));
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let d = 9;
      for (const b of blobs) d = Math.min(d, Math.hypot(x + 0.5 - ax - b.x, (y + 0.5 - ay - b.y) * 1.4) / b.r);
      if (d < 1) px(im, x, y, d < 0.55 ? BLOOD[0] : hash2(x, y, v) < 0.5 ? BLOOD[1] : BLOOD[2]);
    }
    // droplets
    for (let i = 0; i < 3; i++) {
      const x = ax + Math.round((r() - 0.5) * 10), y = ay + Math.round((r() - 0.5) * 6);
      if (x >= 0 && y >= 0 && x < W && y < H) px(im, x, y, BLOOD[1]);
    }
    out.push({ name: `blood_${v}`, im, ax, ay });
  }
  return out;
}

/** Scorch marks on the ground: 0 under an explosion, 1 under a petrol fire. */
function scorch(): Cell[] {
  const out: Cell[] = [];
  const sizes = [[40, 22], [22, 12]];
  sizes.forEach(([W, H], v) => {
    const im = img(W, H);
    const ax = W >> 1, ay = H >> 1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const dx = (x + 0.5 - ax) / (W / 2), dy = (y + 0.5 - ay) / (H / 2);
      const a = Math.atan2(dy, dx);
      const streak = v === 0 ? 0.18 * Math.max(0, Math.sin(a * 7 + 1.3)) + 0.1 * Math.sin(a * 13) : 0;
      const d = Math.hypot(dx, dy) - streak + (vnoise(x * 0.4, y * 0.4, v, 9) - 0.5) * 0.3;
      if (d > 1) continue;
      // dithered, ragged edge; a black heart; grey ash flecks
      if (d > 0.72 && bayer(x, y) < (d - 0.72) * 3.6) continue;
      const c = d < 0.35 ? (hash2(x, y, v) < 0.08 ? C.slush[0] : S.glass_dark) : d < 0.6 ? S.outline : d < 0.85 ? C.soot[0] : C.soot[1];
      px(im, x, y, c);
    }
    out.push({ name: `scorch_${v}`, im, ax, ay });
  });
  return out;
}

/** Bullet holes in a wall: a dark pit ringed with chipped, paler plaster. */
function bulletHoles(): Cell[] {
  const T: string[][] = [
    [".c.", "chc", ".c."],
    ["..c..", ".chc.", "chhc.", ".cc..", "....."],
    ["c...", ".ch.", ".hhc", "..c."],
  ];
  return T.map((rows, v) => {
    const im = img(rows[0].length, rows.length);
    rows.forEach((r, y) => { for (let x = 0; x < r.length; x++) {
      if (r[x] === "h") px(im, x, y, x + y > rows.length ? S.glass_dark : S.outline);
      else if (r[x] === "c") px(im, x, y, (x + y + v) % 2 ? C.cloth[2] : C.cloth[1]);
    } });
    return { name: `bullet_hole_${v}`, im, ax: rows[0].length >> 1, ay: rows.length >> 1 };
  });
}

// ---------------------------------------------------------------- sheet

/** Pack the cells in rows by family, left to right. */
function pack(rows: Cell[][]): Sheet {
  const gap = 1;
  let W = 0, H = 0;
  const place: { c: Cell; x: number; y: number }[] = [];
  for (const row of rows) {
    let x = 0, h = 0;
    for (const c of row) { place.push({ c, x, y: H }); x += c.im.w + gap; h = Math.max(h, c.im.h); }
    W = Math.max(W, x);
    H += h + gap;
  }
  const image = img(W, H);
  const frames: Frame[] = place.map(({ c, x, y }) => {
    for (let r = 0; r < c.im.h; r++) image.data.set(c.im.data.subarray(r * c.im.w * 4, (r + 1) * c.im.w * 4), ((y + r) * W + x) * 4);
    return { name: c.name, x, y, w: c.im.w, h: c.im.h, ax: c.ax, ay: c.ay };
  });
  return { image, frames };
}

export const buildFxSheet: FxBuilder = () =>
  pack([muzzles(), explosion(), fire(), smoke(), dust().concat(snow()), glass().concat(sparks()), blood().concat(scorch(), bulletHoles())]);
