// The finale: the Arsenal, 26 March 1943, 17:30, dusk. The van comes up Bielańska, turns
// left into Długa and should turn right into Nalewki 38 m on. On the day, the Butelki
// section's bottles set the cab alight; the driver went straight on and the burning van
// rolled to a stop beside the Arsenal; the two guards at the tailgate fought for minutes;
// Kołczan opened the tailgate; Rudy crawled out last and the DKW reversed from the corner
// to take him (research §1, §3, §4). The tasks decide what comes after the first shot:
// the ghetto-wall police (Getto), the Arbeitsamt and a truck across Plac Krasińskich
// (Stare Miasto), and whether you get the signal at all (Sygnalizacja).
import type { Sim } from "../sim/sim";
import type { SimEvent, Unit, Vehicle } from "../sim/types";
import { UF_ESCAPED, UF_EVACUATED } from "../sim/types";
import type { MapData } from "../content/mapdata";
import { zone, path, inZone } from "../content/mapdata";
import { cmdWork } from "../sim/commands";
import { goTo } from "../sim/move";
import { SPEED } from "../sim/tuning";
import { makeSquad } from "../sim/setup";
import { SQUADS } from "../content/arsenal/roster";
import { BIEL, DLUGA, NAL, W, PRZEJAZD, GHETTO_WALL_Y } from "../content/arsenal/map";
import { fit, type Campaign, type FinaleResult } from "./campaign";
import type { Interactable, Phase } from "./types";
import { civilians, fieldFromCampaign, guard, objective, recordSoldiers, setObjective } from "./helpers";

export const PRISONERS = 19;
const D_ESCORT = 1, D_WEST = 2, D_EAST = 3, D_SOUTH = 4, D_NORTH = 5;
/** Seconds after the first shot when the gendarmerie arrive in force. */
export const LATE = 270;

// where each squad waits (research §2): the attack sections along the Simons pavement of
// Nalewki, the cover at the Długa–Bielańska corner
const POSTS = [
  { x: NAL.e + 2.5, y: DLUGA.n - 1.5, dir: Math.PI * 0.8 },
  { x: NAL.e + 1.8, y: DLUGA.n - 14, dir: Math.PI * 0.95 },
  { x: BIEL.w - 3, y: DLUGA.n + 2.2, dir: Math.PI * 0.55 },
];

