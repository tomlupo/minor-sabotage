// Troopers (style guide §6): a pixel puppet. Heads and headgear are hand-written templates per
// facing (troopers-heads.ts), the part that must read; torso, limbs and weapons are posed in a
// small body space (forward, right, up), projected per facing, rasterised into a 24 x 24 slot
// cel (troopers-raster.ts) and outlined. One pose table drives all five facings, so the
// silhouette stays the same from frame to frame and from facing to facing.
//
// Frame names are `${anim}_${facing}_${i}`; the cell is TROOPER_CELL (24 x 24, feet at 12, 22).
// The game mirrors the e-side frames for the west.
import { PAL, type RGB, type Ramp } from "./palette";
import { img, type Frame, type PixelImage, type Sheet } from "./pixel";
import { Cel, CH, CW, DOWN, LEFT, OUTLINE, RIGHT, UP, charMap, slotSet, tpl, type Tpl } from "./troopers-raster";
import { headTpl } from "./troopers-heads";
import {
  ANIM_FRAMES,
  FACINGS,
  TROOPER_CELL,
  type Anim,
  type Facing,
  type TrooperLook,
  type TrooperSheetBuilder,
  type Weapon,
} from "./types";

// ------------------------------------------------------------------------------ slots

const J0 = 2, J1 = 3, J2 = 4; // jacket / coat
const T0 = 5, T1 = 6, T2 = 7; // trousers (stockings for women)
const K0 = 8, K1 = 9, EYE = 10; // skin
const R0 = 11, R1 = 12, R2 = 13; // hair
const H0 = 14, H1 = 15, H2 = 16, HK = 17, HV = 18; // headgear, band, visor
const B0 = 19, B1 = 20, BELT = 21, BUCKLE = 22; // boots, belt
const M0 = 23, M1 = 24; // gun metal
const W0 = 25, W1 = 26, W2 = 46; // gun wood
const AW = 27, AR = 28; // armband
const P0 = 29, P1 = 30; // pack, bag, pouch
const RED = 32; // the sapper's charge
const G0 = 33, G1 = 34, WICK = 35; // petrol bottles
const BN0 = 36, BN1 = 37, BR0 = 38, BR1 = 39, BLOOD = 40; // Rudy
const GR0 = 41, GR1 = 42; // grenade
const TAG = 43, STEEL = 44, SHIRT = 45; // driver tag, knife blade, shirt collar
const NSLOT = 47;

/** What an inner line may darken: cloth and legs, never a gun, a hand or a face. */
const CLOTH = slotSet([J0, J1, J2, T0, T1, T2, SHIRT, BELT, BUCKLE, B0, B1, P0, P1]);

const HEAD_MAP = charMap({
  o: OUTLINE, r: R1, R: R0, q: R2, s: K1, S: K0, e: EYE, h: H1, D: H0, H: H2, k: HK, K: HV,
  w: BN1, W: BN0, x: BLOOD, b: BR0, B: BR1, t: TAG,
});

// ------------------------------------------------------------------------------ looks → colours

const tr = PAL.troopers;
const city = PAL.city_1943;
const three = (r: Ramp): Ramp => (r.length >= 3 ? [r[0], r[1], r[2]] : [r[0], r[0], r[1]]);

/** Hair, dark to light (style guide §3: existing ramps, no new colours). */
const HAIRS: Ramp[] = [city.soot, tr.headgear.hat, tr.headgear.cap, city.wood, city.plaster_ochre];
/** Partisan trousers: dark civilian cloth. */
const TROUSERS: Ramp[] = [city.soot, tr.headgear.hat, tr.partisan_jackets[2], tr.partisan_jackets[0]];
/** Civilian coats and scarves. */
const COATS_M: Ramp[] = [tr.headgear.hat, city.soot, tr.partisan_jackets[1], tr.partisan_jackets[2], city.cloth];
const COATS_F: Ramp[] = [city.plaster_green, tr.partisan_jackets[3], city.cloth, tr.partisan_jackets[1], tr.partisan_jackets[2]];
const SCARVES_LIGHT: Ramp[] = [city.cloth, three(city.tram_cream), city.plaster_ochre];
const SCARVES_DARK: Ramp[] = [tr.partisan_jackets[3], tr.headgear.cap, city.plaster_green, tr.partisan_jackets[2]];
const SCARVES: Ramp[] = [...SCARVES_LIGHT, ...SCARVES_DARK];
const luma = (c: RGB): number => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];

interface Look {
  /** Head templates by facing, resolved once per sheet. */
  heads: Record<Facing, Tpl>;
  look: TrooperLook;
  lut: (RGB | undefined)[];
  /** Hair style index for bare heads. */
  hair: number;
  /** Coat hem height (u) for long coats, 0 for jackets. */
  hem: number;
  /** Women: a skirt below the coat, stockinged legs. */
  skirt: boolean;
  /** Civilian clothes with a shirt collar at the neck. */
  shirt: boolean;
  belt: boolean;
}

