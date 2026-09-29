// Hand-written head templates, the part of a trooper that must read at 1x: which way he faces
// and, from the headgear, which side and role he is (style guide §6). Every head is 14 x 10 with
// its anchor at (7, 8), the chin row, which lands on the neck; a front face is centred on
// x = 7.0 so it sits on the cell's centre line. The global outline pass adds the silhouette, so
// templates carry only inner lines.
//
//   r R q   hair mid, dark, light        s S e   skin light, shade, eye
//   h D H   headgear mid, dark, light    k K     band, visor (dark accents)
//   w W x   bandage light, shade, blood  b B     bruise (swelling, cut)
//   t       tag glyph (driver)           o       outline (inner line)
import type { Facing, Headgear } from "./types";
import { overlay, tpl, type Tpl } from "./troopers-raster";

export const HEAD_W = 14;
export const HEAD_H = 10;
const T = (rows: string[]) => tpl(pad(rows), 7, 8);

//                  0123456789abcd
const BASE: Record<Facing, string[]> = {
  s: [
    "..............",
    ".....RrrR.....",
    "....RrqqrR....",
    "...RrqrrrrR...",
    "...rsssssrR...",
    "...ssessesS...",
    "...sssssssS...",
    "....ssssSS....",
    ".....SSSS.....",
  ],
  se: [
    "..............",
    ".....RrrR.....",
    "....RqqrrR....",
    "...RqrrrrrR...",
    "...Rrrsssss...",
    "...rSsesses...",
    "...RSssssss...",
    "....SssssS....",
    "......SSS.....",
  ],
  e: [
    "..............",
    ".....RrrR.....",
    "....RqqrrR....",
    "...RqrrrrrR...",
    "...Rrrrssss...",
    "...rrrSsses...",
    "...RrrSsssss..",
    "....RSssssS...",
    ".....SSSS.....",
  ],
  ne: [
    "..............",
    ".....RrrR.....",
    "....RqqrrR....",
    "...RqrrrrrR...",
    "...rrrrrrrR...",
    "...rrrrrrSs...",
    "...RrrrrrSs...",
    "....RrrrRS....",
    ".....SSSS.....",
  ],
  n: [
    "..............",
    ".....RrrR.....",
    "....RqqrrR....",
    "...RqrrrrrR...",
    "...rrrrrrrR...",
    "..srrrrrrrRS..",
    "...rrrrrrRR...",
    "....RrrrRR....",
    ".....SSSS.....",
  ],
};

