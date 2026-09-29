// Stealth and fire tasks (decision of 2026-09-29; Tom: "if in reality some part of the mission
// was stealth make map possible to do it"). A person at the screen proves it: he sees only the
// cones and the patrols walking, hides his man at a corner, waits, and taps the job's ring. A change
// to the map or the guards that closes the way, or leaves it only to a player who sees the future,
// fails here.
import { describe, expect, it, vi } from "vitest";
import { buildArsenalMap } from "../src/content/arsenal/map";
import { gridFromMap } from "../src/content/mapdata";
import { Sim } from "../src/sim/sim";
import { newCampaign, TASK_MODE, type Campaign } from "../src/missions/campaign";
import { signalTask } from "../src/missions/signal";
import { ghettoTask } from "../src/missions/ghetto";
import { oldtownTask } from "../src/missions/oldtown";
import { cmdFireAt, cmdMove, cmdPick, cmdTapEnemy, cmdThrow, cmdWork } from "../src/sim/commands";
import { UF_POSTED } from "../src/sim/types";
import type { Phase } from "../src/missions/types";
import { tapWhenClear, wait } from "./helpers/sneak";

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

const POSTS = [["tlomackie", "kuba"], ["bank", "kadlubek"], ["phone", "jur"]] as const;
/** Where a person hides a man before he taps: the mouth of Tłomackie, the passage south of the truck. */
const MOUTH = { x: 119, y: 131 }, PASSAGE = { x: 177, y: 95 };
const quiet = (sim: Sim) => sim.state.objectives.find((o) => o.id === "quiet")?.status;
/** The Germans look and listen elsewhere: for a test of who does what, not of being seen. */
const blind = (sim: Sim) => { for (const u of sim.state.units) if (u.side === "de" && u.ai) u.ai.blind = true; };
/** A spot `r` metres from (x, y) that a man can stand on and see from there. */
function spotFrom(sim: Sim, x: number, y: number, r: number, from = 0) {
  for (let k = 0; k < 16; k++) {
    const a = from + (k * Math.PI) / 8, sx = x + Math.cos(a) * r, sy = y + Math.sin(a) * r;
    if (sim.grid.walkable(sx, sy) && sim.grid.los(x, y, sx, sy)) return { x: sx, y: sy };
  }
  throw new Error(`no open spot ${r} m from ${x}, ${y}`);
}

describe("a person can do it unseen (only what is on the screen)", () => {
  for (const seed of [1234, 77, 5, 31]) {
    it(`Sygnalizacja: each man hidden at the mouth of Tłomackie, then his ring tapped when it is clear (seed ${seed})`, () => {
      // review round 13: a tap on Kuba's ring walked him past a Schupo at arm's length every time
      const { sim, phase, id } = setup(signalTask, seed);
      for (const [post, who] of POSTS) {
        const ok = tapWhenClear(sim, id((t) => t === who), () => phase.interactables(sim).find((i) => i.id === post), () => sim.state.vars[`post_${post}`] === true, MOUTH);
        expect(ok, `${who} set ${post} unseen`).toBe(true);
      }
      wait(sim, 1);
      expect(sim.state.outcome).toBe("success");
      expect(quiet(sim)).toBe("done");
    }, 60_000);

    it(`Stare Miasto: a man hidden in the passage, the rotor arm when it is clear, back in the passage (seed ${seed})`, () => {
      const { sim, phase, id } = setup(oldtownTask, seed);
      const man = id((_t, role) => role === "bottles");
      for (let k = 0; k < 240 && sim.state.vars.phase !== "unloading"; k++) wait(sim, 0.5);
      const ok = tapWhenClear(sim, man, () => phase.interactables(sim).find((i) => i.id === "disable_truck"), () => sim.state.vars.truckDisabled === true, PASSAGE);
      expect(ok, "the rotor arm pulled unseen").toBe(true);
      cmdMove(sim, PASSAGE.x, PASSAGE.y);
      for (let k = 0; k < 400 && !sim.state.outcome; k++) wait(sim, 0.5);
      wait(sim, 1);
      expect(sim.state.outcome).toBe("success");
      expect(quiet(sim)).toBe("done");
    }, 60_000);
  }

  it("Stare Miasto: a person who lets the Schupo patrol go by first still has time for the rotor arm", () => {
    // the crew unloads long enough for a player who waits for the patrol (oldtown.ts UNLOAD_S)
    const { sim, phase, id } = setup(oldtownTask);
    const schupo = () => sim.state.units.filter((u) => u.tag.startsWith("schupo") && u.state === "ok" && !u.hidden);
    for (let k = 0; k < 400 && !(sim.state.vars.patrolSpawned && schupo().every((u) => u.x < 170)); k++) wait(sim, 0.5);
    expect(sim.state.vars.patrolSpawned).toBe(true);
    expect(sim.state.vars.phase).toBe("unloading");
    const ok = tapWhenClear(sim, id((_t, role) => role === "bottles"), () => phase.interactables(sim).find((i) => i.id === "disable_truck"), () => sim.state.vars.truckDisabled === true, PASSAGE);
    expect(ok, "the rotor arm pulled unseen after the patrol went by").toBe(true);
  }, 60_000);
});

