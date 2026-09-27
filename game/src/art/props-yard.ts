// Props of yards, checkpoints and the ghetto edge: the sandbag guard post, the Spanish rider and
// the striped boom, fuel drums, crates, a hand cart, a courtyard gate leaf, the ghetto wall (a
// 2 m tile, east-west or north-south), dirty snow heaps and bare late-winter trees.
import type { PropArt, PropState } from "./types";
import { type RGB, type Ramp } from "./palette";
import { hash2, img, px, rng, vline, type PixelImage } from "./pixel";
import { Mesh, render, toneOf, type Mat, type Prof } from "./vehicles-3d";
import { vnoise } from "./fx-noise";
import { C, S, F, IRON, CHAR, EMBER, GREY, RUST, PROP_SHADOW, flat, line3, mat, mound, P, renderProp, shadowPx } from "./props-kit";

const BAG: Ramp = F.sandbag;
const BARK: Ramp = [S.outline, C.bark[0], C.bark[1]];

// ---------------------------------------------------------------- sandbags

/** A sandbag's rounded section, w wide and h high, sitting on the ground at (0, 0). */
function bagProf(w: number, h: number): Prof {
  const a = w / 2, e = 0.04;
  return [[-a, e], [-a + e, 0], [a - e, 0], [a, e], [a, h - e * 1.4], [a - e * 1.2, h], [-a + e * 1.2, h], [-a, h - e * 1.4]];
}

/** Sandbag tones, dark to light: the shaded belly, the side, the lit shoulder, the sunlit top. */
const SB: Ramp = [F.bank[1], F.sandbag[0], F.sandbag[1], F.sandbag[2]];

/** A bag seen from the south: w x 3 px, rounded ends, lit shoulder over a dark belly. */
function bagFront(im: PixelImage, x: number, y: number, w: number, seed: number): void {
  for (let i = 0; i < w; i++) {
    const end = i === 0 || i === w - 1;
    if (!end) px(im, x + i, y, SB[2]);
    px(im, x + i, y + 1, end ? SB[1] : hash2(x + i, y, seed) < 0.12 ? SB[2] : SB[1]);
    if (!end) px(im, x + i, y + 2, SB[0]);
  }
  px(im, x + 1, y + 1, SB[2]);
}

/** A bag seen from above: w x h px with rounded corners, lit to the north-west. */
function bagTop(im: PixelImage, x: number, y: number, w: number, h: number): void {
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      if ((i === 0 || i === w - 1) && (j === 0 || j === h - 1)) continue;
      const c = i === w - 1 || j === h - 1 ? SB[1] : i === 0 || j === 0 ? SB[3] : SB[2];
      px(im, x + i, y + j, c);
    }
  }
}

/** The guard post: a U of sandbags three courses high, open to the north, a loophole in the front. */
export function sandbags(): PropArt {
  const W = 50, H = 34, ax = 22, ay = 21;
  const im = img(W, H);
  const yb = ay + 8; // the front wall's foot (0.85 m south of the anchor)
  // the side walls, seen from above: two bags each, running north
  for (const x0 of [ax - 20, ax + 15]) {
    for (let k = 0; k < 2; k++) bagTop(im, x0, ay - 16 + k * 6, 6, 7);
  }
  // the front wall: three courses in running bond, the top course seen from above too
  for (let c = 0; c < 3; c++) {
    const y = yb - 3 * c - 2;
    const off = c % 2 ? 4 : 0;
    for (let x = ax - 20 - off; x < ax + 21; x += 8) {
      if (c === 2 && x > ax - 5 && x < ax + 4) continue; // loophole
      const x0 = Math.max(ax - 20, x), x1 = Math.min(ax + 21, x + 8);
      if (x1 - x0 >= 3) bagFront(im, x0, y, x1 - x0, 3);
    }
  }
  for (let x = ax - 20; x < ax + 21; x += 8) {
    if (x > ax - 5 && x < ax + 4) continue;
    bagTop(im, x, yb - 12, Math.min(8, ax + 21 - x), 4);
  }
  // the loophole: the dark gap in the top course, the bag behind showing through
  for (let x = ax - 4; x < ax + 4; x++) for (let y = yb - 11; y < yb - 5; y++) if (!im.data[(y * W + x) * 4 + 3]) px(im, x, y, y < yb - 9 ? SB[0] : S.outline);
  // seams and the outline, bottom and right
  const d = im.data, mark: number[] = [];
  for (let y = 1; y < H; y++) for (let x = 1; x < W; x++) {
    const i = (y * W + x) * 4;
    if (d[i + 3]) continue;
    if (d[i - 4 + 3] === 255 || d[i - W * 4 + 3] === 255) mark.push(x, y);
  }
  for (let i = 0; i < mark.length; i += 2) px(im, mark[i], mark[i + 1], S.outline);
  // the cast shadow to the south-east
  for (let y = yb + 2; y < yb + 6; y++) for (let x = ax - 18 + (y - yb); x < ax + 25; x++) shadowPx(im, x, y);
  for (let y = ay - 14; y < yb + 2; y++) for (let x = ax + 22; x < ax + 26; x++) shadowPx(im, x, y);
  return { image: im, ax, ay };
}

