// Task: Stare Miasto. The Old Town section held Długa east of the crossroads. Just before
// the action a Wehrmacht truck stopped next to Katoda's post to unload empty barrels, and a
// three-man Schutzpolizei patrol with submachine guns went slowly past; during the
// withdrawal Germans in the Arbeitsamt (Pałac pod Czterema Wiatrami) fired on the last
// group, and a Wehrmacht truck blocked Alek's car at Plac Krasińskich (research §1-§3).
// Here: silence the Arbeitsamt's gate and disable the truck before it leaves, so the way
// east is open for the escape and the withdrawal.
import type { Sim } from "../sim/sim";
import type { Unit, Vehicle } from "../sim/types";
import type { MapData } from "../content/mapdata";
import { zone, path } from "../content/mapdata";
import { cmdWork } from "../sim/commands";
import { goTo } from "../sim/move";
import { DLUGA, W } from "../content/arsenal/map";
import type { Campaign, TaskResult } from "./campaign";
import type { Interactable, Phase } from "./types";
import { civilians, fieldFromCampaign, guard, objective, objectiveDone, patrol, recordSoldiers, setObjective, silencePost, squadsBroken, taskClockBanner, taskTimeUp } from "./helpers";

const GATE_X = 211.5;
const UNLOAD_S = 75;

