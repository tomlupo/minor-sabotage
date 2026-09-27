// The rules' clock. One Sim runs one phase (a task or the finale) on a fixed tick. The
// tactical pause stops this clock while drawing and input carry on (ADR-0001).
import { Grid, F_VEH } from "./grid";
import { PathFinder, type Pt } from "./path";
import { makeRng, rnd } from "./rng";
import { TICK, SPEED, WOUND } from "./tuning";
import type {
  GuardAI, Prop, SimEvent, SimState, Spawner, Squad, Unit, Vehicle, VehicleKind, WeaponId, Role, Side, PropKindSim,
} from "./types";
import { stepMovement, stepSquads, recordTrails } from "./move";
import { stepCombat, stepProjectiles, stepFires } from "./combat";
import { stepAI, stepSpawners, processNoises } from "./ai";
import { stepVehicles, rebuildVehicleCells } from "./vehicles";
import { stepTasks } from "./tasks";

export interface Mission {
  id: string;
  /** Called once when the phase starts (not on resume). */
  setup(sim: Sim): void;
  /** Objectives and triggers, every tick. */
  tick(sim: Sim, dt: number): void;
  /** Optional reaction to events (after systems ran this tick). */
  onEvent?(sim: Sim, e: SimEvent): void;
}

export interface SpawnOpts {
  side: Side;
  look: string;
  name?: string;
  realName?: string;
  x: number;
  y: number;
  dir?: number;
  squad?: number;
  rank?: number;
  role?: Role;
  weapon?: WeaponId;
  grenades?: number;
  bottles?: number;
  speed?: number;
  ai?: Partial<GuardAI> | null;
  tag?: string;
  hidden?: boolean;
}

export class Sim {
  readonly grid: Grid;
  readonly pf: PathFinder;
  state: SimState;
  mission: Mission | null = null;
  /** Noises heard this tick (processed by the AI, not serialised). */
  noises: { x: number; y: number; r: number; gun: boolean }[] = [];
  /** Street names by id, for messages ("Alek is down on Długa"). */
  streetNames: string[] = [];
  private acc = 0;

  constructor(grid: Grid, seed = 1943) {
    this.grid = grid;
    this.pf = new PathFinder(grid);
    this.state = {
      tick: 0,
      time: 0,
      rng: makeRng(seed),
      nextId: 1,
      units: [],
      vehicles: [],
      fires: [],
      projectiles: [],
      props: [],
      spawners: [],
      squads: [],
      controlled: 0,
      alarm: {},
      paused: false,
      events: [],
      objectives: [],
      signalGiven: false,
      signalReady: false,
      vars: {},
      outcome: null,
      bounds: { x: 0, y: 0, w: grid.w, h: grid.h },
      missionId: "",
    };
  }

  // ------------------------------------------------------------------ clock

  /** Advance by real elapsed seconds; runs whole ticks. Returns ticks run. */
  advance(realDt: number, speed = 1): number {
    if (this.state.paused || this.state.outcome) return 0;
    this.acc += Math.min(realDt, 0.25) * speed;
    let n = 0;
    while (this.acc >= TICK && n < 8) {
      this.step();
      this.acc -= TICK;
      n++;
    }
    return n;
  }

  /** Fraction of a tick since the last step, for render interpolation. */
  get alpha(): number {
    return Math.min(1, this.acc / TICK);
  }

  step(): void {
    const s = this.state;
    const dt = TICK;
    s.tick++;
    s.time += dt;
    for (const u of s.units) { u.px = u.x; u.py = u.y; u.animT += dt; if (u.animLock > 0) u.animLock -= dt; u.sinceShot += dt; }
    for (const v of s.vehicles) { v.px = v.x; v.py = v.y; }
    stepVehicles(this, dt);
    stepSquads(this, dt);
    stepTasks(this, dt);
    stepMovement(this, dt);
    recordTrails(this);
    stepAI(this, dt);
    stepCombat(this, dt);
    stepProjectiles(this, dt);
    stepFires(this, dt);
    processNoises(this);
    stepSpawners(this, dt);
    this.stepWounds(dt);
    this.ensureControl();
    this.mission?.tick(this, dt);
    if (this.mission?.onEvent) {
      // events emitted by the mission itself are not re-fed to avoid loops
      const evs = s.events.slice();
      for (const e of evs) this.mission.onEvent(this, e);
    }
  }

