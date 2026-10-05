// The HUD, drawn as code (style guide §8, §9): identity tags for the roster, squad tags,
// olive thumb buttons, icons, head glyphs, rank marks, map markers, paper and panels, and the
// title art. Every builder is a pure function of its arguments and docs/art/palette.json and
// returns a PixelImage at 1x in art px. Sizes are fixed per piece, so pressed and released,
// alive and fallen, swap in place.
//
// Colour rules (style guide §3): select_gold only for your selection, route, destination and
// the target you picked; squad colours only on squad tags and order markers; poppy_red for
// danger and the grave; cone_yellow never. Light from the top left, 1 px outlines, no dither.
import type { RGB } from "./palette";
import { blit, img, px, type PixelImage } from "./pixel";
import { FONT, FONT_BIG, FONT_SMALL, drawText, fitText } from "./font";
import {
  HUD, discMask, edgeOf, ellipseRing, erode, mask, maskFrom, minus, on, pad, ringOf, roundBox, set, shift, stamp,
  stampShadowed, union, type Mask,
} from "./hud-kit";
import { GLYPHS, ICONS, RANK_MARKS, type IconName } from "./hud-icons";

export { ICON_NAMES, RANK_NAMES, type IconName } from "./hud-icons";
export { buildPaper, buildBanner, buildCard, buildPanel } from "./hud-panels";
export { buildLogo, buildTurtle, type TurtleOpts } from "./hud-title";

// ---------------------------------------------------------------- small helpers

/** Paint a region with a bevel: fill, the top and left rim lit, the bottom and right rim shaded. */
function bevel(im: PixelImage, m: Mask, x: number, y: number, fill: RGB, lit: RGB, shade: RGB): void {
  stamp(im, m, x, y, fill);
  stamp(im, union(edgeOf(m, 0, -1), edgeOf(m, -1, 0)), x, y, lit);
  stamp(im, union(edgeOf(m, 0, 1), edgeOf(m, 1, 0)), x, y, shade);
}

/** A plate: an outline of `edge`, then a bevelled face just inside it (1 px all round). */
function plate(im: PixelImage, outer: Mask, edge: RGB, fill: RGB, lit: RGB, shade: RGB): Mask {
  const inner = erode(outer);
  stamp(im, outer, 0, 0, edge);
  bevel(im, inner, 0, 0, fill, lit, shade);
  return inner;
}

/** The rim around a recess (a window, a hole): its top and left walls face away from the light
 *  and are dark, its bottom and right walls catch it. Drawn on the pixels just outside `m`. */
function recess(im: PixelImage, m: Mask, x: number, y: number, dark: RGB, lit: RGB): void {
  const p = pad(m, 1);
  const ring = ringOf(p);
  stamp(im, ring, x - 1, y - 1, lit);
  const tl = mask(p.w, p.h);
  for (let j = 0; j < p.h; j++) {
    for (let i = 0; i < p.w; i++) if (on(ring, i, j) && (on(p, i, j + 1) || on(p, i + 1, j))) set(tl, i, j);
  }
  stamp(im, tl, x - 1, y - 1, dark);
}

function clearMask(im: PixelImage, m: Mask, x: number, y: number): void {
  for (let j = 0; j < m.h; j++) {
    for (let i = 0; i < m.w; i++) {
      const xx = x + i, yy = y + j;
      if (!on(m, i, j) || xx < 0 || yy < 0 || xx >= im.w || yy >= im.h) continue;
      im.data.fill(0, (yy * im.w + xx) * 4, (yy * im.w + xx) * 4 + 4);
    }
  }
}

// ---------------------------------------------------------------- icons, glyphs, ranks

/** A 12 x 12 icon in one colour (button ink by default) on transparent. */
export function buildIcon(name: IconName, c: RGB = HUD.bink): PixelImage {
  const m = ICONS.get(name);
  if (!m) throw new Error(`hud: no icon "${name}"`);
  const im = img(12, 12);
  stamp(im, m, 0, 0, c);
  return im;
}

