// Effects: tracers and muzzle flashes, grenades and bottles in flight, explosions with a shake
// and a scorch mark, fires with their light, blood on the cobbles, glyphs over heads and short
// shouts. Juice, but every piece says something true.
//
// What lasts (a fire and its light, the glyph over a head) is drawn from the rules' state every
// frame, so a phase resumed from a snapshot (ADR-0001) shows what it was left with; what passes
// (a shot, a burst, a shout) comes from the rules' events.
import Phaser from "phaser";
import type { Sim } from "../sim/sim";
import type { Glyph, SimEvent, Unit } from "../sim/types";
import { UF_SILENT_DEATH } from "../sim/types";
import { PAL, hex, css, type RGB } from "../art/palette";
import { crop, img, outline, toCanvas, type Sheet } from "../art/pixel";
import { buildFxSheet } from "../art/fx";
import { MUZZLE } from "../art/troopers";
import { buildGlyph, type GlyphName } from "../art/hud";
import { buildPalettePool } from "../art/light";
import { txt, PX } from "../ui/text";
import { addImage, addSheet } from "./artbank";
import { sx, sy, facingOf } from "./iso";
import type { WorldView } from "./world";

interface Tracer { x0: number; y0: number; x1: number; y1: number; t: number; side: string }
interface Anim { spr: Phaser.GameObjects.Sprite; frames: string[]; fps: number; t: number; loop: boolean; vy?: number }
interface Bubble { unit: number; img: Phaser.GameObjects.Text; t: number }
interface FireView { x: number; y: number; sprs: Phaser.GameObjects.Sprite[]; light: Phaser.GameObjects.Image; flickerT: number }

/** Who shouts: our side and the prisoners in chalk, the Germans in their field grey. */
const VOICE: Record<"de" | "pl", RGB> = { de: PAL.troopers.occupier_field_grey[2], pl: PAL.shared.chalk };
/** A fire's light steps between these, a few times a second (§5: stepped, never smooth). */
const FLICKER = [0.8, 0.9, 1];
/** Flashes are wider pools than a fire's: an explosion, a bottle bursting (x the fire's reach). */
const FLASH = { explosion: 1.4, bottle: 0.95 } as const;

export class Fx {
  private sheet: Sheet;
  private tracers: Tracer[] = [];
  private g: Phaser.GameObjects.Graphics;
  private anims: Anim[] = [];
  private fires = new Map<number, FireView>();
  private glyphs = new Map<number, { img: Phaser.GameObjects.Image; glyph: Glyph }>();
  private bubbles: Bubble[] = [];
  private proj = new Map<number, Phaser.GameObjects.Sprite>();
  private frameCanvas = new Map<string, HTMLCanvasElement>();
  shake = 0;

  constructor(private scene: Phaser.Scene, private world: WorldView) {
    this.sheet = buildFxSheet();
    addSheet(scene, "fx", this.sheet);
    this.g = scene.add.graphics().setDepth(1.5e6);
    addImage(scene, "light:fire", buildPalettePool("fire"));
    for (const k of Object.values(FLASH)) addImage(scene, `light:flash:${k}`, buildPalettePool("fire", k));
  }

  /** A phase that starts from a snapshot: the blood under those already dead. Fires and glyphs
   *  follow the state by themselves (update). */
  fromState(sim: Sim) {
    for (const u of sim.state.units) {
      if (u.state === "dead" && !u.hidden && !(u.flags & UF_SILENT_DEATH)) this.world.decal(this.canvasOf("blood_1"), u.x, u.y + 0.2);
    }
    this.syncFires(sim);
    this.syncGlyphs(sim);
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
        break;
      case "explosion":
        this.play("explosion_", sx(e.x), sy(e.y), sy(e.y) + 2, 16);
        for (let i = 0; i < 4; i++) this.play("smoke_", sx(e.x) + (Math.random() - 0.5) * 20, sy(e.y) - 4, sy(e.y) + 3, 7, false, -8);
        this.world.decal(this.canvasOf("scorch_0"), e.x, e.y);
        this.shake = Math.max(this.shake, 0.35);
        this.flash(e.x, e.y, FLASH.explosion);
        break;
      case "bottle":
        this.play("glass_", sx(e.x), sy(e.y), sy(e.y) + 2, 14);
        this.flash(e.x, e.y, FLASH.bottle);
        break;
      case "say":
        this.say(sim.unit(e.unit), e.text);
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
    const im = this.scene.add.image(Math.round(sx(x)), Math.round(sy(y)), `light:flash:${k}`).setBlendMode(Phaser.BlendModes.ADD).setDepth(1.8e6);
    this.scene.tweens.add({ targets: im, alpha: 0, duration: 260, onComplete: () => im.destroy() });
  }

  private muzzleFlash(u: Unit) {
    const { f, flip } = facingOf(u.dir);
    const m = u.weapon === "none" ? undefined : MUZZLE[u.weapon][f];
    const ox = m ? (flip ? -m[0] : m[0]) : Math.cos(u.dir) * 8;
    const oy = m ? m[1] : -9;
    const name = `muzzle_${f}_${Math.random() < 0.5 ? 0 : 1}`;
    if (!this.has(name)) return;
    const fr = this.sheet.frames.find((q) => q.name === name)!;
    // facing away (north, north-east) the gun is behind him: the flash goes under the sprite
    const behind = f === "n" || f === "ne";
    const s = this.scene.add.sprite(Math.round(sx(u.x) + ox), Math.round(sy(u.y) + oy), "fx", name).setOrigin(fr.ax / fr.w, fr.ay / fr.h).setFlipX(flip).setDepth(sy(u.y) + (behind ? -0.3 : 1));
    this.scene.time.delayedCall(50, () => s.destroy());
  }

