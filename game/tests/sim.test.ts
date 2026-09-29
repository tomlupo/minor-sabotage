import { describe, expect, it } from "vitest";
import { Grid, F_SIGHT, F_WALK } from "../src/sim/grid";
import { Sim } from "../src/sim/sim";
import { makeSquad, fieldSquad } from "../src/sim/setup";
import { cmdMove, cmdTapEnemy, cmdThrow, cmdHelp, cmdSelectSquad, cmdOrder, cmdPick, cmdWork } from "../src/sim/commands";
import { goTo } from "../src/sim/move";
import { SPEED, THROW } from "../src/sim/tuning";
import { buildArsenalMap } from "../src/content/arsenal/map";
import { gridFromMap } from "../src/content/mapdata";

/** An open 60 x 40 m yard with a wall across the middle, gap at the north end. */
function yard(): Grid {
  const G = new Grid(60, 40);
  G.flags.fill(F_WALK);
  for (let y = 6; y < 40; y++) G.flags[y * 60 + 30] = F_SIGHT; // wall x=30, gap at y<6
  for (let x = 0; x < 60; x++) { G.flags[x] = F_SIGHT; G.flags[39 * 60 + x] = F_SIGHT; }
  for (let y = 0; y < 40; y++) { G.flags[y * 60] = F_SIGHT; G.flags[y * 60 + 59] = F_SIGHT; }
  return G;
}

const TROOPER = { look: "pl", weapon: "sten" as const, rank: 1 };

function run(sim: Sim, seconds: number, until?: () => boolean) {
  const n = Math.round(seconds * 30);
  for (let i = 0; i < n; i++) {
    sim.state.paused = false; // tests ignore auto-pauses unless they check them
    sim.step();
    if (until && until()) return i;
  }
  return n;
}

function squadOf4(sim: Sim, x: number, y: number) {
  const sq = makeSquad(sim, 0, "Zośka", 0);
  const us = fieldSquad(sim, sq, [
    { ...TROOPER, name: "Zośka", rank: 5, grenades: 2 },
    { ...TROOPER, name: "Alek", rank: 4, bottles: 2 },
    { ...TROOPER, name: "Rudy", rank: 3 },
    { ...TROOPER, name: "Anoda", rank: 3 },
  ], x, y, 0);
  sq.order = "follow";
  sim.state.controlled = 0;
  return { sq, us };
}

describe("grid", () => {
  it("line of sight stops at walls", () => {
    const G = yard();
    expect(G.los(10, 20, 20, 20)).toBe(true);
    expect(G.los(10, 20, 40, 20)).toBe(false);
    expect(G.los(10, 3, 40, 3)).toBe(true);
    expect(G.rayDist(10.5, 20.5, 0, 50)).toBeCloseTo(19.5, 0);
  });
});

describe("route finding", () => {
  it("walks round the wall through the gap", () => {
    const sim = new Sim(yard());
    const r = sim.route({ x: 10, y: 30 }, { x: 50, y: 30 })!;
    expect(r).not.toBeNull();
    expect(r[r.length - 1]).toEqual({ x: 50, y: 30 });
    // must pass through the gap at the north end
    expect(r.some((p) => p.y < 7 && Math.abs(p.x - 30) < 3)).toBe(true);
    // string-pulled: a handful of waypoints, not a staircase
    expect(r.length).toBeLessThan(8);
  });
});

describe("squad", () => {
  it("follows its leader round a corner and forms up without stacking", () => {
    const sim = new Sim(yard());
    const { us } = squadOf4(sim, 10, 30);
    expect(cmdMove(sim, 48, 30)).toBe(true);
    run(sim, 30);
    for (const u of us) expect(Math.hypot(u.x - 48, u.y - 30)).toBeLessThan(3.2);
    for (let i = 0; i < us.length; i++)
      for (let j = i + 1; j < us.length; j++) expect(Math.hypot(us[i].x - us[j].x, us[i].y - us[j].y)).toBeGreaterThan(0.45);
  });
});

describe("guards and the alarm", () => {
  it("a trooper walking into a cone brings the whistle, then the district alarm", () => {
    const sim = new Sim(yard());
    const { us } = squadOf4(sim, 5, 20);
    const g = sim.spawnUnit({ side: "de", look: "de", x: 20, y: 20, dir: Math.PI, weapon: "rifle", ai: { district: 1 } });
    cmdMove(sim, 12, 20);
    const events: string[] = [];
    for (let i = 0; i < 30 * 8; i++) { sim.step(); for (const e of sim.drainEvents()) events.push(e.t); }
    expect(g.ai!.mode).toBe("alert");
    expect(events).toContain("whistle");
    expect(sim.alarmUp(1)).toBe(true);
    expect(us.length).toBe(4);
  });

  it("a knife from behind is silent: no whistle, no alarm", () => {
    const sim = new Sim(yard());
    squadOf4(sim, 8, 20);
    // the guard looks east, away from the squad
    const g = sim.spawnUnit({ side: "de", look: "de", x: 20, y: 20, dir: 0, weapon: "rifle", ai: { district: 1 } });
    expect(cmdTapEnemy(sim, g.id)).toBe("knife");
    const events: string[] = [];
    run(sim, 10, () => { for (const e of sim.drainEvents()) events.push(e.t); return g.state === "dead"; });
    expect(g.state).toBe("dead");
    expect(events).toContain("knife");
    expect(events).not.toContain("whistle");
    expect(sim.alarmUp(1)).toBe(false);
  });

  it("fire on a tapped enemy until he drops", () => {
    const sim = new Sim(yard());
    squadOf4(sim, 8, 20);
    const g = sim.spawnUnit({ side: "de", look: "de", x: 20, y: 20, dir: Math.PI, weapon: "rifle", ai: { district: 1, mode: "alert" } });
    expect(cmdTapEnemy(sim, g.id)).toBe("fire");
    run(sim, 6, () => g.state === "dead");
    expect(g.state).toBe("dead");
  });
});

