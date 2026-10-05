// A tiny flat-shaded 3D renderer for vehicles and boxy props, drawn as pixel art at 1x.
//
// Models are a handful of primitives in metres: boxes, extruded profiles, cylinders, 1 px lines
// and dots. Local axes: x forward (east for a prop), y to the right (south), z up. A yaw turns
// the model about the vertical axis; the game's projection (style guide §2) maps a point to
// sx = 12x, sy = 9y - 7.5z. A z-buffer keeps the nearest surface per pixel, each surface takes a
// stepped tone from its palette ramp by its normal against the top-left light (§4), and then the
// silhouette and the edges where one part stands in front of another get the outline colour.
// Pure functions of their inputs: no Math.random, no DOM.
import { PAL, type RGB, type Ramp } from "./palette";
import { img, type PixelImage } from "./pixel";

export type V3 = [number, number, number];
export type Prof = [number, number][];

/** A sprite cell: size and the anchor (the model's origin on the ground). */
export interface Cell {
  w: number;
  h: number;
  ax: number;
  ay: number;
}

/** Screen pixels per metre (style guide §2). */
export const PX_X = 12;
export const PX_Y = 9;
export const PX_Z = 7.5;
const KY = PX_Z / PX_Y;

/** Toward the light: from the north-west and above. */
const LX = -0.45, LY = -0.35, LZ = 0.82;

/** Stepped light tone of a world normal: 3 lit top, 2 west-facing, 1 facing the viewer, 0 east-facing. */
export function lightTone(nx: number, ny: number, nz: number): number {
  const i = nx * LX + ny * LY + nz * LZ;
  return i > 0.62 ? 3 : i > 0.12 ? 2 : i > -0.4 ? 1 : 0;
}

/** The colour of tone 0 (dark) .. 3 (lit) in a ramp of any length. */
export function toneOf(r: Ramp, t: number): RGB {
  const n = r.length;
  const k = t < 0 ? 0 : t > 3 ? 3 : t | 0;
  if (n >= 4) return r[k];
  if (n === 3) return r[k === 3 ? 2 : k];
  if (n === 2) return r[k >= 2 ? 1 : 0];
  return r[0];
}

/** What a texture learns about the pixel it paints. */
export interface Hit {
  /** Surface point in local model coordinates (metres). */
  x: number;
  y: number;
  z: number;
  /** Local normal of the surface. */
  nx: number;
  ny: number;
  nz: number;
  /** Stepped light tone 0..3 (after the material's shift). */
  t: number;
  /** Pixel in the output image. */
  px: number;
  py: number;
}
/** Returns a colour, undefined for the material's plain tone, or null for a hole. */
export type Tex = (h: Hit) => RGB | null | undefined;

export interface Mat {
  ramp: Ramp;
  tex?: Tex;
  /** Per-pixel local normal for round solids (cylinders), written into `out`, instead of the flat face normal. */
  smooth?: (x: number, y: number, z: number, out: V3) => void;
  /** Added to the light tone (-1 darkens a recess). */
  shift?: number;
  /** Always this tone, whatever the light. */
  fixed?: number;
}

interface Face { p: V3[]; n: V3; m: Mat; part: number; bias: number }
interface Seg { a: V3; b: V3; c: RGB; part: number; bias: number }
interface Dot { p: V3; c: RGB; part: number; bias: number }
export interface Mark { f: number; s: number; d: number }

export interface BoxMats {
  top?: Mat | null;
  bottom?: Mat | null;
  /** +x (front / east), -x (back / west), +y (right / south), -y (left / north). */
  px?: Mat | null;
  nx?: Mat | null;
  py?: Mat | null;
  ny?: Mat | null;
  /** Default for the four sides. */
  side?: Mat | null;
}

function isMat(m: Mat | BoxMats): m is Mat {
  return (m as Mat).ramp !== undefined;
}

function newell(p: V3[]): V3 {
  let x = 0, y = 0, z = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length];
    x += (a[1] - b[1]) * (a[2] + b[2]);
    y += (a[2] - b[2]) * (a[0] + b[0]);
    z += (a[0] - b[0]) * (a[1] + b[1]);
  }
  const l = Math.sqrt(x * x + y * y + z * z) || 1;
  return [x / l, y / l, z / l];
}

function area2(p: Prof): number {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const [u0, v0] = p[i], [u1, v1] = p[(i + 1) % p.length];
    a += u0 * v1 - u1 * v0;
  }
  return a;
}

/** Profile of a regular polygon (a round section). */
export function circle(cu: number, cv: number, r: number, n: number, rot = 0): Prof {
  const out: Prof = [];
  for (let i = 0; i < n; i++) {
    const a = rot + ((i + 0.5) / n) * Math.PI * 2;
    out.push([cu + Math.cos(a) * r, cv + Math.sin(a) * r]);
  }
  return out;
}

export class Mesh {
  faces: Face[] = [];
  segs: Seg[] = [];
  dots: Dot[] = [];
  /** Current part: edges are outlined only between different parts. */
  part = 0;
  /** Depth bias (metres toward the viewer) for new primitives: decals sit on their surface. */
  bias = 0;

  newPart(): number {
    return ++this.part;
  }

