// The HUD and every touch (style guide §8, steering page "smart tap"): squad tags and the
// roster at the top left, pause and map at the top right, FIRE and GRENADE under the left
// thumb with the go-code button beside them. Everything else on the screen is the street:
// tap to walk or to act, drag to lead, hold to throw.
import Phaser from "phaser";
import type { GameScene } from "../render/GameScene";
import type { SimEvent, Unit } from "../sim/types";
import { cmdSelectSquad, cmdOrder, cmdPause, cmdSignal, cmdTapEnemy, cmdHelp } from "../sim/commands";
import { PAL, SQUAD_COLOURS, hex, css } from "../art/palette";
import { readSafeInsets } from "../render/view";
import { sound } from "../render/sound";
import { hudArt, type HudArt } from "./hudart";
import { registerFonts, PX, PXS } from "./text";
import type { RGB } from "../art/palette";

type Btn = {
  id: string;
  x: number; y: number; w: number; h: number;
  visible: () => boolean;
  onDown?: (p: Phaser.Input.Pointer) => void;
  onUp?: (p: Phaser.Input.Pointer, held: number) => void;
  onLong?: () => void;
};

interface Gesture {
  id: number;
  x0: number; y0: number;
  t0: number;
  moved: boolean;
  btn: Btn | null;
  held: boolean;
  lastDrag: number;
}

export class HudScene extends Phaser.Scene {
  g!: GameScene;
  private art!: HudArt;
  private gfx!: Phaser.GameObjects.Graphics;
  private texts = new Map<string, Phaser.GameObjects.BitmapText>();
  private images = new Map<string, Phaser.GameObjects.Image>();
  private btns: Btn[] = [];
  private gestures = new Map<number, Gesture>();
  private fireHeld = false;
  private grenadeArmed = false;
  private toast: { text: string; t: number; tone: string }[] = [];
  private pauseReason = "";
  private orderMenu: number = -1;
  private pendingOrder: { squad: number; kind: "cover" | "signal" } | null = null;
  private safe = { top: 0, right: 0, bottom: 0, left: 0 };

  constructor() {
    super("hud");
  }

  init(data: { game: GameScene }) {
    this.g = data.game;
    this.btns = [];
    this.gestures.clear();
    this.texts.clear();
    this.images.clear();
    this.toast = [];
    this.pauseReason = "";
    this.orderMenu = -1;
    this.pendingOrder = null;
    this.fireHeld = false;
    this.grenadeArmed = false;
  }

  create() {
    registerFonts(this);
    this.art = hudArt(this);
    this.gfx = this.add.graphics().setDepth(10);
    this.safe = readSafeInsets(this.scale.displayScale.x ? 1 / this.scale.displayScale.x : 1.5);
    this.layout();
    this.scale.on("resize", this.layout, this);
    this.events.once("shutdown", () => this.scale.off("resize", this.layout, this));
    this.input.on("pointerdown", this.down, this);
    this.input.on("pointermove", this.move, this);
    this.input.on("pointerup", this.up, this);
    this.input.on("pointerupoutside", this.up, this);
    this.g.events.on("sim-events", this.onEvents, this);
    this.events.once("shutdown", () => this.g.events.off("sim-events", this.onEvents, this));
    const s = this.g.run.sim.state;
    for (const o of s.objectives) if (o.primary) this.say(o.text, "info");
    this.say(`${this.g.run.phase.title}: ${this.g.run.phase.place}, ${this.g.run.phase.time}`, "info");
  }

  // ------------------------------------------------------------------ layout

