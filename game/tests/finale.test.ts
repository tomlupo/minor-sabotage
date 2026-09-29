// A scripted player plays the finale headless: signal, bottles on the cab at the bend,
// open the tailgate, the DKW backs up for Rudy and gets away. It checks the operation can be
// won end to end, and that a van left alone gets away.
import { describe, expect, it } from "vitest";
import { buildArsenalMap } from "../src/content/arsenal/map";
import { gridFromMap, inZone, zone } from "../src/content/mapdata";
import { Sim } from "../src/sim/sim";
import { newCampaign } from "../src/missions/campaign";
import { finale, PRISONERS } from "../src/missions/finale";
import { cmdSignal, cmdThrow, cmdMove, cmdSelectSquad, cmdTapEnemy } from "../src/sim/commands";
import type { Phase } from "../src/missions/types";

function setup(tasks: string) {
  const md = buildArsenalMap();
  const c = newCampaign();
  const has = (k: string) => tasks.split(",").includes(k);
  c.results.signal = { outcome: "success", silent: !has("sigloud"), flags: { signal: has("signal") }, seconds: has("sigskip") ? 0 : 120 };
  c.results.ghetto = { outcome: "success", silent: true, flags: { lineCut: has("line"), postSilenced: has("post") }, seconds: 0 };
  c.results.oldtown = { outcome: "success", silent: !has("oldloud"), flags: { truckDisabled: has("truck") }, seconds: 120 };
  const sim = new Sim(gridFromMap(md), 99);
  sim.streetNames = md.streets.map((s) => s.name);
  const phase: Phase = finale(md, c);
  sim.mission = phase;
  phase.setup(sim);
  return { sim, phase, c, md };
}

/** A competent player: every half second, the squad you lead locks on the nearest German it can see. */
function reflexes(sim: Sim) {
  const sq = sim.controlledSquad;
  const L = sq && sim.leaderOf(sq);
  if (!sq || !L) return;
  let best = -1, bd = 16;
  for (const u of sim.state.units) {
    if (u.side !== "de" || u.state === "dead" || u.hidden) continue;
    const d = Math.hypot(u.x - L.x, u.y - L.y);
    if (d < bd && sim.grid.los(L.x, L.y, u.x, u.y)) { bd = d; best = u.id; }
  }
  if (best >= 0) cmdTapEnemy(sim, best, 0);
}

function step(sim: Sim, seconds: number, until?: () => boolean): boolean {
  for (let i = 0; i < seconds * 30; i++) {
    sim.state.paused = false; // the scripted player never stops to think
    if (i % 15 === 0) reflexes(sim);
    sim.step();
    sim.drainEvents();
    if (until?.()) return true;
    if (sim.state.outcome) return !!until?.();
  }
  return false;
}