  mark(): Mark {
    return { f: this.faces.length, s: this.segs.length, d: this.dots.length };
  }

  poly(p: V3[], m: Mat | null | undefined, n?: V3): void {
    if (!m || p.length < 3) return;
    this.faces.push({ p, n: n ?? newell(p), m, part: this.part, bias: this.bias });
  }

  seg(a: V3, b: V3, c: RGB, bias = 0.04): void {
    this.segs.push({ a, b, c, part: this.part, bias: this.bias + bias });
  }

  dot(p: V3, c: RGB, bias = 0.04): void {
    this.dots.push({ p, c, part: this.part, bias: this.bias + bias });
  }

  box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, mats: Mat | BoxMats): void {
    const all = isMat(mats) ? mats : null;
    const b = isMat(mats) ? ({} as BoxMats) : mats;
    const side = all ?? b.side;
    const pick = (m: Mat | null | undefined) => (all ? all : m === undefined ? side : m);
    this.poly([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], all ?? b.top, [0, 0, 1]);
    this.poly([[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]], all ?? b.bottom, [0, 0, -1]);
    this.poly([[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]], pick(b.px), [1, 0, 0]);
    this.poly([[x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1]], pick(b.nx), [-1, 0, 0]);
    this.poly([[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], pick(b.py), [0, 1, 0]);
    this.poly([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], pick(b.ny), [0, -1, 0]);
  }

  /** Extrude a 2D profile along an axis (0 x, 1 y, 2 z) from a0 to a1. Profile coords (u, v) are
   *  (y, z) for x, (x, z) for y and (x, y) for z. */
  extrude(prof: Prof, axis: 0 | 1 | 2, a0: number, a1: number, side: Mat | null, cap0?: Mat | null, cap1?: Mat | null): void {
    const P = (u: number, v: number, w: number): V3 => (axis === 0 ? [w, u, v] : axis === 1 ? [u, w, v] : [u, v, w]);
    const N = (nu: number, nv: number): V3 => (axis === 0 ? [0, nu, nv] : axis === 1 ? [nu, 0, nv] : [nu, nv, 0]);
    const sgn = area2(prof) >= 0 ? 1 : -1;
    const n = prof.length;
    for (let i = 0; i < n; i++) {
      const [u0, v0] = prof[i], [u1, v1] = prof[(i + 1) % n];
      const du = u1 - u0, dv = v1 - v0;
      const l = Math.sqrt(du * du + dv * dv);
      if (l < 1e-9) continue;
      this.poly([P(u0, v0, a0), P(u1, v1, a0), P(u1, v1, a1), P(u0, v0, a1)], side, N((sgn * dv) / l, (-sgn * du) / l));
    }
    const c0 = cap0 === undefined ? side : cap0;
    const c1 = cap1 === undefined ? c0 : cap1;
    const ax: V3 = axis === 0 ? [1, 0, 0] : axis === 1 ? [0, 1, 0] : [0, 0, 1];
    this.poly(prof.map(([u, v]) => P(u, v, a0)), c0, [-ax[0], -ax[1], -ax[2]]);
    this.poly(prof.map(([u, v]) => P(u, v, a1)), c1, ax);
  }

  prismX(prof: Prof, x0: number, x1: number, side: Mat | null, cap0?: Mat | null, cap1?: Mat | null): void {
    this.extrude(prof, 0, x0, x1, side, cap0, cap1);
  }
  prismY(prof: Prof, y0: number, y1: number, side: Mat | null, cap0?: Mat | null, cap1?: Mat | null): void {
    this.extrude(prof, 1, y0, y1, side, cap0, cap1);
  }
  prismZ(prof: Prof, z0: number, z1: number, side: Mat | null, bottom?: Mat | null, top?: Mat | null): void {
    this.extrude(prof, 2, z0, z1, side, bottom, top);
  }

  /** Upright cylinder, smooth-shaded. */
  cylZ(cx: number, cy: number, r: number, z0: number, z1: number, n: number, side: Mat, top?: Mat | null, bottom?: Mat | null): void {
    const sm: Mat = { ...side, smooth: (x, y, _z, o) => { const dx = x - cx, dy = y - cy, l = Math.sqrt(dx * dx + dy * dy) || 1; o[0] = dx / l; o[1] = dy / l; o[2] = 0; } };
    this.extrude(circle(cx, cy, r, n), 2, z0, z1, sm, bottom === undefined ? null : bottom, top === undefined ? side : top);
  }

  /** Cylinder along y (a wheel on a vehicle heading +x), smooth-shaded. */
  cylY(cx: number, cz: number, r: number, y0: number, y1: number, n: number, side: Mat, cap?: Mat | null, cap1?: Mat | null): void {
    const sm: Mat = { ...side, smooth: (x, _y, z, o) => { const dx = x - cx, dz = z - cz, l = Math.sqrt(dx * dx + dz * dz) || 1; o[0] = dx / l; o[1] = 0; o[2] = dz / l; } };
    this.extrude(circle(cx, cz, r, n), 1, y0, y1, sm, cap === undefined ? side : cap, cap1);
  }

  /** Cylinder along x, smooth-shaded. */
  cylX(cy: number, cz: number, r: number, x0: number, x1: number, n: number, side: Mat, cap?: Mat | null, cap1?: Mat | null): void {
    const sm: Mat = { ...side, smooth: (_x, y, z, o) => { const dy = y - cy, dz = z - cz, l = Math.sqrt(dy * dy + dz * dz) || 1; o[0] = 0; o[1] = dy / l; o[2] = dz / l; } };
    this.extrude(circle(cy, cz, r, n), 0, x0, x1, sm, cap === undefined ? side : cap, cap1);
  }

  /** Upright truncated cone (r0 at z0, r1 at z1), smooth-shaded. */
  frustumZ(cx: number, cy: number, r0: number, r1: number, z0: number, z1: number, n: number, side: Mat, top?: Mat | null): void {
    const slope = (r0 - r1) / (z1 - z0);
    const k = 1 / Math.sqrt(1 + slope * slope);
    const sm: Mat = {
      ...side,
      smooth: (x, y, _z, o) => {
        const dx = x - cx, dy = y - cy, l = Math.sqrt(dx * dx + dy * dy) || 1;
        o[0] = (dx / l) * k; o[1] = (dy / l) * k; o[2] = slope * k;
      },
    };
    const a = circle(cx, cy, r0, n), b = circle(cx, cy, r1, n);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const q: V3[] = [[a[i][0], a[i][1], z0], [a[j][0], a[j][1], z0], [b[j][0], b[j][1], z1], [b[i][0], b[i][1], z1]];
      const mx = (a[i][0] + a[j][0]) / 2 - cx, my = (a[i][1] + a[j][1]) / 2 - cy;
      const l = Math.sqrt(mx * mx + my * my) || 1;
      this.poly(q, sm, [(mx / l) * k, (my / l) * k, slope * k]);
    }
    const t = top === undefined ? side : top;
    if (t && r1 > 0) this.poly(b.map(([x, y]) => [x, y, z1] as V3), t, [0, 0, 1]);
  }

  /** A round rod between two points (a beam, a leg, a shaft), smooth-shaded. */
  rod(a: V3, b: V3, r: number, n: number, side: Mat, cap?: Mat | null): void {
    const d: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const L = Math.sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]) || 1;
    const w: V3 = [d[0] / L, d[1] / L, d[2] / L];
    // any vector not parallel to the axis gives the frame
    const t: V3 = Math.abs(w[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    let u: V3 = [w[1] * t[2] - w[2] * t[1], w[2] * t[0] - w[0] * t[2], w[0] * t[1] - w[1] * t[0]];
    const ul = Math.sqrt(u[0] * u[0] + u[1] * u[1] + u[2] * u[2]);
    u = [u[0] / ul, u[1] / ul, u[2] / ul];
    const v: V3 = [w[1] * u[2] - w[2] * u[1], w[2] * u[0] - w[0] * u[2], w[0] * u[1] - w[1] * u[0]];
    const sm: Mat = {
      ...side,
      smooth: (x, y, z, o) => {
        const px = x - a[0], py = y - a[1], pz = z - a[2];
        const k = px * w[0] + py * w[1] + pz * w[2];
        const rx = px - k * w[0], ry = py - k * w[1], rz = pz - k * w[2];
        const l = Math.sqrt(rx * rx + ry * ry + rz * rz) || 1;
        o[0] = rx / l; o[1] = ry / l; o[2] = rz / l;
      },
    };
    const ring = (o: V3): V3[] => {
      const out: V3[] = [];
      for (let i = 0; i < n; i++) {
        const q = ((i + 0.5) / n) * Math.PI * 2, c = Math.cos(q) * r, s = Math.sin(q) * r;
        out.push([o[0] + u[0] * c + v[0] * s, o[1] + u[1] * c + v[1] * s, o[2] + u[2] * c + v[2] * s]);
      }
      return out;
    };
    const A = ring(a), B = ring(b);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const q = ((i + 1) / n) * Math.PI * 2;
      const nn: V3 = [u[0] * Math.cos(q) + v[0] * Math.sin(q), u[1] * Math.cos(q) + v[1] * Math.sin(q), u[2] * Math.cos(q) + v[2] * Math.sin(q)];
      this.poly([A[i], A[j], B[j], B[i]], sm, nn);
    }
    const c = cap === undefined ? side : cap;
    this.poly(A.slice().reverse(), c, [-w[0], -w[1], -w[2]]);
    this.poly(B, c, w);
  }

  /** Rotate everything added since `m` about the vertical axis through (px, py). */
  rotZ(m: Mark, px: number, py: number, ang: number): void {
    const c = Math.cos(ang), s = Math.sin(ang);
    const rp = (p: V3): V3 => [px + (p[0] - px) * c - (p[1] - py) * s, py + (p[0] - px) * s + (p[1] - py) * c, p[2]];
    const rn = (n: V3): V3 => [n[0] * c - n[1] * s, n[0] * s + n[1] * c, n[2]];
    for (let i = m.f; i < this.faces.length; i++) {
      const f = this.faces[i];
      f.p = f.p.map(rp);
      f.n = rn(f.n);
      if (f.m.smooth) {
        // the smooth normal is defined in the unturned frame: turn the query point back
        const sm = f.m.smooth;
        f.m = {
          ...f.m,
          smooth: (x, y, z, o) => {
            sm(px + (x - px) * c + (y - py) * s, py - (x - px) * s + (y - py) * c, z, o);
            const nx = o[0], ny = o[1];
            o[0] = nx * c - ny * s; o[1] = nx * s + ny * c;
          },
        };
      }
    }
    for (let i = m.s; i < this.segs.length; i++) { this.segs[i].a = rp(this.segs[i].a); this.segs[i].b = rp(this.segs[i].b); }
    for (let i = m.d; i < this.dots.length; i++) this.dots[i].p = rp(this.dots[i].p);
  }

  /** Move everything added since `m`. */
  move(m: Mark, d: V3): void {
    const mv = (p: V3): V3 => [p[0] + d[0], p[1] + d[1], p[2] + d[2]];
    for (let i = m.f; i < this.faces.length; i++) {
      const f = this.faces[i];
      f.p = f.p.map(mv);
      if (f.m.smooth) {
        const sm = f.m.smooth;
        f.m = { ...f.m, smooth: (x, y, z, o) => sm(x - d[0], y - d[1], z - d[2], o) };
      }
    }
    for (let i = m.s; i < this.segs.length; i++) { this.segs[i].a = mv(this.segs[i].a); this.segs[i].b = mv(this.segs[i].b); }
    for (let i = m.d; i < this.dots.length; i++) this.dots[i].p = mv(this.dots[i].p);
  }
}

