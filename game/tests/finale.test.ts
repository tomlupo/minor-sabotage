// A scripted player plays the finale headless: signal, bottles on the cab at the bend,
// open the tailgate, call the DKW, withdraw. It checks the operation can be won end to
// end, and that a van left alone gets away.
import { describe, expect, it } from "vitest";
import { buildArsenalMap } from "../src/content/arsenal/map";
import { gridFromMap } from "../src/content/mapdata";
import { Sim } from "../src/sim/sim";
import { newCampaign } from "../src/missions/campaign";
import { finale, PRISONERS } from "../src/missions/finale";
import { cmdSignal, cmdThrow, cmdMove, cmdSelectSquad, cmdTapEnemy } from "../src/sim/commands";
import type { Phase } from "../src/missions/types";

function setup(tasks: string) {
  const md = buildArsenalMap();
  const c = newCampaign();
  const has = (k: string) => tasks.split(",").includes(k);
  c.results.signal = { outcome: "success", silent: true, flags: { signal: has("signal"), bielanskaAlert: false }, seconds: 0 };
  c.results.ghetto = { outcome: "success", silent: true, flags: { lineCut: has("line"), postSilenced: has("post") }, seconds: 0 };
  c.results.oldtown = { outcome: "success", silent: true, flags: { gateSilenced: has("gate"), truckDisabled: has("truck") }, seconds: 0 };
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
  it("can be won: bottles at the bend, the tailgate, the DKW, the withdrawal", () => {
    const { sim, phase, c } = setup("signal,line,post,gate,truck");
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
    expect(sim.state.units.filter((u) => u.side === "pris").length).toBe(PRISONERS + 1);
    expect(step(sim, 60, () => sim.state.vars.loaded === true)).toBe(true);
    expect(step(sim, 60, () => sim.state.vars.carEscaped === true)).toBe(true);
    // on the whistle the other squads withdraw on their own; lead yours out east
    for (let k = 0; k < 60 && !sim.state.outcome; k++) {
      cmdMove(sim, 238, 79);
      step(sim, 2);
    }
    expect(sim.state.outcome).toBe("success");
    const res = phase.finish(sim, c) as { rudy: string; freed: number };
    expect(res.rudy).toBe("escaped");
  });

  it("left alone, the van turns into Nalewki and gets away", () => {
    const { sim } = setup("");
    step(sim, 120);
    expect(sim.state.outcome).toBe("fail");
    expect(sim.state.vars.failReason).toMatch(/van got away/);
  });

  it("without the signal the van comes on its own", () => {
    const { sim } = setup("line,gate,truck");
    expect(sim.state.signalReady).toBe(false);
    step(sim, 25);
    expect(sim.state.vehicles.some((v) => v.tag === "van")).toBe(true);
  });
});
