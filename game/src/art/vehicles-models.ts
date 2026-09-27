// The four vehicles of the Arsenal demo as primitives in metres (local axes: x forward, y to the
// right, z up; origin = the vehicle's centre on the ground). vehicles.ts turns and renders them.
// Every colour comes from the palette: paint ramps, glass, chrome, soot and rust for the burnt
// states. Scorch and rust patterns are noise in the vehicle's own coordinates, so they turn with it.
import type { VehicleKind, VehicleState } from "./types";
import { PAL, ramp, type RGB, type Ramp } from "./palette";
import { hash2 } from "./pixel";
import { vnoise } from "./fx-noise";
import { Mesh, toneOf, type Hit, type Mat, type Prof } from "./vehicles-3d";

const C = PAL.city_1943, S = PAL.shared;
export const GREY: Ramp = ramp("props_extra", "vehicle_grey");
export const BLACK: Ramp = ramp("props_extra", "car_black");
const CANVAS: Ramp = PAL.troopers.occupier_field_grey;
const SOOT = C.soot;
/** Smoke-blackened paint while it burns, and the burnt-out body of a wreck. */
const CHAR: Ramp = [S.glass_dark, S.outline, C.soot[0], C.soot[1]];
const BURNT: Ramp = [S.outline, C.soot[0], C.soot[1], C.soot[2]];
const RUST: Ramp = [PAL.forest.trunk[0], PAL.forest.trunk[1], C.wood[0]];
const ASH: Ramp = [C.cobble[1], C.slush[0]];
const CHROME: Ramp = [C.cobble[1], C.stone_grey[2], C.dirty_snow[2]];
const TYRE: Ramp = [S.outline, C.soot[0], C.soot[1]];
const DARK: Ramp = [S.glass_dark, S.outline, C.soot[0]];
const TRIM: Ramp = C.cloth;
const RED_LAMP: RGB = C.tram[2];
const LENS: RGB = C.dirty_snow[1];
const FIRE = S.fire;
const EMBER = ramp("props_extra", "ember");

// ---------------------------------------------------------------- paint

/** What a paint detail asks for: a tone shift, an explicit colour, a hole, or a window / opening. */
export type Detail = number | RGB | null | "glass" | "inside" | undefined;

interface PaintOpts {
  /** Windows reflect the sky lighter than the paint (a black car) instead of darker. */
  lightGlass?: boolean;
  /** Canvas: burning, it chars through to holes with glowing edges. */
  burns?: boolean;
}

/** How far fire has got at a point: soot climbs from the lower windows to the roof. */
function scorch(h: Hit, seed: number, top: number): number {
  return h.z / top + (vnoise(h.x * 3.1, h.y * 3.1, h.z * 2.2, seed) - 0.5) * 0.6;
}

/** The ramp a painted surface shows in a state: clean, smoke-blackened above a ragged line, or burnt out. */
function weathered(base: Ramp, h: Hit, st: VehicleState, seed: number, top: number): Ramp {
  if (st === "burning") return scorch(h, seed, top) > 0.66 ? CHAR : base;
  if (st === "wreck") {
    // burnt out: black, rusting where the paint burnt off (more of it low down), grey ash on top
    const n = vnoise(h.x * 3.3, h.y * 3.3, h.z * 3.3, seed + 3) + (0.5 - h.z / top) * 0.3;
    if (n > 0.6) return RUST;
    if (h.nz > 0.6 && n < 0.08) return ASH;
    return BURNT;
  }
  return base;
}

export function glassColour(h: Hit, st: VehicleState, light = false): RGB {
  if (st === "wreck") return (h.px + h.py) % 5 === 0 ? S.outline : S.glass_dark;
  if (st === "burning") {
    const k = hash2(h.px >> 1, h.py, 11);
    return k < 0.35 ? FIRE[1] : k < 0.8 ? FIRE[0] : EMBER[1];
  }
  const g = (h.px + h.py) % 7;
  const glint = g === 0 || g === 1;
  if (light) {
    if (h.t >= 2) return glint ? C.slush[1] : C.puddle[1];
    if (h.t === 1) return glint ? C.puddle[1] : C.puddle[0];
    return glint ? C.puddle[0] : S.glass;
  }
  if (h.t >= 2) return glint ? C.puddle[1] : S.glass;
  return glint ? S.glass : S.glass_dark;
}

