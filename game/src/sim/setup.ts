// Helpers missions (and tests) use to put people on the street.
import type { Sim, SpawnOpts } from "./sim";
import type { Squad, Unit } from "./types";
import { restSlots } from "./move";

export function makeSquad(sim: Sim, i: number, name: string, colour: number): Squad {
  const sq: Squad = {
    id: i,
    name,
    members: [],
    order: "hold",
    holdX: 0,
    holdY: 0,
    coverDir: 0,
    coverHalf: 0.55,
    signalRoute: null,
    trail: [],
    inPlay: false,
    target: -1,
    fireAtX: 0,
    fireAtY: 0,
    fireUntil: 0,
    plannedThisPause: false,
    restX: 0,
    restY: 0,
    restDir: -Math.PI / 2,
    colour,
  };
  sim.state.squads[i] = sq;
  return sq;
}

/** Put a squad on the map at (x, y) facing `dir`, formed up behind its leader. */
export function fieldSquad(sim: Sim, sq: Squad, members: Omit<SpawnOpts, "x" | "y" | "side">[], x: number, y: number, dir: number): Unit[] {
  const slots = [{ x, y }, ...restSlots(sim, x, y, dir, members.length - 1)];
  const out = members.map((m, k) =>
    sim.spawnUnit({ ...m, side: "pl", squad: sq.id, x: slots[k].x, y: slots[k].y, dir }),
  );
  sq.members = out.map((u) => u.id);
  sq.inPlay = true;
  sq.holdX = sq.restX = x;
  sq.holdY = sq.restY = y;
  sq.restDir = dir;
  sq.trail = [];
  return out;
}