// Headgear overlays, same frame as the heads. '.' keeps the head below, '_' clears it.
//                  0123456789abcd
const GEAR: Record<Exclude<Headgear, "bare">, Record<Facing, string[]>> = {
  // flat cap (kaszkiet): low and wide, the crown puffed forward over a short peak
  cap: {
    s: [
      "..............",
      ".....HHhhh....",
      "...HHhhhhhhh..",
      "...hhhhhhhhhD.",
      "...DDDDDDDDD..",
    ],
    se: [
      "..............",
      ".....HHhhh....",
      "...HHhhhhhhh..",
      "...hhhhhhhhhhD",
      "...hDDDDDDDDD.",
    ],
    e: [
      "..............",
      "....HHhhh.....",
      "...Hhhhhhhhh..",
      "...hhhhhhhhhhD",
      "...Dhh....DDD.",
    ],
    ne: [
      "..............",
      "....HHhhh.....",
      "...Hhhhhhhhh..",
      "...hhhhhhhhhhD",
      "...DhhhhhhDD..",
    ],
    n: [
      "..............",
      ".....HHhh.....",
      "...HHhhhhhhD..",
      "...hhhhhhhhhD.",
      "...DhhhhhhD...",
    ],
  },
  // brimmed felt hat: a tall dented crown, a band, the brim all round
  hat: {
    s: [
      "..............",
      ".....HDhh.....",
      "....HHhhhD....",
      ".HHhkkkkkkhhD.",
      "..DDDDDDDDDD..",
    ],
    se: [
      "..............",
      ".....HDhh.....",
      "....HHhhhD....",
      ".HHhkkkkkkhhhD",
      "..DDDDDDDDDDD.",
    ],
    e: [
      "..............",
      ".....HDhh.....",
      "....HHhhhD....",
      ".HHhkkkkkkhhhD",
      "..DDDDDDDDDDD.",
    ],
    ne: [
      "..............",
      ".....HDhh.....",
      "....HHhhhD....",
      ".HHhkkkkkkhhhD",
      "..DDDDDDDDDDD.",
    ],
    n: [
      "..............",
      ".....HDhh.....",
      "....HHhhhD....",
      ".HHhkkkkkkhhD.",
      "..DDDDDDDDDD..",
    ],
  },
  // beret: a soft disc with a stalk, pulled down to one side, the other temple bare
  beret: {
    s: [
      "..............",
      "......hh......",
      "...HHhhhhhh...",
      "..HhhhhhhhhhD.",
      "..........hD..",
    ],
    se: [
      "..............",
      "......hh......",
      "...HHhhhhhh...",
      "..HhhhhhhhhhhD",
      "...........hD.",
    ],
    e: [
      "..............",
      ".....hh.......",
      "...HHhhhhhh...",
      "..HhhhhhhhhhD.",
      "..DD..........",
    ],
    ne: [
      "..............",
      ".....hh.......",
      "...HHhhhhhh...",
      "..HhhhhhhhhhD.",
      "..DDh.........",
    ],
    n: [
      "..............",
      "......hh......",
      "...HHhhhhhh...",
      "..HhhhhhhhhhD.",
      "..Dh..........",
    ],
  },
  // wz.31: a round dome with a narrow rim, low over the nape
  helmet_wz31: {
    s: [
      "..............",
      ".....HHhh.....",
      "....HHhhhh....",
      "...HhhhhhhD...",
      "..DDDDDDDDDD..",
    ],
    se: [
      "..............",
      ".....HHhh.....",
      "....HHhhhh....",
      "...HhhhhhhD...",
      "..hDDDDDDDDD..",
    ],
    e: [
      "..............",
      ".....HHhh.....",
      "....HHhhhhD...",
      "...HhhhhhhhD..",
      "..hhhhhhhDDDD.",
      "..hh..........",
    ],
    ne: [
      "..............",
      ".....HHhh.....",
      "....HHhhhhD...",
      "...HhhhhhhhD..",
      "..hhhhhhhhhDD.",
      "..hhhh........",
    ],
    n: [
      "..............",
      ".....HHhh.....",
      "....HHhhhh....",
      "...HhhhhhhD...",
      "..hhhhhhhhhD..",
      "..DDDDDDDDDD..",
    ],
  },
  // Stahlhelm: the flared coal-scuttle outline alone says occupier (style guide §6)
  stahlhelm: {
    s: [
      "..............",
      ".....HHhh.....",
      "....HHhhhh....",
      "...HhhhhhhD...",
      "..hhDDDDDDhD..",
      "..hD......hD..",
      ".hD........hD.",
    ],
    se: [
      "..............",
      ".....HHhh.....",
      "....HHhhhh....",
      "...HhhhhhhD...",
      "..hhhDDDDDDD..",
      "..hhD.........",
      ".hhD..........",
    ],
    e: [
      "..............",
      ".....HHhh.....",
      "....HHhhhh....",
      "...HhhhhhhhD..",
      "..hhhhhhDDDDD.",
      "..hhhhD.......",
      ".hhhD.........",
    ],
    ne: [
      "..............",
      ".....HHhh.....",
      "....HHhhhh....",
      "...HhhhhhhhD..",
      "..hhhhhhhhhDD.",
      "..hhhhhhhD....",
      ".hhhhhhD......",
    ],
    n: [
      "..............",
      ".....HHhh.....",
      "....HHhhhh....",
      "...HhhhhhhD...",
      "..hhhhhhhhhD..",
      "..hhhhhhhhhD..",
      ".hhhhhhhhhhhD.",
    ],
  },
  // the rookie's captured helmet, a size too big, down over his eyes
  stahlhelm_big: {
    s: [
      "..............",
      "....HHhhhh....",
      "..HHhhhhhhhhD.",
      "..hhhhhhhhhhD.",
      ".hhDDDDDDDDDhD",
      ".hDDDDDDDDDDD.",
      "hD..........hD",
    ],
    se: [
      "..............",
      "....HHhhhh....",
      "..HHhhhhhhhhD.",
      "..hhhhhhhhhhD.",
      ".hhhDDDDDDDDDD",
      ".hhDDDDDDDDDD.",
      "hhD...........",
    ],
    e: [
      "..............",
      "....HHhhhh....",
      "..HHhhhhhhhhD.",
      "..hhhhhhhhhhD.",
      ".hhhhhhhDDDDDD",
      ".hhhhhDDDDDD..",
      "hhhD..........",
    ],
    ne: [
      "..............",
      "....HHhhhh....",
      "..HHhhhhhhhhD.",
      "..hhhhhhhhhhD.",
      ".hhhhhhhhhhhDD",
      ".hhhhhhhhhD...",
      "hhhhhhhhD.....",
    ],
    n: [
      "..............",
      "....HHhhhh....",
      "..HHhhhhhhhhD.",
      "..hhhhhhhhhhD.",
      ".hhhhhhhhhhhD.",
      ".hhhhhhhhhhhD.",
      "hhhhhhhhhhhhhD",
    ],
  },
  // Schirmmütze: the high saddle front, a dark band, a black peak
  peaked_cap: {
    s: [
      "..............",
      "...HHhhhhhD...",
      "..HhhhhhhhhhD.",
      "...kkkkkkkk...",
      "...KKKKKKKK...",
    ],
    se: [
      "..............",
      "....HHhhhhhD..",
      "..HhhhhhhhhhD.",
      "...kkkkkkkkk..",
      "....KKKKKKKKK.",
    ],
    e: [
      "..............",
      ".....HHhhhhD..",
      "...Hhhhhhhhhh.",
      "...kkkkkkkkk..",
      "........KKKKK.",
    ],
    ne: [
      "..............",
      ".....HHhhhhD..",
      "...HhhhhhhhhD.",
      "...kkkkkkkkk..",
      "..........KK..",
    ],
    n: [
      "..............",
      "....HHhhhh....",
      "...HhhhhhhD...",
      "...kkkkkkkk...",
    ],
  },
  // headscarf: over the hair, framing the face, knotted under the chin
  headscarf: {
    s: [
      "..............",
      ".....HHhh.....",
      "....HHhhhh....",
      "...HhhhhhhD...",
      "..hhhhhhhhhD..",
      "..h........D..",
      "..hD......hD..",
      "...hD....hD...",
      "....hhDDhD....",
    ],
    se: [
      "..............",
      ".....HHhh.....",
      "....HHhhhh....",
      "...HhhhhhhD...",
      "..hhhhhhhhhD..",
      "..hhh......D..",
      "..hhh......D..",
      "...hhD....hD..",
      "....hhhDhD....",
    ],
    e: [
      "..............",
      ".....HHhh.....",
      "....HHhhhh....",
      "...HhhhhhhhD..",
      "..hhhhhhhhhD..",
      "..hhhhhD......",
      "..hhhhhD......",
      "..DhhhhD......",
      "....hhhhD.....",
    ],
    ne: [
      "..............",
      ".....HHhh.....",
      "....HHhhhh....",
      "...HhhhhhhD...",
      "..hhhhhhhhhD..",
      "..hhhhhhhhD...",
      "..hhhhhhhhD...",
      "...hhhhhhD....",
      "....hhDD......",
    ],
    n: [
      "..............",
      ".....HHhh.....",
      "....HHhhhh....",
      "...HhhhhhhD...",
      "..hhhhhhhhhD..",
      "..hhhhhhhhhD..",
      "...hhhhhhhD...",
      "....hhhhhD....",
      ".....hDD......",
    ],
  },
};

