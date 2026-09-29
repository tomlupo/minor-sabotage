// What sits on the ground but is not the world (style guide §8): guard cones (a checker stipple
// of cone_yellow, 42% on the fill and 85% on the edge), your route (dotted select_gold ending in
// the gold diamond) and the gold ring under each of your men, the orders of squads you are not
// leading in their colour (a hold flag, a cover cone, a dotted route to the "waits for signal"
// mark), the guard posts that send men after the alarm, the jobs you can tap and the places
// the objectives name (chalk rings with a dark edge), and where you tapped.
//
// It is all rasterised into one buffer of art pixels laid over the world under the camera: every
// pixel is set whole, in one colour at the opacity its mark is drawn at, with no anti-aliased
// edge and no blending inside the overlay; the buffer goes to the GPU once a frame.
import Phaser from "phaser";
import { screen } from "./screen";
import type { Sim } from "../sim/sim";
import { actorOf } from "../sim/commands";
import { PAL, SQUAD_COLOURS, type RGB } from "../art/palette";
import type { PixelImage } from "../art/pixel";
import { buildHoldFlag, buildRouteEnd, buildSelection, buildTapRing, buildWaitMark, MARKER_ANCHORS, TAP_FRAMES } from "../art/hud";
import { ellipseRing, on } from "../art/hud-kit";
import { sx, sy } from "./iso";

/** Opacity of each kind of mark, 0..255 (§8: the cone at 42% and its edge at 85%). */
const CONE_FILL = Math.round(0.42 * 255);
const CONE_EDGE = Math.round(0.85 * 255);
const COVER_FILL = Math.round(0.3 * 255);
const COVER_EDGE = Math.round(0.9 * 255);
/** Art px of overlay kept beyond each side of the view (the camera shakes, the view is odd-sized). */
const MARGIN = 8;
/** How fast the dashes of a job's ring and a guard post's ring march round it (px a second). */
const MARCH = 8;
const TAP_TIME = 0.35;

const LITTLE = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
/** A colour at an opacity as one word of the buffer's Uint32Array. */
function word(c: RGB, a = 255): number {
  return (LITTLE ? (a << 24) | (c[2] << 16) | (c[1] << 8) | c[0] : (c[0] << 24) | (c[1] << 16) | (c[2] << 8) | a) >>> 0;
}

/** The pixels of a one-pixel ellipse ring w x h, in order round it (for dashes). */
interface Ring { w: number; h: number; pts: Int16Array }
function ringOf(w: number, h: number): Ring {
  const m = ellipseRing(w, h);
  const cx = (w - 1) / 2, cy = (h - 1) / 2;
  const list: [number, number, number][] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (on(m, x, y)) list.push([x, y, Math.atan2((y - cy) / h, (x - cx) / w)]);
  list.sort((a, b) => a[2] - b[2]);
  const pts = new Int16Array(list.length * 2);
  list.forEach(([x, y], i) => { pts[i * 2] = x; pts[i * 2 + 1] = y; });
  return { w, h, pts };
}

/** A buffer of world art px, (ox, oy) at its top-left, that knows what it drew. */
class Raster {
  w = 0;
  h = 0;
  ox = 0;
  oy = 0;
  image!: ImageData;
  px!: Uint32Array;
  /** What was drawn this frame and last frame, buffer px (x1 < x0: nothing). */
  x0 = 0; y0 = 0; x1 = -1; y1 = -1;
  lx0 = 0; ly0 = 0; lx1 = -1; ly1 = -1;

  constructor(private ctx: CanvasRenderingContext2D) {}

  /** Size the buffer (empty); true when it changed, and the canvas with it must be resized. */
  size(w: number, h: number): boolean {
    if (w === this.w && h === this.h) return false;
    this.w = w;
    this.h = h;
    this.image = this.ctx.createImageData(w, h);
    this.px = new Uint32Array(this.image.data.buffer);
    this.x0 = this.y0 = 0; this.x1 = this.y1 = -1;
    return true;
  }

