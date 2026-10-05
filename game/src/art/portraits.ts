// Portraits (style guide §8, §9): a 24 x 28 bust facing the viewer, for briefing cards and the
// identity tags in the roster. The same look as the trooper sprite (colours from the same
// resolution, the same headgear), larger: head and shoulders, collar, armband if any. These
// stand for real people, the Arsenal scouts were 18 to 22, so they stay dignified: neutral
// expressions, no caricature. The seed varies face shape, brows, hair colour and hair style.
import { img, outline, px, rng, type PixelImage } from "./pixel";
import { PAL, type RGB } from "./palette";
import { trooperColours, type TrooperColours } from "./troopers";
import type { Headgear, PortraitBuilder, TrooperLook } from "./types";

const W = 24;
const H = 28;

/** Face outlines: [left, right] per row from the brow line down, by jaw. */
const JAWS: [number, number][][] = [
  // oval
  [[7, 16], [6, 17], [6, 17], [6, 17], [6, 17], [6, 17], [6, 17], [7, 16], [7, 16], [8, 15], [9, 14]],
  // square
  [[7, 16], [6, 17], [6, 17], [6, 17], [6, 17], [6, 17], [6, 17], [6, 17], [7, 16], [8, 15], [9, 14]],
  // narrow, long
  [[7, 16], [7, 16], [7, 16], [7, 16], [7, 16], [7, 16], [7, 16], [7, 16], [8, 15], [8, 15], [9, 14]],
];
const FACE_TOP = 5; // first face row (the forehead under the hair line)

// Headgear, front view, 24 wide from row 0. h D H mid dark light, k band, K visor, S shade on
// the brow, r hair at the temples, '_' clears.
const GEAR: Record<Exclude<Headgear, "bare">, string[]> = {
  cap: [
    "........................",
    "........HHHhhhhh........",
    "......HHhhhhhhhhhhh.....",
    ".....Hhhhhhhhhhhhhhhh...",
    ".....hhhhhhhhhhhhhhhhD..",
    "......DDDDDDDDDDDDDDD...",
    "......rSSSSSSSSSSSSr....",
  ],
  hat: [
    "........................",
    "........HHDhhhhD........",
    ".......HHhhhhhhhhD......",
    ".......kkkkkkkkkkk......",
    "..HHHhhhhhhhhhhhhhhhhD..",
    "...DDDDDDDDDDDDDDDDDD...",
    "......rSSSSSSSSSSSSr....",
  ],
  beret: [
    "........................",
    "...........h............",
    "........HHhhhhhhh.......",
    "......HHhhhhhhhhhhh.....",
    ".....Hhhhhhhhhhhhhhhh...",
    "......rr....DDDDDDDD....",
  ],
  helmet_wz31: [
    "........................",
    ".........HHhhhh.........",
    ".......HHhhhhhhhh.......",
    "......HHhhhhhhhhhD......",
    ".....Hhhhhhhhhhhhhh.....",
    "....DDDDDDDDDDDDDDDD....",
    "......SSSSSSSSSSSS......",
  ],
  stahlhelm: [
    "........................",
    ".........HHhhhh.........",
    ".......HHhhhhhhhh.......",
    "......HHhhhhhhhhhD......",
    ".....Hhhhhhhhhhhhhh.....",
    "....hhDDDDDDDDDDDDhD....",
    "....hD._________..hD....",
    "...hhD............hDD...",
    "..hhD..............hDD..",
  ],
  stahlhelm_big: [
    "........................",
    "......HHHhhhhhhhhD......",
    ".....HhhhhhhhhhhhhD.....",
    "....Hhhhhhhhhhhhhhhh....",
    "...hhhhhhhhhhhhhhhhhD...",
    "...hDDDDDDDDDDDDDDDDhD..",
    "..hhDDDDDDDDDDDDDDDDhD..",
    "..hD................hD..",
    ".hD..................hD.",
  ],
  peaked_cap: [
    "........................",
    "......HHhhhhhhhhhhD.....",
    ".....Hhhhhhhhhhhhhhh....",
    "......kkkkkkkkkkkk......",
    "......kkkkkkkkkkkk......",
    "......KKKKKKKKKKKK......",
    ".......SSSSSSSSSS.......",
  ],
  headscarf: [
    "........................",
    ".........HHhhhh.........",
    ".......HHhhhhhhhh.......",
    "......HHhhhhhhhhhD......",
    ".....Hhhhhhhhhhhhhh.....",
    ".....hhhhhhhhhhhhhhD....",
    ".....hh..........hD.....",
    "....hh............hD....",
    "....hh............hD....",
    "....hh............hD....",
    "....hh............hD....",
    ".....hh..........hD.....",
    ".....hhD........hhD.....",
    "......hhD......hhD......",
    ".......hhhD..DhhD.......",
    "........hhhhDhhD........",
    ".........hDDDhD.........",
  ],
};

