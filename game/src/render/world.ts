// Draws the rules' state as the Diorama (style guide): the painted ground in chunks, the
// buildings full or cut with their ghosts, props, vehicles and troopers sorted by the y of
// their feet, and dotted silhouettes for anyone behind a roof.
import Phaser from "phaser";
import type { Sim } from "../sim/sim";
import type { Unit, Vehicle, Prop } from "../sim/types";
import type { MapData, MapBuilding } from "../content/mapdata";
import type { TrooperLook, GroundGrid, PropKind } from "../art/types";
import { F_ROOF } from "../sim/grid";
import { PAL, hex } from "../art/palette";
import { toCanvas, img, poly } from "../art/pixel";
import { buildTrooper, paintGroundImage, buildingArt, propArt, vehicleSheet, addSheet, addImage, art, DEFAULT_ANIMS, type TrooperTex } from "./artbank";
import { sx, sy, facingOf, headingFrame } from "./iso";
import { ANIM_FRAMES } from "../art/types";

const CHUNK = 512;

interface BuildingView {
  b: MapBuilding;
  full: Phaser.GameObjects.Image;
  cut: Phaser.GameObjects.Image | null;
  h: number;
  fullH: number;
  cutT: number;
  base: number;
}

interface UnitView {
  spr: Phaser.GameObjects.Sprite;
  sil: Phaser.GameObjects.Sprite;
  shadow: Phaser.GameObjects.Ellipse;
  tex: TrooperTex;
  lastFrame: string;
}

export class WorldView {
  readonly scene: Phaser.Scene;
  readonly md: MapData;
  private chunks: { x: number; y: number; canvas: HTMLCanvasElement; tex: Phaser.Textures.CanvasTexture; dirty: boolean }[] = [];
  private buildings: BuildingView[] = [];
  private units = new Map<number, UnitView>();
  private vehicles = new Map<number, { spr: Phaser.GameObjects.Sprite; key: string }>();
  private props = new Map<number, { img: Phaser.GameObjects.Image; state: string; kind: PropKind }>();
  private troopers = new Map<string, TrooperTex>();
  private looks: Record<string, TrooperLook>;
  private anims = art.trooperAnims() ?? DEFAULT_ANIMS;
  private wires: Phaser.GameObjects.Graphics;
  activeStreet = -1;
  private pendingStreet = -1;
  private pendingT = 0;

  constructor(scene: Phaser.Scene, md: MapData, looks: Record<string, TrooperLook>) {
    this.scene = scene;
    this.md = md;
    this.looks = looks;
    this.buildGround();
    this.buildBuildings();
    this.wires = scene.add.graphics().setDepth(1e5);
  }

  // ------------------------------------------------------------------ ground

  private buildGround() {
    const md = this.md;
    const grid: GroundGrid = { w: md.w, h: md.h, cells: md.ground, legend: md.legend };
    const ground = paintGroundImage(grid, 1943);
    // late afternoon: buildings throw long shadows to the east (style guide §4)
    const shade = img(ground.w, ground.h);
    for (const b of md.buildings) {
      const h = b.storeys * 3.2 + 0.8;
      const kx = h * 0.95, ky = -h * 0.12;
      const corners: [number, number][] = [
        [b.x, b.y], [b.x + b.w, b.y], [b.x + b.w + kx, b.y + ky], [b.x + b.w + kx, b.y + b.d + ky], [b.x + b.w, b.y + b.d], [b.x, b.y + b.d],
      ];
      poly(shade, corners.map(([x, y]) => [sx(x), sy(y)] as [number, number]), PAL.shared.shadow);
    }
    const gctx = toCanvas(ground);
    const g = gctx.getContext("2d")!;
    g.globalAlpha = 0.3;
    g.drawImage(toCanvas(shade), 0, 0);
    g.globalAlpha = 1;
    for (let cy = 0; cy < ground.h; cy += CHUNK) {
      for (let cx = 0; cx < ground.w; cx += CHUNK) {
        const w = Math.min(CHUNK, ground.w - cx), h = Math.min(CHUNK, ground.h - cy);
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        c.getContext("2d")!.drawImage(gctx, cx, cy, w, h, 0, 0, w, h);
        const key = `ground:${cx}:${cy}`;
        if (this.scene.textures.exists(key)) this.scene.textures.remove(key);
        const tex = this.scene.textures.addCanvas(key, c)!;
        this.scene.add.image(cx, cy, key).setOrigin(0).setDepth(-1e6);
        this.chunks.push({ x: cx, y: cy, canvas: c, tex, dirty: false });
      }
    }
  }

