// What sits on the ground but is not the world: guard cones (a checker stipple of
// cone_yellow, 42% fill and 85% edge, style guide §8), your route (dotted select_gold with a
// diamond), selection ellipses, and the orders of squads you are not leading, in their
// colour: a hold flag, a cover cone, a dotted route that waits for the signal.
import Phaser from "phaser";
import type { Sim } from "../sim/sim";
import { PAL, SQUAD_COLOURS, css } from "../art/palette";
import { sx, sy } from "./iso";

export class Overlay {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private tex: Phaser.Textures.CanvasTexture;
  private image: Phaser.GameObjects.Image;
  private checker: CanvasPattern;
  private squadChecker: CanvasPattern[];
  /** Tap feedback ring (screen-independent, world px). */
  ring: { x: number; y: number; t: number; enemy: boolean } | null = null;
  /** Interactables to highlight (world metres), set by the scene. */
  marks: { x: number; y: number; r: number; on: boolean }[] = [];

  constructor(private scene: Phaser.Scene) {
    this.canvas = document.createElement("canvas");
    this.ctx = this.canvas.getContext("2d")!;
    this.resize();
    // the scene starts once per phase; the last phase's overlay texture is still registered
    if (scene.textures.exists("overlay")) scene.textures.remove("overlay");
    this.tex = scene.textures.addCanvas("overlay", this.canvas)!;
    this.image = scene.add.image(0, 0, "overlay").setOrigin(0).setScrollFactor(0).setDepth(-4e5);
    this.checker = this.pattern(PAL.shared.cone_yellow, 0.42);
    this.squadChecker = SQUAD_COLOURS.map((c) => this.pattern(c, 0.3));
  }

  private pattern(c: readonly [number, number, number], a: number): CanvasPattern {
    const p = document.createElement("canvas");
    p.width = 2;
    p.height = 2;
    const g = p.getContext("2d")!;
    g.fillStyle = css(c, a);
    g.fillRect(0, 0, 1, 1);
    g.fillRect(1, 1, 1, 1);
    return this.ctx.createPattern(p, "repeat")!;
  }