  /** Start a frame with world px (ox, oy) at the buffer's top-left: wipe what the last one drew
   *  (in buffer pixels: the buffer stays put on the canvas, the image moves with the camera). */
  begin(ox: number, oy: number) {
    this.ox = ox;
    this.oy = oy;
    if (this.x1 >= this.x0) {
      for (let y = this.y0; y <= this.y1; y++) this.px.fill(0, y * this.w + this.x0, y * this.w + this.x1 + 1);
    }
    this.lx0 = this.x0; this.ly0 = this.y0; this.lx1 = this.x1; this.ly1 = this.y1;
    this.x0 = this.w; this.y0 = this.h; this.x1 = -1; this.y1 = -1;
  }

  private grow(x0: number, y0: number, x1: number, y1: number) {
    if (x0 < this.x0) this.x0 = Math.max(0, x0);
    if (y0 < this.y0) this.y0 = Math.max(0, y0);
    if (x1 > this.x1) this.x1 = Math.min(this.w - 1, x1);
    if (y1 > this.y1) this.y1 = Math.min(this.h - 1, y1);
  }

  /** Does a world rectangle touch the buffer? */
  sees(x0: number, y0: number, x1: number, y1: number): boolean {
    return x1 >= this.ox && y1 >= this.oy && x0 < this.ox + this.w && y0 < this.oy + this.h;
  }

  put(x: number, y: number, c: number) {
    const bx = x - this.ox, by = y - this.oy;
    if (bx < 0 || by < 0 || bx >= this.w || by >= this.h) return;
    this.px[by * this.w + bx] = c;
    this.grow(bx, by, bx, by);
  }

  /** Fill a polygon (world px, even-odd, pixel centres inside); `keep` picks pixels (a stipple). */
  fillPoly(pts: [number, number][], c: number, keep?: (x: number, y: number) => boolean) {
    let minY = Infinity, maxY = -Infinity, minX = Infinity, maxX = -Infinity;
    for (const [x, y] of pts) { minY = Math.min(minY, y); maxY = Math.max(maxY, y); minX = Math.min(minX, x); maxX = Math.max(maxX, x); }
    const ya = Math.max(Math.floor(minY), this.oy), yb = Math.min(Math.ceil(maxY), this.oy + this.h - 1);
    if (ya > yb) return;
    const xs: number[] = [];
    for (let y = ya; y <= yb; y++) {
      const cy = y + 0.5;
      xs.length = 0;
      for (let i = 0; i < pts.length; i++) {
        const [ax, ay] = pts[i];
        const [bx, by] = pts[(i + 1) % pts.length];
        if ((ay <= cy && by > cy) || (by <= cy && ay > cy)) xs.push(ax + ((cy - ay) / (by - ay)) * (bx - ax));
      }
      xs.sort((a, b) => a - b);
      const row = (y - this.oy) * this.w;
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const xa = Math.max(Math.ceil(xs[k] - 0.5), this.ox), xb = Math.min(Math.ceil(xs[k + 1] - 0.5), this.ox + this.w) - 1;
        for (let x = xa; x <= xb; x++) if (!keep || keep(x, y)) this.px[row + x - this.ox] = c;
      }
    }
    this.grow(Math.floor(minX) - this.ox, ya - this.oy, Math.ceil(maxX) - this.ox, yb - this.oy);
  }

  /** A Bresenham line between pixel centres; `every` > 1 keeps every n-th pixel (from `phase`). */
  line(x0: number, y0: number, x1: number, y1: number, c: number, every = 1, phase = 0): number {
    const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
    const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
    let err = dx + dy, n = phase;
    for (;;) {
      if (n++ % every === 0) this.put(x0, y0, c);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
    return n;
  }

  /** A closed outline through integer world px. */
  outline(pts: [number, number][], c: number, every = 1) {
    let n = 0;
    for (let i = 0; i < pts.length; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length];
      n = this.line(ax, ay, bx, by, c, every, n) - 1;
    }
  }

  /** Copy a picture's inked pixels with its (ax, ay) on world px (x, y). */
  stamp(im: PixelImage, x: number, y: number, ax: number, ay: number) {
    const left = x - ax, top = y - ay;
    if (!this.sees(left, top, left + im.w - 1, top + im.h - 1)) return;
    const d = im.data;
    for (let j = 0; j < im.h; j++) for (let i = 0; i < im.w; i++) {
      const o = (j * im.w + i) * 4;
      if (d[o + 3]) this.put(left + i, top + j, (LITTLE ? (d[o + 3] << 24) | (d[o + 2] << 16) | (d[o + 1] << 8) | d[o] : (d[o] << 24) | (d[o + 1] << 16) | (d[o + 2] << 8) | d[o + 3]) >>> 0);
    }
  }

  /** A ring centred on world px (x, y), dashed `on` px in every `period`, marching by `phase`;
   *  with an `edge` colour each dash gets a one-pixel edge round it, so it reads on pale ground. */
  ring(r: Ring, x: number, y: number, c: number, onPx = 2, period = 4, phase = 0, edge?: number) {
    const left = x - (r.w - 1) / 2, top = y - (r.h - 1) / 2;
    if (!this.sees(left - 1, top - 1, left + r.w, top + r.h)) return;
    const n = r.pts.length / 2;
    const lit = (i: number) => ((i + phase) % period + period) % period < onPx;
    for (let i = 0; edge !== undefined && i < n; i++) {
      if (!lit(i)) continue;
      const px = left + r.pts[i * 2], py = top + r.pts[i * 2 + 1];
      this.put(px - 1, py, edge); this.put(px + 1, py, edge); this.put(px, py - 1, edge); this.put(px, py + 1, edge);
    }
    for (let i = 0; i < n; i++) if (lit(i)) this.put(left + r.pts[i * 2], top + r.pts[i * 2 + 1], c);
  }
}