describe("wounds", () => {
  it("a veteran goes down, is helped up wounded, and the next hit kills him", () => {
    const sim = new Sim(yard());
    const { us } = squadOf4(sim, 8, 20);
    const alek = us[1];
    sim.hurt(alek, -1);
    expect(alek.state).toBe("down");
    expect(cmdHelp(sim, alek.id)).not.toBeNull();
    run(sim, 5, () => alek.state === "ok");
    expect(alek.state).toBe("ok");
    expect(alek.wounded).toBe(true);
    // decision 2026-09-27: fighting on wounded, one more hit kills him
    sim.hurt(alek, -1);
    expect(alek.state).toBe("dead");
  });

  it("left alone, a downed veteran bleeds out", () => {
    const sim = new Sim(yard());
    const { us } = squadOf4(sim, 8, 20);
    sim.hurt(us[2], -1);
    run(sim, 13);
    expect(us[2].state).toBe("dead");
  });
});

describe("throwing and vehicles", () => {
  it("a petrol bottle on the truck stops it, sets it alight, and the escort bails out", () => {
    const sim = new Sim(yard());
    squadOf4(sim, 12, 10);
    const truck = sim.spawnVehicle("prison_truck", 20, 20, 0, [{ x: 28, y: 20 }, { x: 28, y: 36 }]);
    truck.route = [{ x: 26, y: 20 }];
    const driver = sim.spawnUnit({ side: "de", look: "de", x: 20, y: 20, weapon: "pistol", hidden: true, ai: { blind: true, mode: "crew" } });
    const escort = sim.spawnUnit({ side: "de", look: "de", x: 20, y: 20, weapon: "rifle", hidden: true, ai: { blind: true, mode: "crew" } });
    truck.crew = [driver.id, escort.id];
    // throw at where the truck will be
    expect(cmdThrow(sim, 23, 20, "bottle")).not.toBeNull();
    run(sim, 6);
    expect(["burning", "wreck"]).toContain(truck.state);
    expect(truck.speed).toBeLessThan(0.1);
    expect(escort.hidden).toBe(false);
  });
});

describe("orders", () => {
  it("switching squads leaves the old one holding; a cover cone fires on its own", () => {
    const sim = new Sim(yard());
    squadOf4(sim, 8, 20);
    const sq2 = makeSquad(sim, 1, "Giewont", 1);
    fieldSquad(sim, sq2, [{ ...TROOPER, name: "Giewont" }, { ...TROOPER, name: "B" }], 10, 30, 0);
    expect(cmdSelectSquad(sim, 1)).toBe(true);
    expect(sim.state.squads[0].order).toBe("hold");
    expect(cmdOrder(sim, 0, "cover", { dir: 0, half: 0.6 })).toBe(true);
    const g = sim.spawnUnit({ side: "de", look: "de", x: 20, y: 20, dir: Math.PI / 2, weapon: "rifle", ai: { district: 1 } });
    goTo(sim, g, 22, 20);
    run(sim, 6, () => g.state === "dead");
    expect(g.state).toBe("dead");
  });
});

describe("snapshot", () => {
  it("resuming from a snapshot replays exactly", () => {
    const make = () => {
      const sim = new Sim(yard(), 7);
      squadOf4(sim, 8, 20);
      sim.spawnUnit({ side: "de", look: "de", x: 24, y: 22, dir: Math.PI, weapon: "rifle", ai: { district: 1, mode: "alert" } });
      cmdMove(sim, 20, 10);
      return sim;
    };
    const a = make();
    run(a, 3);
    const snap = a.snapshot();
    run(a, 4);
    const b = make();
    b.restore(snap);
    run(b, 4);
    const pick = (s: Sim) => s.state.units.map((u) => [u.id, u.state, u.x.toFixed(4), u.y.toFixed(4)]);
    expect(pick(b)).toEqual(pick(a));
  });
});

