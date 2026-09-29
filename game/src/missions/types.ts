// A phase of the operation (one task or the finale), as the rules and the screen see it.
import type { Mission, Sim } from "../sim/sim";
import type { MapData } from "../content/mapdata";
import type { Campaign, FinaleResult, TaskResult } from "./campaign";

/** A spot the player can tap to get a job done (a telephone, a post, the tailgate). */
export interface Interactable {
  id: string;
  x: number;
  y: number;
  r: number;
  label: string;
  /** Offer it now? (false hides it) */
  ready(sim: Sim): boolean;
  act(sim: Sim): void;
}

export interface Phase extends Mission {
  kind: "task" | "finale";
  title: string;
  place: string;
  time: string;
  zone: string;
  light: "afternoon" | "dusk";
  music: "stealth" | "finale";
  interactables(sim: Sim): Interactable[];
  /** The go-code button (finale, when Sygnalizacja did its job). */
  goCode: boolean;
  /** Where the camera starts. */
  start(sim: Sim): { x: number; y: number };
  /** A line for the top of the screen, if any (a countdown, a warning). */
  banner?(sim: Sim): string | null;
  /** Something the camera should keep in frame with the squad (the van as it comes). */
  focus?(sim: Sim): { x: number; y: number } | null;
  /** Called once when the phase ends, to write its result into the campaign. */
  finish(sim: Sim, c: Campaign): TaskResult | FinaleResult;
}

export type PhaseFactory = (md: MapData, c: Campaign) => Phase;
