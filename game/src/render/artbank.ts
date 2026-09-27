// Turns the art generators (src/art/*, drawn as code) into Phaser textures at boot. Each
// generator is looked up by file at runtime, and a plain stand-in drawn from the palette is
// used while one is missing, so the game runs at every stage of the art.
import Phaser from "phaser";
import type { PixelImage, Sheet, Frame } from "../art/pixel";
import { img, rect, ellipse, outline, toCanvas, packCells, px, line, poly, hline } from "../art/pixel";
import { PAL, mix } from "../art/palette";
import type {
  TrooperLook, BuildingArt, BuildingSpec, GroundGrid, PropKind, PropState, PropArt, VehicleKind, VehicleState, Facing, Anim,
} from "../art/types";
import { ANIM_FRAMES, FACINGS, TROOPER_CELL } from "../art/types";

type Mod = Record<string, unknown>;
const MODS = import.meta.glob<Mod>("../art/**/*.ts", { eager: true });
function fn<T>(file: string, name: string): T | null {
  const m = MODS[`../art/${file}`];
  const f = m?.[name];
  return typeof f === "function" ? (f as T) : null;
}
function val<T>(file: string, name: string): T | null {
  const m = MODS[`../art/${file}`];
  return (m?.[name] as T) ?? null;
}

export const art = {
  trooper: () => fn<(l: TrooperLook) => Sheet>("troopers.ts", "buildTrooperSheet"),
  portrait: () => fn<(l: TrooperLook, seed: number) => PixelImage>("portraits.ts", "buildPortrait"),
  trooperAnims: () => val<Record<Anim, { fps: number; loop: boolean }>>("troopers.ts", "TROOPER_ANIMS"),
  muzzle: () => val<Record<string, Record<Facing, [number, number]>>>("troopers.ts", "MUZZLE"),
  ground: () => fn<(g: GroundGrid, seed: number) => PixelImage>("city/ground.ts", "paintGround"),
  building: () => fn<(s: BuildingSpec) => BuildingArt>("city/buildings.ts", "buildBuilding"),
  arsenal: () => fn<(s: BuildingSpec & { courtyard?: { x: number; y: number; w: number; d: number } }) => BuildingArt>("city/arsenal.ts", "buildArsenal"),
  prop: () => fn<(k: PropKind, s: PropState, v?: number | string) => PropArt>("props.ts", "buildProp"),
  poleWire: () => val<[number, number]>("props.ts", "POLE_WIRE_POINT"),
  vehicle: () => fn<(k: VehicleKind, s: VehicleState) => Sheet>("vehicles.ts", "buildVehicleSheet"),
  fx: () => fn<() => Sheet>("fx.ts", "buildFxSheet"),
};

export const DEFAULT_ANIMS: Record<Anim, { fps: number; loop: boolean }> = {
  idle: { fps: 1, loop: true },
  walk: { fps: 9, loop: true },
  fire: { fps: 14, loop: true },
  throw: { fps: 9, loop: false },
  death: { fps: 10, loop: false },
  prone: { fps: 2, loop: true },
  knife: { fps: 9, loop: false },
  kneel: { fps: 3, loop: true },
};

// ------------------------------------------------------------------ registering textures

/** Add a sheet as a Phaser texture with named frames. */
export function addSheet(scene: Phaser.Scene, key: string, sheet: Sheet): void {
  if (scene.textures.exists(key)) scene.textures.remove(key);
  const tex = scene.textures.addCanvas(key, toCanvas(sheet.image))!;
  for (const f of sheet.frames) tex.add(f.name, 0, f.x, f.y, f.w, f.h);
}

export function addImage(scene: Phaser.Scene, key: string, im: PixelImage): void {
  if (scene.textures.exists(key)) scene.textures.remove(key);
  scene.textures.addCanvas(key, toCanvas(im));
}

// ------------------------------------------------------------------ troopers

