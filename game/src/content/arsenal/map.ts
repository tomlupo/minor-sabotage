// The Arsenal crossroads, Warsaw, 26 March 1943, as a map builder. This is the authoring
// source: tests/map.test.ts exports it to game/maps/arsenal.tmj (Tiled) and the game loads
// that file. Metres; x east, y south; the camera looks north. Długa is drawn east-west
// (in reality it runs WSW-ENE).
//
// Geography from docs/research/arsenal.md §3: the prison truck came north up Bielańska,
// turned LEFT (west) into Długa, and 35-40 m further on was to turn RIGHT (north) into
// Nalewki; that S-bend slowed it. The Arsenal stands north of Długa, west of Nalewki, with
// an arcaded walkway along its east wing on Nalewki. Across Nalewki, the corner of Pasaż
// Simonsa is a 1939 ruin. The Ghetto section held Długa west of the Arsenal, facing
// Przejazd and the ghetto walls; the Old Town section held Długa to the east, towards the
// Arbeitsamt in the Pałac pod Czterema Wiatrami. Sygnalizacja stood on Bielańska: Kuba at
// the mouth of Tłomackie (west side), Kadłubek by the Bank Polski (east side), and Jur at
// the telephone in a small restaurant at the Długa–Bielańska corner. One tenement opposite
// the Arsenal was a 1939 ruin: freed prisoners escaped through it to Tłomackie.
// Distances along Długa east of the crossroads are compressed to fit the demo map.
import type { GroundMat, PlasterKind, RoofKind } from "../../art/types";
import { emptyMap, type MapBuilding, type MapData, type MapProp, F_COVER, F_ROOF, F_SIGHT, F_WALK } from "../mapdata";

export const LEGEND: GroundMat[] = ["road", "walk", "yard", "rail_ew", "rail_ns", "under", "square"];
const M = Object.fromEntries(LEGEND.map((m, i) => [m, i])) as Record<GroundMat, number>;

export const W = 240;
export const H = 170;

// ---- street geometry (edit here) --------------------------------------------------------
export const DLUGA = { n: 70, s: 88, walk: 3 }; // building lines north/south, pavement width
export const NAL = { w: 88, e: 98, walk: 1.5, y0: 0 }; // narrow on this stretch
export const BIEL = { w: 124, e: 138, walk: 2 }; // axis 38 m east of Nalewki's
export const PRZEJAZD = { w: 8, e: 16 };
export const TLOM = { n: 128, s: 138, x0: 34 }; // Tłomackie, west from Bielańska
// the Arsenal's Długa front sat back behind a lawn and trees (research §3)
export const LAWN = 6;
export const ARSENAL = { x: 20, y: 10, w: NAL.w - 20, d: DLUGA.n - LAWN - 10 };
export const ARCADE = 4; // the arcaded walkway inside the Arsenal's east wing
export const GHETTO_WALL_Y = 24; // across Przejazd

export const STREET = {
  dluga: 0, bielanska: 1, nalewki: 2, przejazd: 3, tlomackie: 4,
  yardSW: 5, yardSE: 6, arsenalYard: 7, ruins: 8, arcade: 9, yardS: 10,
} as const;
const STREET_NAMES = ["Długa", "Bielańska", "Nalewki", "Przejazd", "Tłomackie", "the courtyard", "the courtyard", "the Arsenal courtyard", "the ruins", "the Arsenal arcades", "the back yard"];