/** The sim's glyph names (src/sim/types.ts Glyph); "alarm" is accepted for "alert". */
export const GLYPH_NAMES = ["alert", "suspicious", "wounded", "knife"] as const;
export type GlyphName = (typeof GLYPH_NAMES)[number] | "alarm";

/** A 7 x 9 head glyph with its outline: the alert "!" in poppy red, suspicious "?" in chalk,
 *  the wounded cross in chalk, the knife in select_gold (the sentry you picked). */
export function buildGlyph(name: GlyphName): PixelImage {
  const key = name === "alarm" ? "alert" : name;
  const m = GLYPHS.get(key);
  if (!m) throw new Error(`hud: no glyph "${name}"`);
  const fill = { alert: HUD.poppy, suspicious: HUD.chalk, wounded: HUD.chalk, knife: HUD.gold }[key as (typeof GLYPH_NAMES)[number]];
  const im = img(7, 9);
  stamp(im, m, 0, 0, fill);
  stamp(im, ringOf(m), 0, 0, HUD.outline);
  return im;
}

/** Rank marks, 7 x 5 (RANK_NAMES): 0 none, 1-3 bars, 4 a chevron, 5 a chevron over a bar,
 *  6 a star, 7 the big star. */
export function buildRank(rank: number, c: RGB = HUD.ink): PixelImage {
  const im = img(7, 5);
  stamp(im, RANK_MARKS[clampRank(rank)], 0, 0, c);
  return im;
}
const clampRank = (r: number) => Math.max(0, Math.min(7, Math.round(r)));

// ---------------------------------------------------------------- identity tag

export type Hp = "ok" | "low" | "down" | "dead";
export interface TagSpec {
  /** Nom de guerre; stamped in capitals, cut with a dot when it does not fit. */
  name: string;
  /** 0-7. */
  rank: number;
  /** 10 x 10 face cropped from the trooper's sprite. */
  face: PixelImage;
  hp: Hp;
  selected?: boolean;
}
export const TAG_SIZE = { w: 34, h: 28 } as const;

/** The birch cross in the window of a fallen trooper's tag (10 x 10), bark marks and a poppy. */
const BIRCH_CROSS = maskFrom([
  "....##....",
  "....##....",
  "..######..",
  "..######..",
  "....##....",
  "....##....",
  "....##....",
  "....##....",
  "....##....",
  "...####...",
]);
const BIRCH_MARKS: [number, number][] = [[5, 1], [2, 3], [7, 2], [4, 5], [5, 7]];

/**
 * A line of a HUD image's lettering. The game sets it in its own type over the image
 * (ui/HudScene), sharp at any screen size; the art lab stamps it in the pixel face. x and y
 * as drawText takes them: the line's top, and its left edge or centre.
 */
export interface Label {
  text: string;
  x: number;
  y: number;
  size: "px" | "pxs" | "pxb";
  colour: RGB;
  align: "left" | "center";
  shadow?: RGB;
  /** The widest it may run in art px; past that it is cut, ending in a full stop. */
  max?: number;
}

/** Stamp a label in the pixel face, or hand it back (`out`) for the caller to set in type. */
function letter(im: PixelImage, l: Label, out?: Label[]): void {
  if (out) {
    out.push(l);
    return;
  }
  const font = l.size === "pxs" ? FONT_SMALL : l.size === "pxb" ? FONT_BIG : FONT;
  drawText(im, font, l.x, l.y, l.max === undefined ? l.text : fitText(font, l.text, l.max), l.colour, { align: l.align, shadow: l.shadow });
}

/**
 * The roster chip (style guide §8): a stamped steel identity tag, 34 x 28, with the chain hole,
 * the face in a pressed window, rank marks, a health notch and the name. "down" adds the
 * wounded cross; "dead" darkens the steel into a grave marker with a birch cross, a mourning
 * band and a poppy, and paints the name so it stays readable.
 */