function insideColour(h: Hit, st: VehicleState): RGB {
  if (st === "burning") {
    const k = hash2(h.px, h.py, 5);
    return k < 0.1 ? EMBER[1] : k < 0.3 ? EMBER[0] : S.glass_dark;
  }
  return S.glass_dark;
}

function paint(base: Ramp, st: VehicleState, seed: number, top: number, detail?: (h: Hit) => Detail, o: PaintOpts = {}): Mat {
  return {
    ramp: base,
    tex: (h) => {
      const d = detail ? detail(h) : undefined;
      if (d === null) return null;
      if (d === "glass") return glassColour(h, st, o.lightGlass);
      if (d === "inside") return insideColour(h, st);
      if (typeof d === "object") return d;
      if (o.burns && st === "burning") {
        // canvas: charred holes with a thin glowing rim, scorched around them
        const k = vnoise(h.x * 2.2, h.y * 2.2, h.z * 2.2, seed + 9) * 0.8 + (h.z / top) * 0.3;
        if (k > 0.78) return insideColour(h, st);
        if (k > 0.74) return vnoise(h.x * 9, h.y * 9, h.z * 9, seed) > 0.5 ? FIRE[0] : EMBER[1];
        if (k > 0.6) return toneOf(CHAR, h.t + (d ?? 0));
        return toneOf(base, h.t + (d ?? 0));
      }
      return toneOf(weathered(base, h, st, seed, top), h.t + (d ?? 0));
    },
  };
}

const flat = (r: Ramp, fixed?: number): Mat => (fixed === undefined ? { ramp: r } : { ramp: r, fixed });

/** A wheel: tyre, painted rim, hub. Burnt out, only a blackened rim is left. */
function wheel(m: Mesh, cx: number, r: number, y0: number, y1: number, st: VehicleState, rim: Ramp, hub: Ramp): void {
  m.newPart();
  const cz = r;
  if (st === "wreck") {
    const rr = r * 0.7;
    const tex: Mat = { ramp: SOOT, tex: (h) => { const dx = h.x - cx, dz = h.z - rr; return dx * dx + dz * dz < rr * rr * 0.2 ? toneOf(RUST, h.t) : undefined; } };
    m.cylY(cx, rr, rr, y0 + 0.03, y1 - 0.03, 8, { ramp: SOOT }, tex);
    return;
  }
  const cap: Mat = {
    ramp: TYRE,
    tex: (h) => {
      const dx = h.x - cx, dz = h.z - cz;
      const d = Math.sqrt(dx * dx + dz * dz) / r;
      if (d < 0.3) return toneOf(hub, h.t + 1);
      if (d < 0.62) return toneOf(rim, d < 0.5 ? h.t : h.t - 1);
      return undefined;
    },
  };
  m.cylY(cx, cz, r, y0, y1, r > 0.4 ? 10 : 8, { ramp: TYRE }, cap);
}

function wheelPair(m: Mesh, cx: number, r: number, yi: number, yo: number, st: VehicleState, rim: Ramp, hub: Ramp): void {
  wheel(m, cx, r, yi, yo, st, rim, hub);
  wheel(m, cx, r, -yo, -yi, st, rim, hub);
}

/** A mudguard's side profile: the outer curve over the wheel (reaching `back` behind and `front`
 *  ahead of the axle, `rTop` above it), then the wheel arch of radius rIn back underneath. */
function arch(cx: number, cz: number, rIn: number, rTop: number, front: number, back: number): Prof {
  const out: Prof = [];
  const n = 7;
  for (let i = 0; i <= n; i++) {
    const a = Math.PI - (i / n) * Math.PI;
    const c = Math.cos(a);
    out.push([cx + c * (c < 0 ? back : front), cz + Math.sin(a) * rTop]);
  }
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI;
    out.push([cx + Math.cos(a) * rIn, cz + Math.sin(a) * rIn]);
  }
  return out;
}

// ---------------------------------------------------------------- the car

