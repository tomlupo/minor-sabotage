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
import { ghettoTask } from "../missions/ghetto";
import { oldtownTask } from "../missions/oldtown";
import { finale } from "../missions/finale";
import { store, type Bookmark } from "./store";

const PHASES: Record<string, (md: MapData, c: Campaign) => Phase> = {
  signal: signalTask,
  ghetto: ghettoTask,
  oldtown: oldtownTask,
  finale,
};

/** Debug: pretend the tasks went a certain way (?tasks=signal,line,post,gate,truck). */
export function fakeResults(c: Campaign, spec: string) {
  const has = (k: string) => spec.split(",").includes(k);
  c.results.signal = { outcome: has("signal") ? "success" : "fail", silent: true, flags: { signal: has("signal"), bielanskaAlert: has("loud") }, seconds: 0 };
  c.results.ghetto = { outcome: has("line") ? "success" : "fail", silent: true, flags: { lineCut: has("line"), postSilenced: has("post") }, seconds: 0 };
  c.results.oldtown = { outcome: has("gate") && has("truck") ? "success" : "partial", silent: true, flags: { gateSilenced: has("gate"), truckDisabled: has("truck") }, seconds: 0 };
}

let MD: MapData | null = null;
export function mapData(): MapData {
  if (!MD) MD = mapFromTiled(JSON.parse(tmjText) as TiledMap);
  return MD;
}

/** A Sim on the map with its props and street names (no people yet). */
export function simForMap(md: MapData, seed: number): Sim {
  const sim = new Sim(gridFromMap(md), seed);
  sim.streetNames = md.streets.map((s) => s.name);
  for (const p of md.props) {
    sim.addProp(p.kind, p.x, p.y, {
      variant: p.variant ?? "", tag: p.tag ?? "",
      blocks: !!p.block, bx: p.block ? p.x + p.block.dx : 0, by: p.block ? p.y + p.block.dy : 0, bw: p.block?.w ?? 0, bh: p.block?.h ?? 0,
      hp: p.kind === "barrel" ? 1 : 3,
    });
  }
  return sim;
}

const SCENES = ["game", "hud", "intro", "briefing", "decision", "note", "title"];

export class Flow {
  campaign: Campaign;
  constructor(public game: Phaser.Game) {
    this.campaign = newCampaign();
  }

  private makeRun(id: string, restore?: string) {
    const md = mapData();
    const sim = simForMap(md, this.campaign.seed + Object.keys(this.campaign.results).length * 7919);
    const make = PHASES[id];
    if (!make) throw new Error(`no phase ${id}`);
    const phase = make(md, this.campaign);
    sim.mission = phase;
    if (restore) sim.restore(restore);
    else phase.setup(sim);
    return { sim, md, phase };
  }

  private start(key: string, data: object) {
    this.stopAll();
    this.game.scene.start(key, data);
  }

  /** Start a phase in the game scene (or resume one from a bookmark's snapshot). */
  play(id: string, restore?: string) {
    const run = this.makeRun(id, restore);
    const onEnd = (sim: Sim) => {
      const res = run.phase.finish(sim, this.campaign);
      if (run.phase.kind === "task") this.campaign.results[id as TaskId] = res as TaskResult;
      else this.campaign.finale = res as FinaleResult;
      void store.takeBookmark();
      void store.saveCampaign(this.campaign);
      if (id === "finale") this.start("note", { flow: this });
      else this.start("briefing", { flow: this });
    };
    this.start("game", { run: { ...run, onEnd }, flow: this });
  }

  /** After the three tasks: settle the wounded and the taken, then the Arsenal. */
  toFinale() {
    const cases = Object.values(this.campaign.soldiers).some((s) => s.state === "wounded" || s.state === "captured");
    void store.saveCampaign(this.campaign);
    if (cases) this.start("decision", { flow: this });
    else this.play("finale");
  }

  newOperation() {
    this.campaign = newCampaign(260343 + Math.floor(Math.random() * 1000));
    this.campaign.started = Date.now();
    void store.saveCampaign(this.campaign);
    this.start("intro", { flow: this });
  }

  toBriefing() {
    this.start("briefing", { flow: this });
  }

  async continueSaved() {
    const c = await store.loadCampaign();
    if (!c) return this.newOperation();
    this.campaign = c;
    if (tasksLeft(c).length) this.start("briefing", { flow: this });
    else if (!c.finale) this.toFinale();
    else this.start("note", { flow: this });
  }

  resume(b: Bookmark) {
    this.campaign = b.campaign;
    this.play(b.phase, b.sim);
  }

  toTitle() {
    this.start("title", { flow: this });
  }

  stopAll() {
    for (const k of SCENES) {
      if (this.game.scene.isActive(k) || this.game.scene.isPaused(k) || this.game.scene.isSleeping(k)) this.game.scene.stop(k);
    }
  }
}