// ---------------------------------------------------------------- barriers

/** Variant 0: a Spanish rider (kozioł) wrapped in barbed wire. Variant 1: a striped boom on posts. */
export function barrier(variant: number): PropArt {
  const m = new Mesh();
  const wood = flat(C.wood);
  if (variant === 1) {
    for (const x of [-2.0, 2.0]) {
      m.newPart();
      m.box(x - 0.1, x + 0.1, -0.1, 0.1, 0, 1.15, flat([F.trunk[0], F.trunk[1], C.wood[0], C.wood[1]]));
    }
    m.newPart();
    const stripes: Mat = { ramp: IRON, tex: (h) => (Math.floor((h.x + 3) / 0.36) % 2 ? toneOf([C.cloth[1], C.cloth[2], S.chalk], h.t) : toneOf(IRON, h.t)) };
    m.rod([-2.25, 0, 1.0], [2.25, 0, 1.0], 0.065, 6, stripes);
    return renderProp(m);
  }
  m.rod([-1.3, 0, 0.62], [1.3, 0, 0.62], 0.06, 6, wood);
  for (const x of [-1.1, 0, 1.1]) {
    // each stake its own part, so it casts its own shadow
    m.newPart();
    m.rod([x, -0.62, 0.03], [x, 0.62, 1.24], 0.05, 6, wood);
    m.newPart();
    m.rod([x, 0.62, 0.03], [x, -0.62, 1.24], 0.05, 6, wood);
  }
  const a = renderProp(m);
  // barbed wire: loose coils along the frame, with barbs
  const wire = C.soot[1], barb = C.stone_grey[1];
  let prev: [number, number, number] | null = null;
  for (let i = 0; i <= 90; i++) {
    const x = -1.3 + (2.6 * i) / 90, th = x * 7.5;
    const p: [number, number, number] = [x, Math.cos(th) * 0.5, 0.62 + Math.sin(th) * 0.5];
    if (prev) line3(a.image, a, prev, p, wire);
    if (i % 6 === 3) { const [bx, by] = P(a, p[0], p[1], p[2]); px(a.image, bx, by - 1, barb); }
    prev = p;
  }
  return a;
}

// ---------------------------------------------------------------- barrel

