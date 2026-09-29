// Scripted players for the three tasks: each can be won by playing it the way a person
// would with the touch controls, and each writes the flags the finale reads.
import { describe, expect, it } from "vitest";
import { buildArsenalMap } from "../src/content/arsenal/map";
import { gridFromMap } from "../src/content/mapdata";
import { Sim } from "../src/sim/sim";
import { newCampaign, type TaskResult } from "../src/missions/campaign";
import { signalTask } from "../src/missions/signal";
import { ghettoTask } from "../src/missions/ghetto";
import { oldtownTask } from "../src/missions/oldtown";
import { cmdMove } from "../src/sim/commands";
import type { Phase } from "../src/missions/types";
import { fly } from "./helpers/autopilot";
import { setObjective, TASK_LIMIT } from "../src/missions/helpers";

function setup(make: (md: ReturnType<typeof buildArsenalMap>, c: ReturnType<typeof newCampaign>) => Phase, seed = 1234) {
  const md = buildArsenalMap();
  const c = newCampaign();
  const sim = new Sim(gridFromMap(md), seed);
  sim.streetNames = md.streets.map((s) => s.name);
  for (const p of md.props) sim.addProp(p.kind, p.x, p.y, { tag: p.tag ?? "", variant: p.variant ?? "" });
  const phase = make(md, c);
  sim.mission = phase;
  phase.setup(sim);
  return { sim, phase, c, md };
}

/** Do a job: tap it, let the pilot fight on the way, tap again if the worker was stopped. */
function job(sim: Sim, phase: Phase, id: string, done: () => boolean, seconds = 90): boolean {
  const it = () => phase.interactables(sim).find((i) => i.id === id);
  const goal = () => { const i = it(); return i ? { x: i.x, y: i.y } : null; };
  for (let t = 0; t < seconds && !done() && !sim.state.outcome; t += 3) {
    const kneeling = sim.state.units.some((u) => u.task?.kind === "work" && u.task.phase === "work");
    const i = it();
    if (i && !kneeling) i.act(sim);
    fly(sim, 3, done, { goal });
  }
  return done();
}

describe("tasks", () => {
  for (const seed of [1234, 77]) {
    it(`Sygnalizacja: the three posts can be set (seed ${seed})`, () => {
      const { sim, phase, c } = setup(signalTask, seed);
      for (const id of ["tlomackie", "bank", "phone"]) job(sim, phase, id, () => sim.state.vars[`post_${id}`] === true);
      fly(sim, 5, () => !!sim.state.outcome);
      expect(sim.state.outcome).toBe("success");
      expect((phase.finish(sim, c) as TaskResult).flags.signal).toBe(true);
    });
  }

  it("Getto: cut the line and take cover at the Arsenal's corner", () => {
    const { sim, phase, c } = setup(ghettoTask);
    expect(job(sim, phase, "cut_line_box", () => sim.state.vars.lineCut === true, 120)).toBe(true);
    for (let k = 0; k < 20 && !sim.state.outcome; k++) { cmdMove(sim, 22, 67); fly(sim, 3, () => !!sim.state.outcome); }
    expect(sim.state.outcome).toBe("success");
    expect((phase.finish(sim, c) as TaskResult).flags.lineCut).toBe(true);
  });

  it("Stare Miasto: disable the truck while it unloads, by fire if need be, and the task ends", () => {
    // this pilot fights its way in: seen, the task ends once the truck is settled (the patrol let by
    // unseen is tests/stealth.test.ts's)
    const { sim, phase, c } = setup(oldtownTask);
    expect(fly(sim, 40, () => sim.state.vars.phase === "unloading")).toBe(true);
    expect(job(sim, phase, "disable_truck", () => sim.state.vars.truckDisabled === true, 80)).toBe(true);
    fly(sim, 150, () => !!sim.state.outcome);
    expect(sim.state.vars.patrolPassed === true || sim.anyAlarm()).toBe(true);
    expect(sim.state.outcome).toBe("success");
    const r = phase.finish(sim, c) as TaskResult;
    expect(r.flags.truckDisabled).toBe(true);
  });
});

describe("the operation's clock", () => {
  // the three-tasks decision: about five minutes each; a task always ends, even one that
  // cannot be won any more (a post nobody has anything left to silence)
  const atLimit = (done: string[]) => {
    const { sim } = setup(oldtownTask);
    for (const id of done) setObjective(sim, id, "done");
    sim.state.time = TASK_LIMIT - 1 / 60;
    sim.state.paused = false;
    sim.step();
    sim.step();
    return sim.state.outcome;
  };
  it("ends a task still open when the van is due", () => expect(atLimit([])).toBe("fail"));
  it("counts what was done by then", () => expect(atLimit(["truck"])).toBe("partial"));
});
