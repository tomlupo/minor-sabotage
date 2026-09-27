// Effects driven by the rules' events: tracers and muzzle flashes, grenades and bottles in
// flight, explosions with a shake and a scorch mark, fires with their light, blood on the
// cobbles, glyphs over heads and short shouts. Juice, but every piece says something true.
import Phaser from "phaser";
import type { Sim } from "../sim/sim";
import type { SimEvent, Unit } from "../sim/types";
import { PAL, hex } from "../art/palette";
import { toCanvas, crop, type Sheet } from "../art/pixel";
import { addSheet, fxSheet, art } from "./artbank";
import { sx, sy, facingOf } from "./iso";
import type { WorldView } from "./world";

interface Tracer { x0: number; y0: number; x1: number; y1: number; t: number; side: string }
interface Anim { spr: Phaser.GameObjects.Sprite; frames: string[]; fps: number; t: number; loop: boolean; vy?: number }
interface Bubble { unit: number; text: Phaser.GameObjects.Text; t: number }

export class Fx {
  private sheet: Sheet;
  private tracers: Tracer[] = [];
  private g: Phaser.GameObjects.Graphics;
  private anims: Anim[] = [];
  private fires = new Map<number, { sprs: Phaser.GameObjects.Sprite[]; light: Phaser.GameObjects.Image }>();
  private glyphs = new Map<number, Phaser.GameObjects.Text>();
  private bubbles: Bubble[] = [];
  private proj = new Map<number, Phaser.GameObjects.Sprite>();
  private frameCanvas = new Map<string, HTMLCanvasElement>();
  private muzzle = art.muzzle();
  shake = 0;

  constructor(private scene: Phaser.Scene, private world: WorldView) {
    this.sheet = fxSheet();
    addSheet(scene, "fx", this.sheet);
    this.g = scene.add.graphics().setDepth(1.5e6);
    this.makeLightTexture();
  }

  private has(name: string) {
    return this.sheet.frames.some((f) => f.name === name);
  }

  private frames(prefix: string): string[] {
    return this.sheet.frames.filter((f) => f.name.startsWith(prefix)).map((f) => f.name).sort((a, b) => Number(a.split("_").pop()) - Number(b.split("_").pop()));
  }

  private canvasOf(name: string): HTMLCanvasElement | null {
    let c = this.frameCanvas.get(name);
    if (c) return c;
    const f = this.sheet.frames.find((q) => q.name === name);
    if (!f) return null;
    c = toCanvas(crop(this.sheet.image, f.x, f.y, f.w, f.h));
    this.frameCanvas.set(name, c);
    return c;
  }

  /** Three stepped bands of warm light (style guide §5: pools are stepped, never smooth). */
  private makeLightTexture() {
    const s = 96;
    const c = document.createElement("canvas");
    c.width = s;
    c.height = Math.round(s * 0.75);
    const g = c.getContext("2d")!;
    const [r, gg, b] = PAL.shared.fire[1];
    for (const [k, a] of [[1, 0.1], [0.66, 0.16], [0.36, 0.24]] as const) {
      g.fillStyle = `rgba(${r},${gg},${b},${a})`;
      g.beginPath();
      g.ellipse(s / 2, c.height / 2, (s / 2) * k, (c.height / 2) * k, 0, 0, Math.PI * 2);
      g.fill();
    }
    if (this.scene.textures.exists("lightpool")) this.scene.textures.remove("lightpool");
    this.scene.textures.addCanvas("lightpool", c);
  }

  private play(prefix: string, x: number, y: number, depth: number, fps = 14, loop = false, vy = 0): Phaser.GameObjects.Sprite | null {
    const frames = this.frames(prefix);
    if (!frames.length) return null;
    const f0 = this.sheet.frames.find((f) => f.name === frames[0])!;
    const spr = this.scene.add.sprite(Math.round(x), Math.round(y), "fx", frames[0]).setOrigin(f0.ax / f0.w, f0.ay / f0.h).setDepth(depth);
    this.anims.push({ spr, frames, fps, t: 0, loop, vy });
    return spr;
  }

