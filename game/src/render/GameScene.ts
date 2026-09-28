// One phase on screen: runs the rules' clock, draws the Diorama, turns taps into commands.
// The HUD scene sits on top and owns the touch; it calls tapWorld/dragWorld/holdWorld here.
import Phaser from "phaser";
import type { Sim } from "../sim/sim";
import type { Unit } from "../sim/types";
import type { MapData } from "../content/mapdata";
import type { Phase, Interactable } from "../missions/types";
import { actorOf, cmdMove, cmdTapEnemy, cmdHelp, cmdThrow, cmdFireAt } from "../sim/commands";
import { PAL, lightHex } from "../art/palette";
import { allLooks } from "../content/arsenal/roster";
import { WorldView } from "./world";
import { Overlay } from "./overlay";
import { screen } from "./screen";
import { Fx } from "./fx";
import { sx, sy, wx, wy } from "./iso";
import { sound } from "./sound";
import { store } from "../game/store";

/** A grenade's jolt in art px, either way: 0.6 % of the 480 x 270 view, as before the canvas
 *  went to the screen's resolution. */
const SHAKE = { x: 2.9, y: 1.6 };
/** How far the light layer reaches past the screen, so a shake never bares its edge. */
const LIGHT_BLEED = 1.1;
/** Metres round the ring at a place an objective names (a job's ring is its own reach). */
const PLACE_R = 1.6;

/** Something the phase asks of you on the ground (world metres): a job on offer, keyed by
 *  what it does (several places can do one job), or a place an open objective names. */
