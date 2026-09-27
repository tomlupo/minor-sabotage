// Shared mission building blocks: put a squad of real people on the street as the campaign
// left them, post guards, send patrols, fill the pavements, track objectives.
import type { Sim } from "../sim/sim";
import type { GuardAI, Unit, ObjectiveStatus } from "../sim/types";
import type { MapZone } from "../content/mapdata";
import { makeSquad, fieldSquad } from "../sim/setup";
import { SPEED, WOUND } from "../sim/tuning";
import { SQUADS, PEOPLE } from "../content/arsenal/roster";
import { fit, type Campaign } from "./campaign";

/** Field squad `i` with its fit people; the wounded keep their wound. */
export function fieldFromCampaign(sim: Sim, c: Campaign, i: number, x: number, y: number, dir: number, controlled: boolean): Unit[] {
  const def = SQUADS[i];
  const sq = makeSquad(sim, i, def.name, def.colour);
  const keys = fit(c, i);
  const us = fieldSquad(sim, sq, keys.map((k) => {
    const p = PEOPLE[k];
    return { look: p.key, name: p.pseudonym, realName: p.name, rank: p.rank, role: p.role, weapon: p.weapon, grenades: p.grenades, bottles: p.bottles, tag: p.key };
  }), x, y, dir);
  for (const u of us) if (c.soldiers[u.tag]?.state === "wounded") { u.wounded = true; u.glyph = "wounded"; }
  sq.order = controlled ? "follow" : "hold";
  if (controlled) sim.state.controlled = i;
  // squads not fielded still exist (empty) so indices stay stable
  for (let k = 0; k < SQUADS.length; k++) if (!sim.state.squads[k]) makeSquad(sim, k, SQUADS[k].name, SQUADS[k].colour);
  return us;
}

export interface GuardOpts {
  look?: string;
  weapon?: "rifle" | "mp40" | "pistol";
  district?: number;
  coneR?: number;
  coneHalf?: number;
  tag?: string;
  name?: string;
}

export function guard(sim: Sim, x: number, y: number, dir: number, o: GuardOpts = {}): Unit {
  const look = o.look ?? "de_rifle";
  return sim.spawnUnit({
    side: "de", look, name: o.name ?? "", x, y, dir,
    weapon: o.weapon ?? (look.includes("mp40") ? "mp40" : look.includes("officer") || look.includes("gestapo") ? "pistol" : "rifle"),
    speed: SPEED.guardPatrol, tag: o.tag,
    ai: { mode: "post", district: o.district ?? 1, coneR: o.coneR ?? 14, coneHalf: o.coneHalf ?? 0.58, homeDir: dir } as Partial<GuardAI>,
  });
}

export function patrol(sim: Sim, route: { x: number; y: number }[], o: GuardOpts & { start?: number } = {}): Unit {
  const i = o.start ?? 0;
  const p = route[i % route.length];
  const u = guard(sim, p.x, p.y, 0, o);
  u.ai!.mode = "patrol";
  u.ai!.route = route.map((q) => ({ ...q }));
  u.ai!.routeI = (i + 1) % route.length;
  return u;
}

/** Pedestrians who walk between points and run for a doorway when shooting starts. */
export function civilians(sim: Sim, n: number, points: { x: number; y: number }[], exits: { x: number; y: number }[]) {
  const looks = ["civ_m1", "civ_m2", "civ_f1", "civ_f2"];
  for (let k = 0; k < n; k++) {
    const a = points[Math.floor(sim.rand() * points.length)];
    const exit = exits[Math.floor(sim.rand() * exits.length)];
    const route = [a, points[Math.floor(sim.rand() * points.length)], points[Math.floor(sim.rand() * points.length)]];
    const u = sim.spawnUnit({
      side: "civ", look: looks[k % looks.length], x: a.x + (sim.rand() - 0.5) * 2, y: a.y + (sim.rand() - 0.5) * 0.8, speed: SPEED.civilianWalk,
      ai: { mode: "patrol", homeX: exit.x, homeY: exit.y, district: 0 } as Partial<GuardAI>,
    });
    u.ai!.route = route;
    u.ai!.routeI = k % 3;
  }
}

export function objective(sim: Sim, id: string, text: string, primary = true, x?: number, y?: number): void {
  const s = sim.state;
  if (s.objectives.some((o) => o.id === id)) return;
  s.objectives.push({ id, text, status: "open", primary, x, y });
  sim.emit({ t: "objective", id, status: "open" });
}

export function setObjective(sim: Sim, id: string, status: ObjectiveStatus): void {
  const o = sim.state.objectives.find((q) => q.id === id);
  if (!o || o.status === status) return;
  o.status = status;
  sim.emit({ t: "objective", id, status });
}

export function objectiveDone(sim: Sim, id: string): boolean {
  return sim.state.objectives.find((q) => q.id === id)?.status === "done";
}

/** Every trooper of the fielded squads is dead, down or gone. */
export function squadsBroken(sim: Sim): boolean {
  return !sim.state.units.some((u) => u.side === "pl" && u.squad >= 0 && u.state === "ok" && !u.hidden);
}

export function inZone(z: MapZone, x: number, y: number): boolean {
  return x >= z.x && y >= z.y && x < z.x + z.w && y < z.y + z.h;
}

/** Write each fielded person's fate back into the campaign after a phase. */
export function recordSoldiers(sim: Sim, c: Campaign): string[] {
  const fallen: string[] = [];
  for (const u of sim.state.units) {
    if (u.side !== "pl" || !u.tag || !c.soldiers[u.tag]) continue;
    const st = c.soldiers[u.tag];
    st.kills += u.kills;
    if (u.state === "dead") { st.state = "dead"; fallen.push(u.tag); }
    else if (u.state === "down") {
      // left lying when the phase ended: a veteran is taken alive
      st.state = u.rank >= WOUND.vetRank ? "captured" : "dead";
      if (st.state === "dead") fallen.push(u.tag);
    } else if (u.wounded) st.state = "wounded";
  }
  return fallen;
}

/** Offer help for anyone of ours lying wounded: the rules route the nearest friend. */
export function woundedAround(sim: Sim): Unit[] {
  return sim.state.units.filter((u) => u.side === "pl" && u.state === "down");
}