export function oldtownTask(md: MapData, c: Campaign): Phase {
  const Z = zone(md, "task_oldtown");
  const squad = c.assign.oldtown;
  const truckOf = (sim: Sim): Vehicle | undefined => sim.state.vehicles.find((v) => v.tag === "wehrmacht");

  const phase: Phase = {
    id: "oldtown",
    kind: "task",
    title: "Stare Miasto",
    place: "Długa towards the Old Town",
    time: "26 March 1943, 17:15",
    zone: "task_oldtown",
    light: "afternoon",
    music: "stealth",
    goCode: false,

    setup(sim: Sim) {
      sim.state.bounds = { x: Z.x, y: Z.y, w: Z.w, h: Z.h };
      sim.state.missionId = "oldtown";
      fieldFromCampaign(sim, c, squad, 202, 108, -Math.PI / 2, true);
      guard(sim, GATE_X - 3.5, DLUGA.n + 1.4, Math.PI / 2 + 0.3, { tag: "gate_a" });
      guard(sim, GATE_X + 3.5, DLUGA.n + 1.4, Math.PI / 2 - 0.3, { tag: "gate_b" });
      sim.addSpawner({ x: GATE_X, y: DLUGA.n - 1, ox: GATE_X, oy: DLUGA.n + 4, district: 1, interval: 9, left: -1, maxAlive: 2, tag: "arbeitsamt", look: "de_rifle" });
      patrol(sim, path(md, "patrol_oldtown"), { start: 1, tag: "patrol" });
      civilians(sim, 6,
        [{ x: 150, y: DLUGA.n + 1.5 }, { x: 236, y: DLUGA.n + 1.5 }, { x: 160, y: DLUGA.s - 1.5 }, { x: 230, y: DLUGA.s - 1.5 }],
        [{ x: W - 1, y: DLUGA.n + 1.5 }, { x: 177.5, y: DLUGA.s + 6 }]);
      objective(sim, "gate", "Silence the Arbeitsamt's gate", true, GATE_X, DLUGA.n + 2);
      objective(sim, "truck", "Disable the Wehrmacht truck before it leaves", true);
      objective(sim, "patrol", "Let the police patrol go by", false);
      objective(sim, "quiet", "Keep it quiet: no alarm", false);
      sim.state.vars.phase = "waiting";
      sim.message("Długa, 17:15. A truck is coming to unload barrels.");
    },

    banner: (sim: Sim) => taskClockBanner(sim),

    tick(sim: Sim, dt: number) {
      const s = sim.state;
      if (s.outcome || taskTimeUp(sim)) return;
      if (sim.anyAlarm()) setObjective(sim, "quiet", "failed");
      const t = s.time;
      // the Wehrmacht truck comes, unloads, and leaves
      let truck = truckOf(sim);
      if (!truck && t > 6 && s.vars.truckGone !== true) {
        const route = path(md, "wehrmacht_truck");
        truck = sim.spawnVehicle("german_truck", route[0].x, route[0].y, Math.PI, route, "wehrmacht");
        const driver = sim.spawnUnit({ side: "de", look: "de_rifle", x: truck.x, y: truck.y, weapon: "rifle", hidden: true, ai: { blind: true, mode: "idle", district: 1 }, tag: "w_driver" });
        const a = sim.spawnUnit({ side: "de", look: "de_rifle", x: truck.x, y: truck.y, weapon: "rifle", hidden: true, ai: { blind: true, mode: "idle", district: 1 }, tag: "w_a" });
        const b = sim.spawnUnit({ side: "de", look: "de_rifle", x: truck.x, y: truck.y, weapon: "rifle", hidden: true, ai: { blind: true, mode: "idle", district: 1 }, tag: "w_b" });
        truck.crew = [driver.id, a.id, b.id];
      }
      if (truck && truck.stopped && s.vars.phase === "waiting" && truck.state === "intact") {
        // two men get down and carry barrels between the truck and the kerb
        s.vars.phase = "unloading";
        s.vars.unloadT = t;
        const rear = { x: truck.x + Math.cos(truck.heading) * -3.6, y: truck.y + 1.6 };
        for (const tag of ["w_a", "w_b"]) {
          const u = s.units.find((q) => q.tag === tag)!;
          u.hidden = false;
          u.x = u.px = rear.x + (tag === "w_a" ? 0 : 1.2);
          u.y = u.py = rear.y;
          u.ai!.blind = false;
          u.ai!.mode = "patrol";
          u.ai!.route = [{ x: rear.x, y: rear.y }, { x: 183, y: DLUGA.s - 2.6 }];
          u.ai!.routeI = tag === "w_a" ? 1 : 0;
          truck.crew = truck.crew.filter((id) => id !== u.id);
        }
      }
      if (truck && s.vars.phase === "unloading" && t - Number(s.vars.unloadT) > UNLOAD_S) {
        s.vars.phase = "leaving";
        const crew = ["w_a", "w_b"].map((tag) => s.units.find((q) => q.tag === tag)!).filter((u) => u.state === "ok" && u.ai?.mode === "patrol");
        for (const u of crew) { u.ai!.mode = "idle"; goTo(sim, u, truck.x - 3.4, truck.y + 1.6); }
      }
      if (truck && s.vars.phase === "leaving") {
        const crew = ["w_a", "w_b"].map((tag) => s.units.find((q) => q.tag === tag)!).filter((u) => u.state === "ok" && !u.hidden);
        for (const u of crew) {
          if (Math.hypot(u.x - (truck.x - 3.4), u.y - (truck.y + 1.6)) < 1.2) { u.hidden = true; truck.crew.push(u.id); }
        }
        if (crew.every((u) => u.hidden) || crew.length === 0) {
          if (s.vars.truckDisabled === true) {
            s.vars.phase = "stuck";
            const d = s.units.find((q) => q.tag === "w_driver");
            if (d) sim.say(d, "Verdammt! Er springt nicht an!", 8);
            sim.message("The engine will not start.", "good");
          } else if (truck.driverDead || truck.state !== "intact") {
            s.vars.phase = "stuck";
          } else {
            s.vars.phase = "gone";
            truck.route = path(md, "wehrmacht_leave");
            truck.routeI = 0;
            truck.stopped = false;
          }
        }
      }
      if (truck && s.vars.phase === "gone" && (truck.y > md.h + 2 || truck.x < Z.x - 4)) {
        s.vars.truckGone = true;
        setObjective(sim, "truck", "failed");
        sim.message("The truck has gone. It will be in the way later.", "bad");
      }
      if (truck && (truck.state !== "intact" || truck.driverDead || s.vars.truckDisabled === true) && !objectiveDone(sim, "truck") && s.vars.truckGone !== true) setObjective(sim, "truck", "done");
      // the police patrol: three men with submachine guns, slowly along Długa
      if (!s.vars.patrolSpawned && t > 32) {
        s.vars.patrolSpawned = true;
        const route = path(md, "motorcycles");
        for (let k = 0; k < 3; k++) {
          const u = patrol(sim, route, { look: "de_mp40", tag: `schupo${k}`, start: 0 });
          u.x = u.px = route[0].x + k * 1.6;
          u.y = u.py = route[0].y + (k % 2) * 0.9;
          u.speed = 1.6;
        }
      }
      if (s.vars.patrolSpawned && !s.vars.patrolPassed) {
        const us = s.units.filter((u) => u.tag.startsWith("schupo"));
        if (us.every((u) => u.state === "dead" || u.x < Z.x + 2 || u.y > Z.y + Z.h - 2)) {
          s.vars.patrolPassed = true;
          for (const u of us) if (u.state !== "dead") u.hidden = true;
          setObjective(sim, "patrol", us.every((u) => u.state !== "dead") && !sim.anyAlarm() ? "done" : "failed");
        }
      }
      // the gate: both sentries down, or the door blown
      silencePost(sim, "arbeitsamt", ["gate_a", "gate_b"], "gate");
      if (objectiveDone(sim, "gate") && (objectiveDone(sim, "truck") || s.vars.truckGone === true)) {
        if (!sim.anyAlarm()) setObjective(sim, "quiet", "done");
        s.outcome = objectiveDone(sim, "truck") ? "success" : "partial";
        sim.emit({ t: "phase", outcome: s.outcome });
      } else if (squadsBroken(sim)) {
        s.outcome = "fail";
        sim.emit({ t: "phase", outcome: "fail" });
      }
      void dt;
    },

    onEvent(sim, e) {
      if (e.t === "work" && e.done && e.what === "disable_truck") {
        sim.state.vars.truckDisabled = true;
        const u = sim.unit(e.unit);
        if (u) sim.say(u, "Palec rozdzielacza w kieszeni.", 4);
      }
    },

    interactables(sim: Sim): Interactable[] {
      const truck = truckOf(sim);
      if (!truck || sim.state.vars.truckDisabled === true || sim.state.vars.phase === "gone") return [];
      const fx = truck.x + Math.cos(truck.heading) * (truck.len / 2 + 0.6), fy = truck.y + 1.4;
      return [{
        id: "disable_truck", x: fx, y: fy, r: 1.4, label: "Pull the rotor arm",
        ready: (s) => s.state.vars.truckDisabled !== true && truck.stopped,
        act: (s) => {
          const u = cmdWork(s, fx, fy, "disable_truck", "truck", 3, (w: Unit) => (w.role === "bottles" || w.role === "grenades" ? 3 : 0));
          if (u && u.task?.kind === "work" && (u.role === "bottles" || u.role === "grenades")) u.task.dur = 2;
        },
      }];
    },

    start(sim: Sim) {
      const L = sim.leaderOf(sim.state.squads[squad]);
      return L ? { x: L.x - 8, y: L.y - 14 } : { x: 190, y: 80 };
    },

    finish(sim: Sim, cc: Campaign): TaskResult {
      recordSoldiers(sim, cc);
      const gate = objectiveDone(sim, "gate");
      const truck = objectiveDone(sim, "truck");
      return {
        outcome: gate && truck ? "success" : gate || truck ? "partial" : "fail",
        silent: !sim.anyAlarm(),
        flags: { gateSilenced: gate, truckDisabled: truck },
        seconds: sim.state.time,
      };
    },
  };
  return phase;
}