/** A 200-litre fuel drum in German grey; burning its top glows, destroyed it lies burst and black. */
export function barrel(st: PropState): PropArt {
  const m = new Mesh();
  const seed = 5;
  if (st === "destroyed") {
    const mk = m.mark();
    const burnt = mat(GREY, "destroyed", seed);
    m.cylX(0, 0.29, 0.29, -0.44, 0.44, 12, burnt, flat(CHAR), { ramp: CHAR, tex: (h) => (Math.hypot(h.y, h.z - 0.29) < 0.2 ? S.glass_dark : undefined) });
    m.rotZ(mk, 0, 0, 0.45);
    const a = renderProp(m);
    // a black stain of spilt fuel around it
    for (let i = 0; i < 90; i++) {
      const t = hash2(i, 0, 91) * Math.PI * 2, rr = 0.55 + hash2(i, 1, 91) * 0.35;
      const [x, y] = P(a, Math.cos(t) * rr, Math.sin(t) * rr * 0.9, 0);
      if (a.image.data[(y * a.image.w + x) * 4 + 3] !== 255) px(a.image, x, y, i % 3 ? CHAR[1] : C.puddle[0]);
    }
    return a;
  }
  const body = mat(GREY, st, seed, (h) => {
    const hoop = Math.abs(h.z - 0.3) < 0.035 || Math.abs(h.z - 0.6) < 0.035;
    if (hoop) return 1;
    if (Math.abs(h.z - 0.27) < 0.02 || Math.abs(h.z - 0.57) < 0.02) return -1;
    if (st === "intact" && h.z < 0.25 && vnoise(h.x * 9, h.y * 9, h.z * 6, seed) > 0.62) return toneOf(RUST, h.t);
    return undefined;
  }, 0.9);
  const lid: Mat = {
    ramp: GREY,
    tex: (h) => {
      const r = Math.hypot(h.x, h.y);
      if (st === "burning") return r > 0.25 ? toneOf(CHAR, h.t) : hash2(h.px, h.py, 2) < 0.4 ? S.fire[1] : S.fire[0];
      if (r > 0.25) return toneOf(GREY, 2);
      if (Math.hypot(h.x - 0.12, h.y + 0.08) < 0.05) return IRON[1];
      return undefined;
    },
  };
  m.cylZ(0, 0, 0.29, 0, 0.88, 12, body, lid);
  return renderProp(m);
}

// ---------------------------------------------------------------- crates

function crateMat(st: PropState, seed: number): Mat {
  return mat(C.wood, st, seed, (h) => {
    const side = Math.abs(h.ny) > 0.9 || Math.abs(h.nx) > 0.9;
    if (side) {
      if (((h.z + 0.02) / 0.15) % 1 < 0.2) return -1; // plank seams
      if (hash2(h.px, h.py, seed) < 0.03) return S.outline; // nails
    } else if (((h.y + 2) / 0.15) % 1 < 0.2) return -1;
    return undefined;
  }, 1.1);
}

/** A stack of three wooden crates; destroyed they are smashed and scattered. */
export function crates(st: PropState): PropArt {
  const m = new Mesh();
  if (st === "destroyed") {
    m.box(-0.95, -0.05, -0.3, 0.3, 0, 0.3, mat(C.wood, "destroyed", 3));
    const planks: [number, number, number][] = [[0.4, 0.2, 0.3], [0.7, -0.35, -0.5], [-0.3, 0.7, 1.2], [1.1, 0.5, 0.1], [0.2, -0.6, 2.2]];
    for (const [x, y, a] of planks) {
      m.newPart();
      const mk = m.mark();
      m.box(-0.45, 0.45, -0.06, 0.06, 0, 0.03, crateMat("destroyed", 4));
      m.rotZ(mk, 0, 0, a);
      m.move(mk, [x, y, 0]);
    }
    return renderProp(m);
  }
  m.newPart();
  m.box(-0.95, -0.05, -0.3, 0.3, 0, 0.6, crateMat(st, 1));
  m.newPart();
  m.box(0.05, 0.85, -0.25, 0.35, 0, 0.55, crateMat(st, 2));
  m.newPart();
  m.box(-0.7, 0.2, -0.28, 0.24, 0.6, 1.08, crateMat(st, 3));
  const a = renderProp(m);
  if (st === "intact") {
    // a stencilled mark on the big crate
    const [x, y] = P(a, -0.75, 0.3, 0.42);
    for (const [dx, dy] of [[0, 0], [1, 0], [2, 0], [4, 0], [5, 0], [0, 1], [2, 1], [5, 1], [0, 2], [1, 2], [2, 2], [4, 2], [5, 2]]) px(a.image, x + dx, y + dy, S.outline);
  }
  return a;
}

