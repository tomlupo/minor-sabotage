// What one trooper is busy with: sneaking up with a knife, walking into throwing range,
// kneeling at work (opening the truck, cutting a line, planting a charge), or getting a
// wounded friend back on his feet.
import type { Sim } from "./sim";
import type { Unit } from "./types";
import { goTo, setAnim } from "./move";
import { KNIFE, THROW, WOUND } from "./tuning";

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
    if (!u.path.length) {
      const k = (d - THROW.range + 1) / d;
      goTo(sim, u, u.x + (t.x - u.x) * k, u.y + (t.y - u.y) * k, 4000);
    }
    return;
  }
  if (t.t >= THROW.wind) {
    if (t.what === "grenade") u.grenades--; else u.bottles--;
    const dur = 0.35 + d * THROW.flightPerM;
    sim.state.projectiles.push({ id: sim.state.nextId++, kind: t.what, x0: u.x, y0: u.y, x1: t.x, y1: t.y, t: 0, dur, owner: u.id });
    sim.emit({ t: "throw", unit: u.id, kind: t.what, x: t.x, y: t.y });
    sim.say(u, t.what === "grenade" ? "Granat!" : "Butelka!", 6);
    u.task = null;
  }
}

function work(sim: Sim, u: Unit): void {
  const t = u.task as Extract<Unit["task"], { kind: "work" }>;
  const d = Math.hypot(t.x - u.x, t.y - u.y);
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
