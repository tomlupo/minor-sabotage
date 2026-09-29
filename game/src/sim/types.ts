// The rules' data. Everything here is plain, serialisable state: a JSON snapshot of it plus
// the map is the whole game, which is what the one-time resume after a locked phone needs.
import type { Pt } from "./path";
import type { RngState } from "./rng";

export type Side = "pl" | "de" | "civ" | "pris";
export type UnitState = "ok" | "down" | "dead";
export type Role = "leader" | "sten" | "pistol" | "bottles" | "grenades" | "scout" | "sapper" | "driver" | "guard" | "officer" | "civilian" | "prisoner";
export type WeaponId = "sten" | "pistol" | "rifle" | "mp40" | "none";
export type AnimName = "idle" | "walk" | "fire" | "throw" | "death" | "prone" | "knife" | "kneel";
export type Glyph = "none" | "alert" | "suspicious" | "wounded" | "knife";

export type UnitTask =
  | { kind: "knife"; target: number; t: number; phase: "approach" | "strike" }
  | { kind: "throw"; what: "grenade" | "bottle"; x: number; y: number; t: number; phase: "approach" | "wind"; veh?: number }
  | { kind: "work"; what: string; ref: string; x: number; y: number; t: number; dur: number; phase: "approach" | "work" }
  | { kind: "help"; target: number; t: number; phase: "approach" | "work" };

export type AiMode = "post" | "patrol" | "suspicious" | "search" | "alert" | "flee" | "crew" | "idle";

export interface GuardAI {
  mode: AiMode;
  route: Pt[] | null;
  routeI: number;
  wait: number;
  homeX: number;
  homeY: number;
  homeDir: number;
  /** Idle head sweep: the cone turns around the home direction. */
  sweep: number;
  sweepT: number;
  /** Detection, 0..1: at 1 the guard has seen you. */
  meter: number;
  lastX: number;
  lastY: number;
  lastT: number;
  react: number;
  coneR: number;
  coneHalf: number;
  whistleT: number;
  district: number;
  repath: number;
  /** Cannot see (crew inside a vehicle). */
  blind: boolean;
  /** Walking pace on his round, m/s, when not the patrols’ own (a pair keeping step on rounds of two lengths). */
  pace?: number;
  /** Seconds he stops at each corner of his round, when not his own (a pair stops together). */
  pause?: number;
  /** Fights where he stands and never advances (the guards at the tailgate). */
  stay?: boolean;
}

export interface Unit {
  id: number;
  side: Side;
  /** Key into the look table the renderer builds sprites from. */
  look: string;
  name: string;
  realName?: string;
  squad: number;
  rank: number;
  role: Role;
  weapon: WeaponId;
  grenades: number;
  bottles: number;
  x: number;
  y: number;
  /** Position at the previous tick (the renderer interpolates). */
  px: number;
  py: number;
  dir: number;
  speed: number;
  state: UnitState;
  /** Took a hit and got up again: the next hit kills. */
  wounded: boolean;
  downT: number;
  helpT: number;
  path: Pt[];
  goalX: number;
  goalY: number;
  moving: boolean;
  anim: AnimName;
  animT: number;
  animLock: number;
  fireCd: number;
  burst: number;
  /** Locked target (unit id) or -1. */
  target: number;
  aimX: number;
  aimY: number;
  aiming: boolean;
  task: UnitTask | null;
  ai: GuardAI | null;
  glyph: Glyph;
  /** Prisoners and civilians: the unit they follow, or -1. */
  follow: number;
  /** Until this time he is stepping out of a vehicle's way: his column or the man he
   *  follows does not call him back. */
  yieldUntil: number;
  /** Removed from the street: inside a vehicle, escaped, evacuated. */
  hidden: boolean;
  kills: number;
  /** Seconds since this unit last fired (loudness, detection). */
  sinceShot: number;
  /** Who last shot at this unit (for return fire), and when. */
  shotBy: number;
  shotByT: number;
  flags: number;
  /** Mission tag ("rudy", "driver", "escort"...). */
  tag: string;
  sayT: number;
}

export const UF_SILENT_DEATH = 1; // killed by a knife: no noise
export const UF_ESCAPED = 2;
export const UF_CAPTURED = 4;
export const UF_EVACUATED = 8;
/** At his post in plain clothes: a man standing at a kerb, not a partisan to the Germans (the signal
 *  section on 26 March 1943). Cleared when he is sent anywhere. */
export const UF_POSTED = 16;

export type SquadOrder = "follow" | "hold" | "cover" | "signal";

export interface Squad {
  id: number;
  /** The leader's nom de guerre: the squad is named after him. */
  name: string;
  members: number[];
  order: SquadOrder;
  holdX: number;
  holdY: number;
  coverDir: number;
  coverHalf: number;
  signalRoute: Pt[] | null;
  /** Breadcrumbs of the leader, newest first, about 0.5 m apart. */
  trail: Pt[];
  inPlay: boolean;
  /** Current fire target (unit id) for the squad, or -1. */
  target: number;
  /** Fire at a point (FIRE held) until the given time. */
  fireAtX: number;
  fireAtY: number;
  fireUntil: number;
  /** Pause-planned order not yet applied (one per team per pause). */
  plannedThisPause: boolean;
  /** Where and which way the leader stopped: the squad forms up around it. */
  restX: number;
  restY: number;
  restDir: number;
  /** Colour index 0..2 (hud.squads). */
  colour: number;
}

export type VehicleKind = "prison_truck" | "car" | "german_truck" | "tram";
export type VehicleState = "intact" | "burning" | "wreck" | "doors_open";