  handle(sim: Sim, e: SimEvent) {
    switch (e.t) {
      case "shot": {
        this.tracers.push({ x0: sx(e.x0), y0: sy(e.y0, 1.1), x1: sx(e.x1), y1: sy(e.y1, 1.0), t: 0, side: e.side });
        const u = sim.unit(e.by);
        if (u) this.muzzleFlash(u);
        if (e.hit === -1 && Math.random() < 0.35) this.play("spark_", sx(e.x1), sy(e.y1, 0.8), sy(e.y1) + 2, 20);
        if (e.hit === -1 && Math.random() < 0.4) this.play("dust_", sx(e.x1), sy(e.y1), sy(e.y1) + 1, 16);
        break;
      }
      case "hit": {
        const u = sim.unit(e.unit);
        if (u && u.side !== "civ") this.world.decal(this.canvasOf(`blood_${Math.floor(Math.random() * 4)}`), e.x + (Math.random() - 0.5) * 0.6, e.y + (Math.random() - 0.5) * 0.4);
        if (e.vehicle) this.play("spark_", sx(e.x), sy(e.y, 1.2), sy(e.y) + 3, 22);
        break;
      }
      case "death":
        if (!e.silent) this.world.decal(this.canvasOf("blood_1"), e.x, e.y + 0.2);
        this.dropGlyph(e.unit);
        break;
      case "explosion":
        this.play("explosion_", sx(e.x), sy(e.y), sy(e.y) + 2, 16);
        for (let i = 0; i < 4; i++) this.play("smoke_", sx(e.x) + (Math.random() - 0.5) * 20, sy(e.y) - 4, sy(e.y) + 3, 7, false, -8);
        this.world.decal(this.canvasOf("scorch_0"), e.x, e.y);
        this.shake = Math.max(this.shake, 0.35);
        this.flash(e.x, e.y, 1.2);
        break;
      case "bottle":
        this.play("glass_", sx(e.x), sy(e.y), sy(e.y) + 2, 14);
        this.flash(e.x, e.y, 0.8);
        break;
      case "fire":
        if (e.on) {
          const sprs: Phaser.GameObjects.Sprite[] = [];
          for (let i = 0; i < 3; i++) {
            const s = this.play("fire_", sx(e.x) + (i - 1) * 7, sy(e.y) + (i % 2) * 3, sy(e.y) + 1 + i, 10 + i, true);
            if (s) sprs.push(s);
          }
          const light = this.scene.add.image(sx(e.x), sy(e.y), "lightpool").setBlendMode(Phaser.BlendModes.ADD).setDepth(1.8e6);
          this.fires.set(e.id, { sprs, light });
          this.world.decal(this.canvasOf("scorch_1"), e.x, e.y);
        } else {
          const f = this.fires.get(e.id);
          if (f) {
            for (const s of f.sprs) { this.anims = this.anims.filter((a) => a.spr !== s); s.destroy(); }
            f.light.destroy();
            this.fires.delete(e.id);
            this.play("smoke_", sx(e.x), sy(e.y) - 4, sy(e.y) + 3, 5, false, -10);
          }
        }
        break;
      case "glyph":
        this.setGlyph(sim.unit(e.unit), e.glyph);
        break;
      case "say":
        this.say(sim.unit(e.unit), e.text);
        break;
      case "knife":
        break;
      case "vehicle":
        if (e.state === "burning") {
          const v = sim.vehicle(e.id);
          if (v) { this.explodeSmall(v.x, v.y); }
        }
        break;
      default:
        break;
    }
  }

  private explodeSmall(x: number, y: number) {
    this.play("explosion_", sx(x), sy(y), sy(y) + 4, 18);
    this.shake = Math.max(this.shake, 0.2);
  }

  private flash(x: number, y: number, k: number) {
    const im = this.scene.add.image(sx(x), sy(y), "lightpool").setBlendMode(Phaser.BlendModes.ADD).setDepth(1.8e6).setScale(k * 1.6);
    this.scene.tweens.add({ targets: im, alpha: 0, duration: 260, onComplete: () => im.destroy() });
  }

  private muzzleFlash(u: Unit) {
    const { f, flip } = facingOf(u.dir);
    const table = this.muzzle?.[u.weapon];
    const m = table?.[f];
    const ox = m ? (flip ? -m[0] : m[0]) : Math.cos(u.dir) * 8;
    const oy = m ? m[1] : -9;
    const name = `muzzle_${f}_${Math.random() < 0.5 ? 0 : 1}`;
    if (!this.has(name)) return;
    const fr = this.sheet.frames.find((q) => q.name === name)!;
    const s = this.scene.add.sprite(Math.round(sx(u.x) + ox), Math.round(sy(u.y) + oy), "fx", name).setOrigin(fr.ax / fr.w, fr.ay / fr.h).setFlipX(flip).setDepth(sy(u.y) + 1);
    this.scene.time.delayedCall(50, () => s.destroy());
  }

