// Art lab: troopers (style guide §6). Every body's sheet as anims x facings, line-ups of looks,
// Rudy, civilians, portraits, an 8-direction walk, build timings and the bake-off contact sheet.
//   ?only=troopers                 everything
//   ?only=troopers&tsec=heads,walk8   just those groups (grid, heads, bodies, partisans,
//                                  occupiers, others, portraits, walk8, bakeoff, timing)
import type { LabItem, LabSection } from "../main";
import { blit, img, mirrorX, type PixelImage, type Sheet } from "../../art/pixel";
import { buildTrooperSheet, TROOPER_ANIMS, __trooperInternals } from "../../art/troopers";
import { buildPortrait } from "../../art/portraits";
import { ANIM_FRAMES, FACINGS, type Anim, type Facing, type Headgear, type TrooperLook } from "../../art/types";

// art.html has no icon link, so Chrome asks for /favicon.ico, gets a 404 and the shot harness
// counts it as a page error. A data: icon keeps the lab's error count about the art.
if (typeof document !== "undefined" && !document.querySelector("link[rel~='icon']")) {
  const l = document.createElement("link");
  l.rel = "icon";
  l.href = "data:,";
  document.head.append(l);
}

const CELL = 24;
const ANIMS = Object.keys(ANIM_FRAMES) as Anim[];
const BG = "#8a857a"; // a mid cobble grey, so the outline reads as it will on the street

function frame(sheet: Sheet, name: string): PixelImage {
  const f = sheet.frames.find((q) => q.name === name);
  if (!f) throw new Error(`no frame ${name}`);
  const out = img(f.w, f.h);
  blit(out, sheet.image, 0, 0, { sx: f.x, sy: f.y, sw: f.w, sh: f.h });
  return out;
}

/** One animation: frames left to right, facings top to bottom. */
function animGrid(sheet: Sheet, anim: Anim): PixelImage {
  const n = ANIM_FRAMES[anim];
  const out = img(n * CELL, FACINGS.length * CELL);
  FACINGS.forEach((f, r) => {
    for (let i = 0; i < n; i++) blit(out, frame(sheet, `${anim}_${f}_${i}`), i * CELL, r * CELL);
  });
  return out;
}

/** Every animation side by side (a gap between them), facings top to bottom. */
function sheetGrid(sheet: Sheet, anims: Anim[] = ANIMS, gap = 4): PixelImage {
  const cols = anims.reduce((n, a) => n + ANIM_FRAMES[a], 0);
  const out = img(cols * CELL + (anims.length - 1) * gap, FACINGS.length * CELL);
  let x = 0;
  for (const a of anims) {
    blit(out, animGrid(sheet, a), x, 0);
    x += ANIM_FRAMES[a] * CELL + gap;
  }
  return out;
}

function row(images: PixelImage[], gap = 2): PixelImage {
  const w = images.reduce((n, im) => n + im.w, 0) + gap * (images.length - 1);
  const h = Math.max(...images.map((im) => im.h));
  const out = img(w, h);
  let x = 0;
  for (const im of images) { blit(out, im, x, h - im.h); x += im.w + gap; }
  return out;
}

function column(images: PixelImage[], gap = 2): PixelImage {
  const h = images.reduce((n, im) => n + im.h, 0) + gap * (images.length - 1);
  const w = Math.max(...images.map((im) => im.w));
  const out = img(w, h);
  let y = 0;
  for (const im of images) { blit(out, im, 0, y); y += im.h + gap; }
  return out;
}

/** A look at a glance: standing in every facing, then walking, firing and down. */
function strip(sheet: Sheet, armed: boolean): PixelImage {
  const names = ["idle_s_0", "idle_se_0", "idle_e_0", "idle_ne_0", "idle_n_0", "walk_se_0", "walk_e_2", armed ? "fire_e_0" : "walk_s_0", "death_e_4"];
  return row(names.map((n) => frame(sheet, n)), 0);
}

const ANIM_LABEL = ANIMS.map((a) => `${a} ${ANIM_FRAMES[a]}f ${TROOPER_ANIMS[a].fps}fps${TROOPER_ANIMS[a].loop ? " loop" : ""}`).join(" | ");

const P = (o: Partial<TrooperLook> & Pick<TrooperLook, "headgear" | "weapon">): TrooperLook => ({ body: "partisan", kit: "none", armband: true, jacket: 0, seed: 1, ...o });