// ---------------------------------------------------------------- cart

/** A two-wheeled hand cart resting on its handles, with two sacks aboard. */
export function cart(): PropArt {
  const m = new Mesh();
  const wood = flat(C.wood);
  // wheels with spokes
  for (const y0 of [0.5, -0.56]) {
    m.newPart();
    const cap: Mat = {
      ramp: C.wood,
      tex: (h) => {
        const dx = h.x, dz = h.z - 0.42, r = Math.hypot(dx, dz);
        if (r > 0.36) return toneOf(IRON, h.t);
        if (r < 0.07) return toneOf(IRON, h.t + 1);
        const a = Math.atan2(dz, dx) / (Math.PI / 4);
        return a - Math.floor(a) < 0.3 ? toneOf(C.wood, h.t) : S.glass_dark;
      },
    };
    m.cylY(0, 0.42, 0.42, y0, y0 + 0.06, 14, flat(IRON), cap);
  }
  m.newPart();
  const sides = mat(C.wood, "intact", 0, (h) => (Math.abs(h.ny) > 0.9 && Math.abs(h.z - 0.72) < 0.03 ? -1 : undefined));
  m.box(-0.75, 0.75, -0.46, 0.46, 0.5, 0.58, wood);
  m.box(-0.75, 0.75, 0.42, 0.46, 0.58, 0.86, sides);
  m.box(-0.75, 0.75, -0.46, -0.42, 0.58, 0.86, sides);
  m.box(-0.75, -0.71, -0.42, 0.42, 0.58, 0.86, sides);
  m.newPart();
  for (const y of [0.3, -0.3]) {
    m.seg([0.7, y, 0.56], [1.95, y, 0.1], C.wood[1], 0.01);
    m.seg([0.7, y, 0.5], [1.95, y, 0.04], C.wood[0], 0.01);
  }
  // two sacks
  for (const [x, y] of [[-0.35, -0.1], [0.3, 0.12]]) {
    m.newPart();
    const mk = m.mark();
    m.prismX(bagProf(0.42, 0.34), -0.28, 0.28, { ramp: BAG });
    m.rotZ(mk, 0, 0, 1.2 + x);
    m.move(mk, [x, y, 0.58]);
  }
  return renderProp(m);
}

// ---------------------------------------------------------------- gate

/** A courtyard gate leaf of boards with a wicket and strap hinges; variant 1 stands half open. */
export function gate(variant: number): PropArt {
  const m = new Mesh();
  const leaf = mat(C.wood, "intact", 0, (h) => {
    if (Math.abs(h.ny) < 0.9) return undefined;
    const u = h.x + 0.75;
    if ((Math.abs(h.z - 0.55) < 0.05 || Math.abs(h.z - 2.45) < 0.05) && u < 0.62) return IRON[1]; // strap hinges
    if (Math.abs(u - 0.38) < 0.03 || Math.abs(u - 1.12) < 0.03 || (Math.abs(h.z - 1.95) < 0.03 && u > 0.38 && u < 1.12)) return -1; // the wicket
    if (Math.abs(h.z - 1.0) < 0.03 && Math.abs(u - 1.02) < 0.04) return IRON[2]; // latch
    return (u / 0.15) % 1 < 0.18 ? -1 : undefined;
  });
  m.box(-0.75, 0.75, -0.04, 0.04, 0, 3.0, leaf);
  if (variant === 1) m.rotZ({ f: 0, s: 0, d: 0 }, -0.75, 0, -1.0);
  return renderProp(m);
}

// ---------------------------------------------------------------- ghetto wall

const WALL_H = 3.0, WALL_T = 0.2;

