// The Arsenal map: the builder is the source, game/maps/arsenal.tmj (Tiled) is what the
// game loads. This test fails when the two drift; `WRITE_MAP=1 npx vitest run tests/map.test.ts`
// rewrites the file (and the tileset images Tiled shows).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildArsenalMap, BIEL, NAL, DLUGA } from "../src/content/arsenal/map";
import { mapFromTiled, mapToTiled, TW, TH } from "../src/content/tiled";
import { gridFromMap, zone, path, F_WALK } from "../src/content/mapdata";
import { Sim } from "../src/sim/sim";
import { encodePng } from "./helpers/png";

const MAPS = resolve(__dirname, "../maps");
const FILE = resolve(MAPS, "arsenal.tmj");

describe("arsenal map", () => {
  const md = buildArsenalMap();
  const tmj = mapToTiled(md);
  const text = JSON.stringify(tmj);

  it("the committed Tiled file matches the builder", () => {
    if (process.env.WRITE_MAP) {
      mkdirSync(resolve(MAPS, "tiles"), { recursive: true });
      writeFileSync(FILE, text);
      const swatch = (n: number, colour: (i: number) => [number, number, number]) => {
        const px = new Uint8Array(n * TW * TH * 4);
        for (let y = 0; y < TH; y++) for (let x = 0; x < n * TW; x++) {
          const [r, g, b] = colour(Math.floor(x / TW));
          px.set([r, g, b, 255], (y * n * TW + x) * 4);
        }
        return encodePng(n * TW, TH, px);
      };
      const MAT: Record<string, [number, number, number]> = { road: [106, 104, 98], walk: [168, 164, 154], yard: [150, 146, 138], rail_ew: [164, 164, 160], rail_ns: [164, 164, 160], under: [44, 40, 38], square: [92, 118, 60] };
      writeFileSync(resolve(MAPS, "tiles/materials.png"), swatch(md.legend.length, (i) => MAT[md.legend[i]]));
      writeFileSync(resolve(MAPS, "tiles/flags.png"), swatch(32, (f) => [f & 2 ? 200 : 40, f & 1 ? 180 : 40, f & 4 ? 200 : 40]));
      writeFileSync(resolve(MAPS, "tiles/streets.png"), swatch(md.streets.length, (i) => [60 + i * 17, 200 - i * 13, 120 + i * 9]));
    }
    expect(existsSync(FILE), "run WRITE_MAP=1 npx vitest run tests/map.test.ts").toBe(true);
    expect(readFileSync(FILE, "utf8") === text, "arsenal.tmj is stale: run WRITE_MAP=1 npx vitest run tests/map.test.ts").toBe(true);
  });

  it("survives the Tiled round trip", () => {
    const back = mapFromTiled(JSON.parse(text));
    expect(Array.from(back.ground)).toEqual(Array.from(md.ground));
    expect(Array.from(back.flags)).toEqual(Array.from(md.flags));
    expect(Array.from(back.street)).toEqual(Array.from(md.street));
    expect(back.buildings.map((b) => [b.id, b.x, b.y, b.w, b.d, b.storeys, b.street, b.cuttable])).toEqual(
      md.buildings.map((b) => [b.id, b.x, b.y, b.w, b.d, b.storeys, b.street, b.cuttable]),
    );
    expect(back.props.length).toBe(md.props.length);
    expect(back.paths.map((p) => p.name)).toEqual(md.paths.map((p) => p.name));
    expect(back.paths[0].pts[1].x).toBeCloseTo(md.paths[0].pts[1].x, 6);
    expect(tmj.tilewidth).toBe(TW);
    expect(tmj.tileheight).toBe(TH);
  });

  it("reads what each tile says it is, not where it sits in its tileset (ADR-0001)", () => {
    // re-tiled as someone might in Tiled: the flags and streets tilesets move and their tiles
    // are stored in another order, and one tile is flipped
    const t = JSON.parse(text);
    for (const [name, layerName, shift] of [["flags", "blocking", 1000], ["streets", "streets", 2000]] as const) {
      const ts = t.tilesets.find((s: { name: string }) => s.name === name);
      const n = ts.tilecount;
      const perm = (id: number) => n - 1 - id;
      const layer = t.layers.find((l: { name: string }) => l.name === layerName);
      layer.data = layer.data.map((gid: number) => (gid ? ts.firstgid + shift + perm(gid - ts.firstgid) : 0));
      ts.tiles = ts.tiles.map((tile: { id: number }) => ({ ...tile, id: perm(tile.id) }));
      ts.firstgid += shift;
    }
    const blocking = t.layers.find((l: { name: string }) => l.name === "blocking");
    const i = blocking.data.findIndex((gid: number) => gid > 0);
    blocking.data[i] |= 0x80000000; // flipped horizontally
    const back = mapFromTiled(t);
    expect(Array.from(back.flags)).toEqual(Array.from(md.flags));
    expect(Array.from(back.street)).toEqual(Array.from(md.street));
  });

  it("is playable: routes exist between the places the missions use", () => {
    const G = gridFromMap(md);
    const sim = new Sim(G);
    const pairs: [string, { x: number; y: number }, { x: number; y: number }][] = [
      ["Bielańska south to the post by the Bank Polski", { x: 131, y: 165 }, { x: 136.5, y: 145 }],
      ["Długa west to the line box", { x: 3, y: 79 }, { x: 56, y: DLUGA.n + 2.8 }],
      ["Długa east into the south-east courtyard", { x: 236, y: 80 }, { x: 190, y: 108 }],
      ["Bielańska round the S-bend up Nalewki", { x: 131, y: 165 }, { x: 93, y: 3 }],
      ["through the ruin opposite the Arsenal to Tłomackie", { x: 64, y: 80 }, { x: 64, y: 133 }],
      ["into the Arsenal arcades", { x: 93, y: 60 }, { x: 86, y: 40 }],
    ];
    for (const [what, a, b] of pairs) {
      const r = sim.route(a, b, 60000);
      expect(r, what).not.toBeNull();
      const end = r![r!.length - 1];
      expect(Math.hypot(end.x - b.x, end.y - b.y), what).toBeLessThan(1.5);
    }
  });

  it("the truck's route runs on the road through the S-bend", () => {
    const G = gridFromMap(md);
    const pts = path(md, "truck");
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y));
      for (let k = 0; k <= n; k++) {
        const x = a.x + ((b.x - a.x) * k) / n, y = a.y + ((b.y - a.y) * k) / n;
        if (y >= md.h || y < 0) continue; // the route starts and ends off the map
        expect(G.walkable(x, y), `truck route at ${x.toFixed(1)},${y.toFixed(1)}`).toBe(true);
      }
    }
    // the S-bend (research §3): up Bielańska, LEFT (west) along Długa for 35-40 m, RIGHT into Nalewki
    const axisOffset = (BIEL.w + BIEL.e) / 2 - (NAL.w + NAL.e) / 2;
    expect(axisOffset).toBeGreaterThan(34);
    expect(axisOffset).toBeLessThan(42);
    expect(pts[1].y).toBeGreaterThan(DLUGA.n);
    expect(pts[pts.length - 1].y).toBeLessThan(0);
  });

  it("zones sit on the map and each task district has walkable ground", () => {
    for (const z of md.zones) {
      expect(z.x >= 0 && z.y >= 0 && z.x + z.w <= md.w && z.y + z.h <= md.h, z.name).toBe(true);
    }
    for (const name of ["task_signal", "task_ghetto", "task_oldtown", "finale"]) {
      const z = zone(md, name);
      let walk = 0;
      for (let y = z.y; y < z.y + z.h; y++) for (let x = z.x; x < z.x + z.w; x++) if (md.flags[y * md.w + x] & F_WALK) walk++;
      expect(walk, name).toBeGreaterThan(400);
    }
  });
});
