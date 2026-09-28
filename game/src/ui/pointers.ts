// Chalk arrows pointing at what the phase asks of you that is off the screen (Tom, 2026-09-28:
// "dont reealy know where is it, the other places where easier to spot"): each job on offer,
// at the nearest of the places that can do it, and each place an open objective names. An
// arrow stands on the line from the middle of the screen to its mark, as far out as it can:
// at the screen's edge, or just inside the HUD's boxes where they cover the edge, so it never
// hides under a button or the objectives. Pure: the HUD draws what this returns (style
// guide §8).

export interface Box { x: number; y: number; w: number; h: number }
export interface Insets { top: number; right: number; bottom: number; left: number }
/** A mark in the HUD's art px. Marks with one key do one job, and one arrow serves them all. */
export interface Mark { key: string; x: number; y: number }
export interface Arrow { key: string; x: number; y: number; angle: number }

/** Art px from an arrow's middle to its farthest pixel (its dark edge included). */
export const REACH = 7;
/** Art px kept between an arrow and the screen's edge or a HUD box. */
const GAP = 3;
/** Art px inside the screen's edge a mark must lie to count as seen. */
const SEEN = 12;

const within = (x: number, y: number, b: Box, pad: number) => x >= b.x - pad && x < b.x + b.w + pad && y >= b.y - pad && y < b.y + b.h + pad;

/** Where each unseen mark's arrow goes: one per key, pointing from the screen's middle at the nearest of its marks. */
export function placeArrows(marks: Mark[], w: number, h: number, safe: Insets, blocked: Box[]): Arrow[] {
  const x0 = safe.left, y0 = safe.top, x1 = w - safe.right, y1 = h - safe.bottom;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const seen = (m: Mark) => m.x >= x0 + SEEN && m.x < x1 - SEEN && m.y >= y0 + SEEN && m.y < y1 - SEEN && !blocked.some((b) => within(m.x, m.y, b, 0));
  const pad = REACH + GAP;
  const clear = (x: number, y: number) => x - pad >= x0 && x + pad < x1 && y - pad >= y0 && y + pad < y1 && !blocked.some((b) => within(x, y, b, pad));
  const byKey = new Map<string, Mark[]>();
  for (const m of marks) byKey.set(m.key, [...(byKey.get(m.key) ?? []), m]);
  const out: Arrow[] = [];
  for (const [key, list] of byKey) {
    if (list.some(seen)) continue;
    const best = list.reduce((a, b) => (Math.hypot(b.x - cx, b.y - cy) < Math.hypot(a.x - cx, a.y - cy) ? b : a));
    const len = Math.hypot(best.x - cx, best.y - cy);
    if (len < 1) continue;
    const ux = (best.x - cx) / len, uy = (best.y - cy) / len;
    // the farthest clear spot on the way from the middle to the mark: at the screen's edge, or
    // just inside the boxes that cover the edge there (a box nearer the middle does not stop it)
    const reach = (u: number, lo: number, hi: number, c: number) => (u > 0 ? (hi - c) / u : u < 0 ? (lo - c) / u : Infinity);
    let t = Math.floor(Math.min(len - 1, reach(ux, x0 + pad, x1 - pad - 1, cx), reach(uy, y0 + pad, y1 - pad - 1, cy)));
    while (t > 0 && !clear(cx + ux * t, cy + uy * t)) t--;
    // nowhere on its way is clear (the middle of the screen is covered): no arrow this frame
    if (t <= 0) continue;
    out.push({ key, x: Math.round(cx + ux * t), y: Math.round(cy + uy * t), angle: Math.atan2(uy, ux) });
  }
  return out;
}

/** An arrow's pixels about its middle pixel: the chalk inside, and a dark edge round it. */
export interface ArrowMask { fill: [number, number][]; edge: [number, number][] }

// Two shapes drawn as pixels and turned by quarter turns give the eight ways. A triangle turned
// to an odd angle and pixelated can read as pointing at any of its corners (review of the first
// cut: three of five arrows seemed to point elsewhere), so the arrow keeps to these.
/** Pointing right: a triangle 6 px deep and 11 px tall, its tip one pixel at x 2. */
const RIGHT: [number, number][] = [];
for (let y = -5; y <= 5; y++) for (let x = -3; x <= 2 - Math.abs(y); x++) RIGHT.push([x, y]);
/** Pointing down and right: the corner of a square 8 px across, its tip one pixel at (3, 3). */
const DOWN_RIGHT: [number, number][] = [];
for (let y = -4; y <= 3; y++) for (let x = -4; x <= 3; x++) if (x + y >= -1) DOWN_RIGHT.push([x, y]);

const MASKS = new Map<number, ArrowMask>();

/** The pixels of an arrow pointing along `angle` (radians, y down), in the nearest of 8 ways. */
export function arrowMask(angle: number): ArrowMask {
  const k = ((Math.round(angle / (Math.PI / 4)) % 8) + 8) % 8;
  let m = MASKS.get(k);
  if (!m) {
    // a quarter turn clockwise on the screen (y down) takes (x, y) to (-y, x)
    let fill = k % 2 === 0 ? RIGHT : DOWN_RIGHT;
    for (let q = 0; q < Math.floor(k / 2); q++) fill = fill.map(([x, y]) => [-y, x]);
    m = { fill, edge: edgeOf(fill) };
    MASKS.set(k, m);
  }
  return m;
}

/** The pixels round a shape: its dark edge. */
function edgeOf(fill: [number, number][]): [number, number][] {
  const on = new Set(fill.map(([x, y]) => `${x},${y}`));
  const edge: [number, number][] = [];
  for (let y = -REACH; y <= REACH; y++) for (let x = -REACH; x <= REACH; x++) {
    if (on.has(`${x},${y}`)) continue;
    if (on.has(`${x - 1},${y}`) || on.has(`${x + 1},${y}`) || on.has(`${x},${y - 1}`) || on.has(`${x},${y + 1}`)) edge.push([x, y]);
  }
  return edge;
}
