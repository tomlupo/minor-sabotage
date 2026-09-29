// Stealth and fire tasks (decision of 2026-09-29; Tom: "if in reality some part of the mission
// was stealth make map possible to do it"). Two players prove it. One looks ahead at what the
// Germans will watch and plans each man's way outside every cone: a quiet way exists. The other is
// a person at the screen, who sees only the cones and the patrols walking: he hides his man at a
// corner, waits, and taps the job's ring. A change to the map or the guards that closes the way,
// or leaves it only to a player who sees the future, fails here.
import { describe, expect, it } from "vitest";
import { buildArsenalMap } from "../src/content/arsenal/map";
import { gridFromMap } from "../src/content/mapdata";
import { Sim } from "../src/sim/sim";
import { newCampaign, TASK_MODE, type Campaign } from "../src/missions/campaign";
import { signalTask } from "../src/missions/signal";
import { ghettoTask } from "../src/missions/ghetto";
import { oldtownTask, UNLOAD_S } from "../src/missions/oldtown";
import { cmdMove, cmdPick, cmdWork } from "../src/sim/commands";
import { UF_POSTED } from "../src/sim/types";
import type { Phase } from "../src/missions/types";
import { planLeg, tapWhenClear, walkLeg, wait } from "./helpers/sneak";

type Make = (md: ReturnType<typeof buildArsenalMap>, c: Campaign) => Phase;

function setup(make: Make, seed = 1234, c = newCampaign()) {
  const md = buildArsenalMap();
  const sim = new Sim(gridFromMap(md), seed);
  sim.streetNames = md.streets.map((s) => s.name);
  for (const p of md.props) sim.addProp(p.kind, p.x, p.y, { tag: p.tag ?? "", variant: p.variant ?? "" });
  const phase = make(md, c);
  sim.mission = phase;
  phase.setup(sim);
  const sq = sim.state.squads[sim.state.controlled];
  const id = (pick: (tag: string, role: string) => boolean) => sim.membersOf(sim.state.squads[sim.state.controlled]).find((u) => pick(u.tag, u.role))!.id;
  return { sim, phase, sq, id };
}

const near = (x: number, y: number, r: number) => (cx: number, cy: number) => Math.hypot(cx + 0.5 - x, cy + 0.5 - y) <= r;
const POSTS = [["tlomackie", "kuba"], ["bank", "kadlubek"], ["phone", "jur"]] as const;
/** Where a person hides a man before he taps: the mouth of Tłomackie, the passage south of the truck. */
const MOUTH = { x: 119, y: 131 }, PASSAGE = { x: 177, y: 95 };