  // ------------------------------------------------------------------ fires (from the state)

  private syncFires(sim: Sim) {
    const live = new Set<number>();
    for (const f of sim.state.fires) {
      live.add(f.id);
      if (!this.fires.has(f.id)) this.lightFire(f.id, f.x, f.y);
    }
    for (const [id, f] of this.fires) if (!live.has(id)) this.putOut(id, f);
  }

  private lightFire(id: number, x: number, y: number) {
    const sprs: Phaser.GameObjects.Sprite[] = [];
    for (let i = 0; i < 3; i++) {
      const s = this.play("fire_", sx(x) + (i - 1) * 7, sy(y) + (i % 2) * 3, sy(y) + 1 + i, 10 + i, true);
      if (s) sprs.push(s);
    }
    const light = this.scene.add.image(Math.round(sx(x)), Math.round(sy(y)), "light:fire").setBlendMode(Phaser.BlendModes.ADD).setDepth(1.8e6);
    this.fires.set(id, { x, y, sprs, light, flickerT: 0 });
    this.world.decal(this.canvasOf("scorch_1"), x, y);
  }

  private putOut(id: number, f: FireView) {
    for (const s of f.sprs) { this.anims = this.anims.filter((a) => a.spr !== s); s.destroy(); }
    f.light.destroy();
    this.fires.delete(id);
    this.play("smoke_", sx(f.x), sy(f.y) - 4, sy(f.y) + 3, 5, false, -10);
  }

  // ------------------------------------------------------------------ head glyphs (from the state)

  private glyphKey(g: Glyph): string {
    const key = `glyph:${g}`;
    if (!this.scene.textures.exists(key)) addImage(this.scene, key, buildGlyph(g as GlyphName));
    return key;
  }

  /** The glyph over each head is the one the rules hold for him (alert, suspicious, wounded,
   *  knife), whether an event said so or not; the dead and the hidden show none. */
  private syncGlyphs(sim: Sim) {
    const alive = new Set<number>();
    for (const u of sim.state.units) {
      alive.add(u.id);
      let v = this.glyphs.get(u.id);
      if (u.glyph === "none" || u.state === "dead") {
        if (v) { v.img.destroy(); this.glyphs.delete(u.id); }
        continue;
      }
      if (!v || v.glyph !== u.glyph) {
        v?.img.destroy();
        v = { img: this.scene.add.image(0, 0, this.glyphKey(u.glyph)).setOrigin(0).setDepth(2.1e6), glyph: u.glyph };
        this.glyphs.set(u.id, v);
      }
      const spr = this.world.spriteOf(u.id);
      if (!spr || u.hidden) { v.img.setVisible(false); continue; }
      // 7 x 9, centred over the head with a pixel of air above the helmet
      v.img.setVisible(true).setPosition(Math.round(spr.x) - 3, Math.round(spr.y) - 32);
    }
    for (const [id, v] of this.glyphs) if (!alive.has(id)) { v.img.destroy(); this.glyphs.delete(id); }
  }

  // ------------------------------------------------------------------ shouts

  /** Where a shout sits (its bottom centre): over the man, or over the vehicle he is in. */
  private voiceAt(sim: Sim, id: number): { x: number; y: number } | null {
    const u = sim.unit(id);
    if (!u) return null;
    if (!u.hidden) {
      const spr = this.world.spriteOf(id);
      return spr ? { x: spr.x, y: spr.y - 26 } : null;
    }
    const v = sim.state.vehicles.find((q) => q.crew.includes(id));
    return v ? { x: sx(v.x), y: sy(v.y, 3.2) } : null;
  }

  private say(u: Unit | undefined, text: string) {
    if (!u) return;
    for (const b of this.bubbles) if (b.unit === u.id) { b.img.destroy(); b.t = 99; }
    // in the game's type, the speaker's colour, with a pixel of outline to read on the street
    const im = txt(this.scene, 0, 0, text, { font: PX, face: "sans", color: VOICE[u.side === "de" ? "de" : "pl"] })
      .setStroke(css(PAL.shared.outline), 2).setDepth(2.2e6).setVisible(false);
    this.bubbles.push({ unit: u.id, img: im, t: 0 });
  }

  // ------------------------------------------------------------------ per frame

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
      g.lineBetween(Math.round(tr.x0 + (tr.x1 - tr.x0) * b), Math.round(tr.y0 + (tr.y1 - tr.y0) * b), Math.round(tr.x0 + (tr.x1 - tr.x0) * a), Math.round(tr.y0 + (tr.y1 - tr.y0) * a));
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
    this.syncFires(sim);
    this.syncGlyphs(sim);
    // shouts ride above heads (or over the vehicle a man shouts from), rise a little and fade
    for (const b of this.bubbles) {
      b.t += dt;
      const at = b.t <= 2.2 ? this.voiceAt(sim, b.unit) : null;
      if (!at) { b.img.destroy(); b.t = 99; continue; }
      b.img.setVisible(true).setPosition(Math.round(at.x - b.img.width / 2), Math.round(at.y - Math.min(4, b.t * 10)) - b.img.height)
        .setAlpha(b.t > 1.8 ? (2.2 - b.t) / 0.4 : 1);
    }
    this.bubbles = this.bubbles.filter((b) => b.t < 99);
    for (const f of this.fires.values()) {
      f.flickerT -= dt;
      if (f.flickerT > 0) continue;
      f.flickerT = 0.08 + Math.random() * 0.1;
      f.light.setAlpha(FLICKER[Math.floor(Math.random() * FLICKER.length)]);
    }
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt);
  }
}
