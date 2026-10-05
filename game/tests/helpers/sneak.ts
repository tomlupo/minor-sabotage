// A person at the screen: the proof that a stealth task can be done unseen (decision of
// 2026-09-29, "make map possible to do it"). He sees what is drawn, the Germans and their cones,
// and nothing more, and plays with the game's own orders. Nothing is foreseen.
import type { Sim } from "../../src/sim/sim";
import { cmdMove, cmdPick } from "../../src/sim/commands";

/** How close to his way a walking German may be, in metres. */
const CLEAR = 4;
/** How long he waits for a clear way before he gives up, in seconds. */
const PATIENCE = 180;

function run(sim: Sim, ticks: number): void {
  for (let i = 0; i < ticks; i++) {
    sim.state.paused = false;
    sim.step();
    sim.drainEvents();
  }
}

/**
 * He sends his man to a corner of his choosing (`hide`) when the way there is clear, waits there
 * until no cone reaches the rest of the way and no walking German is close to it, then taps the
 * job's ring. True when the job is done with no alarm.
 */
export function tapWhenClear(sim: Sim, manId: number, job: () => { x: number; y: number; act: (s: Sim) => void } | undefined, done: () => boolean, hide: { x: number; y: number }): boolean {
  const G = sim.grid;
  /** The game's way from the man to (x, y), a point a metre. */
  const wayTo = (x: number, y: number): { x: number; y: number }[] => {
    const man = sim.unit(manId)!;
    const route = sim.route({ x: man.x, y: man.y }, { x, y }) ?? [];
    const pts: { x: number; y: number }[] = [];
    let px = man.x, py = man.y;
    for (const p of route) {
      const n = Math.max(1, Math.ceil(Math.hypot(p.x - px, p.y - py)));
      for (let k = 1; k <= n; k++) pts.push({ x: px + ((p.x - px) * k) / n, y: py + ((p.y - py) * k) / n });
      px = p.x; py = p.y;
    }
    return pts;
  };
  const clearWay = (pts: { x: number; y: number }[]): boolean => {
    for (const u of sim.state.units) {
      const ai = u.ai;
      if (!ai || u.side !== "de" || u.state !== "ok" || u.hidden || ai.blind) continue;
      for (const q of pts) {
        const d = Math.hypot(q.x - u.x, q.y - u.y);
        if (ai.mode === "patrol" && d < CLEAR) return false;
        // a sentry's cone swings round his post (ai.ts post()): a person sees the whole swing
        let off = Math.atan2(q.y - u.y, q.x - u.x) - (ai.mode === "post" ? ai.homeDir : u.dir);
        off = Math.abs(Math.atan2(Math.sin(off), Math.cos(off)));
        const reach = ai.mode === "post" ? ai.coneHalf + 0.6 : ai.coneHalf;
        if (d <= ai.coneR && off <= reach && G.los(u.x, u.y, q.x, q.y)) return false;
      }
    }
    return true;
  };
  const waitClear = (to: () => { x: number; y: number } | undefined): boolean => {
    for (let t = 0; t < PATIENCE; t += 0.5) {
      const p = to();
      // the job went while he waited (the truck drove off)
      if (!p) return false;
      if (clearWay(wayTo(p.x, p.y))) return true;
      if (!wait(sim, 0.5)) return false;
    }
    return false;
  };
  if (!job()) return false;
  if (sim.state.picked !== manId) cmdPick(sim, manId);
  if (!waitClear(() => hide)) return false;
  cmdMove(sim, hide.x, hide.y);
  for (let t = 0; t < 60; t += 0.5) {
    const man = sim.unit(manId)!;
    if (Math.hypot(man.x - hide.x, man.y - hide.y) < 0.8) break;
    if (!wait(sim, 0.5)) return false;
  }
  if (!waitClear(() => job())) return false;
  job()!.act(sim);
  for (let t = 0; t < 60 && !done(); t += 0.5) if (!wait(sim, 0.5)) return false;
  return done() && !sim.anyAlarm();
}

/** Stand still for `seconds` (the others hidden where they are); false if the alarm went up. */
export function wait(sim: Sim, seconds: number): boolean {
  run(sim, Math.round(seconds * 30));
  return !sim.anyAlarm();
}