function hashSeed(n: number): number {
  let h = (n | 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

function resolveLook(look: TrooperLook): Look {
  const seed = hashSeed(look.seed ?? 0);
  const L: (RGB | undefined)[] = new Array(NSLOT);
  const put = (base: number, r: Ramp) => { const t = three(r); L[base] = t[0]; L[base + 1] = t[1]; L[base + 2] = t[2]; };
  const jackets = tr.partisan_jackets;
  const ji = (((look.jacket ?? 0) % jackets.length) + jackets.length) % jackets.length;
  L[OUTLINE] = PAL.shared.outline;
  L[K0] = tr.skin[0];
  L[K1] = tr.skin[1];
  L[EYE] = tr.eye;
  L[B0] = tr.boots;
  L[B1] = tr.headgear.cap[0];
  L[BELT] = tr.belt;
  L[BUCKLE] = tr.rifle[1];
  L[M0] = tr.rifle[0];
  L[M1] = tr.rifle[1];
  L[W0] = city.wood[0];
  L[W1] = city.wood[1];
  L[W2] = city.wood[2];
  L[AW] = tr.armband.white;
  L[AR] = tr.armband.red;
  L[P0] = tr.belt;
  L[P1] = tr.pack;
  L[RED] = PAL.shared.poppy_red;
  L[G0] = PAL.forest.pine[1];
  L[G1] = PAL.forest.pine[3];
  L[WICK] = PAL.shared.chalk;
  L[BN0] = city.cloth[1];
  L[BN1] = city.cloth[2];
  L[BR0] = city.puddle[1];
  L[BR1] = city.cut_cap[1];
  L[BLOOD] = city.tram[1];
  L[GR0] = tr.headgear.helmet_wz31[0];
  L[GR1] = tr.headgear.helmet_wz31[1];
  L[TAG] = PAL.shared.chalk;
  L[STEEL] = city.stone_grey[2];
  L[SHIRT] = city.cloth[2];
  put(R0, HAIRS[seed % HAIRS.length]);
  let hem = 0;
  let skirt = false;
  let shirt = true;
  let belt = true;
  let hair = (seed >>> 8) % 2;
  let coat: Ramp | null = null;
  /** A scarf or hat that stands off the coat: a dark one over a light coat and the other way. */
  const scarf = (): Ramp => {
    const list = !coat ? SCARVES : luma(coat[1]) >= 140 ? SCARVES_DARK : SCARVES_LIGHT;
    return list[(seed >>> 16) % list.length];
  };

  switch (look.body) {
    case "partisan": {
      put(J0, jackets[ji]);
      let ti = (seed >>> 4) % TROUSERS.length;
      if (TROUSERS[ti] === jackets[ji]) ti = (ti + 1) % TROUSERS.length;
      put(T0, TROUSERS[ti]);
      break;
    }
    case "occupier":
      put(J0, tr.occupier_field_grey);
      put(T0, tr.occupier_field_grey);
      L[B0] = tr.occupier_boots;
      L[B1] = city.soot[1];
      L[BELT] = tr.occupier_belt;
      L[SHIRT] = tr.occupier_field_grey[0];
      shirt = false;
      hem = 3.2;
      break;
    case "prisoner":
      put(J0, tr.prisoner_coat);
      put(T0, tr.headgear.hat);
      hair = 2;
      hem = 4.2;
      belt = false;
      break;
    case "civilian_m": {
      put(J0, COATS_M[(ji + (seed >>> 4)) % COATS_M.length]);
      put(T0, city.soot);
      hem = 3.4;
      belt = false;
      if ((seed >>> 12) % 4 === 0) put(R0, city.stone_grey);
      break;
    }
    case "civilian_f": {
      coat = COATS_F[(ji + (seed >>> 4)) % COATS_F.length];
      put(J0, coat);
      L[T0] = tr.skin[0];
      L[T1] = tr.skin[0];
      L[T2] = tr.skin[1];
      hem = 2.8;
      skirt = true;
      belt = false;
      shirt = false;
      break;
    }
  }
  // headgear colours
  const g = look.headgear;
  if (g === "cap") put(H0, [tr.headgear.cap, tr.headgear.hat, city.soot, tr.partisan_jackets[2]][(seed >>> 16) % 4]);
  else if (g === "hat") put(H0, look.body === "civilian_f" ? scarf() : tr.headgear.hat);
  else if (g === "beret") put(H0, [city.soot, tr.partisan_jackets[2], tr.headgear.hat][(seed >>> 16) % 3]);
  else if (g === "helmet_wz31") put(H0, tr.headgear.helmet_wz31);
  else if (g === "stahlhelm" || g === "stahlhelm_big") put(H0, tr.headgear.stahlhelm);
  else if (g === "peaked_cap") {
    put(H0, tr.occupier_field_grey);
    L[HK] = city.soot[0];
    L[HV] = tr.occupier_boots;
  } else if (g === "headscarf") put(H0, scarf());
  else put(H0, tr.headgear.hat);
  if (g === "hat") L[HK] = city.soot[0];
  if (L[HK] === undefined) L[HK] = L[H0];
  if (L[HV] === undefined) L[HV] = L[H0];
  const heads = {} as Record<Facing, Tpl>;
  for (const f of FACINGS) heads[f] = headTpl(f, look.headgear, hair, !!look.beaten, look.kit === "driver_tag");
  return { look, lut: L, hair, hem, skirt, shirt, belt, heads };
}

// ------------------------------------------------------------------------------ views

type V3 = [number, number, number]; // forward, right, up (art px)

interface View {
  fx: number; rx: number; fy: number; ry: number;
  /** The forward depth factor on the ground plane (feet and knees): smaller than `fy`, so a
   *  stride toward the camera stays inside the one row the cell has below the anchor. */
  fyG: number;
  /** depth = df*f + dr*r; larger is nearer the camera (drawn later). */
  df: number; dr: number;
  /** Torso width on screen. */
  tw: number;
  /** Which way the sten's magazine sticks out (the shooter's left), on screen. */
  mag: [number, number];
  /** How much of a weapon's outward yaw this view uses. */
  yawK: number;
  /** Where the chest's centre is, as a signed offset across the torso (+ toward the light). */
  chest: number | null;
}
const VIEWS: Record<Facing, View> = {
  e: { fx: 1, rx: 0, fy: 0, fyG: 0, ry: 0.24, df: 0.05, dr: 1, tw: 6, mag: [0, -1], yawK: 0, chest: -2.5 },
  se: { fx: 0.8, rx: -0.45, fy: 0.5, fyG: 0.3, ry: 0.24, df: 1, dr: 1, tw: 7, mag: [1, -1], yawK: 0.3, chest: -1 },
  s: { fx: 0, rx: -1, fy: 0.6, fyG: 0.45, ry: 0, df: 1, dr: 0, tw: 8, mag: [1, 0], yawK: 1, chest: 0 },
  ne: { fx: 0.8, rx: 0.45, fy: -0.5, fyG: -0.3, ry: 0.24, df: -1, dr: 1, tw: 7, mag: [-1, -1], yawK: 0.3, chest: null },
  n: { fx: 0, rx: 1, fy: -0.6, fyG: -0.45, ry: 0, df: -1, dr: 0, tw: 8, mag: [-1, 0], yawK: 1, chest: null },
};
const OX = 12;
const GY = 21.5;

const proj = (v: View, p: V3): [number, number] => [OX + v.fx * p[0] + v.rx * p[1], GY - p[2] + v.fy * p[0] + v.ry * p[1]];
/** Feet and knees: the ground-plane depth factor, and never below the cell's last sole row. */
const projG = (v: View, p: V3): [number, number] => [OX + v.fx * p[0] + v.rx * p[1], Math.min(SOLE_MAX, GY - p[2] + v.fyG * p[0] + v.ry * p[1])];
/** The lowest a sole may sit: row 22, so its outline still fits on row 23. */
const SOLE_MAX = 22.99;
const depth = (v: View, p: V3): number => v.df * p[0] + v.dr * p[1];

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: V3): number => Math.sqrt(dot(a, a));
const rad = (d: number) => (d * Math.PI) / 180;

/** Two-bone joint: where the knee or elbow goes, bending toward `pole`. */
function joint(a: V3, b: V3, l1: number, l2: number, pole: V3): V3 {
  const d = sub(b, a);
  const dist = len(d);
  if (dist < 1e-6) return add(a, mul(pole, l1 / Math.max(1e-6, len(pole))));
  if (dist >= l1 + l2) return add(a, mul(d, l1 / (l1 + l2)));
  const x = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist);
  const h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
  const dn = mul(d, 1 / dist);
  let p = sub(pole, mul(dn, dot(pole, dn)));
  const pl = len(p);
  p = pl > 1e-6 ? mul(p, 1 / pl) : [0, 0, 1];
  return add(add(a, mul(dn, x)), mul(p, h));
}

