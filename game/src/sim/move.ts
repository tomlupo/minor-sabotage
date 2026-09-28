// Walking. The squad is a column behind its leader (Cannon Fodder's snake): followers walk
// the leader's breadcrumb trail, and when he stops they form up around him. Prisoners follow
// the nearest trooper like Fodder's hostages.
import type { Sim } from "./sim";
import type { Squad, Unit } from "./types";
import type { Pt } from "./path";
import { SPEED, SQUAD, UNIT_RADIUS } from "./tuning";
import { outOfColumn } from "./tasks";

const TRAIL_MAX = 80;

export function setAnim(u: Unit, a: Unit["anim"], lock = 0): void {
  if (u.anim !== a) {
    u.anim = a;
    u.animT = 0;
  }
  if (lock > 0) u.animLock = Math.max(u.animLock, lock);
}

/** Send a unit along a route to (x, y). Returns false if no route. */
export function goTo(sim: Sim, u: Unit, x: number, y: number, maxNodes = 12000): boolean {
  u.goalX = x;
  u.goalY = y;
  if (Math.hypot(x - u.x, y - u.y) < 0.2) { u.path = []; return true; }
  if (sim.grid.walkLine(u.x, u.y, x, y, 0.3) && sim.inBounds(x, y)) {
    u.path = [{ x, y }];
    return true;
  }
  const r = sim.route({ x: u.x, y: u.y }, { x, y }, maxNodes);
  if (!r || !r.length) { u.path = []; return false; }
  u.path = r;
  return true;
}

export function stepMovement(sim: Sim, dt: number): void {
  const G = sim.grid;
  const units = sim.state.units;
  for (const u of units) {
    if (u.state !== "ok" || u.hidden) continue;
    const kneeling = u.task && (u.task.kind === "work" || u.task.kind === "help") && u.task.phase === "work";
    if (u.path.length && !kneeling) {
      const p = u.path[0];
      const dx = p.x - u.x, dy = p.y - u.y;
      const d = Math.hypot(dx, dy);
      const sp = u.speed * (u.wounded ? 0.75 : 1);
      const stepLen = sp * dt;
      if (d <= stepLen || d < 0.04) {
        u.x = p.x;
        u.y = p.y;
        u.path.shift();
      } else {
        const nx = u.x + (dx / d) * stepLen, ny = u.y + (dy / d) * stepLen;
        if (G.walkable(nx, ny)) { u.x = nx; u.y = ny; }
        else if (G.walkable(nx, u.y)) u.x = nx;
        else if (G.walkable(u.x, ny)) u.y = ny;
        else {
          // blocked (a vehicle pulled in): try again around it
          const last = u.path[u.path.length - 1];
          const r = sim.route({ x: u.x, y: u.y }, last, 4000);
          u.path = r ?? [];
        }
      }
      if (d > 0.01 && u.animLock <= 0) u.dir = Math.atan2(dy, dx);
      u.moving = true;
    } else {
      u.moving = false;
    }
    if (u.animLock <= 0) {
      if (kneeling) setAnim(u, "kneel");
      else setAnim(u, u.moving ? "walk" : "idle");
    }
  }
  separate(sim);
}

/** Soft personal space so a squad never stacks into one sprite. */
function separate(sim: Sim): void {
  const G = sim.grid;
  const us = sim.state.units;
  const min = UNIT_RADIUS * 2 * 0.95;
  for (let i = 0; i < us.length; i++) {
    const a = us[i];
    if (a.state === "dead" || a.hidden) continue;
    for (let j = i + 1; j < us.length; j++) {
      const b = us[j];
      if (b.state === "dead" || b.hidden) continue;
      const dx = b.x - a.x, dy = b.y - a.y;
      if (Math.abs(dx) > min || Math.abs(dy) > min) continue;
      const d = Math.hypot(dx, dy);
      if (d >= min) continue;
      const push = (min - d) * 0.5;
      const nx = d > 1e-4 ? dx / d : 1, ny = d > 1e-4 ? dy / d : 0;
      // the one standing still gives way less
      const wa = a.state !== "ok" ? 0 : a.moving ? 0.5 : 0.35;
      const wb = b.state !== "ok" ? 0 : b.moving ? 0.5 : 0.35;
      const tot = wa + wb || 1;
      const ax = a.x - nx * push * (wa / tot) * 2, ay = a.y - ny * push * (wa / tot) * 2;
      const bx = b.x + nx * push * (wb / tot) * 2, by = b.y + ny * push * (wb / tot) * 2;
      if (wa && G.walkable(ax, ay)) { a.x = ax; a.y = ay; }
      if (wb && G.walkable(bx, by)) { b.x = bx; b.y = by; }
    }
  }
}

export function recordTrails(sim: Sim): void {
  for (const sq of sim.state.squads) {
    if (!sq.inPlay) continue;
    const L = sim.leaderOf(sq);
    if (!L) continue;
    const t = sq.trail;
    if (!t.length || Math.hypot(t[0].x - L.x, t[0].y - L.y) >= SQUAD.trailStep) {
      t.unshift({ x: L.x, y: L.y });
      if (t.length > TRAIL_MAX) t.length = TRAIL_MAX;
    }
  }
}

