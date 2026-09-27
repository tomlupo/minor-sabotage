// What the player can tell the rules. The input layer turns taps into these; the rules never
// see a pointer. Smart tap (steering page, "C"): open ground walks, an enemy is fired upon,
// an unaware sentry close enough is knifed.
import type { Sim } from "./sim";
import type { Squad, Unit } from "./types";
import { goTo, restSlots } from "./move";
import { KNIFE, THROW } from "./tuning";

/** Walk the squad you lead to (x, y). */
export function cmdMove(sim: Sim, x: number, y: number): boolean {
  const sq = sim.controlledSquad;
  if (!sq) return false;
  const L = sim.leaderOf(sq);
  if (!L) return false;
  if (L.task && L.task.kind !== "help") L.task = null;
  // a new walk cancels the squad's lock-on only if it was on something now out of sight
  return goTo(sim, L, x, y);
}

/** The best knifer for a target: the closest unhurt trooper of the squad. */
function pickKnifer(sim: Sim, sq: Squad, x: number, y: number): Unit | undefined {
  let best: Unit | undefined, bd = Infinity;
  for (const u of sim.membersOf(sq)) {
    if (u.state !== "ok" || u.task) continue;
    const d = Math.hypot(u.x - x, u.y - y) - (u.role === "scout" ? 2 : 0);
    if (d < bd) { bd = d; best = u; }
  }
  return best;
}

export type TapResult = "knife" | "fire" | "move" | "none";

/**
 * Tap on an enemy: a sentry who has not noticed the squad and is within `knifeRange` of
 * a trooper gets the knife; anyone else is fired upon until he drops.
 */
export function cmdTapEnemy(sim: Sim, targetId: number, knifeRange = 14): TapResult {
  const sq = sim.controlledSquad;
  const v = sim.unit(targetId);
  if (!sq || !v || v.state === "dead" || v.side !== "de") return "none";
  const unaware = v.ai && v.ai.mode !== "alert" && !v.ai.blind;
  const k = pickKnifer(sim, sq, v.x, v.y);
  if (unaware && k && Math.hypot(k.x - v.x, k.y - v.y) <= knifeRange) {
    // one knifer goes in, the rest of the squad halts where it is
    for (const u of sim.membersOf(sq)) if (u !== k && !u.task) u.path = [];
    sq.target = -1;
    k.task = { kind: "knife", target: v.id, t: 0, phase: "approach" };
    return "knife";
  }
  sq.target = v.id;
  return "fire";
}

/** FIRE held at a point: the squad sprays it for `dur` seconds (re-sent while held). */
export function cmdFireAt(sim: Sim, x: number, y: number, dur = 0.35): void {
  const sq = sim.controlledSquad;
  if (!sq) return;
  sq.fireAtX = x;
  sq.fireAtY = y;
  sq.fireUntil = sim.state.time + dur;
  sq.target = -1;
}

export function cmdCeaseFire(sim: Sim): void {
  const sq = sim.controlledSquad;
  if (!sq) return;
  sq.target = -1;
  sq.fireUntil = 0;
}

/** Throw a grenade or a petrol bottle at (x, y): the nearest trooper who carries one. */
export function cmdThrow(sim: Sim, x: number, y: number, what: "grenade" | "bottle" | "any" = "any"): Unit | null {
  const sq = sim.controlledSquad;
  if (!sq) return null;
  let best: Unit | null = null, bd = Infinity, kind: "grenade" | "bottle" = "grenade";
  for (const u of sim.membersOf(sq)) {
    if (u.state !== "ok" || u.task) continue;
    const opts: ("grenade" | "bottle")[] = what === "any" ? ["bottle", "grenade"] : [what];
    for (const k of opts) {
      if ((k === "grenade" ? u.grenades : u.bottles) <= 0) continue;
      const d = Math.hypot(u.x - x, u.y - y) + (k === "bottle" && what === "any" ? -1 : 0);
      if (d < bd) { bd = d; best = u; kind = k; }
    }
  }
  if (!best) return null;
  // thrown at a vehicle: remember which, so the throw leads it wherever it has got to
  const veh = sim.state.vehicles.find((v) => Math.hypot(v.x - x, v.y - y) < Math.max(v.len, 4) && v.state !== "wreck");
  best.task = { kind: "throw", what: kind, x, y, t: 0, phase: Math.hypot(best.x - x, best.y - y) <= THROW.range ? "wind" : "approach", veh: veh?.id };
  if (best.task.phase === "wind") {
    best.path = [];
    best.dir = Math.atan2(y - best.y, x - best.x);
    best.animLock = THROW.wind + 0.3;
    best.anim = "throw";
    best.animT = 0;
  }
  return best;
}