// ------------------------------------------------------------------------------ poses

interface Leg {
  /** Sole position (forward, height above ground). */
  f: number;
  u: number;
  /** Explicit knee (forward, up) for kneeling and lying, else it bends forward. */
  knee?: [number, number];
}
type GunState = "hold" | "aim" | "slung" | "ground" | "fly" | "none";
type Item = "grenade" | "bottle" | "knife";

interface Pose {
  /** Pelvis: forward, height of the hip joints. */
  hf: number;
  hu: number;
  /** Torso pitch in degrees: + leans forward, - back, ±90 lying. */
  tilt: number;
  legs: [Leg, Leg]; // left, right
  gun: GunState;
  /** Gun pitch and yaw offsets in degrees, and a grip offset from the weapon's default. */
  pitch?: number;
  yaw?: number;
  grip?: V3;
  /** Hands off the gun (body space, relative to the pelvis): left, right. */
  hands?: [V3, V3];
  /** Head offset (forward, up). */
  head?: [number, number];
  item?: Item;
  /** Lying and falling poses are drawn on the east axis, with the head turned. */
  lie?: boolean;
  /** Lying but alive: the head stays upright, looking along the body. */
  headUp?: boolean;
  /** Binoculars raised to the eyes (the scout's idle). */
  binos?: boolean;
}

const LEG_W = 2; // hip half-width
const SH_W = 3; // shoulder half-width
const TORSO = 6.4; // pelvis to neck
const SHOULDER = 5.2; // pelvis to shoulder line

const hang: [V3, V3] = [[0.3, -3.2, 1.2], [0.3, 3.2, 1.2]];

const POSES = new Map<string, Pose>();

/** The pose for a frame, memoised: it depends on the animation, the frame and a few look flags. */
function poseFor(anim: Anim, i: number, lk: Look): Pose {
  const l = lk.look;
  const key = `${anim}${i}${l.weapon === "none" ? 0 : 1}${l.body === "prisoner" ? 1 : 0}${l.beaten ? 1 : 0}${l.kit === "binoculars" ? 1 : l.kit === "bottle_bag" ? 2 : 0}`;
  let p = POSES.get(key);
  if (!p) POSES.set(key, (p = makePose(anim, i, lk)));
  return p;
}

