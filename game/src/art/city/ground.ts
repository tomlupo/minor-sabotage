// The city ground (style guide §2-§5): one image of the whole map, w*12 x h*9 art px, from a
// grid of 1 m cells. Warsaw, 26 March 1943, late afternoon: granite setts, slush in the
// wheel ruts, dirty snow shovelled into the gutters, puddles, pavement slabs behind a light
// granite kerb, tram rails, muddy courtyards and dead grass.
//
// Speed matters (a 250 x 180 m map is 4.9 Mpx and must paint in ~100 ms in Chrome). The
// base pass walks the map row by row and hands each run of same-material cells to a small
// per-material painter; the fine texture (setts, slabs, grass) comes from tiles built once
// per call from hash2, so most pixels are one lookup plus a threshold. Tiles are shifted per
// band, so nothing visibly repeats. Shapes (slush, snow, wet patches) are solid with a
// 1-2 px 4x4 Bayer rim (§4: only ground and foliage are dithered). Sparse details (rails,
// manholes, drains, puddles) are drawn in a second pass.
import { PAL } from "../palette";
import type { PixelImage } from "../pixel";
import { hash2 as hash2Import, img } from "../pixel";
import type { GroundGrid, GroundMat, GroundPainter } from "../types";
import { BAYER16 as BAYER_IMPORT, ihash as ihashImport, lumpTex, noiseTex, packI, wordsI, X as XTRA } from "./common";

// Hot loops read module-local bindings: under a bundler's SSR transform (vitest, vite-node)
// an imported binding can be a live getter, which would cost a call per pixel.
const BAYER16 = BAYER_IMPORT;
const hash2 = hash2Import;
const ihash = ihashImport;

const ROAD = 0, WALK = 1, YARD = 2, RAIL_EW = 3, RAIL_NS = 4, UNDER = 5, SQUARE = 6;
const CODE: Record<GroundMat, number> = { road: ROAD, walk: WALK, yard: YARD, rail_ew: RAIL_EW, rail_ns: RAIL_NS, under: UNDER, square: SQUARE };
const isRoad = (m: number) => m === ROAD || m === RAIL_EW || m === RAIL_NS;
/** Material pairs whose shared border is drawn ragged (earth against stone or grass). */
const soft = (a: number, b: number) => a !== b && a !== UNDER && b !== UNDER && (a === YARD || b === YARD);
const ROADISH = new Uint8Array(8).map((_, m) => (isRoad(m) ? 1 : 0));
const SOFT = new Uint8Array(64).map((_, i) => (soft(i >> 3, i & 7) ? 1 : 0));

/** Track gauge (m) and the distance between the centres of a double track (m). */
export const GAUGE = 1.435;
export const TRACK_SPACING = 3.0;

// ------------------------------------------------------------------ colours (packed words)

interface Words {
  cob: number[]; mortar: number; pave: number[]; slush: number[]; snow: number[]; puddle: number[];
  rail: number; soot: number[]; kerb: number; kerbFace: number; earth: number[]; grass: number[];
}
let COL: Words | null = null;
function colours(): Words {
  if (COL) return COL;
  const c = PAL.city_1943;
  COL = {
    cob: c.cobble.map(packI),
    mortar: packI(c.mortar),
    pave: c.pavement.map(packI),
    slush: c.slush.map(packI),
    snow: c.dirty_snow.map(packI),
    puddle: c.puddle.map(packI),
    rail: packI(c.rail),
    soot: c.soot.map(packI),
    kerb: packI(c.slush[2]),
    kerbFace: packI(c.stone_grey[0]),
    earth: XTRA.earth().map(packI),
    grass: XTRA.deadGrass().map(packI),
  };
  return COL;
}

/** 64 K random bytes (from the integer hash), looked up per pixel instead of hashing each one. */
let RND: Uint8Array | null = null;
function rnd(): Uint8Array {
  if (RND) return RND;
  RND = new Uint8Array(65536);
  for (let i = 0; i < 65536; i++) RND[i] = ihash(i & 255, i >> 8, 4242) & 255;
  return RND;
}

// ------------------------------------------------------------------ road cross-profile

// Slush cover across a road (0..256; 128 is the edge of a patch), by distance from the road's
// edge in 1/12 m steps: gutter slush, the kerb-side wheel track (bare, wet), the ridge of
// slush between the wheels, the inner wheel track, then the patchy crown of the road.
const PROF_N = 96;
const PROF_S = new Int16Array(PROF_N);
const PROF_W = new Uint8Array(PROF_N);
{
  const bands: [number, number, number][] = [
    // [from m, cover 0..1, wet]
    [0.0, 0.47, 0],
    [1.1, 0.12, 1], // outer wheel track
    [1.55, 0.44, 0],
    [2.5, 0.12, 1], // inner wheel track
    [2.95, 0.3, 0],
    [4.0, 0.28, 0],
  ];
  for (let i = 0; i < PROF_N; i++) {
    const d = i / 12;
    let k = 0;
    while (k + 1 < bands.length && bands[k + 1][0] <= d) k++;
    PROF_S[i] = Math.round(bands[k][1] * 256);
    PROF_W[i] = bands[k][2];
  }
}
/** The slush threshold's profile part, for plain road and for the swept tram-track bed:
 *  a pixel is slush when PT[d] + cover noise > its Bayer value (0..15). The noise changes
 *  by about 8 units per pixel, so a slope a little over 1 keeps patches solid with a 1-2 px
 *  dithered rim. */
const SLOPE = 1.2;
const PT = new Float32Array(PROF_N).map((_, i) => (PROF_S[i] - 128) * SLOPE + 8);
const PT_CLEAR = new Float32Array(PROF_N).map((_, i) => (PROF_S[i] / 2 - 128) * SLOPE + 8);

// ------------------------------------------------------------------ tiles

const ST_W = 512, ST_H = 96; // setts: courses of 3-4 rows, 96 rows in all
const SL_W = 768, SL_H = 72; // pavement slabs: 128 x 16 slabs of 0.5 m
const GR_W = 256, GR_H = 144; // dead grass