describe("fire on the street", () => {
  // a fire is a pause, not a wall: nobody steps into burning petrol; a man waits at its edge
  // until it burns out, and a man it catches walks clear of it (move.ts entersFire, wayOutOfFire)
  const HARM = (r: number) => r * 0.8;

  it("is waited out at its edge, never walked through", () => {
    const sim = new Sim(yard());
    const u = sim.spawnUnit({ side: "pl", look: "pl", x: 10, y: 20, weapon: "sten" });
    sim.state.fires.push({ id: 999, x: 15, y: 20, r: 2, t: 3 });
    goTo(sim, u, 20, 20);
    let closest = Infinity, waiting = false;
    for (let i = 0; i < 30 * 10; i++) {
      sim.step();
      if (sim.state.fires.length) closest = Math.min(closest, Math.hypot(u.x - 15, u.y - 20));
      // two seconds in he has reached its edge: he stands there, not treading in and out of it
      if (i === 60) waiting = !u.moving;
    }
    expect(waiting).toBe(true);
    expect(closest).toBeGreaterThan(HARM(2));
    expect(u.state === "ok" && !u.wounded).toBe(true);
    expect(Math.hypot(u.x - 20, u.y - 20)).toBeLessThan(1); // it burnt out and he went on
  });

  it("lit ahead of a column already walking, stops it at the edge, and it goes on", () => {
    const sim = new Sim(yard());
    const { us } = squadOf4(sim, 6, 20);
    cmdMove(sim, 26, 20);
    run(sim, 1);
    // a bottle bursts on the column's way, a few metres ahead of the leader
    const fx = us[0].x + 5;
    sim.state.fires.push({ id: 998, x: fx, y: 20, r: 2, t: 4 });
    let closest = Infinity;
    for (let i = 0; i < 30 * 16; i++) {
      sim.step();
      if (sim.state.fires.length) for (const u of us) closest = Math.min(closest, Math.hypot(u.x - fx, u.y - 20));
    }
    expect(closest).toBeGreaterThan(HARM(2));
    expect(us.every((u) => u.state === "ok" && !u.wounded)).toBe(true);
    expect(Math.hypot(us[0].x - 26, us[0].y - 20)).toBeLessThan(1.5);
  });

  it("steps a man out of it when it catches him, and he does not go back in", () => {
    const sim = new Sim(yard());
    const u = sim.spawnUnit({ side: "pl", look: "pl", x: 14.2, y: 20, weapon: "sten" });
    sim.state.fires.push({ id: 997, x: 15, y: 20, r: 2.1, t: 60 }); // lit 0.8 m from him
    goTo(sim, u, 20, 20); // his way runs through it
    let worst = 0, last = 0;
    for (let i = 0; i < 30 * 8; i++) {
      sim.step();
      last = Math.hypot(u.x - 15, u.y - 20);
      if (i > 30) worst = Math.max(worst, HARM(2.1) - last);
    }
    expect(last).toBeGreaterThan(HARM(2.1)); // out of it within a second, and he stays out
    expect(worst).toBeLessThanOrEqual(0);
  });

  it("catching a man against a wall, lets him slide out along it", () => {
    // review round 6: the straight way out ran into the wall, and he stood in the fire
    const sim = new Sim(yard());
    const u = sim.spawnUnit({ side: "pl", look: "pl", x: 29.6, y: 20, weapon: "sten" }); // the wall is at x 30
    sim.state.fires.push({ id: 994, x: 28.7, y: 20, r: 2, t: 60 }); // 0.9 m from him, on his open side: straight out, the wall stops him still in it
    let outAt = -1, worst = 0;
    for (let i = 0; i < 30 * 4; i++) {
      sim.step();
      const d = Math.hypot(u.x - 28.7, u.y - 20);
      if (outAt < 0 && d > HARM(2)) outAt = i;
      if (outAt >= 0) worst = Math.max(worst, HARM(2) - d);
    }
    expect(outAt).toBeGreaterThanOrEqual(0);
    expect(outAt).toBeLessThan(30); // out within a second
    expect(worst).toBeLessThanOrEqual(0); // and he stays out
  });

  it("on open ground, walks a man it catches straight out, whichever side it lies", () => {
    // review round 8: the way out counted cells, not metres, and took men along the flames
    // rather than out of them
    const step = SPEED.partisan / 30;
    let worst = { over: -Infinity, at: "" };
    for (const d of [0.9, 1.2, 1.45]) {
      for (let k = 0; k < 32; k++) {
        const a = (k / 32) * Math.PI * 2 + 0.05;
        const sim = new Sim(yard());
        const u = sim.spawnUnit({ side: "pl", look: "pl", x: 15 + Math.cos(a) * d, y: 20.3 + Math.sin(a) * d, weapon: "sten" });
        sim.state.fires.push({ id: 988, x: 15, y: 20.3, r: 2, t: 60 });
        let steps = 60;
        for (let i = 0; i < 60; i++) {
          sim.step();
          if (Math.hypot(u.x - 15, u.y - 20.3) > HARM(2)) {
            steps = i + 1;
            break;
          }
        }
        const over = steps - Math.ceil((HARM(2) - d) / step);
        if (over > worst.over) worst = { over, at: `${d} m from it, at ${Math.round((a * 180) / Math.PI)}°` };
      }
    }
    expect(worst.over, worst.at).toBeLessThanOrEqual(1); // at most a step more than straight out
  });

  it("catching a man in a corner, gets him out of it, however it lies", () => {
    // review round 7: in a concave corner every step out ran into a wall, and he stood in it
    const sim = new Sim(yard());
    // the corner where the yard's wall (x 30) meets its south border (y 39); the fire lies
    // towards the open side, so no step along the walls takes him out of it
    const u = sim.spawnUnit({ side: "pl", look: "pl", x: 29.7, y: 38.7, weapon: "sten" });
    sim.state.fires.push({ id: 993, x: 28.9, y: 37.9, r: 2, t: 60 }); // 1.1 m from him
    let outAt = -1;
    for (let i = 0; i < 30 * 4 && outAt < 0; i++) {
      sim.step();
      if (Math.hypot(u.x - 28.9, u.y - 37.9) > HARM(2)) outAt = i;
    }
    expect(outAt).toBeGreaterThanOrEqual(0);
    expect(outAt).toBeLessThan(45); // out of its harm within a second and a half
  });

  it("catching a man in a corner at its edge, keeps him there, whatever he was ordered", () => {
    // review round 7: boxed in, a man outside the harm followed an order into it
    const sim = new Sim(yard());
    const u = sim.spawnUnit({ side: "pl", look: "pl", x: 29.9, y: 38.9, weapon: "sten" });
    sim.state.fires.push({ id: 990, x: 28.75, y: 37.75, r: 2, t: 4 }); // 1.63 m from him: near, not in its harm
    goTo(sim, u, 24.5, 32.5); // his way runs through it
    let closest = Infinity, moved = 0;
    for (let i = 0; i < 30 * 10; i++) {
      sim.step();
      if (!sim.state.fires.length) continue;
      closest = Math.min(closest, Math.hypot(u.x - 28.75, u.y - 37.75));
      moved = Math.max(moved, Math.hypot(u.x - 29.9, u.y - 38.9));
    }
    expect(closest).toBeGreaterThan(HARM(2));
    expect(moved).toBeLessThan(0.05); // he stands while it burns, neither in nor along its edge
    expect(Math.hypot(u.x - 24.5, u.y - 32.5)).toBeLessThan(1); // it burnt out and he went on
  });

  it("between two fires, walks a man clear of both, the short way", () => {
    // review round 7: stepping away from one, he walked into the other
    const sim = new Sim(yard());
    const u = sim.spawnUnit({ side: "pl", look: "pl", x: 15, y: 20, weapon: "sten" });
    sim.state.fires.push({ id: 992, x: 13.8, y: 20, r: 2, t: 60 }, { id: 991, x: 16.6, y: 20, r: 2, t: 60 });
    const depth = () => Math.max(HARM(2) - Math.hypot(u.x - 13.8, u.y - 20), HARM(2) - Math.hypot(u.x - 16.6, u.y - 20));
    const d0 = depth();
    let worst = d0, outAt = -1;
    for (let i = 0; i < 30 * 4; i++) {
      sim.step();
      worst = Math.max(worst, depth());
      if (outAt < 0 && depth() < 0) outAt = i;
    }
    expect(worst).toBeLessThanOrEqual(d0 + 0.05); // never deeper than where he stood
    expect(outAt).toBeGreaterThanOrEqual(0);
    expect(outAt).toBeLessThan(30);
  });

  it("near a man by a stopped van but not on him, never brings him into its harm", () => {
    // a van stopped at an angle has a stepped outline, all corners; a man outside the harm
    // waits there, and nothing walks him into it
    const md = buildArsenalMap();
    const cases = [
      { man: { x: 101.1, y: 77.5 }, fire: { x: 101.758, y: 75.911 } }, // 1.72 m off
      { man: { x: 98.5, y: 76.7 }, fire: { x: 98.5, y: 75.08 } }, // 1.62 m off: a hair outside it
    ];
    for (const c of cases) {
      const sim = new Sim(gridFromMap(md), 7);
      sim.spawnVehicle("prison_truck", 101.5, 78.9, 3.54);
      sim.step();
      const u = sim.spawnUnit({ side: "pl", look: "pl", ...c.man, weapon: "sten" });
      sim.state.fires.push({ id: 989, ...c.fire, r: 2, t: 6 });
      let closest = Infinity;
      for (let i = 0; i < 30 * 5; i++) {
        sim.step();
        if (sim.state.fires.length) closest = Math.min(closest, Math.hypot(u.x - c.fire.x, u.y - c.fire.y));
      }
      expect(closest, `man at ${c.man.x}, ${c.man.y}`).toBeGreaterThan(HARM(2));
    }
  });

  it("walks a man out beside a van stopped at an angle without cutting its corners", () => {
    // the shortest straight way out ran between two of its cells that touch only at a corner
    const md = buildArsenalMap();
    const sim = new Sim(gridFromMap(md), 7);
    sim.spawnVehicle("prison_truck", 101.5, 78.9, 3.54);
    sim.step();
    const u = sim.spawnUnit({ side: "pl", look: "pl", x: 99.682, y: 79.711, weapon: "sten" });
    sim.state.fires.push({ id: 987, x: 99.198, y: 79.925, r: 2, t: 6 });
    const G = sim.grid;
    let cx = Math.floor(u.x), cy = Math.floor(u.y), cut = 0;
    for (let i = 0; i < 30 * 3; i++) {
      sim.step();
      const nx = Math.floor(u.x), ny = Math.floor(u.y);
      if ((nx !== cx || ny !== cy) && !G.canStep(cx, cy, nx - cx, ny - cy)) cut++;
      cx = nx;
      cy = ny;
    }
    expect(cut).toBe(0);
    expect(Math.hypot(u.x - 99.198, u.y - 79.925)).toBeGreaterThan(HARM(2)); // and he got out
  });

  it("caught standing in a stopped van's footprint, walks him off it, not further in", () => {
    // review round 8: the way out took the centre of his own cell, inside the van
    const md = buildArsenalMap();
    const sim = new Sim(gridFromMap(md), 7);
    const v = sim.spawnVehicle("prison_truck", 101.5, 78.9, 3.54);
    v.state = "wreck"; // burnt out: the fire beside it cannot light it
    sim.step();
    const G = sim.grid;
    expect(G.walkable(98.1, 77.1)).toBe(false); // inside its outline, by its north-west corner
    const u = sim.spawnUnit({ side: "pl", look: "pl", x: 98.1, y: 77.1, weapon: "sten" });
    // lit north-west of him: the middle of the cell he stands in, inside the van, is out of its harm
    sim.state.fires.push({ id: 984, x: 96.8, y: 76.4, r: 2, t: 6 });
    let deeper = 0, outAt = -1;
    for (let i = 0; i < 30 * 3; i++) {
      sim.step();
      if (!G.walkable(u.x, u.y) && (Math.floor(u.x) !== 98 || Math.floor(u.y) !== 77)) deeper++;
      if (outAt < 0 && Math.hypot(u.x - 96.8, u.y - 76.4) > HARM(2)) outAt = i;
    }
    expect(deeper).toBe(0);
    expect(outAt).toBeGreaterThanOrEqual(0);
    expect(outAt).toBeLessThan(15); // off the van the near way, not through the fire
    expect(G.walkable(u.x, u.y)).toBe(true);
    expect(Math.hypot(u.x - 96.8, u.y - 76.4)).toBeGreaterThan(HARM(2));
  });

  it("sent off a stopped van he stands on, walks off it and does not walk back in", () => {
    // Tom, 2026-09-28: "i got stuck next to van could not move". A man a van stopped on (its cells
    // cover where he stands) took a 5 cm step, landed in its cells again, was refused, every tick
    const md = buildArsenalMap();
    const sim = new Sim(gridFromMap(md), 7);
    const v = sim.spawnVehicle("prison_truck", 101.5, 78.9, 3.54);
    v.state = "wreck";
    sim.step();
    const G = sim.grid;
    for (const [x, y] of [[98.1, 77.1], [100.2, 78.6], [103.4, 79.5]]) {
      expect(G.walkable(x, y), `${x}, ${y} is on the van`).toBe(false);
      const u = sim.spawnUnit({ side: "pl", look: "pl", x, y, weapon: "sten" });
      u.path = sim.route({ x, y }, { x: x - 6, y: y - 2.5 }) ?? [];
      let off = false, back = 0;
      for (let i = 0; i < 30 * 3; i++) {
        sim.step();
        if (G.walkable(u.x, u.y)) off = true;
        else if (off) back++;
      }
      expect(off, `from ${x}, ${y}`).toBe(true);
      expect(back, `from ${x}, ${y}`).toBe(0);
      expect(Math.hypot(u.x - x, u.y - y)).toBeGreaterThan(1);
      sim.state.units = sim.state.units.filter((q) => q !== u);
    }
  });

  it("caught by a bottle in a building's corner, walks clear and stays clear", () => {
    // review round 8: two ways out, each weighed afresh every tick from where he stood, took
    // turns, and held him in the harm until it burnt out. The second fire leaves the way south
    // clear only in the last 5 cm before the wall: looked for in steps, it is there from one
    // spot and not from the next
    const md = buildArsenalMap();
    for (const at of [{ x: 125.53, y: 107.78 }, { x: 125.53, y: 108.174 }]) {
      const sim = new Sim(gridFromMap(md), 7);
      const u = sim.spawnUnit({ side: "pl", look: "pl", x: 124.04, y: 108.4, weapon: "sten" });
      const f = { id: 986, ...at, r: THROW.bottleR, t: THROW.bottleBurn };
      sim.state.fires.push(f);
      let outAt = -1, back = 0;
      for (let i = 0; i < 30 * 8 && sim.state.fires.length; i++) {
        sim.step();
        const inHarm = Math.hypot(u.x - f.x, u.y - f.y) < HARM(f.r);
        if (outAt < 0 && !inHarm) outAt = i;
        else if (outAt >= 0 && inHarm) back++;
      }
      expect(outAt, `lit at ${at.x}, ${at.y}`).toBeGreaterThanOrEqual(0);
      expect(outAt, `lit at ${at.x}, ${at.y}`).toBeLessThan(10);
      expect(back, `lit at ${at.x}, ${at.y}`).toBe(0);
    }
  });

  it("boxed where no straight way leads out, walks a man round the corner", () => {
    // a big fire fills a one-cell room whose passage turns: no straight line from the room comes
    // out of it before a wall, so he goes out through the door and up the passage. Out of the
    // room's corner, where two walls meet only at a point, a second way starts shorter: nobody
    // squeezes through there
    const G = new Grid(20, 20);
    G.flags.fill(F_SIGHT);
    const open = (cx: number, cy: number) => (G.flags[cy * 20 + cx] = F_WALK);
    for (let y = 1; y < 4; y++) for (let x = 2; x < 18; x++) open(x, y); // a yard
    for (let y = 4; y <= 10; y++) open(12, y); // a passage south from it
    open(11, 10); // the doorway, west off its foot
    open(10, 10); // the room
    for (let y = 4; y <= 9; y++) open(9, y); // the second way, from the room's corner
    const sim = new Sim(G);
    const u = sim.spawnUnit({ side: "pl", look: "pl", x: 10.4, y: 10.6, weapon: "sten" });
    sim.state.fires.push({ id: 985, x: 10.5, y: 10.5, r: 3.5, t: 60 });
    let outAt = -1, cut = 0, cx = 10, cy = 10;
    for (let i = 0; i < 30 * 3 && outAt < 0; i++) {
      sim.step();
      if (Math.hypot(u.x - 10.5, u.y - 10.5) > HARM(3.5)) outAt = i;
      const nx = Math.floor(u.x), ny = Math.floor(u.y);
      if ((nx !== cx || ny !== cy) && !G.canStep(cx, cy, nx - cx, ny - cy)) cut++;
      cx = nx;
      cy = ny;
    }
    expect(cut).toBe(0);
    expect(outAt).toBeGreaterThanOrEqual(0);
    expect(outAt).toBeLessThan(60);
  });

  it("walks a squad's leader out of a bottle burst among his men, and pushes nobody back in", () => {
    // review round 9: the men standing round him pushed him back into the fire as fast as he
    // walked out of it, and a crowd pushed men who had just walked out back in. A bottle bursts by
    // the leader of a squad at rest or on hold; harm is off: this is about where they walk
    const names = ["Zośka", "Alek", "Rudy", "Anoda", "Słoń", "Bytny"];
    let seed = 777;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    let stuck = 0, back = 0;
    for (const [men, held] of [[4, false], [4, true], [6, true]] as const) {
      for (let t = 0; t < 30; t++) {
        const sim = new Sim(yard(), 100 + t);
        sim.hurt = () => {};
        const sq = makeSquad(sim, 0, "Zośka", 0);
        const roster = names.slice(0, men).map((name, k) => ({ ...TROOPER, name, rank: k === 0 ? 5 : k === 1 ? 4 : 3 }));
        const us = fieldSquad(sim, sq, roster, 12 + rnd() * 10, 12 + rnd() * 16, rnd() * Math.PI * 2);
        if (held) {
          const other = makeSquad(sim, 1, "Alek", 1);
          fieldSquad(sim, other, [{ ...TROOPER, name: "Kuba", rank: 5 }], 45, 20, 0);
          other.order = "follow";
          sim.state.controlled = 1;
          sq.order = "hold";
        } else {
          sq.order = "follow";
          sim.state.controlled = 0;
        }
        run(sim, 2);
        // lit ahead of him: his way out lies back through his men
        const L = us[0], a = L.dir + (rnd() * 2 - 1) * (Math.PI / 6), d = 0.2 + rnd() * 1.3;
        const f = { id: 983, x: L.x + Math.cos(a) * d, y: L.y + Math.sin(a) * d, r: THROW.bottleR, t: THROW.bottleBurn };
        sim.state.fires.push(f);
        const out = us.map(() => false);
        let leaderIn = 0;
        for (let i = 0; i < 30 * 6 && sim.state.fires.length; i++) {
          sim.state.paused = false;
          sim.step();
          us.forEach((u, k) => {
            const inHarm = Math.hypot(u.x - f.x, u.y - f.y) < HARM(f.r);
            if (!inHarm) out[k] = true;
            else if (out[k]) {
              back++;
              out[k] = false;
            }
          });
          if (Math.hypot(L.x - f.x, L.y - f.y) < HARM(f.r)) leaderIn++;
        }
        if (leaderIn >= 30) stuck++; // not out within a second
      }
    }
    expect({ stuck, back }).toEqual({ stuck: 0, back: 0 });
  });

  it("keeps a man who has walked out of a fire out of it, whoever stands by him", () => {
    // review round 9: he stopped at its edge, and a comrade standing at the wall pushed him
    // back in, over and over, until it burnt out
    const sim = new Sim(yard());
    sim.hurt = () => {}; // where they stand, not the dice
    const u = sim.spawnUnit({ side: "pl", look: "pl", x: 29.7, y: 20.3, weapon: "sten" });
    sim.spawnUnit({ side: "pl", look: "pl", x: 29.96, y: 21.4, weapon: "sten" });
    const f = { id: 982, x: 28.9, y: 20, r: 2.1, t: 8 };
    sim.state.fires.push(f);
    let outAt = -1, back = 0;
    for (let i = 0; i < 30 * 8 && sim.state.fires.length; i++) {
      sim.step();
      const inHarm = Math.hypot(u.x - f.x, u.y - f.y) < HARM(f.r);
      if (outAt < 0 && !inHarm) outAt = i;
      else if (outAt >= 0 && inHarm) back++;
    }
    expect(outAt).toBeGreaterThanOrEqual(0);
    expect(outAt).toBeLessThan(30);
    expect(back).toBe(0);
  });

  it("does not let a man slide along a van back into a fire he has walked out of", () => {
    // review round 9: the step his order asked for was checked against the fire, but where a
    // wall stood in the way he slid along one axis instead, and that slide took him back in
    const md = buildArsenalMap();
    const sim = new Sim(gridFromMap(md), 7);
    const v = sim.spawnVehicle("prison_truck", 101.5, 78.9, 3.54);
    v.state = "wreck";
    sim.step();
    sim.hurt = () => {};
    const u = sim.spawnUnit({ side: "pl", look: "pl", x: 98, y: 76.6, weapon: "sten" });
    const f = { id: 981, x: 97.62, y: 75.68, r: THROW.bottleR, t: THROW.bottleBurn };
    sim.state.fires.push(f);
    goTo(sim, u, 105.26, 81.37); // along the van, past the fire
    let outAt = -1, back = 0;
    for (let i = 0; i < 30 * 8 && sim.state.fires.length; i++) {
      sim.step();
      const inHarm = Math.hypot(u.x - f.x, u.y - f.y) < HARM(f.r);
      if (outAt < 0 && !inHarm) outAt = i;
      else if (outAt >= 0 && inHarm) back++;
    }
    expect(outAt).toBeGreaterThanOrEqual(0);
    expect(back).toBe(0);
  });

  it("on the real map, lit at the Arsenal's gate, holds the leader there until it is out", () => {
    // review round 4's case: the fire shut the only way in; the leader was walked round to the
    // far side of the building and left there
    const md = buildArsenalMap();
    const sim = new Sim(gridFromMap(md), 365);
    const sq = makeSquad(sim, 0, "Zośka", 0);
    const us = fieldSquad(sim, sq, [
      { ...TROOPER, name: "Zośka", rank: 5 }, { ...TROOPER, name: "Alek", rank: 4 },
      { ...TROOPER, name: "Rudy", rank: 3 }, { ...TROOPER, name: "Anoda", rank: 3 },
    ], 41.5, 64.5, 0);
    sq.order = "follow";
    sim.state.controlled = 0;
    cmdMove(sim, 56.5, 30.5);
    run(sim, 1);
    sim.state.fires.push({ id: 995, x: 50.8, y: 62.7, r: 2.1, t: 8 });
    run(sim, 40);
    expect(Math.hypot(us[0].x - 56.5, us[0].y - 30.5)).toBeLessThan(2);
    expect(us.every((u) => u.state === "ok" && !u.wounded)).toBe(true);
  });

  it("closing a passage, a man waits at its edge and goes on when it is out", () => {
    const sim = new Sim(yard());
    const u = sim.spawnUnit({ side: "pl", look: "pl", x: 20, y: 20, weapon: "sten" });
    // the yard's wall has one gap, at its north end: the fire fills it
    sim.state.fires.push({ id: 996, x: 30.5, y: 3.5, r: 3, t: 20 }); // the gap is 5 m: this fills it
    goTo(sim, u, 40, 20);
    let closest = Infinity;
    for (let i = 0; i < 30 * 18; i++) { sim.step(); closest = Math.min(closest, Math.hypot(u.x - 30.5, u.y - 3.5)); }
    expect(closest).toBeGreaterThan(HARM(3));
    expect(u.x).toBeLessThan(30);
    for (let i = 0; i < 30 * 25; i++) sim.step();
    expect(Math.hypot(u.x - 40, u.y - 20)).toBeLessThan(1);
    expect(u.state === "ok" && !u.wounded).toBe(true);
  });
});