function makePose(anim: Anim, i: number, lk: Look): Pose {
  const look = lk.look;
  const armed = look.weapon !== "none";
  const gun: GunState = armed ? "hold" : "none";
  const sl: GunState = armed ? "slung" : "none";
  const prisoner = look.body === "prisoner";
  const beaten = !!look.beaten;
  switch (anim) {
    case "idle": {
      if (look.kit === "binoculars") {
        // the scout's idle: glasses up, looking; the gun slung
        return { hf: 0, hu: 5.5, tilt: 0, legs: [{ f: 0, u: 0 }, { f: 0, u: 0 }], gun: sl, hands: [[2.2, -1.6, 9.6], [2.2, 1.6, 9.6]], binos: true };
      }
      if (prisoner) return { hf: 0, hu: 5.4, tilt: 6, legs: [{ f: 0, u: 0 }, { f: 0, u: 0 }], gun: "none", hands: [[1.8, -0.7, 1.9], [1.8, 0.7, 1.9]], head: [0.4, beaten ? -0.6 : -0.3] };
      return { hf: 0, hu: 5.5, tilt: 0, legs: [{ f: 0, u: 0 }, { f: 0, u: 0 }], gun, hands: hang };
    }
    case "walk": {
      // Cannon Fodder's walk: a long scissor at the contacts, the swing knee lifted high on the
      // passing frames, and the whole body a full pixel down on the contacts (4.4 and 5.4
      // straddle a row; passing stays at the idle height so a hat never leaves the cell).
      const st = prisoner ? 2.4 : 3.4; // stride
      const lift = prisoner ? 1.4 : 2; // swing foot height
      const sw = armed ? 0 : prisoner ? 1.4 : 2.2; // arm swing
      const lo = 4.4, hi = 5.4;
      const P: Pose[] = [
        { hf: 0, hu: lo, tilt: 4, legs: [{ f: st, u: 0 }, { f: -st + 0.4, u: 0.6 }], gun, hands: [[-sw, -3, 1.6], [sw, 3, 1.6]] },
        { hf: 0, hu: hi, tilt: 4, legs: [{ f: 0.2, u: 0 }, { f: -0.6, u: lift }], gun, hands: [[-0.3, -3.2, 1.3], [0.3, 3.2, 1.3]] },
        { hf: 0, hu: lo, tilt: 4, legs: [{ f: -st + 0.4, u: 0.6 }, { f: st, u: 0 }], gun, hands: [[sw, -3, 1.6], [-sw, 3, 1.6]] },
        { hf: 0, hu: hi, tilt: 4, legs: [{ f: -0.6, u: lift }, { f: 0.2, u: 0 }], gun, hands: [[0.3, -3.2, 1.3], [-0.3, 3.2, 1.3]] },
      ];
      const p = P[i];
      if (prisoner) { p.head = [0.4, -0.3]; p.tilt = 8; }
      if (beaten) {
        // Rudy can hardly walk: he drops onto his bad right leg, drags it, and hangs his head
        p.head = [0.5, -0.6];
        p.tilt = 12;
        if (i === 2) p.hu = 4.2;
        if (i === 3) { p.hu = 5.2; p.legs[0].u = 1.2; }
      }
      return p;
    }
    case "fire": {
      if (!armed) {
        // unarmed: hands up
        return { hf: 0, hu: 5.5, tilt: -4, legs: [{ f: 0.6, u: 0 }, { f: -0.6, u: 0 }], gun: "none", hands: [[0.2, -3.4, 8.6], [0.2, 3.4, 8.6]], head: [0, 0.2] };
      }
      return i === 0
        ? { hf: 0.3, hu: 5.2, tilt: 8, legs: [{ f: 2, u: 0 }, { f: -2, u: 0 }], gun: "aim", yaw: 0 }
        : { hf: -0.2, hu: 5.3, tilt: 0, legs: [{ f: 2, u: 0 }, { f: -2, u: 0 }], gun: "aim", yaw: 0, grip: [-1, 0, 0.3], pitch: 14, head: [-0.5, 0] };
    }
    case "throw": {
      const it: Item = look.kit === "bottle_bag" ? "bottle" : "grenade";
      const P: Pose[] = [
        { hf: -0.3, hu: 5.3, tilt: -12, legs: [{ f: 2.2, u: 0 }, { f: -2, u: 0 }], gun: sl, hands: [[3, -2.4, 5], [-4.4, 4.2, 5.2]], head: [-0.4, 0], item: it },
        { hf: 0.4, hu: 5.0, tilt: 10, legs: [{ f: 2.8, u: 0 }, { f: -1.8, u: 0.6 }], gun: sl, hands: [[-1.5, -2.8, 3], [3.8, 2.8, 7.6]], item: it },
        { hf: 0.8, hu: 4.8, tilt: 22, legs: [{ f: 2.8, u: 0 }, { f: -0.6, u: 0.9 }], gun: sl, hands: [[-2, -2.8, 2.2], [4.6, 1.6, 2.8]] },
      ];
      return P[i];
    }
    case "knife": {
      const P: Pose[] = [
        { hf: 0.5, hu: 4.8, tilt: 12, legs: [{ f: 3.6, u: 0 }, { f: -2.6, u: 0.3 }], gun: sl, hands: [[3.4, -1.4, 4.2], [-1, 2.8, 3.2]], item: "knife" },
        { hf: 1, hu: 4.5, tilt: 22, legs: [{ f: 3.6, u: 0 }, { f: -3, u: 0.4 }], gun: sl, hands: [[1.6, -2.4, 4], [5.2, 1.2, 4.2]], item: "knife" },
        { hf: 0.3, hu: 5.3, tilt: 6, legs: [{ f: 1.6, u: 0 }, { f: -1.6, u: 0 }], gun: sl, hands: [[1.8, -2.4, 3.2], [2.2, 2.6, 2.8]], item: "knife" },
      ];
      return P[i];
    }
    case "kneel": {
      // down on the right knee, the left foot planted, both hands at work on the ground ahead
      const legs: [Leg, Leg] = [{ f: 2.6, u: 0, knee: [2.8, 3.4] }, { f: -3.2, u: 0.1, knee: [-0.2, 0.3] }];
      return i === 0
        ? { hf: 0, hu: 3.2, tilt: 30, legs, gun: sl, hands: [[3.8, -2.6, -0.4], [4.2, 2.6, 0.2]], head: [0.6, -0.4] }
        : { hf: 0, hu: 3.2, tilt: 34, legs, gun: sl, hands: [[4.4, -2.6, 0.2], [3.6, 2.6, -0.6]], head: [0.8, -1.1] };
    }
    case "death": {
      // hit, twist, fall, lie. The body ends across the cell, centred on the anchor: the feet
      // kick forward as he goes over backwards.
      const fly: GunState = armed ? "fly" : "none";
      const down: GunState = armed ? "ground" : "none";
      const P: Pose[] = [
        { hf: -0.3, hu: 4.6, tilt: -14, legs: [{ f: 1, u: 0 }, { f: -0.6, u: 1 }], gun: fly, pitch: 50, hands: [[-0.5, -3.6, 7.4], [0.5, 3.6, 8]], head: [-0.3, -0.4] },
        { hf: -0.4, hu: 3.4, tilt: -32, legs: [{ f: 1.8, u: 0 }, { f: 0.8, u: 0.8 }], gun: fly, pitch: 110, hands: [[-3, -3.6, 5.8], [-1.2, 3.8, 7.2]], head: [-0.6, 0] },
        { hf: 2, hu: 3.6, tilt: -58, legs: [{ f: 5.2, u: 0.8 }, { f: 6.2, u: 2.6 }], gun: fly, pitch: 160, hands: [[-3.6, -3, 5.4], [-1.8, 3.4, 6.8]], lie: true },
        { hf: 3.4, hu: 4, tilt: -90, legs: [{ f: 7.2, u: 1.4 }, { f: 7.8, u: 2.6 }], gun: down, hands: [[-1.6, -3, 4.2], [1, 3.4, 3.2]], head: [0, 0.6], lie: true },
        { hf: 3.4, hu: 3.6, tilt: -90, legs: [{ f: 7.4, u: 0.2 }, { f: 8, u: 0.6 }], gun: down, hands: [[1.2, -3, 1], [1.8, 3.4, 1.6]], lie: true },
      ];
      return P[i];
    }
    case "prone": {
      // wounded, down, alive: head up, a knee raised, a hand on the wound, breathing
      const down: GunState = armed ? "ground" : "none";
      const legs: [Leg, Leg] = [{ f: 7, u: 0.2, knee: [5.2, 4] }, { f: 8, u: 0.4 }];
      return i === 0
        ? { hf: 3.4, hu: 3.6, tilt: -68, legs, gun: down, hands: [[-1.8, -3, 0.2], [2, 3.4, 3.4]], lie: true, headUp: true, head: [0.4, -0.6] }
        : { hf: 3.4, hu: 3.6, tilt: -64, legs, gun: down, hands: [[-1.8, -3, 0.2], [2, 3.4, 4]], lie: true, headUp: true, head: [0.4, -0.2] };
    }
  }
}

function mirrorFwd(p: Pose): Pose {
  const leg = (l: Leg): Leg => ({ f: -l.f, u: l.u, knee: l.knee ? [-l.knee[0], l.knee[1]] : undefined });
  const hand = (h: V3): V3 => [-h[0], h[1], h[2]];
  return {
    ...p,
    hf: -p.hf,
    tilt: -p.tilt,
    pitch: p.pitch !== undefined ? 180 - p.pitch : undefined,
    legs: [leg(p.legs[0]), leg(p.legs[1])],
    hands: p.hands ? [hand(p.hands[0]), hand(p.hands[1])] : undefined,
    head: p.head ? [-p.head[0], p.head[1]] : undefined,
  };
}

// ------------------------------------------------------------------------------ weapons

interface GunDef {
  /** Slots along the gun from butt to muzzle. */
  body: number[];
  /** A second, lit pixel along part of the gun (from, to, slot), so it reads as a solid. */
  hi?: [number, number, number];
  grip: number;
  fore: number;
  mag?: { at: number; kind: "side" | "down"; n: number };
  /** Grip offset from the pelvis when held (hold) and aimed (aim). */
  hold: V3;
  aim: V3;
  holdPitch: number;
  /** Held a little outward so the gun shows beside the body in the front and back views. */
  holdYaw: number;
  aimYaw: number;
}
const GUNS: Record<Exclude<Weapon, "none">, GunDef> = {
  sten: { body: [M0, M0, M0, M0, M0, M0, M0, M1], hi: [2, 5, M1], grip: 2, fore: 5, mag: { at: 4, kind: "side", n: 2 }, hold: [1.6, 2.4, 2.4], aim: [1.4, 2.2, 3.4], holdPitch: -6, holdYaw: 34, aimYaw: 12 },
  mp40: { body: [M0, M0, M0, M0, M0, M0, M0, M1], hi: [1, 4, M1], grip: 2, fore: 4, mag: { at: 3, kind: "down", n: 3 }, hold: [1.6, 2.4, 2.4], aim: [1.4, 2.2, 3.4], holdPitch: -6, holdYaw: 34, aimYaw: 12 },
  rifle: { body: [W0, W1, W1, W0, W1, W1, W1, W0, M0, M0, M0, M1], hi: [0, 2, W2], grip: 3, fore: 7, hold: [0.6, 2, 2.6], aim: [0.4, 1.8, 4.8], holdPitch: -12, holdYaw: 18, aimYaw: 6 },
  pistol: { body: [M0, M0, M1], grip: 0, fore: 0, hold: [2.8, 2.6, 3.2], aim: [4.6, 1.6, 4.6], holdPitch: -14, holdYaw: 0, aimYaw: 0 },
};