// ---------------------------------------------------------------- rendering

export interface Shadow {
  /** Ground offset of the shadow per metre of height (x east, y south). */
  kx: number;
  ky: number;
  /** 0..255; style guide §4: the shadow colour at about 27%. */
  alpha: number;
}

export interface RenderOpts {
  /** World heading of the model's +x axis, radians clockwise from east (y points south). */
  yaw?: number;
  /** Fixed cell; by default the cell is fitted to the model. */
  cell?: Cell;
  outline?: "all" | "br" | "none";
  /** Outline where another part stands in front by more than this depth (metres of height along
   *  the view ray); 0 = off. */
  edge?: number;
  shadow?: Shadow | null;
  /** Transparent margin around a fitted cell. */
  margin?: number;
}

export interface Bounds { x0: number; y0: number; x1: number; y1: number }

/** Screen extent of a model relative to its origin, for a yaw (and its shadow). */
export function bounds(m: Mesh, yaw = 0, shadow?: Shadow | null, into?: Bounds): Bounds {
  const b = into ?? { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const add = (p: V3) => {
    const X = c * p[0] - s * p[1], Y = s * p[0] + c * p[1];
    const sx = X * PX_X, sy = Y * PX_Y - p[2] * PX_Z;
    if (sx < b.x0) b.x0 = sx;
    if (sx > b.x1) b.x1 = sx;
    if (sy < b.y0) b.y0 = sy;
    if (sy > b.y1) b.y1 = sy;
    if (shadow) {
      const gx = (X + shadow.kx * p[2]) * PX_X, gy = (Y + shadow.ky * p[2]) * PX_Y;
      if (gx < b.x0) b.x0 = gx;
      if (gx > b.x1) b.x1 = gx;
      if (gy < b.y0) b.y0 = gy;
      if (gy > b.y1) b.y1 = gy;
    }
  };
  for (const f of m.faces) f.p.forEach(add);
  for (const sg of m.segs) { add(sg.a); add(sg.b); }
  for (const d of m.dots) add(d.p);
  return b;
}

export function fitCell(b: Bounds, margin = 2): Cell {
  const ax = Math.ceil(-b.x0) + margin, ay = Math.ceil(-b.y0) + margin;
  return { w: ax + Math.ceil(b.x1) + margin + 1, h: ay + Math.ceil(b.y1) + margin + 1, ax, ay };
}

// Scratch buffers for the scanline: the projected polygon, the row crossings and the spans.
const PXS = new Float64Array(2048), PYS = new Float64Array(2048), CR = new Float64Array(2048);
let SP = new Int32Array(3 * 1024);

/** Pixel-centre spans (x0, x1 exclusive, y) of the polygon in PXS/PYS; returns the int count. */
function spans(n: number, W: number, H: number): number {
  let minY = Infinity, maxY = -Infinity, minX = Infinity, maxX = -Infinity;
  for (let i = 0; i < n; i++) {
    const y = PYS[i], x = PXS[i];
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
  }
  if (maxX < 0 || minX > W || maxY < 0 || minY > H) return 0;
  const yA = Math.max(0, Math.ceil(minY - 0.5)), yB = Math.min(H - 1, Math.floor(maxY - 0.5));
  let out = 0;
  for (let y = yA; y <= yB; y++) {
    const yc = y + 0.5;
    let k = 0;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const ay = PYS[j], by = PYS[i];
      if (ay <= yc !== by <= yc) {
        const x = PXS[j] + ((yc - ay) / (by - ay)) * (PXS[i] - PXS[j]);
        let q = k++;
        while (q > 0 && CR[q - 1] > x) { CR[q] = CR[q - 1]; q--; }
        CR[q] = x;
      }
    }
    for (let q = 0; q + 1 < k; q += 2) {
      const x0 = Math.max(0, Math.ceil(CR[q] - 0.5)), x1 = Math.min(W, Math.ceil(CR[q + 1] - 0.5));
      if (x1 <= x0) continue;
      if (out + 3 > SP.length) { const g = new Int32Array(SP.length * 2); g.set(SP); SP = g; }
      SP[out++] = x0; SP[out++] = x1; SP[out++] = y;
    }
  }
  return out;
}

