// Guards: they see in cones and can raise the alarm; the alarm wakes the guard posts, which
// send soldiers until you blow them up (decision "loud by default, silence pays"). A guard
// who spots you blows his whistle first: the district alarm follows a second later, so a
// quick knife or shot can still keep it quiet.
import type { Sim } from "./sim";
import type { Unit } from "./types";
import { UF_POSTED } from "./types";
import { angDiff } from "./combat";
import { goTo } from "./move";
import { germanWeapon } from "./setup";
import { DETECT, SPEED } from "./tuning";

const GERMAN_ALERT = ["Halt!", "Alarm!", "Banditen!", "Hände hoch!"];
const GERMAN_HUH = ["Was?", "Wer da?", "Hm?"];

export function stepAI(sim: Sim, dt: number): void {
  const s = sim.state;
  // a man at his post in plain clothes is one more man at a kerb
  const pls = s.units.filter((u) => u.side === "pl" && u.state !== "dead" && !u.hidden && !(u.flags & UF_POSTED));
  for (const u of s.units) {
    if (!u.ai || u.state !== "ok" || u.hidden) continue;
    if (u.side === "civ") { civilian(sim, u); continue; }
    if (u.side !== "de" || u.ai.blind) continue;
    const ai = u.ai;
    perceive(sim, u, pls, dt);
    switch (ai.mode) {
      case "post": post(sim, u, dt); break;
      case "patrol": patrol(sim, u, dt); break;
      case "suspicious": suspicious(sim, u, dt); break;
      case "search": search(sim, u, dt); break;
      case "alert": alert(sim, u, dt); break;
      default: break;
    }
    if (ai.whistleT > 0) {
      ai.whistleT -= dt;
      if (ai.whistleT <= 0) sim.raiseAlarm(ai.district, ai.lastX, ai.lastY);
    }
  }
}

function perceive(sim: Sim, u: Unit, pls: Unit[], dt: number): void {
  const ai = u.ai!;
  const G = sim.grid;
  let best = 0;
  let seen: Unit | null = null;
  for (const p of pls) {
    const dx = p.x - u.x, dy = p.y - u.y;
    const d = Math.hypot(dx, dy);
    const reach = ai.mode === "alert" ? 20 : ai.coneR;
    if (d > reach) continue;
    let inView: boolean;
    const off = Math.abs(angDiff(Math.atan2(dy, dx), u.dir));
    // at arm's length he feels you, but not from straight behind: that is where the knife comes from
    const touch = d < DETECT.touch && (off < DETECT.touchHalf || p.sinceShot < 1);
    if (touch) inView = true;
    else if (ai.mode === "alert") inView = true;
    else inView = off <= ai.coneHalf;
    if (!inView || !G.los(u.x, u.y, p.x, p.y)) continue;
    let rate = DETECT.rate * (1 + (1 - d / ai.coneR) * DETECT.closeBoost);
    rate *= p.moving ? DETECT.movingMul : DETECT.stillMul;
    if (p.sinceShot < 1) rate *= DETECT.firingMul;
    if (p.state === "down") rate *= 0.6;
    if (touch) rate = 12;
    if (rate > best) { best = rate; seen = p; }
  }
  if (seen) {
    ai.meter = Math.min(1.2, ai.meter + best * dt);
    ai.lastX = seen.x;
    ai.lastY = seen.y;
    ai.lastT = sim.state.time;
  } else {
    ai.meter = Math.max(0, ai.meter - DETECT.decay * dt);
  }
  if (ai.mode === "alert") return;
  if (ai.meter >= 1 && seen) {
    goAlert(sim, u, seen.x, seen.y);
    return;
  }
  if (ai.meter >= DETECT.suspicious && ai.mode !== "suspicious" && ai.mode !== "search") {
    ai.mode = "suspicious";
    ai.wait = 0;
    u.path = [];
    setGlyph(sim, u, "suspicious");
    sim.say(u, GERMAN_HUH[u.id % GERMAN_HUH.length], 6);
  }
  // a body in the cone
  if ((sim.state.tick + u.id) % 10 === 0) {
    for (const b of sim.state.units) {
      if (b.side !== "de" || b.state !== "dead" || b.hidden) continue;
      const d = Math.hypot(b.x - u.x, b.y - u.y);
      if (d > DETECT.bodyNotice) continue;
      if (Math.abs(angDiff(Math.atan2(b.y - u.y, b.x - u.x), u.dir)) > ai.coneHalf) continue;
      if (!G.los(u.x, u.y, b.x, b.y)) continue;
      goAlert(sim, u, b.x, b.y);
      break;
    }
  }
}

function setGlyph(sim: Sim, u: Unit, g: Unit["glyph"]): void {
  if (u.glyph === g) return;
  u.glyph = g;
  sim.emit({ t: "glyph", unit: u.id, glyph: g });
}