export interface Vehicle {
  id: number;
  kind: VehicleKind;
  x: number;
  y: number;
  px: number;
  py: number;
  /** Radians, screen convention: 0 east, +pi/2 south. */
  heading: number;
  speed: number;
  maxSpeed: number;
  route: Pt[];
  routeI: number;
  state: VehicleState;
  hp: number;
  burnT: number;
  len: number;
  wid: number;
  /** Units inside (hidden). */
  crew: number[];
  stopped: boolean;
  driverDead: boolean;
  tag: string;
  /** Where on its route to stop and wait (index), or -1. */
  holdAt: number;
  doorsOpen: boolean;
  /** Backing along its route: it keeps its heading and moves tail first (the DKW did). */
  reverse: boolean;
  /** Seconds it has stood blocked by people in its way. */
  blockedT: number;
}

export interface Fire {
  id: number;
  x: number;
  y: number;
  r: number;
  t: number;
}

export interface Projectile {
  id: number;
  kind: "grenade" | "bottle";
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  t: number;
  dur: number;
  owner: number;
}

export type PropKindSim =
  | "phone_pole" | "phone_box" | "barrel" | "crates" | "kiosk" | "lamp" | "ad_column" | "bench" | "tree"
  | "sandbags" | "barrier" | "cart" | "hydrant" | "tram_stop" | "street_sign" | "snow_heap" | "dorozka"
  | "ghetto_wall" | "bin" | "gate"
  // a fallen man's gear on the ground: anyone of ours who walks over it takes it
  | "kit";

export interface Prop {
  id: number;
  kind: PropKindSim;
  state: "intact" | "destroyed" | "burning";
  x: number;
  y: number;
  variant: string;
  /** Footprint it blocks, in metres (NW corner and size), or null. */
  bx: number;
  by: number;
  bw: number;
  bh: number;
  blocks: boolean;
  hp: number;
  tag: string;
  /** A fallen man's kit: what the first of ours to walk over it takes. */
  contents?: { grenades: number; bottles: number; sten: boolean; owner: string };
}

/** Fodder's huts: a guard post or barracks door that sends soldiers once the alarm is up. */
export interface Spawner {
  id: number;
  x: number;
  y: number;
  /** Where spawned soldiers step out to. */
  ox: number;
  oy: number;
  district: number;
  active: boolean;
  cd: number;
  interval: number;
  /** Men it still sends; -1: it sends them until it is blown up (vault decision, Fodder's huts). */
  left: number;
  maxAlive: number;
  destroyed: boolean;
  tag: string;
  look: string;
}

export type SimEvent =
  | { t: "shot"; x0: number; y0: number; x1: number; y1: number; weapon: WeaponId; side: Side; by: number; hit: number }
  | { t: "hit"; unit: number; x: number; y: number; vehicle?: number }
  | { t: "death"; unit: number; x: number; y: number; silent: boolean }
  | { t: "down"; unit: number; x: number; y: number }
  | { t: "up"; unit: number }
  | { t: "explosion"; x: number; y: number; r: number }
  | { t: "bottle"; x: number; y: number }
  | { t: "throw"; unit: number; kind: "grenade" | "bottle"; x: number; y: number }
  | { t: "fire"; id: number; x: number; y: number; on: boolean }
  | { t: "knife"; unit: number; target: number }
  | { t: "alarm"; district: number; x: number; y: number }
  | { t: "whistle"; unit: number; x: number; y: number }
  | { t: "glyph"; unit: number; glyph: Glyph }
  | { t: "prop"; id: number; state: Prop["state"] }
  | { t: "vehicle"; id: number; state: VehicleState }
  | { t: "brake"; id: number }
  | { t: "objective"; id: string; status: ObjectiveStatus }
  | { t: "say"; unit: number; text: string }
  | { t: "pause"; reason: string; unit: number; x: number; y: number }
  | { t: "phase"; outcome: PhaseOutcome }
  | { t: "noise"; x: number; y: number; r: number }
  | { t: "spawn"; unit: number }
  | { t: "work"; unit: number; what: string; done: boolean }
  | { t: "message"; text: string; tone: "info" | "good" | "bad" };

export type ObjectiveStatus = "open" | "done" | "failed";
export interface Objective {
  id: string;
  text: string;
  status: ObjectiveStatus;
  primary: boolean;
  /** Where to point the player (optional marker). */
  x?: number;
  y?: number;
}

export type PhaseOutcome = "success" | "partial" | "fail";

export interface SimState {
  tick: number;
  time: number;
  rng: RngState;
  nextId: number;
  units: Unit[];
  vehicles: Vehicle[];
  fires: Fire[];
  projectiles: Projectile[];
  props: Prop[];
  spawners: Spawner[];
  squads: Squad[];
  /** The squad the player is leading. */
  controlled: number;
  /** The man picked on the portrait strip: he acts alone and the column leaves him be, or -1. */
  picked: number;
  /** Alarm per district bit: time it was raised, or -1. */
  alarm: Record<number, number>;
  paused: boolean;
  events: SimEvent[];
  objectives: Objective[];
  /** The go-code: squads with a "signal" order start their routes. */
  signalGiven: boolean;
  signalReady: boolean;
  /** Mission-scripted flags and counters, free-form but serialisable. */
  vars: Record<string, number | string | boolean>;
  outcome: PhaseOutcome | null;
  /** Play-area bounds in metres; units never path outside. */
  bounds: { x: number; y: number; w: number; h: number };
  missionId: string;
}