export interface Rendered {
  image: PixelImage;
  ax: number;
  ay: number;
}

type Smooth = (x: number, y: number, z: number, out: V3) => void;
const NRM: V3 = [0, 0, 1];

/** What the renderer needs from a mesh's faces, independent of the heading: flat arrays, so the
 *  per-pixel loops read one shape instead of many material objects. */
interface Prepared {
  count: number;
  ramp: Ramp[];
  tex: (Tex | null)[];
  smooth: (Smooth | null)[];
  shift: Int8Array;
  fixed: Int8Array; // -1: lit by the normal
  part: Int32Array;
  bias: Float64Array;
  /** Local normals, 3 per face. */
  ln: Float64Array;
  /** The model's box: x0, x1, y0, y1, z0, z1. */
  box: number[];
  // per-frame scratch, one slot per face
  fA: Float64Array;
  fB: Float64Array;
  fC: Float64Array;
  fT: Int8Array;
  fN: Float64Array;
}

const prepared = new WeakMap<Mesh, Prepared>();

function prepare(m: Mesh): Prepared {
  const F = m.faces.length;
  const old = prepared.get(m);
  if (old && old.count === F) return old;
  const p: Prepared = {
    count: F,
    ramp: new Array(F),
    tex: new Array(F),
    smooth: new Array(F),
    shift: new Int8Array(F),
    fixed: new Int8Array(F),
    part: new Int32Array(F),
    bias: new Float64Array(F),
    ln: new Float64Array(F * 3),
    box: [Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity],
    fA: new Float64Array(F),
    fB: new Float64Array(F),
    fC: new Float64Array(F),
    fT: new Int8Array(F),
    fN: new Float64Array(F * 3),
  };
  for (let i = 0; i < F; i++) {
    const f = m.faces[i], mat = f.m;
    p.ramp[i] = mat.ramp;
    p.tex[i] = mat.tex ?? null;
    p.smooth[i] = mat.smooth ?? null;
    p.shift[i] = mat.shift ?? 0;
    p.fixed[i] = mat.fixed ?? -1;
    p.part[i] = f.part;
    p.bias[i] = f.bias;
    p.ln[i * 3] = f.n[0]; p.ln[i * 3 + 1] = f.n[1]; p.ln[i * 3 + 2] = f.n[2];
  }
  const grow = (q: V3) => {
    const b = p.box;
    if (q[0] < b[0]) b[0] = q[0];
    if (q[0] > b[1]) b[1] = q[0];
    if (q[1] < b[2]) b[2] = q[1];
    if (q[1] > b[3]) b[3] = q[1];
    if (q[2] < b[4]) b[4] = q[2];
    if (q[2] > b[5]) b[5] = q[2];
  };
  for (const f of m.faces) f.p.forEach(grow);
  for (const s of m.segs) { grow(s.a); grow(s.b); }
  for (const d of m.dots) grow(d.p);
  prepared.set(m, p);
  return p;
}