interface Tiles {
  settDry: Int32Array; settWet: Int32Array; yardCob: Int32Array; slab: Int32Array; slabWet: Int32Array; grass: Int32Array;
}

function buildTiles(s0: number, K: Words, NT: Uint8Array): Tiles {
  const R = rnd();
  const settDry = new Int32Array(ST_W * ST_H), settWet = new Int32Array(ST_W * ST_H), yardCob = new Int32Array(ST_W * ST_H);
  const tone = new Uint8Array(ST_W); // bits 0-1 tone, 4 = joint column, 8 = lit first column
  // granite setts: courses of 3 or 4 rows (a joint row, then the stone faces), stones 3-5 px
  // long including their joint column, staggered, wrapping exactly at the tile's width
  for (let y = 0, c = 0; y < ST_H; c++) {
    let ch = hash2(c, 7, s0) < 0.55 ? 3 : 4;
    if (ST_H - y < ch + 3) ch = ST_H - y;
    let pos = (hash2(c, 0, s0) * 4) | 0, k = 0;
    const start = pos;
    while (pos < start + ST_W) {
      let len = 3 + ((hash2(c, k, s0 + 1) * 2.99) | 0);
      const left = start + ST_W - pos;
      if (left < len + 3) len = left; // the last stone closes the ring
      const r = hash2(c, k, s0 + 2);
      const t = r < 0.16 ? 0 : r < 0.84 ? 1 : 2;
      const lit = hash2(c, k, s0 + 3) < 0.35 ? 8 : 0;
      for (let i = 0; i < len; i++) tone[(pos + i) % ST_W] = i === len - 1 ? 4 : i === 0 ? t | lit : t;
      pos += len;
      k++;
    }
    for (let r = 0; r < ch; r++) {
      const row = y + r;
      for (let x = 0; x < ST_W; x++) {
        const t = tone[x], i = row * ST_W + x;
        if (r === 0 || t & 4) {
          settDry[i] = t & 4 && r === 0 ? K.mortar : K.cob[0];
          settWet[i] = K.mortar;
          yardCob[i] = NT[(row << 8) | (x & 255)] > 120 ? K.earth[0] : K.mortar;
          continue;
        }
        let tn = t & 3;
        if (r === 1 && t & 8 && tn < 2) tn++; // lit top-left corner of the stone
        const wx = R[(row * 179 + x * 31 + s0) & 0xffff] & 31; // weathering: a pixel a tone off here and there
        if (wx === 0 && tn < 2) tn++;
        else if (wx === 1 && tn > 0) tn--;
        settDry[i] = K.cob[tn];
        settWet[i] = tn === 0 ? K.mortar : K.cob[tn - 1];
        yardCob[i] = tn === 0 ? K.earth[1] : K.cob[tn];
      }
    }
    y += ch;
  }
  // pavement slabs: joints on a 6 x 4.5 px grid, old darker slabs, cracks, grit; the wet
  // variant keeps the joints readable
  const slab = new Int32Array(SL_W * SL_H), slabWet = new Int32Array(SL_W * SL_H);
  for (let y = 0; y < SL_H; y++) for (let x = 0; x < SL_W; x++) {
    const u = x % 12, v = y % 9;
    const i = y * SL_W + x;
    if (u === 0 || u === 6 || v === 0 || v === 5) { slab[i] = K.pave[0]; slabWet[i] = K.cob[2]; continue; }
    const sx = (x / 6) | 0, sy = (y * 2 / 9) | 0;
    const sh = R[(sy * 211 + sx * 57 + (s0 >> 4)) & 0xffff];
    const rr = R[(y * 181 + x * 37 + (s0 >> 8)) & 0xffff];
    let c = K.pave[1], cw = K.pave[0];
    if ((sh & 15) === 0) { c = (rr & 15) === 0 ? K.cob[2] : K.pave[0]; cw = K.cob[2]; }
    else if ((sh & 31) === 1) {
      const lu = u - (u < 6 ? 0 : 6), lv = v - (v < 5 ? 0 : 5);
      if (lu === lv + 1 || lu === lv + 2) { c = K.pave[0]; cw = K.cob[2]; }
    } else if (rr === 3) c = K.pave[0];
    slab[i] = c;
    slabWet[i] = (rr & 255) === 5 ? K.slush[2] : cw; // a glint of water on the wet stone
  }
  // matted dead grass: tones in soft patches, tufts lit on top and shaded below
  const grass = new Int32Array(GR_W * GR_H);
  for (let y = 0; y < GR_H; y++) for (let x = 0; x < GR_W; x++) {
    // mostly the mid tone, darker where it lies flattened and wet
    const bay = BAYER16[((y & 3) << 2) | (x & 3)];
    const n1 = NT[(((y + 97) & 255) << 8) | ((x + 31) & 255)];
    grass[y * GR_W + x] = (72 - n1) * 1.5 + 8 > bay ? K.grass[0] : K.grass[1];
  }
  for (let y = 0; y < GR_H; y++) for (let x = 0; x < GR_W; x++) {
    // tufts: a 1-2 px lit stroke over a shaded pixel, denser where the grass stands up
    const n1 = NT[(((y + 97) & 255) << 8) | ((x + 31) & 255)];
    const hs = R[(y * 193 + x * 41 + (s0 >> 12)) & 0xffff] & 31;
    if (hs > (n1 > 150 ? 3 : 1)) continue;
    const at = (xx: number, yy: number) => ((yy + GR_H) % GR_H) * GR_W + (xx & (GR_W - 1));
    grass[at(x, y)] = K.grass[2];
    if (hs === 0) grass[at(x, y - 1)] = K.grass[2];
    grass[at(x, y + 1)] = K.grass[0];
  }
  return { settDry, settWet, yardCob, slab, slabWet, grass };
}

// ------------------------------------------------------------------ painter context