/** Brick courses by screen pixel: 2 px brick over 1 px joint, 6 px bricks in running bond. */
function brickAt(u: number, v: number, t: number, seed: number): RGB {
  const course = Math.floor(v / 3);
  if (v % 3 === 0) return C.mortar;
  const uu = u + (course % 2 ? 3 : 0);
  if (((uu % 6) + 6) % 6 === 0) return C.mortar;
  const b = Math.floor(uu / 6);
  const k = hash2(b, course, seed);
  const shift = k < 0.18 ? -1 : k > 0.94 ? 1 : 0;
  return toneOf(C.brick, t + shift);
}

/**
 * The ghetto wall: brick, 3 m high, barbed wire on posts along the top. "ew" (default): a 2 m
 * segment running east-west, 24 px wide, that tiles side by side; "ns": a 2 m segment running
 * north-south (18 px of wall top), that tiles vertically when drawn north to south.
 */
export function ghettoWall(variant: string): PropArt {
  const ns = variant.startsWith("ns");
  const seed = Number(variant.replace(/\D/g, "")) || 1;
  const m = new Mesh();
  const cell = ns ? { w: 22, h: 52, ax: 4, ay: 42 } : { w: 24, h: 38, ax: 12, ay: 29 };
  const face: Mat = {
    ramp: C.brick,
    tex: (h) => {
      const u = h.px - cell.ax, v = cell.ay + 1 - h.py;
      if (h.nz > 0.9) {
        // the coping: bricks laid across, the front edge in shadow
        const w = ns ? h.py : h.px;
        return w % 3 === 0 ? C.mortar : toneOf(C.brick, 2 + (hash2(w, 7, seed) < 0.2 ? -1 : 0));
      }
      let c = brickAt(u, v, h.t, seed);
      // rain streaks under the coping
      if (v > 17 && hash2(u, 99, seed) < 0.25) c = toneOf(C.brick, h.t - 1);
      return c;
    },
  };
  if (ns) m.box(-WALL_T, WALL_T, -1, 1, 0, WALL_H, face);
  else m.box(-1, 1, -WALL_T, WALL_T, 0, WALL_H, face);
  const r = render(m, { yaw: 0, cell, outline: "none", shadow: null });
  const im = r.image;
  const a: PropArt = { image: im, ax: r.ax, ay: r.ay };
  const wire = C.soot[1], glint = C.stone_grey[1], post = IRON[1];
  if (!ns) {
    // shadow band and the ground line, full width so tiles join
    for (let x = 0; x < cell.w; x++) {
      px(im, x, cell.ay + 2, S.outline);
      for (let y = 3; y < 8; y++) shadowPx(im, x, cell.ay + y);
    }
    // posts every metre, three strands, barbs every 4 px
    const zTop = cell.ay - Math.round(WALL_H * 7.5);
    for (const x of [cell.ax - 6, cell.ax + 6]) vline(im, x, zTop - 7, zTop - 1, post);
    for (const dz of [2, 4, 6]) {
      const y = zTop - dz;
      for (let x = 0; x < cell.w; x++) px(im, x, y, wire);
      for (let x = (dz * 3) % 4; x < cell.w; x += 4) px(im, x, y + (x % 8 < 4 ? -1 : 1), glint);
    }
  } else {
    // the shadow strip east of the wall: exactly this segment's 18 rows (moved south by the light),
    // so segments stacked 18 px apart join without doubling; and the ground line under the south face
    const x1 = cell.ax + 3;
    for (let y = cell.ay - 9 + 4; y < cell.ay + 9 + 4; y++) for (let x = x1; x < x1 + 11; x++) shadowPx(im, x, y);
    for (let x = cell.ax - 3; x < cell.ax + 3; x++) px(im, x, cell.ay + 10, S.outline);
    vline(im, cell.ax + 3, 0, cell.ay + 9, S.outline);
    const top = cell.ay - Math.round(WALL_H * 7.5) - 9;
    for (const y of [top + 4, top + 13]) vline(im, cell.ax, y - 7, y, post);
    for (let y = top - 7; y < top + 18; y++) {
      px(im, cell.ax, y, wire);
      if (y % 4 === 0) px(im, cell.ax + (y % 8 ? -1 : 1), y, glint);
    }
  }
  return a;
}