  private layout() {
    const W = this.scale.width, H = this.scale.height;
    const S = this.safe;
    const L = S.left + 6, R = W - S.right - 6, B = H - S.bottom - 6;
    const sim = () => this.g.run.sim;
    this.btns = [];
    // squad tags
    for (let i = 0; i < 3; i++) {
      this.btns.push({
        id: `squad${i}`, x: L + i * 60, y: S.top + 5, w: 56, h: 22,
        visible: () => !!sim().state.squads[i]?.inPlay,
        onUp: () => this.tapSquad(i),
        onLong: () => { this.orderMenu = this.orderMenu === i ? -1 : i; sound.ui("ui_tap"); },
      });
    }
    // order menu for a squad you are not leading
    const orders: ("hold" | "cover" | "signal" | "tail")[] = ["hold", "cover", "signal", "tail"];
    orders.forEach((o, k) => {
      this.btns.push({
        id: `order_${o}`, x: 0, y: S.top + 31 + k * 33, w: 30, h: 30,
        visible: () => this.orderMenu >= 0 && this.orderMenu !== sim().state.controlled,
        onUp: () => this.giveOrder(o),
      });
    });
    // roster chips of the squad you lead
    for (let k = 0; k < 6; k++) {
      this.btns.push({
        id: `chip${k}`, x: L + k * 36, y: S.top + 31, w: 34, h: 28,
        visible: () => this.orderMenu < 0 && k < this.members().length,
        onUp: () => this.tapChip(k),
      });
    }
    // pause and map
    this.btns.push({ id: "pause", x: R - 30, y: S.top + 5, w: 30, h: 30, visible: () => true, onUp: () => this.togglePause() });
    this.btns.push({ id: "map", x: R - 64, y: S.top + 5, w: 30, h: 30, visible: () => true, onUp: () => { this.g.toggleMap(!this.g.mapView); sound.ui("ui_tap"); } });
    // thumb buttons
    this.btns.push({
      id: "fire", x: L + 2, y: B - 44, w: 44, h: 44, visible: () => true,
      onDown: () => { this.fireHeld = true; },
      onUp: (_p, held) => {
        this.fireHeld = false;
        if (held < 250) this.lockNearest();
      },
    });
    this.btns.push({
      id: "grenade", x: L + 50, y: B - 38, w: 36, h: 36, visible: () => this.throwables() > 0,
      onUp: () => { this.grenadeArmed = !this.grenadeArmed; sound.ui("ui_tap"); },
    });
    this.btns.push({
      id: "go", x: L + 90, y: B - 32, w: 48, h: 30,
      visible: () => sim().state.signalReady && !sim().state.signalGiven,
      onUp: () => { cmdSignal(sim()); sound.ui("ui_go"); this.say("Orsza's whistle: go!", "good"); },
    });
    this.positionOrderMenu();
  }

  private positionOrderMenu() {
    const i = this.orderMenu;
    const x = this.safe.left + 6 + Math.max(0, i) * 60 + 13;
    for (const b of this.btns) if (b.id.startsWith("order_")) b.x = x;
  }

  private members(): Unit[] {
    const sim = this.g.run.sim;
    const sq = sim.controlledSquad;
    if (!sq) return [];
    return sq.members.map((id) => sim.unit(id)!).filter((u) => u && !u.hidden);
  }

  private throwables(): number {
    return this.members().reduce((a, u) => a + (u.state === "ok" ? u.grenades + u.bottles : 0), 0);
  }

  // ------------------------------------------------------------------ actions

  private tapSquad(i: number) {
    const sim = this.g.run.sim;
    if (this.pendingOrder) this.pendingOrder = null;
    if (i === sim.state.controlled) { this.orderMenu = -1; return; }
    if (sim.state.paused) {
      // during the pause a tap on another squad opens its orders (one order per team)
      this.orderMenu = this.orderMenu === i ? -1 : i;
      this.positionOrderMenu();
      return;
    }
    if (cmdSelectSquad(sim, i)) { this.orderMenu = -1; sound.ui("ui_ok"); this.say(`You lead ${sim.state.squads[i].name}'s squad`, "info"); }
  }