interface Ctx {
  W: number; H: number; w: number; h: number;
  buf: Int32Array; mat: Uint8Array; nb: Uint16Array;
  dN: Uint8Array; dS: Uint8Array; dW: Uint8Array; dE: Uint8Array;
  NT: Uint8Array; R: Uint8Array; K: Words; T: Tiles;
  /** Noise offsets per use: x in the low byte, y in the high byte. */
  o: Int32Array;
  rs: number; s0: number;
  /** Per-band x shifts of the sett tile (every 96 rows) and slab tile (every 72 rows). */
  settShift: Int32Array; slabShift: Int32Array;
  /** Slush cover noise (two octaves) times SLOPE, 512 x 512, tileable. */
  cn: Float32Array;
  /** Lump relief (common.lumpTex) and the slush and snow tones it indexes (shade, flat, lit). */
  lump: Uint8Array; slushW: Int32Array; snowW: Int32Array; oldSnowW: Int32Array;
}

/** Patches of slush 1-3 m across: the noise texture at full and at double frequency. */
function coverNoise(NT: Uint8Array, oB: number, oC: number): Float32Array {
  const out = new Float32Array(512 * 512);
  const bx = oB & 255, by = oB >> 8, cx = oC & 255, cy = oC >> 8;
  for (let y = 0; y < 512; y++) {
    const rb = ((by + y) & 255) << 8, rc = ((cy + y * 2) & 255) << 8;
    for (let x = 0; x < 512; x++) {
      out[(y << 9) | x] = ((NT[rb | ((bx + x) & 255)] - 128) * 0.8 + (NT[rc | ((cx + x * 2) & 255)] - 128) * 0.4) * SLOPE;
    }
  }
  return out;
}

const FY = new Float32Array(9).map((_, v) => (v + 0.5) / 9);
const FX = new Float32Array(12).map((_, u) => (u + 0.5) / 12);

/** Setts, slush, wet wheel tracks and gutter snow for road cells cx0..cx1-1 of row Y. */
function roadRun(c: Ctx, Y: number, v: number, cy: number, cx0: number, cx1: number, m: number): void {
  const buf = c.buf, NT = c.NT, R = c.R, K = c.K, w = c.w;
  const dNa = c.dN, dSa = c.dS, dWa = c.dW, dEa = c.dE;
  const clear = m !== ROAD;
  const P = clear ? PT_CLEAR : PT;
  const fy = FY[v];
  const byRow = (Y & 3) << 2;
  const oD = c.o[3], oF = c.o[5];
  const cn = c.cn, cnRow = (Y & 511) << 9;
  const nD = (((oD >> 8) + (Y >> 1)) & 255) << 8, oDx = oD & 255;
  const oFy = oF >> 8, oFx = oF & 255;
  const sRow = (Y % ST_H) * ST_W, sSh = c.settShift[(Y / ST_H) | 0];
  const dry = c.T.settDry, wetT = c.T.settWet;
  const rRow = (Y * 179 + c.rs) & 0xffff;
  const sl0 = K.slush[0], sn0 = K.snow[0];
  const slush = c.slushW, snow = c.snowW;
  const lumpA = c.lump, oL = c.o[6], lRow = (((oL >> 8) + Y) & 255) << 8, lx = oL & 255;
  const cob0 = K.cob[0], mortar = K.mortar, pud0 = K.puddle[0];
  let o = Y * c.W + cx0 * 12;
  for (let cx = cx0; cx < cx1; cx++) {
    const ci = cy * w + cx;
    const dn = dNa[ci], ds = dSa[ci], dw = dWa[ci], de = dEa[ci];
    const near = dn < 2 || ds < 2 || dw < 2 || de < 2;
    const X0 = cx * 12;
    for (let u = 0; u < 12; u++, o++) {
      const X = X0 + u;
      const bay = BAYER16[byRow | (X & 3)];
      let di = PROF_N - 1;
      if (near) {
        const a = dn + fy, b = ds + 1 - fy, cc = dw + FX[u], e = de + 1 - FX[u];
        let d = a, along = X, side = 0;
        if (b < d) { d = b; side = 1; }
        if (cc < d) { d = cc; along = Y; side = 2; }
        if (e < d) { d = e; along = Y; side = 3; }
        if (d < 0.1) { buf[o] = (R[(rRow + X * 31) & 0xffff] & 7) === 0 ? pud0 : mortar; continue; }
        if (d < 1.1) {
          // dirty snow shovelled into the gutter: lumpy heaps with gaps, grey where they melt
          const hs = NT[(((oFy + side * 61) & 255) << 8) | ((oFx + (along >> 1)) & 255)];
          const hq = NT[(((oFy + side * 61 + 90) & 255) << 8) | ((oFx + along * 2) & 255)];
          const heap = (hs - 104) * 0.0062 + (hq - 128) * 0.0022; // metres out from the kerb
          if (heap > 0 && d < heap + 0.08) {
            const q = (heap + 0.08 - d) * 9 + (bay - 7.5) * 0.08; // px in from the heap's edge
            buf[o] = q < 1 ? sl0 : q < 2 ? sn0 : snow[lumpA[lRow | ((lx + X) & 255)]];
            continue;
          }
        }
        di = d < 7.9 ? (d * 12) | 0 : PROF_N - 1;
      }
      // steep threshold: solid patches with a 1-2 px dithered rim
      const t = P[di] + cn[cnRow | (X & 511)];
      if (t > bay) {
        buf[o] = t - bay < 3 ? sl0 : (R[(rRow + X * 31) & 0xffff] & 63) === 0 ? cob0 : slush[lumpA[lRow | ((lx + X) & 255)]];
        continue;
      }
      const ti = sRow + ((X + sSh) & (ST_W - 1));
      if (!clear && PROF_W[di] === 1 && NT[nD | ((oDx + (X >> 1)) & 255)] > 60) {
        buf[o] = wetT[ti]; // a wet wheel track
        continue;
      }
      buf[o] = dry[ti];
    }
  }
}