describe("finale", () => {
  it("can be won: bottles at the bend, the tailgate, the DKW backing up for Rudy", () => {
    const { sim, phase, c } = setup("signal,line,post,truck");
    expect(sim.state.signalReady).toBe(true);
    cmdSignal(sim);
    const van = () => sim.state.vehicles.find((v) => v.tag === "van");
    // wait for the van to turn into Długa near the corner
    expect(step(sim, 60, () => { const v = van(); return !!v && v.y < 82 && v.x < 118; })).toBe(true);
    // Zośka's squad throws its bottles at the cab
    for (let k = 0; k < 3; k++) {
      const v = van()!;
      cmdThrow(sim, v.x + Math.cos(v.heading) * 2.5, v.y + Math.sin(v.heading) * 2.5, "bottle");
      step(sim, 0.4);
    }
    expect(step(sim, 20, () => sim.state.vars.stopped === true)).toBe(true);
    // it rolls on a little before it stops
    expect(step(sim, 20, () => van()!.speed < 0.1)).toBe(true);
    // fight the escort: lock on anyone visible
    for (let k = 0; k < 40 && sim.state.units.some((u) => u.side === "de" && u.state !== "dead" && !u.hidden && Math.hypot(u.x - van()!.x, u.y - van()!.y) < 14); k++) {
      const e = sim.state.units.find((u) => u.side === "de" && u.state !== "dead" && !u.hidden && Math.hypot(u.x - van()!.x, u.y - van()!.y) < 14);
      if (e) cmdTapEnemy(sim, e.id, 0);
      const L = sim.leaderOf(sim.controlledSquad!);
      if (L && e && Math.hypot(L.x - e.x, L.y - e.y) > 12) cmdMove(sim, (L.x + e.x) / 2, (L.y + e.y) / 2);
      step(sim, 1);
    }
    // open the tailgate
    const tail = phase.interactables(sim).find((i) => i.id === "tailgate");
    expect(tail, "the tailgate is offered once the van has stopped").toBeTruthy();
    tail!.act(sim);
    expect(step(sim, 40, () => sim.state.vars.doorsOpened === true)).toBe(true);
    // prisoners come out; Rudy last; the DKW comes (Jeremi calls himself if we do not)
    expect(step(sim, 30, () => sim.state.units.some((u) => u.tag === "rudy"))).toBe(true);
    // 20 others and Rudy: the 21 freed on the day
    expect(sim.state.units.filter((u) => u.side === "pris").length).toBe(PRISONERS + 1);
    expect(PRISONERS + 1).toBe(21);
    // the DKW backs up to the van, tail first, and never turns round (research §3)
    const car = () => sim.state.vehicles.find((v) => v.tag === "dkw");
    const x0 = car()!.x;
    let facedWest = false;
    expect(step(sim, 60, () => { const v = car(); if (v && Math.cos(v.heading) < 0.3) facedWest = true; return sim.state.vars.loaded === true; })).toBe(true);
    expect(facedWest).toBe(false);
    expect(car()!.x).toBeLessThan(x0 - 5);
    // the squads you are not leading stay where their orders put them
    const others = sim.state.squads.filter((q) => q && q.id !== sim.state.controlled && q.inPlay).map((q) => sim.leaderOf(q)!).filter(Boolean);
    expect(step(sim, 60, () => sim.state.vars.carEscaped === true)).toBe(true);
    const at = others.map((u) => [u.x, u.y]);
    // the getaway is the success: a few seconds for the whistle, then it is over
    expect(step(sim, 12, () => !!sim.state.outcome)).toBe(true);
    expect(sim.state.outcome).toBe("success");
    others.forEach((u, k) => expect(Math.hypot(u.x - at[k][0], u.y - at[k][1])).toBeLessThan(3));
    const res = phase.finish(sim, c) as { rudy: string; freed: number };
    expect(res.rudy).toBe("escaped");
    expect(res.freed).toBeGreaterThan(PRISONERS / 2);
  });

  it("left alone, the van turns into Nalewki and gets away", () => {
    const { sim } = setup("");
    step(sim, 120);
    expect(sim.state.outcome).toBe("fail");
    expect(sim.state.vars.failReason).toMatch(/van got away/);
  });

  it("the Arbeitsamt's sentries always stand at its gate, and open fire sooner when Stare Miasto was blown", () => {
    // the stealth decision of 2026-09-29: the gunfight at the Arbeitsamt is the finale's (research §1)
    for (const [tasks, at] of [["signal,line,post,truck", 22], ["signal,line,post,truck,oldloud", 8]] as const) {
      const { sim } = setup(tasks);
      expect(sim.state.units.filter((u) => u.tag === "gate" && u.state === "ok")).toHaveLength(2);
      // the first shot of the action
      sim.state.vars.actionT = sim.state.time;
      step(sim, at - 1.5);
      expect(sim.state.vars.r_east, `${tasks}: not yet ${at - 1.5} s after the first shot`).not.toBe(true);
      step(sim, 3);
      expect(sim.state.vars.r_east, `${tasks}: by ${at + 1.5} s`).toBe(true);
    }
  });

  it("the Schupo from Plac Teatralny come at 40 s rather than 100, past two sentries, when Sygnalizacja was blown", () => {
    // the stealth decision of 2026-09-29; a task not played is not blown
    for (const [tasks, blown] of [["signal,line,post,truck", false], ["signal,line,post,truck,sigloud", true], ["signal,line,post,truck,sigloud,sigskip", false]] as const) {
      const { sim } = setup(tasks);
      expect(sim.state.units.filter((u) => u.tag === "south" && u.state === "ok"), tasks).toHaveLength(blown ? 2 : 0);
      // the first shot of the action
      sim.state.vars.actionT = sim.state.time;
      step(sim, 38.5);
      expect(sim.state.vars.r_south, `${tasks}: not yet 38.5 s after the first shot`).not.toBe(true);
      step(sim, 3);
      expect(sim.state.vars.r_south === true, `${tasks}: by 41.5 s`).toBe(blown);
    }
  });

  it("the bend where the van is to be stopped is ringed", () => {
    // Tom, on the preview: "dont reealy know where is it" (the finale's first objective had no mark)
    const { sim, md } = setup("signal,line,post,truck");
    const o = sim.state.objectives.find((q) => q.id === "stop")!;
    expect(o.x !== undefined && o.y !== undefined && inZone(zone(md, "bend"), o.x, o.y), "a place at the bend").toBe(true);
  });

  it("without the signal the van comes on its own", () => {
    const { sim } = setup("line,truck");
    expect(sim.state.signalReady).toBe(false);
    step(sim, 25);
    expect(sim.state.vehicles.some((v) => v.tag === "van")).toBe(true);
  });
});