describe("a quiet way exists (a player who looks ahead)", () => {
  for (const seed of [1234, 77]) {
    it(`Sygnalizacja: each post's man by a way no German sees (seed ${seed})`, () => {
      const { sim, phase, id } = setup(signalTask, seed);
      for (const [post, who] of POSTS) {
        const job = phase.interactables(sim).find((i) => i.id === post)!;
        const man = id((t) => t === who);
        const leg = planLeg(sim, man, near(job.x, job.y, 0.9), 4, 120);
        expect(leg, `an unseen way for ${who} to ${post}`).not.toBeNull();
        expect(walkLeg(sim, man, leg!), `${who} walked to ${post} unseen`).toBe(true);
        job.act(sim);
        expect(wait(sim, 4), `${who} set ${post} unseen`).toBe(true);
        expect(sim.state.vars[`post_${post}`]).toBe(true);
      }
      expect(sim.state.outcome).toBe("success");
      expect(sim.anyAlarm()).toBe(false);
    }, 60_000);

    it(`Stare Miasto: the rotor arm while the truck unloads, and back to the squad (seed ${seed})`, () => {
      const { sim, phase, sq, id } = setup(oldtownTask, seed);
      for (let k = 0; k < 240 && sim.state.vars.phase !== "unloading"; k++) wait(sim, 0.5);
      expect(sim.state.vars.phase).toBe("unloading");
      const hide = { x: sq.restX, y: sq.restY };
      const arm = phase.interactables(sim).find((i) => i.id === "disable_truck")!;
      const man = id((_t, role) => role === "bottles");
      // pulled before the crew climbs back in, with 8 s to spare
      const window = Number(sim.state.vars.unloadT) + UNLOAD_S - 8 - sim.state.time;
      const leg = planLeg(sim, man, near(arm.x, arm.y, 0.9), 3.5, window);
      expect(leg, "an unseen way to the rotor arm while the truck unloads").not.toBeNull();
      expect(walkLeg(sim, man, leg!)).toBe(true);
      arm.act(sim);
      expect(wait(sim, 3)).toBe(true);
      expect(sim.state.vars.truckDisabled).toBe(true);
      const back = planLeg(sim, man, near(hide.x, hide.y, 2.5), 20, 120);
      expect(back, "an unseen way back to the squad").not.toBeNull();
      // a real way back from the truck, not from where he stood before it
      expect(back!.cells.length).toBeGreaterThan(10);
      expect(walkLeg(sim, man, back!)).toBe(true);
      for (let k = 0; k < 400 && !sim.state.outcome; k++) wait(sim, 0.5);
      expect(sim.state.outcome).toBe("success");
      expect(sim.anyAlarm()).toBe(false);
    }, 60_000);
  }

  it("Stare Miasto: waiting for the Schupo patrol to go by first still leaves time for the rotor arm", () => {
    const { sim, phase, id } = setup(oldtownTask);
    const schupo = () => sim.state.units.filter((u) => u.tag.startsWith("schupo") && u.state === "ok" && !u.hidden);
    for (let k = 0; k < 400 && !(sim.state.vars.patrolSpawned && schupo().every((u) => u.x < 170)); k++) wait(sim, 0.5);
    expect(sim.state.vars.patrolSpawned).toBe(true);
    expect(sim.state.vars.phase).toBe("unloading");
    const arm = phase.interactables(sim).find((i) => i.id === "disable_truck")!;
    const man = id((_t, role) => role === "bottles");
    const window = Number(sim.state.vars.unloadT) + UNLOAD_S - 8 - sim.state.time;
    const leg = planLeg(sim, man, near(arm.x, arm.y, 0.9), 3.5, window);
    expect(leg, `an unseen way to the rotor arm in the ${window.toFixed(0)} s left`).not.toBeNull();
    expect(walkLeg(sim, man, leg!)).toBe(true);
    arm.act(sim);
    expect(wait(sim, 3)).toBe(true);
    expect(sim.state.vars.truckDisabled).toBe(true);
  }, 60_000);
});

describe("a person can find it (only what is on the screen)", () => {
  for (const seed of [1234, 77, 5, 31]) {
    it(`Sygnalizacja: each man hidden at the mouth of Tłomackie, then his ring tapped when it is clear (seed ${seed})`, () => {
      // review round 13: a tap on Kuba's ring walked him past a Schupo at arm's length every time
      const { sim, phase, id } = setup(signalTask, seed);
      for (const [post, who] of POSTS) {
        const ok = tapWhenClear(sim, id((t) => t === who), () => phase.interactables(sim).find((i) => i.id === post), () => sim.state.vars[`post_${post}`] === true, { hide: MOUTH });
        expect(ok, `${who} set ${post} unseen`).toBe(true);
      }
      wait(sim, 1);
      expect(sim.state.outcome).toBe("success");
      expect(sim.anyAlarm()).toBe(false);
    }, 60_000);

    it(`Stare Miasto: a man hidden in the passage, the rotor arm when it is clear, back in the passage (seed ${seed})`, () => {
      const { sim, phase, id } = setup(oldtownTask, seed);
      const man = id((_t, role) => role === "bottles");
      for (let k = 0; k < 240 && sim.state.vars.phase !== "unloading"; k++) wait(sim, 0.5);
      const ok = tapWhenClear(sim, man, () => phase.interactables(sim).find((i) => i.id === "disable_truck"), () => sim.state.vars.truckDisabled === true, { hide: PASSAGE });
      expect(ok, "the rotor arm pulled unseen").toBe(true);
      cmdMove(sim, PASSAGE.x, PASSAGE.y);
      for (let k = 0; k < 400 && !sim.state.outcome; k++) wait(sim, 0.5);
      wait(sim, 1);
      expect(sim.state.outcome).toBe("success");
      expect(sim.anyAlarm()).toBe(false);
    }, 60_000);
  }
});