export function buildTag(o: TagSpec, out?: Label[]): PixelImage {
  const { w, h } = TAG_SIZE;
  const dead = o.hp === "dead";
  const im = img(w, h);
  const fill = dead ? HUD.steelDark : HUD.steel;
  const lit = dead ? HUD.steelLo : HUD.steelHi;
  const shade = dead ? HUD.steelDeep : HUD.steelLo;
  const inner = plate(im, roundBox(w, h, 3), o.selected ? HUD.gold : HUD.ink, fill, lit, shade);
  if (o.selected) stamp(im, minus(inner, erode(inner)), 0, 0, HUD.gold);
  // the hole for the chain, cut through
  const hole = roundBox(4, 4, 1);
  recess(im, hole, 3, 3, shade, lit);
  clearMask(im, hole, 3, 3);
  // the face window, pressed into the plate
  stamp(im, roundBox(10, 10, 0), 9, 3, dead ? HUD.steelDeep : HUD.steelLo);
  recess(im, roundBox(10, 10, 0), 9, 3, HUD.ink, lit);
  if (dead) {
    stamp(im, BIRCH_CROSS, 9, 3, HUD.birchLight);
    for (const [x, y] of BIRCH_MARKS) px(im, 9 + x, 3 + y, HUD.birchDark);
    px(im, 11, 11, HUD.poppy); px(im, 12, 11, HUD.poppy); px(im, 11, 12, HUD.poppy); px(im, 12, 12, HUD.shadow);
    // the mourning band across the window's top right corner
    for (let y = 2; y <= 8; y++) for (let x = 13; x <= 19; x++) if (x - y === 12 || x - y === 13) px(im, x, y, HUD.shadow);
  } else {
    blit(im, o.face, 9, 3, { sw: 10, sh: 10 });
  }
  if (o.hp === "down") blit(im, buildGlyph("wounded"), 15, 8);
  // rank marks and name: stamped into live steel (ink, glint below right), painted on a grave
  const rank = RANK_MARKS[clampRank(o.rank)];
  if (dead) stampShadowed(im, rank, 23, 3, HUD.steelHi, HUD.ink);
  else stampShadowed(im, rank, 23, 3, HUD.ink, lit);
  if (!dead) {
    stamp(im, roundBox(8, 4, 1), 22, 11, HUD.ink);
    stamp(im, roundBox(6, 2, 0), 23, 12, o.hp === "ok" ? HUD.hpOk : HUD.hpLow);
  }
  letter(im, { text: o.name.toUpperCase(), x: 17, y: 16, size: "pxs", colour: dead ? HUD.steelHi : HUD.ink, align: "center", shadow: dead ? HUD.ink : lit, max: w - 6 }, out);
  return im;
}

// ---------------------------------------------------------------- squad tag

export type Order = "hold" | "follow" | "cover" | "signal";
export interface SquadTagSpec {
  leader: string;
  colour: 1 | 2 | 3;
  selected: boolean;
  order?: Order | null;
  alive: number;
  total: number;
}
export const SQUAD_TAG_SIZE = { w: 56, h: 22 } as const;

/**
 * A painted plate in the squad's colour (hud.squads), 56 x 22: the squad's order in a dark
 * slot (its number when it has none, as the squad you lead does), the leader's nom de guerre,
 * and a pip per trooper, crossed out for the fallen. The selected squad gets a gold frame.
 */