interface GunGeo {
  /** Screen points of each unit along the gun, butt to muzzle, then one past the muzzle. */
  pts: [number, number][];
  muzzle: [number, number];
  gripB: V3;
  foreB: V3;
  def: GunDef;
  z: number;
  /** Mostly horizontal on screen. */
  flat: boolean;
}

function gunGeo(v: View, pose: Pose, pel: V3, w: Exclude<Weapon, "none">): GunGeo | null {
  const def = GUNS[w];
  if (pose.gun !== "hold" && pose.gun !== "aim" && pose.gun !== "fly") return null;
  let grip = pose.gun === "aim" ? def.aim : def.hold;
  if (pose.grip) grip = add(grip, pose.grip);
  const pitch = rad((pose.pitch ?? 0) + (pose.gun === "hold" ? def.holdPitch : 0));
  // Held out to the side only where the body would hide it: the front and back views.
  const yaw = rad(pose.yaw ?? (pose.gun === "hold" ? def.holdYaw : pose.gun === "aim" ? def.aimYaw : 0) * v.yawK);
  const g = add(pel, grip);
  const dirB: V3 = [Math.cos(pitch) * Math.cos(yaw), Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch)];
  const o = proj(v, g);
  const tip = proj(v, add(g, dirB));
  const dx = tip[0] - o[0], dy = tip[1] - o[1];
  const pts: [number, number][] = [];
  for (let k = 0; k <= def.body.length; k++) {
    const t = k - def.grip;
    pts.push([o[0] + dx * t, o[1] + dy * t]);
  }
  return {
    pts,
    muzzle: pts[def.body.length],
    gripB: g,
    foreB: add(g, mul(dirB, def.fore - def.grip)),
    def,
    z: depth(v, add(g, mul(dirB, 2))),
    flat: Math.abs(dx) >= Math.abs(dy),
  };
}

/** The gun: a 1 px line, lit along the receiver, magazine out, and a dark line under it where
 *  it crosses the body, so it reads as a thing held and not as a seam in the coat. */
function drawGun(cel: Cel, v: View, gg: GunGeo): void {
  const { pts, def } = gg;
  const n = def.body.length;
  for (let k = 0; k < n; k++) cel.set(Math.floor(pts[k][0]), Math.floor(pts[k][1]), def.body[k]);
  if (def.hi) {
    const [a, b, slot] = def.hi;
    for (let k = a; k <= b && k < n; k++) {
      const x = Math.floor(pts[k][0]), y = Math.floor(pts[k][1]);
      if (gg.flat) cel.set(x, y - 1, slot); else cel.set(x - 1, y, slot);
    }
  }
  if (def.mag) {
    const [bx, by] = pts[def.mag.at];
    const md: [number, number] = def.mag.kind === "down" ? [0, 1] : v.mag;
    for (let k = 1; k <= def.mag.n; k++) cel.set(Math.floor(bx) + md[0] * k, Math.floor(by) + md[1] * k, M0);
  }
  cel.edge(DOWN | RIGHT, CLOTH);
}

// ------------------------------------------------------------------------------ small parts

const BOOT = {
  side: tpl(["bb.", "bbB"], 0, 1),
  front: tpl(["bb", "bb"], 0, 1),
  up: tpl(["B.", "bb", "bb"], 0, 2), // lying on the back, toes up
};
const BOOT_MAP = charMap({ b: B0, B: B1 });

/** The scout's binoculars at his eyes, anchored on the head's anchor column and eye row. */
const BINOS = {
  s: tpl(["M.M..M.M", "mmmmmmmm", ".h....h."], 4, 1),
  se: tpl(["M.M.M.", "mmmmmm", "h....h"], 1, 1),
  e: tpl(["Mm", "mm", "h."], -3, 1),
};
const BINO_MAP = charMap({ M: M1, m: M0, h: K1 });

// ------------------------------------------------------------------------------ the frame

interface Part {
  z: number;
  draw: () => void;
}

function drawFrame(cel: Cel, lk: Look, facing: Facing, anim: Anim, i: number): void {
  drawAt(cel, lk, facing, anim, i, 0, 0);
  fit(cel, lk, facing, anim, i);
  cel.outline();
}

/**
 * A lying body is as long as the cell is wide, and a turned head sticks out on its sides: nudge
 * it until the whole figure, outline included, is inside the cell. A falling man may also drift
 * sideways; every other frame stands still on its anchor.
 */
function fit(cel: Cel, lk: Look, facing: Facing, anim: Anim, i: number): void {
  const pose = poseFor(anim, i, lk);
  const vertical = !!pose.lie;
  if (!vertical && anim !== "death") return;
  let ox = 0, oy = 0;
  for (let k = 0; k < 4; k++) {
    const b = cel.bbox();
    if (!b) return;
    const dx = b[0] < 1 ? 1 : b[2] > CW - 2 ? -1 : 0;
    const dy = !vertical ? 0 : b[1] < 1 ? 1 : b[3] > CH - 2 ? -1 : 0;
    if (!dx && !dy) return;
    ox += dx;
    oy += dy;
    drawAt(cel, lk, facing, anim, i, ox, oy);
  }
}