  private giveOrder(o: "hold" | "cover" | "signal" | "tail") {
    const sim = this.g.run.sim;
    const i = this.orderMenu;
    if (i < 0) return;
    if (o === "hold" || o === "tail") {
      if (cmdOrder(sim, i, o)) this.say(`${sim.state.squads[i].name}: ${o === "hold" ? "hold here" : "follow me"}`, "info");
      else this.say("One order per squad during the pause", "bad");
      this.orderMenu = -1;
    } else {
      this.pendingOrder = { squad: i, kind: o };
      this.say(o === "cover" ? "Tap where they should cover" : "Tap where they go on the signal", "info");
      this.orderMenu = -1;
    }
    sound.ui("ui_ok");
  }

  private tapChip(k: number) {
    const u = this.members()[k];
    if (!u) return;
    const sim = this.g.run.sim;
    if (u.state === "down") { cmdHelp(sim, u.id); sound.ui("ui_ok"); return; }
    this.g.toggleMap(false);
  }

  private togglePause() {
    const sim = this.g.run.sim;
    cmdPause(sim, !sim.state.paused);
    if (!sim.state.paused) { this.pauseReason = ""; this.orderMenu = -1; }
    sound.ui("ui_pause");
  }

  private lockNearest() {
    const sim = this.g.run.sim;
    const sq = sim.controlledSquad;
    const L = sq && sim.leaderOf(sq);
    if (!L) return;
    let best: Unit | null = null, bd = 24;
    for (const u of sim.state.units) {
      if (u.side !== "de" || u.state === "dead" || u.hidden) continue;
      const d = Math.hypot(u.x - L.x, u.y - L.y);
      if (d < bd && sim.grid.los(L.x, L.y, u.x, u.y)) { bd = d; best = u; }
    }
    if (best) { cmdTapEnemy(sim, best.id, 0); sound.ui("ui_tap"); }
  }

  // ------------------------------------------------------------------ touch

  private btnAt(x: number, y: number): Btn | null {
    for (let i = this.btns.length - 1; i >= 0; i--) {
      const b = this.btns[i];
      if (!b.visible()) continue;
      const pad = 4;
      if (x >= b.x - pad && y >= b.y - pad && x < b.x + b.w + pad && y < b.y + b.h + pad) return b;
    }
    return null;
  }

  private down(p: Phaser.Input.Pointer) {
    sound.unlock();
    const btn = this.btnAt(p.x, p.y);
    const g: Gesture = { id: p.id, x0: p.x, y0: p.y, t0: this.time.now, moved: false, btn, held: false, lastDrag: 0 };
    this.gestures.set(p.id, g);
    if (btn?.onDown) btn.onDown(p);
    if (!btn && this.fireHeld) this.g.fireAt(p.x, p.y);
  }

  private move(p: Phaser.Input.Pointer) {
    const g = this.gestures.get(p.id);
    if (!g || !p.isDown) return;
    if (Math.hypot(p.x - g.x0, p.y - g.y0) > 8) g.moved = true;
    if (g.btn) return;
    if (this.fireHeld) { this.g.fireAt(p.x, p.y); return; }
    if (g.moved && this.time.now - g.lastDrag > 120 && !this.pendingOrder && !this.grenadeArmed) {
      g.lastDrag = this.time.now;
      this.g.dragWorld(p.x, p.y);
    }
  }