function rngOf(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildArsenalMap(): MapData {
  const md = emptyMap("arsenal", W, H, LEGEND);
  const R = rngOf(260343);
  md.streets = STREET_NAMES.map((name, id) => ({ id, name }));
  md.ground.fill(M.under);

  const fillRect = (x: number, y: number, w: number, h: number, fn: (i: number, cx: number, cy: number) => void) => {
    for (let cy = Math.max(0, Math.floor(y)); cy < Math.min(H, Math.ceil(y + h)); cy++)
      for (let cx = Math.max(0, Math.floor(x)); cx < Math.min(W, Math.ceil(x + w)); cx++) fn(cy * W + cx, cx, cy);
  };
  const ground = (x: number, y: number, w: number, h: number, mat: GroundMat, street = -1) =>
    fillRect(x, y, w, h, (i) => { md.ground[i] = M[mat]; md.flags[i] = F_WALK; if (street >= 0) md.street[i] = street; });
  const streetId = (x: number, y: number, w: number, h: number, s: number) => fillRect(x, y, w, h, (i) => { md.street[i] = s; });

  // ---- streets ------------------------------------------------------------------------------
  // Długa, across the map: pavements, then the cobbled road
  ground(0, DLUGA.n, W, DLUGA.s - DLUGA.n, "walk", STREET.dluga);
  ground(0, DLUGA.n + DLUGA.walk, W, DLUGA.s - DLUGA.n - DLUGA.walk * 2, "road", STREET.dluga);
  // Nalewki, north from Długa along the Arsenal's east wing (narrow here)
  ground(NAL.w, 0, NAL.e - NAL.w, DLUGA.n, "walk", STREET.nalewki);
  ground(NAL.w + 1, 0, NAL.e - NAL.w - 2, DLUGA.n + DLUGA.walk, "road", STREET.nalewki);
  // Bielańska, from Długa south to the map edge (Plac Teatralny beyond)
  ground(BIEL.w, DLUGA.s, BIEL.e - BIEL.w, H - DLUGA.s, "walk", STREET.bielanska);
  ground(BIEL.w + BIEL.walk, DLUGA.s - DLUGA.walk, BIEL.e - BIEL.w - BIEL.walk * 2, H - DLUGA.s + DLUGA.walk, "road", STREET.bielanska);
  // Przejazd, north from Długa at the far west, towards the ghetto wall
  ground(PRZEJAZD.w, 0, PRZEJAZD.e - PRZEJAZD.w, DLUGA.n, "walk", STREET.przejazd);
  ground(PRZEJAZD.w + 1, 0, PRZEJAZD.e - PRZEJAZD.w - 2, DLUGA.n + DLUGA.walk, "road", STREET.przejazd);
  // Tłomackie, west from Bielańska
  ground(TLOM.x0, TLOM.n, BIEL.w - TLOM.x0, TLOM.s - TLOM.n, "walk", STREET.tlomackie);
  ground(TLOM.x0, TLOM.n + 2, BIEL.w + BIEL.walk - TLOM.x0, TLOM.s - TLOM.n - 4, "road", STREET.tlomackie);
  // Tram rails: up Bielańska, west along Długa, north into Nalewki (no tram ran through
  // the action; the rails are there)
  const railN = (x: number, y0: number, y1: number) => fillRect(x, y0, 2, y1 - y0, (i) => { md.ground[i] = M.rail_ns; });
  railN(Math.round((BIEL.w + BIEL.e) / 2) - 1, DLUGA.s - 5, H);
  fillRect(Math.round((NAL.w + NAL.e) / 2), 78, Math.round((BIEL.w + BIEL.e) / 2) - Math.round((NAL.w + NAL.e) / 2) + 1, 2, (i) => { md.ground[i] = M.rail_ew; });
  railN(Math.round((NAL.w + NAL.e) / 2) - 1, 0, 78);
  // the whole crossroads belongs to Długa for the cut
  streetId(NAL.w, DLUGA.n, BIEL.e - NAL.w, DLUGA.s - DLUGA.n, STREET.dluga);

  // ---- courtyards and ruins ---------------------------------------------------------------------
  ground(0, 100, BIEL.w - 12, TLOM.n - 100 - 12, "yard", STREET.yardSW); // behind the Długa front row, west of Bielańska
  ground(BIEL.e + 12, 100, W - BIEL.e - 12, 16, "yard", STREET.yardSE);
  ground(ARSENAL.x + 12, ARSENAL.y + 12, ARSENAL.w - 12 - ARCADE - 12, ARSENAL.d - 24, "yard", STREET.arsenalYard);
  // the lawn in front of the Arsenal
  ground(ARSENAL.x, DLUGA.n - LAWN, ARSENAL.w, LAWN, "square", STREET.dluga);
  // the Pasaż Simonsa corner: burnt out in 1939, "Ruiny" on Broniewski's plan
  ground(NAL.e, 40, 34, DLUGA.n - 40, "yard", STREET.ruins);
  // the ruined tenement opposite the Arsenal: a way through to the courtyard and Tłomackie
  ground(58, DLUGA.s, 12, 12, "yard", STREET.yardSW);

  // ---- buildings -------------------------------------------------------------------------------
  let bid = 0;
  const addBuilding = (b: Omit<MapBuilding, "seed"> & { seed?: number }) => {
    const id = bid++;
    const full: MapBuilding = { seed: b.seed ?? Math.floor(R() * 1e9), ...b } as MapBuilding;
    md.buildings.push(full);
    fillRect(full.x, full.y, full.w, full.d, (i, cx, cy) => {
      const c = full.courtyard;
      if (c && cx >= full.x + c.x && cx < full.x + c.x + c.w && cy >= full.y + c.y && cy < full.y + c.y + c.d) return;
      md.flags[i] = F_SIGHT;
      md.building[i] = id;
      md.ground[i] = M.under;
    });
    for (const gx of full.front?.gateways ?? []) {
      fillRect(full.x + gx, full.y, 3, full.d, (i) => {
        if (md.building[i] !== id) return;
        md.flags[i] = F_WALK | F_ROOF;
        md.ground[i] = M.yard;
        md.building[i] = -1;
      });
    }
    return full;
  };

  const PLASTER: PlasterKind[] = ["ochre", "cream", "green", "ochre", "cream", "brick", "stone"];
  const SIGNS = ["SKLEP", "PIEKARNIA", "APTEKA", "KAWIARNIA", "FRYZJER", "ZEGARMISTRZ", "WĘDLINY", "KOLONJALNE", "SZEWC", "MLECZARNIA", "CUKIERNIA"];
  let tid = 0;
  /** A row of tenements between x0 and x1 on one footprint depth; gateways at absolute x. */
  const row = (x0: number, x1: number, y: number, d: number, street: number, o: { cuttable: boolean; storeys?: [number, number]; gates?: number[]; shops?: boolean; lit?: number; roof?: RoofKind; skip?: [number, number][] }) => {
    let x = x0;
    while (x < x1) {
      const gap = (o.skip ?? []).find(([a]) => a === x);
      if (gap) { x = gap[1]; continue; }
      let w = 12 + Math.floor(R() * 10);
      const nextSkip = (o.skip ?? []).map(([a]) => a).filter((a) => a > x).sort((a, b) => a - b)[0] ?? x1;
      const lim = Math.min(x1, nextSkip);
      if (lim - (x + w) < 10) w = lim - x;
      const gates = (o.gates ?? []).filter((g) => g >= x && g + 3 <= x + w).map((g) => g - x);
      const shops: { x: number; w: number; sign?: string }[] = [];
      if (o.shops) {
        for (let sx = 1; sx + 3 < w; sx += 5 + Math.floor(R() * 3)) {
          if (gates.some((g) => sx + 3 > g - 1 && sx < g + 4)) continue;
          if (R() < 0.55) shops.push({ x: sx, w: 2, sign: R() < 0.6 ? SIGNS[Math.floor(R() * SIGNS.length)] : undefined });
        }
      }
      const [s0, s1] = o.storeys ?? [4, 5];
      addBuilding({
        id: `t${tid++}`, kind: "tenement", x, y, w, d, street,
        storeys: s0 + Math.floor(R() * (s1 - s0 + 1)),
        roof: o.roof ?? (R() < 0.7 ? "tin" : "tar"),
        plaster: PLASTER[Math.floor(R() * PLASTER.length)],
        front: { gateways: gates, shops, balconies: R() < 0.4, lit: o.lit ?? 0.12 },
        cuttable: o.cuttable,
      });
      x += w;
    }
  };

  // North of Długa, west to east
  row(0, PRZEJAZD.w, 0, DLUGA.n, -1, { cuttable: false, storeys: [3, 4] });
  // The Arsenal (Długa 52): the Municipal Archive in 1943; arcades along its east wing
  addBuilding({
    id: "arsenal", kind: "arsenal", x: ARSENAL.x, y: ARSENAL.y, w: ARSENAL.w, d: ARSENAL.d, street: STREET.dluga,
    storeys: 2, roof: "tile", plaster: "cream", cuttable: false,
    front: { gateways: [30], lit: 0.08 },
    courtyard: { x: 12, y: 12, w: ARSENAL.w - 12 - ARCADE - 12, d: ARSENAL.d - 24 },
  });
  // the arcaded walkway: under the roof, open to Nalewki, pillars every 4 m
  fillRect(NAL.w - ARCADE, ARSENAL.y + 2, ARCADE, ARSENAL.d - 2, (i, cx, cy) => {
    const pillar = cx === NAL.w - 1 && (cy - ARSENAL.y) % 4 === 0;
    md.flags[i] = pillar ? F_SIGHT : F_WALK | F_ROOF;
    md.ground[i] = pillar ? M.under : M.walk;
    md.building[i] = pillar ? md.building[i] : -1;
    md.street[i] = STREET.arcade;
  });
  // behind the wall on Przejazd: the ghetto side, never entered
  row(PRZEJAZD.e, ARSENAL.x, 0, DLUGA.n, -1, { cuttable: false, storeys: [3, 4] });
  // Pasaż Simonsa: the newer block up Nalewki; the corner is a ruin
  addBuilding({
    id: "simons", kind: "simons", x: NAL.e, y: 0, w: 34, d: 40, street: STREET.ruins,
    storeys: 6, roof: "tin", plaster: "stone", cuttable: false,
    front: { shops: [{ x: 3, w: 2, sign: "PASAŻ SIMONSA" }, { x: 12, w: 2 }, { x: 20, w: 2 }, { x: 27, w: 2 }], lit: 0.25 },
  });
  // north side east of the ruins: tenements, then the Pałac pod Czterema Wiatrami (the Arbeitsamt)
  row(NAL.e + 34, 196, 36, DLUGA.n - 36, STREET.dluga, { cuttable: false, shops: true });
  addBuilding({
    id: "arbeitsamt", kind: "tenement", x: 196, y: 40, w: 32, d: DLUGA.n - 40, street: STREET.dluga,
    storeys: 2, roof: "tile", plaster: "cream", cuttable: false,
    front: { gateways: [14], doors: [6, 24], lit: 0.4 },
  });
  row(228, W, 36, DLUGA.n - 36, STREET.dluga, { cuttable: false, shops: true });
  row(NAL.e + 34, W, 0, 36, -1, { cuttable: false, storeys: [3, 5] });

  // South of Długa, west of Bielańska: the front row opposite the Arsenal (Długa 53..45),
  // one of them a 1939 ruin; a courtyard; the Tłomackie row
  row(0, BIEL.w, DLUGA.s, 12, STREET.dluga, { cuttable: true, shops: true, gates: [20, 100], skip: [[58, 70]] });
  row(0, BIEL.w - 12, 116, TLOM.n - 116, STREET.yardSW, { cuttable: true, shops: true, skip: [[58, 70]] });
  // the west side of Bielańska between Długa's front row and Tłomackie
  row(BIEL.w - 12, BIEL.w, DLUGA.s + 12, TLOM.n - DLUGA.s - 12, STREET.bielanska, { cuttable: false, shops: true });
  ground(58, 116, 12, TLOM.n - 116, "yard", STREET.yardSW); // the way through to Tłomackie
  row(0, TLOM.x0, TLOM.n, TLOM.s - TLOM.n, STREET.tlomackie, { cuttable: false });
  row(0, BIEL.w, TLOM.s, H - TLOM.s, STREET.tlomackie, { cuttable: true, shops: true });
  // South of Długa, east of Bielańska: the corner restaurant (Jur's telephone), houses, a yard
  addBuilding({
    id: "restaurant", kind: "tenement", x: BIEL.e, y: DLUGA.s, w: 14, d: 12, street: STREET.dluga,
    storeys: 4, roof: "tin", plaster: "ochre", cuttable: true,
    front: { shops: [{ x: 2, w: 3, sign: "RESTAURACJA" }], lit: 0.3 },
  });
  row(BIEL.e + 14, W, DLUGA.s, 12, STREET.dluga, { cuttable: true, shops: true, gates: [176] });
  row(BIEL.e, BIEL.e + 12, DLUGA.s + 12, 140 - DLUGA.s - 12, STREET.bielanska, { cuttable: false, shops: true });
  row(BIEL.e + 12, W, 116, 24, STREET.yardSE, { cuttable: true });
  // the Bank Polski, Bielańska 10, on the east side further south
  addBuilding({
    id: "bank", kind: "tenement", x: BIEL.e, y: 140, w: 44, d: H - 140, street: -1,
    storeys: 3, roof: "tin", plaster: "stone", cuttable: false,
    front: { doors: [20], lit: 0.2 },
  });
  row(BIEL.e + 44, W, 140, H - 140, -1, { cuttable: false });

  // ---- props --------------------------------------------------------------------------------------
  const prop = (p: MapProp) => {
    md.props.push(p);
    if (!p.block) return;
    fillRect(p.x + p.block.dx, p.y + p.block.dy, p.block.w, p.block.h, (i) => {
      if (p.block!.flags & F_SIGHT) md.flags[i] = F_SIGHT;
      else md.flags[i] = (md.flags[i] & ~F_WALK) | p.block!.flags;
    });
  };
  const B1 = (flags = F_COVER) => ({ dx: -0.5, dy: -0.5, w: 1, h: 1, flags });
  const cB = (BIEL.w + BIEL.e) / 2, cN = (NAL.w + NAL.e) / 2;
  // lamps
  for (let x = 6; x < W; x += 20) { prop({ kind: "lamp", x: x + 0.5, y: DLUGA.n + 1.2 }); prop({ kind: "lamp", x: x + 10.5, y: DLUGA.s - 1.2 }); }
  for (let y = 96; y < H; y += 18) { prop({ kind: "lamp", x: BIEL.w + 1, y: y + 0.5 }); prop({ kind: "lamp", x: BIEL.e - 1, y: y + 9.5 }); }
  // street signs
  prop({ kind: "street_sign", x: BIEL.w - 0.6, y: DLUGA.s + 0.6, variant: "BIELAŃSKA" });
  prop({ kind: "street_sign", x: NAL.e + 0.6, y: DLUGA.n - 0.6, variant: "NALEWKI" });
  prop({ kind: "street_sign", x: 60, y: DLUGA.s - 0.6, variant: "DŁUGA" });
  prop({ kind: "street_sign", x: PRZEJAZD.e + 0.6, y: DLUGA.n - 0.6, variant: "PRZEJAZD" });
  prop({ kind: "street_sign", x: BIEL.w - 0.6, y: TLOM.s + 0.6, variant: "TŁOMACKIE" });
  prop({ kind: "ad_column", x: BIEL.e + 1.4, y: DLUGA.s + 1.6, block: B1(F_SIGHT) });
  // Sygnalizacja's three posts: Jur's telephone (restaurant door), Kuba at the mouth of
  // Tłomackie, Kadłubek at the kerb by the Bank Polski
  prop({ kind: "phone_box", x: BIEL.e + 5, y: DLUGA.s - 1.3, tag: "post_phone" });
  prop({ kind: "tram_stop", x: BIEL.w + 1.2, y: TLOM.n - 1.5, tag: "post_tlomackie" });
  prop({ kind: "bench", x: BIEL.e - 1.2, y: 146, tag: "post_bank" });
  prop({ kind: "kiosk", x: BIEL.w + 1.6, y: 110, block: { dx: -1, dy: -1, w: 2, h: 2, flags: F_SIGHT } });
  for (const [x, y] of [[BIEL.w + 2.5, 100], [BIEL.e - 2.5, 122], [BIEL.w + 2.5, 152], [40, DLUGA.s - 3.5], [150, DLUGA.n + 3.5], [212, DLUGA.s - 3.5]] as const)
    prop({ kind: "snow_heap", x, y, block: { dx: -1, dy: -0.5, w: 2, h: 1, flags: F_COVER } });
  // the ruins at the Simons corner and opposite the Arsenal: rubble for cover
  for (const [x, y] of [[104, 48], [112, 58], [120, 50], [126, 62], [108, 64], [62, 94], [66, 104], [61, 112]] as const)
    prop({ kind: "crates", x, y, variant: "rubble", block: B1(F_COVER) });
  // Getto: the police post at the ghetto wall on Przejazd, its telephone line along the Arsenal
  for (let x = PRZEJAZD.w; x < PRZEJAZD.e; x += 2)
    prop({ kind: "ghetto_wall", x: x + 1, y: GHETTO_WALL_Y + 0.5, block: { dx: -1, dy: -0.5, w: 2, h: 1, flags: F_SIGHT } });
  prop({ kind: "sandbags", x: 12, y: GHETTO_WALL_Y + 5, block: { dx: -2, dy: -0.5, w: 4, h: 1, flags: F_COVER }, tag: "post_wall" });
  for (const y of [34, 46, 58]) prop({ kind: "phone_pole", x: PRZEJAZD.e - 0.6, y, tag: `pole_${y}` });
  for (const x of [22, 36, 50]) prop({ kind: "phone_pole", x, y: DLUGA.n + 0.7, tag: `pole_d${x}` });
  prop({ kind: "phone_box", x: 56, y: DLUGA.n + 1.2, block: B1(F_SIGHT), tag: "line_box" });
  prop({ kind: "dorozka", x: 32, y: DLUGA.s - 4.5, block: { dx: -2, dy: -0.6, w: 4, h: 1.2, flags: F_COVER } });
  // Stare Miasto: barrels by the post, a cart, the Arbeitsamt's sandbags
  for (const [x, y] of [[182, 84], [183.2, 84.6], [181, 85.2]] as const) prop({ kind: "barrel", x, y, block: B1(F_COVER), tag: "barrels" });
  prop({ kind: "cart", x: 170, y: DLUGA.s - 2, block: { dx: -1, dy: -0.5, w: 2, h: 1, flags: F_COVER } });
  prop({ kind: "sandbags", x: 212, y: DLUGA.n + 2.2, block: { dx: -2, dy: -0.5, w: 4, h: 1, flags: F_COVER }, tag: "arbeitsamt_post" });
  // courtyards: barrels, crates, bare trees
  for (const [x, y] of [[8, 104], [30, 108], [90, 104], [160, 104], [200, 110], [40, 30], [70, 36]] as const)
    prop({ kind: R() < 0.5 ? "barrel" : "crates", x, y, block: B1(F_COVER) });
  for (const [x, y] of [[20, 106], [150, 108], [46, 40], [62, 50]] as const) prop({ kind: "tree", x, y, block: B1(F_COVER) });
  for (const x of [26, 38, 62, 74, 83]) prop({ kind: "tree", x, y: DLUGA.n - LAWN / 2, block: B1(F_COVER) });

  // ---- zones and routes ---------------------------------------------------------------------------
  md.zones.push(
    { name: "task_signal", x: TLOM.x0 + 30, y: DLUGA.s - 2, w: 190 - TLOM.x0 - 30, h: H - DLUGA.s + 2 },
    { name: "task_ghetto", x: 0, y: GHETTO_WALL_Y + 1, w: 80, h: 100 - GHETTO_WALL_Y - 1 },
    { name: "task_oldtown", x: 146, y: 30, w: W - 146, h: 90 },
    { name: "finale", x: 0, y: 0, w: W, h: H },
    { name: "bend", x: NAL.w - 8, y: DLUGA.n, w: BIEL.e - NAL.w + 8, h: DLUGA.s - DLUGA.n },
    { name: "car_start", x: BIEL.e + 2, y: DLUGA.s - 6, w: 6, h: 5 },
    { name: "exit_east", x: W - 5, y: DLUGA.n, w: 5, h: DLUGA.s - DLUGA.n },
    { name: "exit_west", x: 0, y: DLUGA.n, w: 5, h: DLUGA.s - DLUGA.n },
    { name: "exit_south", x: BIEL.w, y: H - 5, w: BIEL.e - BIEL.w, h: 5 },
    { name: "exit_tlomackie", x: TLOM.x0, y: TLOM.n, w: 5, h: TLOM.s - TLOM.n },
  );
  md.paths.push(
    // up the east half of Bielańska, left into Długa (north half, heading west), right into Nalewki
    { name: "truck", pts: [{ x: cB + 2, y: H + 6 }, { x: cB + 2, y: 81 }, { x: cB - 6, y: 77 }, { x: cN + 3, y: 77 }, { x: cN + 1.5, y: 70 }, { x: cN + 1.5, y: -8 }] },
    // the swerve: straight on west along Długa (what happened on the day)
    { name: "truck_swerve", pts: [{ x: cN - 10, y: 77 }, { x: 40, y: 77.5 }, { x: 10, y: 78 }] },
    { name: "patrol_signal", pts: [{ x: BIEL.w + 1, y: 96 }, { x: BIEL.w + 1, y: 160 }, { x: BIEL.e - 1, y: 160 }, { x: BIEL.e - 1, y: 96 }] },
    { name: "patrol_ghetto", pts: [{ x: 4, y: DLUGA.s - 2 }, { x: 64, y: DLUGA.s - 2 }] },
    { name: "patrol_oldtown", pts: [{ x: 150, y: DLUGA.s - 1.5 }, { x: 226, y: DLUGA.s - 1.5 }] },
    { name: "motorcycles", pts: [{ x: W + 8, y: 75 }, { x: 150, y: 75 }, { x: cB, y: 75 }, { x: cB, y: H + 8 }] },
    { name: "wehrmacht_truck", pts: [{ x: W + 8, y: 84 }, { x: 186, y: 84 }] },
    { name: "wehrmacht_leave", pts: [{ x: 150, y: 84 }, { x: cB - 2, y: 84 }, { x: cB - 2, y: H + 8 }] },
    { name: "car_escape", pts: [{ x: 160, y: 80 }, { x: W + 10, y: 80 }] },
    { name: "reinf_west", pts: [{ x: PRZEJAZD.w + 3, y: GHETTO_WALL_Y + 2 }, { x: PRZEJAZD.w + 3, y: 76 }, { x: 30, y: 76 }] },
    { name: "reinf_north", pts: [{ x: cN, y: -4 }, { x: cN, y: 40 }] },
    { name: "reinf_south", pts: [{ x: cB - 2, y: H + 6 }, { x: cB - 2, y: 120 }] },
  );
  return md;
}