const trooperFallback = (look: TrooperLook): Sheet => {
  const T = PAL.troopers;
  const jacket = look.body === "occupier" ? T.occupier_field_grey : look.body === "prisoner" ? T.prisoner_coat : T.partisan_jackets[(look.jacket ?? 0) % T.partisan_jackets.length];
  const head = look.headgear === "stahlhelm" || look.headgear === "stahlhelm_big" ? T.headgear.stahlhelm : look.headgear === "hat" ? T.headgear.hat : T.headgear.cap;
  const cells: { name: string; im: PixelImage; ax: number; ay: number }[] = [];
  for (const [anim, n] of Object.entries(ANIM_FRAMES) as [Anim, number][]) {
    for (const f of FACINGS) {
      for (let i = 0; i < n; i++) {
        const im = img(TROOPER_CELL.w, TROOPER_CELL.h);
        const lying = anim === "death" ? i >= 2 : anim === "prone";
        if (lying) {
          rect(im, 5, 18, 14, 4, jacket[1]);
          rect(im, 17, 17, 4, 4, head[1]);
        } else {
          const bob = anim === "walk" ? (i % 2) : 0;
          const kneel = anim === "kneel" ? 4 : 0;
          rect(im, 9, 12 + bob + kneel, 6, 7 - kneel, jacket[1]);
          rect(im, 9, 12 + bob + kneel, 2, 7 - kneel, jacket[2]);
          if (!kneel) { rect(im, 9, 19, 2, 3 - (anim === "walk" && i % 2 ? 1 : 0), T.boots); rect(im, 13, 19, 2, 3 - (anim === "walk" && i % 2 ? 0 : 1), T.boots); }
          rect(im, 9, 7 + bob + kneel, 6, 5, T.skin[1]);
          rect(im, 8, 5 + bob + kneel, 8, 3, head[1]);
          rect(im, 8, 5 + bob + kneel, 8, 1, head[2]);
          const dx = f === "e" || f === "ne" || f === "se" ? 1 : 0;
          if (f !== "n") px(im, 11 + dx * 2, 9 + bob + kneel, T.eye);
          if (look.weapon !== "none") rect(im, dx ? 14 : 10, 15 + bob + kneel, dx ? 6 : 2, 1, T.rifle[0]);
          if (look.armband) { px(im, 9, 13 + bob + kneel, T.armband.white); px(im, 9, 14 + bob + kneel, T.armband.red); }
        }
        outline(im, PAL.shared.outline);
        cells.push({ name: `${anim}_${f}_${i}`, im, ax: TROOPER_CELL.ax, ay: TROOPER_CELL.ay });
      }
    }
  }
  return packCells(cells, 24);
};

/** Dotted white silhouettes of every frame (tinted gold or red when behind a roof). */
function silhouetteSheet(sheet: Sheet): Sheet {
  const out = img(sheet.image.w, sheet.image.h);
  const s = sheet.image;
  const white: [number, number, number] = [255, 255, 255];
  for (let y = 0; y < s.h; y++) {
    for (let x = 0; x < s.w; x++) {
      const a = s.data[(y * s.w + x) * 4 + 3];
      if (!a) continue;
      // edge pixels of the figure, every other one
      const edge = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
        const xx = x + dx, yy = y + dy;
        return xx < 0 || yy < 0 || xx >= s.w || yy >= s.h || !s.data[(yy * s.w + xx) * 4 + 3];
      });
      if (edge && (x + y) % 2 === 0) px(out, x, y, white);
    }
  }
  return { image: out, frames: sheet.frames };
}

export interface TrooperTex {
  key: string;
  silKey: string;
  frames: Map<string, Frame>;
}

export function buildTrooper(scene: Phaser.Scene, key: string, look: TrooperLook): TrooperTex {
  const b = art.trooper();
  let sheet: Sheet;
  try { sheet = b ? b(look) : trooperFallback(look); } catch (e) { console.warn("trooper art failed", key, e); sheet = trooperFallback(look); }
  addSheet(scene, `tr:${key}`, sheet);
  addSheet(scene, `trs:${key}`, silhouetteSheet(sheet));
  return { key: `tr:${key}`, silKey: `trs:${key}`, frames: new Map(sheet.frames.map((f) => [f.name, f])) };
}

export function buildPortraitTexture(scene: Phaser.Scene, key: string, look: TrooperLook, seed: number): string {
  const b = art.portrait();
  let im: PixelImage;
  if (b) {
    try { im = b(look, seed); } catch { im = img(24, 28); }
  } else {
    im = img(24, 28);
    const T = PAL.troopers;
    rect(im, 4, 16, 16, 12, (look.body === "prisoner" ? T.prisoner_coat : T.partisan_jackets[(look.jacket ?? 0) % 4])[1]);
    ellipse(im, 12, 11, 6, 7, T.skin[1]);
    rect(im, 6, 3, 12, 4, T.headgear.cap[1]);
    px(im, 10, 11, T.eye); px(im, 14, 11, T.eye);
    outline(im, PAL.shared.outline);
  }
  addImage(scene, `pt:${key}`, im);
  return `pt:${key}`;
}

// ------------------------------------------------------------------ ground

