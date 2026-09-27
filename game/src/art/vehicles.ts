// Vehicle sheets (types.ts VehicleBuilder): the prison van, the escape car, the Opel Blitz and the
// tram, each a handful of primitives (vehicles-models.ts) turned through 16 headings and drawn by
// the tiny renderer in vehicles-3d.ts. Heading i points i * 22.5 degrees clockwise from east ON
// SCREEN; because the ground is squashed (9 px per metre into the screen, 12 across) the model is
// turned by the world angle that lands on that screen angle.
//
// Every frame of a kind, in every state, shares one cell, with the anchor at the vehicle's centre
// on the ground, so a state swaps in place. The frames carry a baked ground shadow (style guide
// §4: the shadow colour at 27%, cast to the south-east).
import type { VehicleBuilder, VehicleKind, VehicleState } from "./types";
import { img, type Frame, type PixelImage, type Sheet } from "./pixel";
import { bounds, fitCell, render, renderInto, type Bounds, type Cell, type Mesh, type Shadow } from "./vehicles-3d";
import { vehicleMesh } from "./vehicles-models";

export const VEHICLE_KINDS: readonly VehicleKind[] = ["prison_truck", "car", "german_truck", "tram"];
export const VEHICLE_STATES: readonly VehicleState[] = ["intact", "burning", "wreck", "doors_open"];
export const HEADINGS = 16;

/** Ground shadow of vehicles: per metre of height, 0.32 m east and 0.24 m south, at 27%. */
export const VEHICLE_SHADOW: Shadow = { kx: 0.32, ky: 0.24, alpha: 69 };

/** Outline where one part of a vehicle stands this far in front of another (metres). */
const EDGE = 0.12;

/** World yaw (radians, clockwise from east) whose projection points i * 22.5 degrees on screen. */
export function headingYaw(i: number): number {
  const a = (i * Math.PI) / 8;
  return Math.atan2(12 * Math.sin(a), 9 * Math.cos(a));
}

const cells = new Map<VehicleKind, Cell>();
/** Meshes built to size a cell, handed to the first sheet that needs them (then dropped). */
const handOver = new Map<string, Mesh>();

function meshOf(kind: VehicleKind, st: VehicleState): Mesh {
  const k = `${kind}|${st}`;
  const m = handOver.get(k);
  if (!m) return vehicleMesh(kind, st);
  handOver.delete(k);
  return m;
}

/** The cell shared by every frame of a kind: size and anchor (the centre on the ground). */
export function vehicleCell(kind: VehicleKind): Cell {
  let c = cells.get(kind);
  if (c) return c;
  const b: Bounds = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const st of VEHICLE_STATES) {
    const m = vehicleMesh(kind, st);
    handOver.set(`${kind}|${st}`, m);
    for (let i = 0; i < HEADINGS; i++) bounds(m, headingYaw(i), VEHICLE_SHADOW, b);
  }
  // symmetric about the anchor, so a frame mirrored by the game keeps its anchor
  const hx = Math.max(-b.x0, b.x1);
  c = fitCell({ x0: -hx, x1: hx, y0: b.y0, y1: b.y1 }, 1);
  cells.set(kind, c);
  return c;
}

/** One frame: a kind in a state at heading 0..15. */
export function vehicleFrame(kind: VehicleKind, state: VehicleState, heading: number): PixelImage {
  return render(vehicleMesh(kind, state), { yaw: headingYaw(heading), cell: vehicleCell(kind), outline: "all", edge: EDGE, shadow: VEHICLE_SHADOW }).image;
}

export const buildVehicleSheet: VehicleBuilder = (kind, state) => {
  const cell = vehicleCell(kind);
  const m = meshOf(kind, state);
  const cols = 4, rows = HEADINGS / cols;
  const image = img(cell.w * cols, cell.h * rows);
  const frames: Frame[] = [];
  for (let i = 0; i < HEADINGS; i++) {
    const x = (i % cols) * cell.w, y = Math.floor(i / cols) * cell.h;
    renderInto(m, { yaw: headingYaw(i), cell, outline: "all", edge: EDGE, shadow: VEHICLE_SHADOW }, image, x, y);
    frames.push({ name: `h${i}`, x, y, w: cell.w, h: cell.h, ax: cell.ax, ay: cell.ay });
  }
  const sheet: Sheet = { image, frames };
  return sheet;
};