describe("blown, but you fight on", () => {
  // Tom, 2026-09-29: "Blown, but you fight on (Recommended)"
  it("Sygnalizacja: seen, the posts can still be set, and the task says it was blown", () => {
    const { sim, phase, id } = setup(signalTask);
    sim.raiseAlarm(1, 130, 130);
    // the alarm stays up; who wins the shooting that follows is not what this is about
    for (const u of sim.state.units) if (u.side === "de" && u.ai) u.ai.blind = true;
    for (const [post, who] of POSTS) {
      const job = phase.interactables(sim).find((i) => i.id === post)!;
      const man = sim.unit(id((t) => t === who))!;
      man.x = man.px = job.x;
      man.y = man.py = job.y;
      cmdPick(sim, man.id);
      job.act(sim);
      for (let n = 0; n < 20 && sim.state.vars[`post_${post}`] !== true; n++) wait(sim, 0.5);
    }
    wait(sim, 1);
    expect(sim.state.outcome).toBe("success");
    expect(sim.state.objectives.find((o) => o.id === "quiet")?.status).toBe("failed");
    const r = phase.finish(sim, newCampaign());
    expect(r).toMatchObject({ outcome: "success", silent: false });
  });

  it("Stare Miasto: seen, the task ends once the truck is settled, though the Schupo never go by", () => {
    // review round 13: alerted, the Schupo fight rather than go by, and the task ran to the clock
    const { sim, phase, id } = setup(oldtownTask);
    for (let k = 0; k < 240 && sim.state.vars.phase !== "unloading"; k++) wait(sim, 0.5);
    const arm = phase.interactables(sim).find((i) => i.id === "disable_truck")!;
    const man = sim.unit(id((_t, role) => role === "bottles"))!;
    man.x = man.px = arm.x;
    man.y = man.py = arm.y;
    cmdPick(sim, man.id);
    arm.act(sim);
    for (let n = 0; n < 12 && sim.state.vars.truckDisabled !== true; n++) wait(sim, 0.5);
    expect(sim.state.vars.truckDisabled).toBe(true);
    sim.raiseAlarm(1, 200, 80);
    for (let n = 0; n < 10 && !sim.state.outcome; n++) wait(sim, 0.5);
    expect(sim.state.outcome).toBe("success");
    expect(sim.state.objectives.map((o) => `${o.id}:${o.status}`)).toEqual(["truck:done", "patrol:failed", "quiet:failed"]);
  });
});

