// The operation from title to history note. Holds the campaign, builds each phase's rules
// from the Tiled map, and moves between screens. Saves between phases (IndexedDB
// "minor-sabotage", ADR-0001), never during one; a locked phone gets one resume.
import Phaser from "phaser";
import tmjText from "../../maps/arsenal.tmj?raw";
import { mapFromTiled, type TiledMap } from "../content/tiled";
import { gridFromMap, type MapData } from "../content/mapdata";
import { Sim } from "../sim/sim";
import { newCampaign, tasksLeft, type Campaign, type TaskId, type TaskResult, type FinaleResult } from "../missions/campaign";
import type { Phase } from "../missions/types";
import { signalTask } from "../missions/signal";
import { store } from "./store";

const PHASES: Record<string, (md: MapData, c: Campaign) => Phase> = {
  signal: signalTask,
};

export function registerPhase(id: string, f: (md: MapData, c: Campaign) => Phase) {
  PHASES[id] = f;
}

let MD: MapData | null = null;
export function mapData(): MapData {
  if (!MD) MD = mapFromTiled(JSON.parse(tmjText) as TiledMap);
  return MD;
}

export class Flow {
  campaign: Campaign;
  constructor(public game: Phaser.Game) {
    this.campaign = newCampaign();
  }

  /** Build a phase's rules. */
  makeRun(id: string) {
    const md = mapData();
    const G = gridFromMap(md);
    const sim = new Sim(G, this.campaign.seed + Object.keys(this.campaign.results).length * 7919);
    sim.streetNames = md.streets.map((s) => s.name);
    const make = PHASES[id];
    if (!make) throw new Error(`no phase ${id}`);
    const phase = make(md, this.campaign);
    sim.mission = phase;
    phase.setup(sim);
    return { sim, md, phase };
  }

  /** Start a phase in the game scene. */
  play(id: string) {
    const run = this.makeRun(id);
    const onEnd = (sim: Sim) => {
      const res = run.phase.finish(sim, this.campaign);
      if (run.phase.kind === "task") this.campaign.results[id as TaskId] = res as TaskResult;
      else this.campaign.finale = res as FinaleResult;
      void store.saveCampaign(this.campaign);
      this.afterPhase(id);
    };
    this.stopAll();
    this.game.scene.start("game", { run: { ...run, onEnd } });
  }

  afterPhase(id: string) {
    this.stopAll();
    if (id !== "finale" && tasksLeft(this.campaign).length) this.game.scene.start("briefing", { flow: this });
    else if (id !== "finale") this.game.scene.start("decision", { flow: this });
    else this.game.scene.start("note", { flow: this });
  }

  stopAll() {
    for (const k of ["game", "hud", "briefing", "decision", "note", "title"]) {
      if (this.game.scene.isActive(k) || this.game.scene.isPaused(k)) this.game.scene.stop(k);
    }
  }
}
