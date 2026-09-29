// The operation as the player lives it: who is alive, wounded or taken, which squad took
// which task, what each task left behind for the finale. Saved between phases, and during one
// only what a reload must not undo: a man falling, going down, being got up. Ironman, one save.
import { PEOPLE, SQUADS } from "../content/arsenal/roster";
import { WOUND } from "../sim/tuning";

export type TaskId = "signal" | "ghetto" | "oldtown";
export const TASKS: TaskId[] = ["signal", "ghetto", "oldtown"];

/** Stealth or fire, by what the section did on 26 March 1943 (decision of 2026-09-29): the signal
 *  section only watched and gestured, the Getto section held Długa west by force, and the Old Town
 *  section let a Schupo patrol and a truck go by before the action. The finale is fire. */
export type PlayMode = "stealth" | "fire";
export const TASK_MODE: Record<TaskId, PlayMode> = { signal: "stealth", ghetto: "fire", oldtown: "stealth" };

/** "down" only while a phase runs: he lies wounded and has not been got up yet. */
export type SoldierState = "ok" | "wounded" | "down" | "dead" | "captured" | "evacuated";

export interface SoldierStatus {
  key: string;
  state: SoldierState;
  kills: number;
}

export interface TaskResult {
  outcome: "success" | "partial" | "fail";
  /** Not blown: no alarm went up, and in a stealth task no German whistled and the squad was never loud. */
  silent: boolean;
  /** Task-specific facts the finale reads (e.g. lineCut, postSilenced, truckDisabled). */
  flags: Record<string, boolean>;
  seconds: number;
}

/** A stealth task blown: played, and seen or loud (the stealth decision of 2026-09-29). A task not played is not blown. */
export function blownTask(r: TaskResult | undefined): boolean {
  return !!r && r.seconds > 0 && !r.silent;
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
  // a man still lying where he fell was left, as at any phase's end: a veteran is taken
  for (const s of Object.values(c.soldiers)) {
    if (s.state === "down") s.state = (PEOPLE[s.key]?.rank ?? 0) >= WOUND.vetRank ? "captured" : "dead";
  }
  if (id === "finale") {
    if (!c.finale) c.finale = { outcome: "fail", rudy: "lost", freed: 0, prisonersKilled: 0, fallen: [], germansKilled: 0, seconds: 0 };
  } else if (!c.results[id]) {
    c.results[id] = { outcome: "fail", silent: false, flags: {}, seconds: 0 };
  }
  return id;
}

/**
 * A man of ours falls ("dead"), goes down ("down") or is got up ("wounded") during a phase.
 * The save hears of it at once (ironman): a reload can neither bring him back nor save him
 * from being left where he lay. Nothing overwrites a death or a capture, and only a man who
 * was down is got up. Returns whether the record changed.
 */
export function recordLoss(c: Campaign, key: string, state: "dead" | "down" | "wounded"): boolean {
  const s = c.soldiers[key];
  if (!s || s.state === "dead" || s.state === "captured" || s.state === state) return false;
  if (state === "wounded" && s.state !== "down") return false;
  s.state = state;
  return true;
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
