// Art lab: the city (src/art/city). A composed street (Długa, 26 March 1943, about 17:00):
// an east-west street with pavements and a double tram line, a north-south street crossing
// it, tenements and the Arsenal on the far (north) side drawn full, the near (south) side
// drawn cut with ghosts. Then every building variant full and cut, the ground materials, the
// sign font, and the time the painter takes for a 250 x 180 m map in this browser.
import { PAL } from "../../art/palette";
import type { PixelImage } from "../../art/pixel";
import { blit, crop, hline, img, rect } from "../../art/pixel";
import type { BuildingArt, BuildingSpec, GroundGrid, GroundMat } from "../../art/types";
import { buildArsenal, type ArsenalSpec } from "../../art/city/arsenal";
import { buildBuilding } from "../../art/city/buildings";
import { drawText, FONT_CHARS } from "../../art/city/font";
import { paintGround } from "../../art/city/ground";
import type { LabItem, LabSection } from "../main";

const LEGEND: GroundMat[] = ["road", "walk", "yard", "rail_ew", "rail_ns", "under", "square"];
const M = Object.fromEntries(LEGEND.map((m, i) => [m, i])) as Record<GroundMat, number>;

/** A grid painted with rectangles, later ones on top. */
function grid(w: number, h: number, fill: GroundMat, rects: [number, number, number, number, GroundMat][]): GroundGrid {
  const cells = new Uint8Array(w * h).fill(M[fill]);
  for (const [x0, y0, x1, y1, m] of rects) {
    for (let y = Math.max(0, y0); y < Math.min(h, y1); y++) for (let x = Math.max(0, x0); x < Math.min(w, x1); x++) cells[y * w + x] = M[m];
  }
  return { w, h, cells, legend: LEGEND };
}

// ------------------------------------------------------------------ the street

const TOP = 64; // room above the map for the tallest buildings

const NORTH: BuildingSpec[] = [
  { id: "n1", x: 0, y: 10, w: 12, d: 12, storeys: 4, roof: "tin", plaster: "ochre", front: { shops: [{ x: 1, w: 2, sign: "PIEKARNIA" }], gateways: [7.5], lit: 0.15 }, cuttable: false, seed: 101 },
  { id: "n2", x: 12, y: 10, w: 14, d: 12, storeys: 5, roof: "tar", plaster: "cream", front: { shops: [{ x: 1, w: 1.8, sign: "APTEKA" }, { x: 10.5, w: 2, sign: "FRYZJER" }], gateways: [5.5], balconies: true, lit: 0.2 }, cuttable: false, seed: 102 },
];
const ARSENAL: ArsenalSpec = {
  id: "arsenal", x: 38, y: 0, w: 38, d: 22, storeys: 2, roof: "tile", plaster: "cream", front: { lit: 0.12 },
  cuttable: true, seed: 1643, courtyard: { x: 10, y: 6, w: 18, d: 8 },
};
const SOUTH: BuildingSpec[] = [
  { id: "s1", x: 0, y: 42, w: 10, d: 12, storeys: 4, roof: "tar", plaster: "green", front: { doors: [2], shops: [{ x: 5.5, w: 2, sign: "KAWIARNIA" }], lit: 0.1 }, cuttable: true, seed: 201 },
  { id: "s2", x: 10, y: 42, w: 16, d: 12, storeys: 5, roof: "tin", plaster: "brick", front: { gateways: [6.5], shops: [{ x: 1.5, w: 2, sign: "ZEGARMISTRZ" }], balconies: true, lit: 0.15 }, cuttable: true, seed: 202 },
  { id: "s3", x: 38, y: 42, w: 12, d: 12, storeys: 3, roof: "tin", plaster: "stone", front: { doors: [5], lit: 0.1 }, cuttable: true, seed: 203 },
  { id: "s4", x: 50, y: 42, w: 10, d: 12, storeys: 4, roof: "tar", plaster: "ochre", front: { shops: [{ x: 1, w: 2, sign: "SKLEP" }], doors: [6], lit: 0.2 }, cuttable: true, seed: 204 },
];