/** Pavement slabs, kerbs, wet patches and old snow along the walls. */
function walkRun(c: Ctx, Y: number, v: number, cy: number, cx0: number, cx1: number): void {
  const buf = c.buf, NT = c.NT, K = c.K, w = c.w, nbA = c.nb;
  const byRow = (Y & 3) << 2;
  const oD = c.o[3], oE = c.o[4];
  const nD = (((oD >> 8) + (Y >> 1)) & 255) << 8, oDx = oD & 255;
  const nE = (((oE >> 8) + (Y >> 1)) & 255) << 8, oEx = oE & 255;
  const slab = c.T.slab, slabWet = c.T.slabWet, sRow = (Y % SL_H) * SL_W, sSh = c.slabShift[(Y / SL_H) | 0];
  const kerb = K.kerb, kerbFace = K.kerbFace;
  const lumpA = c.lump, oL = c.o[6], lRow = (((oL >> 8) + Y) & 255) << 8, lx = oL & 255, old = c.oldSnowW;
  const dry = c.T.settDry, tRow = (Y % ST_H) * ST_W, tSh = c.settShift[(Y / ST_H) | 0];
  let o = Y * c.W + cx0 * 12;
  for (let cx = cx0; cx < cx1; cx++) {
    const b = nbA[cy * w + cx];
    const X0 = cx * 12;
    const kerbs = (b & 15) !== 0 || (b & 3840) !== 0, walls = (b & 240) !== 0;
    const tRowX = sRow + ((X0 + sSh) % SL_W); // cells never straddle the tile's wrap (both are 12 px multiples)
    // a pavement corner with road on two sides is rounded off with a 1 m radius
    const south = (b & 2) !== 0, east = (b & 8) !== 0;
    const corner = (south || b & 1) && (east || b & 4) &&
      (b & (south ? (east ? 2048 : 1024) : east ? 512 : 256)) !== 0;
    const dv = south ? (v + 0.5) / 9 : (8.5 - v) / 9;
    for (let u = 0; u < 12; u++, o++) {
      const X = X0 + u;
      if (corner) {
        const du = east ? (u + 0.5) / 12 : (11.5 - u) / 12;
        const r2 = du * du + dv * dv;
        if (r2 > 1) { buf[o] = r2 < 1.2 ? K.mortar : dry[tRow + ((X + tSh) & (ST_W - 1))]; continue; }
        if (r2 > 0.68) { buf[o] = south && r2 > 0.88 && dv > 0.45 ? kerbFace : kerb; continue; }
      } else if (kerbs) {
        // a light granite kerb where the pavement meets the road, its south face showing, the
        // joints between the metre-long kerbstones (k: 1 along x, 3 along y, 2 the face)
        let k = 0;
        if (b & 2) { if (v === 8) k = 2; else if (v >= 6) k = 1; }
        if (!k && b & 1 && v <= 1) k = 1;
        if (!k && b & 4 && u <= 1) k = 3;
        if (!k && b & 8 && u >= 10) k = 3;
        if (!k && b & 256 && u <= 1 && v <= 1) k = 1;
        if (!k && b & 512 && u >= 10 && v <= 1) k = 1;
        if (!k && b & 1024 && u <= 1 && v >= 6) k = v === 8 ? 2 : 1;
        if (!k && b & 2048 && u >= 10 && v >= 6) k = v === 8 ? 2 : 1;
        if (k) { buf[o] = k === 2 || (k === 1 && u === 0) || (k === 3 && v === 0) ? kerbFace : kerb; continue; }
      }
      const bay = BAYER16[byRow | (X & 3)];
      if (walls) {
        // old snow along the house walls, trodden grey at its edge
        let dw = 9;
        if (b & 16 && v < dw) dw = v;
        if (b & 32 && 8 - v < dw) dw = 8 - v;
        if (b & 64 && u * 0.75 < dw) dw = u * 0.75;
        if (b & 128 && (11 - u) * 0.75 < dw) dw = (11 - u) * 0.75;
        const t = ((NT[nD | ((oDx + (X >> 1)) & 255)] - 100) * 0.035 - dw) * 5 + 8;
        if (t > bay) { buf[o] = t - bay > 7 ? old[lumpA[lRow | ((lx + X) & 255)]] : K.slush[1]; continue; }
      }
      // wet patches (solid, with a dithered rim) use the wet slab tile
      const t = (NT[nE | ((oEx + (X >> 1)) & 255)] - 196) * 2.5 + 8;
      buf[o] = (t > bay ? slabWet : slab)[tRowX + u];
    }
  }
}

