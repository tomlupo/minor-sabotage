// Task: Sygnalizacja. On the day, Kadłubek stood at the kerb by the Bank Polski in a
// Tyrolean hat, Kuba at the mouth of Tłomackie watching the reflection in a shop window,
// and Jur held the telephone in a small restaurant on the Długa–Bielańska corner. When the
// van came, Kadłubek bowed, Kuba waved his cap and Orsza blew his whistle (research §1).
// Here: set the three posts on Bielańska without raising the alarm. Success gives the
// finale its go-code: you know when the van is coming.
import type { Sim } from "../sim/sim";
import type { MapData } from "../content/mapdata";
import { zone } from "../content/mapdata";
import { cmdWork } from "../sim/commands";
import { BIEL, DLUGA, TLOM } from "../content/arsenal/map";
import type { Campaign, TaskResult } from "./campaign";
import type { Interactable, Phase } from "./types";
import { UF_POSTED } from "../sim/types";
import { SPEED } from "../sim/tuning";
import { civilians, fieldFromCampaign, guard, objective, patrol, recordSoldiers, setObjective, squadsBroken, taskClockBanner, taskTimeUp } from "./helpers";
import { path } from "../content/mapdata";

const POSTS = [
  { id: "phone", label: "Jur takes the telephone", obj: "Jur at the telephone on the corner", x: BIEL.e + 5, y: DLUGA.s - 2.6, who: "jur" },
  { id: "tlomackie", label: "Kuba takes his post", obj: "Kuba at the mouth of Tłomackie", x: BIEL.w + 1.2, y: TLOM.n - 3, who: "kuba" },
  { id: "bank", label: "Kadłubek takes his post", obj: "Kadłubek by the Bank Polski", x: BIEL.e - 2.2, y: 146, who: "kadlubek" },
] as const;