export function finale(md: MapData, c: Campaign): Phase {
  const Z = zone(md, "finale");
  const R = c.results;
  const signal = R.signal?.flags.signal === true;
  const bielAlert = R.signal?.flags.bielanskaAlert === true;
  const lineCut = R.ghetto?.flags.lineCut === true;
  const postSilenced = R.ghetto?.flags.postSilenced === true;
  const gateSilenced = R.oldtown?.flags.gateSilenced === true;
  const truckDisabled = R.oldtown?.flags.truckDisabled === true;
  const exits = ["exit_east", "exit_tlomackie", "exit_south", "exit_west"].map((n) => zone(md, n));

  const vanOf = (sim: Sim): Vehicle | undefined => sim.state.vehicles.find((v) => v.tag === "van");
  const carOf = (sim: Sim): Vehicle | undefined => sim.state.vehicles.find((v) => v.tag === "dkw");
  const rearOf = (v: Vehicle) => ({ x: v.x - Math.cos(v.heading) * (v.len / 2 + 0.9), y: v.y - Math.sin(v.heading) * (v.len / 2 + 0.9) });
  const since = (sim: Sim) => (typeof sim.state.vars.actionT === "number" ? sim.state.time - (sim.state.vars.actionT as number) : -1);

  const failWith = (sim: Sim, why: string) => {
    const s = sim.state;
    if (s.outcome) return;
    s.outcome = "fail";
    s.vars.failReason = why;
    sim.message(why, "bad");
    sim.emit({ t: "phase", outcome: "fail" });
  };

  const spawnGroup = (sim: Sim, route: { x: number; y: number }[], looks: string[], district: number, tag: string) => {
    const end = route[route.length - 1];
    looks.forEach((look, k) => {
      const u = sim.spawnUnit({
        side: "de", look, x: route[0].x + (k % 2) * 1.2, y: route[0].y + k * 1.1, weapon: look.includes("mp40") ? "mp40" : look.includes("officer") ? "pistol" : "rifle",
        tag, ai: { mode: "alert", district, lastX: end.x, lastY: end.y, lastT: sim.state.time, react: 0.8 },
      });
      u.glyph = "alert";
      u.speed = SPEED.guardRun;
      goTo(sim, u, end.x + (k % 2) * 1.5, end.y + k, 9000);
    });
  };

  const spawnVan = (sim: Sim) => {
    const s = sim.state;
    const route = path(md, "truck");
    const van = sim.spawnVehicle("prison_truck", route[0].x, route[0].y, -Math.PI / 2, route, "van");
    van.maxSpeed = 8;
    const mk = (tag: string) => sim.spawnUnit({ side: "de", look: "de_gestapo", x: van.x, y: van.y, weapon: "pistol", hidden: true, tag, ai: { blind: true, mode: "crew", district: D_ESCORT } });
    van.crew = [mk("driver"), mk("cab"), mk("cab"), mk("rear"), mk("rear")].map((u) => u.id);
    sim.message(s.signalGiven ? "Kadłubek bows, Kuba waves his cap: the van is on Bielańska!" : "The van! Coming up Bielańska!", "info");
    s.vars.vanT = s.time;
  };

  const vanTick = (sim: Sim, van: Vehicle) => {
    const s = sim.state;
    // alarmed before the right turn, the driver swerves straight on along Długa (what happened)
    const onDluga = van.y < DLUGA.s && van.y > DLUGA.n - 2 && van.x > NAL.e - 2 && van.routeI >= 2 && van.routeI <= 3;
    if (onDluga && typeof s.vars.actionT === "number" && s.vars.swerved !== true && !van.driverDead && van.state === "intact") {
      s.vars.swerved = true;
      van.route = [{ x: van.x - 10, y: 77 }, ...path(md, "truck_swerve")];
      van.routeI = 0;
      van.maxSpeed = 6.5; // a loaded Renault does not leap away
      sim.message("The driver swerves straight on along Długa!", "bad");
    }
    const disabled = van.state !== "intact" || van.driverDead;
    if (disabled && s.vars.stopped !== true) {
      s.vars.stopped = true;
      setObjective(sim, "stop", "done");
      sim.message(van.state === "burning" ? "The cab is burning! The van rolls on and stops." : "The driver is hit! The van rolls to a stop.", "good");
    }
    // the fire stays in the cab: the load bed and its tarpaulin held
    if (van.state === "burning" && s.vars.doorsOpened !== true) van.burnT = Math.min(van.burnT, 8);
    // the guards at the tailgate fight from where they sit
    if (s.vars.rearPlaced !== true) {
      const rear = s.units.filter((u) => u.tag === "rear" && !u.hidden);
      if (rear.length) {
        s.vars.rearPlaced = true;
        const r = rearOf(van);
        rear.forEach((u, k) => {
          const side = k === 0 ? 1 : -1;
          const p = sim.grid.nearestWalkable(r.x - Math.sin(van.heading) * side * 1.1, r.y + Math.cos(van.heading) * side * 1.1, 3);
          if (p) { u.x = u.px = p.x; u.y = u.py = p.y; }
          u.ai!.stay = true;
          u.ai!.react = 1.2;
        });
      }
    }
    if (!disabled && (van.x < -3 || van.y < -3)) {
      s.vars.rudyLost = true;
      failWith(sim, "The van got away with the prisoners.");
    }
  };

  const openTailgate = (sim: Sim) => {
    const s = sim.state;
    const van = vanOf(sim);
    if (!van || s.vars.doorsOpened === true) return;
    s.vars.doorsOpened = true;
    s.vars.releaseT = s.time;
    s.vars.released = 0;
    van.doorsOpen = true;
    setObjective(sim, "tailgate", "done");
    sim.message("The tailgate is open! The prisoners pour out.", "good");
  };

  const callCar = (sim: Sim) => {
    const s = sim.state;
    const van = vanOf(sim);
    const car = carOf(sim);
    if (!van || !car || s.vars.carCalled === true) return;
    s.vars.carCalled = true;
    const r = rearOf(van);
    const back = { x: r.x - Math.cos(van.heading) * 3.4, y: r.y - Math.sin(van.heading) * 3.4 + 0.8 };
    car.route = [{ x: Math.max(back.x + 6, Math.min(car.x - 2, back.x + 20)), y: 80.5 }, back];
    car.routeI = 0;
    car.stopped = false;
    car.maxSpeed = 7;
    sim.message("Jeremi brings the DKW round to the van.", "info");
  };

  const releaseTick = (sim: Sim) => {
    const s = sim.state;
    if (s.vars.doorsOpened !== true || Number(s.vars.released) > PRISONERS) return;
    const van = vanOf(sim);
    if (!van) return;
    const n = Math.floor((s.time - Number(s.vars.releaseT)) / 0.3);
    while (Number(s.vars.released) < Math.min(n, PRISONERS)) {
      const k = Number(s.vars.released);
      const r = rearOf(van);
      const p = sim.grid.nearestWalkable(r.x + (sim.rand() - 0.5) * 1.6, r.y + (sim.rand() - 0.5) * 1.6, 3) ?? r;
      const u = sim.spawnUnit({ side: "pris", look: k % 3 === 0 ? "pris2" : "pris", x: p.x, y: p.y, speed: SPEED.prisoner, tag: k === 4 ? "heniek" : "" });
      if (k === 4) { u.name = "Heniek"; sim.say(u, "Dajcie mi broń!", 6); }
      s.vars.released = k + 1;
    }
    if (Number(s.vars.released) >= PRISONERS && s.time - Number(s.vars.releaseT) > PRISONERS * 0.3 + 1) {
      const r = rearOf(van);
      const u = sim.spawnUnit({ side: "pris", look: "rudy", name: "Rudy", realName: "Jan Bytnar", x: r.x, y: r.y, speed: 0, tag: "rudy" });
      u.anim = "kneel";
      u.animLock = 1e6;
      s.vars.released = PRISONERS + 1;
      sim.message("Rudy crawls out over the benches. He cannot stand.", "info");
      // Jeremi does not wait long to be asked
      s.vars.autoCar = s.time + 6;
    }
  };

  const carTick = (sim: Sim, car: Vehicle) => {
    const s = sim.state;
    const rudy = s.units.find((u) => u.tag === "rudy");
    if (s.vars.carCalled !== true && typeof s.vars.autoCar === "number" && s.time >= s.vars.autoCar) callCar(sim);
    // the car arrives: Rudy in, and anyone of ours lying wounded close by
    if (s.vars.carCalled === true && s.vars.loaded !== true && car.stopped && car.speed < 0.1 && rudy && rudy.state !== "dead") {
      if (Math.hypot(car.x - rudy.x, car.y - rudy.y) < 7) {
        if (typeof s.vars.loadT !== "number") { s.vars.loadT = s.time; car.doorsOpen = true; }
        else if (s.time - Number(s.vars.loadT) > 1.6) {
          rudy.hidden = true;
          s.vars.loaded = true;
          setObjective(sim, "rudy", "done");
          car.doorsOpen = false;
          const wounded = s.units.filter((u) => u.side === "pl" && u.state === "down" && Math.hypot(u.x - car.x, u.y - car.y) < 7);
          for (const u of wounded) { u.hidden = true; u.state = "ok"; u.wounded = true; u.flags |= UF_EVACUATED; }
          sim.message(wounded.length ? `The DKW takes Rudy and ${wounded.map((u) => u.name).join(", ")}.` : "Rudy is in the DKW. Go, Jeremi!", "good");
          car.route = [{ x: car.x + 12, y: 80.5 }, ...path(md, "car_escape")];
          car.routeI = 0;
          car.stopped = false;
          car.maxSpeed = 9;
          s.vars.phase = "escape";
        }
      }
    }
    if (s.vars.phase === "escape" && car.x > W - 1.5 && s.vars.carEscaped !== true) {
      s.vars.carEscaped = true;
      s.vars.escapeT = s.time;
      setObjective(sim, "escape", "done");
      s.vehicles = s.vehicles.filter((v) => v !== car);
      objective(sim, "withdraw", "Withdraw along Długa to the Old Town", true);
      s.vars.phase = "withdraw";
      sim.message("The DKW is through. Orsza's whistle: withdraw!", "good");
      // on the whistle everyone goes: the squads you are not leading make for the Old Town
      const east = zone(md, "exit_east");
      for (const sq of s.squads) {
        if (!sq || !sq.inPlay || sq.id === s.controlled) continue;
        const L = sim.leaderOf(sq);
        if (!L) continue;
        sq.order = "hold";
        sq.target = -1;
        goTo(sim, L, east.x + east.w / 2, east.y + east.h / 2 + (sq.id - 1) * 3, 20000);
      }
      return;
    }
    if ((car.state === "burning" || car.state === "wreck") && s.vars.carEscaped !== true && s.vars.carLost !== true) {
      s.vars.carLost = true;
      if (s.vars.loaded === true && rudy) rudy.state = "dead";
      failWith(sim, "The DKW is burning. Rudy cannot be got away.");
    }
  };

  const exitsTick = (sim: Sim) => {
    const s = sim.state;
    for (const u of s.units) {
      if (u.hidden || u.state !== "ok") continue;
      if (u.side === "pris" && u.tag !== "rudy") {
        if (exits.some((z) => inZone(z, u.x, u.y))) { u.hidden = true; u.flags |= UF_ESCAPED; }
      } else if (u.side === "pl" && u.squad >= 0 && s.vars.phase === "withdraw") {
        if (exits.some((z) => inZone(z, u.x, u.y))) {
          u.hidden = true;
          u.flags |= UF_ESCAPED;
          // prisoners at his heels go with him
          for (const q of s.units) if (q.side === "pris" && q.follow === u.id && !q.hidden && Math.hypot(q.x - u.x, q.y - u.y) < 8) { q.hidden = true; q.flags |= UF_ESCAPED; }
        }
      }
    }
  };

  const reinforcements = (sim: Sim) => {
    const a = since(sim);
    if (a < 0) return;
    const s = sim.state;
    const once = (key: string, at: number, fn: () => void) => { if (a >= at && s.vars[key] !== true) { s.vars[key] = true; fn(); } };
    once("r_west", lineCut ? 60 : 18, () => { if (!postSilenced) { sim.raiseAlarm(D_WEST, 12, DLUGA.n + 3); sim.message(lineCut ? "The wall police heard the shots at last." : "The police at the ghetto wall are coming!", "bad"); } });
    once("r_east", 22, () => { if (!gateSilenced || !truckDisabled) { sim.raiseAlarm(D_EAST, 200, 78); sim.message(gateSilenced ? "The truck's crew at Plac Krasińskich is up." : "Germans at the Arbeitsamt are shooting!", "bad"); } });
    once("r_north", 35, () => { spawnGroup(sim, path(md, "reinf_north"), ["de_officer", "de_rifle", "de_rifle"], D_NORTH, "north"); sim.message("Up Nalewki: an SS officer and two men.", "bad"); });
    once("r_south", bielAlert ? 40 : 100, () => { sim.raiseAlarm(D_SOUTH, BIEL.w + 6, 110); spawnGroup(sim, path(md, "reinf_south"), ["de_mp40", "de_mp40", "de_rifle"], D_SOUTH, "south"); sim.message("Schupo from Plac Teatralny!", "bad"); });
    once("r_warn", LATE - 60, () => sim.message("Gendarmerie with dogs are on their way. Get out!", "bad"));
    once("r_late", LATE, () => {
      spawnGroup(sim, path(md, "reinf_south"), ["de_mp40", "de_rifle", "de_rifle", "de_mp40"], D_SOUTH, "late");
      spawnGroup(sim, path(md, "reinf_north"), ["de_mp40", "de_rifle", "de_rifle"], D_NORTH, "late");
    });
  };

  const phase: Phase = {
    id: "finale",
    kind: "finale",
    title: "Akcja pod Arsenałem",
    place: "The Arsenal, Długa at Bielańska and Nalewki",
    time: "26 March 1943, 17:30",
    zone: "finale",
    light: "dusk",
    music: "finale",
    goCode: signal,

    setup(sim: Sim) {
      const s = sim.state;
      s.bounds = { x: Z.x, y: Z.y, w: Z.w, h: Z.h };
      s.missionId = "finale";
      let first = -1;
      for (let i = 0; i < SQUADS.length; i++) {
        if (c.benched.includes(i) || !fit(c, i).length) continue;
        if (first < 0) first = i;
        fieldFromCampaign(sim, c, i, POSTS[i].x, POSTS[i].y, POSTS[i].dir, first === i);
      }
      for (let i = 0; i < SQUADS.length; i++) if (!s.squads[i]) makeSquad(sim, i, SQUADS[i].name, SQUADS[i].colour);
      if (first >= 0) { s.controlled = first; s.squads[first].order = "follow"; }
      // the DKW and Jeremi at the corner of Długa and Bielańska
      const car = sim.spawnVehicle("car", BIEL.e + 5, DLUGA.s - 3.2, Math.PI, [], "dkw");
      const jeremi = sim.spawnUnit({ side: "pl", look: "jeremi", name: "Jeremi", realName: "Jerzy Zborowski", x: car.x, y: car.y, weapon: "pistol", hidden: true, tag: "jeremi", rank: 3 });
      car.crew = [jeremi.id];
      car.hp = 16;
      civilians(sim, 8,
        [{ x: 40, y: DLUGA.s - 1.5 }, { x: 150, y: DLUGA.n + 1.5 }, { x: 110, y: DLUGA.s - 1.5 }, { x: 180, y: DLUGA.s - 1.5 }, { x: NAL.w + 1, y: 40 }],
        [{ x: 64, y: DLUGA.s + 6 }, { x: 177.5, y: DLUGA.s + 6 }, { x: W - 1, y: DLUGA.n + 1.5 }]);
      if (!postSilenced) {
        const wy = GHETTO_WALL_Y + 4.2;
        guard(sim, PRZEJAZD.w + 2, wy, Math.PI / 2, { district: D_WEST, tag: "wall" });
        guard(sim, PRZEJAZD.e - 2, wy, Math.PI / 2, { district: D_WEST, tag: "wall" });
        sim.addSpawner({ x: (PRZEJAZD.w + PRZEJAZD.e) / 2, y: GHETTO_WALL_Y + 1.5, ox: 12, oy: DLUGA.n + 3, district: D_WEST, interval: 8, left: lineCut ? 2 : 5, maxAlive: 3, tag: "wall_post", look: "de_rifle" });
      }
      if (!gateSilenced) {
        guard(sim, 208, DLUGA.n + 1.4, Math.PI / 2 + 0.3, { district: D_EAST, tag: "gate" });
        guard(sim, 215, DLUGA.n + 1.4, Math.PI / 2 - 0.3, { district: D_EAST, tag: "gate" });
        sim.addSpawner({ x: 211.5, y: DLUGA.n - 1, ox: 211.5, oy: DLUGA.n + 4, district: D_EAST, interval: 6, left: 6, maxAlive: 3, tag: "arbeitsamt", look: "de_rifle" });
      }
      if (!truckDisabled) {
        sim.spawnVehicle("german_truck", W - 12, 80.5, Math.PI, [], "block");
        guard(sim, W - 16, 84, Math.PI, { district: D_EAST, tag: "block" });
        guard(sim, W - 9, 76.5, Math.PI + 0.3, { district: D_EAST, tag: "block" });
        guard(sim, W - 7, 84.5, Math.PI - 0.2, { district: D_EAST, tag: "block" });
      }
      if (bielAlert) {
        guard(sim, BIEL.w + 1, 150, -Math.PI / 2, { district: D_SOUTH, tag: "south" });
        guard(sim, BIEL.e - 1, 156, -Math.PI / 2, { district: D_SOUTH, tag: "south", look: "de_mp40" });
      }
      objective(sim, "stop", "Stop the van at the bend", true);
      objective(sim, "tailgate", "Open the tailgate", true);
      objective(sim, "rudy", "Get Rudy into the DKW", true);
      objective(sim, "escape", "The DKW gets away along Długa", true);
      objective(sim, "freed", `Freed prisoners reach safety: 0/${PRISONERS}`, false);
      s.vars.phase = "setup";
      if (signal) {
        s.signalReady = true;
        sim.message("Sygnalizacja is in place. Set your squads, then GO.", "good");
      } else {
        s.vars.autoVan = 22;
        sim.message("No signal chain today: the van will come without warning.", "bad");
      }
    },

    tick(sim: Sim) {
      const s = sim.state;
      if (s.outcome) return;
      if (s.vars.phase === "setup" && (s.signalGiven || (typeof s.vars.autoVan === "number" && s.time >= s.vars.autoVan))) {
        s.vars.phase = "approach";
        spawnVan(sim);
      }
      const van = vanOf(sim);
      if (van) vanTick(sim, van);
      if (s.outcome) return;
      reinforcements(sim);
      releaseTick(sim);
      const car = carOf(sim);
      if (car) carTick(sim, car);
      if (s.outcome) return;
      exitsTick(sim);
      const freed = s.units.filter((u) => u.side === "pris" && u.tag !== "rudy" && (u.flags & UF_ESCAPED)).length;
      const pObj = s.objectives.find((o) => o.id === "freed");
      if (pObj) pObj.text = `Freed prisoners reach safety: ${freed}/${PRISONERS}`;
      if (s.vars.phase === "withdraw") {
        const left = s.units.filter((u) => u.side === "pl" && u.squad >= 0 && u.state === "ok" && !u.hidden);
        if (!left.length || s.time - Number(s.vars.escapeT) > 150) {
          setObjective(sim, "withdraw", "done");
          if (freed > 0) setObjective(sim, "freed", "done");
          s.outcome = "success";
          sim.emit({ t: "phase", outcome: "success" });
          return;
        }
      }
      const active = s.units.some((u) => u.side === "pl" && u.squad >= 0 && u.state === "ok" && !u.hidden);
      if (!active && s.vars.phase !== "withdraw") failWith(sim, "Every squad is down.");
    },

    onEvent(sim: Sim, e: SimEvent) {
      const s = sim.state;
      if (e.t === "work" && e.done && e.what === "tailgate") openTailgate(sim);
      const van = vanOf(sim);
      if (!van || typeof s.vars.actionT === "number") return;
      // the driver is warned by a shot or a bottle bursting, not by a bottle still in the air
      if (e.t === "shot" || e.t === "bottle" || e.t === "explosion") {
        s.vars.actionT = s.time;
        sim.raiseAlarm(D_ESCORT, van.x, van.y);
        sim.message("Orsza's whistle: the action has begun!", "info");
      }
    },

    interactables(sim: Sim): Interactable[] {
      const s = sim.state;
      const out: Interactable[] = [];
      const van = vanOf(sim);
      if (van && s.vars.doorsOpened !== true && van.speed < 0.2 && (van.state !== "intact" || van.driverDead)) {
        const r = rearOf(van);
        out.push({
          id: "tailgate", x: r.x, y: r.y, r: 1.5, label: "Open the tailgate",
          ready: (q) => q.state.vars.doorsOpened !== true,
          act: (q) => { cmdWork(q, r.x, r.y, "tailgate", "van", 1.6, (u: Unit) => (u.tag === "kolczan" ? 40 : 0)); },
        });
      }
      const car = carOf(sim);
      if (car && s.vars.doorsOpened === true && s.vars.carCalled !== true) {
        out.push({ id: "dkw", x: car.x, y: car.y, r: 2.4, label: "Jeremi, bring the DKW!", ready: (q) => q.state.vars.carCalled !== true, act: callCar });
      }
      return out;
    },

    banner(sim: Sim) {
      const s = sim.state;
      if (s.vars.phase === "setup") return s.signalReady ? "Place the squads, then give the signal: GO" : `The van in ${Math.max(0, Math.ceil(Number(s.vars.autoVan) - s.time))} s`;
      if (s.vars.phase === "withdraw") return "Orsza's whistle: withdraw along Długa to the east";
      const a = since(sim);
      if (a > LATE - 70 && a < LATE) return `Gendarmerie in ${Math.ceil(LATE - a)} s`;
      return null;
    },

    start() {
      return { x: (NAL.e + BIEL.w) / 2, y: DLUGA.n + 4 };
    },

    finish(sim: Sim, cc: Campaign): FinaleResult {
      const s = sim.state;
      const fallen = recordSoldiers(sim, cc);
      const freed = s.units.filter((u) => u.side === "pris" && u.tag !== "rudy" && (u.flags & UF_ESCAPED)).length;
      const prisonersKilled = s.units.filter((u) => u.side === "pris" && u.state === "dead").length;
      const rudyU = s.units.find((u) => u.tag === "rudy");
      const rudy = s.vars.carEscaped === true ? "escaped" : rudyU?.state === "dead" ? "killed" : "lost";
      const germansKilled = s.units.filter((u) => u.side === "de" && u.state === "dead").length;
      return {
        outcome: rudy === "escaped" ? (fallen.length <= 2 ? "success" : "partial") : "fail",
        rudy, freed, prisonersKilled, fallen, germansKilled, seconds: s.time,
      };
    },
  };
  return phase;
}