export interface GroundMark { key: string; x: number; y: number; r: number; job: boolean }
import type { Flow } from "../game/flow";

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

  flow!: Flow;

  init(data: { run: PhaseRun; flow: Flow }) {
    this.run = data.run;
    this.flow = data.flow;
    this.ended = 0;
    this.mapView = false;
  }

  /** Locked phone: pause, and leave a bookmark for one resume if iOS kills the tab. */
  private onVisibility = () => {
    const { sim, phase } = this.run;
    if (document.hidden) {
      if (sim.state.outcome) return;
      sim.state.paused = true;
      void store.saveBookmark({ phase: phase.id, campaign: this.flow.campaign, sim: sim.snapshot(), at: Date.now() });
    } else {
      void store.takeBookmark();
    }
  };

  create() {
    const { sim, md, phase } = this.run;
    this.world = new WorldView(this, md, allLooks());
    const looks = new Set(sim.state.units.map((u) => u.look));
    for (const l of ["de_rifle", "de_mp40", "de_officer", "pris", "rudy"]) looks.add(l);
    this.world.preload([...looks]);
    this.overlay = new Overlay(this);
    this.fx = new Fx(this, this.world);
    // a phase resumed from a snapshot starts with what it was left with (fires, glyphs, the dead)
    this.fx.fromState(sim);
    const Z = md.zones.find((z) => z.name === phase.zone)!;
    const cam = this.cameras.main;
    cam.setBounds(sx(Z.x), sy(Z.y) - 60, sx(Z.w), sy(Z.h) + 60);
    cam.setRoundPixels(true);
    // the street is laid out in art px and drawn at the screen's own resolution (render/screen.ts)
    cam.setZoom(screen.s);
    const st = phase.start(sim);
    this.camX = sx(st.x);
    this.camY = sy(st.y);
    cam.centerOn(this.camX, this.camY);
    // the light over the finished frame (style guide §5)
    this.light = this.add.rectangle(this.scale.width / 2, this.scale.height / 2, this.scale.width * LIGHT_BLEED, this.scale.height * LIGHT_BLEED, lightHex(PAL.light.ambient[phase.light]))
      .setScrollFactor(0).setDepth(3e6).setBlendMode(Phaser.BlendModes.MULTIPLY);
    this.light.setScale(1 / cam.zoom);
    this.scale.on("resize", this.onResize, this);
    document.addEventListener("visibilitychange", this.onVisibility);
    this.events.once("shutdown", () => {
      this.scale.off("resize", this.onResize, this);
      document.removeEventListener("visibilitychange", this.onVisibility);
      sound.endPhase();
    });
    sound.beginPhase();
    sound.music(phase.music === "finale" ? "finale" : "stealth");
    sound.ambience(true);
    this.scene.launch("hud", { game: this });
    this.scene.bringToTop("hud");
  }

  private onResize() {
    this.light.setPosition(this.scale.width / 2, this.scale.height / 2).setSize(this.scale.width * LIGHT_BLEED, this.scale.height * LIGHT_BLEED);
    // the zoom (the street's, or the map view's fraction of it) follows the screen
    this.toggleMap(this.mapView);
  }

  override update(time: number, delta: number) {
    const dt = Math.min(delta, 100) / 1000;
    const { sim, phase } = this.run;
    sim.advance(dt, this.speed);
    const events = sim.drainEvents();
    for (const e of events) {
      this.fx.handle(sim, e);
      sound.event(sim, e);
      if (e.t === "explosion") {
        // Phaser moves the camera by intensity x its size in physical px, inside the zoom
        const cam = this.cameras.main;
        cam.shake(180, new Phaser.Math.Vector2(SHAKE.x / (cam.width * cam.zoom), SHAKE.y / (cam.height * cam.zoom)));
      }
      // ironman: a man falling, going down or being got up reaches the save at once
      if (e.t === "death" || e.t === "down" || e.t === "up") {
        const u = sim.unit(e.unit);
        if (u && u.side === "pl" && u.tag) this.flow.noteLoss(u.tag, e.t === "death" ? "dead" : e.t === "down" ? "down" : "wounded");
      }
    }
    if (events.length) this.events.emit("sim-events", events);
    this.world.update(sim, dt);
    this.fx.update(sim, dt);
    // the camera settles first, so the overlay is laid under this frame's view
    this.follow(dt);
    this.overlay.marks = this.marksOf().map((m) => ({ x: m.x, y: m.y, r: m.r, on: m.job }));
    this.overlay.draw(sim, this.cameras.main, time / 1000);
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
    // the camera stays on whoever the next tap moves (the man picked on the strip goes alone)
    const L = actorOf(sim);
    if (L) {
      // look ahead to where the squad is heading, then settle on it (the "calmer camera")
      let tx = sx(L.x), ty = sy(L.y) - 12;
      const f = this.run.phase.focus?.(sim);
      if (f && Math.hypot(f.x - L.x, f.y - L.y) < 46) {
        // keep the thing that matters (the van) in frame with the squad
        tx += (sx(f.x) - tx) * 0.5;
        ty += (sy(f.y) - 8 - ty) * 0.5;
      } else if (L.path.length) {
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
      const zx = screen.w / sx(Z.w), zy = screen.h / (sy(Z.h) + 60);
      // at most a whole fraction (1/2, 1/3, 1/4) of the street's zoom, and even on the screen: a
      // whole number of physical pixels to an art pixel, or one physical pixel to a whole number
      // of art pixels (review round 11: 4/3 drew art pixels 1 and 2 pixels wide by turns)
      const fit = screen.s / Math.min(4, Math.ceil(1 / Math.min(1, zx, zy)));
      cam.setZoom(fit >= 1 ? Math.floor(fit) : 1 / Math.ceil(1 / fit));
      cam.centerOn(sx(Z.x + Z.w / 2), sy(Z.y + Z.h / 2));
    } else {
      cam.setZoom(screen.s);
    }
    // the light is fixed to the screen, but the camera's zoom still scales it about the centre
    this.light.setScale(1 / cam.zoom);
  }

  // ------------------------------------------------------------------ input (from the HUD)

  /** A point on the canvas (physical px, as the pointer gives it) to world metres. */
  toWorld(px: number, py: number): { x: number; y: number } {
    const p = this.cameras.main.getWorldPoint(px, py);
    return { x: wx(p.x), y: wy(p.y) };
  }

  /** The unit under a tap, with a generous radius (troopers are 33 pt, under Apple's 44). */
  private unitAt(px: number, py: number, pred: (u: Unit) => boolean): Unit | null {
    const cam = this.cameras.main;
    // 14 art px on the street, wider in the map view
    const r = (14 * screen.s) / cam.zoom;
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

  /** What the phase asks of you on the ground now: the jobs on offer and the places the open
   *  objectives name. The overlay rings them; the HUD points at those off the screen. */
  marksOf(): GroundMark[] {
    const { sim, phase } = this.run;
    const out: GroundMark[] = phase.interactables(sim).filter((i) => i.ready(sim)).map((i) => ({ key: i.label, x: i.x, y: i.y, r: i.r, job: true }));
    for (const o of sim.state.objectives) {
      if (o.primary && o.status === "open" && o.x !== undefined && o.y !== undefined) out.push({ key: `objective:${o.id}`, x: o.x, y: o.y, r: PLACE_R, job: false });
    }
    return out;
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
