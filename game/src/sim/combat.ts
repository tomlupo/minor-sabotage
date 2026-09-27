// Shooting, throwing, burning. The player shoots (decision: rung 3, no squad fights on its
// own): the squad you lead fires only at what you tap or where you hold FIRE. Squads left
// on orders fire into their cover cone, and return fire at whoever shoots at them (rung 2,
// decided 2026-09-28). Guards shoot once alerted.
import type { Sim } from "./sim";
import type { Unit, Vehicle } from "./types";
import { F_COVER } from "./grid";
import { gauss } from "./rng";
import { setAnim } from "./move";
import { THROW, UNIT_RADIUS, WEAPONS, spreadForRank } from "./tuning";

interface Aim {
  x: number;
  y: number;
  target: number;
}

const RETURN_FIRE_WINDOW = 4;

export function stepCombat(sim: Sim, dt: number): void {
  const s = sim.state;
  for (const u of s.units) {
    if (u.state !== "ok" || u.hidden || u.weapon === "none") continue;
    u.fireCd -= dt;
    if (u.task) { u.aiming = false; continue; }
    const aim = u.side === "pl" ? partisanAim(sim, u) : u.side === "de" ? guardAim(sim, u) : null;
    if (!aim) { u.aiming = false; u.burst = 0; continue; }
    u.aiming = true;
    u.aimX = aim.x;
    u.aimY = aim.y;
    u.dir = Math.atan2(aim.y - u.y, aim.x - u.x);
    if (u.fireCd > 0) continue;
    fireRound(sim, u, aim);
  }
}

function visibleEnemy(sim: Sim, u: Unit, id: number, range: number): Unit | null {
  const v = sim.unit(id);
  if (!v || v.state === "dead" || v.hidden) return null;
  if (Math.hypot(v.x - u.x, v.y - u.y) > range) return null;
  if (!sim.grid.los(u.x, u.y, v.x, v.y)) return null;
  return v;
}

function partisanAim(sim: Sim, u: Unit): Aim | null {
  const s = sim.state;
  const sq = sim.squad(u.squad);
  if (!sq) return null;
  const W = WEAPONS[u.weapon];
  // 1. the squad's locked target
  if (sq.target >= 0) {
    const v = visibleEnemy(sim, u, sq.target, W.range);
    if (v) return { x: v.x, y: v.y, target: v.id };
    const t = sim.unit(sq.target);
    if (!t || t.state === "dead" || t.hidden) sq.target = -1;
  }
  // 2. FIRE held on a point
  if (sq.fireUntil > s.time) {
    const d = Math.hypot(sq.fireAtX - u.x, sq.fireAtY - u.y);
    if (d <= W.range * 1.05) return { x: sq.fireAtX, y: sq.fireAtY, target: -1 };
  }
  if (s.controlled === sq.id && sq.order === "follow") return null;
  // 3. a squad on orders: its cover cone
  if (sq.order === "cover") {
    let best: Unit | null = null, bd = Infinity;
    for (const v of s.units) {
      if (v.side !== "de" || v.state === "dead" || v.hidden) continue;
      const d = Math.hypot(v.x - u.x, v.y - u.y);
      if (d > W.range || d >= bd) continue;
      const a = Math.atan2(v.y - sq.restY, v.x - sq.restX);
      if (Math.abs(angDiff(a, sq.coverDir)) > sq.coverHalf) continue;
      if (!sim.grid.los(u.x, u.y, v.x, v.y)) continue;
      best = v; bd = d;
    }
    if (best) return { x: best.x, y: best.y, target: best.id };
  }
  // 4. return fire at whoever shot at the squad (rung 2)
  let shooter = -1, when = -Infinity;
  for (const id of sq.members) {
    const m = sim.unit(id);
    if (m && m.shotBy >= 0 && m.shotByT > when && s.time - m.shotByT < RETURN_FIRE_WINDOW) { shooter = m.shotBy; when = m.shotByT; }
  }
  if (shooter >= 0) {
    const v = visibleEnemy(sim, u, shooter, W.range);
    if (v && v.side === "de") return { x: v.x, y: v.y, target: v.id };
  }
  return null;
}

