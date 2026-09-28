// What one trooper is busy with: sneaking up with a knife, walking into throwing range,
// kneeling at work (opening the truck, cutting a line, planting a charge), or getting a
// wounded friend back on his feet.
import type { Sim } from "./sim";
import type { Unit } from "./types";
import { goTo, setAnim } from "./move";
import { KNIFE, THROW, WOUND } from "./tuning";

/** A man with a job walks in the column until he is this close to it. */
export const WORK_DETACH = 7;

function isLeader(sim: Sim, u: Unit): boolean {
  const sq = sim.squad(u.squad);
  return !!sq && sim.leaderOf(sq) === u;
}

/** Busy means out of the column: a job still far off does not take a man out of it. */
export function outOfColumn(u: Unit): boolean {
  const t = u.task;
  if (!t) return false;
  if (t.kind === "work" && t.phase === "approach" && Math.hypot(t.x - u.x, t.y - u.y) > WORK_DETACH) return false;
  return true;
}

export function stepTasks(sim: Sim, dt: number): void {
  for (const u of sim.state.units) {
    if (!u.task) continue;
    if (u.state !== "ok" || u.hidden) { u.task = null; continue; }
    const t = u.task;
    t.t += dt;
    switch (t.kind) {
      case "knife": knife(sim, u, dt); break;
      case "throw": throwTask(sim, u); break;
      case "work": work(sim, u); break;
      case "help": help(sim, u); break;
    }
  }
}

function knife(sim: Sim, u: Unit, _dt: number): void {
  const t = u.task as Extract<Unit["task"], { kind: "knife" }>;
  const v = sim.unit(t.target);
  if (!v || v.state === "dead" || v.hidden) { u.task = null; return; }
  const d = Math.hypot(v.x - u.x, v.y - u.y);
  if (t.phase === "approach") {
    // spotted on the way in: the knife is off, the squad opens fire instead
    if (v.ai && v.ai.mode === "alert") {
      u.task = null;
      const sq = sim.squad(u.squad);
      if (sq) sq.target = v.id;
      return;
    }
    if (d <= KNIFE.reach) {
      t.phase = "strike";
      t.t = 0;
      u.path = [];
      u.dir = Math.atan2(v.y - u.y, v.x - u.x);
      setAnim(u, "knife", KNIFE.strike + 0.25);
      return;
    }
    // the last few metres are a creep, not a run
    u.speed = d < 5 ? 1.9 : 3.1;
    if (!u.path.length || (sim.state.tick + u.id) % 8 === 0) {
      // aim for a spot just short of him, from our side
      const k = Math.max(0, d - 0.7) / Math.max(d, 1e-3);
      goTo(sim, u, u.x + (v.x - u.x) * k, u.y + (v.y - u.y) * k, 3000);
    }
    return;
  }
  if (t.t >= KNIFE.strike) {
    if (d <= KNIFE.reach * 1.6) {
      sim.emit({ t: "knife", unit: u.id, target: v.id });
      sim.hurt(v, u.id, "knife");
    }
    u.task = null;
  }
}