// ---------------------------------------------------------------- snow heap

/** A heap of dirty late-winter snow shovelled off the pavement; the variant seeds its shape. */
export function snowHeap(seed: number): PropArt {
  const r = rng(seed * 31 + 7);
  const rx = 0.75 + r() * 0.35, ry = 0.45 + r() * 0.2, H = 0.55 + r() * 0.3;
  // two or three shovelled lumps make the heap
  const lumps = Array.from({ length: 2 + (seed % 2) }, (_, i) => ({ x: (i === 0 ? -0.2 : 0.35 - i * 0.2) * rx + (r() - 0.5) * 0.2, y: (r() - 0.5) * 0.3 * ry, s: 0.55 + r() * 0.35 }));
  const W = Math.ceil(rx * 24) + 8, Hh = Math.ceil(ry * 18 + H * 7.5) + 10;
  const im = img(W, Hh);
  const ax = W >> 1, ay = Math.ceil(ry * 9) + Math.ceil(H * 7.5) + 3;
  // melt water around the foot
  for (let y = -ry * 1.2; y <= ry * 1.2; y += 1 / 18) {
    for (let x = -rx * 1.15; x <= rx * 1.15; x += 1 / 24) {
      const d = (x / (rx * 1.12)) ** 2 + (y / (ry * 1.18)) ** 2;
      if (d < 1 && d > 0.72) px(im, Math.floor(ax + x * 12), Math.floor(ay + y * 9), d > 0.9 ? C.puddle[0] : C.puddle[1]);
    }
  }
  const height = (x: number, y: number) => {
    const d = 1 - (x / rx) ** 2 - (y / ry) ** 2;
    if (d <= 0) return 0;
    let h = 0;
    for (const l of lumps) {
      const e = 1 - ((x - l.x) / (rx * 0.62)) ** 2 - ((y - l.y) / (ry * 0.8)) ** 2;
      if (e > 0) h = Math.max(h, l.s * Math.sqrt(e));
    }
    return H * Math.min(1, Math.pow(d, 0.5) * 0.45 + h * 0.75) * (0.82 + vnoise(x * 4 + seed, y * 4, 0, seed) * 0.36);
  };
  // old snow: a whiter crust on top, greyer and gritty low down where the street splashed it
  const CRUST: Ramp = [C.slush[1], C.dirty_snow[0], C.dirty_snow[1], C.dirty_snow[2]];
  const GRIME: Ramp = [C.slush[0], C.slush[1], C.slush[2], C.dirty_snow[0]];
  mound(im, ax, ay, -rx, rx, -ry, ry, height, (t, x, y, z, sx, sy) => {
    const grit = hash2(sx, sy, seed);
    const low = z < H * 0.35;
    if (grit < (low ? 0.12 : 0.05)) return low ? C.slush[0] : C.slush[1];
    if (grit < (low ? 0.16 : 0.07)) return C.soot[1];
    if (grit < 0.08 && !low) return F.dirt[1];
    const dirty = vnoise(x * 5, y * 5, z * 5, seed + 2) > 0.64;
    return toneOf(low ? GRIME : CRUST, t - (dirty ? 1 : 0));
  });
  // no outline: the wet foot and the grime give the edge, as snow has no hard rim
  return { image: im, ax, ay };
}

// ---------------------------------------------------------------- tree