function drawAt(cel: Cel, lk: Look, facing: Facing, anim: Anim, i: number, ox: number, oy: number): void {
  cel.clear();
  const look = lk.look;
  let pose = poseFor(anim, i, lk);
  // Everyone falls back except the north facing, who falls forward, away from the camera: his
  // upright frames jerk forward, and his lying frames are the east ones face down, mirrored.
  const fallFwd = facing === "n" && (anim === "death" || anim === "prone");
  if (fallFwd && !pose.lie) pose = mirrorFwd(pose);
  // Seen from behind, leaning away cancels sinking down (the head goes up the screen as it
  // drops): kneel lower and more upright there, or he reads as standing.
  if (anim === "kneel" && (facing === "n" || facing === "ne")) pose = { ...pose, hu: 2.4, tilt: pose.tilt - 18 };
  const lying = !!pose.lie;
  const faceDown = fallFwd && lying;
  // lying bodies are drawn across the screen: they read far better than foreshortened ones
  const v = lying ? VIEWS.e : VIEWS[facing];
  // the north face-down frames are mirrored at the end, so their nudge is mirrored too
  const sx = faceDown ? -ox : ox;
  const P = (p: V3): [number, number] => { const q = proj(v, p); return [q[0] + sx, q[1] + oy]; };
  const PG = (p: V3): [number, number] => { const q = projG(v, p); return [q[0] + sx, q[1] + oy]; };

  const pel: V3 = [pose.hf, 0, pose.hu];
  const tr_ = rad(pose.tilt);
  const axis: V3 = [Math.sin(tr_), 0, Math.cos(tr_)];
  const neck = add(pel, mul(axis, TORSO));
  const shC = add(pel, mul(axis, SHOULDER));
  const parts: Part[] = [];
  const long = lk.hem > 0;
  const armed = look.weapon !== "none";

  // legs, always first: nothing of the body is behind them
  for (let s = 0; s < 2; s++) {
    const side = s === 0 ? -1 : 1;
    const leg = pose.legs[s];
    const hip: V3 = [pel[0], side * LEG_W, pel[2]];
    const ankle: V3 = [leg.f, side * LEG_W, leg.u + 2];
    const knee: V3 = leg.knee ? [leg.knee[0], side * LEG_W, leg.knee[1]] : joint(hip, ankle, 2.1, 1.9, [1, 0, 0.2]);
    const z = -100 + depth(v, [leg.f * 0.2, side * LEG_W, 0]);
    const near = v.dr === 0 || side > 0;
    parts.push({
      z,
      draw: () => {
        const a = near ? T1 : T0, b = T0;
        const [hx, hy] = P(hip), [kx, ky] = PG(knee), [ax, ay0] = PG(ankle);
        const sole = PG([leg.f, side * LEG_W, leg.u]);
        const ay = Math.min(ay0, sole[1] - 1); // a clamped sole pulls its ankle along
        if (lk.skirt) {
          cel.line(kx, ky, ax, ay, near ? T2 : T1);
        } else {
          cel.limb(hx, hy, kx, ky, a, b);
          cel.limb(kx, ky, ax, ay, a, b);
        }
        if (near && v.dr !== 0) cel.edge(LEFT | RIGHT, CLOTH);
        const bx = Math.floor(ax - 0.5), by = Math.floor(sole[1]);
        if (lying) cel.stamp(BOOT.up, Math.floor(sole[0]), Math.floor(ay), BOOT_MAP, pose.tilt > 0);
        else if (v.fx > 0.5) cel.stamp(BOOT.side, bx, by, BOOT_MAP);
        else cel.stamp(BOOT.front, bx, by, BOOT_MAP);
      },
    });
  }

  // torso, and the coat below the belt
  parts.push({
    z: 0,
    draw: () => {
      const [px_, py_] = P(pel), [nx, ny] = P(neck);
      const w = lying ? v.tw - 1 : v.tw;
      const chest = lying ? null : v.chest;
      obox(cel, px_, py_, nx, ny, w, w, (t, s, e) => {
        if (lk.belt && !long && t < 0.13 && !lying) return BELT;
        if (chest !== null && t > 0.8 && Math.abs(s - chest) < 1.01) return lk.shirt ? SHIRT : J0;
        if (lk.shirt && chest === 0 && t > 0.14 && s <= 0 && s > -1) return J0;
        if (e < 1 && s > 0) return J2;
        if (e < 1 && s < 0) return J0;
        return J1;
      });
      if (long) {
        // the coat's skirt, to the hem, flaring with the stride
        const k0 = P([pose.legs[0].f * 0.35 + pel[0] * 0.65, 0, lk.hem]);
        const k1 = P([pose.legs[1].f * 0.35 + pel[0] * 0.65, 0, lk.hem]);
        const hx = (k0[0] + k1[0]) / 2, hy = Math.max(k0[1], k1[1]);
        const flare = Math.abs(k0[0] - k1[0]) * 0.8;
        if (!lying) {
          obox(cel, px_, py_ - 0.5, hx, hy, w, w + 1 + flare * 0.7, (t, s, e) => {
            if (e < 1 && s > 0) return J2;
            if (e < 1 && s < 0) return J0;
            return t > 0.8 ? J0 : J1;
          });
        }
        if (lk.belt && !lying) {
          const [bx, by] = P(add(pel, [0, 0, 0.9]));
          for (let x = Math.round(bx - w / 2); x < Math.round(bx + w / 2); x++) cel.set(x, Math.floor(by), BELT);
          if (v.chest !== null) cel.set(Math.floor(bx - v.chest * 0.5), Math.floor(by), BUCKLE);
          if (look.body === "occupier" && v.chest !== null) {
            // cartridge pouches either side of the buckle: a soldier's belt, no insignia
            const offs = v.chest === 0 ? [-3, 2] : v.chest > -2 ? [-2, 2] : [1];
            for (const o of offs) cel.rect(Math.floor(bx) + o, Math.floor(by), 2, 2, BELT);
          }
        }
      }
    },
  });

  if (pose.binos && (facing === "s" || facing === "se" || facing === "e")) {
    // binoculars at the eyes, over the head, with the hands that hold them
    parts.push({
      z: 1.5,
      draw: () => {
        const [hx, hy] = P(neck);
        const x0 = Math.floor(hx), y0 = Math.floor(hy - 0.5) - 3; // the eye row
        const t = BINOS[facing as "s" | "se" | "e"];
        cel.stamp(t, x0, y0, BINO_MAP);
        cel.edge(DOWN | LEFT | RIGHT, CLOTH);
      },
    });
  }

  // head
  parts.push({
    z: 1,
    draw: () => {
      const h = pose.head ?? [0, 0];
      const [hx, hy] = P(add(neck, [h[0], 0, h[1]]));
      const t = lk.heads[lying ? "e" : facing];
      // lying: the top of the head toward the left, face up (a quarter turn back) or face down
      // (a quarter turn forward, mirrored); the wounded man keeps his head up
      const turned = lying && !pose.headUp && pose.tilt <= -50;
      const rot = turned ? (faceDown ? 1 : 3) : 0;
      cel.stamp(t, Math.floor(hx), Math.floor(hy - 0.5), HEAD_MAP, turned && faceDown, rot);
    },
  });

  // gun
  const w = look.weapon;
  const gg = w !== "none" ? gunGeo(v, pose, pel, w) : null;
  if (gg) parts.push({ z: gg.z, draw: () => drawGun(cel, v, gg) });
  if (armed && pose.gun === "slung") {
    const top = add(pel, [-2.4, -2.2, 7.4]);
    const bot = add(pel, [-2.4, 1.8, 1.2]);
    parts.push({
      z: depth(v, [-2.4, 0, 0]) - 0.5,
      draw: () => {
        const [ax, ay] = P(top), [bx, by] = P(bot);
        cel.line(ax, ay, bx, by, M0);
        cel.set(Math.floor(ax), Math.floor(ay), M1);
      },
    });
  }
  // arms; hands that hold the gun are drawn on top of it
  const onGun = !!gg && (pose.gun === "hold" || pose.gun === "aim" || pose.gun === "fly");
  for (let s = 0; s < 2; s++) {
    const side = s === 0 ? -1 : 1;
    const sh = add(shC, [0, side * SH_W, 0]);
    const free = add(pel, pose.hands ? pose.hands[s] : hang[s]);
    let hand = free;
    let gripping = false;
    if (onGun && gg) {
      if (side > 0) { hand = gg.gripB; gripping = true; }
      else if (gg.def.fore !== gg.def.grip && !(v.dr === 0 && pose.gun === "hold")) { hand = gg.foreB; gripping = true; }
    }
    const elbow = joint(sh, hand, 2.6, 2.4, [-1, side * 0.9, -0.5]);
    const [sx] = P(sh);
    // screen-left limbs catch the light
    const lit = v.dr === 0 ? sx < OX : side > 0;
    const z = v.dr === 0 ? 0.5 * Math.sign(v.df) : side * 3 * v.dr + (side > 0 ? 0.1 : 0);
    parts.push({
      z,
      draw: () => {
        const a = lit ? J2 : J1, b = lit ? J1 : J0;
        const [sx2, sy2] = P(sh), [ex, ey] = P(elbow), [hx, hy] = P(hand);
        cel.limb(sx2, sy2, ex, ey, a, b);
        cel.limb(ex, ey, hx, hy, a, b);
        if (!gripping) cel.set(Math.floor(hx), Math.floor(hy), K1);
        cel.edge(DOWN | (v.dr === 0 && !lit ? LEFT : RIGHT), CLOTH);
        if (look.armband && (v.dr === 0 ? side < 0 : side > 0)) {
          const mx = sx2 * 0.55 + ex * 0.45, my = sy2 * 0.55 + ey * 0.45;
          const bx = Math.floor(mx - 0.5), by = Math.floor(my - 0.5);
          cel.set(bx, by, AW); cel.set(bx + 1, by, AW);
          cel.set(bx, by + 1, AR); cel.set(bx + 1, by + 1, AR);
        }
        if (!gripping && pose.item && side > 0) drawItem(cel, pose.item, Math.floor(hx), Math.floor(hy), v);
      },
    });
    if (gripping) {
      parts.push({
        z: Math.max(gg!.z, z) + 0.05,
        draw: () => { const [hx, hy] = P(hand); cel.set(Math.floor(hx), Math.floor(hy), K1); },
      });
    }
  }

  // kit
  const kit = look.kit;
  if (kit === "charge_pack" && v.df > 0 && !lying) {
    parts.push({
      z: 5,
      draw: () => {
        const [cx, cy] = P(add(pel, [0.6, -3.3, 0.9]));
        const x = Math.floor(cx) - 1, y = Math.floor(cy);
        cel.rect(x, y - 1, 2, 1, P0);
        cel.rect(x, y, 2, 2, RED);
        cel.edge(DOWN | LEFT | RIGHT | UP, CLOTH);
      },
    });
  }
  if (kit === "charge_pack") {
    parts.push({
      z: depth(v, [-2.6, 0, 0]) - (v.dr > 0 ? 0.3 : 0),
      draw: () => {
        const c = P(add(shC, [-2.4, 0, -1.8]));
        const x = Math.floor(c[0]) - 2, y = Math.floor(c[1]) - 2;
        cel.rect(x, y, 4, 4, P1);
        cel.rect(x, y + 3, 4, 1, P0);
        cel.rect(x + 1, y + 1, 2, 2, RED);
      },
    });
  } else if (kit === "bottle_bag") {
    parts.push({
      z: depth(v, [0.3, 3.2, 0]) + 0.5,
      draw: () => {
        const c = P(add(pel, [0.3, 3.2, 0.6]));
        const x = Math.floor(c[0]) - 1, y = Math.floor(c[1]) - 1;
        cel.rect(x, y, 3, 3, P1);
        cel.rect(x, y + 2, 3, 1, P0);
        cel.set(x, y - 1, G1); cel.set(x, y - 2, WICK);
        cel.set(x + 2, y - 1, G0); cel.set(x + 2, y - 2, G1);
      },
    });
  } else if (kit === "binoculars" && !pose.binos && !lying) {
    // hanging on the chest from the neck: two barrels and a glint
    parts.push({
      z: depth(v, [2, 0, 0]) + 0.4,
      draw: () => {
        const c = P(add(shC, [1.9, 0, -1.4]));
        const x = Math.floor(c[0]), y = Math.floor(c[1]);
        cel.rect(x - 1, y, 3, 2, M0);
        cel.set(x - 1, y, M1); cel.set(x + 1, y, M1);
        cel.edge(DOWN | LEFT | RIGHT, CLOTH);
      },
    });
  } else if (kit === "grenade_pouch") {
    parts.push({
      z: depth(v, [1.4, 2, 0]) + 0.4,
      draw: () => {
        const c = P(add(pel, [1.4, 2.2, 1]));
        const x = Math.floor(c[0]), y = Math.floor(c[1]);
        cel.set(x, y, P1); cel.set(x + 1, y, P1); cel.set(x, y - 1, GR1); cel.set(x + 1, y - 1, GR0);
      },
    });
  }

  parts.sort((a, b) => a.z - b.z);
  for (const p of parts) {
    cel.begin();
    p.draw();
  }
  if (faceDown) cel.flipX();
}

