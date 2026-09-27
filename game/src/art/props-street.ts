// Street furniture of Warsaw, March 1943: cast-iron lamps, the advertising column with its German
// notice, the wooden newspaper kiosk, benches, telephone poles and the phone box, the tram stop,
// enamel street-name plates, hydrants and dustbins. Each is a small model rendered by the prop
// renderer, with hand-placed pixels where a model would be clumsier (plates, text, splinters).
import type { PropArt, PropState } from "./types";
import { PAL, ramp, type RGB, type Ramp } from "./palette";
import { hash2, px, rect, hline, vline } from "./pixel";
import { Mesh, toneOf, type Hit, type Mat } from "./vehicles-3d";
import { C, S, F, IRON, CHAR, EMBER, PROP_SHADOW, flat, glassTex, line3, mat, P, renderProp, shadowPx } from "./props-kit";
import { drawText, measure } from "./props-font";

const GREEN = C.plaster_green;
const PAPER: Ramp = [C.cloth[1], C.cloth[2], S.chalk];
const INK = PAL.hud.paper_ink;
const POLE: Ramp = [S.outline, F.trunk[0], F.trunk[1], C.wood[0]];
const ENAMEL = ramp("props_extra", "enamel_blue");
const WHITE = S.chalk;

// ---------------------------------------------------------------- lamp

/** A cast-iron gas lamp: fluted base, slim post, ladder rest, six-sided lantern, unlit. */
export function lamp(): PropArt {
  const m = new Mesh();
  const iron = flat(IRON);
  m.cylZ(0, 0, 0.21, 0, 0.1, 10, iron);
  m.frustumZ(0, 0, 0.17, 0.1, 0.1, 0.62, 10, { ramp: IRON, tex: (h) => ((h.px & 1) === 0 && h.z > 0.2 ? toneOf(IRON, h.t - 1) : undefined) });
  m.cylZ(0, 0, 0.12, 0.62, 0.72, 8, iron);
  m.cylZ(0, 0, 0.07, 0.72, 3.4, 8, iron);
  m.cylZ(0, 0, 0.1, 1.5, 1.58, 8, iron);
  m.newPart();
  m.box(-0.32, 0.32, -0.025, 0.025, 3.18, 3.24, iron); // the lamplighter's ladder rest
  m.newPart();
  m.frustumZ(0, 0, 0.1, 0.14, 3.4, 3.48, 6, iron);
  const glass: Mat = { ramp: IRON, tex: (h) => (h.z < 3.52 || h.z > 3.93 ? undefined : glassTex(h)) };
  m.frustumZ(0, 0, 0.14, 0.21, 3.48, 3.98, 6, glass);
  m.frustumZ(0, 0, 0.26, 0.05, 3.98, 4.22, 6, iron);
  m.dot([0, 0, 4.36], IRON[2]);
  m.dot([0, 0, 4.27], IRON[1]);
  return renderProp(m);
}

// ---------------------------------------------------------------- advertising column

interface Poster { s0: number; s1: number; z0: number; z1: number; paint: (u: number, v: number, t: number, px: number, py: number) => RGB }