// Scratch buffers shared by every frame (the renderer is synchronous), grown as needed.
let ZB = new Float32Array(0), ID = new Int32Array(0), MASK = new Uint8Array(0);
function scratch(n: number): void {
  if (ZB.length < n) {
    const m = Math.max(n, ZB.length * 2);
    ZB = new Float32Array(m);
    ID = new Int32Array(m);
    MASK = new Uint8Array(m);
  }
}

/** Working state of one frame. */
class Frame3 {
  readonly N: number;
  readonly zb: Float32Array;
  readonly id: Int32Array;
  readonly c: number;
  readonly s: number;
  readonly F: number;
  readonly S: number;
  // per face, for this heading: depth plane t = A + B*sx + C*sy (sx, sy from the origin), tone, world normal
  readonly fA: Float64Array;
  readonly fB: Float64Array;
  readonly fC: Float64Array;
  readonly fT: Int8Array;
  readonly fN: Float64Array;
  // bounding box of what was drawn (x1, y1 exclusive)
  bx0: number;
  by0: number;
  bx1 = 0;
  by1 = 0;

  constructor(readonly m: Mesh, readonly P: Prepared, readonly W: number, readonly H: number, readonly ax: number, readonly ay: number, yaw: number) {
    this.N = W * H;
    scratch(this.N);
    this.zb = ZB;
    this.id = ID;
    ZB.fill(-1e9, 0, this.N);
    ID.fill(-1, 0, this.N);
    this.c = Math.cos(yaw);
    this.s = Math.sin(yaw);
    this.F = m.faces.length;
    this.S = m.segs.length;
    // per-face scratch lives with the prepared mesh: the frames of one mesh render one after another
    this.fA = P.fA;
    this.fB = P.fB;
    this.fC = P.fC;
    this.fT = P.fT;
    this.fN = P.fN;
    this.bx0 = W;
    this.by0 = H;
  }
}