  resize() {
    const { width, height } = this.scene.scale;
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
      if (this.tex) {
        this.tex.setSize(width, height);
      }
    }
  }

  draw(sim: Sim, cam: Phaser.Cameras.Scene2D.Camera, time: number) {
    this.resize();
    const g = this.ctx;
    const W = this.canvas.width, H = this.canvas.height;
    g.clearRect(0, 0, W, H);
    const ox = Math.round(cam.scrollX), oy = Math.round(cam.scrollY);
    // keep the stipple locked to the world, not the screen
    const m = new DOMMatrix([1, 0, 0, 1, -ox % 2, -oy % 2]);
    this.checker.setTransform(m);
    for (const p of this.squadChecker) p.setTransform(m);
    const X = (x: number) => Math.round(sx(x)) - ox + 0.5;
    const Y = (y: number) => Math.round(sy(y)) - oy + 0.5;
    const onScreen = (x: number, y: number, pad: number) => X(x) > -pad && Y(y) > -pad && X(x) < W + pad && Y(y) < H + pad;
    const s = sim.state;
    const G = sim.grid;

    // guard cones
    for (const u of s.units) {
      const ai = u.ai;
      if (!ai || u.side !== "de" || u.state !== "ok" || u.hidden || ai.blind || ai.mode === "alert") continue;
      if (!onScreen(u.x, u.y, 220)) continue;
      const steps = 14;
      g.beginPath();
      g.moveTo(X(u.x), Y(u.y));
      for (let i = 0; i <= steps; i++) {
        const a = u.dir - ai.coneHalf + (2 * ai.coneHalf * i) / steps;
        const d = G.rayDist(u.x, u.y, a, ai.coneR);
        g.lineTo(X(u.x + Math.cos(a) * d), Y(u.y + Math.sin(a) * d));
      }
      g.closePath();
      g.fillStyle = this.checker;
      g.fill();
      g.strokeStyle = css(PAL.shared.cone_yellow, ai.mode === "suspicious" ? 1 : 0.85);
      g.lineWidth = 1;
      g.stroke();
    }

    // guard posts sending men after the alarm: blow them up to stop them (Fodder's huts)
    for (const sp of s.spawners) {
      if (!sp.active || sp.destroyed || sp.left <= 0 || !onScreen(sp.x, sp.y, 30)) continue;
      const pulse = 0.55 + 0.45 * Math.sin(time * 6);
      g.strokeStyle = css(PAL.shared.poppy_red, pulse);
      g.setLineDash([2, 2]);
      g.beginPath();
      g.ellipse(X(sp.x), Y(sp.y), 20, 15, 0, 0, Math.PI * 2);
      g.stroke();
      g.setLineDash([]);
      g.fillStyle = css(PAL.shared.poppy_red, 0.9);
      g.fillRect(X(sp.x) - 3, Y(sp.y) - 22, 7, 9);
      g.fillStyle = css(PAL.shared.outline, 1);
      g.fillRect(X(sp.x) - 2, Y(sp.y) - 21, 5, 7);
      g.fillStyle = css(PAL.shared.poppy_red, 0.9);
      g.fillRect(X(sp.x), Y(sp.y) - 19, 1, 3);
    }

    // squads you are not leading: their orders in their colour
    for (const sq of s.squads) {
      if (!sq || !sq.inPlay || sq.id === s.controlled) continue;
      const L = sim.leaderOf(sq);
      if (!L) continue;
      const col = SQUAD_COLOURS[sq.colour % 3];
      g.strokeStyle = css(col, 0.9);
      g.fillStyle = css(col, 0.9);
      if (sq.order === "cover") {
        g.beginPath();
        g.moveTo(X(sq.restX), Y(sq.restY));
        const R = 12;
        for (let i = 0; i <= 10; i++) {
          const a = sq.coverDir - sq.coverHalf + (2 * sq.coverHalf * i) / 10;
          const d = G.rayDist(sq.restX, sq.restY, a, R);
          g.lineTo(X(sq.restX + Math.cos(a) * d), Y(sq.restY + Math.sin(a) * d));
        }
        g.closePath();
        g.fillStyle = this.squadChecker[sq.colour % 3];
        g.fill();
        g.setLineDash([1, 2]);
        g.stroke();
        g.setLineDash([]);
      }
      if (sq.order === "signal" && sq.signalRoute && sq.signalRoute.length) {
        this.dotted(g, [{ x: L.x, y: L.y }, ...sq.signalRoute], X, Y, col);
        const end = sq.signalRoute[sq.signalRoute.length - 1];
        // "waits for signal": an open diamond with a dot
        this.diamond(g, X(end.x), Y(end.y), col, false);
        g.fillRect(X(end.x) - 0.5, Y(end.y) - 0.5, 1, 1);
      }
      if (sq.order === "hold" || sq.order === "cover") {
        // a small flag by the leader
        const fx = X(sq.restX) + 6, fy = Y(sq.restY) - 2;
        g.fillStyle = css(col, 1);
        g.fillRect(fx, fy - 10, 1, 11);
        g.fillRect(fx + 1, fy - 10, 4, 3);
      }
    }

    // your squad: gold ellipses and the route
    const C = s.squads[s.controlled];
    if (C) {
      g.strokeStyle = css(PAL.shared.select_gold, 0.95);
      for (const u of sim.membersOf(C)) {
        g.beginPath();
        g.ellipse(X(u.x) - 0.5, Y(u.y), 6, 2.5, 0, 0, Math.PI * 2);
        g.stroke();
      }
      const L = sim.leaderOf(C);
      if (L && L.path.length) {
        this.dotted(g, [{ x: L.x, y: L.y }, ...L.path], X, Y, PAL.shared.select_gold);
        const e = L.path[L.path.length - 1];
        this.diamond(g, X(e.x), Y(e.y), PAL.shared.select_gold, true);
      }
    }

    // interactables the mission offers
    for (const mk of this.marks) {
      if (!onScreen(mk.x, mk.y, 20)) continue;
      const pulse = 0.55 + 0.45 * Math.sin(time * 5);
      g.strokeStyle = css(mk.on ? PAL.shared.select_gold : PAL.shared.chalk, mk.on ? pulse : 0.5);
      g.setLineDash([2, 2]);
      g.beginPath();
      g.ellipse(X(mk.x), Y(mk.y), mk.r * 12, mk.r * 9, 0, 0, Math.PI * 2);
      g.stroke();
      g.setLineDash([]);
    }

    // tap ring
    if (this.ring) {
      const k = (time - this.ring.t) / 0.35;
      if (k >= 1) this.ring = null;
      else {
        g.strokeStyle = css(this.ring.enemy ? PAL.shared.poppy_red : PAL.shared.select_gold, 1 - k);
        g.beginPath();
        g.ellipse(this.ring.x - ox, this.ring.y - oy, 3 + k * 8, 1.5 + k * 6, 0, 0, Math.PI * 2);
        g.stroke();
      }
    }
    this.tex.refresh();
  }

  private dotted(g: CanvasRenderingContext2D, pts: { x: number; y: number }[], X: (x: number) => number, Y: (y: number) => number, col: readonly [number, number, number]) {
    g.fillStyle = css(col, 1);
    let carry = 0;
    for (let i = 1; i < pts.length; i++) {
      const x0 = X(pts[i - 1].x), y0 = Y(pts[i - 1].y), x1 = X(pts[i].x), y1 = Y(pts[i].y);
      const len = Math.hypot(x1 - x0, y1 - y0);
      for (let d = carry; d < len; d += 4) {
        const t = d / len;
        g.fillRect(Math.floor(x0 + (x1 - x0) * t), Math.floor(y0 + (y1 - y0) * t), 1, 1);
      }
      carry = (carry + 4 - (len % 4)) % 4;
    }
  }

  private diamond(g: CanvasRenderingContext2D, x: number, y: number, col: readonly [number, number, number], fill: boolean) {
    g.beginPath();
    g.moveTo(x, y - 3);
    g.lineTo(x + 4, y);
    g.lineTo(x, y + 3);
    g.lineTo(x - 4, y);
    g.closePath();
    g.strokeStyle = css(col, 1);
    g.stroke();
    if (fill) { g.fillStyle = css(col, 0.5); g.fill(); }
  }
}