const R_COL = 0.62;
/** Posters on the column, placed by arc length s (m from the east, the front is s = r*pi/2) and height. */
const POSTERS: Poster[] = [
  // BEKANNTMACHUNG: the occupier's notice, a heading bar and ranks of names
  {
    s0: 0.6, s1: 1.36, z0: 1.18, z1: 2.5,
    paint: (u, v, t, pxl, pyl) => {
      const paper = toneOf(PAPER, t);
      if (v > 0.9) return (pxl % 2 === 0) || u < 0.08 || u > 0.92 ? INK : paper; // the heading
      if (v > 0.84) return paper;
      if (v < 0.08) return u > 0.55 && u < 0.9 && pyl % 2 === 0 ? INK : paper; // the signature
      return pyl % 2 === 0 && hash2(pxl, pyl, 3) < 0.7 && u > 0.06 && u < 0.94 ? C.slush[0] : paper;
    },
  },
  // a theatre bill: ochre with a dark figure and a red title
  {
    s0: 0.08, s1: 0.56, z0: 0.6, z1: 2.6,
    paint: (u, v, t, pxl, pyl) => {
      if (v > 0.8) return v > 0.86 && pxl % 3 ? toneOf(C.tram_cream, t) : toneOf(C.tram, t);
      if (Math.hypot((u - 0.5) * 1.3, v - 0.55) < 0.14 || (Math.abs(u - 0.5) < 0.16 && v < 0.45 && v > 0.12)) return C.soot[0];
      return pyl % 7 === 0 && v < 0.1 ? INK : toneOf(C.plaster_ochre, t);
    },
  },
  // a red concert bill and a green one above it
  {
    s0: 1.4, s1: 1.9, z0: 0.45, z1: 1.55,
    paint: (u, v, t, pxl, pyl) => (pyl % 3 === 0 && u > 0.12 && u < 0.88 && v > 0.2 && v < 0.8 ? toneOf(C.tram_cream, t) : toneOf(C.tram, t - (v < 0.1 ? 1 : 0)) ),
  },
  {
    s0: 1.4, s1: 1.9, z0: 1.62, z1: 2.66,
    paint: (u, v, t, pxl, pyl) => (v > 0.7 && v < 0.85 && u > 0.1 && u < 0.9 ? INK : pyl % 2 === 0 && v < 0.6 && v > 0.15 && u > 0.15 && u < 0.85 && hash2(pxl, pyl, 5) < 0.6 ? GREEN[0] : toneOf([GREEN[1], GREEN[2], C.plaster_cream[2]], t)),
  },
  // small bills, one torn
  {
    s0: 0.6, s1: 0.96, z0: 0.42, z1: 1.1,
    paint: (u, v, t, pxl, pyl) => (u + v > 1.55 ? C.soot[1] : pyl % 2 === 0 && u > 0.15 && u < 0.85 && v > 0.2 ? C.slush[0] : toneOf([C.cloth[0], C.cloth[1], C.cloth[2]], t)),
  },
  {
    s0: 1.0, s1: 1.36, z0: 0.42, z1: 1.1,
    paint: (u, v, t, pxl, pyl) => (v > 0.7 ? toneOf(C.puddle, t) : pyl % 2 === 0 && u > 0.2 && u < 0.8 ? INK : toneOf(PAPER, t)),
  },
];

/** The advertising column (słup ogłoszeniowy) with posters and a German notice. */
export function adColumn(): PropArt {
  const m = new Mesh();
  const stone = flat(C.stone_grey);
  m.frustumZ(0, 0, 0.72, 0.66, 0, 0.26, 16, stone);
  const body: Mat = {
    ramp: C.soot,
    tex: (h: Hit) => {
      const th = Math.atan2(h.y, h.x);
      const s = (th < 0 ? th + Math.PI * 2 : th) * R_COL;
      for (const p of POSTERS) {
        if (s >= p.s0 && s <= p.s1 && h.z >= p.z0 && h.z <= p.z1) return p.paint((s - p.s0) / (p.s1 - p.s0), (h.z - p.z0) / (p.z1 - p.z0), h.t, h.px, h.py);
      }
      return toneOf([C.soot[0], C.soot[1], C.soot[2]], h.t);
    },
  };
  m.cylZ(0, 0, R_COL, 0.26, 2.84, 18, body, null);
  m.newPart();
  const cap = flat(GREEN);
  m.cylZ(0, 0, 0.7, 2.84, 2.98, 18, cap);
  m.frustumZ(0, 0, 0.66, 0.34, 2.98, 3.3, 16, cap);
  m.frustumZ(0, 0, 0.34, 0.08, 3.3, 3.52, 12, cap);
  m.dot([0, 0, 3.66], GREEN[2]);
  m.dot([0, 0, 3.58], GREEN[0]);
  return renderProp(m);
}

// ---------------------------------------------------------------- kiosk