/** Bare heads: hair variants picked by seed (index 2 is the prison crop). */
const HAIR: Record<Facing, string[]>[] = [
  // 0: short, as the base
  { s: [], se: [], e: [], ne: [], n: [] },
  // 1: combed back with a side parting, a light streak
  {
    s: ["..............", ".....Rrrq.....", "....RqqrqR....", "...RqrrrqrR..."],
    se: ["..............", ".....Rrrq.....", "....RqqrqR....", "...RqrrrqrR..."],
    e: ["..............", ".....Rrrq.....", "....RqqqrR....", "...RqrrrrqR..."],
    ne: ["..............", ".....Rrrq.....", "....RqqrqR....", "...RqrrrqrR..."],
    n: ["..............", ".....Rrrq.....", "....RqqrqR....", "...RqrrrqrR..."],
  },
  // 2: cropped (prison): dark stubble tight to the skull, the temples bare
  {
    s: ["..............", ".....RRRR.....", "....RRrrRR....", "...RrrRrrrR...", "...SsssssSS..."],
    se: ["..............", ".....RRRR.....", "....RRrrRR....", "...RrRrrrrR...", "...RSssssss..."],
    e: ["..............", ".....RRRR.....", "....RRrrRR....", "...RrrRrrrR...", "...RRSSssss..."],
    ne: ["..............", ".....RRRR.....", "....RRrrRR....", "...RrrRrrrR...", "...RRrRrrrR..."],
    n: ["..............", ".....RRRR.....", "....RRrrRR....", "...RrrRrrrR...", "...RRrRrrrR..."],
  },
];

