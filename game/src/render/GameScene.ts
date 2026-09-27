// One phase on screen: runs the rules' clock, draws the Diorama, turns taps into commands.
// The HUD scene sits on top and owns the touch; it calls tapWorld/dragWorld/holdWorld here.
import Phaser from "phaser";
import type { Sim } from "../sim/sim";
import type { Unit } from "../sim/types";
import type { MapData } from "../content/mapdata";
import type { Phase, Interactable } from "../missions/types";
import { cmdMove, cmdTapEnemy, cmdHelp, cmdThrow, cmdFireAt } from "../sim/commands";
import { PAL } from "../art/palette";
import { allLooks } from "../content/arsenal/roster";
import { WorldView } from "./world";
import { Overlay } from "./overlay";
import { Fx } from "./fx";
import { sx, sy, wx, wy } from "./iso";
import { sound } from "./sound";

export interface PhaseRun {
  sim: Sim;
  md: MapData;
  phase: Phase;
  onEnd: (sim: Sim) => void;
}

export class GameScene extends Phaser.Scene {
  run!: PhaseRun;
  world!: WorldView;
  overlay!: Overlay;
  fx!: Fx;
  private light!: Phaser.GameObjects.Rectangle;
  private ended = 0;
  private camX = 0;
  private camY = 0;
  mapView = false;
  speed = 1;

  constructor() {
    super("game");
  }

  init(data: { run: PhaseRun }) {
    this.run = data.run;
    this.ended = 0;
    this.mapView = false;
  }

  create() {
    const { sim, md, phase } = this.run;
    this.world = new WorldView(this, md, allLooks());
    const looks = new Set(sim.state.units.map((u) => u.look));
    for (const l of ["de_rifle", "de_mp40", "de_officer", "pris", "rudy"]) looks.add(l);
    this.world.preload([...looks]);
    this.overlay = new Overlay(this);
    this.fx = new Fx(this, this.world);
    const Z = md.zones.find((z) => z.name === phase.zone)!;
    const cam = this.cameras.main;
    cam.setBounds(sx(Z.x), sy(Z.y) - 60, sx(Z.w), sy(Z.h) + 60);
    cam.setRoundPixels(true);
    const st = phase.start(sim);
    this.camX = sx(st.x);
    this.camY = sy(st.y);
    cam.centerOn(this.camX, this.camY);
    // the light over the finished frame (style guide §5)
    const amb = PAL.light.ambient[phase.light];
    const col = (Math.round(amb[0] * 255) << 16) | (Math.round(amb[1] * 255) << 8) | Math.round(amb[2] * 255);
    this.light = this.add.rectangle(0, 0, this.scale.width, this.scale.height, col).setOrigin(0).setScrollFactor(0).setDepth(3e6).setBlendMode(Phaser.BlendModes.MULTIPLY);
    this.scale.on("resize", this.onResize, this);
    this.events.once("shutdown", () => this.scale.off("resize", this.onResize, this));
    sound.music(phase.music === "finale" ? "action" : "stealth");
    sound.ambience(true);
    this.scene.launch("hud", { game: this });
    this.scene.bringToTop("hud");
  }

  private onResize() {
    this.light.setSize(this.scale.width, this.scale.height);
  }

  override update(time: number, delta: number) {
    const dt = Math.min(delta, 100) / 1000;
    const { sim, phase } = this.run;
    sim.advance(dt, this.speed);
    const events = sim.drainEvents();
    for (const e of events) {
      this.fx.handle(sim, e);
      sound.event(sim, e);
      if (e.t === "explosion") this.cameras.main.shake(180, 0.006);
    }
    if (events.length) this.events.emit("sim-events", events);
    this.world.update(sim, dt);
    this.fx.update(sim, dt);
    this.overlay.marks = phase.interactables(sim).filter((i) => i.ready(sim)).map((i) => ({ x: i.x, y: i.y, r: i.r, on: true }));
    this.overlay.draw(sim, this.cameras.main, time / 1000);
    this.follow(dt);
    sound.listener(wx(this.cameras.main.midPoint.x), wy(this.cameras.main.midPoint.y));
    if (sim.state.outcome && !this.ended) this.ended = time;
    if (this.ended && time - this.ended > 2600) {
      this.ended = Number.POSITIVE_INFINITY;
      this.run.onEnd(sim);
    }
  }

  private follow(dt: number) {
    const cam = this.cameras.main;
    if (this.mapView) return;
    const { sim } = this.run;
    const sq = sim.controlledSquad;
    const L = sq && sim.leaderOf(sq);
    if (L) {
      // look ahead to where the squad is heading, then settle on it (the "calmer camera")
      let tx = sx(L.x), ty = sy(L.y) - 12;
      if (L.path.length) {
        const p = L.path[L.path.length - 1];
        const d = Math.hypot(p.x - L.x, p.y - L.y);
        const k = Math.min(1, d / 14) * 0.45;
        tx += (sx(p.x) - sx(L.x)) * k;
        ty += (sy(p.y) - sy(L.y)) * k;
      }
      const a = 1 - Math.pow(0.02, dt);
      this.camX += (tx - this.camX) * a;
      this.camY += (ty - this.camY) * a;
    }
    cam.centerOn(Math.round(this.camX), Math.round(this.camY));
  }