function car(st: VehicleState): Mesh {
  const m = new Mesh();
  const sink = st === "wreck" ? 0.1 : 0;
  const open = st === "doors_open";
  const top = 1.6;
  const seed = 17;
  const r = 0.34, fx = 1.42, rx = -1.3;
  const lg: PaintOpts = { lightGlass: true };

  // wheels, under the body
  wheelPair(m, fx, r, 0.6, 0.78, st, BLACK, CHROME);
  wheelPair(m, rx, r, 0.6, 0.78, st, BLACK, CHROME);
  const bodyStart = m.mark();

  // underbody
  m.newPart();
  m.box(-1.95, 1.95, -0.6, 0.6, 0.22, 0.42, flat(DARK, 0));

  // mudguards and running boards
  m.newPart();
  const wing = paint(BLACK, st, seed, top, (h) => (h.nz > 0.5 && h.x > -0.9 && h.x < 0.9 ? -1 : undefined));
  const ff = arch(fx, r, r + 0.07, 0.5, 0.78, 0.5);
  const rf = arch(rx, r, r + 0.07, 0.45, 0.4, 0.74);
  for (const sgn of [1, -1]) {
    const y0 = sgn > 0 ? 0.56 : -0.86, y1 = sgn > 0 ? 0.86 : -0.56;
    m.prismY(ff, y0, y1, wing);
    m.prismY(rf, y0, y1, wing);
    m.box(-0.95, 0.95, sgn > 0 ? 0.7 : -0.86, sgn > 0 ? 0.86 : -0.7, 0.33, 0.38, wing);
  }

  // lower body: doors, cowl and the sloping tail
  m.newPart();
  const doorLines = [0.92, -0.04, -0.94];
  const lower = paint(BLACK, st, seed, top, (h) => {
    if (Math.abs(h.ny) < 0.9) return undefined;
    if (open && isDoorHole(h.x, h.z, h.y)) return h.z < 0.74 ? toneOf(TRIM, 0) : "inside";
    for (const x of doorLines) if (Math.abs(h.x - x) < 0.045 && h.z < 0.99) return -1;
    if (h.z > 0.9 && h.z < 0.95 && (Math.abs(h.x - 0.12) < 0.05 || Math.abs(h.x + 0.2) < 0.05)) return st === "wreck" ? -1 : CHROME[2];
    return undefined;
  }, lg);
  m.prismY([[-2.2, 0.4], [0.95, 0.4], [0.95, 1.0], [-1.42, 1.0], [-1.9, 0.9], [-2.17, 0.7]], -0.72, 0.72, lower);

  // greenhouse: windscreen, side windows, roof, rear window
  const glassSide = (x: number, z: number): boolean => {
    if (z < 1.07 || z > 1.45) return false;
    const fe = 0.88 - (z - 1.0) * 0.44;
    const re = z < 1.22 ? -1.4 + (z - 1.0) * 0.45 : -1.3 + (z - 1.22) * 0.96;
    if (x > fe - 0.07 || x < re + 0.08) return false;
    if (x > -0.12 && x < 0.03) return false; // B pillar
    if (x > -0.98 && x < -0.86) return false; // C pillar
    return true;
  };
  const cabin = paint(BLACK, st, seed, top, (h) => {
    if (Math.abs(h.ny) > 0.9) {
      if (open && isDoorHole(h.x, h.z, h.y)) return "inside";
      return glassSide(h.x, h.z) ? "glass" : undefined;
    }
    if (h.nx > 0.5) return Math.abs(h.y) < 0.58 && h.z > 1.04 && h.z < 1.47 ? "glass" : undefined; // windscreen
    if (h.nx < -0.5 && h.nz < 0.7) return Math.abs(h.y) < 0.42 && h.z > 1.26 && h.z < 1.44 ? "glass" : undefined;
    return undefined;
  }, lg);
  m.prismY([[-1.4, 1.0], [0.88, 1.0], [0.66, 1.5], [0.45, 1.57], [-0.75, 1.58], [-1.05, 1.48], [-1.3, 1.22]], -0.66, 0.66, cabin);

  // hood with louvres, grille, lamps, bumpers
  const hood = paint(BLACK, st, seed, top, (h) => {
    if (Math.abs(h.ny) > 0.9 && h.z > 0.64 && h.z < 0.86) {
      for (let x = 1.34; x < 1.8; x += 0.12) if (Math.abs(h.x - x) < 0.03) return -1;
    }
    if (h.nz > 0.95 && Math.abs(h.y) < 0.03) return -1; // the hood's centre hinge
    return undefined;
  });
  m.prismX([[-0.44, 0.56], [0.44, 0.56], [0.44, 0.88], [0.34, 0.97], [-0.34, 0.97], [-0.44, 0.88]], 0.95, 2.1, hood);
  m.newPart();
  const grille: Mat = st === "wreck" ? flat(SOOT) : {
    ramp: CHROME,
    tex: (h) => (h.nx > 0.5 && Math.abs(h.y) < 0.23 && h.z > 0.56 && h.z < 0.92 ? (Math.floor((h.y + 1) * 30) % 2 ? DARK[1] : CHROME[1]) : undefined),
  };
  m.box(2.1, 2.17, -0.28, 0.28, 0.52, 0.96, grille);
  const bright = st === "wreck" ? flat(SOOT) : flat(CHROME);
  for (const sgn of [1, -1]) {
    m.newPart();
    m.cylX(sgn * 0.54, 0.93, 0.11, 1.98, 2.13, 6, bright, st === "wreck" ? flat(DARK) : { ramp: [LENS, LENS] });
    m.seg([2.0, sgn * 0.5, 0.82], [2.02, sgn * 0.52, 0.86], st === "wreck" ? SOOT[0] : CHROME[0]);
    m.dot([-2.19, sgn * 0.56, 0.64], st === "wreck" ? SOOT[0] : RED_LAMP);
  }
  m.newPart();
  m.box(2.17, 2.25, -0.8, 0.8, 0.3, 0.39, bright);
  m.box(-2.28, -2.2, -0.8, 0.8, 0.3, 0.39, bright);

  // open doors: the right front and rear, and the driver's door (left front)
  if (open) {
    door(m, st, seed, top, 0.9, -0.02, 0.72, 1.1); // right front, hinged at the front
    door(m, st, seed, top, -0.92, -0.06, 0.72, 1.0); // right rear, hinged at the back
    door(m, st, seed, top, 0.9, -0.02, -0.72, 1.1); // left front
  }
  if (sink) m.move(bodyStart, [0, 0, -sink]);
  return m;
}

