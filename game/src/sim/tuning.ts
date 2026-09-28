// Every number that decides how the game feels, in one place. Distances in metres, times in
// seconds. The view is about 47 m across (26 soldier-heights), so ranges stay on screen.
import type { WeaponId } from "./types";

export const TICK = 1 / 30;

export interface WeaponSpec {
  range: number;
  /** Seconds between rounds within a burst. */
  cadence: number;
  /** Rounds per burst (1 = single shots). */
  burst: number;
  /** Seconds between bursts. */
  reload: number;
  /** Spread in radians for a rank-0 shooter; each rank narrows it. */
  spread: number;
  /** How far the shot is heard. */
  noise: number;
}

export const WEAPONS: Record<WeaponId, WeaponSpec> = {
  sten: { range: 19, cadence: 0.085, burst: 4, reload: 0.55, spread: 0.13, noise: 38 },
  pistol: { range: 16, cadence: 0.4, burst: 1, reload: 0.4, spread: 0.1, noise: 28 },
  rifle: { range: 22, cadence: 2.0, burst: 1, reload: 2.0, spread: 0.055, noise: 55 },
  mp40: { range: 19, cadence: 0.11, burst: 3, reload: 1.1, spread: 0.14, noise: 40 },
  none: { range: 0, cadence: 1, burst: 0, reload: 1, spread: 0, noise: 0 },
};

/** German fire is wilder: surprised, at dusk, at people who move (a balance choice). */
export const GERMAN_SPREAD = 2.4;

/** Rank narrows the spread: rank 7 shoots with about half the spread of a rookie. */
export const spreadForRank = (w: WeaponSpec, rank: number) => w.spread * (1 - Math.min(rank, 7) * 0.07);

/**
 * The phone shows about 47 m across and 29 m into the screen (568 × 262 art px at 12 and 9 px a
 * metre), so a range drawn as a circle would reach off the top and bottom of the view. Ranges
 * are measured on the view's own ellipse instead: into the screen they reach VIEW_DEPTH of what
 * they reach across (14.6 / 23.7 m, the view's half-extents), which keeps every shooter on
 * screen. Vault decision: ranges counted in soldier heights, so nothing fires from off-screen.
 */
export const VIEW_DEPTH = 0.62;

/** Distance as ranges count it: metres across, stretched into the screen by 1 / VIEW_DEPTH. */
export const reach = (dx: number, dy: number) => Math.hypot(dx, dy / VIEW_DEPTH);

export const SPEED = {
  partisan: 3.1,
  partisanWounded: 2.3,
  guardPatrol: 1.25,
  guardRun: 2.7,
  prisoner: 2.2,
  civilianWalk: 1.1,
  civilianFlee: 3.2,
};

export const UNIT_RADIUS = 0.34;

export const DETECT = {
  coneR: 14,
  coneHalf: 0.58, // about 33 degrees either side
  /** Closer than this and the guard notices you outside his cone too, unless you come from
   *  behind (more than touchHalf off his facing): the knife approach. */
  touch: 1.5,
  touchHalf: 1.75,
  /** Base fill rate per second at the edge of the cone; it grows as you get closer. */
  rate: 0.55,
  closeBoost: 2.6,
  movingMul: 1.35,
  stillMul: 0.7,
  firingMul: 4,
  decay: 0.22,
  suspicious: 0.34,
  /** Seconds between the whistle and the district alarm. */
  whistleDelay: 1.1,
  bodyNotice: 11,
};

export const WOUND = {
  /** From this rank a trooper goes down wounded instead of dying (style guide / decision Y). */
  vetRank: 3,
  bleedOut: 11,
  helpTime: 1.8,
};

export const THROW = {
  range: 17,
  wind: 0.3,
  flightPerM: 0.045,
  grenadeKill: 2.4,
  grenadeHurt: 3.8,
  bottleR: 2.1,
  bottleBurn: 8,
};

export const KNIFE = {
  reach: 0.95,
  strike: 0.35,
};

export const SQUAD = {
  spacing: 1.15,
  trailStep: 0.5,
};

export const VEHICLE_HIT = { truck: 22, car: 14, german_truck: 24, tram: 60 };
