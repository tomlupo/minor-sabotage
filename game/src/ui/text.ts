// The game's own pixel type (src/art/font.ts, drawn as code) as Phaser bitmap fonts.
// Glyphs are white in the atlas, so every text is tinted from the palette.
import Phaser from "phaser";
import { FONT, FONT_SMALL, FONT_BIG, buildFontAtlas, wrapText, measure, type PixelFont } from "../art/font";
import { toCanvas } from "../art/pixel";
import { hex, type RGB } from "../art/palette";

export const PX = "px";
export const PXS = "pxs";
export const PXB = "pxb";
const FONTS: [string, PixelFont][] = [[PX, FONT], [PXS, FONT_SMALL], [PXB, FONT_BIG]];

/** Register the three fonts once per game (safe to call from any scene). */
export function registerFonts(scene: Phaser.Scene): void {
  for (const [key, font] of FONTS) {
    if (scene.cache.bitmapFont.exists(key)) continue;
    const atlas = buildFontAtlas(font);
    const tex = scene.textures.addCanvas(`font:${key}`, toCanvas(atlas.image))!;
    const W = atlas.image.w, H = atlas.image.h;
    const chars: Phaser.Types.GameObjects.BitmapText.BitmapFontData["chars"] = {};
    for (const [code, c] of Object.entries(atlas.chars)) {
      // same arithmetic as Phaser's ParseXMLBitmapFont (v4 textures are GL-oriented)
      chars[Number(code)] = {
        x: c.x, y: c.y, width: c.w, height: c.h,
        centerX: Math.floor(c.w / 2), centerY: Math.floor(c.h / 2),
        xOffset: c.xoff, yOffset: c.yoff, xAdvance: c.adv,
        data: {}, kerning: {},
        u0: c.x / W, v0: 1 - c.y / H, u1: (c.x + c.w) / W, v1: 1 - (c.y + c.h) / H,
      } as Phaser.Types.GameObjects.BitmapText.BitmapFontCharacterData;
    }
    const data = { font: key, size: atlas.size, lineHeight: atlas.lineHeight, retroFont: false, chars } as Phaser.Types.GameObjects.BitmapText.BitmapFontData;
    scene.cache.bitmapFont.add(key, { data, texture: `font:${key}`, frame: null });
    void tex;
  }
}

export function fontOf(key: string): PixelFont {
  return key === PXS ? FONT_SMALL : key === PXB ? FONT_BIG : FONT;
}

export interface TxtOpts {
  font?: string;
  color?: RGB;
  /** 0 left, 0.5 centre, 1 right (origin x). */
  align?: number;
  /** Wrap to this width in art px. */
  wrap?: number;
  depth?: number;
  lineGap?: number;
}

/** Crisp pixel text. Wrapping uses the font's own measure so lines break like the art. */
export function txt(scene: Phaser.Scene, x: number, y: number, text: string, o: TxtOpts = {}): Phaser.GameObjects.BitmapText {
  const key = o.font ?? PX;
  // the small face (it stamps identity tags) and the big one are capitals only
  const s = key === PXS || key === PXB ? text.toLocaleUpperCase("pl") : text;
  const body = o.wrap ? wrapText(fontOf(key), s, o.wrap).join("\n") : s;
  const t = scene.add.bitmapText(Math.round(x), Math.round(y), key, body);
  if (o.color) t.setTint(hex(o.color));
  if (o.align !== undefined) t.setOrigin(o.align, 0);
  if (o.lineGap) t.setLineSpacing(o.lineGap);
  if (o.depth !== undefined) t.setDepth(o.depth);
  return t;
}

export function textWidth(text: string, key = PX): number {
  return measure(fontOf(key), text);
}