/** A point `dist` metres back along the trail from the leader. */
function trailPoint(sq: Squad, L: Unit, dist: number): Pt {
  let acc = 0;
  let prev: Pt = { x: L.x, y: L.y };
  for (const p of sq.trail) {
    const seg = Math.hypot(p.x - prev.x, p.y - prev.y);
    if (acc + seg >= dist) {
      const k = seg > 0 ? (dist - acc) / seg : 0;
      return { x: prev.x + (p.x - prev.x) * k, y: prev.y + (p.y - prev.y) * k };
    }
    acc += seg;
    prev = p;
  }
  return prev;
}

const SLOT_ANGLES = [0, 0.75, -0.75, 1.45, -1.45, 2.2, -2.2];

/** Formation slots behind a resting leader, pushed onto walkable ground. */
export function restSlots(sim: Sim, x: number, y: number, dir: number, n: number): Pt[] {
  const G = sim.grid;
  const out: Pt[] = [];
  for (let k = 0; k < n; k++) {
    const a = dir + Math.PI + SLOT_ANGLES[k % SLOT_ANGLES.length];
    const r = 1.25 + Math.floor(k / SLOT_ANGLES.length) * 0.9 + (k % 2) * 0.12;
    let px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
    if (!G.walkable(px, py) || !G.walkLine(x, y, px, py, 0.2)) {
      // try the slot at a shorter radius, then anywhere near
      const near = G.nearestWalkable(px, py, 2);
      if (near && G.walkLine(x, y, near.x, near.y, 0.2)) { px = near.x; py = near.y; }
      else { px = x + Math.cos(a) * 0.7; py = y + Math.sin(a) * 0.7; if (!G.walkable(px, py)) { px = x; py = y; } }
    }
    out.push({ x: px, y: py });
  }
  return out;
}

function busy(u: Unit): boolean {
  return outOfColumn(u);
}

export function stepSquads(sim: Sim, dt: number): void {
  const s = sim.state;
  for (const sq of s.squads) {
    if (!sq.inPlay) continue;
    const L = sim.leaderOf(sq);
    if (!L) continue;
    L.speed = SPEED.partisan;

    // Leader behaviour by order.
    if (sq.order === "signal" && s.signalGiven && sq.signalRoute) {
      L.path = sq.signalRoute.slice();
      sq.signalRoute = null;
      sq.order = "hold";
    }
    if (L.moving || L.path.length) {
      sq.restX = L.x; sq.restY = L.y; sq.restDir = L.dir;
    } else if (Math.hypot(sq.restX - L.x, sq.restY - L.y) > 0.6) {
      sq.restX = L.x; sq.restY = L.y; sq.restDir = L.dir;
    }

    // Followers.
    const followers = sim.membersOf(sq).filter((u) => u !== L && u.state === "ok");
    const moving = L.moving || L.path.length > 0;
    const slots = moving ? null : restSlots(sim, sq.restX, sq.restY, sq.restDir, followers.length);
    followers.forEach((u, k) => {
      // the man picked on the strip goes where he is sent, not back into the column
      if (busy(u) || u.yieldUntil > s.time || u.id === s.picked) return;
      const target = moving ? trailPoint(sq, L, SQUAD.spacing * (k + 1)) : slots![k];
      const d = Math.hypot(target.x - u.x, target.y - u.y);
      if (d < (moving ? 0.35 : 0.25)) { if (!moving) u.path = []; return; }
      // catch up if the column stretched (stepMovement applies the wound slowdown)
      u.speed = SPEED.partisan * (d > 3 ? 1.25 : 1);
      if (sim.grid.walkLine(u.x, u.y, target.x, target.y, 0.25)) {
        u.path = [target];
      } else {
        // off the trail (pushed round a corner): route, but not every tick
        if (u.path.length && Math.hypot(u.goalX - target.x, u.goalY - target.y) < 1.5) return;
        if ((s.tick + u.id) % 6 !== 0) return;
        goTo(sim, u, target.x, target.y, 3000);
      }
      u.goalX = target.x; u.goalY = target.y;
    });
  }
  stepFollowers(sim, dt);
}

/** Freed prisoners follow the nearest trooper (Cannon Fodder's hostages). */
function stepFollowers(sim: Sim, _dt: number): void {
  const s = sim.state;
  const pl = s.units.filter((u) => u.side === "pl" && sim.active(u));
  // how many already tail each trooper, so they queue instead of crowding
  const queue = new Map<number, number>();
  for (const u of s.units) {
    if (u.side !== "pris" || !sim.active(u) || u.tag === "rudy" || u.yieldUntil > s.time) continue;
    let f = sim.unit(u.follow);
    if (!sim.active(f) || f!.side !== "pl") {
      u.follow = -1;
      let best: Unit | undefined, bd = 12 * 12;
      for (const p of pl) {
        const d = (p.x - u.x) ** 2 + (p.y - u.y) ** 2;
        if (d < bd) { bd = d; best = p; }
      }
      if (!best) continue;
      u.follow = best.id;
      f = best;
    }
    const n = queue.get(f!.id) ?? 0;
    queue.set(f!.id, n + 1);
    const back = 1.3 + n * 0.8;
    const bx = f!.x - Math.cos(f!.dir) * back + ((n % 2) ? 0.5 : -0.5);
    const by = f!.y - Math.sin(f!.dir) * back;
    const d = Math.hypot(bx - u.x, by - u.y);
    if (d < 0.6) { u.path = []; continue; }
    if ((s.tick + u.id) % 5 !== 0 && u.path.length) continue;
    if (sim.grid.walkLine(u.x, u.y, bx, by, 0.25)) u.path = [{ x: bx, y: by }];
    else goTo(sim, u, bx, by, 2500);
  }
}
