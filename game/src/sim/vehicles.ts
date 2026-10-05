// Vehicles: the prison truck, the escape car, German trucks. They follow a route, slow for
// sharp turns (the S-bend at Bielańska–Długa–Nalewki is why the ambush worked), brake for
// people in the road, and stop when the driver is hit or they catch fire. The crew bails
// out alerted. A vehicle blocks the cells it stands on.
import type { Sim } from "./sim";
import type { Unit, Vehicle } from "./types";
import { F_VEH } from "./grid";
import { angDiff, setVehicleState } from "./combat";
import { SPEED } from "./tuning";
import { goTo } from "./move";

const cellsOf = new Map<number, number[]>();

/** The way a vehicle moves: along its heading, or tail first when it is backing. */
const travel = (v: Vehicle) => (v.reverse ? v.heading + Math.PI : v.heading);

export function stepVehicles(sim: Sim, dt: number): void {
  let moved = false;
  for (const v of sim.state.vehicles) {
    if (v.state === "burning") {
      v.burnT += dt;
      bailOut(sim, v);
      if (v.burnT > 10) setVehicleState(sim, v, "wreck");
    }
    const disabled = v.state === "burning" || v.state === "wreck" || v.driverDead;
    if (disabled || v.stopped || !v.route.length) {
      if (v.speed > 0) {
        // a vehicle whose driver is hit or whose engine died rolls on a while (the van did)
        v.speed = Math.max(0, v.speed - (disabled ? 2.2 : 7) * dt);
        v.x += Math.cos(travel(v)) * v.speed * dt;
        v.y += Math.sin(travel(v)) * v.speed * dt;
        moved = true;
        if (v.speed === 0) {
          sim.emit({ t: "brake", id: v.id });
          if (disabled) { v.stopped = true; bailOut(sim, v); }
        }
      }
      continue;
    }
    drive(sim, v, dt);
    moved = true;
  }
  if (moved) rebuildVehicleCells(sim);
}

function drive(sim: Sim, v: Vehicle, dt: number): void {
  let target = v.route[v.routeI];
  while (target && Math.hypot(target.x - v.x, target.y - v.y) < Math.max(1.6, v.speed * 0.35)) {
    v.routeI++;
    target = v.route[v.routeI];
  }
  if (!target) {
    v.speed = Math.max(0, v.speed - 6 * dt);
    if (v.speed === 0) { v.stopped = true; sim.emit({ t: "brake", id: v.id }); }
    v.x += Math.cos(travel(v)) * v.speed * dt;
    v.y += Math.sin(travel(v)) * v.speed * dt;
    return;
  }
  const want = Math.atan2(target.y - v.y, target.x - v.x);
  const turn = angDiff(want, travel(v));
  const maxTurn = (0.9 + v.speed * 0.12) * dt;
  const h = v.heading + Math.max(-maxTurn, Math.min(maxTurn, turn));
  v.heading = Math.atan2(Math.sin(h), Math.cos(h));
  // slow down for the corner ahead
  const next = v.route[v.routeI + 1];
  let cap = v.maxSpeed;
  if (next) {
    const seg = Math.atan2(next.y - target.y, next.x - target.x);
    const bend = Math.abs(angDiff(seg, want));
    const dist = Math.hypot(target.x - v.x, target.y - v.y);
    if (bend > 0.5 && dist < 14) cap = Math.min(cap, v.maxSpeed * (bend > 1.2 ? 0.28 : 0.5));
  }
  if (Math.abs(turn) > 0.6) cap = Math.min(cap, v.maxSpeed * 0.3);
  if (v.reverse) cap = Math.min(cap, v.maxSpeed * 0.6);
  if (v.holdAt >= 0 && v.routeI >= v.holdAt) cap = 0;
  const inWay = peopleInWay(sim, v);
  if (inWay.length || vehicleInFront(sim, v)) cap = 0;
  v.blockedT = inWay.length ? v.blockedT + dt : 0;
  // our own car does not wait for ever on a crowd of friends: they step out of its way
  if (v.blockedT > 1.2 && sim.unit(v.crew[0])?.side === "pl") {
    v.blockedT = 0;
    for (const u of inWay) if (u.side !== "de") stepAside(sim, v, u);
  }
  const acc = cap > v.speed ? 2.6 : 7;
  v.speed += Math.max(-acc * dt, Math.min(acc * dt, cap - v.speed));
  if (v.speed < 0) v.speed = 0;
  v.x += Math.cos(travel(v)) * v.speed * dt;
  v.y += Math.sin(travel(v)) * v.speed * dt;
}

/** Everyone standing in the vehicle's way, ahead in the direction it is moving. */
function peopleInWay(sim: Sim, v: Vehicle): Unit[] {
  const c = Math.cos(travel(v)), s = Math.sin(travel(v));
  const out: Unit[] = [];
  for (const u of sim.state.units) {
    if (u.state === "dead" || u.hidden) continue;
    const ox = u.x - v.x, oy = u.y - v.y;
    const along = ox * c + oy * s;
    const side = -ox * s + oy * c;
    if (along > v.len / 2 && along < v.len / 2 + 2.2 + v.speed * 0.25 && Math.abs(side) < v.wid / 2 + 0.3) out.push(u);
  }
  return out;
}