/** The car's open door holes: both front doors and the right rear. */
function isDoorHole(x: number, z: number, y: number): boolean {
  if (z < 0.44 || z > 1.46) return false;
  if (x > -0.02 && x < 0.9) return true;
  return y > 0 && x > -0.92 && x < -0.06;
}

/** A car door: a thin panel with its window, painted outside and trimmed inside, turned open about its hinge. */
function door(m: Mesh, st: VehicleState, seed: number, top: number, hx: number, fx: number, y: number, ang: number): void {
  m.newPart();
  const mk = m.mark();
  const x0 = Math.min(hx, fx), x1 = Math.max(hx, fx);
  const t = 0.05;
  const y0 = y > 0 ? y - t : y, y1 = y > 0 ? y : y + t;
  const win = (h: Hit) => h.z > 1.05 && h.z < 1.42 && h.x > x0 + 0.08 && h.x < x1 - 0.08;
  const outer = paint(BLACK, st, seed, top, (h) => (Math.abs(h.ny) > 0.9 && win(h) ? "glass" : undefined), { lightGlass: true });
  const inner: Mat = { ramp: TRIM, tex: (h) => (win(h) ? glassColour(h, st, true) : st === "wreck" ? toneOf(SOOT, h.t) : undefined) };
  m.box(x0, x1, y0, y1, 0.42, 1.46, y > 0 ? { side: outer, ny: inner, top: outer } : { side: outer, py: inner, top: outer });
  // swing the free edge outward: the right side toward +y, the left toward -y
  m.rotZ(mk, hx, y, ang * (y > 0 ? 1 : -1) * (hx > fx ? -1 : 1));
}

// ---------------------------------------------------------------- trucks

interface CabSpec {
  front: number; // x of the cab front (windscreen)
  back: number;
  half: number; // half width
  z0: number;
  z1: number; // roof
  glassZ: [number, number];
  split: boolean;
}