export class Overlay {
  private ctx: CanvasRenderingContext2D;
  private tex: Phaser.Textures.CanvasTexture;
  private image: Phaser.GameObjects.Image;
  private r: Raster;
  private rings = new Map<string, Ring>();
  private readonly selection = buildSelection();
  private readonly routeEnd = buildRouteEnd();
  private readonly tapGold = Array.from({ length: TAP_FRAMES }, (_, f) => buildTapRing(f));
  private readonly tapRed = Array.from({ length: TAP_FRAMES }, (_, f) => buildTapRing(f, PAL.shared.poppy_red));
  private readonly holdFlags = ([1, 2, 3] as const).map((s) => buildHoldFlag(s));
  private readonly waitMarks = ([1, 2, 3] as const).map((s) => buildWaitMark(s));
  /** Tap feedback ring (world px). */
  ring: { x: number; y: number; t: number; enemy: boolean } | null = null;
  /** Jobs on offer (`on`: their dashes march) and places an objective names (still), in world
   *  metres; set by the scene. */
  marks: { x: number; y: number; r: number; on: boolean }[] = [];

  constructor(private scene: Phaser.Scene) {
    // the scene starts once per phase; the last phase's overlay texture is still registered
    if (scene.textures.exists("overlay")) scene.textures.remove("overlay");
    this.tex = scene.textures.createCanvas("overlay", 1, 1)!;
    this.ctx = this.tex.getContext();
    this.r = new Raster(this.ctx);
    this.image = scene.add.image(0, 0, "overlay").setOrigin(0).setDepth(-4e5);
  }

  private ringFor(w: number, h: number): Ring {
    const k = `${w}x${h}`;
    let r = this.rings.get(k);
    if (!r) { r = ringOf(w, h); this.rings.set(k, r); }
    return r;
  }