  private setGlyph(u: Unit | undefined, glyph: string) {
    if (!u) return;
    this.dropGlyph(u.id);
    if (glyph === "none") return;
    const ch = glyph === "alert" ? "!" : glyph === "suspicious" ? "?" : glyph === "wounded" ? "+" : "†";
    const col = glyph === "alert" ? PAL.shared.poppy_red : glyph === "wounded" ? PAL.hud.hp_low : PAL.shared.chalk;
    const t = this.scene.add.text(0, 0, ch, { fontFamily: "monospace", fontSize: "10px", color: `#${hex(col).toString(16).padStart(6, "0")}`, stroke: "#24201a", strokeThickness: 2 })
      .setOrigin(0.5, 1).setDepth(2.1e6).setResolution(2);
    this.glyphs.set(u.id, t);
  }

  private dropGlyph(id: number) {
    const g = this.glyphs.get(id);
    if (g) { g.destroy(); this.glyphs.delete(id); }
  }

  private say(u: Unit | undefined, text: string) {
    if (!u) return;
    for (const b of this.bubbles) if (b.unit === u.id) { b.text.destroy(); b.t = 99; }
    const t = this.scene.add.text(0, 0, text, { fontFamily: "monospace", fontSize: "8px", color: u.side === "de" ? "#f0d2c8" : "#e8e4d8", stroke: "#24201a", strokeThickness: 2 })
      .setOrigin(0.5, 1).setDepth(2.2e6).setResolution(2);
    this.bubbles.push({ unit: u.id, text: t, t: 0 });
  }

  update(sim: Sim, dt: number) {
    const g = this.g;
    g.clear();
    for (const tr of this.tracers) {
      tr.t += dt;
      const k = tr.t / 0.07;
      if (k >= 1) continue;
      const col = tr.side === "de" ? PAL.shared.fire[1] : PAL.shared.fire[2];
      g.lineStyle(1, hex(col), 1 - k);
      // a short streak moving along the line
      const a = Math.min(1, k * 1.4), b = Math.max(0, a - 0.35);
      g.lineBetween(tr.x0 + (tr.x1 - tr.x0) * b, tr.y0 + (tr.y1 - tr.y0) * b, tr.x0 + (tr.x1 - tr.x0) * a, tr.y0 + (tr.y1 - tr.y0) * a);
    }
    this.tracers = this.tracers.filter((t) => t.t < 0.07);
    for (const a of this.anims) {
      a.t += dt;
      let i = Math.floor(a.t * a.fps);
      if (a.loop) i %= a.frames.length;
      if (i >= a.frames.length) { a.spr.destroy(); continue; }
      a.spr.setFrame(a.frames[i]);
      if (a.vy) a.spr.y += a.vy * dt;
    }
    this.anims = this.anims.filter((a) => a.spr.active);
    // projectiles in flight: an arc
    const live = new Set<number>();
    for (const p of sim.state.projectiles) {
      live.add(p.id);
      let s = this.proj.get(p.id);
      if (!s) {
        const name = p.kind === "bottle" ? "glass_0" : "spark_0";
        s = this.scene.add.sprite(0, 0, "fx", this.has(name) ? name : this.sheet.frames[0].name).setDepth(2e6);
        this.proj.set(p.id, s);
      }
      const k = Math.min(1, p.t / p.dur);
      const x = p.x0 + (p.x1 - p.x0) * k, y = p.y0 + (p.y1 - p.y0) * k;
      const z = 1.2 + 4 * 2.2 * k * (1 - k);
      s.setPosition(Math.round(sx(x)), Math.round(sy(y, z))).setAngle(k * 720);
    }
    for (const [id, s] of this.proj) if (!live.has(id)) { s.destroy(); this.proj.delete(id); }
    // glyphs and shouts ride above heads
    for (const [id, t] of this.glyphs) {
      const u = sim.unit(id);
      const spr = this.world.spriteOf(id);
      if (!u || !spr || u.hidden || u.state === "dead") { t.setVisible(false); continue; }
      t.setVisible(true).setPosition(spr.x, spr.y - 23);
    }
    for (const b of this.bubbles) {
      b.t += dt;
      const spr = this.world.spriteOf(b.unit);
      if (!spr || b.t > 2.2) { b.text.destroy(); b.t = 99; continue; }
      b.text.setPosition(spr.x, spr.y - 26 - Math.min(4, b.t * 10)).setAlpha(b.t > 1.8 ? (2.2 - b.t) / 0.4 : 1);
    }
    this.bubbles = this.bubbles.filter((b) => b.t < 99);
    for (const f of this.fires.values()) f.light.setAlpha(0.8 + Math.random() * 0.2);
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt);
  }
}