  /** If the squad you lead has nobody left standing, you take over one that has. */
  private ensureControl() {
    const s = this.state;
    const cur = s.squads[s.controlled];
    if (cur && this.leaderOf(cur)) return;
    for (const sq of s.squads) {
      if (!sq || !sq.inPlay || !this.leaderOf(sq)) continue;
      s.controlled = sq.id;
      sq.order = "follow";
      sq.signalRoute = null;
      this.message(`You lead ${sq.name}'s squad now.`, "info");
      return;
    }
  }

  private stepWounds(dt: number) {
    for (const u of this.state.units) {
      if (u.state !== "down") continue;
      u.downT -= dt;
      if (u.downT <= 0) this.kill(u, -1, false);
    }
  }

  // ------------------------------------------------------------------ events

  emit(e: SimEvent): void {
    this.state.events.push(e);
  }

  /** Renderer and audio take the events once per frame. */
  drainEvents(): SimEvent[] {
    const e = this.state.events;
    this.state.events = [];
    return e;
  }

  say(u: Unit, text: string, cooldown = 4): void {
    if (u.sayT > this.state.time) return;
    u.sayT = this.state.time + cooldown;
    this.emit({ t: "say", unit: u.id, text });
  }

  message(text: string, tone: "info" | "good" | "bad" = "info"): void {
    this.emit({ t: "message", text, tone });
  }

  noise(x: number, y: number, r: number, gun: boolean): void {
    this.noises.push({ x, y, r, gun });
    this.emit({ t: "noise", x, y, r });
  }

  rand(): number {
    return rnd(this.state.rng);
  }

  // ------------------------------------------------------------------ spawning

  spawnUnit(o: SpawnOpts): Unit {
    const s = this.state;
    const u: Unit = {
      id: s.nextId++,
      side: o.side,
      look: o.look,
      name: o.name ?? "",
      realName: o.realName,
      squad: o.squad ?? -1,
      rank: o.rank ?? 0,
      role: o.role ?? (o.side === "de" ? "guard" : o.side === "civ" ? "civilian" : o.side === "pris" ? "prisoner" : "sten"),
      weapon: o.weapon ?? "none",
      grenades: o.grenades ?? 0,
      bottles: o.bottles ?? 0,
      x: o.x,
      y: o.y,
      px: o.x,
      py: o.y,
      dir: o.dir ?? Math.PI / 2,
      speed: o.speed ?? (o.side === "pl" ? SPEED.partisan : o.side === "pris" ? SPEED.prisoner : o.side === "civ" ? SPEED.civilianWalk : SPEED.guardRun),
      state: "ok",
      wounded: false,
      downT: 0,
      helpT: 0,
      path: [],
      goalX: o.x,
      goalY: o.y,
      moving: false,
      anim: "idle",
      animT: 0,
      animLock: 0,
      fireCd: 0,
      burst: 0,
      target: -1,
      aimX: 0,
      aimY: 0,
      aiming: false,
      task: null,
      ai: null,
      glyph: "none",
      follow: -1,
      hidden: o.hidden ?? false,
      kills: 0,
      sinceShot: 99,
      shotBy: -1,
      shotByT: -99,
      flags: 0,
      tag: o.tag ?? "",
      sayT: 0,
    };
    if (o.ai !== undefined && o.ai !== null) {
      u.ai = {
        mode: "post",
        route: null,
        routeI: 0,
        wait: 0,
        homeX: o.x,
        homeY: o.y,
        homeDir: o.dir ?? Math.PI / 2,
        sweep: 0,
        sweepT: rnd(s.rng) * 6,
        meter: 0,
        lastX: o.x,
        lastY: o.y,
        lastT: -99,
        react: 0.6,
        coneR: 14,
        coneHalf: 0.58,
        whistleT: -1,
        district: 0,
        repath: 0,
        blind: false,
        ...o.ai,
      };
    }
    s.units.push(u);
    this.emit({ t: "spawn", unit: u.id });
    return u;
  }

