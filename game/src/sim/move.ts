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

/**
 * A fire is a pause, not a wall. Routes run where they always ran; a man about to step into
 * burning petrol, or deeper into it, stays where he is and goes on when it has burnt out (a
 * bottle's fire lasts seconds). Whether (x1, y1) is such a step.
 */
function entersFire(sim: Sim, x0: number, y0: number, x1: number, y1: number): boolean {
  for (const f of sim.state.fires) {
    const R = f.r * 0.8 + FIRE_MARGIN;
    const d1 = Math.hypot(x1 - f.x, y1 - f.y);
    if (d1 < R && d1 < Math.hypot(x0 - f.x, y0 - f.y)) return true;
  }
  return false;
}

/** How far outside a fire's harm (0.8 of its radius) a man keeps. */
const FIRE_MARGIN = 0.3;
/**
 * How far past a fire's harm a man it has caught aims. His step stops short of a point under
 * 1 cm off (stepMovement), so aiming at the edge itself would leave him standing just inside it.
 */
const FIRE_CLEAR = 0.05;
/** How far round him, in metres and in cells, a man a fire has caught looks for the way out. */
const FIRE_LOOK = 5;

/** The 32 directions a man a fire has caught looks along for a straight way out of it. */
const RAYS = Array.from({ length: 32 }, (_, k): [number, number] => [Math.cos((k * Math.PI) / 16), Math.sin((k * Math.PI) / 16)]);
const STEPS8: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

/**
 * Where a man a fire has caught (inside its harm) heads: FIRE_CLEAR past every fire's harm, by
 * the shortest walk over open ground, through the fire where that is shortest. Standing in it he
 * dies (combat.ts stepFires), and how deep he goes on the way matters less than how long he
 * takes. He stops once out. Null when there is no way out: he stays, and the pause in
 * stepMovement keeps him from going deeper.
 */
function wayOutOfFire(sim: Sim, u: Unit): Pt | null {
  return straightOut(sim, u) ?? wayRound(sim, u);
}

/**
 * Where the shortest straight walk out (see wayOutOfFire) along RAYS, cutting no corner, comes
 * clear; null if none does within FIRE_LOOK. Where each ray comes clear is worked out exactly:
 * from any point on the one he takes, the rest of it is still open and a step shorter, so the
 * way left only shortens and he cannot turn back and forth.
 */
function straightOut(sim: Sim, u: Unit): Pt | null {
  const G = sim.grid;
  let best: Pt | null = null, bestS = FIRE_LOOK;
  for (const [dx, dy] of RAYS) {
    const end = clearAlong(sim, u.x, u.y, dx, dy);
    if (end >= bestS) continue;
    // over open ground all the way from his own cell (a man standing in a vehicle's outline is
    // walked off it by wayRound); steps shorter than a cell miss none it crosses
    let cx = Math.floor(u.x), cy = Math.floor(u.y), open = G.walkableCell(cx, cy);
    for (let s = 0; open && s < end; ) {
      s = Math.min(s + 0.1, end);
      const nx = Math.floor(u.x + dx * s), ny = Math.floor(u.y + dy * s);
      open = (nx === cx && ny === cy) || G.canStep(cx, cy, nx - cx, ny - cy);
      cx = nx;
      cy = ny;
    }
    if (open) {
      best = { x: u.x + dx * end, y: u.y + dy * end };
      bestS = end;
    }
  }
  return best;
}

/** How far along the line from (x, y) in the direction (dx, dy) (of length 1) it comes FIRE_CLEAR past every fire's harm. */
function clearAlong(sim: Sim, x: number, y: number, dx: number, dy: number): number {
  let s = 0;
  for (let on = true; on; ) {
    on = false;
    for (const f of sim.state.fires) {
      const R = f.r * 0.8 + FIRE_CLEAR, wx = x + dx * s - f.x, wy = y + dy * s - f.y;
      const b = wx * dx + wy * dy, c = wx * wx + wy * wy - R * R;
      if (c >= 0) continue;
      // inside this one: on to where the line leaves it
      s += Math.sqrt(b * b - c) - b + 1e-6;
      on = true;
    }
  }
  return s;
}

/**
 * Where a man a fire has caught heads when walls or a vehicle leave him no straight way out: the
 * centre of the first cell of the shortest walk, in metres, round them to a cell clear of the
 * fires (see wayOutOfFire), within FIRE_LOOK cells; null if there is none.
 */
