// The map as the rules see it: 1 m cells with flags, read from the Tiled tile and object
// properties (ADR-0001: walkable, blocks sight, cover, building group id, street id).
// Route finding and line of sight are our own small code over this grid.

export const F_WALK = 1; // units can stand here
export const F_SIGHT = 2; // blocks sight (walls, buildings)
export const F_COVER = 4; // low cover: bullets may stop here (sandbags, a car body)
export const F_ROOF = 8; // under a roof (a gateway passage): units show as silhouettes
export const F_VEH = 16; // dynamic: a vehicle stands here (not walkable, blocks sight)
export const F_FIRE = 32; // dynamic: burning petrol here (not walkable; sight passes)

export class Grid {
  readonly w: number;
  readonly h: number;
  readonly flags: Uint8Array;
  /** Street id per cell (-1 none): which street a cell belongs to, for the cut. */
  readonly street: Int16Array;
  /** Building group id per cell (-1 none). */
  readonly building: Int16Array;
  /** Zone bitmask per cell (districts, exits), set by missions. */
  readonly zone: Uint32Array;

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.flags = new Uint8Array(w * h);
    this.street = new Int16Array(w * h).fill(-1);
    this.building = new Int16Array(w * h).fill(-1);
    this.zone = new Uint32Array(w * h);
  }

  idx(cx: number, cy: number): number {
    return cy * this.w + cx;
  }

  inBounds(cx: number, cy: number): boolean {
    return cx >= 0 && cy >= 0 && cx < this.w && cy < this.h;
  }

  flagAt(x: number, y: number): number {
    const cx = Math.floor(x), cy = Math.floor(y);
    if (!this.inBounds(cx, cy)) return F_SIGHT;
    return this.flags[cy * this.w + cx];
  }

  walkableCell(cx: number, cy: number): boolean {
    if (!this.inBounds(cx, cy)) return false;
    const f = this.flags[cy * this.w + cx];
    return (f & F_WALK) !== 0 && (f & (F_VEH | F_FIRE)) === 0;
  }

  walkable(x: number, y: number): boolean {
    return this.walkableCell(Math.floor(x), Math.floor(y));
  }

  blocksSightCell(cx: number, cy: number): boolean {
    if (!this.inBounds(cx, cy)) return true;
    return (this.flags[cy * this.w + cx] & (F_SIGHT | F_VEH)) !== 0;
  }

  streetAt(x: number, y: number): number {
    const cx = Math.floor(x), cy = Math.floor(y);
    return this.inBounds(cx, cy) ? this.street[cy * this.w + cx] : -1;
  }

  zoneAt(x: number, y: number): number {
    const cx = Math.floor(x), cy = Math.floor(y);
    return this.inBounds(cx, cy) ? this.zone[cy * this.w + cx] : 0;
  }

  /**
   * Walk the cells a segment crosses (Amanatides–Woo DDA). The callback gets each cell and
   * the distance along the ray where it enters it; returning true stops the walk.
   * Returns true if the walk was stopped by the callback.
   */
  traverse(x0: number, y0: number, x1: number, y1: number, cb: (cx: number, cy: number, t: number) => boolean): boolean {
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    let cx = Math.floor(x0), cy = Math.floor(y0);
    const ex = Math.floor(x1), ey = Math.floor(y1);
    if (cb(cx, cy, 0)) return true;
    if (len < 1e-9) return false;
    const ux = dx / len, uy = dy / len;
    const stepX = ux > 0 ? 1 : -1, stepY = uy > 0 ? 1 : -1;
    const tDeltaX = ux !== 0 ? Math.abs(1 / ux) : Infinity;
    const tDeltaY = uy !== 0 ? Math.abs(1 / uy) : Infinity;
    let tMaxX = ux !== 0 ? ((ux > 0 ? cx + 1 - x0 : x0 - cx) * tDeltaX) : Infinity;
    let tMaxY = uy !== 0 ? ((uy > 0 ? cy + 1 - y0 : y0 - cy) * tDeltaY) : Infinity;
    let guard = 0;
    while ((cx !== ex || cy !== ey) && guard++ < 4096) {
      let t: number;
      if (tMaxX < tMaxY) { t = tMaxX; tMaxX += tDeltaX; cx += stepX; }
      else { t = tMaxY; tMaxY += tDeltaY; cy += stepY; }
      if (t > len) break;
      if (cb(cx, cy, t)) return true;
    }
    return false;
  }

  /** Clear line of sight between two points (eye height is implied: walls block, low cover does not). */
  los(x0: number, y0: number, x1: number, y1: number): boolean {
    const ex = Math.floor(x1), ey = Math.floor(y1);
    const sx = Math.floor(x0), sy = Math.floor(y0);
    return !this.traverse(x0, y0, x1, y1, (cx, cy) => {
      if ((cx === sx && cy === sy) || (cx === ex && cy === ey)) return false;
      return this.blocksSightCell(cx, cy);
    });
  }

  /** Distance a ray travels from (x0,y0) at `angle` before hitting something that blocks sight. */
  rayDist(x0: number, y0: number, angle: number, max: number): number {
    const x1 = x0 + Math.cos(angle) * max, y1 = y0 + Math.sin(angle) * max;
    const sx = Math.floor(x0), sy = Math.floor(y0);
    let hit = max;
    this.traverse(x0, y0, x1, y1, (cx, cy, t) => {
      if (cx === sx && cy === sy) return false;
      if (this.blocksSightCell(cx, cy)) { hit = t; return true; }
      return false;
    });
    return hit;
  }

  /** Straight walkable segment (used to smooth paths): no blocked cell along a fattened ray. */
  walkLine(x0: number, y0: number, x1: number, y1: number, radius = 0.3): boolean {
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) return this.walkable(x0, y0);
    const nx = (-dy / len) * radius, ny = (dx / len) * radius;
    for (const [ox, oy] of [[0, 0], [nx, ny], [-nx, -ny]]) {
      const blocked = this.traverse(x0 + ox, y0 + oy, x1 + ox, y1 + oy, (cx, cy) => !this.walkableCell(cx, cy));
      if (blocked) return false;
    }
    return true;
  }

  /** Nearest walkable cell centre to (x, y), searching outward up to `maxR` cells. */
  nearestWalkable(x: number, y: number, maxR = 12): { x: number; y: number } | null {
    const cx = Math.floor(x), cy = Math.floor(y);
    if (this.walkableCell(cx, cy)) return { x, y };
    for (let r = 1; r <= maxR; r++) {
      let best: { x: number; y: number } | null = null, bd = Infinity;
      for (let yy = cy - r; yy <= cy + r; yy++) {
        for (let xx = cx - r; xx <= cx + r; xx++) {
          if (Math.max(Math.abs(xx - cx), Math.abs(yy - cy)) !== r) continue;
          if (!this.walkableCell(xx, yy)) continue;
          const d = (xx + 0.5 - x) ** 2 + (yy + 0.5 - y) ** 2;
          if (d < bd) { bd = d; best = { x: xx + 0.5, y: yy + 0.5 }; }
        }
      }
      if (best) return best;
    }
    return null;
  }
}