const MAT_FALLBACK: Record<string, readonly [number, number, number]> = {
  road: PAL.city_1943.cobble[1], walk: PAL.city_1943.pavement[1], yard: PAL.city_1943.slush[0],
  rail_ew: PAL.city_1943.cobble[1], rail_ns: PAL.city_1943.cobble[1], under: PAL.city_1943.soot[0], square: PAL.forest.grass[1],
};

export function paintGroundImage(grid: GroundGrid, seed: number): PixelImage {
  const p = art.ground();
  if (p) {
    try { return p(grid, seed); } catch (e) { console.warn("ground art failed", e); }
  }
  const im = img(grid.w * 12, grid.h * 9);
  for (let cy = 0; cy < grid.h; cy++) {
    for (let cx = 0; cx < grid.w; cx++) {
      const m = grid.legend[grid.cells[cy * grid.w + cx]];
      const c = MAT_FALLBACK[m] ?? PAL.city_1943.cobble[0];
      rect(im, cx * 12, cy * 9, 12, 9, (cx + cy) % 2 ? c : mix(c, PAL.shared.outline, 0.06));
      if (m === "rail_ew") hline(im, cx * 12, cx * 12 + 11, cy * 9 + 4, PAL.city_1943.rail);
    }
  }
  return im;
}

// ------------------------------------------------------------------ buildings

export function buildingArt(spec: BuildingSpec & { kind?: string; courtyard?: { x: number; y: number; w: number; d: number } }): BuildingArt {
  const h = spec.storeys * 3.2 + 0.8;
  if (spec.kind === "arsenal") {
    const a = art.arsenal();
    if (a) { try { return a(spec); } catch (e) { console.warn("arsenal art failed", e); } }
  }
  const b = art.building();
  if (b) { try { return b(spec); } catch (e) { console.warn("building art failed", spec.id, e); } }
  // stand-in: a roof above a wall with a window grid
  const W = spec.w * 12, RD = spec.d * 9, WH = Math.round(h * 7.5);
  const full = img(W, RD + WH);
  const plaster = spec.plaster === "brick" ? PAL.city_1943.brick : spec.plaster === "green" ? PAL.city_1943.plaster_green : spec.plaster === "cream" ? PAL.city_1943.plaster_cream : spec.plaster === "stone" ? PAL.city_1943.stone_grey : PAL.city_1943.plaster_ochre;
  const roof = spec.roof === "tile" ? PAL.city_1943.brick : PAL.city_1943.tin_roof;
  rect(full, 0, 0, W, RD, roof[1]);
  rect(full, 0, 0, W, 2, roof[2]);
  rect(full, 0, RD, W, WH, plaster[1]);
  for (let s = 0; s < spec.storeys; s++) {
    for (let wx = 4; wx + 10 < W; wx += 18) rect(full, wx, RD + 8 + s * 24, 10, 11, PAL.shared.glass);
  }
  for (const g of spec.front?.gateways ?? []) rect(full, g * 12, RD + WH - 26, 36, 26, PAL.city_1943.soot[0]);
  outline(full, PAL.shared.outline, "br");
  let cut: PixelImage | undefined;
  if (spec.cuttable) {
    cut = img(W, RD + WH);
    const top = RD + WH - 8 - RD;
    rect(cut, 0, top, W, RD, PAL.city_1943.wood[1]);
    rect(cut, 0, top, W, 2, PAL.city_1943.cut_cap[1]);
    rect(cut, 0, top + RD, W, 8, plaster[0]);
    for (let x = 0; x < W; x += 3) { px(cut, x, 0, PAL.shared.ghost, 204); px(cut, x, RD, PAL.shared.ghost, 204); }
    for (let y = 0; y < RD + WH; y += 3) { px(cut, 0, y, PAL.shared.ghost, 204); px(cut, W - 1, y, PAL.shared.ghost, 204); }
  }
  return { full, cut, h };
}

// ------------------------------------------------------------------ props

export function propArt(kind: PropKind, state: PropState, variant?: string): PropArt {
  const b = art.prop();
  if (b) { try { return b(kind, state, variant); } catch (e) { console.warn("prop art failed", kind, e); } }
  const im = img(14, 22);
  const c = kind === "sandbags" ? PAL.forest.sandbag[1] : kind === "tree" ? PAL.city_1943.bark[1] : PAL.city_1943.soot[2];
  if (kind === "lamp" || kind === "phone_pole" || kind === "street_sign") rect(im, 6, 2, 2, 20, PAL.city_1943.soot[1]);
  else if (kind === "tree") { rect(im, 6, 8, 2, 14, c); line(im, 7, 9, 2, 2, c); line(im, 7, 9, 12, 1, c); }
  else rect(im, 2, 12, 10, 10, state === "destroyed" ? PAL.city_1943.soot[0] : c);
  outline(im, PAL.shared.outline, "br");
  return { image: im, ax: 7, ay: 21 };
}

