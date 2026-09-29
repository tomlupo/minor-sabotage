// Stealth and fire tasks (decision of 2026-09-29; Tom: "if in reality some part of the mission
// was stealth make map possible to do it"). A player who keeps out of sight (helpers/sneak.ts)
// plans each man's way through the Germans' cones and walks it with the game's own orders: no
// alarm, and the task is won. A change to the map or the guards that closes the way fails here.
import { describe, expect, it } from "vitest";
import { buildArsenalMap } from "../src/content/arsenal/map";
import { gridFromMap } from "../src/content/mapdata";
import { Sim } from "../src/sim/sim";
import { newCampaign, TASK_MODE } from "../src/missions/campaign";
import { signalTask } from "../src/missions/signal";
import { ghettoTask } from "../src/missions/ghetto";
import { oldtownTask, UNLOAD_S } from "../src/missions/oldtown";
import { cmdMove, cmdPick } from "../src/sim/commands";
import type { Phase } from "../src/missions/types";
import { planLeg, walkLeg, wait } from "./helpers/sneak";

type Make = (md: ReturnType<typeof buildArsenalMap>, c: ReturnType<typeof newCampaign>) => Phase;

function setup(make: Make, seed = 1234) {
  const md = buildArsenalMap();
  const sim = new Sim(gridFromMap(md), seed);
  sim.streetNames = md.streets.map((s) => s.name);
  for (const p of md.props) sim.addProp(p.kind, p.x, p.y, { tag: p.tag ?? "", variant: p.variant ?? "" });
  const phase = make(md, newCampaign());
  sim.mission = phase;
  phase.setup(sim);
  const sq = sim.state.squads[sim.state.controlled];
  return { sim, phase, members: sim.membersOf(sq), sq };
}

const near = (x: number, y: number, r: number) => (cx: number, cy: number) => Math.hypot(cx + 0.5 - x, cy + 0.5 - y) <= r;

describe("stealth tasks can be done unseen", () => {
  for (const seed of [1234, 77]) {
    it(`Sygnalizacja: each post's man by a way no German sees (seed ${seed})`, () => {
      const { sim, phase, members } = setup(signalTask, seed);
      for (const [id, who] of [["tlomackie", "kuba"], ["bank", "kadlubek"], ["phone", "jur"]] as const) {
        const post = phase.interactables(sim).find((i) => i.id === id)!;
        const man = members.find((u) => u.tag === who)!;
        const leg = planLeg(sim, man, near(post.x, post.y, 0.9), 4, 120);
        expect(leg, `an unseen way for ${who} to ${id}`).not.toBeNull();
        expect(walkLeg(sim, man, leg!), `${who} walked to ${id} unseen`).toBe(true);
        post.act(sim);
        expect(wait(sim, 4), `${who} set ${id} unseen`).toBe(true);
        expect(sim.state.vars[`post_${id}`]).toBe(true);
      }
      expect(sim.state.outcome).toBe("success");
      expect(sim.anyAlarm()).toBe(false);
      expect(sim.state.objectives.find((o) => o.id === "quiet")?.status).toBe("done");
    }, 60_000);

    it(`Stare Miasto: the rotor arm while the truck unloads, back into hiding, the patrol let by (seed ${seed})`, () => {
      const { sim, phase, members, sq } = setup(oldtownTask, seed);
      for (let k = 0; k < 240 && sim.state.vars.phase !== "unloading"; k++) wait(sim, 0.5);
      expect(sim.state.vars.phase).toBe("unloading");
      const arm = phase.interactables(sim).find((i) => i.id === "disable_truck")!;
      const man = members.find((u) => u.role === "bottles")!;
      const hide = { x: sq.restX, y: sq.restY };
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
      expect(walkLeg(sim, man, back!)).toBe(true);
      for (let k = 0; k < 400 && !sim.state.outcome; k++) wait(sim, 0.5);
      expect(sim.state.outcome).toBe("success");
      expect(sim.anyAlarm()).toBe(false);
      expect(sim.state.objectives.map((o) => `${o.id}:${o.status}`)).toEqual(["truck:done", "patrol:done", "quiet:done"]);
    }, 60_000);
  }
});