describe("blown, but you fight on", () => {
  // Tom, 2026-09-29: "Blown, but you fight on (Recommended)"
  it("Sygnalizacja: seen, the posts can still be set, and the task says it was blown", () => {
    const { sim, phase, id } = setup(signalTask);
    sim.raiseAlarm(1, 130, 130);
    // the alarm stays up; who wins the shooting that follows is not what this is about
    blind(sim);
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
    expect(quiet(sim)).toBe("failed");
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

  it("Sygnalizacja: a German who saw one of ours blows it, though he is silenced before his whistle ends", () => {
    // review round 14: the pair shot mid-whistle raised no alarm, and the task read "unseen"
    const { sim, phase, id } = setup(signalTask);
    wait(sim, 10);
    const g = sim.state.units.find((u) => u.tag === "patrol_a")!;
    const kuba = sim.unit(id((t) => t === "kuba"))!;
    const at = { x: g.x + Math.cos(g.dir) * 5, y: g.y + Math.sin(g.dir) * 5 };
    expect(sim.grid.walkable(at.x, at.y) && sim.grid.los(g.x, g.y, at.x, at.y)).toBe(true);
    Object.assign(kuba, { x: at.x, y: at.y, px: at.x, py: at.y, path: [] });
    for (let n = 0; n < 150 && g.ai!.whistleT < 0; n++) wait(sim, 1 / 30);
    expect(g.ai!.whistleT, "he began to whistle").toBeGreaterThan(0);
    for (const u of sim.state.units) if (u.tag.startsWith("patrol_")) sim.kill(u, kuba.id, true);
    blind(sim);
    expect(wait(sim, 5), "nobody lived to raise the alarm").toBe(true);
    expect(quiet(sim)).toBe("failed");
    expect(phase.finish(sim, newCampaign())).toMatchObject({ silent: false });
  });

  it("Stare Miasto: a shot or a throw of ours blows it, though no German heard it", () => {
    // the sections fired no shot on the day; a knife is silent
    for (const how of ["shot", "throw"] as const) {
      const { sim, phase, sq } = setup(oldtownTask);
      blind(sim);
      const L = sim.leaderOf(sq)!;
      const at = spotFrom(sim, L.x, L.y, 8);
      if (how === "shot") cmdFireAt(sim, at.x, at.y, 1);
      else expect(cmdThrow(sim, at.x, at.y)).not.toBeNull();
      let done = 0;
      for (let n = 0; n < 90; n++) {
        sim.state.paused = false;
        sim.step();
        for (const e of sim.drainEvents()) if (e.t === how) done++;
      }
      expect(done, `${how}: it happened`).toBeGreaterThan(0);
      expect(sim.anyAlarm(), how).toBe(false);
      expect(quiet(sim), how).toBe("failed");
      expect(phase.finish(sim, newCampaign()), how).toMatchObject({ silent: false });
    }
  });

  it("Sygnalizacja: blown by a shot, then finished: Stay unseen stays failed", () => {
    // review round 15: the task's end set it done again unless the alarm was up
    const { sim, phase, sq, id } = setup(signalTask);
    blind(sim);
    const L = sim.leaderOf(sq)!;
    const at = spotFrom(sim, L.x, L.y, 8);
    cmdFireAt(sim, at.x, at.y, 1);
    wait(sim, 2);
    expect(quiet(sim)).toBe("failed");
    for (const [post, who] of POSTS) {
      const job = phase.interactables(sim).find((i) => i.id === post)!;
      const man = sim.unit(id((t) => t === who))!;
      Object.assign(man, { x: job.x, y: job.y, px: job.x, py: job.y, path: [] });
      cmdPick(sim, man.id);
      job.act(sim);
      for (let n = 0; n < 20 && sim.state.vars[`post_${post}`] !== true; n++) wait(sim, 0.5);
    }
    wait(sim, 1);
    expect(sim.anyAlarm()).toBe(false);
    expect(sim.state.outcome).toBe("success");
    expect(quiet(sim)).toBe("failed");
  });

  it("Stare Miasto: blown by a shot, then finished: Stay unseen stays failed", () => {
    // ended with no alarm, or the end would read the alarm and never the blown rule
    const { sim, phase, sq, id } = setup(oldtownTask);
    const man = id((_t, role) => role === "bottles");
    for (let k = 0; k < 240 && sim.state.vars.phase !== "unloading"; k++) wait(sim, 0.5);
    const ok = tapWhenClear(sim, man, () => phase.interactables(sim).find((i) => i.id === "disable_truck"), () => sim.state.vars.truckDisabled === true, PASSAGE);
    expect(ok, "the rotor arm pulled unseen").toBe(true);
    cmdMove(sim, PASSAGE.x, PASSAGE.y);
    wait(sim, 3);
    // then a shot no German hears: those about are deaf for that moment (a blind German also stands
    // still), then themselves again. (Shot earlier, it scatters the street, and the truck comes sooner)
    const deaf = sim.state.units.filter((u) => u.side === "de" && u.ai && !u.ai.blind && u.state === "ok");
    for (const u of deaf) u.ai!.blind = true;
    const L = sim.leaderOf(sq)!;
    const at = spotFrom(sim, L.x, L.y, 8);
    cmdFireAt(sim, at.x, at.y, 1);
    wait(sim, 2);
    for (const u of deaf) u.ai!.blind = false;
    expect(quiet(sim)).toBe("failed");
    for (let k = 0; k < 400 && !sim.state.outcome; k++) wait(sim, 0.5);
    expect(sim.anyAlarm()).toBe(false);
    expect(sim.state.outcome).toBe("success");
    expect(quiet(sim)).toBe("failed");
  }, 60_000);

  it("Stare Miasto: the Schupo patrol killed, not let by, and the truck gone: the task failed", () => {
    // the patrol let by unseen is half the task; dead, it was not let by (round 15: unpinned)
    const { sim, phase } = setup(oldtownTask);
    // killed as they come, and nobody finds them: this is about the record, not the alarm
    for (let k = 0; k < 600 && !sim.state.outcome; k++) {
      blind(sim);
      for (const u of sim.state.units) if (u.tag.startsWith("schupo") && u.state === "ok") sim.kill(u, -1, true);
      wait(sim, 0.5);
    }
    expect(sim.anyAlarm()).toBe(false);
    expect(sim.state.vars.patrolPassed).toBe(true);
    expect(sim.state.vars.truckGone).toBe(true);
    expect(sim.state.outcome).toBe("fail");
    expect(phase.finish(sim, newCampaign()).outcome).toBe("fail");
  }, 60_000);

  it("Stare Miasto: seen, the crew shot and the truck gone, the task failed, in the sim and in its record", () => {
    // review round 14: the sim ended it "partial" and the record said "fail"
    const { sim, phase } = setup(oldtownTask);
    for (let k = 0; k < 240 && sim.state.vars.phase !== "unloading"; k++) wait(sim, 0.5);
    sim.raiseAlarm(1, 200, 80);
    for (const tag of ["w_a", "w_b"]) sim.kill(sim.state.units.find((u) => u.tag === tag)!, -1, false);
    // who wins the fight is not the point: the Schupo who come are blinded as they come
    for (let k = 0; k < 600 && !sim.state.outcome; k++) { blind(sim); wait(sim, 0.5); }
    expect(sim.state.vars.truckGone).toBe(true);
    expect(sim.state.outcome).toBe("fail");
    expect(phase.finish(sim, newCampaign()).outcome).toBe("fail");
  }, 60_000);

  it("Stare Miasto: the patrol let by unseen and the truck gone, half done, in the sim and in its record", () => {
    const { sim, phase } = setup(oldtownTask);
    for (let k = 0; k < 600 && !sim.state.outcome; k++) wait(sim, 0.5);
    expect(sim.state.vars.truckGone).toBe(true);
    expect(sim.anyAlarm()).toBe(false);
    expect(sim.state.outcome).toBe("partial");
    expect(phase.finish(sim, newCampaign()).outcome).toBe("partial");
  }, 60_000);
});

describe("stealth and fire", () => {
  it("splits the tasks as the sections worked on the day, and only a stealth task asks for quiet", () => {
    expect(TASK_MODE).toEqual({ signal: "stealth", ghetto: "fire", oldtown: "stealth" });
    for (const [make, mode] of [[signalTask, "stealth"], [ghettoTask, "fire"], [oldtownTask, "stealth"]] as const) {
      const { sim } = setup(make);
      const q = sim.state.objectives.find((o) => o.id === "quiet");
      if (mode === "stealth") expect(q).toMatchObject({ text: "Stay unseen", primary: true });
      else expect(q).toBeUndefined();
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
    // the column walks in the open when the rings are tapped without a pick
    blind(sim);
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

  it("Sygnalizacja: a first play that taps the rings in turn with no hiding, a few seconds in, is seen", () => {
    // a stealth task asks for stealth: the pair stands at its first corner 13 s before it sets off;
    // setting off at once, it let this play through unseen from 9 s to 30 s (review round 15)
    const { sim, phase } = setup(signalTask);
    wait(sim, 12);
    for (const [post] of POSTS) {
      phase.interactables(sim).find((i) => i.id === post)!.act(sim);
      for (let n = 0; n < 180 && sim.state.vars[`post_${post}`] !== true && quiet(sim) !== "failed"; n++) wait(sim, 0.5);
      if (quiet(sim) === "failed") break;
    }
    expect(quiet(sim)).toBe("failed");
  }, 60_000);

  it("Sygnalizacja's patrolman, back on his round after a glimpse, stops at a corner no longer than the pair does", () => {
    // review round 14: the glimpse's own stop carried over to the next corner, 5 s rather than 1.5,
    // and split the pair
    const { sim, id } = setup(signalTask);
    wait(sim, 10);
    const g = sim.state.units.find((u) => u.tag === "patrol_a")!;
    const kuba = sim.unit(id((t) => t === "kuba"))!;
    const home = { x: kuba.x, y: kuba.y };
    const at = { x: g.x + Math.cos(g.dir) * 11, y: g.y + Math.sin(g.dir) * 11 };
    expect(sim.grid.walkable(at.x, at.y) && sim.grid.los(g.x, g.y, at.x, at.y)).toBe(true);
    Object.assign(kuba, { x: at.x, y: at.y, px: at.x, py: at.y, path: [] });
    for (let n = 0; n < 60 && g.ai!.mode !== "suspicious"; n++) wait(sim, 1 / 30);
    expect(g.ai!.mode, "he glimpsed him").toBe("suspicious");
    Object.assign(kuba, { x: home.x, y: home.y, px: home.x, py: home.y, path: [] });
    let back = false, stood = 0, longest = 0;
    for (let n = 0; n < 120 * 30; n++) {
      wait(sim, 1 / 30);
      if (g.ai!.mode === "patrol") back = true;
      if (back && g.ai!.mode === "patrol" && !g.moving) longest = Math.max(longest, (stood += 1 / 30));
      else stood = 0;
    }
    expect(back, "back on his round").toBe(true);
    expect(sim.anyAlarm()).toBe(false);
    expect(longest).toBeLessThan(1.6);
  }, 60_000);
});

describe("a man handed a job gets there, whether the column goes with him or not", () => {
  // review round 14: with the leader picked, a ring tapped for another man left him standing,
  // waiting for a column that never came; and a ring tapped for one man sent the leader off his own
  it("the leader picked and sent to a post, a ring tapped for another man: each gets to his own", () => {
    const { sim, phase, sq } = setup(signalTask);
    blind(sim);
    const ring = (p: string) => phase.interactables(sim).find((i) => i.id === p)!;
    const L = sim.leaderOf(sq)!;
    cmdPick(sim, L.id);
    ring("tlomackie").act(sim);
    wait(sim, 2);
    ring("bank").act(sim);
    const g = sim.unit(L.id)!;
    expect(Math.hypot(g.goalX - ring("tlomackie").x, g.goalY - ring("tlomackie").y), "the leader still bound for his own post").toBeLessThan(1);
    for (let n = 0; n < 120 && !(sim.state.vars.post_bank === true && sim.state.vars.post_tlomackie === true); n++) wait(sim, 0.5);
    expect(sim.state.vars.post_tlomackie).toBe(true);
    expect(sim.state.vars.post_bank).toBe(true);
  }, 60_000);

  it("the leader at a job of his own, a ring tapped far from it: the leader keeps to his, the other man goes alone", () => {
    const { sim, phase, sq } = setup(ghettoTask);
    blind(sim);
    const L = sim.leaderOf(sq)!;
    const jobs = phase.interactables(sim).filter((i) => i.ready(sim));
    const mine = jobs[0];
    const far = jobs.reduce((a, j) => (Math.hypot(j.x - mine.x, j.y - mine.y) > Math.hypot(a.x - mine.x, a.y - mine.y) ? j : a));
    expect(Math.hypot(far.x - mine.x, far.y - mine.y)).toBeGreaterThan(20);
    // an errand of his own, and he is not picked
    expect(cmdWork(sim, mine.x, mine.y, "errand", "errand", 30, (u) => (u === L ? 100 : 0))).toBe(L);
    wait(sim, 1);
    far.act(sim);
    const man = sim.state.units.find((u) => u.task?.kind === "work" && u.id !== L.id)!;
    const g = sim.unit(L.id)!;
    expect(Math.hypot(g.goalX - mine.x, g.goalY - mine.y), "the leader still bound for his own job").toBeLessThan(1);
    for (let n = 0; n < 120 && sim.unit(man.id)!.task; n++) wait(sim, 0.5);
    expect(sim.unit(man.id)!.task, `${man.tag} did ${far.id}`).toBeNull();
    expect(far.ready(sim)).toBe(false);
  }, 60_000);

  it("the leader at his post, a ring tapped for another man: the leader keeps his post", () => {
    const { sim, phase, sq } = setup(signalTask);
    blind(sim);
    const ring = (p: string) => phase.interactables(sim).find((i) => i.id === p)!;
    const L = sim.leaderOf(sq)!;
    cmdPick(sim, L.id);
    ring("tlomackie").act(sim);
    for (let n = 0; n < 120 && sim.state.vars.post_tlomackie !== true; n++) wait(sim, 0.5);
    expect(sim.unit(L.id)!.flags & UF_POSTED).not.toBe(0);
    // let go without a tap on his tag (a tap takes him off his post)
    sim.state.picked = -1;
    const post = { x: sim.unit(L.id)!.x, y: sim.unit(L.id)!.y };
    ring("bank").act(sim);
    for (let n = 0; n < 120 && sim.state.vars.post_bank !== true; n++) wait(sim, 0.5);
    expect(sim.state.vars.post_bank).toBe(true);
    const g = sim.unit(L.id)!;
    expect(g.flags & UF_POSTED, "still at his post").not.toBe(0);
    expect(Math.hypot(g.x - post.x, g.y - post.y)).toBeLessThan(1);
  }, 60_000);

  it("the leader picked and on his way to a job of his own, a job beside it tapped for another man: he sets off at once, alone", () => {
    // the column stays where it rested while its leader is picked, though its leader walks to a job
    // by the other man's
    const { sim, sq } = setup(signalTask);
    blind(sim);
    const L = sim.leaderOf(sq)!;
    cmdPick(sim, L.id);
    const a = spotFrom(sim, L.x, L.y, 20);
    expect(cmdWork(sim, a.x, a.y, "errand", "errand", 30)).toBe(L);
    wait(sim, 0.5);
    const b = spotFrom(sim, a.x, a.y, 4);
    const man = cmdWork(sim, b.x, b.y, "test", "test", 1)!;
    expect(man.id).not.toBe(L.id);
    const d0 = Math.hypot(man.x - b.x, man.y - b.y);
    wait(sim, 3);
    const m = sim.unit(man.id)!;
    expect(d0 - Math.hypot(m.x - b.x, m.y - b.y), `${man.tag} on his way at once`).toBeGreaterThan(4);
    for (let n = 0; n < 60 && sim.unit(man.id)!.task; n++) wait(sim, 0.5);
    expect(sim.unit(man.id)!.task, `${man.tag} did it`).toBeNull();
  });

  it("a job tapped, then another the other way: the first man makes for his own, not along with the column", () => {
    // the column goes with the second man now, and carries only a man whose job it walks to
    const { sim, sq } = setup(signalTask);
    blind(sim);
    const L = sim.leaderOf(sq)!;
    const a = spotFrom(sim, L.x, L.y, 20);
    const x = cmdWork(sim, a.x, a.y, "test_a", "test_a", 1, (u) => (u === L ? -100 : 0))!;
    wait(sim, 0.5);
    const b = spotFrom(sim, L.x, L.y, 20, Math.atan2(a.y - L.y, a.x - L.x) + Math.PI);
    const y = cmdWork(sim, b.x, b.y, "test_b", "test_b", 1, (u) => (u === L ? -100 : 0))!;
    expect([x.id, y.id]).not.toContain(L.id);
    expect(y.id).not.toBe(x.id);
    const d0 = Math.hypot(sim.unit(x.id)!.x - a.x, sim.unit(x.id)!.y - a.y);
    wait(sim, 3);
    const m = sim.unit(x.id)!;
    expect(d0 - Math.hypot(m.x - a.x, m.y - a.y), `${x.tag} making for his own job`).toBeGreaterThan(4);
  });

  it("another man's job tapped again once the picked leader is done with his own: the man goes on, the leader stays", () => {
    // cmdWork's "tapped again: the squad sets off again", but not a squad whose leader is picked
    const { sim, sq } = setup(signalTask);
    blind(sim);
    const L = sim.leaderOf(sq)!;
    cmdPick(sim, L.id);
    const a = spotFrom(sim, L.x, L.y, 2);
    expect(cmdWork(sim, a.x, a.y, "errand", "errand", 2)).toBe(L);
    const b = spotFrom(sim, L.x, L.y, 30);
    const man = cmdWork(sim, b.x, b.y, "test", "test", 1)!;
    expect(man.id).not.toBe(L.id);
    for (let n = 0; n < 20 && sim.unit(L.id)!.task; n++) wait(sim, 0.5);
    expect(sim.unit(L.id)!.task, "the leader done with his own").toBeNull();
    expect(sim.unit(man.id)!.task, "the other man still on his way").not.toBeNull();
    const goal = { x: sim.unit(L.id)!.goalX, y: sim.unit(L.id)!.goalY };
    expect(cmdWork(sim, b.x, b.y, "test", "test", 1)).toBe(sim.unit(man.id));
    expect(Math.hypot(sim.unit(L.id)!.goalX - goal.x, sim.unit(L.id)!.goalY - goal.y), "the leader sent nowhere").toBeLessThan(0.01);
  });

  it("a ring tapped, then the street: the man on his way to that job far off comes along with the squad", () => {
    // review round 15: the squad turned back and he walked on alone, into the cones
    const { sim, phase, sq, id } = setup(signalTask);
    blind(sim);
    const L = sim.leaderOf(sq)!;
    const home = { x: L.x, y: L.y };
    const kadlubek = id((t) => t === "kadlubek");
    phase.interactables(sim).find((i) => i.id === "bank")!.act(sim);
    expect(sim.unit(kadlubek)!.task?.kind).toBe("work");
    wait(sim, 2);
    cmdMove(sim, home.x, home.y);
    expect(sim.unit(kadlubek)!.task, "his far-off job dropped").toBeNull();
    wait(sim, 20);
    expect(sim.state.vars.post_bank).not.toBe(true);
    const k = sim.unit(kadlubek)!, l = sim.unit(L.id)!;
    expect(Math.hypot(k.x - l.x, k.y - l.y), "with the squad").toBeLessThan(6);
  });

  it("a ring tapped, then the squad halted on its way: the man goes on to his job alone", () => {
    // review round 15: the column halted short of the job (a knife order halts all but men with a
    // task, cmdTapEnemy) and held him at his place in it until the next order
    const { sim, phase, sq } = setup(signalTask);
    blind(sim);
    phase.interactables(sim).find((i) => i.id === "bank")!.act(sim);
    wait(sim, 2);
    for (const u of sim.membersOf(sq)) if (!u.task) u.path = [];
    for (let n = 0; n < 120 && sim.state.vars.post_bank !== true; n++) wait(sim, 0.5);
    expect(sim.state.vars.post_bank).toBe(true);
  }, 60_000);

  it("the column leaves a man alone once it is not carrying him: he is routed to his job once, not every tick", () => {
    // left in the column's hands, the column and the job each sent him their own way every tick, a
    // route search a tick for each such man (round 15)
    const { sim, phase, sq } = setup(signalTask);
    blind(sim);
    phase.interactables(sim).find((i) => i.id === "bank")!.act(sim);
    wait(sim, 2);
    for (const u of sim.membersOf(sq)) if (!u.task) u.path = [];
    wait(sim, 0.5);
    const route = vi.spyOn(sim, "route");
    wait(sim, 3);
    expect(route.mock.calls.length, "route searches in 90 ticks").toBeLessThan(20);
    route.mockRestore();
    for (let n = 0; n < 120 && sim.state.vars.post_bank !== true; n++) wait(sim, 0.5);
    expect(sim.state.vars.post_bank).toBe(true);
  }, 60_000);

  it("Getto: a ring tapped, then a knife at once: the man it went to makes his way out of the halted squad to his job", () => {
    // review round 15: bound for his place in the halted column, a neighbour kept him from it, and so
    // from his job, for good (a knife halts all but the knifer and men with a task, cmdTapEnemy)
    const { sim, phase, sq } = setup(ghettoTask);
    phase.interactables(sim).find((i) => i.id === "cut_pole_d22")!.act(sim);
    const man = sim.membersOf(sq).find((u) => u.task?.kind === "work")!;
    wait(sim, 0.5);
    const near = (g: { x: number; y: number }) => sim.membersOf(sq).some((m) => m !== man && !m.task && Math.hypot(m.x - g.x, m.y - g.y) <= 14);
    const g = sim.state.units.find((u) => u.side === "de" && u.state === "ok" && !u.hidden && u.ai && !u.ai.blind && u.ai.mode !== "alert" && near(u))!;
    expect(cmdTapEnemy(sim, g.id)).toBe("knife");
    // who wins any fight that follows is not the point
    blind(sim);
    for (let n = 0; n < 120 && sim.unit(man.id)!.task; n++) wait(sim, 0.5);
    expect(sim.unit(man.id)!.task, `${man.tag} cut it`).toBeNull();
  }, 60_000);

  it("a man picked on the strip walks to his job himself at once, though the column is on its way to one beside it", () => {
    // the column does not carry a picked man: he waited for it to arrive
    const { sim, sq } = setup(signalTask);
    blind(sim);
    const L = sim.leaderOf(sq)!;
    const a = spotFrom(sim, L.x, L.y, 20);
    const x = cmdWork(sim, a.x, a.y, "test_a", "test_a", 1, (u) => (u === L ? -100 : 0))!;
    expect(x.id).not.toBe(L.id);
    wait(sim, 0.5);
    const man = sim.membersOf(sq).find((u) => u !== L && u !== x && !u.task)!;
    cmdPick(sim, man.id);
    const b = spotFrom(sim, a.x, a.y, 2);
    expect(cmdWork(sim, b.x, b.y, "test_b", "test_b", 1)).toBe(sim.unit(man.id));
    const d0 = Math.hypot(man.x - b.x, man.y - b.y);
    wait(sim, 3);
    const m = sim.unit(man.id)!;
    expect(d0 - Math.hypot(m.x - b.x, m.y - b.y), `${man.tag} on his way at once`).toBeGreaterThan(4);
    for (let n = 0; n < 60 && sim.unit(man.id)!.task; n++) wait(sim, 0.5);
    expect(sim.unit(man.id)!.task).toBeNull();
  });
});