describe("stealth and fire", () => {
  it("splits the tasks as the sections worked on the day, and only a stealth task asks for quiet", () => {
    expect(TASK_MODE).toEqual({ signal: "stealth", ghetto: "fire", oldtown: "stealth" });
    for (const [make, mode] of [[signalTask, "stealth"], [ghettoTask, "fire"], [oldtownTask, "stealth"]] as const) {
      const { sim } = setup(make);
      const quiet = sim.state.objectives.find((o) => o.id === "quiet");
      if (mode === "stealth") expect(quiet).toMatchObject({ text: "Stay unseen", primary: true });
      else expect(quiet).toBeUndefined();
    }
  });

  it("a man at his post passes for a man at the kerb, holds it, and is a partisan again once sent", () => {
    // the signal section stood in plain clothes at the kerb on 26 March 1943 and nobody looked twice
    const { sim, phase, id } = setup(signalTask);
    const post = phase.interactables(sim).find((i) => i.id === "tlomackie")!;
    const kuba = id((t) => t === "kuba");
    const k = sim.unit(kuba)!;
    k.x = k.px = post.x;
    k.y = k.py = post.y;
    cmdPick(sim, kuba);
    post.act(sim);
    wait(sim, 3);
    expect(sim.state.vars.post_tlomackie).toBe(true);
    // a German who stands 6 m off and looks straight at the post, with nothing in between
    const g = sim.state.units.find((u) => u.tag === "schupo")!;
    const gx = post.x + 6, gy = post.y;
    Object.assign(g, { x: gx, y: gy, px: gx, py: gy, dir: Math.PI });
    Object.assign(g.ai!, { homeX: gx, homeY: gy, homeDir: Math.PI, sweep: 0, meter: 0 });
    expect(sim.grid.walkable(gx, gy)).toBe(true);
    expect(sim.grid.los(gx, gy, sim.unit(kuba)!.x, sim.unit(kuba)!.y)).toBe(true);
    // another man picked and sent: Kuba does not walk back into the column
    const other = id((t) => t === "kadlubek");
    cmdPick(sim, other);
    cmdMove(sim, sim.unit(other)!.x + 3, sim.unit(other)!.y);
    let meter = 0;
    for (let n = 0; n < 20; n++) { wait(sim, 0.5); meter = Math.max(meter, g.ai!.meter); }
    expect(meter).toBe(0);
    expect(Math.hypot(sim.unit(kuba)!.x - post.x, sim.unit(kuba)!.y - post.y)).toBeLessThan(1);
    // sent from his post, he is a man with a pistol in the German's view again
    cmdPick(sim, kuba);
    cmdMove(sim, post.x + 1.5, post.y + 1);
    for (let n = 0; n < 8; n++) { wait(sim, 0.5); meter = Math.max(meter, g.ai!.meter); }
    expect(meter).toBeGreaterThan(0);
  });

  it("another squad on Sygnalizacja sets every post by tapping the rings: a man at his post is not handed the next", () => {
    // review round 13: with none of the named men, a job went to the nearest man, often one already
    // at his post, who waited for a column he no longer walks in
    const c = newCampaign();
    [c.assign.signal, c.assign.oldtown] = [c.assign.oldtown, c.assign.signal];
    const { sim, phase } = setup(signalTask, 1234, c);
    // the column walks in the open when the rings are tapped without a pick: the Germans look
    // elsewhere here, since this is about who is given each job, not about being seen
    for (const u of sim.state.units) if (u.side === "de" && u.ai) u.ai.blind = true;
    for (const [post] of POSTS) {
      phase.interactables(sim).find((i) => i.id === post)!.act(sim);
      for (let n = 0; n < 180 && sim.state.vars[`post_${post}`] !== true; n++) wait(sim, 0.5);
      expect(sim.state.vars[`post_${post}`], `${post} set`).toBe(true);
    }
  }, 60_000);

  /** Kuba set at his post at the mouth of Tłomackie, and nobody picked. */
  const kubaPosted = () => {
    const s = setup(signalTask);
    const kuba = s.id((t) => t === "kuba");
    const post = s.phase.interactables(s.sim).find((i) => i.id === "tlomackie")!;
    const k = s.sim.unit(kuba)!;
    k.x = k.px = post.x;
    k.y = k.py = post.y;
    cmdPick(s.sim, kuba);
    post.act(s.sim);
    wait(s.sim, 3);
    expect(s.sim.state.vars.post_tlomackie).toBe(true);
    // let go without a tap on his tag (a tap takes him off his post)
    s.sim.state.picked = -1;
    return { ...s, kuba };
  };

  it("a man at his post is not handed a job far from it, though he is the nearest", () => {
    // review round 13: handed it, he waited for the column to bring him within reach, and the column
    // no longer takes a man at his post
    const { sim, kuba } = kubaPosted();
    const k = sim.unit(kuba)!;
    const at = { x: k.x + 1, y: k.y + 10 };
    expect(sim.grid.walkable(at.x, at.y)).toBe(true);
    const others = sim.membersOf(sim.state.squads[sim.state.controlled]).filter((u) => u.id !== kuba);
    expect(Math.min(...others.map((u) => Math.hypot(u.x - at.x, u.y - at.y)))).toBeGreaterThan(Math.hypot(k.x - at.x, k.y - at.y));
    const worker = cmdWork(sim, at.x, at.y, "test", "test", 1);
    expect(worker).not.toBeNull();
    expect(worker!.id).not.toBe(kuba);
  });

  it("a man at his post, picked and given another job, leaves his post for it and does it", () => {
    const { sim, phase, kuba } = kubaPosted();
    cmdPick(sim, kuba);
    phase.interactables(sim).find((i) => i.id === "bank")!.act(sim);
    // walking to it he is a partisan in the street again, not a man at the kerb
    expect(sim.unit(kuba)!.flags & UF_POSTED).toBe(0);
    for (let n = 0; n < 120 && sim.state.vars.post_bank !== true; n++) wait(sim, 0.5);
    expect(sim.state.vars.post_bank).toBe(true);
  }, 60_000);

  it("a man at his post, his tag tapped twice, leaves his post and rejoins the column", () => {
    // cmdPick's promise: tapped again, he rejoins the column
    const { sim, kuba } = kubaPosted();
    cmdPick(sim, kuba);
    cmdPick(sim, kuba);
    expect(sim.unit(kuba)!.flags & UF_POSTED).toBe(0);
    const post = { x: sim.unit(kuba)!.x, y: sim.unit(kuba)!.y };
    wait(sim, 5);
    expect(Math.hypot(sim.unit(kuba)!.x - post.x, sim.unit(kuba)!.y - post.y)).toBeGreaterThan(5);
  });

  it("Sygnalizacja's patrol pair keeps together for the whole task", () => {
    // two rounds of different lengths: at one pace the inner man gained 10 m a round
    const { sim } = setup(signalTask);
    const pair = () => sim.state.units.filter((u) => u.tag === "patrol_a" || u.tag === "patrol_b");
    let apart = 0;
    for (let n = 0; n < 420; n++) {
      wait(sim, 1);
      const [a, b] = pair();
      apart = Math.max(apart, Math.hypot(a.x - b.x, a.y - b.y));
    }
    // a pair, not two patrols: half a round apart they were 30 m and more
    expect(apart).toBeLessThan(8);
  }, 60_000);
});
