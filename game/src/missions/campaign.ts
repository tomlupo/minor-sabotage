// The operation as the player lives it: who is alive, wounded or taken, which squad took
// which task, what each task left behind for the finale. Saved between phases (never during
// one); ironman, one save.
import { SQUADS } from "../content/arsenal/roster";

export type TaskId = "signal" | "ghetto" | "oldtown";
export const TASKS: TaskId[] = ["signal", "ghetto", "oldtown"];

export type SoldierState = "ok" | "wounded" | "dead" | "captured" | "evacuated";

export interface SoldierStatus {
  key: string;
  state: SoldierState;
  kills: number;
}

export interface TaskResult {
  outcome: "success" | "partial" | "fail";
  /** The alarm never went up. */
  silent: boolean;
  /** Task-specific facts the finale reads (e.g. lineCut, postSilenced, truckDisabled). */
  flags: Record<string, boolean>;
  seconds: number;
}

export interface FinaleResult {
  outcome: "success" | "partial" | "fail";
  rudy: "escaped" | "lost" | "killed";
  freed: number;
  prisonersKilled: number;
  fallen: string[];
  germansKilled: number;
  seconds: number;
}

export type Decision = "evacuate" | "fight" | "leave" | "rescue";

export interface Campaign {
  version: 1;
  seed: number;
  stage: "briefing" | "tasks" | "decision" | "finale" | "note";
  /** Squad index per task. */
  assign: Record<TaskId, number>;
  soldiers: Record<string, SoldierStatus>;
  results: Partial<Record<TaskId, TaskResult>>;
  decisions: Record<string, Decision>;
  /** Squads that sit the finale out (evacuating a wounded man or on a rescue). */
  benched: number[];
  finale?: FinaleResult;
  started: number;
  /** The phase being played, saved when it starts and cleared when it ends: a save that still
   *  names one was left mid-phase. */
  inPhase?: TaskId | "finale";
}

export function newCampaign(seed = 260343): Campaign {
  const soldiers: Record<string, SoldierStatus> = {};
  for (const s of SQUADS) for (const p of s.people) soldiers[p.key] = { key: p.key, state: "ok", kills: 0 };
  return { version: 1, seed, stage: "briefing", assign: { signal: 2, ghetto: 1, oldtown: 0 }, soldiers, results: {}, decisions: {}, benched: [], started: 0 };
}

/**
 * Ironman (vault decision: no loading during a phase). A phase left without its one-time
 * bookmark, by a closed tab or a reload, is not played again: it counts as failed, with nothing
 * gained. Returns the phase it settled, or null when none was open.
 */
export function settleAbandoned(c: Campaign): TaskId | "finale" | null {
  const id = c.inPhase;
  if (!id) return null;
  c.inPhase = undefined;
  if (id === "finale") {
    if (!c.finale) c.finale = { outcome: "fail", rudy: "lost", freed: 0, prisonersKilled: 0, fallen: [], germansKilled: 0, seconds: 0 };
  } else if (!c.results[id]) {
    c.results[id] = { outcome: "fail", silent: false, flags: {}, seconds: 0 };
  }
  return id;
}

export function tasksLeft(c: Campaign): TaskId[] {
  return TASKS.filter((t) => !c.results[t]);
}

/** People who can take the street for a squad (not dead, captured or evacuated). */
export function fit(c: Campaign, squad: number): string[] {
  return SQUADS[squad].people.map((p) => p.key).filter((k) => {
    const st = c.soldiers[k]?.state;
    return st === "ok" || st === "wounded";
  });
}