function cab(m: Mesh, st: VehicleState, seed: number, top: number, body: Ramp, c: CabSpec, openDoors: boolean): void {
  m.newPart();
  const sideWin = (x: number, z: number) => z > c.glassZ[0] && z < c.glassZ[1] - 0.02 && x > c.back + 0.3 && x < c.front - 0.1;
  const mat = paint(body, st, seed, top, (h) => {
    if (h.nx > 0.9) {
      if (h.z > c.glassZ[0] && h.z < c.glassZ[1] && Math.abs(h.y) < c.half - 0.12) {
        if (c.split && Math.abs(h.y) < 0.05) return -1;
        return "glass";
      }
      return undefined;
    }
    if (Math.abs(h.ny) > 0.9) {
      if (openDoors && h.x > c.back + 0.2 && h.x < c.front - 0.05 && h.z > c.z0 + 0.25 && h.z < c.glassZ[1]) return h.z < c.z0 + 0.62 ? toneOf(DARK, 2) : "inside";
      if (sideWin(h.x, h.z)) return "glass";
      if (Math.abs(h.x - (c.back + 0.2)) < 0.04 && h.z < c.glassZ[1]) return -1; // door seam
      if (h.z > c.glassZ[0] - 0.12 && h.z < c.glassZ[0] - 0.06 && Math.abs(h.x - (c.back + 0.45)) < 0.07) return st === "wreck" ? -1 : CHROME[1]; // handle
    }
    return undefined;
  });
  const r = 0.14;
  m.prismX(
    [[-c.half, c.z0], [c.half, c.z0], [c.half, c.z1 - r], [c.half - r, c.z1], [-c.half + r, c.z1], [-c.half, c.z1 - r]],
    c.back, c.front, mat,
  );
  if (openDoors) {
    for (const sgn of [1, -1]) {
      m.newPart();
      const mk = m.mark();
      const y = sgn * c.half;
      const win = (h: Hit) => h.z > c.glassZ[0] && h.z < c.glassZ[1] - 0.04 && h.x > c.back + 0.28 && h.x < c.front - 0.1;
      const outer = paint(body, st, seed, top, (h) => (Math.abs(h.ny) > 0.9 && win(h) ? "glass" : undefined));
      const inner = paint(body, st, seed, top, (h) => (win(h) ? "glass" : -1));
      m.box(c.back + 0.2, c.front - 0.04, sgn > 0 ? y - 0.05 : y, sgn > 0 ? y : y + 0.05, c.z0 + 0.2, c.glassZ[1],
        sgn > 0 ? { side: outer, ny: inner, top: outer } : { side: outer, py: inner, top: outer });
      m.rotZ(mk, c.front - 0.04, y, -sgn * 1.1);
    }
  }
}

function hoodAndGrille(m: Mesh, st: VehicleState, seed: number, top: number, body: Ramp, x0: number, x1: number, half: number, z0: number, z1: number): void {
  m.newPart();
  const hood = paint(body, st, seed, top, (h) => {
    if (Math.abs(h.ny) > 0.9 && h.z > z0 + 0.25 && h.z < z1 - 0.2) {
      for (let x = x0 + 0.3; x < x0 + 0.8; x += 0.13) if (Math.abs(h.x - x) < 0.035) return -1;
    }
    return undefined;
  });
  const r = 0.12;
  m.prismX([[-half, z0], [half, z0], [half, z1 - r], [half - r, z1], [-half + r, z1], [-half, z1 - r]], x0, x1, hood);
  const g: Mat = {
    ramp: body,
    tex: (h) => {
      if (h.nx < 0.9) return undefined;
      if (Math.abs(h.y) > half - 0.12 || h.z < z0 + 0.1 || h.z > z1 - 0.08) return undefined;
      if (st === "wreck") return SOOT[0];
      return Math.floor((h.y + 2) * 22) % 2 ? DARK[0] : toneOf(body, 1);
    },
  };
  m.box(x1, x1 + 0.06, -half + 0.06, half - 0.06, z0 + 0.04, z1 - 0.04, g);
}

function lamps(m: Mesh, st: VehicleState, x: number, y: number, z: number, r: number): void {
  for (const sgn of [1, -1]) {
    m.newPart();
    const shell = st === "wreck" ? flat(SOOT) : flat(GREY);
    const lens: Mat = st === "wreck" ? flat(DARK) : { ramp: [LENS, LENS], tex: (h) => (h.z > z + r * 0.2 ? DARK[1] : undefined) }; // blackout hood
    m.cylX(sgn * y, z, r, x - 0.16, x, 6, shell, lens);
  }
}