function rasterFaces(fr: Frame3): void {
  const { m, P, W, H, ax, ay, c, s, zb, id, fA, fB, fC, fT, fN } = fr;
  const ln = P.ln;
  let bx0 = fr.bx0, by0 = fr.by0, bx1 = fr.bx1, by1 = fr.by1;
  for (let i = 0; i < fr.F; i++) {
    const lx = ln[i * 3], ly = ln[i * 3 + 1], nz = ln[i * 3 + 2];
    const nx = c * lx - s * ly, ny = s * lx + c * ly;
    fN[i * 3] = nx; fN[i * 3 + 1] = ny; fN[i * 3 + 2] = nz;
    const den = ny * KY + nz;
    if (den <= 1e-4) continue; // facing away or edge-on
    const pts = m.faces[i].p, nv = pts.length;
    const p0 = pts[0];
    const d = nx * (c * p0[0] - s * p0[1]) + ny * (s * p0[0] + c * p0[1]) + nz * p0[2];
    const A = d / den, B = -nx / (PX_X * den), C = -ny / (PX_Y * den);
    fA[i] = A; fB[i] = B; fC[i] = C;
    const fx = P.fixed[i];
    fT[i] = fx >= 0 ? fx : Math.max(0, Math.min(3, lightTone(nx, ny, nz) + P.shift[i]));
    for (let v = 0; v < nv; v++) {
      const p = pts[v];
      PXS[v] = ax + (c * p[0] - s * p[1]) * PX_X;
      PYS[v] = ay + (s * p[0] + c * p[1]) * PX_Y - p[2] * PX_Z;
    }
    const ns = spans(nv, W, H);
    if (!ns) continue;
    if (SP[2] < by0) by0 = SP[2];
    if (SP[ns - 1] > by1) by1 = SP[ns - 1];
    const bias = P.bias[i];
    for (let q = 0; q < ns; q += 3) {
      const x0 = SP[q], x1 = SP[q + 1], y = SP[q + 2];
      if (x0 < bx0) bx0 = x0;
      if (x1 > bx1) bx1 = x1;
      let t = A + C * (y + 0.5 - ay) + B * (x0 + 0.5 - ax) + bias;
      for (let k = y * W + x0, e = y * W + x1; k < e; k++, t += B) {
        if (t > zb[k] + 1e-5) { zb[k] = t; id[k] = i; }
      }
    }
  }
  fr.bx0 = bx0; fr.by0 = by0; fr.bx1 = bx1; fr.by1 = by1;
}

function rasterLines(fr: Frame3): void {
  const { m, W, H, ax, ay, c, s, zb, id, F, S } = fr;
  const mark = (x: number, y: number, z: number, i: number) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const k = y * W + x;
    if (z <= zb[k]) return;
    zb[k] = z; id[k] = i;
    if (x < fr.bx0) fr.bx0 = x;
    if (x >= fr.bx1) fr.bx1 = x + 1;
    if (y < fr.by0) fr.by0 = y;
    if (y > fr.by1) fr.by1 = y;
  };
  for (let j = 0; j < S; j++) {
    const sg = m.segs[j];
    const a = sg.a, b = sg.b;
    let x0 = Math.floor(ax + (c * a[0] - s * a[1]) * PX_X), y0 = Math.floor(ay + (s * a[0] + c * a[1]) * PX_Y - a[2] * PX_Z);
    const x1 = Math.floor(ax + (c * b[0] - s * b[1]) * PX_X), y1 = Math.floor(ay + (s * b[0] + c * b[1]) * PX_Y - b[2] * PX_Z);
    const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1, dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
    const steps = Math.max(dx, -dy) || 1;
    let err = dx + dy, n = 0;
    for (;;) {
      mark(x0, y0, a[2] + (b[2] - a[2]) * (n / steps) + sg.bias, F + j);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
      n++;
    }
  }
  for (let j = 0; j < m.dots.length; j++) {
    const d = m.dots[j], p = d.p;
    mark(Math.floor(ax + (c * p[0] - s * p[1]) * PX_X), Math.floor(ay + (s * p[0] + c * p[1]) * PX_Y - p[2] * PX_Z), p[2] + d.bias, F + S + j);
  }
}

/** A lone face pixel takes its neighbours' face (the stair-step noise of turned boxes). */
function despeckle(fr: Frame3, X0: number, X1: number, Y0: number, Y1: number): void {
  const { W, H, ax, ay, zb, id, F, fA, fB, fC } = fr;
  const part = fr.P.part, bias = fr.P.bias;
  for (let y = Y0; y < Y1; y++) {
    for (let x = X0, k = y * W + X0; x < X1; x++, k++) {
      const i = id[k];
      if (i < 0 || i >= F) continue;
      const l = x > 0 ? id[k - 1] : -1, r = x < W - 1 ? id[k + 1] : -1;
      const u = y > 0 ? id[k - W] : -1, d = y < H - 1 ? id[k + W] : -1;
      if (l === i || r === i || u === i || d === i) continue;
      let best = -2;
      if (l === r || l === u || l === d) best = l;
      else if (r === u || r === d) best = r;
      else if (u === d) best = u;
      if (best === -2 || best >= F) continue;
      if (best >= 0 && part[best] !== part[i]) continue;
      id[k] = best;
      zb[k] = best >= 0 ? fA[best] + fB[best] * (x + 0.5 - ax) + fC[best] * (y + 0.5 - ay) + bias[best] : -1e9;
    }
  }
}