function drawItem(cel: Cel, item: Item, x: number, y: number, v: View): void {
  if (item === "grenade") {
    cel.set(x, y - 1, GR1);
    cel.set(x + 1, y - 1, GR0);
    cel.set(x, y - 2, M1);
    cel.set(x + 1, y - 2, GR1);
  } else if (item === "bottle") {
    cel.set(x, y - 1, G1);
    cel.set(x, y - 2, G0);
    cel.set(x, y - 3, WICK);
  } else {
    const dx = v.fx > 0.3 ? 1 : v.fx < -0.3 ? -1 : 0;
    const dy = dx === 0 ? (v.fy > 0 ? 1 : -1) : 0;
    cel.set(x + dx, y + dy, STEEL);
    cel.set(x + 2 * dx, y + 2 * dy, STEEL);
  }
}

/**
 * Oriented box from a (t = 0) to b (t = 1), width w0 at a and w1 at b. `shade(t, s, e)` picks
 * the slot: s is the signed distance from the axis, positive on the lit side (toward the top
 * left, style guide §4), and e the distance to the nearest long edge in pixels.
 */
function obox(cel: Cel, ax: number, ay: number, bx: number, by: number, w0: number, w1: number, shade: (t: number, s: number, e: number) => number): void {
  const dx = bx - ax, dy = by - ay;
  const L = Math.sqrt(dx * dx + dy * dy) || 1;
  const ux = dx / L, uy = dy / L;
  // the normal that points toward the light (up-left)
  let nx = -uy, ny = ux;
  if (nx + ny > 0) { nx = -nx; ny = -ny; }
  const wm = Math.max(w0, w1) / 2 + 1;
  const x0 = Math.floor(Math.min(ax, bx) - wm), x1 = Math.ceil(Math.max(ax, bx) + wm);
  const y0 = Math.floor(Math.min(ay, by) - wm), y1 = Math.ceil(Math.max(ay, by) + wm);
  for (let y = Math.max(0, y0); y <= Math.min(CH - 1, y1); y++) {
    for (let x = Math.max(0, x0); x <= Math.min(CW - 1, x1); x++) {
      const px_ = x + 0.5 - ax, py_ = y + 0.5 - ay;
      const t = (px_ * ux + py_ * uy) / L;
      if (t < 0 || t > 1) continue;
      const s = px_ * nx + py_ * ny;
      const hw = (w0 + (w1 - w0) * t) / 2;
      if (Math.abs(s) > hw) continue;
      cel.set(x, y, shade(t, s, hw - Math.abs(s)));
    }
  }
}