/** Beaten earth, old cobbles, pebbles and dirty snow heaps against the walls. */
function yardRun(c: Ctx, Y: number, v: number, cy: number, cx0: number, cx1: number): void {
  const buf = c.buf, NT = c.NT, R = c.R, K = c.K, w = c.w, nbA = c.nb;
  const byRow = (Y & 3) << 2;
  const oB = c.o[1], oD = c.o[3], oF = c.o[5];
  const nB = (((oB >> 8) + (Y >> 1)) & 255) << 8, oBx = oB & 255;
  const nD = (((oD >> 8) + (Y >> 2) + 40) & 255) << 8, oDx = oD & 255;
  const oFy = oF >> 8, oFx = oF & 255;
  const cob = c.T.yardCob, sRow = (Y % ST_H) * ST_W, sSh = c.settShift[(Y / ST_H) | 0];
  const rRow = (Y * 179 + c.rs) & 0xffff;
  const e0 = K.earth[0], e1 = K.earth[1], e2 = K.earth[2], peb = K.cob[1];
  const lumpA = c.lump, oL = c.o[6], lRow = (((oL >> 8) + Y) & 255) << 8, lx = oL & 255, snow = c.snowW;
  let o = Y * c.W + cx0 * 12;
  for (let cx = cx0; cx < cx1; cx++) {
    const b = nbA[cy * w + cx];
    const X0 = cx * 12;
    const walls = (b & 240) !== 0;
    for (let u = 0; u < 12; u++, o++) {
      const X = X0 + u;
      const bay = BAYER16[byRow | (X & 3)];
      const rr = R[(rRow + X * 31) & 0xffff];
      if (walls) {
        // dirty snow heaps against the walls
        let dw = 99, along = X;
        if (b & 16 && v < dw) { dw = v; along = X; }
        if (b & 32 && 8 - v < dw) { dw = 8 - v; along = X; }
        if (b & 64 && u * 0.75 < dw) { dw = u * 0.75; along = Y; }
        if (b & 128 && (11 - u) * 0.75 < dw) { dw = (11 - u) * 0.75; along = Y; }
        const hn = NT[(((oFy + 33) & 255) << 8) | ((oFx + (along >> 1)) & 255)];
        const hq = NT[(((oFy + 120) & 255) << 8) | ((oFx + along * 2) & 255)];
        const heap = (hn - 80) * 0.045 + (hq - 128) * 0.025; // px out from the wall
        if (dw < heap) {
          const q = (heap - dw) * 3 + (bay - 7.5) * 0.3;
          buf[o] = q < 2 ? K.slush[0] : q < 4 ? K.snow[0] : snow[lumpA[lRow | ((lx + X) & 255)]];
          continue;
        }
      }
      // old cobbles surviving in patches, earth in the joints
      if (NT[nD | ((oDx + (X >> 2) + 40) & 255)] > 172) { buf[o] = cob[sRow + ((X + sSh) & (ST_W - 1))]; continue; }
      if (rr < 3) { buf[o] = peb; continue; } // pebble
      // beaten earth: wet dark mud, trodden earth, dry crust, in solid patches
      const n1 = NT[nB | ((oBx + (X >> 1)) & 255)];
      const t1 = (n1 - 96) * 2 + 8, t2 = (n1 - 188) * 2 + 8;
      buf[o] = t2 > bay ? e2 : t1 > bay ? e1 : e0;
    }
  }
}

/** Dead grass, snow patches, trodden earth paths and a stone edging at the street. */
function squareRun(c: Ctx, Y: number, v: number, cy: number, cx0: number, cx1: number): void {
  const buf = c.buf, NT = c.NT, K = c.K, w = c.w, nbA = c.nb;
  const byRow = (Y & 3) << 2;
  const oD = c.o[3], oE = c.o[4];
  const nD = (((oD >> 8) + (Y >> 1)) & 255) << 8, oDx = oD & 255;
  const nE = (((oE >> 8) + (Y >> 2)) & 255) << 8, oEx = oE & 255;
  const grass = c.T.grass, gRow = (Y % GR_H) * GR_W;
  let o = Y * c.W + cx0 * 12;
  for (let cx = cx0; cx < cx1; cx++) {
    const b = nbA[cy * w + cx];
    const X0 = cx * 12;
    const edgeRow = (b & 1 && v === 0) || (b & 2 && v === 8);
    for (let u = 0; u < 12; u++, o++) {
      const X = X0 + u;
      if (edgeRow || (b & 4 && u === 0) || (b & 8 && u === 11)) { buf[o] = K.kerb; continue; }
      const bay = BAYER16[byRow | (X & 3)];
      // snow lying on in patches
      const ts = (NT[nD | ((oDx + (X >> 1)) & 255)] - 186) * 2 + 8;
      if (ts > bay) { buf[o] = ts - bay < 3 ? K.snow[0] : c.snowW[c.lump[((((c.o[6] >> 8) + Y) & 255) << 8) | (((c.o[6] & 255) + X) & 255)]]; continue; }
      // trodden paths of bare earth
      const tp = (44 - NT[nE | ((oEx + (X >> 2)) & 255)]) * 4 + 8;
      if (tp > bay) { buf[o] = tp - bay > 5 ? K.earth[1] : K.earth[0]; continue; }
      buf[o] = grass[gRow + (X & (GR_W - 1))];
    }
  }
}

function paintRun(c: Ctx, m: number, Y: number, v: number, cy: number, cx0: number, cx1: number): void {
  switch (m) {
    case ROAD:
    case RAIL_EW:
    case RAIL_NS:
      roadRun(c, Y, v, cy, cx0, cx1, m);
      return;
    case WALK:
      walkRun(c, Y, v, cy, cx0, cx1);
      return;
    case YARD:
      yardRun(c, Y, v, cy, cx0, cx1);
      return;
    case SQUARE:
      squareRun(c, Y, v, cy, cx0, cx1);
      return;
    default: {
      const o = Y * c.W + cx0 * 12;
      c.buf.fill(c.K.soot[0], o, o + (cx1 - cx0) * 12);
    }
  }
}

/** One pixel of a soft material, for the ragged borders between them. */
function onePx(c: Ctx, m: number, X: number, Y: number): number {
  const K = c.K;
  switch (m) {
    case WALK: return c.T.slab[(Y % SL_H) * SL_W + ((X + c.slabShift[(Y / SL_H) | 0]) % SL_W)];
    case SQUARE: return c.T.grass[(Y % GR_H) * GR_W + (X & (GR_W - 1))];
    case UNDER: return K.soot[0];
    case YARD: {
      const n1 = c.NT[((((c.o[1] >> 8) + (Y >> 1)) & 255) << 8) | (((c.o[1] & 255) + (X >> 1)) & 255)];
      return n1 > 188 ? K.earth[2] : n1 > 96 ? K.earth[1] : K.earth[0];
    }
    default: return c.T.settDry[(Y % ST_H) * ST_W + ((X + c.settShift[(Y / ST_H) | 0]) & (ST_W - 1))];
  }
}

/** A cell on a soft border: painted normally, then pixels whose jittered position falls in
 *  the neighbouring soft material are taken from it, so the border is ragged. */