// ------------------------------------------------------------------ vehicles

export function vehicleSheet(kind: VehicleKind, state: VehicleState): Sheet {
  const b = art.vehicle();
  if (b) { try { return b(kind, state); } catch (e) { console.warn("vehicle art failed", kind, e); } }
  const dims: Record<VehicleKind, [number, number, number]> = { prison_truck: [6.5, 2.3, 2.8], car: [4.5, 1.7, 1.6], german_truck: [6, 2.3, 2.8], tram: [11, 2.2, 3.2] };
  const [L, Wd, Ht] = dims[kind];
  const body = kind === "car" ? PAL.city_1943.soot : kind === "tram" ? PAL.city_1943.tram : PAL.troopers.occupier_field_grey;
  const cells: { name: string; im: PixelImage; ax: number; ay: number }[] = [];
  const size = Math.ceil(Math.hypot(L, Wd) * 12) + 8;
  const hh = Math.ceil(Ht * 7.5) + size;
  for (let i = 0; i < 16; i++) {
    const a = (i * Math.PI) / 8;
    const im = img(size, hh);
    const cx = size / 2, cy = hh - size / 2;
    const c = Math.cos(a), s = Math.sin(a);
    const corner = (u: number, v: number, z: number): [number, number] => [cx + (u * c - v * s) * 12, cy + (u * s + v * c) * 9 - z * 7.5];
    const q = (z: number) => [corner(-L / 2, -Wd / 2, z), corner(L / 2, -Wd / 2, z), corner(L / 2, Wd / 2, z), corner(-L / 2, Wd / 2, z)];
    poly(im, q(0), body[0]);
    poly(im, q(Ht), state === "wreck" ? PAL.city_1943.soot[0] : body[2]);
    const [a0, a1] = [corner(L / 2, -Wd / 2, Ht), corner(L / 2, Wd / 2, Ht)];
    line(im, a0[0], a0[1], a1[0], a1[1], PAL.shared.glass);
    outline(im, PAL.shared.outline);
    cells.push({ name: `h${i}`, im, ax: Math.round(cx), ay: Math.round(cy) });
  }
  return packCells(cells, 8);
}

// ------------------------------------------------------------------ effects

export function fxSheet(): Sheet {
  const b = art.fx();
  if (b) { try { return b(); } catch (e) { console.warn("fx art failed", e); } }
  const F = PAL.shared.fire;
  const cells: { name: string; im: PixelImage; ax: number; ay: number }[] = [];
  const disc = (name: string, r: number, c: readonly [number, number, number], size = 48) => {
    const im = img(size, size);
    ellipse(im, size / 2, size / 2, r, r * 0.8, c);
    cells.push({ name, im, ax: size / 2, ay: size / 2 });
  };
  for (const f of FACINGS) for (let i = 0; i < 2; i++) disc(`muzzle_${f}_${i}`, 2 + i, F[2], 8);
  for (let i = 0; i < 8; i++) disc(`explosion_${i}`, 6 + i * 2.5, i < 4 ? F[1 + (i % 2)] : PAL.city_1943.soot[1 + (i % 2)]);
  for (let i = 0; i < 6; i++) disc(`fire_${i}`, 4 + (i % 3), F[i % 3], 16);
  for (let i = 0; i < 6; i++) disc(`smoke_${i}`, 3 + i, PAL.city_1943.soot[2], 16);
  for (let i = 0; i < 4; i++) disc(`dust_${i}`, 2 + i, PAL.city_1943.pavement[0], 12);
  for (let i = 0; i < 4; i++) disc(`snow_${i}`, 2 + i, PAL.city_1943.dirty_snow[1], 12);
  for (let i = 0; i < 4; i++) disc(`glass_${i}`, 1 + i, PAL.shared.chalk, 12);
  for (let i = 0; i < 3; i++) disc(`spark_${i}`, 1, F[2], 6);
  for (let i = 0; i < 4; i++) disc(`blood_${i}`, 2 + (i % 2), PAL.city_1943.brick[0], 12);
  for (let i = 0; i < 2; i++) disc(`scorch_${i}`, 10, PAL.city_1943.soot[0], 36);
  for (let i = 0; i < 3; i++) disc(`bullet_hole_${i}`, 1, PAL.city_1943.soot[0], 4);
  return packCells(cells, 16);
}