describe("a guard post", () => {
  it("burns out when a petrol bottle bursts at its door", () => {
    const sim = new Sim(yard());
    const { us } = squadOf4(sim, 10, 20);
    const sp = sim.addSpawner({ x: 18, y: 20, ox: 18, oy: 22, district: 1, interval: 6, left: -1, maxAlive: 2, tag: "post", look: "de" });
    for (const u of us) { u.grenades = 0; u.bottles = 0; }
    us[1].bottles = 1;
    cmdThrow(sim, sp.x, sp.y, "bottle");
    run(sim, 4);
    expect(sp.destroyed).toBe(true);
  });
});

describe("gear", () => {
  it("stays where a man falls, and the first of ours over it takes it", () => {
    const sim = new Sim(yard());
    const { us } = squadOf4(sim, 10, 20);
    const alek = us[1]; // two bottles
    sim.kill(alek, -1, false);
    const kit = sim.state.props.find((p) => p.kind === "kit");
    expect(kit?.contents).toMatchObject({ bottles: 2, owner: "Alek" });
    expect(alek.bottles).toBe(0);
    const rudy = us[2];
    const before = rudy.bottles;
    goTo(sim, rudy, kit!.x, kit!.y);
    cmdPick(sim, rudy.id); // he goes alone, so the column does not pull him back
    run(sim, 4);
    expect(rudy.bottles).toBe(before + 2);
    // he has a Sten of his own: Alek's stays in the kit, for a man with only a pistol
    expect(kit!.contents).toMatchObject({ bottles: 0, sten: true });
    const anoda = us[3];
    anoda.weapon = "pistol";
    cmdPick(sim, anoda.id);
    goTo(sim, anoda, kit!.x, kit!.y);
    run(sim, 4);
    expect(anoda.weapon).toBe("sten");
    expect(sim.state.props.some((p) => p.kind === "kit")).toBe(false);
  });
});