/** About fifteen partisans: every jacket, headgear, weapon and kit in play. */
export const PARTISANS: [string, TrooperLook][] = [
  ["rifleman", P({ headgear: "cap", weapon: "sten", jacket: 0, seed: 3 })],
  ["scout", P({ headgear: "cap", weapon: "sten", kit: "binoculars", jacket: 1, seed: 4 })],
  ["sniper", P({ headgear: "hat", weapon: "rifle", jacket: 1, seed: 5 })],
  ["sapper", P({ headgear: "helmet_wz31", weapon: "sten", kit: "charge_pack", jacket: 2, seed: 6 })],
  ["rookie", P({ headgear: "stahlhelm_big", weapon: "pistol", jacket: 3, seed: 7 })],
  ["Butelki", P({ headgear: "beret", weapon: "pistol", kit: "bottle_bag", jacket: 0, seed: 8 })],
  ["grenadier", P({ headgear: "cap", weapon: "pistol", kit: "grenade_pouch", jacket: 3, seed: 9 })],
  ["driver", P({ headgear: "cap", weapon: "pistol", kit: "driver_tag", jacket: 2, seed: 10 })],
  ["leader", P({ headgear: "hat", weapon: "sten", jacket: 3, seed: 11 })],
  ["bare-headed", P({ headgear: "bare", weapon: "sten", jacket: 1, seed: 12 })],
  ["beret, sten", P({ headgear: "beret", weapon: "sten", jacket: 2, seed: 13 })],
  ["wz.31, rifle", P({ headgear: "helmet_wz31", weapon: "rifle", jacket: 0, seed: 14 })],
  ["captured MP 40", P({ headgear: "cap", weapon: "mp40", kit: "grenade_pouch", jacket: 1, seed: 15 })],
  ["captured helmet", P({ headgear: "stahlhelm", weapon: "mp40", jacket: 2, seed: 16 })],
  ["no armband", P({ headgear: "hat", weapon: "pistol", jacket: 0, seed: 17, armband: false })],
];

export const OCCUPIERS: [string, TrooperLook][] = [
  ["rifleman", { body: "occupier", headgear: "stahlhelm", weapon: "rifle", kit: "none", seed: 21 }],
  ["MP 40", { body: "occupier", headgear: "stahlhelm", weapon: "mp40", kit: "grenade_pouch", seed: 22 }],
  ["officer", { body: "occupier", headgear: "peaked_cap", weapon: "pistol", kit: "none", seed: 23 }],
  ["Gestapo, MP 40", { body: "occupier", headgear: "peaked_cap", weapon: "mp40", kit: "none", seed: 24 }],
];

export const OTHERS: [string, TrooperLook][] = [
  ["prisoner", { body: "prisoner", headgear: "bare", weapon: "none", kit: "none", seed: 31 }],
  ["Rudy (after Szucha)", { body: "prisoner", headgear: "bare", weapon: "none", kit: "none", seed: 32, beaten: true }],
  ["man, hat", { body: "civilian_m", headgear: "hat", weapon: "none", kit: "none", jacket: 0, seed: 33 }],
  ["man, cap", { body: "civilian_m", headgear: "cap", weapon: "none", kit: "none", jacket: 1, seed: 34 }],
  ["old man", { body: "civilian_m", headgear: "bare", weapon: "none", kit: "none", jacket: 2, seed: 40 }],
  ["woman, headscarf", { body: "civilian_f", headgear: "headscarf", weapon: "none", kit: "none", jacket: 0, seed: 35 }],
  ["woman, hat", { body: "civilian_f", headgear: "hat", weapon: "none", kit: "none", jacket: 1, seed: 36 }],
  ["woman, headscarf 2", { body: "civilian_f", headgear: "headscarf", weapon: "none", kit: "none", jacket: 3, seed: 37 }],
];

/** ?tsec=heads,grid renders only those groups (all when absent). */
const want = (key: string): boolean => {
  const q = typeof location !== "undefined" ? new URLSearchParams(location.search).get("tsec") : null;
  return !q || q.split(",").includes(key);
};

function timeBuilds(looks: TrooperLook[]): { first: number; mean: number; median: number; max: number; n: number } {
  const t: number[] = [];
  for (const l of looks) {
    const t0 = performance.now();
    buildTrooperSheet(l);
    t.push(performance.now() - t0);
  }
  const first = t[0];
  const rest = t.slice(1).sort((a, b) => a - b);
  const mean = rest.reduce((a, b) => a + b, 0) / Math.max(1, rest.length);
  return { first, mean, median: rest[rest.length >> 1] ?? first, max: rest[rest.length - 1] ?? first, n: t.length };
}

