// A player who keeps out of sight: the proof that a stealth task can be done unseen (decision
// of 2026-09-29, "make map possible to do it"). It looks ahead at what the Germans will watch
// while nobody is seen (a snapshot run forward and restored: unseen, they keep their routine),
// finds a way through space and time that never enters a watched cell, and walks one man along
// it with the game's own orders. It plans again before every leg, from the game as it stands.
import type { Sim } from "../../src/sim/sim";
import type { Unit } from "../../src/sim/types";
import { cmdMove, cmdPick } from "../../src/sim/commands";
import { F_VEH } from "../../src/sim/grid";
import { DETECT } from "../../src/sim/tuning";

/** Seconds a step of the plan takes: a partisan walks a cell (1 m, 1.4 m across) in well under. */
const DT = 0.5;
const TICKS = Math.round(DT * 30);
/** Margins round a cone: its reach, its angle, and a step either side in time. */
const REACH_MORE = 1.5;
const ANGLE_MORE = 0.15;

function run(sim: Sim, ticks: number): void {
  for (let i = 0; i < ticks; i++) {
    sim.state.paused = false;
    sim.step();
    sim.drainEvents();
  }
}

/** The cells a German could see a man in now, generously. */
function watchedNow(sim: Sim, into: Uint8Array): void {
  const G = sim.grid;
  for (const u of sim.state.units) {
    const ai = u.ai;
    if (!ai || u.side !== "de" || u.state !== "ok" || u.hidden || ai.blind) continue;
    const r = (ai.mode === "alert" ? 20 : ai.coneR) + REACH_MORE;
    for (let cy = Math.max(0, Math.floor(u.y - r)); cy <= Math.min(G.h - 1, Math.ceil(u.y + r)); cy++) {
      for (let cx = Math.max(0, Math.floor(u.x - r)); cx <= Math.min(G.w - 1, Math.ceil(u.x + r)); cx++) {
        const px = cx + 0.5, py = cy + 0.5;
        const d = Math.hypot(px - u.x, py - u.y);
        if (d > r) continue;
        let off = Math.atan2(py - u.y, px - u.x) - u.dir;
        off = Math.abs(Math.atan2(Math.sin(off), Math.cos(off)));
        const touch = d < DETECT.touch + 1.5;
        if (!touch && ai.mode !== "alert" && off > ai.coneHalf + ANGLE_MORE) continue;
        if (!touch && !G.los(u.x, u.y, px, py)) continue;
        into[cy * G.w + cx] = 1;
      }
    }
  }
}

interface Forecast { watched: Uint8Array[]; blocked: Uint8Array[] }

/** What will be watched, and where vehicles will stand, over the next `seconds`, one grid a step. */
function foresee(sim: Sim, seconds: number): Forecast {
  const G = sim.grid;
  const snap = sim.snapshot();
  const watched: Uint8Array[] = [], blocked: Uint8Array[] = [];
  for (let i = 0; i <= Math.ceil(seconds / DT); i++) {
    const w = new Uint8Array(G.w * G.h);
    watchedNow(sim, w);
    watched.push(w);
    const b = new Uint8Array(G.w * G.h);
    for (let k = 0; k < b.length; k++) if (G.flags[k] & F_VEH) b[k] = 1;
    blocked.push(b);
    run(sim, TICKS);
  }
  sim.restore(snap);
  return { watched, blocked };
}

export interface Leg { cells: number[]; arriveStep: number }

/**
 * A way from `from` to a cell `goal` accepts, entering no cell watched a step before, during or
 * after it is there, and then standing `stay` seconds unseen at the goal. Null when none exists
 * within `seconds`.
 */
export function planLeg(sim: Sim, from: { x: number; y: number }, goal: (cx: number, cy: number) => boolean, stay: number, seconds = 120): Leg | null {
  const G = sim.grid;
  const f = foresee(sim, seconds + stay + DT * 2);
  const steps = Math.ceil(seconds / DT), hold = Math.ceil(stay / DT);
  const free = (cell: number, i: number) => {
    for (let j = Math.max(0, i - 1); j <= Math.min(f.watched.length - 1, i + 1); j++) if (f.watched[j][cell] || f.blocked[j][cell]) return false;
    return true;
  };
  // the search keeps to the task's ground: a cell's parent a step before, per step (-2: not reached)
  const B = sim.state.bounds ?? { x: 0, y: 0, w: G.w, h: G.h };
  const bx = Math.max(0, Math.floor(B.x)), by = Math.max(0, Math.floor(B.y));
  const bw = Math.min(G.w, Math.ceil(B.x + B.w)) - bx, bh = Math.min(G.h, Math.ceil(B.y + B.h)) - by;
  const local = (cx: number, cy: number) => (cx < bx || cy < by || cx >= bx + bw || cy >= by + bh ? -1 : (cy - by) * bw + cx - bx);
  const sx = Math.floor(from.x), sy = Math.floor(from.y);
  if (local(sx, sy) < 0 || !free(sy * G.w + sx, 0)) return null;
  const came: Int32Array[] = [new Int32Array(bw * bh).fill(-2)];
  came[0][local(sx, sy)] = -1;
  let layer = [sy * G.w + sx];
  for (let i = 0; i < steps; i++) {
    // the goal: reached here, and unseen for the whole stay
    for (const cell of layer) {
      const cx = cell % G.w, cy = (cell - cx) / G.w;
      if (!goal(cx, cy)) continue;
      let ok = true;
      for (let k = 0; k <= hold && ok; k++) ok = free(cell, i + k);
      if (!ok) continue;
      const cells: number[] = [];
      let c = cell;
      for (let j = i; j >= 0; j--) {
        cells.push(c);
        const l = came[j][local(c % G.w, (c - (c % G.w)) / G.w)];
        c = l < 0 ? -1 : (by + Math.floor(l / bw)) * G.w + bx + (l % bw);
      }
      return { cells: cells.reverse(), arriveStep: i };
    }
    const next = new Int32Array(bw * bh).fill(-2);
    const nextLayer: number[] = [];
    for (const cell of layer) {
      const cx = cell % G.w, cy = (cell - cx) / G.w;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if ((dx || dy) && !G.canStep(cx, cy, dx, dy)) continue;
          const l = local(cx + dx, cy + dy);
          const n = (cy + dy) * G.w + cx + dx;
          if (l < 0 || next[l] !== -2 || !free(n, i + 1)) continue;
          next[l] = local(cx, cy);
          nextLayer.push(n);
        }
      }
    }
    if (!nextLayer.length) return null;
    came.push(next);
    layer = nextLayer;
  }
  return null;
}

/** Walk `man` alone along a leg, a cell a step, with the game's orders. False if the alarm went up. */
export function walkLeg(sim: Sim, man: Unit, leg: Leg): boolean {
  const G = sim.grid;
  if (sim.state.picked !== man.id) cmdPick(sim, man.id);
  let last = -1;
  for (const cell of leg.cells) {
    if (cell !== last) {
      const cx = cell % G.w, cy = (cell - cx) / G.w;
      cmdMove(sim, cx + 0.5, cy + 0.5);
      last = cell;
    }
    run(sim, TICKS);
    if (sim.anyAlarm()) return false;
  }
  return !sim.anyAlarm();
}

/** Stand still for `seconds` (the others hidden where they are); false if the alarm went up. */
export function wait(sim: Sim, seconds: number): boolean {
  run(sim, Math.round(seconds * 30));
  return !sim.anyAlarm();
}