function prisonTruck(st: VehicleState): Mesh {
  const m = new Mesh();
  const seed = 29, top = 2.8;
  const sink = st === "wreck" ? 0.12 : 0;
  const r = 0.47, fx = 2.3, rx = -1.8;
  wheelPair(m, fx, r, 0.76, 1.0, st, GREY, DARK);
  wheelPair(m, rx, r, 0.56, 1.02, st, GREY, DARK);
  const bodyStart = m.mark();

  m.newPart();
  m.box(-3.1, 3.1, -0.46, 0.46, 0.5, 0.86, flat(DARK, 0));
  m.box(-3.36, -3.22, -0.95, 0.95, 0.7, 0.82, flat(SOOT));

  // front mudguards and cab steps
  m.newPart();
  const wing = paint(GREY, st, seed, top);
  for (const sgn of [1, -1]) {
    const y0 = sgn > 0 ? 0.64 : -1.1, y1 = sgn > 0 ? 1.1 : -0.64;
    m.prismY(arch(fx, r, r + 0.07, 0.62, 0.72, 0.66), y0, y1, wing);
    m.box(0.98, 1.68, sgn > 0 ? 0.98 : -1.12, sgn > 0 ? 1.12 : -0.98, 0.62, 0.68, wing);
  }

  hoodAndGrille(m, st, seed, top, GREY, 2.05, 3.1, 0.56, 0.86, 1.62);
  lamps(m, st, 2.98, 0.84, 1.36, 0.13);
  cab(m, st, seed, top, GREY, { front: 2.08, back: 0.95, half: 1.02, z0: 0.86, z1: 2.42, glassZ: [1.74, 2.26], split: true }, false);

  // the windowless box body with its rear double doors, and two mushroom vents on the roof
  m.newPart();
  const open = st === "doors_open";
  const box = paint(GREY, st, seed, top, (h) => {
    if (Math.abs(h.ny) > 0.9) {
      if (h.z < 1.08) return -1;
      if (Math.abs(h.z - 1.42) < 0.05) return -1; // rub rail
      const u = ((h.x + 3.25) % 0.58 + 0.58) % 0.58;
      if (u < 0.05) return 1; // ribs catch the light
      if (u < 0.1) return -1;
      return undefined;
    }
    if (h.nx < -0.9) {
      if (open) {
        if (h.z < 1.14) return toneOf(C.wood, 0);
        if (Math.abs(h.y) > 0.95 && h.z < 1.7 && h.z > 1.2) return DARK[2]; // benches
        return S.glass_dark;
      }
      if (Math.abs(h.y) < 0.03) return S.outline; // the doors meet
      if (Math.abs(Math.abs(h.y) - 0.14) < 0.035 && h.z > 1.55 && h.z < 2.25) return CHROME[0]; // handles
      if (Math.abs(Math.abs(h.y) - 1.08) < 0.05 && (Math.abs(h.z - 1.35) < 0.06 || Math.abs(h.z - 2.45) < 0.06)) return DARK[1]; // hinges
      if (h.z > 2.62) return -1;
      return undefined;
    }
    if (h.nz > 0.9 && Math.abs(Math.abs(h.y) - 1.1) < 0.04) return -1; // roof edge
    return undefined;
  });
  m.box(-3.25, 0.82, -1.15, 1.15, 1.0, 2.8, box);
  for (const x of [-2.4, -1.0]) m.cylZ(x, 0, 0.16, 2.8, 2.94, 6, paint(GREY, st, seed, top));
  for (const sgn of [1, -1]) m.dot([-3.27, sgn * 1.02, 1.12], st === "wreck" ? SOOT[0] : RED_LAMP);

  if (open) {
    // the rear doors swing out past square
    for (const sgn of [1, -1]) {
      m.newPart();
      const mk = m.mark();
      const leaf = paint(GREY, st, seed, top, (h) => (Math.abs(Math.abs(h.y) - 0.14) < 0.035 && h.z > 1.55 && h.z < 2.25 && h.nx < -0.9 ? CHROME[0] : undefined));
      m.box(-3.3, -3.25, sgn > 0 ? 0 : -1.15, sgn > 0 ? 1.15 : 0, 1.02, 2.78, leaf);
      m.rotZ(mk, -3.25, sgn * 1.15, sgn * -1.75);
    }
  }
  if (sink) m.move(bodyStart, [0, 0, -sink]);
  return m;
}

