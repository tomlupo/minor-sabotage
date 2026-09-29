// The game's text: two faces (ui/fonts.ts) drawn at the screen's own resolution, so a line
// reads as sharp as the screen allows while the art keeps its pixel grid (render/screen.ts).
// The papers (the briefing, the decision) are typed; the HUD, labels and buttons are set in the
// sans. The three sizes keep the pixel faces' names, cap heights and lines: PX the body
// (a 10 px line), PXS the small capitals that stamp names and tags (7 px), PXB the big heading
// capitals (17 px). In the sans they also keep the pixel faces' line widths, so layouts fit;
// the typewriter runs a little wider.
import Phaser from "phaser";
import { PAL, css, type RGB } from "../art/palette";
import { screen } from "../render/screen";
import { SANS, TYPEWRITER } from "./fonts";

export const PX = "px";
export const PXS = "pxs";
export const PXB = "pxb";

export type Face = "type" | "sans";

interface Role {
  /** Font size in art px. */
  size: number;
  /** Line pitch in art px. */
  line: number;
  weight: string;
  caps: boolean;
}

const ROLES: Record<Face, Record<string, Role>> = {
  sans: {
    [PX]: { size: 10, line: 10, weight: "500", caps: false },
    [PXS]: { size: 7, line: 7, weight: "700", caps: true },
    [PXB]: { size: 17, line: 17, weight: "700", caps: true },
  },
  type: {
    [PX]: { size: 8.5, line: 10, weight: "400", caps: false },
    [PXS]: { size: 7, line: 7, weight: "700", caps: true },
    [PXB]: { size: 15, line: 17, weight: "700", caps: true },
  },
};

/** Where the pixel faces' capitals began below a line's top, in art px: the new faces start theirs there too. */
const PIXEL_TOP: Record<string, number> = { [PX]: 2, [PXS]: 2, [PXB]: 3 };

const FACE = new WeakMap<Phaser.Scene, Face>();

/** The face a scene's text is set in unless a call says otherwise (the sans by default). */
export function setFace(scene: Phaser.Scene, face: Face): void {
  FACE.set(scene, face);
}

export interface TxtOpts {
  font?: string;
  /** Overrides the scene's face (a button on a typed paper is set in the sans). */
  face?: Face;
  color?: RGB;
  /** 0 left, 0.5 centre, 1 right (origin x). */
  align?: number;
  /** Wrap to this width in art px. */
  wrap?: number;
  depth?: number;
  lineGap?: number;
}

/** A text in its face and size, drawn at the screen's sharpness. */
export function txt(scene: Phaser.Scene, x: number, y: number, text: string, o: TxtOpts = {}): Phaser.GameObjects.Text {
  const face = o.face ?? FACE.get(scene) ?? "sans";
  const r = ROLES[face][o.font ?? PX] ?? ROLES[face][PX];
  const t = scene.add.text(Math.round(x), Math.round(y), "", {
    fontFamily: `"${face === "type" ? TYPEWRITER : SANS}"`,
    fontSize: `${r.size}px`,
    fontStyle: r.weight,
    color: css(o.color ?? PAL.shared.chalk),
    resolution: screen.s,
    wordWrap: o.wrap ? { width: o.wrap, useAdvancedWrap: true } : undefined,
  });
  // the pitch the pixel face had, whatever the font's own ascent and descent; set before the
  // words, so they are drawn once
  t.setLineSpacing(r.line - t.style.getTextMetrics().fontSize + (o.lineGap ?? 0));
  t.setText(r.caps ? text.toLocaleUpperCase("pl") : text);
  t.y += capShift(t, face, o.font ?? PX);
  if (o.align !== undefined) t.setOrigin(o.align, 0);
  if (o.depth !== undefined) t.setDepth(o.depth);
  return t;
}

/** Whether a size's face is set in capitals (the tags and headings). */
export function capsOf(font: string): boolean {
  return font === PXS || font === PXB;
}

let measurer: CanvasRenderingContext2D | null = null;

/** A 2D context set to a face and size, for measuring. */
function measuring(font: string, face: Face): { ctx: CanvasRenderingContext2D; r: Role } {
  const r = ROLES[face][font] ?? ROLES[face][PX];
  measurer ??= document.createElement("canvas").getContext("2d")!;
  measurer.font = `${r.weight} ${r.size}px "${face === "type" ? TYPEWRITER : SANS}"`;
  return { ctx: measurer, r };
}

/** How wide a line runs in art px, in a face and size, as txt sets it. */
export function measureText(text: string, font = PX, face: Face = "sans"): number {
  const { ctx, r } = measuring(font, face);
  return ctx.measureText(r.caps ? text.toLocaleUpperCase("pl") : text).width;
}

const SHIFTS = new Map<string, number>();

/**
 * How far (whole art px) a text in this face and size moves down so its capitals start where
 * the pixel face's did: Phaser sets the baseline at the font's ascent, which runs higher than a
 * capital by a margin of its own in each face.
 */
export function capShift(t: Phaser.GameObjects.Text, face: Face, font: string): number {
  const key = `${face}:${font}`;
  let shift = SHIFTS.get(key);
  if (shift === undefined) {
    const cap = measuring(font, face).ctx.measureText("H").actualBoundingBoxAscent;
    shift = Math.round((PIXEL_TOP[font] ?? PIXEL_TOP[PX]) - (t.style.getTextMetrics().ascent - cap));
    SHIFTS.set(key, shift);
  }
  return shift;
}

const FITTED = new Map<string, string>();

/** The line cut to run no wider than `max` art px, ending in a full stop where it was cut (as the pixel face's fitText cuts). */
export function fitLine(text: string, max: number, font = PX, face: Face = "sans"): string {
  const key = `${face}|${font}|${max}|${text}`;
  let out = FITTED.get(key);
  if (out === undefined) {
    out = cutToFit(text, max, font, face);
    // the HUD asks every frame, for a handful of labels
    if (FITTED.size > 500) FITTED.clear();
    FITTED.set(key, out);
  }
  return out;
}

function cutToFit(text: string, max: number, font: string, face: Face): string {
  if (measureText(text, font, face) <= max) return text;
  const chars = [...text];
  for (let n = chars.length - 1; n > 0; n--) {
    const cut = chars.slice(0, n).join("").trimEnd() + ".";
    if (measureText(cut, font, face) <= max) return cut;
  }
  return "";
}