export function goAlert(sim: Sim, u: Unit, x: number, y: number): void {
  const ai = u.ai!;
  ai.mode = "alert";
  ai.lastX = x;
  ai.lastY = y;
  ai.lastT = sim.state.time;
  ai.react = 0.9 + sim.rand() * 0.7;
  u.speed = SPEED.guardRun;
  setGlyph(sim, u, "alert");
  sim.say(u, GERMAN_ALERT[(u.id + sim.state.tick) % GERMAN_ALERT.length], 5);
  if (!sim.alarmUp(ai.district) && ai.whistleT < 0) {
    ai.whistleT = DETECT.whistleDelay;
    sim.emit({ t: "whistle", unit: u.id, x: u.x, y: u.y });
  }
}

function backToRoutine(sim: Sim, u: Unit): void {
  const ai = u.ai!;
  ai.meter = 0;
  setGlyph(sim, u, "none");
  u.speed = ai.pace ?? SPEED.guardPatrol;
  if (ai.route && ai.route.length) {
    ai.mode = "patrol";
    const p = ai.route[ai.routeI % ai.route.length];
    goTo(sim, u, p.x, p.y, 5000);
  } else {
    ai.mode = "post";
    goTo(sim, u, ai.homeX, ai.homeY, 5000);
  }
}

function post(sim: Sim, u: Unit, dt: number): void {
  const ai = u.ai!;
  if (u.path.length) return;
  if (Math.hypot(u.x - ai.homeX, u.y - ai.homeY) > 0.8) { goTo(sim, u, ai.homeX, ai.homeY, 4000); return; }
  ai.sweepT += dt;
  // a slow look left and right, with a pause at each end
  const k = Math.sin(ai.sweepT * 0.55);
  u.dir = ai.homeDir + Math.sign(k) * Math.min(1, Math.abs(k) * 1.4) * 0.6;
}

function patrol(sim: Sim, u: Unit, dt: number): void {
  const ai = u.ai!;
  u.speed = ai.pace ?? SPEED.guardPatrol;
  if (!ai.route || !ai.route.length) { ai.mode = "post"; return; }
  if (u.path.length) return;
  if (ai.wait > 0) {
    ai.wait -= dt;
    ai.sweepT += dt;
    u.dir += Math.sin(ai.sweepT * 1.3) * 0.02;
    return;
  }
  const here = ai.route[ai.routeI % ai.route.length];
  if (Math.hypot(here.x - u.x, here.y - u.y) < 0.6) {
    ai.routeI = (ai.routeI + 1) % ai.route.length;
    ai.wait = ai.pause ?? 1.2 + (u.id % 3) * 0.6;
    return;
  }
  goTo(sim, u, here.x, here.y, 6000);
}

function suspicious(sim: Sim, u: Unit, dt: number): void {
  const ai = u.ai!;
  u.dir = Math.atan2(ai.lastY - u.y, ai.lastX - u.x);
  ai.wait += dt;
  // after a moment he takes a few steps toward what he saw
  if (ai.wait > 1.2 && !u.path.length && Math.hypot(ai.lastX - u.x, ai.lastY - u.y) > 3) {
    const k = 0.4;
    u.speed = SPEED.guardPatrol;
    goTo(sim, u, u.x + (ai.lastX - u.x) * k, u.y + (ai.lastY - u.y) * k, 3000);
  }
  if (ai.meter < 0.08 && ai.wait > 3.5) backToRoutine(sim, u);
}

function search(sim: Sim, u: Unit, dt: number): void {
  const ai = u.ai!;
  u.speed = SPEED.guardRun * 0.8;
  if (!u.path.length) {
    if (Math.hypot(ai.lastX - u.x, ai.lastY - u.y) > 1.5 && ai.wait === 0) {
      goTo(sim, u, ai.lastX, ai.lastY, 6000);
      ai.wait = 0.01;
      return;
    }
    ai.wait += dt;
    ai.sweepT += dt;
    u.dir += 0.04;
    if (ai.wait > 5) backToRoutine(sim, u);
  }
}

