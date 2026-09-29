// A competent scripted player for headless playthroughs: shoot whoever has seen you, knife
// a sentry who has not and stands in the way, otherwise get on with the job. Uses only the
// commands the touch controls give a person.
import type { Sim } from "../../src/sim/sim";
import type { Unit } from "../../src/sim/types";
import { cmdTapEnemy, cmdHelp } from "../../src/sim/commands";

export interface PilotOpts {
  /** Where the current job is (to knife sentries standing near the way there). */
  goal?: () => { x: number; y: number } | null;
  knifeRange?: number;
}

function near(sim: Sim, from: Unit, pred: (u: Unit) => boolean, range: number, los = true): Unit | null {
  let best: Unit | null = null, bd = range;
  for (const u of sim.state.units) {
    if (u.state === "dead" || u.hidden || !pred(u)) continue;
    const d = Math.hypot(u.x - from.x, u.y - from.y);
    if (d < bd && (!los || sim.grid.los(from.x, from.y, u.x, u.y))) { bd = d; best = u; }
  }
  return best;
}

/** One decision; call every half second. Returns true if it took the squad's attention. */
export function pilot(sim: Sim, o: PilotOpts = {}): boolean {
  const sq = sim.controlledSquad;
  const L = sq && sim.leaderOf(sq);
  if (!sq || !L) return false;
  // a friend is down: get him up
  const down = sim.state.units.find((u) => u.side === "pl" && u.squad === sq.id && u.state === "down");
  if (down && !sim.state.units.some((u) => u.task?.kind === "help" && u.task.target === down.id)) cmdHelp(sim, down.id);
  // anyone who has seen us gets shot
  const alert = near(sim, L, (u) => u.side === "de" && u.ai?.mode === "alert", 17);
  if (alert) { cmdTapEnemy(sim, alert.id, 0); return true; }
  if (sim.state.units.some((u) => u.squad === sq.id && u.task?.kind === "knife")) return true;
  // a sentry who has not seen us, near us or near the way to the job: the knife
  const goal = o.goal?.();
  // (nobody sensible creeps up on a man who is looking at him)
  const facingUs = (u: Unit) => {
    const a = Math.atan2(L.y - u.y, L.x - u.x) - u.dir;
    return Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) < 1.2;
  };
  const unaware = near(sim, L, (u) => u.side === "de" && !!u.ai && (u.ai.mode === "post" || u.ai.mode === "patrol") && !u.ai.blind && !facingUs(u) && (
    !goal || Math.hypot(u.x - goal.x, u.y - goal.y) < 12 || Math.hypot(u.x - L.x, u.y - L.y) < 9), o.knifeRange ?? 16, false);
  if (unaware) { cmdTapEnemy(sim, unaware.id, o.knifeRange ?? 16); return true; }
  return false;
}

/** Run `seconds`, letting the pilot act; stops early when `until` holds or the phase ends. */
export function fly(sim: Sim, seconds: number, until?: () => boolean, o: PilotOpts = {}): boolean {
  for (let i = 0; i < seconds * 30; i++) {
    sim.state.paused = false;
    if (i % 15 === 0) pilot(sim, o);
    sim.step();
    sim.drainEvents();
    if (until?.()) return true;
    if (sim.state.outcome) return !!until?.();
  }
  return false;
}