export function buildSquadTag(o: SquadTagSpec, out?: Label[]): PixelImage {
  const { w, h } = SQUAD_TAG_SIZE;
  const base = HUD.squad[o.colour - 1], shade = HUD.squadShade[o.colour - 1];
  const im = img(w, h);
  const inner = plate(im, roundBox(w, h, 3), o.selected ? HUD.gold : HUD.ink, base, HUD.ghost, shade);
  if (o.selected) stamp(im, minus(inner, erode(inner)), 0, 0, HUD.gold);
  const slot = roundBox(14, 14, 1);
  stamp(im, slot, 3, 4, HUD.rim);
  recess(im, slot, 3, 4, shade, HUD.ghost);
  if (o.order) stamp(im, ICONS.get(o.order)!, 4, 5, base);
  else letter(im, { text: String(o.colour), x: 10, y: 5 - FONT_BIG.top + 1, size: "pxb", colour: base, align: "center" }, out);
  letter(im, { text: o.leader.toUpperCase(), x: 20, y: 4 - FONT.top, size: "px", colour: HUD.ink, align: "left", max: w - 23 }, out);
  if (o.total <= 8) {
    for (let i = 0; i < o.total; i++) {
      const x = 20 + i * 4, y = 14;
      if (i < o.alive) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) px(im, x + k, y + j, HUD.ink);
      else for (const [dx, dy] of [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]]) px(im, x + dx, y + dy, HUD.ink);
    }
  } else {
    letter(im, { text: `${o.alive}/${o.total}`, x: 20, y: 14 - FONT_SMALL.top, size: "pxs", colour: HUD.ink, align: "left" }, out);
  }
  return im;
}

// ---------------------------------------------------------------- buttons

export type ButtonKind = "fire" | "grenade" | "bottle" | "go" | "pause" | "play" | "map" | "hold" | "follow" | "cover" | "signal" | "ok" | "close";
export const BUTTON_KINDS: readonly ButtonKind[] = ["fire", "grenade", "bottle", "go", "pause", "play", "map", "hold", "follow", "cover", "signal", "ok", "close"];
export const BUTTON_SIZE: Readonly<Record<ButtonKind, { w: number; h: number }>> = {
  fire: { w: 44, h: 44 },
  grenade: { w: 36, h: 36 },
  bottle: { w: 36, h: 36 },
  go: { w: 48, h: 30 },
  pause: { w: 30, h: 30 }, play: { w: 30, h: 30 }, map: { w: 30, h: 30 },
  hold: { w: 30, h: 30 }, follow: { w: 30, h: 30 }, cover: { w: 30, h: 30 }, signal: { w: 30, h: 30 },
  ok: { w: 30, h: 30 }, close: { w: 30, h: 30 },
};

/**
 * The olive body (hud.button_olive, button_rim): a rim, the button's side showing under a
 * raised face, the face lit along its top left. Pressed, the face has sunk 2 px, darkened,
 * and its top edge falls into shadow. Returns where the face is, for centring the icon.
 */
function buttonBody(im: PixelImage, round: boolean, pressed: boolean): { fx: number; fy: number; fw: number; fh: number } {
  const { w, h } = im;
  const outer = round ? discMask(w) : roundBox(w, h, 4);
  const face = round ? discMask(w - 4) : roundBox(w - 2, h - 4, 3);
  const fx = round ? 2 : 1, fy = pressed ? 3 : 1;
  stamp(im, outer, 0, 0, HUD.rim);
  stamp(im, erode(outer), 0, 0, pressed ? HUD.rim : HUD.oliveLo);
  if (pressed) {
    stamp(im, face, fx, fy, HUD.oliveLo);
    stamp(im, union(edgeOf(face, 0, -1), edgeOf(face, -1, 0)), fx, fy, HUD.rim);
  } else {
    bevel(im, face, fx, fy, HUD.olive, HUD.oliveHi, HUD.olive);
  }
  return { fx, fy, fw: face.w, fh: face.h };
}

const CROSSHAIR = maskFrom([
  "........#........",
  "........#........",
  "......#####......",
  "....##..#..##....",
  "...#....#....#...",
  "...#.........#...",
  "..#...........#..",
  "..#...........#..",
  "######..#..######",
  "..#...........#..",
  "..#...........#..",
  "...#.........#...",
  "...#....#....#...",
  "....##..#..##....",
  "......#####......",
  "........#........",
  "........#........",
]);

/** A pineapple grenade seen from the side: pin ring, fuse and lever, grooved body. */
const GRENADE_BIG = maskFrom([
  "................",
  "......###.......",
  "..##..###.......",
  ".#..#.#####.....",
  ".#..#######.#...",
  "..##..#####..#..",
  "....#########.#.",
  "...###########..",
  "..##.##.##.###..",
  "..############..",
  "..##.##.##.###..",
  "..############..",
  "..##.##.##.###..",
  "...##########...",
  "....########....",
  "................",
]);