  private up(p: Phaser.Input.Pointer) {
    const g = this.gestures.get(p.id);
    this.gestures.delete(p.id);
    if (!g) return;
    const held = this.time.now - g.t0;
    if (g.btn) {
      if (g.btn.onLong && held > 450 && !g.moved) g.btn.onLong();
      else g.btn.onUp?.(p, held);
      return;
    }
    if (g.held || this.fireHeld) return;
    const sim = this.g.run.sim;
    if (this.pendingOrder) {
      const w = this.g.toWorld(p.x, p.y);
      const po = this.pendingOrder;
      this.pendingOrder = null;
      const sq = sim.state.squads[po.squad];
      const L = sq && sim.leaderOf(sq);
      if (!L) return;
      const ok = po.kind === "cover"
        ? cmdOrder(sim, po.squad, "cover", { dir: Math.atan2(w.y - L.y, w.x - L.x), half: 0.55 })
        : cmdOrder(sim, po.squad, "signal", { route: [w] });
      this.say(ok ? `${sq.name}: ${po.kind === "cover" ? "covering" : "goes on the signal"}` : "One order per squad during the pause", ok ? "info" : "bad");
      sound.ui(ok ? "ui_ok" : "ui_back");
      return;
    }
    if (this.grenadeArmed) {
      this.grenadeArmed = false;
      if (!this.g.holdWorld(p.x, p.y)) this.say("Nobody close enough to throw", "bad");
      return;
    }
    if (!g.moved && held > 480) { this.g.holdWorld(p.x, p.y); return; }
    if (!g.moved) this.g.tapWorld(p.x, p.y);
  }

  // ------------------------------------------------------------------ events and text

  private onEvents(events: SimEvent[]) {
    const sim = this.g.run.sim;
    for (const e of events) {
      if (e.t === "pause") { this.pauseReason = e.reason; this.say(e.reason, "bad"); }
      else if (e.t === "message") this.say(e.text, e.tone);
      else if (e.t === "alarm") this.say("Alarm! The Germans are coming.", "bad");
      else if (e.t === "objective" && e.status === "done") {
        const o = sim.state.objectives.find((q) => q.id === e.id);
        if (o) this.say(`✓ ${o.text}`, "good");
      } else if (e.t === "death") {
        const u = sim.unit(e.unit);
        if (u && u.side === "pl" && u.name) this.say(`${u.name} has fallen`, "bad");
      }
    }
  }

  say(text: string, tone: string) {
    this.toast.push({ text, t: this.time.now, tone });
    if (this.toast.length > 4) this.toast.shift();
  }

  /** Pixel text (the game's own font), created once per key and reused every frame. */
  private text(key: string, x: number, y: number, str: string, o: { size?: number; color?: RGB; align?: number; font?: string } = {}) {
    let t = this.texts.get(key);
    const font = o.font ?? (o.size && o.size <= 6 ? PXS : PX);
    if (!t) {
      t = this.add.bitmapText(0, 0, font, "").setDepth(20);
      this.texts.set(key, t);
    }
    const body = font === PXS ? str.toLocaleUpperCase("pl") : str;
    if (t.text !== body) t.setText(body);
    t.setPosition(Math.round(x), Math.round(y)).setOrigin(o.align ?? 0, 0).setVisible(true).setAlpha(1);
    t.setTint(hex(o.color ?? PAL.shared.chalk));
    return t;
  }

  /** A dark panel behind a text, so it reads over any street. */
  private panelBehind(t: Phaser.GameObjects.BitmapText, pad = 3, alpha = 0.62) {
    const b = t.getBounds();
    this.gfx.fillStyle(hex(PAL.shared.outline), alpha).fillRect(Math.floor(b.x - pad), Math.floor(b.y - pad + 1), Math.ceil(b.width + pad * 2), Math.ceil(b.height + pad * 2 - 2));
  }

  private hideTextsExcept(keep: Set<string>) {
    for (const [k, t] of this.texts) if (!keep.has(k)) t.setVisible(false);
  }