function alert(sim: Sim, u: Unit, dt: number): void {
  const ai = u.ai!;
  u.speed = SPEED.guardRun;
  ai.repath -= dt;
  if (ai.stay) { u.path = []; if (!u.aiming) u.dir = Math.atan2(ai.lastY - u.y, ai.lastX - u.x); return; }
  if (u.aiming) {
    // most stand and shoot; every third one keeps pushing in, Fodder style
    const d = Math.hypot(u.aimX - u.x, u.aimY - u.y);
    if (u.id % 3 === 0 && d > 9) {
      if (ai.repath <= 0) { goTo(sim, u, u.aimX, u.aimY, 4000); ai.repath = 1; }
    } else u.path = [];
    return;
  }
  const d = Math.hypot(ai.lastX - u.x, ai.lastY - u.y);
  if (d > 1.5) {
    if (ai.repath <= 0 || !u.path.length) { goTo(sim, u, ai.lastX, ai.lastY, 6000); ai.repath = 1.2; }
    return;
  }
  // reached the last known place and nobody there
  if (sim.state.time - ai.lastT > 6) {
    if (sim.alarmUp(ai.district)) {
      // keep hunting near the last sighting
      if (!u.path.length) {
        const a = sim.rand() * Math.PI * 2, r = 4 + sim.rand() * 6;
        const p = sim.grid.nearestWalkable(ai.lastX + Math.cos(a) * r, ai.lastY + Math.sin(a) * r, 4);
        if (p) goTo(sim, u, p.x, p.y, 3000);
      }
    } else {
      ai.mode = "search";
      ai.wait = 0;
      setGlyph(sim, u, "suspicious");
    }
  }
}

function civilian(sim: Sim, u: Unit): void {
  const ai = u.ai!;
  if (ai.mode === "flee") {
    u.speed = SPEED.civilianFlee;
    if (!u.path.length) {
      if (Math.hypot(ai.homeX - u.x, ai.homeY - u.y) < 1.2) { u.hidden = true; return; }
      goTo(sim, u, ai.homeX, ai.homeY, 6000);
    }
    return;
  }
  if (ai.mode === "patrol" && ai.route && ai.route.length && !u.path.length) {
    ai.routeI = (ai.routeI + 1) % ai.route.length;
    const p = ai.route[ai.routeI];
    u.speed = SPEED.civilianWalk;
    goTo(sim, u, p.x, p.y, 5000);
  }
}

export function processNoises(sim: Sim): void {
  if (!sim.noises.length) return;
  for (const n of sim.noises) {
    for (const u of sim.state.units) {
      if (!u.ai || u.state !== "ok" || u.hidden || u.ai.blind) continue;
      const d = Math.hypot(u.x - n.x, u.y - n.y);
      if (d > n.r) continue;
      if (u.side === "civ") {
        if (n.gun && u.ai.mode !== "flee") { u.ai.mode = "flee"; u.path = []; }
        continue;
      }
      if (u.side !== "de" || u.ai.mode === "alert") continue;
      if (n.gun && d <= n.r * 0.7) goAlert(sim, u, n.x, n.y);
      else if (n.gun) {
        u.ai.mode = "search";
        u.ai.wait = 0;
        u.ai.lastX = n.x;
        u.ai.lastY = n.y;
        u.ai.lastT = sim.state.time;
        u.path = [];
        setGlyph(sim, u, "suspicious");
      } else if (u.ai.mode === "post" || u.ai.mode === "patrol") {
        u.ai.mode = "suspicious";
        u.ai.wait = 0;
        u.ai.meter = Math.max(u.ai.meter, DETECT.suspicious);
        u.ai.lastX = n.x;
        u.ai.lastY = n.y;
        setGlyph(sim, u, "suspicious");
      }
    }
  }
  sim.noises = [];
}

export function stepSpawners(sim: Sim, dt: number): void {
  const s = sim.state;
  for (const sp of s.spawners) {
    if (!sp.active || sp.destroyed || sp.left === 0) continue;
    sp.cd -= dt;
    if (sp.cd > 0) continue;
    const tag = `spawn:${sp.id}`;
    const alive = s.units.filter((u) => u.tag === tag && u.state !== "dead").length;
    if (alive >= sp.maxAlive) { sp.cd = 1; continue; }
    if (sp.left > 0) sp.left--;
    sp.cd = sp.interval;
    const at = s.alarm[sp.district] !== undefined ? nearestPartisan(sim, sp.ox, sp.oy) : null;
    const g = sim.spawnUnit({
      side: "de", look: sp.look, x: sp.x, y: sp.y, weapon: germanWeapon(sp.look), tag,
      ai: { mode: "alert", district: sp.district, lastX: at ? at.x : sp.ox, lastY: at ? at.y : sp.oy, lastT: s.time, react: 0.8 },
    });
    g.glyph = "alert";
    goTo(sim, g, sp.ox, sp.oy, 3000);
  }
}

function nearestPartisan(sim: Sim, x: number, y: number): Unit | null {
  let best: Unit | null = null, bd = Infinity;
  for (const u of sim.state.units) {
    if (u.side !== "pl" || u.state === "dead" || u.hidden) continue;
    const d = (u.x - x) ** 2 + (u.y - y) ** 2;
    if (d < bd) { bd = d; best = u; }
  }
  return best;
}