describe("stealth tasks leave time for a careful player", () => {
  it("Stare Miasto: waiting for the Schupo patrol to go by first still leaves time for the rotor arm", () => {
    const { sim, phase, members } = setup(oldtownTask);
    const schupo = () => sim.state.units.filter((u) => u.tag.startsWith("schupo") && u.state === "ok" && !u.hidden);
    // the patrol comes and goes; nobody moves until the last of them is past the truck
    for (let k = 0; k < 400 && !(sim.state.vars.patrolSpawned && schupo().every((u) => u.x < 170)); k++) wait(sim, 0.5);
    expect(sim.state.vars.patrolSpawned).toBe(true);
    expect(sim.state.vars.phase).toBe("unloading");
    const arm = phase.interactables(sim).find((i) => i.id === "disable_truck")!;
    const man = members.find((u) => u.role === "bottles")!;
    const window = Number(sim.state.vars.unloadT) + UNLOAD_S - 8 - sim.state.time;
    const leg = planLeg(sim, man, near(arm.x, arm.y, 0.9), 3.5, window);
    expect(leg, `an unseen way to the rotor arm in the ${window.toFixed(0)} s left`).not.toBeNull();
    expect(walkLeg(sim, man, leg!)).toBe(true);
    arm.act(sim);
    expect(wait(sim, 3)).toBe(true);
    expect(sim.state.vars.truckDisabled).toBe(true);
  }, 60_000);
});

describe("stealth and fire", () => {
  it("splits the tasks as the sections worked on the day, and only a stealth task asks for quiet", () => {
    expect(TASK_MODE).toEqual({ signal: "stealth", ghetto: "fire", oldtown: "stealth" });
    for (const [make, mode] of [[signalTask, "stealth"], [ghettoTask, "fire"], [oldtownTask, "stealth"]] as const) {
      const { sim, phase } = setup(make);
      expect(phase.mode).toBe(mode);
      const quiet = sim.state.objectives.find((o) => o.id === "quiet");
      if (mode === "stealth") expect(quiet).toMatchObject({ text: "Stay unseen", primary: true });
      else expect(quiet).toBeUndefined();
    }
  });

  it("a man at his post passes for a man at the kerb, holds it, and is a partisan again once sent", () => {
    // the signal section stood in plain clothes at the kerb on 26 March 1943 and nobody looked twice
    const { sim, phase, members } = setup(signalTask);
    const post = phase.interactables(sim).find((i) => i.id === "tlomackie")!;
    const kuba = members.find((u) => u.tag === "kuba")!;
    const schupo = sim.state.units.find((u) => u.tag === "schupo")!;
    kuba.x = kuba.px = post.x;
    kuba.y = kuba.py = post.y;
    cmdPick(sim, kuba.id);
    post.act(sim);
    wait(sim, 3);
    expect(sim.state.vars.post_tlomackie).toBe(true);
    // a German who stands 6 m off and looks straight at the post, with nothing in between
    const gx = post.x + 6, gy = post.y;
    Object.assign(schupo, { x: gx, y: gy, px: gx, py: gy, dir: Math.PI });
    Object.assign(schupo.ai!, { homeX: gx, homeY: gy, homeDir: Math.PI, sweep: 0, meter: 0 });
    expect(sim.grid.walkable(gx, gy)).toBe(true);
    expect(sim.grid.los(gx, gy, kuba.x, kuba.y)).toBe(true);
    // another man picked and sent: Kuba does not walk back into the column
    const other = members.find((u) => u.tag === "kadlubek")!;
    cmdPick(sim, other.id);
    cmdMove(sim, other.x + 3, other.y);
    let meter = 0;
    for (let k = 0; k < 20; k++) { wait(sim, 0.5); meter = Math.max(meter, schupo.ai!.meter); }
    expect(meter).toBe(0);
    expect(Math.hypot(kuba.x - post.x, kuba.y - post.y)).toBeLessThan(1);
    // sent from his post, he is a man with a pistol in the Schupo's view again
    cmdPick(sim, kuba.id);
    cmdMove(sim, post.x + 1.5, post.y + 1);
    for (let k = 0; k < 8; k++) { wait(sim, 0.5); meter = Math.max(meter, schupo.ai!.meter); }
    expect(meter).toBeGreaterThan(0);
  });
});