/** Coats from the collar down (rows 18 to 27). c/b/a coat light/mid/dark, w shirt,
 *  k collar (coat dark), S neck shade, A/R armband white/red. */
const COATS: Record<"jacket" | "greatcoat" | "coat" | "prison", string[]> = {
  jacket: [
    "..........SSSS..........",
    ".........wSSSSw.........",
    "........awwSSwwa........",
    "....ccbbbawwwwabbbbba...",
    "..ccbbbbbbawwabbbbbbba..",
    ".ccbbbbbbbbawabbbbbbbba.",
    ".cbbbbbbbbbbaabbbbbbbba.",
    ".cbbbbbbbbbbbbbbbbbbbba.",
    "cbbbbbbbbbbbbbbbbbbbbbba",
    "cbbbbbbbbbbbbbbbbbbbbbba",
  ],
  greatcoat: [
    "..........SSSS..........",
    "........kkSSSSkk........",
    ".......kkkkSSkkkk.......",
    "....cbbkkkkkkkkkkbba....",
    "..ccbbbbkkkkkkkkbbbbba..",
    ".ccbbbbbbbkkkkbbbbbbbba.",
    ".cbbbbbbbbbbbbbbbbbbbba.",
    ".cbbbbbbbbbbbbbbbbbbbba.",
    "cbbbbbbbbbbbbbbbbbbbbbba",
    "cbbbbbbbbbbbbbbbbbbbbbba",
  ],
  coat: [
    "..........SSSS..........",
    ".........kSSSSk.........",
    "........kkwSSwkk........",
    "....ccbbkkkwwkkkbbba....",
    "..ccbbbbbkkaakkbbbbba...",
    ".ccbbbbbbbkaakbbbbbbba..",
    ".cbbbbbbbbbaabbbbbbbbba.",
    ".cbbbbbbbbbbbbbbbbbbbba.",
    "cbbbbbbbbbbbbbbbbbbbbbba",
    "cbbbbbbbbbbbbbbbbbbbbbba",
  ],
  prison: [
    "..........SSSS..........",
    ".........aSSSSa.........",
    "........aabSSbaa........",
    "....ccbbbbabbabbbbba....",
    "..ccbbbbbbbabbbbbbbba...",
    ".ccbbbbbbbbabbbbbbbbba..",
    ".cbbbbbbbbbabbbbbbbbbba.",
    ".cbbbbbbbbbbbbbbbbbbbba.",
    "cbbbbbbbbbbbbbbbbbbbbbba",
    "cbbbbbbbbbbbbbbbbbbbbbba",
  ],
};
const ARMBAND = [
  // on the left arm: the right of the picture
  [17, 23, "AAAAA"],
  [17, 24, "RRRRR"],
] as const;

function paint(im: PixelImage, rows: readonly string[], x0: number, y0: number, pal: Record<string, RGB | null>): void {
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (ch === ".") continue;
      const c = pal[ch];
      if (c === undefined) continue;
      if (c === null) {
        const i = ((y0 + y) * W + (x0 + x)) * 4;
        if (x0 + x >= 0 && x0 + x < W && y0 + y >= 0 && y0 + y < H) im.data[i] = im.data[i + 1] = im.data[i + 2] = im.data[i + 3] = 0;
        continue;
      }
      px(im, x0 + x, y0 + y, c);
    }
  });
}

function coatKind(look: TrooperLook): keyof typeof COATS {
  if (look.body === "occupier") return "greatcoat";
  if (look.body === "prisoner") return "prison";
  if (look.body === "civilian_m" || look.body === "civilian_f") return "coat";
  return "jacket";
}

/**
 * The bust for a look. `seed` picks face shape, brows, eye set and hair; it is also the seed
 * the look's colours resolve with, so pass the trooper's own `look.seed` to get the same hair
 * as his sprite.
 */