function throwTask(sim: Sim, u: Unit): void {
  const t = u.task as Extract<Unit["task"], { kind: "throw" }>;
  const has = t.what === "grenade" ? u.grenades > 0 : u.bottles > 0;
  if (!has) { u.task = null; return; }
  const d = Math.hypot(t.x - u.x, t.y - u.y);
  if (t.phase === "approach") {
    if (d <= THROW.range) {
      t.phase = "wind";
      t.t = 0;
      u.path = [];
      u.dir = Math.atan2(t.y - u.y, t.x - u.x);
      setAnim(u, "throw", THROW.wind + 0.3);
      return;
    }
    // a vehicle target moves: follow where it is now
    const tv = t.veh !== undefined ? sim.vehicle(t.veh) : undefined;
    if (tv) { t.x = tv.x; t.y = tv.y; }
    if (!u.path.length || tv) {
      const dd = Math.hypot(t.x - u.x, t.y - u.y);
      const k = Math.max(0, dd - THROW.range + 1) / Math.max(dd, 0.01);
      if (!u.path.length || (sim.state.tick + u.id) % 10 === 0) goTo(sim, u, u.x + (t.x - u.x) * k, u.y + (t.y - u.y) * k, 4000);
    }
    return;
  }
  if (t.t >= THROW.wind) {
    if (t.what === "grenade") u.grenades--; else u.bottles--;
    let dur = 0.35 + d * THROW.flightPerM;
    // thrown at a vehicle: at the cab, leading it as anyone would
    const v = t.veh !== undefined ? sim.vehicle(t.veh) : sim.state.vehicles.find((q) => q.speed >= 0.5 && Math.hypot(q.x - t.x, q.y - t.y) <= 5);
    if (v && v.state !== "wreck") {
      const cab = v.len * 0.3;
      let lx = v.x, ly = v.y;
      for (let k = 0; k < 3; k++) {
        const fl = 0.35 + Math.hypot(lx - u.x, ly - u.y) * THROW.flightPerM;
        lx = v.x + Math.cos(v.heading) * (v.speed * fl + cab);
        ly = v.y + Math.sin(v.heading) * (v.speed * fl + cab);
      }
      if (Math.hypot(lx - u.x, ly - u.y) <= THROW.range + 3) {
        t.x = lx;
        t.y = ly;
        dur = 0.35 + Math.hypot(t.x - u.x, t.y - u.y) * THROW.flightPerM;
      }
    }
    sim.state.projectiles.push({ id: sim.state.nextId++, kind: t.what, x0: u.x, y0: u.y, x1: t.x, y1: t.y, t: 0, dur, owner: u.id });
    sim.emit({ t: "throw", unit: u.id, kind: t.what, x: t.x, y: t.y });
    sim.say(u, t.what === "grenade" ? "Granat!" : "Butelka!", 6);
    u.task = null;
  }
}

function work(sim: Sim, u: Unit): void {
  const t = u.task as Extract<Unit["task"], { kind: "work" }>;
  const d = Math.hypot(t.x - u.x, t.y - u.y);
  // petrol burning on the spot: he waits at its edge, facing the job, until it goes out
  const f = sim.fireAt(t.x, t.y, 0.4);
  if (f && (t.phase === "work" || d <= WORK_DETACH || isLeader(sim, u))) {
    if (t.phase === "work") { t.phase = "approach"; setAnim(u, "idle"); }
    const a = Math.atan2(u.y - f.y, u.x - f.x);
    const wx = f.x + Math.cos(a) * (f.r * 0.8 + 1), wy = f.y + Math.sin(a) * (f.r * 0.8 + 1);
    if (Math.hypot(wx - u.x, wy - u.y) > 0.6) {
      if (!u.path.length || (sim.state.tick + u.id) % 10 === 0) goTo(sim, u, wx, wy, 3000);
    } else {
      u.path = [];
      u.dir = Math.atan2(t.y - u.y, t.x - u.x);
    }
    return;
  }
  if (t.phase === "approach") {
    if (d <= 0.9) {
      t.phase = "work";
      t.t = 0;
      u.path = [];
      u.dir = Math.atan2(t.y - u.y, t.x - u.x);
      setAnim(u, "kneel");
      sim.emit({ t: "work", unit: u.id, what: t.what, done: false });
      return;
    }
    // he walks in the column until the job is close, then goes to it
    if (d > WORK_DETACH && !isLeader(sim, u)) return;
    if (!u.path.length) goTo(sim, u, t.x, t.y, 6000);
    return;
  }
  setAnim(u, "kneel");
  if (t.t >= t.dur) {
    sim.emit({ t: "work", unit: u.id, what: t.what, done: true });
    u.task = null;
    setAnim(u, "idle");
  }
}

function help(sim: Sim, u: Unit): void {
  const t = u.task as Extract<Unit["task"], { kind: "help" }>;
  const v = sim.unit(t.target);
  if (!v || v.state !== "down") { u.task = null; return; }
  const d = Math.hypot(v.x - u.x, v.y - u.y);
  if (t.phase === "approach") {
    if (d <= 1.0) {
      t.phase = "work";
      t.t = 0;
      u.path = [];
      u.dir = Math.atan2(v.y - u.y, v.x - u.x);
      setAnim(u, "kneel");
      return;
    }
    if (!u.path.length || (sim.state.tick + u.id) % 10 === 0) goTo(sim, u, v.x, v.y, 4000);
    return;
  }
  setAnim(u, "kneel");
  v.downT = Math.max(v.downT, 2); // he will not bleed out while being helped
  if (t.t >= WOUND.helpTime) {
    v.state = "ok";
    v.wounded = true;
    v.glyph = "wounded";
    v.anim = "idle";
    v.animT = 0;
    sim.emit({ t: "up", unit: v.id });
    sim.say(v, "Dam radę.", 5);
    u.task = null;
  }
}