  spawnVehicle(kind: VehicleKind, x: number, y: number, heading: number, route: Pt[] = [], tag = ""): Vehicle {
    const dims: Record<VehicleKind, [number, number, number, number]> = {
      prison_truck: [6.5, 2.3, 22, 9],
      car: [4.5, 1.8, 14, 11],
      german_truck: [6.0, 2.3, 24, 8.5],
      tram: [11, 2.2, 60, 5],
    };
    const [len, wid, hp, maxSpeed] = dims[kind];
    const v: Vehicle = {
      id: this.state.nextId++, kind, x, y, px: x, py: y, heading, speed: 0, maxSpeed, route, routeI: 0,
      state: "intact", hp, burnT: 0, len, wid, crew: [], stopped: route.length === 0, driverDead: false, tag, holdAt: -1, doorsOpen: false,
    };
    this.state.vehicles.push(v);
    rebuildVehicleCells(this);
    return v;
  }

  addProp(kind: PropKindSim, x: number, y: number, o: Partial<Prop> = {}): Prop {
    const p: Prop = {
      id: this.state.nextId++, kind, state: "intact", x, y, variant: "", bx: 0, by: 0, bw: 0, bh: 0, blocks: false, hp: 3, tag: "", ...o,
    };
    this.state.props.push(p);
    return p;
  }

  addSpawner(o: Partial<Spawner> & { x: number; y: number; ox: number; oy: number }): Spawner {
    const sp: Spawner = {
      id: this.state.nextId++, district: 1, active: false, cd: 2, interval: 7, left: 6, maxAlive: 3, destroyed: false, tag: "", look: "de_rifle", ...o,
    };
    this.state.spawners.push(sp);
    return sp;
  }

  // ------------------------------------------------------------------ queries

  unit(id: number): Unit | undefined {
    // units are appended with rising ids; a binary search keeps this cheap
    const a = this.state.units;
    let lo = 0, hi = a.length - 1;
    while (lo <= hi) {
      const m = (lo + hi) >> 1;
      if (a[m].id === id) return a[m];
      if (a[m].id < id) lo = m + 1; else hi = m - 1;
    }
    return undefined;
  }

  vehicle(id: number): Vehicle | undefined {
    return this.state.vehicles.find((v) => v.id === id);
  }

  alive(u: Unit | undefined): u is Unit {
    return !!u && u.state !== "dead" && !u.hidden;
  }

  /** Able to act: alive, on the street and not lying wounded. */
  active(u: Unit | undefined): u is Unit {
    return !!u && u.state === "ok" && !u.hidden;
  }

  squad(i: number): Squad | undefined {
    return this.state.squads[i];
  }

  leaderOf(sq: Squad): Unit | undefined {
    for (const id of sq.members) {
      const u = this.unit(id);
      if (this.active(u)) return u;
    }
    return undefined;
  }

  membersOf(sq: Squad): Unit[] {
    const out: Unit[] = [];
    for (const id of sq.members) {
      const u = this.unit(id);
      if (u && u.state !== "dead" && !u.hidden) out.push(u);
    }
    return out;
  }

  get controlledSquad(): Squad | undefined {
    return this.state.squads[this.state.controlled];
  }

  unitsNear(x: number, y: number, r: number, pred?: (u: Unit) => boolean): Unit[] {
    const r2 = r * r;
    return this.state.units.filter((u) => u.state !== "dead" && !u.hidden && (u.x - x) ** 2 + (u.y - y) ** 2 <= r2 && (!pred || pred(u)));
  }

  inBounds(x: number, y: number): boolean {
    const b = this.state.bounds;
    return x >= b.x && y >= b.y && x < b.x + b.w && y < b.y + b.h;
  }

  /** Route within the phase's bounds. */
  route(from: Pt, to: Pt, maxNodes = 12000): Pt[] | null {
    const b = this.state.bounds;
    const clamp = (p: Pt) => ({ x: Math.min(b.x + b.w - 0.5, Math.max(b.x + 0.5, p.x)), y: Math.min(b.y + b.h - 0.5, Math.max(b.y + 0.5, p.y)) });
    const G = this.grid;
    const full = b.x === 0 && b.y === 0 && b.w === G.w && b.h === G.h;
    return this.pf.find(from, clamp(to), maxNodes, full ? undefined : (cx, cy) => (this.inBounds(cx + 0.5, cy + 0.5) ? 0 : 1e6));
  }