  toggleMap(on: boolean) {
    this.mapView = on;
    const cam = this.cameras.main;
    if (on) {
      const Z = this.run.md.zones.find((z) => z.name === this.run.phase.zone)!;
      const zx = this.scale.width / sx(Z.w), zy = this.scale.height / (sy(Z.h) + 60);
      cam.setZoom(Math.max(0.25, Math.min(1, Math.min(zx, zy))));
      cam.centerOn(sx(Z.x + Z.w / 2), sy(Z.y + Z.h / 2));
    } else {
      cam.setZoom(1);
    }
  }

  // ------------------------------------------------------------------ input (from the HUD)

  /** Screen art px to world metres. */
  toWorld(px: number, py: number): { x: number; y: number } {
    const p = this.cameras.main.getWorldPoint(px, py);
    return { x: wx(p.x), y: wy(p.y) };
  }

  /** The unit under a tap, with a generous radius (troopers are 33 pt, under Apple's 44). */
  private unitAt(px: number, py: number, pred: (u: Unit) => boolean): Unit | null {
    const cam = this.cameras.main;
    const r = 14 / cam.zoom;
    let best: Unit | null = null, bd = r * r;
    for (const u of this.run.sim.state.units) {
      if (u.hidden || !pred(u)) continue;
      const p = cam.getWorldPoint(px, py);
      const dx = sx(u.x) - p.x, dy = sy(u.y) - 9 - p.y;
      const d = dx * dx + dy * dy * 0.7;
      if (d < bd) { bd = d; best = u; }
    }
    return best;
  }

  private interactableAt(w: { x: number; y: number }): Interactable | null {
    const { sim, phase } = this.run;
    let best: Interactable | null = null, bd = Infinity;
    for (const it of phase.interactables(sim)) {
      if (!it.ready(sim)) continue;
      const d = Math.hypot(it.x - w.x, (it.y - w.y) * 1.2);
      if (d <= it.r + 1.1 && d < bd) { bd = d; best = it; }
    }
    return best;
  }

  /** Smart tap: an enemy is fired upon (or knifed), a friend down is helped, a job is done, else walk. */
  tapWorld(px: number, py: number): string {
    if (this.mapView) {
      const w = this.toWorld(px, py);
      this.toggleMap(false);
      this.camX = sx(w.x);
      this.camY = sy(w.y);
      return "map";
    }
    const { sim } = this.run;
    const w = this.toWorld(px, py);
    const enemy = this.unitAt(px, py, (u) => u.side === "de" && u.state !== "dead");
    if (enemy) {
      const r = cmdTapEnemy(sim, enemy.id);
      this.overlay.ring = { x: sx(enemy.x), y: sy(enemy.y), t: this.time.now / 1000, enemy: true };
      sound.ui(r === "knife" ? "ui_ok" : "ui_tap");
      return r;
    }
    const down = this.unitAt(px, py, (u) => u.side === "pl" && u.state === "down");
    if (down && cmdHelp(sim, down.id)) {
      sound.ui("ui_ok");
      return "help";
    }
    const it = this.interactableAt(w);
    if (it) {
      it.act(sim);
      sound.ui("ui_ok");
      this.overlay.ring = { x: sx(it.x), y: sy(it.y), t: this.time.now / 1000, enemy: false };
      return `act:${it.id}`;
    }
    const ok = cmdMove(sim, w.x, w.y);
    this.overlay.ring = { x: sx(w.x), y: sy(w.y), t: this.time.now / 1000, enemy: false };
    sound.ui("ui_tap");
    return ok ? "move" : "none";
  }

  /** Drag to lead: the squad walks toward the finger. */
  dragWorld(px: number, py: number) {
    if (this.mapView) return;
    const w = this.toWorld(px, py);
    cmdMove(this.run.sim, w.x, w.y);
  }

  /** Hold on a spot: throw a grenade or a bottle there. */
  holdWorld(px: number, py: number): boolean {
    if (this.mapView) return false;
    const w = this.toWorld(px, py);
    const u = cmdThrow(this.run.sim, w.x, w.y, "any");
    if (u) this.overlay.ring = { x: sx(w.x), y: sy(w.y), t: this.time.now / 1000, enemy: true };
    return !!u;
  }

  throwAt(px: number, py: number, what: "grenade" | "bottle"): boolean {
    const w = this.toWorld(px, py);
    return !!cmdThrow(this.run.sim, w.x, w.y, what);
  }

  fireAt(px: number, py: number) {
    const w = this.toWorld(px, py);
    cmdFireAt(this.run.sim, w.x, w.y, 0.3);
  }
}
