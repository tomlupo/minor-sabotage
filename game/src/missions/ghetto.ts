// Task: Getto. The largest cover section held Długa west of the Arsenal, facing Przejazd
// and the ghetto walls, where German police watched from a distance (research §2, §3).
// Here, a fire task: cut the telephone line of the police post at the wall so it cannot call
// for help when the shooting starts, then take cover at the Arsenal's corner. Silencing the
// post itself keeps the finale's west side empty.
import type { Sim } from "../sim/sim";
import type { MapData } from "../content/mapdata";
import { zone, path } from "../content/mapdata";
import { cmdWork } from "../sim/commands";
import { DLUGA, PRZEJAZD, GHETTO_WALL_Y, ARSENAL } from "../content/arsenal/map";
import type { Campaign, TaskResult } from "./campaign";
import type { Interactable, Phase } from "./types";
import { civilians, fieldFromCampaign, guard, objective, objectiveDone, patrol, recordSoldiers, setObjective, silencePost, squadsBroken, taskClockBanner, taskTimeUp } from "./helpers";

const COVER = { x: ARSENAL.x - 4, y: DLUGA.n - 6, w: 14, h: 9 };

export function ghettoTask(md: MapData, c: Campaign): Phase {
  const Z = zone(md, "task_ghetto");
  const squad = c.assign.ghetto;
  const line = md.props.filter((p) => (p.tag ?? "").startsWith("pole_") || p.tag === "line_box");
  const postTags = ["wall_a", "wall_b", "wall_officer"];

  const phase: Phase = {
    id: "ghetto",
    kind: "task",
    title: "Getto",
    place: "Długa at Przejazd",
    time: "26 March 1943, 17:10",
    zone: "task_ghetto",
    light: "afternoon",
    music: "stealth",
    goCode: false,

    setup(sim: Sim) {
      sim.state.bounds = { x: Z.x, y: Z.y, w: Z.w, h: Z.h };
      sim.state.missionId = "ghetto";
      fieldFromCampaign(sim, c, squad, 3, DLUGA.s - 4, 0, true);
      const wy = GHETTO_WALL_Y + 4.2;
      guard(sim, PRZEJAZD.w + 2, wy, Math.PI / 2, { tag: "wall_a", coneR: 16 });
      guard(sim, PRZEJAZD.e - 2, wy, Math.PI / 2 - 0.25, { tag: "wall_b", coneR: 16 });
      guard(sim, (PRZEJAZD.w + PRZEJAZD.e) / 2, GHETTO_WALL_Y + 2.2, Math.PI / 2, { look: "de_officer", tag: "wall_officer" });
      sim.addSpawner({ x: (PRZEJAZD.w + PRZEJAZD.e) / 2, y: GHETTO_WALL_Y + 1.5, ox: (PRZEJAZD.w + PRZEJAZD.e) / 2, oy: GHETTO_WALL_Y + 8, district: 1, interval: 9, left: -1, maxAlive: 2, tag: "wall_post", look: "de_rifle" });
      const route = path(md, "patrol_ghetto");
      patrol(sim, route, { start: 0, tag: "patrol_a" });
      patrol(sim, route.slice().reverse(), { start: 0, tag: "patrol_b" });
      // a Feldgendarm by the Arsenal's lawn, looking down Długa to the west
      guard(sim, ARSENAL.x + 14, DLUGA.n + 1.5, Math.PI + 0.2, { tag: "lawn" });
      civilians(sim, 5,
        [{ x: 8, y: DLUGA.n + 1.5 }, { x: 60, y: DLUGA.n + 1.5 }, { x: 30, y: DLUGA.s - 1.5 }, { x: 70, y: DLUGA.s - 1.5 }],
        [{ x: 1, y: DLUGA.n + 1.5 }, { x: 21.5, y: DLUGA.s + 6 }]);
      objective(sim, "cut", "Cut the post's telephone line", true);
      objective(sim, "cover", "Take cover at the Arsenal's corner", true, COVER.x + COVER.w / 2, COVER.y + COVER.h / 2);
      objective(sim, "post", "Silence the post at the wall", false);
      sim.message("Długa, 17:10. The police at the wall have a telephone.");
    },

    banner: (sim: Sim) => taskClockBanner(sim),

    tick(sim: Sim) {
      const s = sim.state;
      if (s.outcome || taskTimeUp(sim)) return;
      silencePost(sim, "wall_post", postTags, "post");
      if (s.vars.lineCut === true) {
        const L = sim.leaderOf(sim.state.squads[squad]);
        if (L && L.x >= COVER.x && L.y >= COVER.y && L.x < COVER.x + COVER.w && L.y < COVER.y + COVER.h) setObjective(sim, "cover", "done");
      }
      if (objectiveDone(sim, "cut") && objectiveDone(sim, "cover")) {
        s.outcome = "success";
        sim.emit({ t: "phase", outcome: "success" });
        sim.message("Długa west is covered.", "good");
      } else if (squadsBroken(sim)) {
        s.outcome = "fail";
        sim.emit({ t: "phase", outcome: "fail" });
      }
    },

    onEvent(sim, e) {
      if (e.t === "work" && e.done && e.what.startsWith("cut_")) {
        const s = sim.state;
        s.vars.lineCut = true;
        s.vars.lineCutAt = e.what.slice(4);
        setObjective(sim, "cut", "done");
        const u = sim.unit(e.unit);
        if (u) sim.say(u, "Drut przecięty.", 3);
      }
    },

    interactables(sim: Sim): Interactable[] {
      if (sim.state.vars.lineCut === true) return [];
      return line.map((p) => ({
        id: `cut_${p.tag}`, x: p.x, y: p.y + 0.9, r: 1.2, label: "Cut the telephone wire",
        ready: (s) => s.state.vars.lineCut !== true,
        act: (s) => {
          const u = cmdWork(s, p.x, p.y + 0.9, `cut_${p.tag}`, p.tag!, 3, (w) => (w.role === "bottles" || w.role === "grenades" ? 4 : 0));
          if (u && u.task?.kind === "work" && (u.role === "bottles" || u.role === "grenades")) u.task.dur = 1.8;
        },
      }));
    },

    start(sim: Sim) {
      const L = sim.leaderOf(sim.state.squads[squad]);
      return L ? { x: L.x + 10, y: L.y - 8 } : { x: 20, y: 70 };
    },

    finish(sim: Sim, cc: Campaign): TaskResult {
      recordSoldiers(sim, cc);
      const cut = sim.state.vars.lineCut === true;
      const post = objectiveDone(sim, "post");
      return {
        // what the task decided when it ended: finish runs only once it has (flow.ts onEnd)
        outcome: sim.state.outcome ?? "fail",
        silent: !sim.anyAlarm(),
        flags: { lineCut: cut, postSilenced: post },
        seconds: sim.state.time,
      };
    },
  };
  return phase;
}