export const buildPortrait: PortraitBuilder = (look: TrooperLook, seed: number): PixelImage => {
  const c: TrooperColours & { eyeWhite: RGB } = { ...trooperColours({ ...look, seed }), eyeWhite: PAL.shared.chalk };
  const r = rng(Math.imul(seed, 2654435761) ^ 0x5eed);
  const im = img(W, H);
  const [skin0, skin1] = c.skin;
  const hair = c.hair;

  // shoulders and coat, then the neck
  const coatPal: Record<string, RGB> = { c: c.coat[2], b: c.coat[1], a: c.coat[0], k: c.coat[0], w: c.shirt, S: skin0, A: c.armband[0], R: c.armband[1] };
  paint(im, COATS[coatKind(look)], 0, 18, coatPal);
  if (look.armband) for (const [x, y, s] of ARMBAND) paint(im, [s], x, y, coatPal);
  for (let y = 15; y < 18; y++) for (let x = 10; x < 14; x++) px(im, x, y, x === 13 || y === 15 ? skin0 : skin1);

  // face
  const jaw = JAWS[Math.floor(r() * JAWS.length)];
  const rows: [number, number][] = [[7, 16], [6, 17], ...jaw.slice(1)];
  rows.forEach(([a, b], k) => {
    const y = FACE_TOP + k;
    for (let x = a; x <= b; x++) px(im, x, y, x >= b - 1 || k === rows.length - 1 ? skin0 : skin1);
  });
  // ears
  for (let y = 9; y <= 11; y++) { px(im, 5, y, skin1); px(im, 18, y, skin0); }
  px(im, 5, 10, skin0);

  // brows, eyes, nose, mouth: quiet and level, eyes open and on the viewer
  const browY = 7;
  const arch = r() < 0.5; // a soft arch lifts the middle, never the outer ends (that reads as a scowl)
  const long = r() < 0.5;
  for (let x = long ? 7 : 8; x <= 10; x++) px(im, x, browY - (arch && x === 9 ? 1 : 0), hair[0]);
  for (let x = 13; x <= (long ? 16 : 15); x++) px(im, x, browY - (arch && x === 14 ? 1 : 0), hair[0]);
  const wide = r() < 0.5 ? 0 : 1;
  const lx = 8 - wide, rx = 14 + wide;
  px(im, lx, 9, c.eye); px(im, lx + 1, 9, c.eye);
  px(im, rx, 9, c.eye); px(im, rx + 1, 9, c.eye);
  px(im, lx, 10, c.eyeWhite); px(im, lx + 1, 10, c.eye);
  px(im, rx, 10, c.eye); px(im, rx + 1, 10, c.eyeWhite);
  px(im, 12, 11, skin0); px(im, 12, 12, skin0); px(im, 11, 13, skin0); px(im, 12, 13, skin0);
  const mouthY = 14;
  for (let x = 10; x <= 13; x++) px(im, x, mouthY, skin0);

  // hair: the crown, the temples, a style by seed
  const style = Math.floor(r() * 3);
  const gear = look.headgear;
  const hairRows: string[] =
    style === 0
      ? ["........................", "........qqrrrrrR........", "......qqrrrrrrrrrR......", ".....qrrrrrrrrrrrrrR....", ".....rrrrrrrrrrrrrrR....", ".....rr..........rR.....", ".....r............R....."]
      : style === 1
        ? ["........................", ".........qrrrrrR........", "......qqqrrrrrrrrR......", ".....qrrrRrrrrrrrrrR....", ".....rrrRrrrrrrrrrrR....", ".....rrr.........rR.....", ".....r............R....."]
        : ["........................", "........RRRRRRRR........", "......RqqrrrrrrrrR......", ".....RqrrrrrrrrrrrR.....", ".....rrrrrrrrrrrrrrR....", ".....rrr..........R.....", ".....r............R....."];
  const hairPal: Record<string, RGB> = { r: hair[1], R: hair[0], q: hair[2] };
  if (look.body === "prisoner") {
    // cropped short in prison: stubble over the skin
    paint(im, ["........................", "........SSSSSSSS........", "......SsSSSSSSSSSS......", ".....SsssSSSSSSSSSS.....", ".....ssssssssssssSS....."], 0, 1, { S: hair[0], s: skin0 });
  } else if (gear === "bare" || gear === "beret" || gear === "cap" || gear === "hat") {
    paint(im, hairRows, 0, 0, hairPal);
  } else {
    paint(im, hairRows.slice(5), 0, 5, hairPal);
  }

  // headgear
  if (gear !== "bare") {
    const gp: Record<string, RGB | null> = { h: c.gear[1], D: c.gear[0], H: c.gear[2], k: c.band, K: c.visor, S: skin0, r: hair[1], _: null };
    paint(im, GEAR[gear], 0, 0, gp);
    if (look.kit === "driver_tag" && (gear === "cap" || gear === "beret")) { px(im, 11, 3, c.tag); px(im, 12, 3, c.tag); }
  }

  // Rudy after Szucha: a bandage round the head, a swollen eye, a cut lip
  if (look.beaten) {
    paint(im, [".....WwwwwwwwwwwwwwW....", ".....wwwwwwwxwwwwwwW....", "......WWWWWWWWWWWW......"], 0, 5, { w: c.bandage[1], W: c.bandage[0], x: c.blood });
    paint(im, ["........bb...", ".......bbb...", "........b...."], 0, 9, { b: c.bruise[0] });
    px(im, 12, 14, c.bruise[1]);
    px(im, 15, 12, c.bruise[1]);
  }

  outline(im, c.outline);
  return im;
};