export default function troopers(): LabSection[] {
  const sections: LabSection[] = [];
  const all = [...PARTISANS, ...OCCUPIERS, ...OTHERS].map(([, l]) => l);

  if (want("timing") || want("grid")) {
    // the game builds about 30 sheets at boot: time 30, the first one cold
    const looks = Array.from({ length: 30 }, (_, i) => ({ ...all[i % all.length], seed: 100 + i }));
    const tm = timeBuilds(looks);
    sections.push({
      title: `timing: ${tm.n} sheets (${__trooperInternals.PER_FACING * FACINGS.length} frames each): first ${tm.first.toFixed(2)} ms, then mean ${tm.mean.toFixed(2)} ms, median ${tm.median.toFixed(2)} ms, max ${tm.max.toFixed(2)} ms per sheet (budget 8 ms)`,
      items: [],
    });
  }

  const rifleman = PARTISANS[0][1];
  const sheet = buildTrooperSheet(rifleman);
  if (want("grid")) {
    sections.push({ title: `partisan rifleman (cap, sten): each animation, rows s se e ne n`, items: ANIMS.map((a) => ({ label: `${a} (${ANIM_FRAMES[a]} @ ${TROOPER_ANIMS[a].fps} fps${TROOPER_ANIMS[a].loop ? ", loop" : ""})`, image: animGrid(sheet, a), bg: BG, scale: 5 })) });
  }

  if (want("bodies")) {
    const bodies: [string, TrooperLook][] = [["partisan", rifleman], OCCUPIERS[0], OTHERS[0], OTHERS[2], OTHERS[5]];
    sections.push({
      title: `every body, all anims x facings (${ANIM_LABEL})`,
      items: bodies.map(([name, l]) => ({ label: `${l.body}: ${name}`, image: sheetGrid(buildTrooperSheet(l)), bg: BG, scale: 3 })),
    });
  }

  const lineup = (list: [string, TrooperLook][]): LabItem[] =>
    list.map(([name, l]) => ({ label: `${name}: ${l.headgear}, ${l.weapon}${l.kit !== "none" ? ", " + l.kit : ""}${l.jacket !== undefined ? ", jacket " + l.jacket : ""}`, image: strip(buildTrooperSheet(l), l.weapon !== "none"), bg: BG, scale: 3 }));
  if (want("partisans")) sections.push({ title: "partisans: fifteen looks (idle s se e ne n, walk, fire, down)", items: lineup(PARTISANS) });
  if (want("occupiers")) sections.push({ title: "occupiers: Stahlhelm and field grey, no insignia; the officer's peaked cap", items: lineup(OCCUPIERS) });
  if (want("others")) sections.push({ title: "prisoner, Rudy after Szucha, civilians", items: lineup(OTHERS) });

  if (want("heads")) {
    const gears: [Headgear, TrooperLook["body"]][] = [
      ["cap", "partisan"], ["hat", "partisan"], ["beret", "partisan"], ["bare", "partisan"], ["helmet_wz31", "partisan"],
      ["stahlhelm", "occupier"], ["stahlhelm_big", "partisan"], ["peaked_cap", "occupier"], ["headscarf", "civilian_f"],
    ];
    sections.push({
      title: "heads: headgear x facings (s se e ne n)",
      items: gears.map(([g, body]) => ({ label: g, image: row(FACINGS.map((f) => __trooperInternals.headImage({ ...rifleman, headgear: g, body }, f)), 1), bg: BG, scale: 6 })),
    });
  }

  if (want("walk8")) {
    // walk in 8 directions: e-side drawn, the west mirrored here as the game does
    const dirs: [string, Facing, boolean][] = [["s", "s", false], ["se", "se", false], ["e", "e", false], ["ne", "ne", false], ["n", "n", false], ["nw", "ne", true], ["w", "e", true], ["sw", "se", true]];
    const items: LabItem[] = [PARTISANS[0], OCCUPIERS[0], OTHERS[5]].map(([name, l]) => {
      const sh = buildTrooperSheet(l);
      const strips = dirs.map(([, f, m]) => row([0, 1, 2, 3].map((i) => { const fr = frame(sh, `walk_${f}_${i}`); return m ? mirrorX(fr) : fr; }), 0));
      return { label: `${name}: s, se, e, ne, n, nw, w, sw`, image: row(strips, 6), bg: BG, scale: 3 };
    });
    sections.push({ title: "walk in 8 directions (the west mirrored from the east side)", items });
  }

  if (want("portraits")) {
    const items: LabItem[] = [];
    for (const [name, l] of [...PARTISANS.slice(0, 10), OTHERS[1], OCCUPIERS[2]]) items.push({ label: name, image: buildPortrait(l, l.seed ?? 0), bg: BG, scale: 4 });
    for (let s = 0; s < 6; s++) items.push({ label: `rifleman, seed ${s}`, image: buildPortrait(rifleman, s), bg: BG, scale: 4 });
    sections.push({ title: "portraits: 24 x 28 busts for briefing cards and identity tags", items });
  }

  if (want("bakeoff")) {
    // style guide §10: one partisan rifleman (cap, sten), idle plus the 4-frame walk, 5 facings
    const rows = FACINGS.map((f) => row([frame(sheet, `idle_${f}_0`), ...[0, 1, 2, 3].map((i) => frame(sheet, `walk_${f}_${i}`))], 0));
    const contact = column(rows, 0);
    sections.push({ title: "bake-off: pixel templates, partisan rifleman (cap, sten): idle | walk 0-3, rows s se e ne n", items: [{ label: "contact sheet", image: contact, bg: BG, scale: 4 }] });
  }
  return sections;
}