function germanTruck(st: VehicleState): Mesh {
  const m = new Mesh();
  const seed = 43, top = 2.8;
  const sink = st === "wreck" ? 0.12 : 0;
  const r = 0.46, fx = 2.05, rx = -1.55;
  wheelPair(m, fx, r, 0.74, 0.98, st, GREY, DARK);
  wheelPair(m, rx, r, 0.54, 0.98, st, GREY, DARK);
  const bodyStart = m.mark();

  m.newPart();
  m.box(-2.9, 2.9, -0.44, 0.44, 0.52, 0.84, flat(DARK, 0));

  // the Blitz's big round front wings sweeping into the running boards
  m.newPart();
  const wing = paint(GREY, st, seed, top);
  for (const sgn of [1, -1]) {
    const y0 = sgn > 0 ? 0.62 : -1.08, y1 = sgn > 0 ? 1.08 : -0.62;
    m.prismY(arch(fx, r, r + 0.08, 0.66, 0.8, 1.05), y0, y1, wing);
  }

  hoodAndGrille(m, st, seed, top, GREY, 1.75, 2.88, 0.52, 0.84, 1.58);
  lamps(m, st, 2.72, 0.76, 1.24, 0.12);
  const openCab = st === "doors_open";
  cab(m, st, seed, top, GREY, { front: 1.78, back: 0.62, half: 1.0, z0: 0.84, z1: 2.22, glassZ: [1.6, 2.08], split: true }, openCab);

  // cargo bed: floor and wooden drop sides painted grey
  m.newPart();
  const boards = paint(GREY, st, seed + 1, top, (h) => {
    if (Math.abs(h.ny) > 0.9 || Math.abs(h.nx) > 0.9) {
      const v = h.z - 1.14;
      if (v > 0.14 && v < 0.18) return -1;
      if (v > 0.29 && v < 0.33) return -1;
      if (h.z < 1.15) return -1;
    }
    return undefined;
  });
  m.box(-3.0, 0.52, -1.15, 1.15, 1.02, 1.14, boards);
  const burnt = st === "wreck";
  const sideTop = burnt ? 1.44 : 1.58;
  m.box(-3.0, 0.52, 1.09, 1.15, 1.14, sideTop, boards);
  m.box(-3.0, 0.52, -1.15, -1.09, 1.14, sideTop, boards);
  m.box(-3.0, -2.94, -1.09, 1.09, 1.14, sideTop, boards);
  m.box(0.46, 0.52, -1.09, 1.09, 1.14, 1.58, boards);
  for (const sgn of [1, -1]) m.dot([-3.02, sgn * 1.0, 1.08], burnt ? SOOT[0] : RED_LAMP);

  // canvas cover on its bows, or the bare bows once it has burnt away
  const coverProf: Prof = [[-1.12, 1.56], [1.12, 1.56], [1.12, 2.42], [1.0, 2.62], [0.62, 2.76], [-0.62, 2.76], [-1.0, 2.62], [-1.12, 2.42]];
  m.newPart();
  if (burnt) {
    for (const x of [-2.92, -2.05, -1.18, -0.31, 0.44]) {
      for (let i = 0; i < coverProf.length; i++) {
        const a = coverProf[i], b = coverProf[(i + 1) % coverProf.length];
        if (a[1] < 1.6 && b[1] < 1.6) continue;
        m.seg([x, a[0], a[1]], [x, b[0], b[1]], SOOT[0], 0.01);
      }
    }
  } else {
    const canvas = paint(CANVAS, st, seed + 2, top, (h) => {
      if (Math.abs(h.nx) > 0.9) {
        if (h.nx < 0 && Math.abs(h.y) < 0.03 && h.z < 2.6) return -1; // the lacing of the rear flap
        return h.z < 1.7 ? -1 : undefined;
      }
      const u = ((h.x + 3.0) % 0.87 + 0.87) % 0.87;
      if (u < 0.06) return -1; // a bow under the canvas
      if (u > 0.36 && u < 0.5 && h.nz > 0.3) return -1; // sag between the bows
      if (h.z < 1.64) return -1; // the tie-down edge
      return undefined;
    }, { burns: true });
    m.prismX(coverProf, -3.0, 0.5, canvas);
  }
  if (sink) m.move(bodyStart, [0, 0, -sink]);
  return m;
}

// ---------------------------------------------------------------- tram