function guardAim(sim: Sim, u: Unit): Aim | null {
  const ai = u.ai;
  if (!ai || ai.mode !== "alert" || ai.blind) return null;
  const W = WEAPONS[u.weapon];
  let best: Unit | null = null, bd = Infinity;
  for (const v of sim.state.units) {
    if (v.side !== "pl" || v.state === "dead" || v.hidden) continue;
    const d = Math.hypot(v.x - u.x, v.y - u.y) - (v.id === u.shotBy ? 4 : 0) + (v.state === "down" ? 6 : 0);
    if (d > W.range || d >= bd) continue;
    if (!sim.grid.los(u.x, u.y, v.x, v.y)) continue;
    best = v; bd = d;
  }
  if (!best) { ai.react = Math.max(ai.react, 0.35); return null; }
  ai.lastX = best.x; ai.lastY = best.y; ai.lastT = sim.state.time;
  if (ai.react > 0) { ai.react -= 1 / 30; u.dir = Math.atan2(best.y - u.y, best.x - u.x); return null; }
  return { x: best.x, y: best.y, target: best.id };
}

export function angDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function fireRound(sim: Sim, u: Unit, aim: Aim): void {
  const W = WEAPONS[u.weapon];
  const G = sim.grid;
  const base = Math.atan2(aim.y - u.y, aim.x - u.x);
  const spread = spreadForRank(W, u.rank) * (u.moving ? 1.35 : 1) * (u.wounded ? 1.25 : 1);
  const ang = base + gauss(sim.state.rng) * spread * 0.5;
  const cos = Math.cos(ang), sin = Math.sin(ang);
  const x0 = u.x + Math.cos(base) * 0.35, y0 = u.y + Math.sin(base) * 0.35;
  const maxD = W.range * 1.15;
  let hitT = maxD;
  const sx = Math.floor(u.x), sy = Math.floor(u.y);
  const coverTs: number[] = [];
  G.traverse(x0, y0, x0 + cos * maxD, y0 + sin * maxD, (cx, cy, t) => {
    if (cx === sx && cy === sy) return false;
    if (G.blocksSightCell(cx, cy)) { hitT = t; return true; }
    if (G.flags[cy * G.w + cx] & F_COVER) coverTs.push(t);
    return false;
  });
  let hitUnit: Unit | null = null;
  for (const v of sim.state.units) {
    if (v === u || v.state === "dead" || v.hidden) continue;
    if (v.side === u.side) continue;
    if (u.side === "pl" && v.side === "pris") continue;
    const px = v.x - x0, py = v.y - y0;
    const t = px * cos + py * sin;
    if (t <= 0 || t >= hitT) continue;
    const perp = Math.abs(px * sin - py * cos);
    const r = v.state === "down" ? UNIT_RADIUS * 0.8 : UNIT_RADIUS * 1.15;
    if (perp < r) { hitT = t; hitUnit = v; }
  }
  // low cover in front of the target stops some rounds
  if (hitUnit) {
    for (const ct of coverTs) {
      if (ct < hitT && hitT - ct < 1.6 && sim.rand() < 0.55) { hitT = ct; hitUnit = null; break; }
    }
  }
  let hitVeh: Vehicle | null = null;
  for (const v of sim.state.vehicles) {
    if (v.state === "wreck" && v.kind !== "tram") continue;
    const t = rayRect(x0, y0, cos, sin, v);
    if (t !== null && t < hitT) { hitT = t; hitVeh = v; hitUnit = null; }
  }
  const x1 = x0 + cos * hitT, y1 = y0 + sin * hitT;
  sim.emit({ t: "shot", x0, y0, x1, y1, weapon: u.weapon, side: u.side, by: u.id, hit: hitUnit ? hitUnit.id : hitVeh ? -2 : -1 });
  u.sinceShot = 0;
  sim.noise(u.x, u.y, W.noise, true);
  setAnim(u, "fire", 0.16);
  if (hitUnit) sim.hurt(hitUnit, u.id, "bullet");
  else if (hitVeh) vehicleHit(sim, hitVeh, x1, y1, u.id, 1);
  u.burst++;
  if (u.burst >= W.burst) { u.burst = 0; u.fireCd = W.reload * (0.85 + sim.rand() * 0.3); }
  else u.fireCd = W.cadence;
}