  override update() {
    const g = this.gfx;
    g.clear();
    const keep = new Set<string>();
    const W = this.scale.width;
    const sim = this.g.run.sim;
    const s = sim.state;
    for (const b of this.btns) {
      const img = this.images.get(b.id);
      if (!b.visible()) { img?.setVisible(false); continue; }
      this.drawButton(b, keep);
    }
    // objectives: top right, under pause and map, on a dark panel
    const objs = s.objectives.filter((o) => o.primary || o.status !== "open");
    const ox = W - this.safe.right - 6;
    objs.forEach((o, k) => {
      const mark = o.status === "done" ? "+" : o.status === "failed" ? "x" : "-";
      const col = o.status === "done" ? PAL.hud.hp_ok : o.status === "failed" ? PAL.hud.hp_low : PAL.shared.chalk;
      keep.add(`obj${k}`);
      const t = this.text(`obj${k}`, ox, this.safe.top + 40 + k * 10, `${o.text} ${mark}`, { color: col, align: 1 });
      this.panelBehind(t, 2, 0.55);
    });
    const banner = this.g.run.phase.banner?.(sim);
    if (banner && !s.paused) { keep.add("banner"); const t = this.text("banner", W / 2, this.safe.top + 66, banner, { align: 0.5 }); this.panelBehind(t, 3, 0.7); }
    // toasts
    const now = this.time.now;
    this.toast = this.toast.filter((t) => now - t.t < 3800);
    this.toast.forEach((t, k) => {
      const col = t.tone === "good" ? PAL.hud.hp_ok : t.tone === "bad" ? PAL.hud.hp_low : PAL.shared.chalk;
      keep.add(`toast${k}`);
      const tx = this.text(`toast${k}`, W / 2, this.scale.height * 0.6 + k * 12, t.text, { align: 0.5, color: col });
      const a = Math.min(1, (3800 - (now - t.t)) / 600);
      this.panelBehind(tx, 2, 0.6 * a);
      tx.setAlpha(a);
    });
    // pause banner
    if (s.paused) {
      keep.add("paused");
      const msg = this.pauseReason ? `${this.pauseReason}. Paused: one order per squad, then ▶` : "Paused: one order per squad, then ▶";
      const t = this.text("paused", W / 2, this.safe.top + 66, msg, { align: 0.5, color: PAL.hud.paper_ink });
      const b = t.getBounds();
      g.fillStyle(hex(PAL.hud.paper[1]), 0.96).fillRect(Math.floor(b.x - 6), Math.floor(b.y - 4), Math.ceil(b.width + 12), Math.ceil(b.height + 7));
      g.lineStyle(1, hex(PAL.shared.outline), 1).strokeRect(Math.floor(b.x - 6), Math.floor(b.y - 4), Math.ceil(b.width + 12), Math.ceil(b.height + 7));
    }
    if (this.pendingOrder) { keep.add("pending"); const t = this.text("pending", W / 2, this.scale.height - 22, this.pendingOrder.kind === "cover" ? "Tap where they should cover" : "Tap where they go on the signal", { align: 0.5, color: PAL.shared.select_gold }); this.panelBehind(t); }
    if (this.grenadeArmed) { keep.add("armed"); const t = this.text("armed", W / 2, this.scale.height - 22, "Tap where to throw", { align: 0.5, color: PAL.shared.chalk }); this.panelBehind(t); }
    this.hideTextsExcept(keep);
  }

  private drawButton(b: Btn, keep: Set<string>) {
    const g = this.gfx;
    const sim = this.g.run.sim;
    const pressed = [...this.gestures.values()].some((q) => q.btn === b) || (b.id === "grenade" && this.grenadeArmed) || (b.id === "fire" && this.fireHeld);
    const art = this.art.button(b, pressed, sim);
    if (art) {
      let img = this.images.get(b.id);
      if (!img) { img = this.add.image(0, 0, art).setOrigin(0).setDepth(12); this.images.set(b.id, img); }
      img.setTexture(art).setPosition(b.x, b.y).setVisible(true);
      const label = this.art.label(b, sim);
      if (label) { keep.add(`lb_${b.id}`); this.text(`lb_${b.id}`, b.x + label.x, b.y + label.y, label.text, { size: label.size ?? 7, align: label.align ?? 0, color: label.color }).setDepth(13); }
      return;
    }
  }
}

export { SQUAD_COLOURS };