function wayRound(sim: Sim, u: Unit): Pt | null {
  const G = sim.grid, n = 2 * FIRE_LOOK + 1;
  const ox = Math.floor(u.x) - FIRE_LOOK, oy = Math.floor(u.y) - FIRE_LOOK, start = FIRE_LOOK * n + FIRE_LOOK;
  const dist = new Array<number>(n * n).fill(Infinity), first = new Array<number>(n * n).fill(-1);
  const done = new Array<boolean>(n * n).fill(false);
  dist[start] = 0;
  for (;;) {
    let k = -1;
    for (let i = 0; i < n * n; i++) if (!done[i] && dist[i] < (k < 0 ? Infinity : dist[k])) k = i;
    if (k < 0) return null;
    done[k] = true;
    const cx = ox + (k % n), cy = oy + Math.floor(k / n);
    if (k !== start && !sim.fireAt(cx + 0.5, cy + 0.5, FIRE_CLEAR)) {
      const f = first[k];
      return { x: ox + (f % n) + 0.5, y: oy + Math.floor(f / n) + 0.5 };
    }
    // out of his own cell from where he stands, on from a cell's centre
    const x0 = k === start ? u.x : cx + 0.5, y0 = k === start ? u.y : cy + 0.5;
    for (const [dx, dy] of STEPS8) {
      const i = k + dy * n + dx;
      if (cx + dx < ox || cy + dy < oy || cx + dx >= ox + n || cy + dy >= oy + n || done[i] || !G.canStep(cx, cy, dx, dy)) continue;
      const d = dist[k] + Math.hypot(cx + dx + 0.5 - x0, cy + dy + 0.5 - y0);
      if (d < dist[i]) {
        dist[i] = d;
        first[i] = k === start ? i : first[k];
      }
    }
  }
}

export function stepMovement(sim: Sim, dt: number): void {
  const G = sim.grid;
  const units = sim.state.units;
  for (const u of units) {
    if (u.state !== "ok" || u.hidden) continue;
    const kneeling = u.task && (u.task.kind === "work" || u.task.kind === "help") && u.task.phase === "work";
    const sp = u.speed * (u.wounded ? 0.75 : 1);
    // a man a fire has caught walks clear of it first (wayOutOfFire), whatever he was doing; his
    // orders wait. A man kneeling at a job stays put here (the work task moves him to the fire's
    // edge itself: tasks.ts work)
    const way = !kneeling && sim.fireAt(u.x, u.y) ? wayOutOfFire(sim, u) : null;
    if (way) {
      const dx = way.x - u.x, dy = way.y - u.y, d = Math.hypot(dx, dy), step = sp * dt;
      if (d > 0.01) {
        const k = Math.min(1, step / d);
        if (u.animLock <= 0) u.dir = Math.atan2(dy, dx);
        u.x += dx * k;
        u.y += dy * k;
        u.moving = true;
        if (u.animLock <= 0) setAnim(u, "walk");
        continue;
      }
    }
    if (u.path.length && !kneeling) {
      const p = u.path[0];
      const dx = p.x - u.x, dy = p.y - u.y;
      const d = Math.hypot(dx, dy);
      const stepLen = sp * dt;
      const arrive = d <= stepLen || d < 0.04;
      const nx = arrive ? p.x : u.x + (dx / d) * stepLen, ny = arrive ? p.y : u.y + (dy / d) * stepLen;
      // he waits at the fire's edge until it is out
      if (entersFire(sim, u.x, u.y, nx, ny)) {
        u.moving = false;
      } else if (arrive) {
        u.x = p.x;
        u.y = p.y;
        u.path.shift();
        u.moving = true;
      } else {
        // (a slide along one axis counts only when it moves him: walking square into a closed
        // cell, a zero step "succeeded" and he stood still for ever)
        if (G.walkable(nx, ny)) { u.x = nx; u.y = ny; }
        else if (Math.abs(nx - u.x) > 1e-4 && G.walkable(nx, u.y)) u.x = nx;
        else if (Math.abs(ny - u.y) > 1e-4 && G.walkable(u.x, ny)) u.y = ny;
        else {
          // blocked (a vehicle pulled in): try again around it
          const last = u.path[u.path.length - 1];
          u.path = sim.route({ x: u.x, y: u.y }, last) ?? [];
        }
        u.moving = true;
      }
      if (d > 0.01 && u.animLock <= 0) u.dir = Math.atan2(dy, dx);
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
    // the leader picked on the strip goes alone: the column keeps the rest point it had
    const alone = s.picked === L.id;
    if (!alone && (L.moving || L.path.length || Math.hypot(sq.restX - L.x, sq.restY - L.y) > 0.6)) {
      sq.restX = L.x; sq.restY = L.y; sq.restDir = L.dir;
    }

    // Followers.
    const followers = sim.membersOf(sq).filter((u) => u !== L && u.state === "ok");
    const moving = !alone && (L.moving || L.path.length > 0);
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