  /** Paint a decal (blood, scorch) into the ground at world metres. */
  decal(frameCanvas: HTMLCanvasElement | null, x: number, y: number, draw?: (ctx: CanvasRenderingContext2D) => void) {
    const px = sx(x), py = sy(y);
    for (const ch of this.chunks) {
      if (px < ch.x - 40 || py < ch.y - 40 || px > ch.x + ch.canvas.width + 40 || py > ch.y + ch.canvas.height + 40) continue;
      const ctx = ch.canvas.getContext("2d")!;
      ctx.save();
      ctx.translate(Math.round(px - ch.x), Math.round(py - ch.y));
      if (frameCanvas) ctx.drawImage(frameCanvas, -Math.floor(frameCanvas.width / 2), -Math.floor(frameCanvas.height / 2));
      if (draw) draw(ctx);
      ctx.restore();
      ch.dirty = true;
    }
  }

  flushDecals() {
    for (const ch of this.chunks) if (ch.dirty) { ch.tex.refresh(); ch.dirty = false; }
  }

  // ------------------------------------------------------------------ buildings

  private buildBuildings() {
    for (const b of this.md.buildings) {
      const a = buildingArt(b);
      const kf = `bf:${b.id}`;
      addImage(this.scene, kf, a.full);
      const top = sy(b.y) - Math.round(a.h * 7.5);
      const base = sy(b.y + b.d);
      const full = this.scene.add.image(sx(b.x), top, kf).setOrigin(0).setDepth(base);
      let cut: Phaser.GameObjects.Image | null = null;
      if (a.cut) {
        const kc = `bc:${b.id}`;
        addImage(this.scene, kc, a.cut);
        cut = this.scene.add.image(sx(b.x), top, kc).setOrigin(0).setDepth(base - 0.5).setVisible(false);
      }
      this.buildings.push({ b, full, cut, h: a.h, fullH: a.full.h, cutT: 0, base });
    }
  }

  /** The street the squad is in, or heading into on the next stretch of its route. */
  private streetFor(sim: Sim): number {
    const sq = sim.controlledSquad;
    const L = sq && sim.leaderOf(sq);
    if (!L) return -1;
    const G = sim.grid;
    const here = G.streetAt(L.x, L.y);
    if (L.path.length) {
      const p = L.path[0];
      const d = Math.hypot(p.x - L.x, p.y - L.y);
      const k = Math.min(1, 3 / Math.max(d, 0.01));
      const ahead = G.streetAt(L.x + (p.x - L.x) * k, L.y + (p.y - L.y) * k);
      if (ahead >= 0) return ahead;
    }
    return here;
  }

  private updateCut(sim: Sim, dt: number) {
    const s = this.streetFor(sim);
    if (s !== this.pendingStreet) { this.pendingStreet = s; this.pendingT = 0; }
    this.pendingT += dt;
    if (this.pendingT > 0.15 && s >= 0) this.activeStreet = s;
    for (const v of this.buildings) {
      const want = v.cut && v.b.cuttable && v.b.street === this.activeStreet ? 1 : 0;
      if (v.cutT === want) continue;
      v.cutT = want > v.cutT ? Math.min(1, v.cutT + dt / 0.3) : Math.max(0, v.cutT - dt / 0.3);
      if (!v.cut) continue;
      v.cut.setVisible(v.cutT > 0);
      if (v.cutT >= 1) v.full.setVisible(false);
      else {
        v.full.setVisible(true);
        const off = Math.round(v.cutT * v.fullH);
        v.full.setCrop(0, off, v.full.width, v.fullH - off);
      }
    }
  }