function streetGrid(): GroundGrid {
  const W = 76, H = 60;
  const r: [number, number, number, number, GroundMat][] = [
    [0, 0, W, 10, "yard"],
    [0, 54, W, H, "yard"],
    // north-south street: pavements and road, all the way through
    [26, 0, 28, H, "walk"], [36, 0, 38, H, "walk"], [28, 0, 36, H, "road"],
    // east-west street: pavements, road, the double tram line
    [0, 22, 28, 26, "walk"], [36, 22, W, 26, "walk"],
    [0, 26, W, 38, "road"], [0, 29, W, 35, "rail_ew"],
    [0, 38, 28, 42, "walk"], [36, 38, W, 42, "walk"],
    // a strip of square in the south block
    [60, 42, W, 54, "square"],
  ];
  for (const b of [...NORTH, ARSENAL, ...SOUTH]) r.push([b.x, b.y, b.x + b.w, b.y + b.d, "under"]);
  const c = ARSENAL.courtyard!;
  r.push([ARSENAL.x + c.x, ARSENAL.y + c.y, ARSENAL.x + c.x + c.w, ARSENAL.y + c.y + c.d, "yard"]);
  return grid(W, H, "under", r);
}

function place(dst: PixelImage, art: BuildingArt, b: BuildingSpec, cut: boolean): void {
  blit(dst, cut && art.cut ? art.cut : art.full, b.x * 12, Math.round(b.y * 9 - art.h * 7.5) + TOP);
}

function street(): { image: PixelImage; ms: number } {
  const g = streetGrid();
  const t0 = performance.now();
  const ground = paintGround(g, 1943);
  const ms = performance.now() - t0;
  const out = img(g.w * 12, g.h * 9 + TOP);
  rect(out, 0, 0, out.w, TOP, PAL.city_1943.soot[0]);
  blit(out, ground, 0, TOP);
  // drawing order by the south edge of each footprint (style guide §2)
  const all: [BuildingSpec, BuildingArt, boolean][] = [
    ...NORTH.map((b) => [b, buildBuilding(b), false] as [BuildingSpec, BuildingArt, boolean]),
    [ARSENAL, buildArsenal(ARSENAL), false],
    ...SOUTH.map((b) => [b, buildBuilding(b), true] as [BuildingSpec, BuildingArt, boolean]),
  ];
  all.sort((a, b) => a[0].y + a[0].d - (b[0].y + b[0].d));
  for (const [b, art, cut] of all) place(out, art, b, cut);
  return { image: out, ms };
}

// ------------------------------------------------------------------ swatches, font, timing

function swatches(): LabItem[] {
  const items: LabItem[] = [];
  const mats: GroundMat[] = ["road", "walk", "yard", "square", "rail_ew", "rail_ns"];
  for (const m of mats) items.push({ label: m, image: paintGround(grid(10, 8, m, []), 7) });
  // borders: pavement round a road corner, a yard opening onto a pavement, a square
  items.push({
    label: "borders: kerbs, corner, yard, square",
    image: paintGround(grid(24, 16, "road", [
      [0, 0, 10, 7, "walk"], [14, 0, 24, 7, "walk"], [0, 11, 10, 16, "walk"], [14, 11, 24, 16, "square"],
      [0, 0, 7, 4, "yard"], [16, 0, 24, 3, "under"], [2, 13, 8, 16, "under"], [11, 0, 13, 16, "rail_ns"],
    ]), 11),
  });
  return items;
}

function fontSheet(): PixelImage {
  const im = img(236, 44);
  rect(im, 0, 0, im.w, im.h, PAL.city_1943.soot[0]);
  drawText(im, FONT_CHARS.slice(0, 40), 2, 3, PAL.shared.chalk);
  drawText(im, FONT_CHARS.slice(40), 2, 13, PAL.shared.chalk);
  drawText(im, "PIEKARNIA APTEKA KAWIARNIA FRYZJER", 2, 24, PAL.city_1943.plaster_ochre[2]);
  drawText(im, "ZEGARMISTRZ SKLEP SPOŻYWCZY RZEŹNIK", 2, 34, PAL.city_1943.tram_cream[1]);
  hline(im, 0, im.w - 1, im.h - 1, PAL.shared.outline);
  return im;
}

/** Paint a 250 x 180 m ground of streets and blocks, as the demo map will be, and time it:
 *  the first paint of the page (cold: tables and JIT) and a second one (warm). */
