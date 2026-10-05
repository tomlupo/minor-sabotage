// Turns the art generators (src/art/*, drawn as code) into Phaser textures, and derives what
// the game draws from them: the dotted silhouettes of troopers and vehicles behind a roof.
// The generators are imported by name, so a renamed export fails the type check instead of
// quietly drawing something else.
import Phaser from "phaser";
import type { PixelImage, Sheet, Frame } from "../art/pixel";
import { img, px, toCanvas } from "../art/pixel";
import { colour } from "../art/palette";
import type { TrooperLook, BuildingArt, BuildingSpec } from "../art/types";
import { buildTrooperSheet } from "../art/troopers";
import { buildPortrait } from "../art/portraits";
import { buildBuilding } from "../art/city/buildings";
import { buildArsenal } from "../art/city/arsenal";

// ------------------------------------------------------------------ registering textures

/** Add a sheet as a Phaser texture with named frames. */
export function addSheet(scene: Phaser.Scene, key: string, sheet: Sheet): void {
  if (scene.textures.exists(key)) scene.textures.remove(key);
  const tex = scene.textures.addCanvas(key, toCanvas(sheet.image))!;
  for (const f of sheet.frames) tex.add(f.name, 0, f.x, f.y, f.w, f.h);
}

export function addImage(scene: Phaser.Scene, key: string, im: PixelImage): void {
  if (scene.textures.exists(key)) scene.textures.remove(key);
  scene.textures.addCanvas(key, toCanvas(im));
}

// ------------------------------------------------------------------ silhouettes

/**
 * Dotted silhouettes of every frame (style guide §8): every other pixel of the figure's edge,
 * in the palette's tint white, so the game tints it gold for yours and red for theirs. Pixels
 * under half opacity (a vehicle's baked ground shadow) are not part of the figure.
 */
export function silhouetteSheet(sheet: Sheet): Sheet {
  const out = img(sheet.image.w, sheet.image.h);
  const s = sheet.image;
  const tint = colour("hud_extra", "tint");
  const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < s.w && y < s.h && s.data[(y * s.w + x) * 4 + 3] > 127;
  for (let y = 0; y < s.h; y++) {
    for (let x = 0; x < s.w; x++) {
      if (!solid(x, y) || (x + y) % 2) continue;
      if (!solid(x + 1, y) || !solid(x - 1, y) || !solid(x, y + 1) || !solid(x, y - 1)) px(out, x, y, tint);
    }
  }
  return { image: out, frames: sheet.frames };
}

// ------------------------------------------------------------------ troopers

export interface TrooperTex {
  key: string;
  silKey: string;
  frames: Map<string, Frame>;
}

export function buildTrooper(scene: Phaser.Scene, key: string, look: TrooperLook): TrooperTex {
  const sheet = buildTrooperSheet(look);
  addSheet(scene, `tr:${key}`, sheet);
  addSheet(scene, `trs:${key}`, silhouetteSheet(sheet));
  return { key: `tr:${key}`, silKey: `trs:${key}`, frames: new Map(sheet.frames.map((f) => [f.name, f])) };
}

export function buildPortraitTexture(scene: Phaser.Scene, key: string, look: TrooperLook, seed: number): string {
  addImage(scene, `pt:${key}`, buildPortrait(look, seed));
  return `pt:${key}`;
}

// ------------------------------------------------------------------ buildings

/** The Arsenal is a set piece (style guide §7); every other building comes from the kit. */
export function buildingArt(spec: BuildingSpec & { kind?: string; courtyard?: { x: number; y: number; w: number; d: number } }): BuildingArt {
  return spec.kind === "arsenal" ? buildArsenal(spec) : buildBuilding(spec);
}