  // ------------------------------------------------------------------ harm

  /** One hit landed on `u`, fired by unit `by` (-1: fire, explosion). */
  hurt(u: Unit, by: number, cause: "bullet" | "blast" | "fire" | "knife" = "bullet"): void {
    if (u.state === "dead" || u.hidden) return;
    const s = this.state;
    u.shotBy = by;
    u.shotByT = s.time;
    this.emit({ t: "hit", unit: u.id, x: u.x, y: u.y });
    if (cause === "knife") return this.kill(u, by, true);
    if (u.state === "down") return this.kill(u, by, false);
    const vet = u.side === "pl" && u.rank >= WOUND.vetRank && !u.wounded && cause !== "blast";
    if (vet) {
      u.state = "down";
      u.downT = WOUND.bleedOut;
      u.helpT = 0;
      u.path = [];
      u.moving = false;
      u.task = null;
      u.anim = "prone";
      u.animT = 0;
      u.glyph = "wounded";
      this.emit({ t: "down", unit: u.id, x: u.x, y: u.y });
      this.emit({ t: "glyph", unit: u.id, glyph: "wounded" });
      const sq = this.squad(u.squad);
      if (sq && u.squad !== s.controlled && sq.inPlay) {
        const street = this.streetNames[this.grid.streetAt(u.x, u.y)] ?? "the street";
        this.emit({ t: "pause", reason: `${u.name} is down on ${street}`, unit: u.id, x: u.x, y: u.y });
        s.paused = true;
      }
      return;
    }
    this.kill(u, by, false);
  }

  kill(u: Unit, by: number, silent: boolean): void {
    if (u.state === "dead") return;
    u.state = "dead";
    u.path = [];
    u.moving = false;
    u.task = null;
    u.anim = "death";
    u.animT = 0;
    u.glyph = "none";
    if (silent) u.flags |= 1;
    const k = this.unit(by);
    if (k) k.kills++;
    this.emit({ t: "death", unit: u.id, x: u.x, y: u.y, silent });
    if (!silent) this.noise(u.x, u.y, 9, false);
    const sq = this.squad(u.squad);
    if (sq && u.squad !== this.state.controlled && sq.inPlay && u.side === "pl" && u.rank >= WOUND.vetRank) {
      const street = this.streetNames[this.grid.streetAt(u.x, u.y)] ?? "the street";
      this.emit({ t: "pause", reason: `${u.name} has fallen on ${street}`, unit: u.id, x: u.x, y: u.y });
      this.state.paused = true;
    }
  }

  // ------------------------------------------------------------------ alarm

  alarmUp(district: number): boolean {
    return (this.state.alarm[district] ?? -1) >= 0;
  }

  raiseAlarm(district: number, x: number, y: number): void {
    if (this.alarmUp(district)) return;
    this.state.alarm[district] = this.state.time;
    this.emit({ t: "alarm", district, x, y });
    for (const u of this.state.units) {
      if (!u.ai || u.state !== "ok" || u.ai.district !== district || u.ai.blind) continue;
      if (u.ai.mode !== "alert") {
        u.ai.mode = "alert";
        u.ai.lastX = x;
        u.ai.lastY = y;
        u.ai.lastT = this.state.time;
        u.ai.react = 0.4 + this.rand() * 0.6;
        u.glyph = "alert";
        this.emit({ t: "glyph", unit: u.id, glyph: "alert" });
      }
    }
    for (const sp of this.state.spawners) if (sp.district === district && !sp.destroyed) sp.active = true;
  }

  anyAlarm(): boolean {
    return Object.values(this.state.alarm).some((t) => t >= 0);
  }

  // ------------------------------------------------------------------ snapshot

  snapshot(): string {
    return JSON.stringify(this.state);
  }

  restore(json: string): void {
    this.state = JSON.parse(json) as SimState;
    for (let i = 0; i < this.grid.flags.length; i++) this.grid.flags[i] &= ~F_VEH;
    rebuildVehicleCells(this);
  }
}