/** The wooden newspaper kiosk with its name board; burning it chars and glows, destroyed it is a burnt shell. */
export function kiosk(st: PropState): PropArt {
  const m = new Mesh();
  const seed = 71;
  const ruined = st === "destroyed";
  const top = ruined ? 1.3 : 2.2;
  const planks = mat(C.wood, st, seed, (h) => {
    if (Math.abs(h.ny) > 0.9 || Math.abs(h.nx) > 0.9) {
      if (h.ny > 0.9 && !ruined && h.x > -0.55 && h.x < 0.55 && h.z > 0.98 && h.z < 1.78) {
        if (h.z < 1.03 || h.z > 1.73 || Math.abs(h.x) < 0.03) return C.wood[0]; // window frame
        return st === "burning" ? (hash2(h.px, h.py, 9) < 0.5 ? S.fire[0] : S.fire[1]) : glassTex(h);
      }
      if (h.ny > 0.9 && !ruined && h.z > 0.3 && h.z < 0.85 && ((h.x > -0.88 && h.x < -0.62) || (h.x > 0.62 && h.x < 0.88))) {
        return h.py % 2 === 0 && Math.abs(h.x) > 0.66 && Math.abs(h.x) < 0.84 ? C.slush[0] : toneOf(PAPER, h.t); // posted bills
      }
      const u = ((h.x + 1) / 0.15) % 1;
      if (u < 0.2) return -1;
    }
    if (ruined && h.nz > 0.9) return null;
    return undefined;
  }, top);
  m.box(-0.95, 0.95, -0.62, 0.62, 0, top, planks);
  if (ruined) {
    // the roof fell in: charred rafters and ash inside
    m.newPart();
    m.box(-0.9, 0.9, -0.57, 0.57, 0, 0.35, mat(C.soot, "destroyed", seed));
    m.rod([-0.8, -0.4, 0.4], [0.7, 0.3, 1.2], 0.05, 5, flat(CHAR));
    m.rod([-0.6, 0.35, 1.25], [0.8, -0.3, 0.45], 0.05, 5, flat(CHAR));
    return renderProp(m);
  }
  m.newPart();
  // counter with a stack of newspapers
  m.box(-0.66, 0.66, 0.62, 0.8, 0.9, 0.97, mat(C.wood, st, seed));
  m.box(-0.5, -0.1, 0.64, 0.78, 0.97, 1.03, mat(PAPER, st, seed + 1, (h) => (h.nz > 0.9 && h.px % 3 === 0 ? C.slush[0] : undefined)));
  m.box(0.12, 0.46, 0.64, 0.78, 0.97, 1.01, mat(PAPER, st, seed + 2));
  // hipped tin roof
  m.newPart();
  const tin = mat(C.tin_roof, st, seed + 3, (h) => (((h.x + 2) / 0.22) % 1 < 0.18 ? -1 : undefined), 2.7);
  const e = 0.14;
  const x0 = -0.95 - e, x1 = 0.95 + e, y0 = -0.62 - e, y1 = 0.62 + e, zr = 2.2, zt = 2.62;
  m.poly([[x0, y1, zr], [x1, y1, zr], [0.5, 0, zt], [-0.5, 0, zt]], tin);
  m.poly([[x1, y0, zr], [x0, y0, zr], [-0.5, 0, zt], [0.5, 0, zt]], tin);
  m.poly([[x1, y1, zr], [x1, y0, zr], [0.5, 0, zt]], tin);
  m.poly([[x0, y0, zr], [x0, y1, zr], [-0.5, 0, zt]], tin);
  m.box(x0, x1, y0, y1, zr - 0.06, zr, mat(C.tin_roof, st, seed + 3));
  const a = renderProp(m);
  // the name board over the front: cream letters on dark green
  const board = st === "burning" ? CHAR : GREEN;
  const [bx, by] = P(a, -0.92, 0.3, 3.3);
  const bw = 23, bh = 8;
  rect(a.image, bx, by, bw, bh, board[1]);
  hline(a.image, bx, bx + bw - 1, by, board[2]);
  hline(a.image, bx, bx + bw - 1, by + bh - 1, board[0]);
  drawText(a.image, bx + 2, by + 2, "PRASA", st === "burning" ? EMBER[1] : C.tram_cream[1]);
  vline(a.image, bx + bw, by + 1, by + bh, S.outline);
  hline(a.image, bx + 1, bx + bw, by + bh, S.outline);
  const [, py0] = P(a, 0, 0.3, 2.5);
  for (const x of [bx + 3, bx + bw - 4]) vline(a.image, x, by + bh, py0, S.outline);
  return a;
}

// ---------------------------------------------------------------- bench

/** A park bench of slats on cast-iron ends; variant 1 faces north (seen from behind). */
export function bench(variant: number): PropArt {
  const m = new Mesh();
  const f = variant === 1 ? -1 : 1;
  const wood = flat(C.wood);
  const iron = flat(IRON);
  for (const x of [-0.72, 0.72]) {
    m.newPart();
    m.box(x - 0.04, x + 0.04, -0.2, 0.2, 0, 0.42, iron);
    m.box(x - 0.04, x + 0.04, -f * 0.24 - 0.03, -f * 0.24 + 0.03, 0.42, 0.82, iron);
  }
  m.newPart();
  for (const y of [-0.14, 0.0, 0.14]) m.box(-0.92, 0.92, y - 0.055, y + 0.055, 0.42, 0.47, wood);
  for (const z of [0.56, 0.72]) m.box(-0.92, 0.92, -f * 0.25 - 0.025, -f * 0.25 + 0.025, z, z + 0.09, wood);
  return renderProp(m);
}