/** Rudy after Szucha: a bandage round the head, a swollen eye, a cut. */
const BEATEN: Record<Facing, string[]> = {
  s: ["..............", "..............", "..............", "...WwwwwwwW...", "...wwwxwwwW...", "...sbeSsesS...", "...sssssBsS..."],
  se: ["..............", "..............", "..............", "...WwwwwwwwW..", "...Wwwwwxww...", "...rSbesses...", "...RSssssBs..."],
  e: ["..............", "..............", "..............", "...WwwwwwwwW..", "...Wwwwwwxw...", "...rrrSsbes...", "...RrrSsssBs.."],
  ne: ["..............", "..............", "..............", "...WwwwwwwwW..", "...Wwwwwwwww..", "..............", ".............."],
  n: ["..............", "..............", "..............", "...WwwwwwwwW..", "...WwwwxwwwW..", "..............", ".............."],
};

/** Driver: a small tag glyph on the cap's crown. */
const TAG: Partial<Record<Facing, string[]>> = {
  s: ["..............", "..............", "......tt......"],
  se: ["..............", "..............", ".......tt....."],
  e: ["..............", "..............", "..........t..."],
};

const cache = new Map<string, Tpl>();

/** The head template for a look: base face, hair style, headgear, marks. Built once, cached. */
export function headTpl(f: Facing, gear: Headgear, hair: number, beaten: boolean, tag: boolean): Tpl {
  const key = `${f}|${gear}|${hair}|${beaten ? 1 : 0}|${tag ? 1 : 0}`;
  let t = cache.get(key);
  if (t) return t;
  t = T(BASE[f]);
  if (gear === "bare") {
    const v = HAIR[hair % HAIR.length][f];
    if (v.length) t = overlay(t, T(v));
  }
  if (beaten) t = overlay(t, T(BEATEN[f]));
  if (gear !== "bare") t = overlay(t, T(GEAR[gear][f]));
  if (tag && (gear === "cap" || gear === "beret") && TAG[f]) t = overlay(t, T(TAG[f]!));
  cache.set(key, t);
  return t;
}

function pad(rows: string[]): string[] {
  const out = rows.slice();
  while (out.length < HEAD_H) out.push("..............");
  return out;
}

/** Every template's rows, for the tests (row widths). */
export function allHeadRows(): string[][] {
  const out: string[][] = [];
  for (const f of Object.keys(BASE) as Facing[]) {
    out.push(BASE[f]);
    for (const g of Object.keys(GEAR) as (keyof typeof GEAR)[]) out.push(GEAR[g][f]);
    for (const h of HAIR) out.push(h[f]);
    out.push(BEATEN[f]);
    if (TAG[f]) out.push(TAG[f]!);
  }
  return out;
}