function tram(st: VehicleState): Mesh {
  const m = new Mesh();
  const seed = 61, top = 3.2;
  const open = st === "doors_open";
  const cream: Ramp = [C.plaster_cream[0], C.tram_cream[0], C.tram_cream[1]];

  // running gear
  m.newPart();
  m.box(-2.7, 2.7, -0.86, 0.86, 0.34, 0.74, flat(DARK, 0));
  for (const x of [-1.8, 1.8]) wheelPair(m, x, 0.42, 0.6, 0.76, st === "wreck" ? "intact" : st, SOOT, DARK);
  for (const sgn of [1, -1]) {
    m.newPart();
    m.box(sgn > 0 ? 5.3 : -5.46, sgn > 0 ? 5.46 : -5.3, -0.55, 0.55, 0.3, 0.42, flat(SOOT)); // lifeguard
  }

  // the body: one tapered prism, livery and windows painted by height and by face
  m.newPart();
  const plan: Prof = [[-4.9, -1.1], [4.9, -1.1], [5.35, -0.62], [5.35, 0.62], [4.9, 1.1], [-4.9, 1.1], [-5.35, 0.62], [-5.35, -0.62]];
  const winZ: [number, number] = [1.64, 2.36];
  const body: Mat = {
    ramp: C.tram,
    tex: (h) => {
      const side = Math.abs(h.ny) > 0.9;
      const end = Math.abs(h.nx) > 0.9;
      const ax = Math.abs(h.x);
      // folding doors on both sides of both platforms
      if (side && ax > 4.05 && ax < 4.8 && h.z > 0.76 && h.z < 2.44) {
        if (open) return h.z < 0.95 ? toneOf(DARK, 2) : insideColour(h, st);
        if (h.z > 1.64 && h.z < 2.36 && Math.abs(ax - 4.425) > 0.05) return glassColour(h, st);
        if (Math.abs(ax - 4.425) < 0.05) return S.outline;
      }
      if (h.z > winZ[0] && h.z < winZ[1]) {
        if (side && ax < 3.82) {
          const u = ((h.x + 3.82) % 1.09 + 1.09) % 1.09;
          if (u > 0.2) return glassColour(h, st);
        } else if (!side && (end ? Math.abs(h.y) < 0.52 : true)) {
          if (!end || Math.abs(h.y) > 0.05) return glassColour(h, st);
        }
      }
      if (end && Math.abs(h.y) < 0.12 && Math.abs(h.z - 1.32) < 0.07) return st === "wreck" ? SOOT[0] : LENS; // headlamp
      if (end && Math.abs(h.y) < 0.34 && h.z > 2.5 && h.z < 2.84) {
        // the route plate: a number on white enamel
        if (st === "wreck") return SOOT[0];
        return Math.abs(h.y) < 0.2 && h.z > 2.58 && h.z < 2.76 && Math.floor((h.y + 1) * 20) % 3 === 0 ? S.outline : S.chalk;
      }
      const r = weathered(h.z >= 1.52 ? cream : C.tram, h, st, seed, top);
      if (Math.abs(h.z - 1.52) < 0.05 || Math.abs(h.z - 2.5) < 0.04) return toneOf(r, h.t - 1);
      if (h.z < 0.84) return toneOf(r, h.t - 1);
      return toneOf(r, h.t);
    },
  };
  m.prismZ(plan, 0.72, 2.9, body, null, null);

  // tarred roof, the lighter clerestory with its vents, bow collector, route boxes
  m.newPart();
  const roofPlan: Prof = plan.map(([x, y]) => [x * 1.01, y * 1.02]);
  m.prismZ(roofPlan, 2.9, 3.0, paint(C.tram, st, seed, top), null, paint(SOOT, st, seed + 5, top));
  m.prismX([[-0.78, 3.0], [0.78, 3.0], [0.66, 3.2], [-0.66, 3.2]], -3.6, 3.6, paint(C.tin_roof, st, seed + 5, top, (h) => {
    if (Math.abs(h.ny) > 0.5 && h.nz < 0.9) {
      const u = ((h.x + 3.6) % 0.9 + 0.9) % 0.9;
      return u > 0.25 && u < 0.65 ? (st === "burning" ? FIRE[0] : S.glass) : undefined;
    }
    return undefined;
  }));
  m.newPart();
  const iron = st === "wreck" ? SOOT[0] : S.outline;
  m.box(0.55, 1.05, -0.4, 0.4, 3.2, 3.3, flat(SOOT));
  for (const sgn of [1, -1]) m.seg([0.9, sgn * 0.34, 3.3], [-0.1, sgn * 0.3, 4.02], iron, 0.01);
  m.seg([-0.1, -0.58, 4.02], [-0.1, 0.58, 4.02], iron, 0.01);
  m.seg([0.9, -0.34, 3.3], [0.9, 0.34, 3.3], iron, 0.01);
  return m;
}

export function vehicleMesh(kind: VehicleKind, st: VehicleState): Mesh {
  switch (kind) {
    case "car": return car(st);
    case "prison_truck": return prisonTruck(st);
    case "german_truck": return germanTruck(st);
    case "tram": return tram(st);
  }
}