/** Kneel and work at a spot (open the truck, cut the line, plant a charge...). */
export function cmdWork(sim: Sim, x: number, y: number, what: string, ref: string, dur: number, prefer?: (u: Unit) => number): Unit | null {
  const sq = sim.controlledSquad;
  if (!sq) return null;
  // tapped again: the same man keeps the job, the squad sets off again
  let best: Unit | null = sim.membersOf(sq).find((u) => u.state === "ok" && u.task?.kind === "work" && u.task.what === what) ?? null;
  if (!best) {
    let bd = Infinity;
    for (const u of sim.membersOf(sq)) {
      if (u.state !== "ok" || u.task) continue;
      const d = Math.hypot(u.x - x, u.y - y) - (prefer ? prefer(u) : 0);
      if (d < bd) { bd = d; best = u; }
    }
    if (!best) return null;
    best.task = { kind: "work", what, ref, x, y, t: 0, dur, phase: "approach" };
  }
  // the squad goes with him (it moves as one); he detaches for the last few metres
  const L = sim.leaderOf(sq);
  if (L && L !== best) {
    const d = Math.hypot(x - L.x, y - L.y);
    if (d > 4) goTo(sim, L, x - ((x - L.x) / d) * 3, y - ((y - L.y) / d) * 3);
  }
  return best;
}

/** Tap a friend lying wounded: the nearest trooper goes to get him up. */
export function cmdHelp(sim: Sim, downId: number): Unit | null {
  const v = sim.unit(downId);
  if (!v || v.state !== "down") return null;
  let best: Unit | null = null, bd = Infinity;
  for (const u of sim.state.units) {
    if (u.side !== "pl" || u.state !== "ok" || u.hidden || u.task) continue;
    if (u.squad !== sim.state.controlled && u.squad !== v.squad) continue;
    const d = Math.hypot(u.x - v.x, u.y - v.y);
    if (d < bd) { bd = d; best = u; }
  }
  if (!best) return null;
  best.task = { kind: "help", target: v.id, t: 0, phase: "approach" };
  return best;
}

/** Take over another squad (tap its tag). The squad you leave keeps a hold where it stands. */
export function cmdSelectSquad(sim: Sim, i: number): boolean {
  const s = sim.state;
  const next = s.squads[i];
  if (!next || !next.inPlay || !sim.leaderOf(next)) return false;
  if (i === s.controlled) return true;
  const prev = s.squads[s.controlled];
  if (prev && prev.order === "follow") {
    const L = sim.leaderOf(prev);
    prev.order = "hold";
    if (L) { prev.holdX = L.x; prev.holdY = L.y; L.path = []; }
    prev.target = -1;
    prev.fireUntil = 0;
  }
  s.controlled = i;
  next.order = "follow";
  next.signalRoute = null;
  return true;
}

/** Orders for a squad you are not leading (decision 2026-09-28: hold, cover a cone, go on
 *  a signal; plus "follow me"). During the tactical pause, one order per team. */
export function cmdOrder(
  sim: Sim,
  i: number,
  order: "hold" | "cover" | "signal" | "tail",
  p?: { dir?: number; half?: number; route?: { x: number; y: number }[] },
): boolean {
  const s = sim.state;
  const sq = s.squads[i];
  if (!sq || !sq.inPlay || i === s.controlled) return false;
  if (s.paused && sq.plannedThisPause) return false;
  const L = sim.leaderOf(sq);
  if (!L) return false;
  sq.order = order;
  sq.target = -1;
  if (order === "hold" || order === "cover") {
    sq.holdX = L.x;
    sq.holdY = L.y;
    L.path = [];
  }
  if (order === "cover") {
    sq.coverDir = p?.dir ?? L.dir;
    sq.coverHalf = p?.half ?? 0.55;
    sq.restDir = sq.coverDir;
  }
  if (order === "signal") {
    const to = p?.route?.[p.route.length - 1];
    sq.signalRoute = to ? sim.route({ x: L.x, y: L.y }, to) : null;
    if (s.signalGiven && sq.signalRoute) { L.path = sq.signalRoute; sq.signalRoute = null; sq.order = "hold"; }
  }
  if (s.paused) sq.plannedThisPause = true;
  return true;
}

/** The go-code: every squad with a "signal" order moves at once. */
export function cmdSignal(sim: Sim): void {
  if (!sim.state.signalReady) return;
  sim.state.signalGiven = true;
}

export function cmdPause(sim: Sim, on: boolean): void {
  sim.state.paused = on;
  if (!on) for (const sq of sim.state.squads) sq.plannedThisPause = false;
}

/** Where a squad would stand if told to hold at (x, y), for drawing the order marker. */
export function previewSlots(sim: Sim, x: number, y: number, dir: number, n: number) {
  return restSlots(sim, x, y, dir, n);
}

export const KNIFE_REACH = KNIFE.reach;