  draw(sim: Sim, cam: Phaser.Cameras.Scene2D.Camera, time: number) {
    // the map view shows the whole zone at a fraction of an art pixel: the marks are for the street
    if (cam.zoom !== screen.s) { this.image.setVisible(false); return; }
    this.image.setVisible(true);
    const R = this.r;
    // the view in art px, and its top left in the world: the camera zooms about its centre, and
    // was moved this frame (its worldView is only brought up to date when it renders)
    const vw = cam.width / cam.zoom, vh = cam.height / cam.zoom;
    const W = Math.ceil(vw) + MARGIN * 2, H = Math.ceil(vh) + MARGIN * 2;
    if (R.size(W, H)) {
      this.tex.setSize(W, H);
      this.image.setTexture("overlay");
    }
    const ox = Math.floor(cam.scrollX + (cam.width - vw) / 2) - MARGIN, oy = Math.floor(cam.scrollY + (cam.height - vh) / 2) - MARGIN;
    R.begin(ox, oy);
    this.image.setPosition(ox, oy);
    const X = (x: number) => Math.round(sx(x));
    const Y = (y: number) => Math.round(sy(y));
    const s = sim.state;
    const G = sim.grid;
    const march = Math.floor(time * MARCH);

    // guard cones: a checker stipple locked to the world, and the edge
    const coneFill = word(PAL.shared.cone_yellow, CONE_FILL);
    const checker = (x: number, y: number) => ((x + y) & 1) === 0;
    for (const u of s.units) {
      const ai = u.ai;
      if (!ai || u.side !== "de" || u.state !== "ok" || u.hidden || ai.blind || ai.mode === "alert") continue;
      const reach = ai.coneR * 12 + 2;
      if (!R.sees(X(u.x) - reach, Y(u.y) - reach, X(u.x) + reach, Y(u.y) + reach)) continue;
      const steps = 14;
      const pts: [number, number][] = [[X(u.x), Y(u.y)]];
      for (let i = 0; i <= steps; i++) {
        const a = u.dir - ai.coneHalf + (2 * ai.coneHalf * i) / steps;
        const d = G.rayDist(u.x, u.y, a, ai.coneR);
        pts.push([X(u.x + Math.cos(a) * d), Y(u.y + Math.sin(a) * d)]);
      }
      R.fillPoly(pts.map(([x, y]) => [x + 0.5, y + 0.5]), coneFill, checker);
      R.outline(pts, word(PAL.shared.cone_yellow, ai.mode === "suspicious" ? 255 : CONE_EDGE));
    }

    // guard posts sending men after the alarm: blow them up to stop them (Fodder's huts); a
    // post with men left to send (`left` -1: until it is blown up) gets a red ring and a door
    const red = word(PAL.shared.poppy_red), dark = word(PAL.shared.outline);
    for (const sp of s.spawners) {
      if (!sp.active || sp.destroyed || sp.left === 0) continue;
      const x = X(sp.x), y = Y(sp.y);
      R.ring(this.ringFor(41, 31), x, y, red, 2, 4, march);
      this.rect(x - 3, y - 22, 7, 9, red);
      this.rect(x - 2, y - 21, 5, 7, dark);
      this.rect(x, y - 19, 1, 3, red);
    }

    // squads you are not leading: their orders in their colour
    for (const sq of s.squads) {
      if (!sq || !sq.inPlay || sq.id === s.controlled) continue;
      const L = sim.leaderOf(sq);
      if (!L) continue;
      const k = sq.colour % 3;
      const col = SQUAD_COLOURS[k];
      if (sq.order === "cover") {
        const pts: [number, number][] = [[X(sq.restX), Y(sq.restY)]];
        for (let i = 0; i <= 10; i++) {
          const a = sq.coverDir - sq.coverHalf + (2 * sq.coverHalf * i) / 10;
          const d = G.rayDist(sq.restX, sq.restY, a, 12);
          pts.push([X(sq.restX + Math.cos(a) * d), Y(sq.restY + Math.sin(a) * d)]);
        }
        R.fillPoly(pts.map(([x, y]) => [x + 0.5, y + 0.5]), word(col, COVER_FILL), checker);
        R.outline(pts, word(col, COVER_EDGE), 3);
      }
      if (sq.order === "signal" && sq.signalRoute && sq.signalRoute.length) {
        this.dotted([{ x: L.x, y: L.y }, ...sq.signalRoute], X, Y, word(col));
        const end = sq.signalRoute[sq.signalRoute.length - 1];
        R.stamp(this.waitMarks[k], X(end.x), Y(end.y), MARKER_ANCHORS.waitMark.x, MARKER_ANCHORS.waitMark.y);
      }
      if (sq.order === "hold" || sq.order === "cover") {
        // the flag beside the leader, its foot on the ground a little to his right
        R.stamp(this.holdFlags[k], X(sq.restX) + 6, Y(sq.restY) - 1, MARKER_ANCHORS.holdFlag.x, MARKER_ANCHORS.holdFlag.y);
      }
    }

    // your squad: a gold ring under each man, and the route to the gold diamond
    const C = s.squads[s.controlled];
    if (C) {
      for (const u of sim.membersOf(C)) R.stamp(this.selection, X(u.x), Y(u.y), MARKER_ANCHORS.selection.x, MARKER_ANCHORS.selection.y);
      // the route of whoever the next tap moves: the leader, or the man picked on the strip
      const L = actorOf(sim);
      if (L && L.path.length) {
        this.dotted([{ x: L.x, y: L.y }, ...L.path], X, Y, word(PAL.shared.select_gold));
        const e = L.path[L.path.length - 1];
        R.stamp(this.routeEnd, X(e.x), Y(e.y), MARKER_ANCHORS.routeEnd.x, MARKER_ANCHORS.routeEnd.y);
      }
    }

    // jobs the mission offers and places its objectives name: a chalk ring with a dark edge, its
    // dashes marching while a job is on offer
    const chalk = word(PAL.shared.chalk);
    for (const mk of this.marks) {
      const rw = Math.round(mk.r * 12), rh = Math.round(mk.r * 9);
      R.ring(this.ringFor(rw * 2 + 1, rh * 2 + 1), X(mk.x), Y(mk.y), chalk, 2, 4, mk.on ? march : 0, dark);
    }

    // where you tapped: the ring grows and breaks up (red on an enemy)
    if (this.ring) {
      const k = (time - this.ring.t) / TAP_TIME;
      if (k >= 1 || k < 0) this.ring = null;
      else {
        const frames = this.ring.enemy ? this.tapRed : this.tapGold;
        R.stamp(frames[Math.min(TAP_FRAMES - 1, Math.floor(k * TAP_FRAMES))], Math.round(this.ring.x), Math.round(this.ring.y), MARKER_ANCHORS.tap.x, MARKER_ANCHORS.tap.y);
      }
    }

    // hand over what changed: this frame's marks and the pixels last frame's left behind
    const x0 = Math.min(R.x0, R.lx0), y0 = Math.min(R.y0, R.ly0), x1 = Math.max(R.x1, R.lx1), y1 = Math.max(R.y1, R.ly1);
    if (x1 < x0 || y1 < y0) return;
    this.ctx.putImageData(R.image, 0, 0, x0, y0, x1 - x0 + 1, y1 - y0 + 1);
    this.tex.refresh();
  }

  private rect(x: number, y: number, w: number, h: number, c: number) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.r.put(x + i, y + j, c);
  }

  /** A dot every 4 px along a route, the spacing carried round its corners. */
  private dotted(pts: { x: number; y: number }[], X: (x: number) => number, Y: (y: number) => number, c: number) {
    let carry = 0;
    for (let i = 1; i < pts.length; i++) {
      const x0 = X(pts[i - 1].x), y0 = Y(pts[i - 1].y), x1 = X(pts[i].x), y1 = Y(pts[i].y);
      const len = Math.hypot(x1 - x0, y1 - y0);
      for (let d = carry; d < len; d += 4) {
        const t = d / len;
        this.r.put(Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t), c);
      }
      carry = len > 0 ? (carry + 4 - (len % 4)) % 4 : carry;
    }
  }
}