  /** Is a screen point covered by a building that is drawn in front of depth `feet`? */
  private occluded(pxX: number, pxY: number, feet: number): boolean {
    for (const v of this.buildings) {
      if (v.base <= feet || !v.full.visible) continue;
      const x0 = v.full.x, y0 = v.full.y + (v.cutT > 0 ? Math.round(v.cutT * v.fullH) : 0);
      if (pxX < x0 || pxX >= x0 + v.full.width || pxY < y0 || pxY >= v.full.y + v.fullH) continue;
      const b = v.b;
      if (b.courtyard) {
        const cx0 = sx(b.x + b.courtyard.x), cx1 = sx(b.x + b.courtyard.x + b.courtyard.w);
        const cyb = sy(b.y + b.courtyard.y + b.courtyard.d) - Math.round(v.h * 7.5) + 8;
        if (pxX > cx0 && pxX < cx1 && pxY < cyb) continue;
      }
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------------ troopers

  private trooperTex(look: string): TrooperTex {
    let t = this.troopers.get(look);
    if (!t) {
      const L = this.looks[look] ?? { body: "partisan", headgear: "cap", weapon: "sten", kit: "none" } as TrooperLook;
      t = buildTrooper(this.scene, look, L);
      this.troopers.set(look, t);
    }
    return t;
  }

  /** Build every look up front (on the loading screen) so play never stutters. */
  preload(looks: string[]) {
    for (const l of looks) this.trooperTex(l);
  }

  private unitView(u: Unit): UnitView {
    let v = this.units.get(u.id);
    if (v) return v;
    const tex = this.trooperTex(u.look);
    const first = tex.frames.values().next().value!;
    const spr = this.scene.add.sprite(0, 0, tex.key, first.name).setOrigin(first.ax / first.w, first.ay / first.h);
    const sil = this.scene.add.sprite(0, 0, tex.silKey, first.name).setOrigin(first.ax / first.w, first.ay / first.h).setDepth(2e6).setVisible(false);
    sil.setTint(u.side === "pl" ? hex(PAL.shared.select_gold) : hex(PAL.shared.poppy_red));
    const shadow = this.scene.add.ellipse(0, 0, 10, 4, hex(PAL.shared.shadow), 0.3).setDepth(-5e5);
    v = { spr, sil, shadow, tex, lastFrame: first.name };
    this.units.set(u.id, v);
    return v;
  }

  private frameFor(u: Unit): { name: string; flip: boolean } {
    const { f, flip } = facingOf(u.dir);
    const anim = u.anim;
    const n = ANIM_FRAMES[anim] ?? 1;
    const spec = this.anims[anim] ?? DEFAULT_ANIMS[anim];
    let i = Math.floor(u.animT * spec.fps);
    i = spec.loop ? i % n : Math.min(n - 1, i);
    if (anim === "walk" && !u.moving) i = 0;
    return { name: `${anim}_${f}_${i}`, flip };
  }

  // ------------------------------------------------------------------ vehicles and props

  private vehicleKey(v: Vehicle): string {
    const st = v.doorsOpen && (v.state === "intact" || v.state === "doors_open") ? "doors_open" : v.state === "doors_open" ? "intact" : v.state;
    const key = `vh:${v.kind}:${st}`;
    if (!this.scene.textures.exists(key)) {
      const sh = vehicleSheet(v.kind, st);
      addSheet(this.scene, key, sh);
      this.noteSheetAnchors(key, sh.frames);
    }
    return key;
  }

  private propKey(p: Prop): string {
    const key = `pr:${p.kind}:${p.state}:${p.variant}`;
    if (!this.scene.textures.exists(key)) {
      const a = propArt(p.kind as PropKind, p.state, p.variant || undefined);
      addImage(this.scene, key, a.image);
      this.scene.textures.get(key).customData = { ax: a.ax, ay: a.ay, w: a.image.w, h: a.image.h };
    }
    return key;
  }

  private syncProps(sim: Sim) {
    for (const p of sim.state.props) {
      let v = this.props.get(p.id);
      if (!v || v.state !== p.state) {
        const key = this.propKey(p);
        const cd = this.scene.textures.get(key).customData as { ax: number; ay: number; w: number; h: number };
        if (!v) {
          const im = this.scene.add.image(sx(p.x), sy(p.y), key).setOrigin(cd.ax / cd.w, cd.ay / cd.h).setDepth(sy(p.y));
          v = { img: im, state: p.state, kind: p.kind as PropKind };
          this.props.set(p.id, v);
        } else {
          v.img.setTexture(key).setOrigin(cd.ax / cd.w, cd.ay / cd.h);
          v.state = p.state;
        }
      }
    }
  }

  private drawWires(sim: Sim) {
    const g = this.wires;
    g.clear();
    const pt = art.poleWire();
    const poles = sim.state.props.filter((p) => p.kind === "phone_pole").sort((a, b) => a.x - b.x);
    if (poles.length < 2) return;
    const cut = sim.state.vars.lineCut === true;
    g.lineStyle(1, hex(PAL.shared.outline), 1);
    for (let i = 0; i + 1 < poles.length; i++) {
      const a = poles[i], b = poles[i + 1];
      if (cut && (a.state === "destroyed" || b.state === "destroyed" || i === Number(sim.state.vars.lineCutAt ?? -1))) continue;
      const va = this.props.get(a.id), vb = this.props.get(b.id);
      if (!va || !vb) continue;
      const ha = pt ? va.img.displayOriginY - pt[1] : 20, hb = pt ? vb.img.displayOriginY - pt[1] : 20;
      const x0 = sx(a.x), y0 = sy(a.y) - ha, x1 = sx(b.x), y1 = sy(b.y) - hb;
      // a sagging wire
      let px0 = x0, py0 = y0;
      for (let k = 1; k <= 12; k++) {
        const t = k / 12;
        const x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t + Math.sin(Math.PI * t) * 3;
        g.lineBetween(Math.round(px0), Math.round(py0), Math.round(x), Math.round(y));
        px0 = x; py0 = y;
      }
    }
    g.setDepth(sy(poles[0].y) + 1);
  }

  // ------------------------------------------------------------------ per frame

  update(sim: Sim, dt: number) {
    this.updateCut(sim, dt);
    const a = sim.alpha;
    const seen = new Set<number>();
    for (const u of sim.state.units) {
      const v = this.unitView(u);
      seen.add(u.id);
      if (u.hidden) { v.spr.setVisible(false); v.sil.setVisible(false); v.shadow.setVisible(false); continue; }
      const x = u.px + (u.x - u.px) * a, y = u.py + (u.y - u.py) * a;
      const px = Math.round(sx(x)), py = Math.round(sy(y));
      const { name, flip } = this.frameFor(u);
      if (name !== v.lastFrame && v.tex.frames.has(name)) {
        v.spr.setFrame(name);
        v.sil.setFrame(name);
        v.lastFrame = name;
      }
      v.spr.setPosition(px, py).setFlipX(flip).setVisible(true).setDepth(py + (u.state === "dead" ? -0.5 : 0.1));
      v.shadow.setPosition(px, py).setVisible(u.state !== "dead").setDepth(-5e5);
      const hid = u.state !== "dead" && (this.occluded(px, py - 10, py) || (sim.grid.flagAt(x, y) & F_ROOF) !== 0);
      v.sil.setPosition(px, py).setFlipX(flip).setVisible(hid);
    }
    for (const [id, v] of this.units) if (!seen.has(id)) { v.spr.destroy(); v.sil.destroy(); v.shadow.destroy(); this.units.delete(id); }

    for (const veh of sim.state.vehicles) {
      const key = this.vehicleKey(veh);
      let v = this.vehicles.get(veh.id);
      if (!v) {
        v = { spr: this.scene.add.sprite(0, 0, key, "h0"), key };
        this.vehicles.set(veh.id, v);
      }
      if (v.key !== key) { v.spr.setTexture(key); v.key = key; }
      const frame = headingFrame(veh.heading);
      v.spr.setFrame(frame);
      const fr = v.spr.frame;
      const sheetFrames = this.scene.textures.get(key).customData as Record<string, { ax: number; ay: number }> | undefined;
      const anchor = sheetFrames?.[frame];
      if (anchor) v.spr.setOrigin(anchor.ax / fr.width, anchor.ay / fr.height);
      else v.spr.setOrigin(0.5, 0.75);
      const x = veh.px + (veh.x - veh.px) * a, y = veh.py + (veh.y - veh.py) * a;
      const ext = Math.abs(Math.sin(veh.heading)) * veh.len / 2 + Math.abs(Math.cos(veh.heading)) * veh.wid / 2;
      v.spr.setPosition(Math.round(sx(x)), Math.round(sy(y))).setDepth(sy(y + ext));
    }
    this.syncProps(sim);
    this.drawWires(sim);
    this.flushDecals();
  }

  /** Record per-frame anchors for vehicle sheets (called after addSheet). */
  noteSheetAnchors(key: string, frames: { name: string; ax: number; ay: number }[]) {
    this.scene.textures.get(key).customData = Object.fromEntries(frames.map((f) => [f.name, { ax: f.ax, ay: f.ay }]));
  }

  screenOfUnit(u: Unit): { x: number; y: number } {
    return { x: sx(u.x), y: sy(u.y) };
  }

  /** The view (sprite) for a unit, for glyphs and bubbles. */
  spriteOf(id: number): Phaser.GameObjects.Sprite | undefined {
    return this.units.get(id)?.spr;
  }
}