function raggedCell(c: Ctx, Y: number, v: number, cy: number, cx: number, m: number): void {
  paintRun(c, m, Y, v, cy, cx, cx + 1);
  const { NT, W, H, w, h, mat, buf } = c;
  const oA = c.o[0], oB = c.o[1];
  const nA = (((oA >> 8) + (Y >> 1)) & 255) << 8, nB = (((oB >> 8) + (Y >> 1)) & 255) << 8;
  const o = Y * W + cx * 12;
  for (let u = 0; u < 12; u++) {
    const X = cx * 12 + u;
    const jx = X + (((NT[nA | (((oA & 255) + X + 50) & 255)] - 128) * 3) >> 7);
    const jy = Y + (((NT[nB | (((oB & 255) + X + 70) & 255)] - 128) * 2) >> 7);
    const ccx = jx < 0 ? 0 : jx >= W ? w - 1 : (jx / 12) | 0;
    const ccy = jy < 0 ? 0 : jy >= H ? h - 1 : (jy / 9) | 0;
    const mj = mat[ccy * w + ccx];
    if (mj !== m && soft(m, mj)) buf[o + u] = onePx(c, mj, X, Y);
  }
}

// ------------------------------------------------------------------ the painter

export const paintGround: GroundPainter = (grid: GroundGrid, seed: number): PixelImage => {
  const { w, h } = grid;
  const W = w * 12, H = h * 9;
  const out = img(W, H);
  if (w <= 0 || h <= 0) return out;
  const buf = wordsI(out);
  const K = colours();
  const NT = noiseTex();
  const s0 = (Math.imul(seed | 0, 0x9e3779b1) ^ 0x5bd1e995) >>> 0;

  // ---- cells
  const n = w * h;
  const mat = new Uint8Array(n);
  const legend = grid.legend.map((m) => CODE[m] ?? UNDER);
  for (let i = 0; i < n; i++) mat[i] = legend[grid.cells[i]] ?? UNDER;
  const mAt = (cx: number, cy: number) => mat[(cy < 0 ? 0 : cy >= h ? h - 1 : cy) * w + (cx < 0 ? 0 : cx >= w ? w - 1 : cx)];

  // distances (whole cells, capped) from a road cell to the nearest non-road cell, per axis;
  // the map edge counts as more road
  const CAP = 31;
  const dN = new Uint8Array(n), dS = new Uint8Array(n), dW = new Uint8Array(n), dE = new Uint8Array(n);
  for (let cx = 0; cx < w; cx++) {
    let run = CAP;
    for (let cy = 0; cy < h; cy++) { const i = cy * w + cx; if (isRoad(mat[i])) { dN[i] = run; if (run < CAP) run++; } else run = 0; }
    run = CAP;
    for (let cy = h - 1; cy >= 0; cy--) { const i = cy * w + cx; if (isRoad(mat[i])) { dS[i] = run; if (run < CAP) run++; } else run = 0; }
  }
  for (let cy = 0; cy < h; cy++) {
    let run = CAP;
    for (let cx = 0; cx < w; cx++) { const i = cy * w + cx; if (isRoad(mat[i])) { dW[i] = run; if (run < CAP) run++; } else run = 0; }
    run = CAP;
    for (let cx = w - 1; cx >= 0; cx--) { const i = cy * w + cx; if (isRoad(mat[i])) { dE[i] = run; if (run < CAP) run++; } else run = 0; }
  }

  // neighbour bits: 1 N, 2 S, 4 W, 8 E is road; 16 N, 32 S, 64 W, 128 E is under (a wall);
  // 256 NW, 512 NE, 1024 SW, 2048 SE is road (kerb corners); 4096 = a ragged border here.
  // Read from a copy of the grid padded by one cell (edges repeated), so no bounds checks.
  const PW = w + 2;
  const pm = new Uint8Array(PW * (h + 2));
  for (let py = 0; py < h + 2; py++) {
    const sy = py === 0 ? 0 : py > h ? h - 1 : py - 1;
    for (let px = 0; px < PW; px++) pm[py * PW + px] = mat[sy * w + (px === 0 ? 0 : px > w ? w - 1 : px - 1)];
  }
  const nb = new Uint16Array(n);
  for (let cy = 0; cy < h; cy++) for (let cx = 0; cx < w; cx++) {
    const p = (cy + 1) * PW + cx + 1, m = pm[p];
    const N_ = pm[p - PW], S_ = pm[p + PW], W_ = pm[p - 1], E_ = pm[p + 1];
    let b = ROADISH[N_] | (ROADISH[S_] << 1) | (ROADISH[W_] << 2) | (ROADISH[E_] << 3);
    if (N_ === UNDER) b |= 16;
    if (S_ === UNDER) b |= 32;
    if (W_ === UNDER) b |= 64;
    if (E_ === UNDER) b |= 128;
    b |= (ROADISH[pm[p - PW - 1]] << 8) | (ROADISH[pm[p - PW + 1]] << 9) | (ROADISH[pm[p + PW - 1]] << 10) | (ROADISH[pm[p + PW + 1]] << 11);
    if (m !== UNDER) {
      const row = m * 8;
      if (SOFT[row + N_] | SOFT[row + S_] | SOFT[row + W_] | SOFT[row + E_] | SOFT[row + pm[p - PW - 1]] | SOFT[row + pm[p - PW + 1]] | SOFT[row + pm[p + PW - 1]] | SOFT[row + pm[p + PW + 1]]) b |= 4096;
    }
    nb[cy * w + cx] = b;
  }

  const bands = (period: number, count: number, salt: number, mul: number) =>
    new Int32Array(count).map((_, k) => (ihash(k, salt, s0) % period) * mul);
  const o = new Int32Array(8).map((_, k) => ihash(k + 1, 17, s0) & 0xffff);
  const c: Ctx = {
    W, H, w, h, buf, mat, nb, dN, dS, dW, dE, NT, R: rnd(), K,
    T: buildTiles(s0, K, NT),
    o,
    rs: s0 & 0xffff, s0,
    settShift: bands(ST_W, Math.ceil(H / ST_H) + 1, 5, 1),
    slabShift: bands(SL_W / 12, Math.ceil(H / SL_H) + 1, 6, 12),
    cn: coverNoise(NT, o[1], o[2]),
    lump: lumpTex(),
    slushW: Int32Array.from(K.slush),
    snowW: Int32Array.from(K.snow),
    oldSnowW: Int32Array.from([K.slush[2], K.snow[0], K.snow[1]]),
  };

  // ---- base pass: runs of same-material cells, ragged-border cells one by one
  for (let cy = 0; cy < h; cy++) {
    const row = cy * w;
    for (let v = 0; v < 9; v++) {
      const Y = cy * 9 + v;
      let cx = 0;
      while (cx < w) {
        const m = mat[row + cx];
        if (nb[row + cx] & 4096) { raggedCell(c, Y, v, cy, cx, m); cx++; continue; }
        let e = cx + 1;
        while (e < w && mat[row + e] === m && !(nb[row + e] & 4096)) e++;
        paintRun(c, m, Y, v, cy, cx, e);
        cx = e;
      }
    }
  }

  // ---- details
  const put = (x: number, y: number, col: number) => { if (x >= 0 && y >= 0 && x < W && y < H) buf[y * W + x] = col; };
  const matPx = (x: number, y: number) => mat[((y / 9) | 0) * w + ((x / 12) | 0)];

  // tram rails: each run of rail_ew cells down a column carries one track, or two 3 m apart
  // when the run is 5 m or wider, centred in the run; rail_ns likewise across a row
  const centres = (a: number, b: number): number[] => {
    const L = b - a + 1, mid = (a + b + 1) / 2;
    return L >= 5 ? [mid - TRACK_SPACING / 2, mid + TRACK_SPACING / 2] : [mid];
  };
  for (let cx = 0; cx < w; cx++) {
    let cy = 0;
    while (cy < h) {
      if (mat[cy * w + cx] !== RAIL_EW) { cy++; continue; }
      let e = cy;
      while (e + 1 < h && mat[(e + 1) * w + cx] === RAIL_EW) e++;
      for (const yc of centres(cy, e)) {
        const r1 = Math.round((yc - GAUGE / 2) * 9), r2 = Math.round((yc + GAUGE / 2) * 9);
        for (let X = cx * 12; X < cx * 12 + 12; X++) {
          const j1 = (X + 29) % 144 === 0, j2 = (X + 101) % 144 === 0;
          if (matPx(X, r1) === RAIL_EW) { put(X, r1 - 1, K.cob[2]); put(X, r1, j1 ? K.cob[0] : K.rail); put(X, r1 + 1, K.mortar); }
          if (matPx(X, r2) === RAIL_EW) { put(X, r2 - 1, K.mortar); put(X, r2, j2 ? K.cob[0] : K.rail); put(X, r2 + 1, K.cob[0]); }
        }
      }
      cy = e + 1;
    }
  }
  for (let cy = 0; cy < h; cy++) {
    let cx = 0;
    while (cx < w) {
      if (mat[cy * w + cx] !== RAIL_NS) { cx++; continue; }
      let e = cx;
      while (e + 1 < w && mat[cy * w + e + 1] === RAIL_NS) e++;
      for (const xc of centres(cx, e)) {
        const c1 = Math.round((xc - GAUGE / 2) * 12), c2 = Math.round((xc + GAUGE / 2) * 12);
        for (let Y = cy * 9; Y < cy * 9 + 9; Y++) {
          const j1 = (Y + 23) % 108 === 0, j2 = (Y + 77) % 108 === 0;
          if (matPx(c1, Y) === RAIL_NS) { put(c1 - 1, Y, K.cob[2]); put(c1, Y, j1 ? K.cob[0] : K.rail); put(c1 + 1, Y, K.mortar); }
          if (matPx(c2, Y) === RAIL_NS) { put(c2 - 1, Y, K.mortar); put(c2, Y, j2 ? K.cob[0] : K.rail); put(c2 + 1, Y, K.cob[0]); }
        }
      }
      cx = e + 1;
    }
  }

  // manhole covers, at most one per 6 x 6 m block, away from kerbs
  for (let by = 0; by < h; by += 6) for (let bx = 0; bx < w; bx += 6) {
    if (hash2(bx, by, s0 + 21) > 0.3) continue;
    const cx = bx + ((hash2(bx, by, s0 + 22) * 6) | 0), cy = by + ((hash2(bx, by, s0 + 23) * 6) | 0);
    if (cx >= w || cy >= h) continue;
    const ci = cy * w + cx;
    if (mat[ci] !== ROAD || Math.min(dN[ci], dS[ci], dW[ci], dE[ci]) < 2) continue;
    manhole(put, cx * 12 + 6, cy * 9 + 4, K);
  }

  // street drains in the gutter, against the kerb
  for (let cy = 0; cy < h; cy++) for (let cx = 0; cx < w; cx++) {
    const ci = cy * w + cx;
    if (!isRoad(mat[ci]) || ihash(cx, cy, s0 + 25) % 100 > 5) continue;
    const up = mAt(cx, cy - 1) === WALK, dn = mAt(cx, cy + 1) === WALK;
    const lf = mAt(cx - 1, cy) === WALK, rt = mAt(cx + 1, cy) === WALK;
    if (up || dn) {
      const Y0 = up ? cy * 9 : cy * 9 + 6, X0 = cx * 12 + 3;
      for (let y = 0; y < 3; y++) for (let x = 0; x < 6; x++) {
        const edge = y === 0 || y === 2 || x === 0 || x === 5;
        put(X0 + x, Y0 + y, edge ? K.soot[1] : x & 1 ? K.soot[2] : K.soot[0]);
      }
    } else if (lf || rt) {
      const X0 = lf ? cx * 12 : cx * 12 + 8, Y0 = cy * 9 + 2;
      for (let y = 0; y < 5; y++) for (let x = 0; x < 4; x++) {
        const edge = y === 0 || y === 4 || x === 0 || x === 3;
        put(X0 + x, Y0 + y, edge ? K.soot[1] : y & 1 ? K.soot[2] : K.soot[0]);
      }
    }
  }

  // puddles: in the wheel tracks and gutters, in muddy yards, now and then on a pavement
  for (let by = 0; by < h; by += 3) for (let bx = 0; bx < w; bx += 3) {
    const r = hash2(bx, by, s0 + 31);
    const cx = bx + ((hash2(bx, by, s0 + 32) * 3) | 0), cy = by + ((hash2(bx, by, s0 + 33) * 3) | 0);
    if (cx >= w || cy >= h) continue;
    const ci = cy * w + cx, m = mat[ci];
    let p = m === YARD ? 0.2 : m === WALK ? 0.04 : 0;
    let Y = cy * 9 + ((hash2(bx, by, s0 + 35) * 9) | 0);
    let X = cx * 12 + ((hash2(bx, by, s0 + 34) * 12) | 0);
    let dir = 0; // 1: lengthwise east-west, 2: lengthwise north-south
    if (m === ROAD) {
      // snap into a wheel track, lengthwise along the street
      const ew = Math.min(dN[ci], dS[ci]) <= Math.min(dW[ci], dE[ci]);
      const dd = ew ? Math.min(dN[ci], dS[ci]) + 0.5 : Math.min(dW[ci], dE[ci]) + 0.5;
      if (dd < 3.5) {
        p = 0.17;
        const track = hash2(bx, by, s0 + 38) < 0.5 ? 1.35 : 2.75;
        const fromN = ew ? dN[ci] <= dS[ci] : dW[ci] <= dE[ci];
        if (ew) Y = Math.round(((fromN ? cy - dN[ci] : cy + 1 + dS[ci]) + (fromN ? track : -track)) * 9);
        else X = Math.round(((fromN ? cx - dW[ci] : cx + 1 + dE[ci]) + (fromN ? track : -track)) * 12);
        dir = ew ? 1 : 2;
      } else p = 0.1;
    }
    if (r > p) continue;
    // a chain of 1-3 overlapping blobs of different sizes, lengthwise in a wheel track
    const big = hash2(bx, by, s0 + 36), tall = hash2(bx, by, s0 + 37);
    const parts = 1 + ((hash2(bx, by, s0 + 39) * 2.99) | 0);
    const blobs: number[] = [];
    let px = X, py = Y;
    for (let k = 0; k < parts; k++) {
      const q = hash2(bx + k, by, s0 + 40);
      const rx = dir === 1 ? 4 + big * 8 + q * 5 : dir === 2 ? 2.5 + q * 2 : 3.5 + big * 5 + q * 3;
      const ry = dir === 1 ? 1.6 + tall * 1.4 * q : dir === 2 ? 3 + big * 5 + q * 3 : 2 + tall * 2.5 + q;
      blobs.push(px, py, rx, ry);
      if (dir === 2) { py += ry * 1.3 * (q < 0.5 ? 1 : -1); px += ((q * 3) | 0) - 1; }
      else { px += rx * 1.3 * (q < 0.5 ? 1 : -1); py += k ? ((q * 3) | 0) - 1 : 0; }
    }
    puddle(put, W, H, blobs, m, matPx, K, (s0 + bx * 31 + by * 7) & 0xffff);
  }

  return out;
};