function timeBigGround(): [number, number] {
  const W = 250, H = 180;
  const r: [number, number, number, number, GroundMat][] = [];
  for (let by = 0; by < H; by += 44) for (let bx = 0; bx < W; bx += 56) {
    r.push([bx, by, bx + 56, by + 44, "yard"], [bx + 16, by + 16, bx + 56, by + 30, "under"], [bx + 16, by + 16, bx + 30, by + 44, "under"]);
  }
  for (let y = 0; y < H; y += 44) r.push([0, y, W, y + 16, "walk"], [0, y + 3, W, y + 13, "road"], [0, y + 5, W, y + 11, "rail_ew"]);
  for (let x = 0; x < W; x += 56) r.push([x, 0, x + 16, H, "walk"], [x + 3, 0, x + 13, H, "road"]);
  r.push([100, 100, 130, 120, "square"]);
  const g = grid(W, H, "under", r);
  const t0 = performance.now();
  paintGround(g, 5);
  const t1 = performance.now();
  paintGround(g, 6);
  return [t1 - t0, performance.now() - t1];
}

// ------------------------------------------------------------------ sections

const VARIANTS: BuildingSpec[] = [
  { id: "v1", x: 0, y: 0, w: 14, d: 12, storeys: 4, roof: "tin", plaster: "ochre", front: { shops: [{ x: 1, w: 2, sign: "PIEKARNIA" }], gateways: [6], balconies: true, lit: 0.2 }, cuttable: true, seed: 11 },
  { id: "v2", x: 0, y: 0, w: 12, d: 12, storeys: 5, roof: "tar", plaster: "cream", front: { shops: [{ x: 1, w: 1.8, sign: "APTEKA" }, { x: 8.5, w: 2, sign: "FRYZJER" }], doors: [5], balconies: true, lit: 0.15 }, cuttable: true, seed: 22 },
  { id: "v3", x: 0, y: 0, w: 10, d: 12, storeys: 3, roof: "tin", plaster: "green", front: { doors: [4], lit: 0.1 }, cuttable: true, seed: 33 },
  { id: "v4", x: 0, y: 0, w: 16, d: 13, storeys: 4, roof: "tin", plaster: "brick", front: { shops: [{ x: 1.5, w: 2, sign: "ZEGARMISTRZ" }], gateways: [9], lit: 0.1 }, cuttable: true, seed: 44 },
  { id: "v5", x: 0, y: 0, w: 12, d: 12, storeys: 5, roof: "tar", plaster: "stone", front: { shops: [{ x: 7, w: 2, sign: "KAWIARNIA" }], doors: [2], balconies: true, lit: 0.3 }, cuttable: true, seed: 55 },
  { id: "v6", x: 0, y: 0, w: 8, d: 10, storeys: 3, roof: "tile", plaster: "ochre", front: { shops: [{ x: 1, w: 2, sign: "SKLEP SPOŻYWCZY" }], lit: 0.4 }, cuttable: true, seed: 66 },
];

export default function (): LabSection[] {
  const [cold, warm] = timeBigGround(); // first, so the cold number really is the page's first paint
  const s = street();
  const phone = crop(s.image, 200, TOP + 60, 568, 262);
  const bg = "#3a3530";
  const arsenal = buildArsenal({ ...ARSENAL, x: 0, y: 0 });
  return [
    {
      title: `street: Długa, 26 March 1943, 17:00 (a 250 x 180 m ground paints in ${cold.toFixed(0)} ms cold, ${warm.toFixed(0)} ms warm, in this browser)`,
      items: [
        { label: "street at 1x (north side full, south side cut)", image: s.image, scale: 1, bg },
        { label: "street at 2x", image: s.image, scale: 2, bg },
        { label: "the phone's view (568 x 262 art px) at 2x", image: phone, scale: 2, bg },
      ],
    },
    {
      title: "the Arsenal (Długa 52): full and cut",
      items: [
        { label: "Arsenal full", image: arsenal.full, bg },
        { label: "Arsenal cut", image: arsenal.cut!, bg },
      ],
    },
    {
      title: "tenements: full",
      items: VARIANTS.map((b) => ({ label: `${b.plaster} ${b.storeys} storeys, ${b.roof}`, image: buildBuilding(b).full, bg })),
    },
    {
      title: "tenements: cut (knee walls, floors, furniture, ghost)",
      items: VARIANTS.map((b) => ({ label: `${b.plaster} ${b.storeys} storeys cut`, image: buildBuilding(b).cut!, bg })),
    },
    { title: "ground materials", items: swatches().map((it) => ({ ...it, bg })) },
    { title: "sign font (3 x 5 capitals, Polish diacritics)", items: [{ label: "glyphs and signs", image: fontSheet(), scale: 3, bg }] },
  ];
}