/** A petrol bottle with its rag. */
const BOTTLE_BIG = maskFrom([
  "......#.........",
  ".....##..#......",
  "......####......",
  ".......##.......",
  ".......##.......",
  ".......##.......",
  "......####......",
  ".....######.....",
  "....########....",
  "....#.######....",
  "....#.######....",
  "....#.######....",
  "....########....",
  "....########....",
  ".....######.....",
  "................",
]);

/** The signal whistle: mouthpiece, round chamber, three strokes of sound. */
const WHISTLE = maskFrom([
  "..#..#..#...",
  "...#.#.#....",
  "............",
  "......#####.",
  ".....#######",
  "####.#######",
  "############",
  "####.#######",
  ".....#######",
  "......#####.",
]);

/**
 * A thumb button, olive per the palette. Sizes (art px, 29 is the 44 pt minimum): FIRE 44
 * round, GRENADE and petrol BOTTLE 36 round with a count badge (extra.count), the go-code
 * 48 x 30 (whistle and GO), and 30 x 30 pause, map, the four orders, ok and close.
 */
export function buildButton(kind: ButtonKind, pressed = false, extra: { count?: number } = {}, out?: Label[]): PixelImage {
  const { w, h } = BUTTON_SIZE[kind];
  const im = img(w, h);
  const round = kind === "fire" || kind === "grenade" || kind === "bottle";
  const { fx, fy, fw, fh } = buttonBody(im, round, pressed);
  const drop = HUD.rim;
  if (round) {
    // a groove pressed round the face, as on a stamped metal cap
    const d = fw - 6, disc = discMask(d), groove = minus(disc, erode(disc));
    stamp(im, groove, fx + 4, fy + 4, pressed ? HUD.oliveLo : HUD.oliveHi);
    stamp(im, groove, fx + 3, fy + 3, pressed ? HUD.rim : HUD.oliveLo);
  }
  const centre = (m: Mask, dy = 0) => stampShadowed(im, m, fx + Math.floor((fw - m.w) / 2), fy + Math.floor((fh - m.h) / 2) + dy, HUD.bink, drop);
  if (kind === "fire") {
    stampShadowed(im, CROSSHAIR, fx + Math.floor((fw - CROSSHAIR.w) / 2), fy + 6, HUD.bink, drop);
    letter(im, { text: "FIRE", x: Math.floor(w / 2), y: fy + 26 - FONT_SMALL.top, size: "pxs", colour: HUD.bink, align: "center", shadow: drop }, out);
  } else if (kind === "grenade" || kind === "bottle") {
    centre(kind === "grenade" ? GRENADE_BIG : BOTTLE_BIG, 1);
    if (extra.count !== undefined) countBadge(im, w - 12, 0, extra.count, out);
  } else if (kind === "go") {
    stampShadowed(im, WHISTLE, 7, fy + 7, HUD.bink, drop);
    letter(im, { text: "GO", x: 22, y: fy + 7 - FONT_BIG.top, size: "pxb", colour: HUD.bink, align: "left", shadow: drop }, out);
  } else {
    centre(ICONS.get(kind as IconName)!);
  }
  return im;
}

/** A stamped steel disc with a number: grenades or bottles left (red at none). */
function countBadge(im: PixelImage, x: number, y: number, n: number, out?: Label[]): void {
  const d = 12;
  plate(im, shift(discMask(d), x, y, im.w, im.h), HUD.ink, HUD.steel, HUD.steelHi, HUD.steelLo);
  const t = n > 99 ? "99" : String(Math.max(0, n));
  letter(im, { text: t, x: x + d / 2, y: y + 4 - FONT_SMALL.top, size: "pxs", colour: n > 0 ? HUD.ink : HUD.hpLow, align: "center" }, out);
}

// ---------------------------------------------------------------- map markers

