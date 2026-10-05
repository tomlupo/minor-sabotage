// Contracts between the art generators (src/art/*) and the game. Every generator is a pure
// function of these specs plus docs/art/palette.json, drawn at 1x in art pixels, following
// docs/art/style-guide.md. Projection (style guide §2): a ground point (x, y) metres at
// height z lands at sx = 12x, sy = 9y - 7.5z. Light from the top left. Outline colour
// PAL.shared.outline. No colour literals.
import type { PixelImage, Sheet } from "./pixel";

// ---------------------------------------------------------------- troopers (src/art/troopers.ts)

/** Drawn facings. West-side facings are the east-side frames flipped (sw=se, w=e, nw=ne). */
export type Facing = "s" | "se" | "e" | "ne" | "n";
export const FACINGS: readonly Facing[] = ["s", "se", "e", "ne", "n"];

export type Anim = "idle" | "walk" | "fire" | "throw" | "death" | "prone" | "knife" | "kneel";
/** Frames per animation (style guide §6; swim is not needed in the city). */
export const ANIM_FRAMES: Readonly<Record<Anim, number>> = {
  idle: 1,
  walk: 4,
  fire: 2,
  throw: 3,
  death: 5, // hit and death: last frame lies on the ground
  prone: 2, // wounded, down on the ground: the game loops these while a veteran waits for help
  knife: 3,
  kneel: 2, // kneel and work: planting a charge, opening the truck, painting a wall
};

export type Body = "partisan" | "occupier" | "prisoner" | "civilian_m" | "civilian_f";
export type Headgear =
  | "cap" // flat cap (kaszkiet)
  | "hat" // brimmed felt hat
  | "beret"
  | "bare"
  | "helmet_wz31"
  | "stahlhelm"
  | "stahlhelm_big" // the rookie's oversized captured helmet
  | "peaked_cap" // German officer / Gestapo
  | "headscarf"; // civilian women
export type Weapon = "none" | "sten" | "pistol" | "rifle" | "mp40";
export type Kit =
  | "none"
  | "binoculars" // scout
  | "charge_pack" // sapper: pack with a red charge
  | "bottle_bag" // the Butelki section: a bag of petrol bottles
  | "grenade_pouch"
  | "driver_tag"; // driver: cap with a tag glyph

export interface TrooperLook {
  body: Body;
  /** Index into PAL.troopers.partisan_jackets (partisans and civilians). */
  jacket?: number;
  headgear: Headgear;
  weapon: Weapon;
  kit: Kit;
  /** White-and-red armband (partisans; style guide §6). */
  armband?: boolean;
  /** Face / hair variation seed. */
  seed?: number;
  /** Bruised face and a bandage: Rudy after Szucha. */
  beaten?: boolean;
}

/** A trooper cell is 24 x 24 with the feet at (12, 22); the standing figure fits the
 *  style guide's 16 x 22 box, the extra room is for lying bodies, a thrown arm, a rifle. */
export const TROOPER_CELL = { w: 24, h: 24, ax: 12, ay: 22 } as const;

/** Frame names: `${anim}_${facing}_${i}`, e.g. "walk_se_2". */
export type TrooperSheetBuilder = (look: TrooperLook) => Sheet;
/** 24 x 28 bust facing the viewer, for briefing cards and identity tags. */
export type PortraitBuilder = (look: TrooperLook, seed: number) => PixelImage;

// ---------------------------------------------------------------- city (src/art/city/*)

/** Ground material per 1 m cell. */
export type GroundMat =
  | "road" // cobbles (bruk), slush in the ruts
  | "walk" // pavement slabs
  | "yard" // courtyard: beaten earth, old cobbles, dirty snow heaps
  | "rail_ew" // road with a tram rail pair running east-west through this cell
  | "rail_ns"
  | "under" // under a building (never visible; the painter may leave it dark)
  | "square"; // a small square / park strip: dead grass, bare soil, snow

export interface GroundGrid {
  /** Size in 1 m cells. The painted image is w*12 x h*9 art px. */
  w: number;
  h: number;
  /** One byte per cell, index into `legend`. */
  cells: Uint8Array;
  legend: GroundMat[];
}

