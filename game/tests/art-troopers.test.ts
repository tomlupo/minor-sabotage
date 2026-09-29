// Troopers and portraits (style guide §6, §8): the contract in src/art/types.ts, palette-only
// colours (§3), determinism, and a figure in every frame.
import { describe, expect, it } from "vitest";
import { buildTrooperSheet, MUZZLE, TROOPER_ANIMS } from "../src/art/troopers";
import { buildPortrait } from "../src/art/portraits";
import { allHeadRows, HEAD_W } from "../src/art/troopers-heads";
import { ANIM_FRAMES, FACINGS, TROOPER_CELL, type Anim, type Body, type Headgear, type Kit, type TrooperLook, type Weapon } from "../src/art/types";
import { img, type PixelImage, type Sheet } from "../src/art/pixel";
import { offPalette, opaqueCount } from "./helpers/palette-check";
import { PAL } from "../src/art/palette";

const ANIMS = Object.keys(ANIM_FRAMES) as Anim[];
const EXPECTED = FACINGS.flatMap((f) => ANIMS.flatMap((a) => Array.from({ length: ANIM_FRAMES[a] }, (_, i) => `${a}_${f}_${i}`)));

const BODIES: Record<Body, TrooperLook> = {
  partisan: { body: "partisan", jacket: 0, headgear: "cap", weapon: "sten", kit: "none", armband: true, seed: 3 },
  occupier: { body: "occupier", headgear: "stahlhelm", weapon: "rifle", kit: "none", seed: 21 },
  prisoner: { body: "prisoner", headgear: "bare", weapon: "none", kit: "none", seed: 31 },
  civilian_m: { body: "civilian_m", jacket: 1, headgear: "hat", weapon: "none", kit: "none", seed: 33 },
  civilian_f: { body: "civilian_f", jacket: 2, headgear: "headscarf", weapon: "none", kit: "none", seed: 35 },
};

// every headgear, weapon and kit at least once, on the bodies that wear them
const HEADGEAR: Headgear[] = ["cap", "hat", "beret", "bare", "helmet_wz31", "stahlhelm", "stahlhelm_big", "peaked_cap", "headscarf"];
const WEAPONS: Weapon[] = ["none", "sten", "pistol", "rifle", "mp40"];
const KITS: Kit[] = ["none", "binoculars", "charge_pack", "bottle_bag", "grenade_pouch", "driver_tag"];
const VARIETY: TrooperLook[] = [
  ...Object.values(BODIES),
  ...HEADGEAR.map((headgear, i): TrooperLook => ({ body: "partisan", jacket: i, headgear, weapon: WEAPONS[i % WEAPONS.length], kit: KITS[i % KITS.length], armband: i % 2 === 0, seed: 50 + i })),
  ...KITS.map((kit, i): TrooperLook => ({ body: "partisan", jacket: i + 1, headgear: "cap", weapon: "sten", kit, armband: true, seed: 70 + i })),
  { body: "occupier", headgear: "peaked_cap", weapon: "pistol", kit: "none", seed: 23 },
  { body: "occupier", headgear: "stahlhelm", weapon: "mp40", kit: "grenade_pouch", seed: 22 },
  { body: "prisoner", headgear: "bare", weapon: "none", kit: "none", seed: 32, beaten: true },
  { body: "civilian_m", headgear: "cap", weapon: "none", kit: "none", jacket: 3, seed: 34 },
  { body: "civilian_f", headgear: "hat", weapon: "none", kit: "none", jacket: 1, seed: 36 },
];

function cell(sheet: Sheet, name: string): PixelImage {
  const f = sheet.frames.find((q) => q.name === name)!;
  const out = img(f.w, f.h);
  for (let y = 0; y < f.h; y++) {
    const s = ((f.y + y) * sheet.image.w + f.x) * 4;
    out.data.set(sheet.image.data.subarray(s, s + f.w * 4), y * f.w * 4);
  }
  return out;
}