describe("picking a man on the strip", () => {
  it("sends him alone while the squad stays, and tapping him again brings him back", () => {
    const sim = new Sim(yard());
    const { us } = squadOf4(sim, 10, 20);
    run(sim, 1);
    const at = us.map((u) => [u.x, u.y]);
    const him = us[2];
    expect(cmdPick(sim, him.id)).toBe(true);
    cmdMove(sim, 20, 30);
    run(sim, 6);
    expect(Math.hypot(him.x - 20, him.y - 30)).toBeLessThan(1.5);
    for (const k of [0, 1, 3]) expect(Math.hypot(us[k].x - at[k][0], us[k].y - at[k][1])).toBeLessThan(1.5);
    // tapped again, he walks back into the column
    expect(cmdPick(sim, him.id)).toBe(false);
    run(sim, 8);
    expect(Math.hypot(him.x - us[0].x, him.y - us[0].y)).toBeLessThan(4);
  });

  it("sends him alone to a job, however far, while the squad stays", () => {
    const sim = new Sim(yard());
    const { us } = squadOf4(sim, 10, 20);
    run(sim, 1);
    const at = us.map((u) => [u.x, u.y]);
    const him = us[2];
    cmdPick(sim, him.id);
    cmdWork(sim, 22, 32, "test_job", "", 1.2);
    let done = false;
    for (let i = 0; i < 30 * 15 && !done; i++) {
      sim.state.paused = false;
      sim.step();
      done = sim.drainEvents().some((e) => e.t === "work" && e.done && e.unit === him.id);
    }
    expect(done).toBe(true);
    for (const k of [0, 1, 3]) expect(Math.hypot(us[k].x - at[k][0], us[k].y - at[k][1])).toBeLessThan(1.5);
  });

  it("sends the leader alone too: the column stays where it stood", () => {
    const sim = new Sim(yard());
    const { us } = squadOf4(sim, 10, 20);
    run(sim, 1);
    const at = us.map((u) => [u.x, u.y]);
    const L = us[0];
    expect(cmdPick(sim, L.id)).toBe(true);
    cmdMove(sim, 22, 32);
    run(sim, 7);
    expect(Math.hypot(L.x - 22, L.y - 32)).toBeLessThan(1.5);
    for (const k of [1, 2, 3]) expect(Math.hypot(us[k].x - at[k][0], us[k].y - at[k][1])).toBeLessThan(1.5);
    // let go, the column walks to him
    cmdPick(sim, L.id);
    run(sim, 8);
    for (const k of [1, 2, 3]) expect(Math.hypot(us[k].x - L.x, us[k].y - L.y)).toBeLessThan(4);
  });
});