// ------------------------------------------------------------------------------ the sheet

/** Frames per second and looping, per animation (the game's animation table). */
export const TROOPER_ANIMS: Record<Anim, { fps: number; loop: boolean }> = {
  idle: { fps: 1, loop: true },
  walk: { fps: 8, loop: true },
  fire: { fps: 12, loop: true },
  throw: { fps: 10, loop: false },
  death: { fps: 9, loop: false },
  prone: { fps: 2, loop: true },
  knife: { fps: 10, loop: false },
  kneel: { fps: 3, loop: true },
};

const ANIMS = Object.keys(ANIM_FRAMES) as Anim[];
const PER_FACING = ANIMS.reduce((n, a) => n + ANIM_FRAMES[a], 0);

/** One row per facing, the animations left to right: `${anim}_${facing}_${i}`. */
export const buildTrooperSheet: TrooperSheetBuilder = (look: TrooperLook): Sheet => {
  const lk = resolveLook(look);
  const { w, h, ax, ay } = TROOPER_CELL;
  const image = img(w * PER_FACING, h * FACINGS.length);
  const frames: Frame[] = [];
  const cel = new Cel();
  FACINGS.forEach((facing, row) => {
    let col = 0;
    for (const anim of ANIMS) {
      for (let i = 0; i < ANIM_FRAMES[anim]; i++, col++) {
        drawFrame(cel, lk, facing, anim, i);
        const x = col * w, y = row * h;
        cel.writeRGBA(lk.lut, image, x, y);
        frames.push({ name: `${anim}_${facing}_${i}`, x, y, w, h, ax, ay });
      }
    }
  });
  return { image, frames };
};

/** Muzzle position in cell pixels on fire frame 0 (the shot), per weapon and facing, for the
 *  game's muzzle flash. On fire frame 1 the weapon has kicked back. */
export const MUZZLE: Record<"sten" | "pistol" | "rifle" | "mp40", Record<Facing, [number, number]>> = (() => {
  const out = {} as Record<"sten" | "pistol" | "rifle" | "mp40", Record<Facing, [number, number]>>;
  for (const wpn of ["sten", "pistol", "rifle", "mp40"] as const) {
    const m = {} as Record<Facing, [number, number]>;
    const lk = resolveLook({ body: "partisan", headgear: "cap", weapon: wpn, kit: "none" });
    for (const f of FACINGS) {
      const pose = poseFor("fire", 0, lk);
      const g = gunGeo(VIEWS[f], pose, [pose.hf, 0, pose.hu], wpn)!;
      m[f] = [Math.floor(g.muzzle[0]), Math.floor(g.muzzle[1])];
    }
    out[wpn] = m;
  }
  return out;
})();

/** A look's colours by name (all palette colours), so portraits match the sprite exactly. */
export interface TrooperColours {
  outline: RGB;
  skin: [RGB, RGB];
  eye: RGB;
  hair: [RGB, RGB, RGB];
  gear: [RGB, RGB, RGB];
  band: RGB;
  visor: RGB;
  coat: [RGB, RGB, RGB];
  shirt: RGB;
  armband: [RGB, RGB];
  bandage: [RGB, RGB];
  bruise: [RGB, RGB];
  blood: RGB;
  tag: RGB;
  metal: [RGB, RGB];
  belt: RGB;
}
export function trooperColours(look: TrooperLook): TrooperColours {
  const L = resolveLook(look).lut as RGB[];
  return {
    outline: L[OUTLINE],
    skin: [L[K0], L[K1]],
    eye: L[EYE],
    hair: [L[R0], L[R1], L[R2]],
    gear: [L[H0], L[H1], L[H2]],
    band: L[HK],
    visor: L[HV],
    coat: [L[J0], L[J1], L[J2]],
    shirt: L[SHIRT],
    armband: [L[AW], L[AR]],
    bandage: [L[BN0], L[BN1]],
    bruise: [L[BR0], L[BR1]],
    blood: L[BLOOD],
    tag: L[TAG],
    metal: [L[M0], L[M1]],
    belt: L[BELT],
  };
}

/** A head alone, as the frame draws it, outlined (art lab). */
function headImage(look: TrooperLook, facing: Facing): PixelImage {
  const lk = resolveLook(look);
  const cel = new Cel();
  const t = headTpl(facing, look.headgear, lk.hair, !!look.beaten, look.kit === "driver_tag");
  cel.stamp(t, 12, 12, HEAD_MAP);
  cel.outline();
  const full = img(CW, CH);
  cel.writeRGBA(lk.lut, full, 0, 0);
  const out = img(16, 14);
  for (let y = 0; y < 14; y++) for (let x = 0; x < 16; x++) {
    const s = ((y + 2) * CW + (x + 4)) * 4, d = (y * 16 + x) * 4;
    for (let k = 0; k < 4; k++) out.data[d + k] = full.data[s + k];
  }
  return out;
}

/** Exposed for the art lab and tests. */
export const __trooperInternals = { resolveLook, drawFrame, headImage, PER_FACING, Cel };