/** Opaque bounding box of an image, or null when empty. */
function bbox(im: PixelImage): { x0: number; y0: number; x1: number; y1: number } | null {
  let x0 = im.w, y0 = im.h, x1 = -1, y1 = -1;
  for (let y = 0; y < im.h; y++) for (let x = 0; x < im.w; x++) {
    if (im.data[(y * im.w + x) * 4 + 3]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}

describe("trooper sheets: the contract", () => {
  for (const [body, look] of Object.entries(BODIES)) {
    describe(body, () => {
      const sheet = buildTrooperSheet(look);

      it("has every frame of the contract, once", () => {
        const names = sheet.frames.map((f) => f.name);
        expect(new Set(names).size).toBe(names.length);
        expect([...names].sort()).toEqual([...EXPECTED].sort());
      });

      it("uses 24 x 24 cells with the feet at (12, 22), inside the image", () => {
        for (const f of sheet.frames) {
          expect([f.w, f.h, f.ax, f.ay]).toEqual([TROOPER_CELL.w, TROOPER_CELL.h, TROOPER_CELL.ax, TROOPER_CELL.ay]);
          expect(f.x + f.w).toBeLessThanOrEqual(sheet.image.w);
          expect(f.y + f.h).toBeLessThanOrEqual(sheet.image.h);
        }
      });

      it("draws a figure in every frame", () => {
        for (const f of sheet.frames) expect(opaqueCount(cell(sheet, f.name)), f.name).toBeGreaterThan(60);
      });

      it("stands on the anchor: idle feet on row 22, within the 22 px of the style guide", () => {
        for (const facing of FACINGS) {
          const b = bbox(cell(sheet, `idle_${facing}_0`))!;
          expect(b.y1, `idle_${facing}_0 feet`).toBe(TROOPER_CELL.ay);
          expect(b.y1 - b.y0 + 1, `idle_${facing}_0 height`).toBeLessThanOrEqual(23);
        }
      });

      it("ends the death lying on the ground (wider than tall, low in the cell)", () => {
        for (const facing of FACINGS) {
          const b = bbox(cell(sheet, `death_${facing}_4`))!;
          expect(b.x1 - b.x0, `death_${facing}_4`).toBeGreaterThan(b.y1 - b.y0);
          expect(b.y0, `death_${facing}_4 top`).toBeGreaterThan(6);
        }
      });
    });
  }
});

describe("trooper sheets: colour and determinism", () => {
  it("uses only palette colours, for every headgear, weapon, kit and body", () => {
    for (const look of VARIETY) {
      const r = offPalette(buildTrooperSheet(look).image);
      expect(r.count, `${JSON.stringify(look)} off-palette: ${r.examples.join(" ")}`).toBe(0);
    }
  });

  it("keeps every figure's outline inside its cell (no colour on the border rows and columns)", () => {
    const [or, og, ob] = PAL.shared.outline;
    const bad: string[] = [];
    for (const look of VARIETY) {
      const sheet = buildTrooperSheet(look);
      for (const f of sheet.frames) {
        const im = cell(sheet, f.name);
        for (let k = 0; k < 24; k++) {
          for (const [x, y] of [[k, 0], [k, 23], [0, k], [23, k]]) {
            const i = (y * im.w + x) * 4;
            if (im.data[i + 3] && !(im.data[i] === or && im.data[i + 1] === og && im.data[i + 2] === ob)) {
              bad.push(`${look.body}/${look.headgear}/${look.weapon} ${f.name} at ${x},${y}`);
              break;
            }
          }
        }
      }
    }
    expect([...new Set(bad)].slice(0, 20), `${bad.length} border pixels`).toEqual([]);
  });

  it("is deterministic: the same look gives identical bytes", () => {
    for (const look of VARIETY.slice(0, 8)) {
      const a = buildTrooperSheet(look).image.data;
      const b = buildTrooperSheet({ ...look }).image.data;
      expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    }
  });

  it("differs by look: jackets and headgear change the pixels", () => {
    const a = buildTrooperSheet({ ...BODIES.partisan, jacket: 0 }).image.data;
    const b = buildTrooperSheet({ ...BODIES.partisan, jacket: 1 }).image.data;
    const c = buildTrooperSheet({ ...BODIES.partisan, headgear: "helmet_wz31" }).image.data;
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
    expect(Buffer.from(a).equals(Buffer.from(c))).toBe(false);
  });
});

describe("animation table and muzzles", () => {
  it("has a rate for every animation; death and throw play once", () => {
    for (const a of ANIMS) expect(TROOPER_ANIMS[a].fps).toBeGreaterThan(0);
    expect(TROOPER_ANIMS.death.loop).toBe(false);
    expect(TROOPER_ANIMS.throw.loop).toBe(false);
    expect(TROOPER_ANIMS.walk.loop).toBe(true);
  });

  it("puts every muzzle in the cell, next to the drawn gun on fire frame 0", () => {
    for (const w of ["sten", "pistol", "rifle", "mp40"] as const) {
      const sheet = buildTrooperSheet({ body: "partisan", headgear: "cap", weapon: w, kit: "none", seed: 1 });
      for (const f of FACINGS) {
        const [mx, my] = MUZZLE[w][f];
        expect(Number.isInteger(mx) && Number.isInteger(my)).toBe(true);
        expect(mx >= 0 && my >= 0 && mx < TROOPER_CELL.w && my < TROOPER_CELL.h, `${w} ${f}`).toBe(true);
        const im = cell(sheet, `fire_${f}_0`);
        let near = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const x = mx + dx, y = my + dy;
          if (x >= 0 && y >= 0 && x < im.w && y < im.h && im.data[(y * im.w + x) * 4 + 3]) near++;
        }
        expect(near, `${w} ${f} muzzle ${mx},${my}`).toBeGreaterThan(0);
      }
    }
  });
});

describe("head templates", () => {
  it("are all 14 columns wide", () => {
    for (const rows of allHeadRows()) for (const r of rows) expect(r.length, r).toBe(HEAD_W);
  });
});

describe("portraits", () => {
  const looks = VARIETY;
  it("are 24 x 28 busts, palette only, never empty", () => {
    for (const look of looks) {
      for (const seed of [0, 1, 7]) {
        const p = buildPortrait(look, seed);
        expect([p.w, p.h]).toEqual([24, 28]);
        expect(opaqueCount(p)).toBeGreaterThan(300);
        const r = offPalette(p);
        expect(r.count, `${JSON.stringify(look)} seed ${seed}: ${r.examples.join(" ")}`).toBe(0);
      }
    }
  });

  it("keep the head's outline inside the picture (the bust is cut only at the shoulders)", () => {
    const [or, og, ob] = PAL.shared.outline;
    for (const look of looks) {
      const p = buildPortrait(look, 3);
      const edge: [number, number][] = [];
      for (let x = 0; x < 24; x++) edge.push([x, 0]);
      for (let y = 0; y < 18; y++) edge.push([0, y], [23, y]);
      for (const [x, y] of edge) {
        const i = (y * 24 + x) * 4;
        const colour = p.data[i + 3] && !(p.data[i] === or && p.data[i + 1] === og && p.data[i + 2] === ob);
        expect(colour, `${look.body}/${look.headgear} portrait at ${x},${y}`).toBeFalsy();
      }
    }
  });

  it("are deterministic and vary by seed", () => {
    const look = BODIES.partisan;
    expect(Buffer.from(buildPortrait(look, 4).data).equals(Buffer.from(buildPortrait(look, 4).data))).toBe(true);
    const distinct = new Set([0, 1, 2, 3, 4, 5].map((s) => Buffer.from(buildPortrait(look, s).data).toString("base64")));
    expect(distinct.size).toBeGreaterThan(3);
  });
});