export type PlasterKind = "ochre" | "green" | "cream" | "brick" | "stone";
export type RoofKind = "tin" | "tar" | "tile";

export interface BuildingSpec {
  id: string;
  /** Footprint in metres (whole metres), NW corner x, y; width east-west w, depth north-south d. */
  x: number;
  y: number;
  w: number;
  d: number;
  /** Storeys; the wall is storeys * 3.2 m plus a 0.8 m cornice/parapet. */
  storeys: number;
  roof: RoofKind;
  plaster: PlasterKind;
  /** Features of the south wall, x offsets in metres from the building's west edge. */
  front?: {
    /** 3 m wide arched gateway through the building at ground level (walkable passage). */
    gateways?: number[];
    /** Shop fronts (1.4-2 m windows, style guide §7) with an optional sign text. */
    shops?: { x: number; w: number; sign?: string }[];
    doors?: number[];
    balconies?: boolean;
    /** Fraction of windows lit (0..1). */
    lit?: number;
  };
  /** Needs a cut version (it stands on the near, south side of a street). */
  cuttable: boolean;
  seed: number;
}

export interface BuildingArt {
  /** Full volume: roof + south wall. Image top-left sits at screen (12x, 9y - 7.5h). */
  full: PixelImage;
  /** Cut to knee height (1 m): floor, furniture, knee walls with cut_cap, and the ghost
   *  outline (dotted every 3rd pixel, ghost colour at 80%) of the full volume. Same bounds
   *  as `full` so the two swap in place. */
  cut?: PixelImage;
  /** Wall height in metres (storeys * 3.2 + 0.8). */
  h: number;
}
export type BuildingBuilder = (spec: BuildingSpec) => BuildingArt;

export type GroundPainter = (grid: GroundGrid, seed: number) => PixelImage;

// ---------------------------------------------------------------- props, vehicles, fx

export type PropKind =
  | "lamp" // street lamp, cast iron
  | "ad_column" // advertising column with posters and a German notice
  | "kiosk"
  | "bench"
  | "tree" // bare late-winter tree
  | "phone_pole"
  | "phone_box"
  | "sandbags" // guard post
  | "barrier" // road barrier / Spanish rider
  | "barrel"
  | "crates"
  | "cart" // hand cart
  | "hydrant"
  | "tram_stop"
  | "street_sign" // enamel sign on a pole; text given by variant string
  | "gate" // courtyard gate leaf
  | "ghetto_wall" // brick wall segment with barbed wire, 2 m long, runs east-west
  | "bin"
  | "snow_heap"
  | "dorozka" // a parked horse cab (horse + carriage)
  | "kit"; // a fallen man's gear on the ground (satchel, and the gun when he had a Sten)

export type PropState = "intact" | "destroyed" | "burning";
export interface PropArt {
  image: PixelImage;
  /** Pixel in `image` that sits on the prop's ground anchor point. */
  ax: number;
  ay: number;
}
export type PropBuilder = (kind: PropKind, state: PropState, variant?: number | string) => PropArt;

export type VehicleKind = "prison_truck" | "car" | "german_truck" | "tram";
export type VehicleState = "intact" | "burning" | "wreck" | "doors_open";
/** 16 headings, frame names "h0".."h15": heading i points i*22.5 degrees clockwise from
 *  east on screen (h0 east, h4 south, h8 west, h12 north). Anchor = the vehicle's centre on
 *  the ground. All frames of one sheet share the cell size. */
export type VehicleBuilder = (kind: VehicleKind, state: VehicleState) => Sheet;

/** Effects sheet. Frame names (anchor = effect centre on the ground, or the muzzle):
 *  muzzle_{s,se,e,ne,n}_{0,1}, explosion_0..7, fire_0..5, smoke_0..5, dust_0..3,
 *  snow_0..3, glass_0..3, spark_0..2, blood_0..3 (ground decals), scorch_0..1 (decals),
 *  bullet_hole_0..2 (wall decals). */
export type FxBuilder = () => Sheet;