/** Frames in the tap ring's animation (buildTapRing(0..3)). */
export const TAP_FRAMES = 4;
/** Where each map marker meets the ground, in the marker's own pixels: put it on the world point. */
export const MARKER_ANCHORS = {
  tap: { x: 8, y: 6 },
  routeEnd: { x: 4, y: 3 },
  selection: { x: 7, y: 2 },
  holdFlag: { x: 1, y: 13 },
  waitMark: { x: 4, y: 11 },
} as const;

/** Where you tapped (select_gold; poppy_red on an enemy, `c`): four frames growing and breaking
 *  up; 16 x 13, centre (8, 6). */
export function buildTapRing(frame: number, c: RGB = HUD.gold): PixelImage {
  const f = Math.max(0, Math.min(3, frame | 0));
  const sizes: [number, number][] = [[6, 4], [10, 8], [14, 10], [16, 12]];
  const [rw, rh] = sizes[f];
  const im = img(16, 13);
  const ring = ellipseRing(rw, rh);
  const ox = (16 - rw) / 2, oy = Math.floor((12 - rh) / 2);
  const keep = (x: number, y: number) => f < 3 || (x + y) % 2 === 0;
  for (const [ink, dy] of [[HUD.outline, 1], [c, 0]] as const) {
    for (let y = 0; y < ring.h; y++) for (let x = 0; x < ring.w; x++) if (on(ring, x, y) && keep(x, y)) px(im, ox + x, oy + y + dy, ink);
  }
  return im;
}

/** The end of your route: a gold diamond on the ground, 9 x 7, centre (4, 3). */
export function buildRouteEnd(): PixelImage {
  const m = maskFrom([".........", "....#....", "..#####..", ".#######.", "..#####..", "....#....", "........."]);
  const im = img(9, 7);
  stamp(im, m, 0, 0, HUD.gold);
  stamp(im, ringOf(m), 0, 0, HUD.outline);
  return im;
}

/** The selected trooper's gold ring, 14 x 6, under his feet; a dark line under it keeps it
 *  readable on snow. */
export function buildSelection(): PixelImage {
  const im = img(14, 6);
  const ring = ellipseRing(14, 5);
  stamp(im, ring, 0, 1, HUD.outline);
  stamp(im, ring, 0, 0, HUD.gold);
  return im;
}

/** A hold order: a flag in the squad's colour, 9 x 14, the pole's foot at (1, 13). */
export function buildHoldFlag(squad: 1 | 2 | 3): PixelImage {
  const im = img(9, 14);
  const flag = shift(maskFrom(["######", "#####.", "####..", "#####.", "######"]), 2, 1, 9, 14);
  stamp(im, flag, 0, 0, HUD.squad[squad - 1]);
  stamp(im, edgeOf(flag, 0, 1), 0, 0, HUD.squadShade[squad - 1]);
  stamp(im, ringOf(flag), 0, 0, HUD.outline);
  for (let y = 0; y <= 12; y++) px(im, 1, y, HUD.outline);
  for (let x = 0; x <= 2; x++) px(im, x, 13, HUD.outline);
  return im;
}

/** Where a squad on a signal order waits for the go-code: a sand-glass over a ground diamond,
 *  in the squad's colour, 9 x 14, the ground point at (4, 11). */
export function buildWaitMark(squad: 1 | 2 | 3): PixelImage {
  const im = img(9, 14);
  const glass = maskFrom([
    ".........",
    "..#####..",
    "..#####..",
    "...###...",
    "....#....",
    "...#.#...",
    "..#####..",
    "..#####..",
    ".........",
  ]);
  const ground = shift(maskFrom([".........", "...###...", ".#######.", "...###...", "........."]), 0, 9, 9, 14);
  const all = union(shift(glass, 0, 0, 9, 14), ground);
  stamp(im, all, 0, 0, HUD.squad[squad - 1]);
  stamp(im, edgeOf(ground, 0, 1), 0, 0, HUD.squadShade[squad - 1]);
  stamp(im, ringOf(all), 0, 0, HUD.outline);
  return im;
}