function manhole(put: (x: number, y: number, c: number) => void, X: number, Y: number, K: Words): void {
  // a melted ring round the warm cover, then the cast-iron lid
  for (let y = -4; y <= 4; y++) for (let x = -6; x <= 6; x++) {
    const d = (x * x) / 36 + (y * y) / 16;
    if (d > 1) continue;
    if (d > 0.7) { put(X + x, Y + y, K.cob[0]); continue; }
    if (d > 0.48) { put(X + x, Y + y, K.mortar); continue; }
    const ring = d > 0.2 && d < 0.32;
    put(X + x, Y + y, ring ? K.soot[2] : (x + y) & 1 ? K.soot[1] : K.soot[0]);
  }
  put(X - 2, Y - 1, K.soot[2]);
}

/** A puddle: the union of ellipses (x, y, rx, ry quadruples) with a wobbly edge. A light rim
 *  on the far edge (the sky caught at a grazing angle), the sky's reflection just below it
 *  and in a streak, dark water, and dark wet stone round the near side. */
function puddle(
  put: (x: number, y: number, c: number) => void,
  W: number, H: number, blobs: number[], m: number,
  matPx: (x: number, y: number) => number, K: Words, salt: number,
): void {
  const road = isRoad(m);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let k = 0; k < blobs.length; k += 4) {
    x0 = Math.min(x0, Math.floor(blobs[k] - blobs[k + 2] - 2)); x1 = Math.max(x1, Math.ceil(blobs[k] + blobs[k + 2] + 2));
    y0 = Math.min(y0, Math.floor(blobs[k + 1] - blobs[k + 3] - 2)); y1 = Math.max(y1, Math.ceil(blobs[k + 1] + blobs[k + 3] + 2));
  }
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  const mask = new Uint8Array(bw * bh);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const wob = 0.72 + (ihash(x >> 2, y >> 1, salt) & 255) * 0.0016;
    for (let k = 0; k < blobs.length; k += 4) {
      const dx = (x - blobs[k]) / blobs[k + 2], dy = (y - blobs[k + 1]) / blobs[k + 3];
      if (dx * dx + dy * dy < wob) { mask[(y - y0) * bw + (x - x0)] = 1; break; }
    }
  }
  const inside = (x: number, y: number) => x >= x0 && y >= y0 && x <= x1 && y <= y1 && mask[(y - y0) * bw + (x - x0)] === 1;
  const same = (mm: number) => (road ? isRoad(mm) : mm === m);
  const lit = m === YARD ? K.earth[2] : K.slush[2];
  const dark = m === YARD ? K.earth[0] : K.cob[0];
  const sy = blobs[1] + 1;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    if (x < 0 || y < 0 || x >= W || y >= H || !same(matPx(x, y))) continue;
    if (inside(x, y)) {
      if (!inside(x, y - 1)) { put(x, y, lit); continue; }
      const streak = y === sy && ((x + salt) % 9) < 4;
      put(x, y, !inside(x, y - 2) || streak ? K.puddle[1] : K.puddle[0]);
    } else if (inside(x, y - 1) || inside(x - 1, y) || inside(x + 1, y)) {
      put(x, y, dark); // wet stone round the water
    }
  }
}
