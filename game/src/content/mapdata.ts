// A map as data: what the Tiled file carries and both the rules and the drawing read.
// Cells are 1 m; the Tiled file uses 12 x 9 px tiles so its pixel coordinates are the art's.
import type { BuildingSpec, GroundMat, PropKind } from "../art/types";
import { Grid, F_COVER, F_ROOF, F_SIGHT, F_WALK } from "../sim/grid";

export interface MapBuilding extends BuildingSpec {
  /** Street the building fronts: while the squad is in it, a cuttable building drops. */
  street: number;
  kind: "tenement" | "arsenal" | "simons";
  courtyard?: { x: number; y: number; w: number; d: number };
}

export interface MapProp {
  kind: PropKind;
  x: number;
  y: number;
  variant?: string;
  /** Footprint in metres relative to (x, y): NW offset and size; omitted = none. */
  block?: { dx: number; dy: number; w: number; h: number; flags: number };
  tag?: string;
}

export interface MapZone {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MapPath {
  name: string;
  pts: { x: number; y: number }[];
}

export interface MapData {
  name: string;
  w: number;
  h: number;
  /** Ground material index per cell (into `legend`). */
  ground: Uint8Array;
  legend: GroundMat[];
  flags: Uint8Array;
  street: Int16Array;
  building: Int16Array;
  streets: { id: number; name: string }[];
  buildings: MapBuilding[];
  props: MapProp[];
  zones: MapZone[];
  paths: MapPath[];
}

export function emptyMap(name: string, w: number, h: number, legend: GroundMat[]): MapData {
  return {
    name, w, h, legend,
    ground: new Uint8Array(w * h),
    flags: new Uint8Array(w * h),
    street: new Int16Array(w * h).fill(-1),
    building: new Int16Array(w * h).fill(-1),
    streets: [], buildings: [], props: [], zones: [], paths: [],
  };
}

export function gridFromMap(md: MapData): Grid {
  const G = new Grid(md.w, md.h);
  G.flags.set(md.flags);
  G.street.set(md.street);
  G.building.set(md.building);
  return G;
}

export function zone(md: MapData, name: string): MapZone {
  const z = md.zones.find((z) => z.name === name);
  if (!z) throw new Error(`map ${md.name}: no zone ${name}`);
  return z;
}

export function path(md: MapData, name: string): { x: number; y: number }[] {
  const p = md.paths.find((p) => p.name === name);
  if (!p) throw new Error(`map ${md.name}: no path ${name}`);
  return p.pts.map((q) => ({ ...q }));
}

export function inZone(z: MapZone, x: number, y: number): boolean {
  return x >= z.x && y >= z.y && x < z.x + z.w && y < z.y + z.h;
}

export { F_COVER, F_ROOF, F_SIGHT, F_WALK };