const HIT: Hit = { x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, t: 0, px: 0, py: 0 };

/** Colour every drawn pixel; a face pixel where a face of another part stands in front of it by
 *  more than `thr` becomes the outline instead (the edges between parts). */
function shade(fr: Frame3, D: Uint8ClampedArray, thr: number, X0: number, X1: number, Y0: number, Y1: number): void {
  const { m, P, W, H, ax, ay, c, s, zb, id, F, S, fA, fB, fC, fT } = fr;
  const part = P.part, texs = P.tex, sms = P.smooth, ramps = P.ramp, ln = P.ln, fixed = P.fixed, shift = P.shift;
  const OL = PAL.shared.outline;
  const hit = HIT;
  for (let y = Y0; y < Y1; y++) {
    const syw = y + 0.5 - ay;
    const top = y > 0, bottom = y < H - 1;
    for (let x = X0, k = y * W + X0; x < X1; x++, k++) {
      const i = id[k];
      if (i < 0) continue;
      let col: RGB | null | undefined;
      if (i < F) {
        if (thr > 0) {
          const l = x > 0 ? id[k - 1] : -1, r = x < W - 1 ? id[k + 1] : -1, u = top ? id[k - W] : -1, d = bottom ? id[k + W] : -1;
          // inside a face (the usual case) there is no edge to look for
          if (l !== i || r !== i || u !== i || d !== i) {
            const p = part[i], z = zb[k] + thr;
            if ((l >= 0 && l < F && l !== i && part[l] !== p && zb[k - 1] > z) ||
              (r >= 0 && r < F && r !== i && part[r] !== p && zb[k + 1] > z) ||
              (u >= 0 && u < F && u !== i && part[u] !== p && zb[k - W] > z) ||
              (d >= 0 && d < F && d !== i && part[d] !== p && zb[k + W] > z)) {
              const q = k * 4;
              D[q] = OL[0]; D[q + 1] = OL[1]; D[q + 2] = OL[2]; D[q + 3] = 255;
              continue;
            }
          }
        }
        let t = fT[i];
        const tex = texs[i], sm = sms[i];
        if (tex !== null || sm !== null) {
          const sxw = x + 0.5 - ax;
          const Z = fA[i] + fB[i] * sxw + fC[i] * syw;
          const X = sxw / PX_X, Y = (syw + Z * PX_Z) / PX_Y;
          const lx = c * X + s * Y, ly = -s * X + c * Y;
          let nx = ln[i * 3], ny = ln[i * 3 + 1], nz = ln[i * 3 + 2];
          if (sm !== null) {
            sm(lx, ly, Z, NRM);
            nx = NRM[0]; ny = NRM[1]; nz = NRM[2];
            if (fixed[i] < 0) t = Math.max(0, Math.min(3, lightTone(c * nx - s * ny, s * nx + c * ny, nz) + shift[i]));
          }
          if (tex !== null) {
            hit.x = lx; hit.y = ly; hit.z = Z;
            hit.nx = nx; hit.ny = ny; hit.nz = nz;
            hit.t = t; hit.px = x; hit.py = y;
            col = tex(hit);
            if (col === undefined) col = toneOf(ramps[i], t);
          } else col = toneOf(ramps[i], t);
        } else col = toneOf(ramps[i], t);
      } else if (i < F + S) col = m.segs[i - F].c;
      else col = m.dots[i - F - S].c;
      if (col === null) { id[k] = -1; zb[k] = -1e9; continue; }
      const q = k * 4;
      D[q] = col[0]; D[q + 1] = col[1]; D[q + 2] = col[2]; D[q + 3] = 255;
    }
  }
}

/** Outline the silhouette: every empty pixel next to a drawn one ("br": only right of / below). */
export function silhouette(D: Uint8ClampedArray, W: number, H: number, mode: "all" | "br", X0 = 0, X1 = W, Y0 = 0, Y1 = H): void {
  scratch(W * H);
  const mark = MASK;
  mark.fill(0, Y0 * W, Y1 * W);
  for (let y = Y0; y < Y1; y++) {
    for (let x = X0, k = y * W + X0; x < X1; x++, k++) {
      if (D[k * 4 + 3]) continue;
      if ((x > 0 && D[k * 4 - 1]) || (y > 0 && D[(k - W) * 4 + 3])) mark[k] = 1;
      else if (mode === "all" && ((x < W - 1 && D[k * 4 + 7]) || (y < H - 1 && D[(k + W) * 4 + 3]))) mark[k] = 1;
    }
  }
  const OL = PAL.shared.outline;
  for (let k = Y0 * W; k < Y1 * W; k++) if (mark[k]) { const q = k * 4; D[q] = OL[0]; D[q + 1] = OL[1]; D[q + 2] = OL[2]; D[q + 3] = 255; }
}

