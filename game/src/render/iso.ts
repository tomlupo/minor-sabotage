// The one projection (style guide §2): ground (x, y) metres at height z lands at
// sx = 12x, sy = 9y - 7.5z art px.
export const PX_X = 12;
export const PX_Y = 9;
export const PX_Z = 7.5;

export const sx = (x: number) => x * PX_X;
export const sy = (y: number, z = 0) => y * PX_Y - z * PX_Z;
export const wx = (px: number) => px / PX_X;
export const wy = (py: number) => py / PX_Y;

/** Facing for a world direction, chosen on screen (the ground is squashed 0.75). */
export function facingOf(dir: number): { f: "s" | "se" | "e" | "ne" | "n"; flip: boolean } {
  const a = Math.atan2(Math.sin(dir) * PX_Y, Math.cos(dir) * PX_X);
  const k = Math.round(a / (Math.PI / 4)); // -4..4, 0 = east, 2 = south
  switch (((k % 8) + 8) % 8) {
    case 0: return { f: "e", flip: false };
    case 1: return { f: "se", flip: false };
    case 2: return { f: "s", flip: false };
    case 3: return { f: "se", flip: true };
    case 4: return { f: "e", flip: true };
    case 5: return { f: "ne", flip: true };
    case 6: return { f: "n", flip: false };
    default: return { f: "ne", flip: false };
  }
}

/** Vehicle frame (16 headings, h0 east, clockwise). */
export function headingFrame(heading: number): string {
  const k = Math.round(heading / (Math.PI / 8));
  return `h${((k % 16) + 16) % 16}`;
}