export function signalTask(md: MapData, c: Campaign): Phase {
  const Z = zone(md, "task_signal");
  const squad = c.assign.signal;
  const phase: Phase = {
    id: "signal",
    kind: "task",
    title: "Sygnalizacja",
    place: "Bielańska",
    time: "26 March 1943, 17:05",
    zone: "task_signal",
    light: "afternoon",
    music: "stealth",
    goCode: false,

    setup(sim: Sim) {
      sim.state.bounds = { x: Z.x, y: Z.y, w: Z.w, h: Z.h };
      sim.state.missionId = "signal";
      // in from Tłomackie
      fieldFromCampaign(sim, c, squad, TLOM.x0 + 34, (TLOM.n + TLOM.s) / 2, 0, true);
      // the Bank Polski: two sentries and a guard room, looking down Bielańska towards Plac
      // Teatralny. The first looked west across the street, and his slow look round swept the way
      // to Kadłubek's post by the bank (review round 13)
      guard(sim, BIEL.e - 0.8, 151, Math.PI * 0.8, { tag: "bank_a" });
      guard(sim, BIEL.e - 0.8, 158, Math.PI * 0.8, { tag: "bank_b" });
      sim.addSpawner({ x: BIEL.e + 0.6, y: 154.5, ox: BIEL.e - 2, oy: 154.5, district: 1, interval: 9, left: -1, maxAlive: 2, tag: "bank_door", look: "de_rifle" });
      // a patrol pair walking the pavements together, the second two paces behind. Half a round
      // apart, one of them was always on the north half of Bielańska, and a player watching the
      // cones never saw the way to the telephone clear (review round 13)
      const route = path(md, "patrol_signal");
      const a = patrol(sim, route, { start: 0, tag: "patrol_a" });
      // the second walks his own round a pace inside the first: on the same corners they both
      // wanted one spot, and stood there shoulder to shoulder for good
      const mid = { x: (BIEL.w + BIEL.e) / 2, y: (route[0].y + route[1].y) / 2 };
      const inner = route.map((p) => ({ x: p.x + Math.sign(mid.x - p.x) * 1.2, y: p.y + Math.sign(mid.y - p.y) * 1.2 }));
      const b = patrol(sim, inner, { start: 0, tag: "patrol_b" });
      b.y = b.py = inner[0].y - 2;
      // and at his round's pace, so the pair stays a pair (the inner round is 10 m shorter)
      const round = (r: { x: number; y: number }[]) => r.reduce((a, p, i) => a + Math.hypot(r[(i + 1) % r.length].x - p.x, r[(i + 1) % r.length].y - p.y), 0);
      b.ai!.pace = SPEED.guardPatrol * (round(inner) / round(route));
      // and stops as long as the first at each corner (each man's own stop drifted them apart)
      a.ai!.pause = b.ai!.pause = 1.5;
      // a Schupo at the Plac Teatralny end, looking up Bielańska (where the finale's Schupo come
      // from). He stood at the mouth of Tłomackie, on the very way a tap on Kuba's ring walks him:
      // a player waiting for clear cones was felt at arm's length every time (review round 13)
      guard(sim, BIEL.w + 3, 166, -Math.PI / 2, { look: "de_mp40", tag: "schupo" });
      civilians(sim, 7,
        [{ x: BIEL.w + 1, y: 100 }, { x: BIEL.w + 1, y: 150 }, { x: BIEL.e - 1, y: 104 }, { x: BIEL.e - 1, y: 132 }, { x: 90, y: TLOM.n + 1 }],
        [{ x: BIEL.w + 1, y: 168 }, { x: BIEL.e - 1, y: 168 }, { x: 70, y: TLOM.n + 1 }]);
      // no place of their own: each post's job rings it (one ring, one arrow)
      for (const p of POSTS) objective(sim, p.id, p.obj, true);
      objective(sim, "quiet", "Stay unseen", true);
      sim.message("Bielańska, 17:05. The van leaves Szucha soon.");
    },

    banner: (sim: Sim) => taskClockBanner(sim),

    tick(sim: Sim) {
      const s = sim.state;
      if (s.outcome || taskTimeUp(sim)) return;
      if (sim.anyAlarm()) setObjective(sim, "quiet", "failed");
      if (POSTS.every((p) => s.vars[`post_${p.id}`] === true)) {
        if (!sim.anyAlarm()) setObjective(sim, "quiet", "done");
        s.outcome = "success";
        sim.emit({ t: "phase", outcome: "success" });
        sim.message("The signal chain is set.", "good");
      } else if (squadsBroken(sim)) {
        s.outcome = "fail";
        sim.emit({ t: "phase", outcome: "fail" });
      }
    },

    onEvent(sim, e) {
      if (e.t === "work" && e.done && e.what.startsWith("post_")) {
        sim.state.vars[e.what] = true;
        setObjective(sim, e.what.slice(5), "done");
        const u = sim.unit(e.unit);
        if (u) {
          // at his post he passes for a man at a kerb, as they did on the day
          u.flags |= UF_POSTED;
          sim.say(u, e.what === "post_phone" ? "Halo? Tu Jur." : "Na miejscu.", 3);
        }
      }
    },

    interactables(sim: Sim): Interactable[] {
      return POSTS.map((p) => ({
        id: p.id, x: p.x, y: p.y, r: 1.4, label: p.label,
        ready: (s) => s.state.vars[`post_${p.id}`] !== true,
        act: (s) => { cmdWork(s, p.x, p.y, `post_${p.id}`, p.id, 2, (u) => (u.tag === p.who ? 50 : u.role === "scout" ? 6 : 0)); },
      }));
    },

    start(sim: Sim) {
      const L = sim.leaderOf(sim.state.squads[squad]);
      return L ? { x: L.x, y: L.y } : { x: Z.x + Z.w / 2, y: Z.y + Z.h / 2 };
    },

    finish(sim: Sim, cc: Campaign): TaskResult {
      recordSoldiers(sim, cc);
      const done = POSTS.filter((p) => sim.state.vars[`post_${p.id}`] === true).length;
      return {
        outcome: done === POSTS.length ? "success" : done > 0 ? "partial" : "fail",
        silent: !sim.anyAlarm(),
        flags: { signal: done === POSTS.length, bielanskaAlert: sim.anyAlarm() },
        seconds: sim.state.time,
      };
    },
  };
  return phase;
}