/** The cast shadow on the ground: the union of the shadows of the faces that face the light. */
function castShadow(fr: Frame3, D: Uint8ClampedArray, sh: Shadow): void {
  const { m, W, H, ax, ay, c, s, F, fN } = fr;
  const mask = MASK;
  mask.fill(0, 0, fr.N);
  let s0 = H, s1 = -1;
  for (let i = 0; i < F; i++) {
    if (-sh.kx * fN[i * 3] - sh.ky * fN[i * 3 + 1] + fN[i * 3 + 2] <= 0) continue;
    const pts = m.faces[i].p, nv = pts.length;
    for (let v = 0; v < nv; v++) {
      const p = pts[v];
      PXS[v] = ax + (c * p[0] - s * p[1] + sh.kx * p[2]) * PX_X;
      PYS[v] = ay + (s * p[0] + c * p[1] + sh.ky * p[2]) * PX_Y;
    }
    const ns = spans(nv, W, H);
    if (!ns) continue;
    if (SP[2] < s0) s0 = SP[2];
    if (SP[ns - 1] > s1) s1 = SP[ns - 1];
    for (let q = 0; q < ns; q += 3) mask.fill(1, SP[q + 2] * W + SP[q], SP[q + 2] * W + SP[q + 1]);
  }
  const SC = PAL.shared.shadow;
  for (let k = s0 * W, e = (s1 + 1) * W; k < e; k++) {
    if (!mask[k] || D[k * 4 + 3]) continue;
    const q = k * 4;
    D[q] = SC[0]; D[q + 1] = SC[1]; D[q + 2] = SC[2]; D[q + 3] = sh.alpha;
  }
}

let OUT = new Uint8ClampedArray(0);

/** Render a model into a pixel image whose (ax, ay) is the model's origin on the ground.
 *  With `scratch`, the image is a reused buffer, valid until the next render. */
export function render(m: Mesh, o: RenderOpts & { scratch?: boolean } = {}): Rendered {
  const yaw = o.yaw ?? 0;
  const cell = o.cell ?? fitCell(bounds(m, yaw, o.shadow), o.margin ?? 2);
  const fr = new Frame3(m, prepare(m), cell.w, cell.h, cell.ax, cell.ay, yaw);
  rasterFaces(fr);
  if (fr.S || m.dots.length) rasterLines(fr);
  let im: PixelImage;
  if (o.scratch) {
    const n = cell.w * cell.h * 4;
    if (OUT.length < n) OUT = new Uint8ClampedArray(Math.max(n, OUT.length * 2));
    OUT.fill(0, 0, n);
    im = { w: cell.w, h: cell.h, data: OUT.subarray(0, n) };
  } else im = img(cell.w, cell.h);
  if (fr.bx1 > fr.bx0) {
    // the passes below look one pixel around what was drawn (for the outline)
    const X0 = Math.max(0, fr.bx0 - 1), X1 = Math.min(fr.W, fr.bx1 + 1), Y0 = Math.max(0, fr.by0 - 1), Y1 = Math.min(fr.H, fr.by1 + 2);
    despeckle(fr, X0, X1, Y0, Y1);
    shade(fr, im.data, o.edge ?? 0, X0, X1, Y0, Y1);
    const mode = o.outline ?? "all";
    if (mode !== "none") silhouette(im.data, fr.W, fr.H, mode, X0, X1, Y0, Y1);
  }
  if (o.shadow && o.shadow.alpha > 0) castShadow(fr, im.data, o.shadow);
  return { image: im, ax: cell.ax, ay: cell.ay };
}

/**
 * Render into `dst` as if into `o.cell` placed at (dx, dy), drawing only the part of the cell this
 * view covers: a cell shared by every heading is mostly empty for any one of them. Same pixels as
 * render() into the whole cell.
 */
export function renderInto(m: Mesh, o: RenderOpts & { cell: Cell }, dst: PixelImage, dx: number, dy: number): void {
  const cell = o.cell;
  // the model's box corners bound it at any heading: cheap, and a little generous
  const P = prepare(m), bx = P.box;
  const corners = new Mesh();
  for (const x of [bx[0], bx[1]]) for (const y of [bx[2], bx[3]]) for (const z of [bx[4], bx[5]]) corners.dots.push({ p: [x, y, z], c: PAL.shared.outline, part: 0, bias: 0 });
  const b = bounds(corners, o.yaw ?? 0, o.shadow);
  const x0 = Math.max(0, Math.floor(cell.ax + b.x0) - 2), y0 = Math.max(0, Math.floor(cell.ay + b.y0) - 2);
  const x1 = Math.min(cell.w, Math.ceil(cell.ax + b.x1) + 3), y1 = Math.min(cell.h, Math.ceil(cell.ay + b.y1) + 3);
  const sub: Cell = { w: x1 - x0, h: y1 - y0, ax: cell.ax - x0, ay: cell.ay - y0 };
  const r = render(m, { ...o, cell: sub, scratch: true });
  const row = sub.w * 4;
  for (let y = 0; y < sub.h; y++) dst.data.set(r.image.data.subarray(y * row, (y + 1) * row), ((dy + y0 + y) * dst.w + dx + x0) * 4);
}