/** A step to the side of the vehicle's path, on the side he already stands. */
function stepAside(sim: Sim, v: Vehicle, u: Unit): void {
  const d = travel(v), c = Math.cos(d), s = Math.sin(d);
  const side = -(u.x - v.x) * s + (u.y - v.y) * c >= 0 ? 1 : -1;
  const off = v.wid / 2 + 1.6;
  const p = sim.grid.nearestWalkable(u.x - s * side * off, u.y + c * side * off, 2);
  if (!p) return;
  goTo(sim, u, p.x, p.y, 800);
  u.yieldUntil = sim.state.time + 2.5;
}

/** Another intact vehicle across the way (a burning wreck can be squeezed past on the pavement). */
function vehicleInFront(sim: Sim, v: Vehicle): boolean {
  const c = Math.cos(travel(v)), s = Math.sin(travel(v));
  for (const o of sim.state.vehicles) {
    if (o === v || (o.state !== "intact" && o.state !== "doors_open")) continue;
    const ox = o.x - v.x, oy = o.y - v.y;
    const along = ox * c + oy * s;
    const side = Math.abs(-ox * s + oy * c);
    const reach = v.len / 2 + Math.max(o.len, o.wid) / 2 + 1.5 + v.speed * 0.3;
    if (along > 0 && along < reach && side < (v.wid + Math.max(o.wid, o.len * Math.abs(Math.sin(o.heading - v.heading)))) / 2 + 0.3) return true;
  }
  return false;
}

/** The crew gets out: escorts come out shooting. The men in the cab jump out a step clear
 *  beside it (burning, if the cab is); the men in the back ("rear") get down at the
 *  tailgate once the vehicle has stopped. */
export function bailOut(sim: Sim, v: Vehicle): void {
  if (!v.crew.length) return;
  const c = Math.cos(v.heading), s = Math.sin(v.heading);
  const cabSpots: [number, number][] = [[v.len * 0.25, v.wid / 2 + 1.7], [v.len * 0.25, -v.wid / 2 - 1.7], [v.len * 0.05, v.wid / 2 + 2.2], [v.len * 0.05, -v.wid / 2 - 2.2]];
  const rearSpots: [number, number][] = [[-v.len / 2 - 1.0, v.wid / 2 - 0.2], [-v.len / 2 - 1.0, -v.wid / 2 + 0.2], [-v.len / 2 - 1.8, 0]];
  const stopped = v.speed < 0.2;
  let ci = 0, ri = 0;
  const staying: number[] = [];
  for (const id of v.crew) {
    const u = sim.unit(id);
    if (!u || u.state === "dead") continue;
    const rear = u.tag === "rear";
    if (rear && !stopped) { staying.push(id); continue; }
    const [a, b] = rear ? rearSpots[ri++ % rearSpots.length] : cabSpots[ci++ % cabSpots.length];
    let x = v.x + a * c - b * s, y = v.y + a * s + b * c;
    const w = sim.grid.nearestWalkable(x, y, 4);
    if (w) { x = w.x; y = w.y; }
    u.hidden = false;
    u.x = u.px = x;
    u.y = u.py = y;
    if (u.ai) {
      u.ai.blind = false;
      u.ai.mode = "alert";
      u.ai.react = 0.9 + sim.rand() * 0.6;
      u.ai.lastX = v.x;
      u.ai.lastY = v.y;
      u.ai.lastT = sim.state.time;
      u.speed = SPEED.guardRun;
      u.glyph = "alert";
      sim.emit({ t: "glyph", unit: u.id, glyph: "alert" });
    }
    if (!rear && u.side === "de" && v.state === "burning" && sim.rand() < 0.3) sim.hurt(u, -1, "fire");
  }
  v.crew = staying;
}

export function rebuildVehicleCells(sim: Sim): void {
  const G = sim.grid;
  for (const cells of cellsOf.values()) for (const i of cells) G.flags[i] &= ~F_VEH;
  cellsOf.clear();
  for (const v of sim.state.vehicles) {
    const cells: number[] = [];
    const c = Math.cos(v.heading), s = Math.sin(v.heading);
    const hx = v.len / 2 + 0.1, hy = v.wid / 2 + 0.1;
    const r = Math.ceil(Math.hypot(hx, hy));
    for (let cy = Math.floor(v.y) - r; cy <= Math.floor(v.y) + r; cy++) {
      for (let cx = Math.floor(v.x) - r; cx <= Math.floor(v.x) + r; cx++) {
        if (!G.inBounds(cx, cy)) continue;
        const ox = cx + 0.5 - v.x, oy = cy + 0.5 - v.y;
        const lx = ox * c + oy * s, ly = -ox * s + oy * c;
        if (Math.abs(lx) <= hx && Math.abs(ly) <= hy) {
          const i = cy * G.w + cx;
          G.flags[i] |= F_VEH;
          cells.push(i);
        }
      }
    }
    cellsOf.set(v.id, cells);
  }
}