// ---------------------------------------------------------------- telephone pole

/** Insulators on the crossarm (x in metres along the arm); the wire point is the last one. */
const INSULATORS = [-0.52, -0.24, 0.24, 0.52];
const ARM_Z = 6.4;
/** The pole's fixed cell, so the wire point is a constant. */
const POLE_CELL = { w: 31, h: 60, ax: 9, ay: 54 };

/** Pixel of each insulator's top in the intact pole image. */
export const POLE_INSULATOR_PIXELS: readonly (readonly [number, number])[] = INSULATORS.map(
  (x) => [POLE_CELL.ax + Math.floor(x * 12), POLE_CELL.ay + Math.floor(-(ARM_Z + 0.17) * 7.5)] as const,
);

export function phonePole(st: PropState): PropArt {
  const m = new Mesh();
  const wood = mat(POLE, "intact", 0, (h) => (((h.z * 7.5) | 0) % 7 === 0 && h.nx > 0.3 ? -1 : undefined));
  if (st !== "destroyed") {
    m.cylZ(0, 0, 0.11, 0, 6.8, 8, wood);
    m.frustumZ(0, 0, 0.11, 0.04, 6.8, 6.92, 8, wood);
    m.newPart();
    m.box(-0.64, 0.64, -0.05, 0.05, ARM_Z - 0.1, ARM_Z, flat([F.trunk[0], F.trunk[1], C.wood[0], C.wood[1]]));
    m.rod([-0.36, 0, ARM_Z - 0.1], [-0.05, 0, ARM_Z - 0.55], 0.02, 4, flat(IRON)); // brace
    m.rod([0.36, 0, ARM_Z - 0.1], [0.05, 0, ARM_Z - 0.55], 0.02, 4, flat(IRON));
    const a = renderProp(m, { cell: POLE_CELL });
    for (const [x, y] of POLE_INSULATOR_PIXELS) {
      px(a.image, x, y, WHITE);
      px(a.image, x, y + 1, C.dirty_snow[0]);
    }
    return a;
  }
  // snapped a man's height up: the stump with its splinters, the top lying in the street, the wire down
  m.cylZ(0, 0, 0.11, 0, 1.85, 8, wood);
  m.newPart();
  const mk = m.mark();
  m.cylX(0, 0.11, 0.11, 0.35, 4.9, 8, wood);
  m.box(4.55, 4.65, -0.64, 0.64, 0, 0.1, flat([F.trunk[0], F.trunk[1], C.wood[0], C.wood[1]]));
  m.rotZ(mk, 0, 0, 0.35);
  const a = renderProp(m, { cell: { w: 72, h: 44, ax: 9, ay: 22 } });
  const img = a.image;
  // splinters: pale wood torn out of the dark pole
  const [sx, sy] = P(a, 0, 0, 1.85);
  const spl: [number, number, RGB][] = [[-1, -1, C.wood[2]], [0, -2, C.wood[2]], [1, -1, C.wood[1]], [0, -1, C.wood[1]], [-1, 0, C.wood[1]], [1, -3, C.wood[2]], [2, -1, S.outline], [1, -4, S.outline], [-1, -2, S.outline]];
  for (const [dx, dy, c] of spl) px(img, sx + dx, sy + dy, c);
  // the wires: loose loops on the cobbles from the fallen crossarm, and an end hanging off the stump
  const c = Math.cos(0.35), s = Math.sin(0.35);
  const tip = (x: number, y: number): [number, number] => [c * x - s * y, s * x + c * y];
  const wires: [number, number, number][][] = [
    [[...tip(4.6, 0.52), 0.1], [3.7, 2.4, 0], [2.6, 2.5, 0], [1.5, 1.9, 0], [0.9, 1.1, 0]],
    [[...tip(4.6, -0.52), 0.1], [4.0, 1.25, 0], [3.1, 1.75, 0], [2.2, 1.5, 0]],
    [[0.02, 0, 1.8], [0.2, 0.25, 1.1], [0.35, 0.5, 0.3], [0.5, 0.7, 0], [0.95, 0.95, 0]],
  ];
  for (const wv of wires) for (let i = 1; i < wv.length; i++) line3(img, a, wv[i - 1], wv[i], S.outline);
  for (const [x, y] of [[3.4, 1.9], [3.9, 1.55], [2.2, 2.0]]) {
    const [ix, iy] = P(a, x, y, 0.05);
    px(img, ix, iy, WHITE);
    px(img, ix + 1, iy, C.dirty_snow[0]);
  }
  return a;
}