/** A bare late-winter street tree: a dark trunk, forking limbs and a haze of spindly twigs. */
export function tree(seed: number): PropArt {
  const W = 66, H = 86, ax = 33, ay = 80;
  const im = img(W, H);
  const r = rng(seed * 7919 + 13);
  const put = (x: number, y: number, c: RGB) => px(im, Math.round(x), Math.round(y), c);
  const seg = (x0: number, y0: number, x1: number, y1: number, thick: number, depth: number) => {
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
    for (let i = 0; i <= n; i++) {
      const x = x0 + ((x1 - x0) * i) / n, y = y0 + ((y1 - y0) * i) / n;
      if (thick >= 2) {
        put(x - 1, y, C.bark[1]);
        put(x, y, C.bark[0]);
        if (thick >= 3) put(x + 1, y, S.outline);
      } else put(x, y, depth > 2 ? C.bark[0] : depth > 0 ? C.bark[1] : C.soot[2]);
    }
  };
  const branch = (x: number, y: number, ang: number, len: number, thick: number, depth: number) => {
    // a limb bends a little as it grows
    const bend = (r() - 0.5) * 0.3;
    const xm = x + Math.cos(ang) * len * 0.5, ym = y + Math.sin(ang) * len * 0.5;
    const x2 = xm + Math.cos(ang + bend) * len * 0.5, y2 = ym + Math.sin(ang + bend) * len * 0.5;
    seg(x, y, xm, ym, thick, depth);
    seg(xm, ym, x2, y2, thick > 1 && depth > 2 ? thick - 1 : thick, depth);
    if (depth === 0) return;
    const kids = depth > 2 ? 2 : 2 + (r() < 0.5 ? 1 : 0);
    for (let k = 0; k < kids; k++) {
      const spread = 0.28 + r() * 0.42;
      const a2 = ang + (k - (kids - 1) / 2) * spread * 1.4 + (r() - 0.5) * 0.2;
      // limbs lean away from straight down; keep the crown up
      const aa = Math.max(-Math.PI + 0.25, Math.min(-0.25, a2));
      branch(x2, y2, aa, len * (0.68 + r() * 0.12), Math.max(1, thick - (depth % 2)), depth - 1);
    }
  };
  // three shapes of street tree: a broad lime, a low wide chestnut, a tall narrow poplar
  const kind = ((seed % 3) + 3) % 3;
  const shape = [
    { fork: 15, limbs: 3, spread: 0.6, len: 14 },
    { fork: 11, limbs: 4, spread: 0.52, len: 13 },
    { fork: 19, limbs: 3, spread: 0.3, len: 15 },
  ][kind];
  const lean = (r() - 0.5) * 0.12;
  // shadow at the foot, a little to the south-east
  for (let i = -3; i < 12; i++) for (let j = 0; j < 3; j++) shadowPx(im, ax + i, ay + j);
  // trunk
  const fork = shape.fork + Math.floor(r() * 4);
  let tx = ax;
  for (let y = 0; y <= fork; y++) {
    tx = ax + Math.round(lean * y);
    const w = y < 2 ? 5 : y < fork - 4 ? 4 : 3;
    const x0 = tx - (w >> 1);
    for (let k = 0; k < w; k++) {
      const c = k === 0 ? C.bark[1] : k === w - 1 ? S.outline : k === 1 && y % 5 === 2 ? C.bark[1] : C.bark[0];
      px(im, x0 + k, ay - y, c);
    }
  }
  px(im, ax - 3, ay, S.outline);
  px(im, ax + 3, ay, S.outline);
  for (let k = 0; k < shape.limbs; k++) {
    const mid = (shape.limbs - 1) / 2;
    const ang = -Math.PI / 2 + lean + (k - mid) * (shape.spread + r() * 0.2) + (r() - 0.5) * 0.15;
    branch(tx + Math.round(k - mid), ay - fork, ang, shape.len + r() * 4 - (Math.abs(k - mid) > 1 ? 2 : 0), 3, 5);
  }
  // a crust of old snow at the foot
  for (const [dx, c] of [[-3, C.dirty_snow[1]], [-2, C.dirty_snow[2]], [3, C.dirty_snow[1]], [4, C.dirty_snow[0]]] as [number, RGB][]) px(im, ax + dx, ay, c);
  return { image: im, ax, ay };
}

export { BARK, EMBER, PROP_SHADOW, render };
export type { PixelImage };