/** Ray against a vehicle's oriented rectangle; distance or null. */
function rayRect(x0: number, y0: number, dx: number, dy: number, v: Vehicle): number | null {
  const c = Math.cos(-v.heading), s = Math.sin(-v.heading);
  const ox = x0 - v.x, oy = y0 - v.y;
  const lx = ox * c - oy * s, ly = ox * s + oy * c;
  const ldx = dx * c - dy * s, ldy = dx * s + dy * c;
  const hx = v.len / 2, hy = v.wid / 2;
  let tmin = -Infinity, tmax = Infinity;
  for (const [o, d, h] of [[lx, ldx, hx], [ly, ldy, hy]] as [number, number, number][]) {
    if (Math.abs(d) < 1e-9) { if (o < -h || o > h) return null; continue; }
    let t1 = (-h - o) / d, t2 = (h - o) / d;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  if (tmax < 0) return null;
  return Math.max(0, tmin);
}

export function vehicleHit(sim: Sim, v: Vehicle, hx: number, hy: number, by: number, dmg: number): void {
  v.hp -= dmg;
  sim.emit({ t: "hit", unit: -1, x: hx, y: hy, vehicle: v.id });
  const along = (hx - v.x) * Math.cos(v.heading) + (hy - v.y) * Math.sin(v.heading);
  if (along > v.len * 0.18 && !v.driverDead && v.crew.length && v.speed > 0.1 && sim.rand() < 0.22 * dmg) {
    killDriver(sim, v, by);
  }
  if (v.hp <= 0 && v.state !== "wreck" && v.state !== "burning") setVehicleState(sim, v, "burning");
}

export function killDriver(sim: Sim, v: Vehicle, by: number): void {
  v.driverDead = true;
  const d = sim.unit(v.crew[0]);
  if (d) {
    d.hidden = false;
    d.x = v.x + Math.cos(v.heading) * v.len * 0.3;
    d.y = v.y + Math.sin(v.heading) * v.len * 0.3;
    sim.kill(d, by, false);
    v.crew.shift();
  }
}

export function setVehicleState(sim: Sim, v: Vehicle, st: Vehicle["state"]): void {
  if (v.state === st) return;
  v.state = st;
  if (st === "burning") v.burnT = 0;
  sim.emit({ t: "vehicle", id: v.id, state: st });
}

// ------------------------------------------------------------------ projectiles

export function stepProjectiles(sim: Sim, dt: number): void {
  const s = sim.state;
  const done: number[] = [];
  for (const p of s.projectiles) {
    p.t += dt;
    if (p.t < p.dur) continue;
    done.push(p.id);
    if (p.kind === "grenade") explode(sim, p.x1, p.y1, p.owner);
    else bottle(sim, p.x1, p.y1, p.owner);
  }
  if (done.length) s.projectiles = s.projectiles.filter((p) => !done.includes(p.id));
}

export function explode(sim: Sim, x: number, y: number, owner: number, power = 1): void {
  const s = sim.state;
  sim.emit({ t: "explosion", x, y, r: THROW.grenadeHurt * power });
  sim.noise(x, y, 65, true);
  for (const u of s.units) {
    if (u.state === "dead" || u.hidden) continue;
    const d = Math.hypot(u.x - x, u.y - y);
    if (d > THROW.grenadeHurt * power) continue;
    if (!sim.grid.los(x, y, u.x, u.y)) continue;
    if (d <= THROW.grenadeKill * power) sim.hurt(u, owner, "blast");
    else if (sim.rand() < 0.6) sim.hurt(u, owner, "bullet");
  }
  for (const pr of s.props) {
    if (pr.state === "destroyed") continue;
    const d = Math.hypot(pr.x - x, pr.y - y);
    if (d > 2.8 * power) continue;
    damageProp(sim, pr.id, 3);
  }
  for (const sp of s.spawners) {
    if (!sp.destroyed && Math.hypot(sp.x - x, sp.y - y) <= 2.8 * power) {
      sp.destroyed = true;
      sp.active = false;
      sim.message("Guard post silenced", "good");
      sim.emit({ t: "prop", id: sp.id, state: "destroyed" });
    }
  }
  for (const v of s.vehicles) {
    const d = Math.hypot(v.x - x, v.y - y) - v.len / 2;
    if (d <= 2.5 * power) vehicleHit(sim, v, x, y, owner, 10);
  }
}

function bottle(sim: Sim, x: number, y: number, owner: number): void {
  const s = sim.state;
  sim.emit({ t: "bottle", x, y });
  sim.noise(x, y, 24, true);
  const f = { id: s.nextId++, x, y, r: THROW.bottleR, t: THROW.bottleBurn };
  s.fires.push(f);
  sim.emit({ t: "fire", id: f.id, x, y, on: true });
  for (const v of s.vehicles) {
    if (pointNearVehicle(v, x, y, 1.4)) {
      if (v.state === "intact" || v.state === "doors_open") setVehicleState(sim, v, "burning");
      if (!v.driverDead && v.crew.length && v.speed > 0.1 && sim.rand() < 0.5) killDriver(sim, v, owner);
    }
  }
  for (const u of s.units) {
    if (u.state === "dead" || u.hidden) continue;
    if (Math.hypot(u.x - x, u.y - y) < 1.1) sim.hurt(u, owner, "fire");
  }
}

export function pointNearVehicle(v: Vehicle, x: number, y: number, pad: number): boolean {
  const c = Math.cos(-v.heading), s = Math.sin(-v.heading);
  const ox = x - v.x, oy = y - v.y;
  const lx = ox * c - oy * s, ly = ox * s + oy * c;
  return Math.abs(lx) <= v.len / 2 + pad && Math.abs(ly) <= v.wid / 2 + pad;
}

export function damageProp(sim: Sim, id: number, dmg: number): void {
  const pr = sim.state.props.find((p) => p.id === id);
  if (!pr || pr.state === "destroyed") return;
  pr.hp -= dmg;
  if (pr.hp > 0) return;
  const burns = pr.kind === "kiosk" || pr.kind === "barrel" || pr.kind === "crates" || pr.kind === "cart";
  pr.state = burns && pr.state !== "burning" ? "burning" : "destroyed";
  sim.emit({ t: "prop", id: pr.id, state: pr.state });
  if (pr.state === "burning") {
    const f = { id: sim.state.nextId++, x: pr.x, y: pr.y, r: 1.4, t: 10 };
    sim.state.fires.push(f);
    sim.emit({ t: "fire", id: f.id, x: pr.x, y: pr.y, on: true });
  }
}

// ------------------------------------------------------------------ fires

export function stepFires(sim: Sim, dt: number): void {
  const s = sim.state;
  if (!s.fires.length) return;
  const tickHurt = s.tick % 15 === 0;
  for (const f of s.fires) {
    f.t -= dt;
    if (!tickHurt) continue;
    for (const u of s.units) {
      if (u.state === "dead" || u.hidden) continue;
      if (Math.hypot(u.x - f.x, u.y - f.y) < f.r * 0.8 && sim.rand() < 0.35) sim.hurt(u, -1, "fire");
    }
    for (const v of s.vehicles) {
      if (v.state === "intact" && pointNearVehicle(v, f.x, f.y, f.r * 0.5)) setVehicleState(sim, v, "burning");
    }
  }
  const out = s.fires.filter((f) => f.t <= 0);
  if (out.length) {
    for (const f of out) sim.emit({ t: "fire", id: f.id, x: f.x, y: f.y, on: false });
    s.fires = s.fires.filter((f) => f.t > 0);
  }
}