// ---------------------------------------------------------------- phone box

/** A glazed telephone box on a stone plinth; destroyed, its panes are smashed and shards lie about. */
export function phoneBox(st: PropState): PropArt {
  const m = new Mesh();
  const broken = st === "destroyed";
  m.box(-0.56, 0.56, -0.56, 0.56, 0, 0.1, flat(C.stone_grey));
  m.newPart();
  const frame = mat(GREEN, broken ? "intact" : st, 23, (h) => {
    if (h.nz > 0.5) return undefined;
    const u = Math.abs(h.ny) > 0.9 ? h.x : h.y;
    if (h.z < 0.25 || h.z > 2.18 || Math.abs(u) > 0.42) return undefined;
    // 2 x 3 panes with glazing bars
    const cu = (u + 0.42) / 0.84 * 2, cz = (h.z - 0.25) / 1.93 * 3;
    if (cu % 1 < 0.08 || cz % 1 < 0.07) return undefined;
    if (broken) {
      const k = hash2(h.px, h.py, 17);
      return k < 0.12 ? C.dirty_snow[1] : k < 0.3 ? S.glass : S.glass_dark;
    }
    return glassTex(h);
  });
  m.box(-0.5, 0.5, -0.5, 0.5, 0.1, 2.3, frame);
  m.newPart();
  const roof: Mat = { ramp: [S.outline, GREEN[0], GREEN[1], GREEN[1]] };
  m.box(-0.58, 0.58, -0.58, 0.58, 2.3, 2.42, roof);
  m.poly([[-0.58, 0.58, 2.42], [0.58, 0.58, 2.42], [0, 0, 2.62]], roof);
  m.poly([[0.58, 0.58, 2.42], [0.58, -0.58, 2.42], [0, 0, 2.62]], roof);
  m.poly([[-0.58, -0.58, 2.42], [-0.58, 0.58, 2.42], [0, 0, 2.62]], roof);
  m.poly([[0.58, -0.58, 2.42], [-0.58, -0.58, 2.42], [0, 0, 2.62]], roof);
  m.dot([0.36, 0.52, 1.2], C.stone_grey[2]); // door handle
  const a = renderProp(m);
  if (broken) {
    for (let i = 0; i < 14; i++) {
      const x = (hash2(i, 1, 41) - 0.3) * 2.2, y = 0.62 + hash2(i, 2, 41) * 0.8;
      const [ix, iy] = P(a, x, y, 0);
      if (a.image.data[(iy * a.image.w + ix) * 4 + 3] === 255) continue;
      px(a.image, ix, iy, i % 3 ? S.glass : C.dirty_snow[2]);
    }
  }
  return a;
}

// ---------------------------------------------------------------- tram stop

/** A tram stop: a post with a white enamel plate showing a tram. */
export function tramStop(): PropArt {
  const m = new Mesh();
  m.cylZ(0, 0, 0.07, 0, 2.6, 8, flat(IRON));
  m.cylZ(0, 0, 0.1, 0, 0.12, 8, flat(IRON));
  const a = renderProp(m, { cell: { w: 30, h: 34, ax: 8, ay: 29 } });
  const im = a.image;
  // plate: 13 x 9 px, white enamel with a dark rim and a tram in profile
  const [cx, top] = P(a, 0, 0, 2.62);
  const x0 = cx - 6, y0 = top - 2;
  rect(im, x0, y0, 13, 9, WHITE);
  hline(im, x0, x0 + 12, y0 + 8, C.cloth[1]);
  for (let i = 0; i < 13; i++) { px(im, x0 + i, y0, S.outline); }
  const tram = ["..#######..", ".#.#.#.#.#.", ".#########.", "..#.....#.."];
  tram.forEach((row, r) => { for (let k = 0; k < row.length; k++) if (row[k] === "#") px(im, x0 + 1 + k, y0 + 2 + r, r === 1 ? C.tram[1] : S.outline); });
  vline(im, x0 + 13, y0 + 1, y0 + 9, S.outline);
  hline(im, x0 + 1, x0 + 13, y0 + 9, S.outline);
  // its shadow on the ground
  for (let x = 0; x < 13; x++) for (let y = 0; y < 2; y++) shadowPx(im, x0 + 11 + x, a.ay + 5 + y);
  return a;
}

