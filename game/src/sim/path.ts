// Route finding (autonomy rung 1, "smart squad"): A* over the 1 m grid, 8 directions, no
// corner cutting, then string-pulled into straight runs so the column walks like people,
// not like a rook. Buffers are reused between searches; a search is capped so a tap on an
// unreachable spot never stalls a frame on the phone.
import type { Grid } from "./grid";

export interface Pt {
  x: number;
  y: number;
}

const SQRT2 = Math.SQRT2;
const DIRS: [number, number, number][] = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, SQRT2], [1, -1, SQRT2], [-1, 1, SQRT2], [-1, -1, SQRT2],
];

class Heap {
  private ids: Int32Array;
  private keys: Float64Array;
  size = 0;
  constructor(cap: number) {
    this.ids = new Int32Array(cap);
    this.keys = new Float64Array(cap);
  }
  clear() { this.size = 0; }
  push(id: number, key: number) {
    if (this.size >= this.ids.length) {
      const ni = new Int32Array(this.ids.length * 2); ni.set(this.ids); this.ids = ni;
      const nk = new Float64Array(this.keys.length * 2); nk.set(this.keys); this.keys = nk;
    }
    let i = this.size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p] <= key) break;
      this.ids[i] = this.ids[p]; this.keys[i] = this.keys[p]; i = p;
    }
    this.ids[i] = id; this.keys[i] = key;
  }
  pop(): number {
    const top = this.ids[0];
    const lastId = this.ids[--this.size], lastKey = this.keys[this.size];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= this.size) break;
      if (c + 1 < this.size && this.keys[c + 1] < this.keys[c]) c++;
      if (this.keys[c] >= lastKey) break;
      this.ids[i] = this.ids[c]; this.keys[i] = this.keys[c]; i = c;
    }
    this.ids[i] = lastId; this.keys[i] = lastKey;
    return top;
  }
}

export class PathFinder {
  private g: Float32Array;
  private parent: Int32Array;
  private stamp: Uint32Array;
  private closed: Uint32Array;
  private gen = 1;
  private heap: Heap;
  /** Nodes expanded by the last search (for tests and tuning). */
  lastExpanded = 0;

  constructor(private grid: Grid) {
    const n = grid.w * grid.h;
    this.g = new Float32Array(n);
    this.parent = new Int32Array(n);
    this.stamp = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    this.heap = new Heap(1024);
  }

  /**
   * A route from `from` to `to` as waypoints (excluding the start), or null when there is
   * none within `maxNodes`. When the goal cell is blocked, the nearest walkable cell is used.
   * `extraCost(cx, cy)` lets callers make cells expensive (e.g. inside a guard's cone).
   */
  find(from: Pt, to: Pt, maxNodes = 12000, extraCost?: (cx: number, cy: number) => number): Pt[] | null {
    const G = this.grid;
    const goal = G.walkable(to.x, to.y) ? to : G.nearestWalkable(to.x, to.y, 6);
    const start = G.walkable(from.x, from.y) ? from : G.nearestWalkable(from.x, from.y, 3);
    if (!goal || !start) return null;
    const sx = Math.floor(start.x), sy = Math.floor(start.y);
    const gx = Math.floor(goal.x), gy = Math.floor(goal.y);
    if (sx === gx && sy === gy) return [{ x: goal.x, y: goal.y }];

    this.gen++;
    if (this.gen === 0xffffffff) { this.stamp.fill(0); this.closed.fill(0); this.gen = 1; }
    const gen = this.gen;
    const W = G.w;
    const heap = this.heap;
    heap.clear();
    const s = sy * W + sx, goalId = gy * W + gx;
    this.g[s] = 0; this.stamp[s] = gen; this.parent[s] = -1;
    const h = (cx: number, cy: number) => {
      const dx = Math.abs(cx - gx), dy = Math.abs(cy - gy);
      return (dx + dy) + (SQRT2 - 2) * Math.min(dx, dy);
    };
    heap.push(s, h(sx, sy));
    let expanded = 0, found = false;
    let bestId = s, bestH = h(sx, sy);
    while (heap.size) {
      const cur = heap.pop();
      if (this.closed[cur] === gen) continue;
      this.closed[cur] = gen;
      if (cur === goalId) { found = true; break; }
      if (++expanded > maxNodes) break;
      const cx = cur % W, cy = (cur - cx) / W;
      const hc = h(cx, cy);
      if (hc < bestH) { bestH = hc; bestId = cur; }
      for (const [dx, dy, cost] of DIRS) {
        const nx = cx + dx, ny = cy + dy;
        if (!G.walkableCell(nx, ny)) continue;
        if (dx && dy && (!G.walkableCell(cx + dx, cy) || !G.walkableCell(cx, cy + dy))) continue;
        const n = ny * W + nx;
        if (this.closed[n] === gen) continue;
        const ng = this.g[cur] + cost + (extraCost ? extraCost(nx, ny) : 0);
        if (this.stamp[n] !== gen || ng < this.g[n]) {
          this.stamp[n] = gen; this.g[n] = ng; this.parent[n] = cur;
          heap.push(n, ng + h(nx, ny) * 1.001);
        }
      }
    }
    this.lastExpanded = expanded;
    // No complete route: walk as close as we got, like a squad that cannot find a way round.
    const endId = found ? goalId : bestId;
    if (endId === s) return null;
    const cells: Pt[] = [];
    for (let c = endId; c !== -1 && c !== s; c = this.parent[c]) {
      const cx = c % W, cy = (c - cx) / W;
      cells.push({ x: cx + 0.5, y: cy + 0.5 });
    }
    cells.reverse();
    if (found) cells[cells.length - 1] = { x: goal.x, y: goal.y };
    return smooth(G, start, cells);
  }
}

/** String pulling: drop waypoints that can be skipped by a straight walkable line. */
export function smooth(G: Grid, start: Pt, pts: Pt[]): Pt[] {
  if (pts.length <= 1) return pts;
  const out: Pt[] = [];
  let anchor = start;
  let last = pts[0];
  // Greedy forward: keep extending the straight run from the anchor until it would clip a
  // wall, then bend at the last point that was still visible. Linear in the route length.
  for (let k = 1; k < pts.length; k++) {
    if (!G.walkLine(anchor.x, anchor.y, pts[k].x, pts[k].y, 0.35)) {
      out.push(last);
      anchor = last;
    }
    last = pts[k];
  }
  out.push(pts[pts.length - 1]);
  return out;
}

export function pathLength(from: Pt, pts: Pt[]): number {
  let d = 0, p = from;
  for (const q of pts) { d += Math.hypot(q.x - p.x, q.y - p.y); p = q; }
  return d;
}