describe("fire", () => {
  it("a miss still tells the squad who is shooting at it, and a squad on hold answers", () => {
    // the first German shot that misses, before anything has hit the squad
    const play = (seed: number) => {
      const sim = new Sim(yard(), seed);
      const { sq, us } = squadOf4(sim, 10, 20);
      // you lead another squad, out of it; this one holds
      const other = makeSquad(sim, 1, "Kołczan", 1);
      fieldSquad(sim, other, [{ ...TROOPER, name: "Kołczan", rank: 4 }], 8, 36, 0);
      sim.state.controlled = 1;
      other.order = "follow";
      sq.order = "hold";
      const g = sim.spawnUnit({ side: "de", look: "de", x: 24, y: 20, dir: Math.PI, weapon: "rifle", ai: { district: 1, mode: "alert", stay: true } });
      for (let i = 0; i < 30 * 10; i++) {
        sim.state.paused = false;
        sim.step();
        for (const e of sim.drainEvents()) {
          if (e.t === "shot" && e.by === g.id && e.hit !== -1) return null; // hit first: no use
          if (e.t === "shot" && e.by === g.id) {
            // the man he aimed at knows it this very tick, though nothing hit him
            const marked = us.some((u) => u.shotBy === g.id && u.shotByT === sim.state.time);
            const t0 = sim.state.time;
            let answered = false;
            for (let k = 0; k < 30 * 4 && !answered; k++) {
              sim.state.paused = false;
              sim.step();
              answered = sim.drainEvents().some((f) => f.t === "shot" && f.side === "pl") && sim.state.time - t0 < 4;
            }
            return { marked, answered };
          }
        }
      }
      return null;
    };
    let r: ReturnType<typeof play> = null;
    for (let seed = 1; seed < 60 && !r; seed++) r = play(seed);
    expect(r, "some seed's first German shot misses").not.toBeNull();
    expect(r!.marked).toBe(true);
    expect(r!.answered).toBe(true);
  });

  it("reaches across the view further than into it, so nobody fires from off-screen", () => {
    const shotsFrom = (dx: number, dy: number) => {
      const sim = new Sim(new Grid(80, 80), 5);
      sim.state.bounds = { x: 0, y: 0, w: 80, h: 80 };
      sim.grid.flags.fill(F_WALK);
      const sq = makeSquad(sim, 0, "Zośka", 0);
      fieldSquad(sim, sq, [{ ...TROOPER, name: "Zośka", rank: 5 }], 40, 40, 0);
      // he stays at his post: an alerted German otherwise walks in until he is in reach
      const g = sim.spawnUnit({ side: "de", look: "de", x: 40 + dx, y: 40 + dy, dir: Math.atan2(-dy, -dx), weapon: "rifle", ai: { district: 1, mode: "alert", stay: true } });
      let n = 0;
      for (let i = 0; i < 30 * 8; i++) { sim.state.paused = false; sim.step(); n += sim.drainEvents().filter((e) => e.t === "shot" && e.by === g.id).length; }
      return n;
    };
    // a rifle reaches 22 m: 18 m along the street is in reach, 18 m into the screen is off it
    expect(shotsFrom(18, 0)).toBeGreaterThan(0);
    expect(shotsFrom(0, -18)).toBe(0);
  });
});

describe("events", () => {
  it("reach the mission once each, however many ticks a frame runs", () => {
    const sim = new Sim(yard());
    squadOf4(sim, 10, 20);
    sim.spawnUnit({ side: "de", look: "de", x: 20, y: 20, dir: Math.PI, weapon: "rifle", ai: { district: 1, mode: "alert" } });
    const seen = new Map<object, number>();
    sim.mission = { id: "t", setup() {}, tick() {}, onEvent: (_s, e) => { seen.set(e, (seen.get(e) ?? 0) + 1); } };
    let emitted = 0;
    for (let i = 0; i < 40; i++) {
      sim.state.paused = false;
      sim.advance(0.25); // a slow frame: several ticks before the game scene drains the events
      emitted += sim.drainEvents().length;
    }
    expect(emitted).toBeGreaterThan(5);
    expect([...seen.values()].filter((n) => n > 1)).toEqual([]);
  });
});