// ---------------------------------------------------------------- street sign

/** An enamel street-name plate on an iron post; the variant string is the name. */
export function streetSign(name: string): PropArt {
  const text = name.trim() || "ULICA";
  const mt = measure(text);
  const pw = mt.w + 6, ph = 5 + mt.above + mt.below + 5;
  const m = new Mesh();
  m.cylZ(0, 0, 0.07, 0, 2.2, 8, flat(IRON));
  m.cylZ(0, 0, 0.1, 0, 0.1, 8, flat(IRON));
  const ax = (pw >> 1) + 1, ay = ph + 15;
  const a = renderProp(m, { cell: { w: pw + 12, h: ay + 7, ax, ay } });
  const im = a.image;
  const [cx, topPost] = P(a, 0, 0, 2.2);
  const x0 = cx - (pw >> 1), y0 = topPost - ph + 3;
  rect(im, x0, y0, pw, ph, ENAMEL[1]);
  hline(im, x0, x0 + pw - 1, y0 + ph - 1, ENAMEL[0]);
  vline(im, x0 + pw - 1, y0, y0 + ph - 1, ENAMEL[0]);
  // the white rim, one pixel in
  hline(im, x0 + 1, x0 + pw - 2, y0 + 1, WHITE);
  hline(im, x0 + 1, x0 + pw - 2, y0 + ph - 2, WHITE);
  vline(im, x0 + 1, y0 + 1, y0 + ph - 2, WHITE);
  vline(im, x0 + pw - 2, y0 + 1, y0 + ph - 2, WHITE);
  drawText(im, x0 + 3, y0 + 2 + (mt.above ? 2 : 1), text, WHITE);
  vline(im, x0 + pw, y0 + 1, y0 + ph, S.outline);
  hline(im, x0 + 1, x0 + pw, y0 + ph, S.outline);
  // the plate's shadow: a thin band on the ground, south-east of it
  const dx = Math.round(PROP_SHADOW.kx * 2.4 * 12), dy = Math.round(PROP_SHADOW.ky * 2.2 * 9);
  for (let x = 0; x < pw; x++) shadowPx(im, x0 + dx + x, a.ay + dy);
  return a;
}

// ---------------------------------------------------------------- hydrant, bin

/** An above-ground hydrant of green-painted cast iron, with its cap and two outlets. */
export function hydrant(): PropArt {
  const m = new Mesh();
  const iron: Mat = { ramp: [S.outline, GREEN[0], GREEN[1], GREEN[2]] };
  m.cylZ(0, 0, 0.2, 0, 0.1, 8, iron);
  m.cylZ(0, 0, 0.14, 0.1, 0.9, 8, iron);
  m.cylZ(0, 0, 0.17, 0.74, 0.8, 8, iron);
  m.frustumZ(0, 0, 0.17, 0.06, 0.9, 1.08, 8, iron);
  m.dot([0, 0, 1.14], GREEN[2]);
  m.newPart();
  m.cylX(0, 0.52, 0.07, 0.12, 0.28, 6, iron);
  m.cylX(0, 0.52, 0.07, -0.28, -0.12, 6, iron);
  return renderProp(m);
}

export function bin(): PropArt {
  const m = new Mesh();
  const galv = C.stone_grey;
  const body: Mat = {
    ramp: galv,
    tex: (h) => {
      if (Math.abs(h.z - 0.22) < 0.03 || Math.abs(h.z - 0.52) < 0.03) return toneOf(galv, h.t + 1);
      const a = Math.atan2(h.y, h.x) / (Math.PI / 8);
      return a - Math.floor(a) < 0.25 ? toneOf(galv, h.t - 1) : undefined;
    },
  };
  m.cylZ(0, 0, 0.26, 0, 0.72, 12, body, null);
  m.newPart();
  m.frustumZ(0, 0, 0.29, 0.2, 0.72, 0.82, 12, flat(galv));
  m.box(-0.08, 0.08, -0.02, 0.02, 0.82, 0.88, flat(IRON));
  return renderProp(m);
}

