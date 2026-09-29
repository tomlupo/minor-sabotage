// The HUD and every touch (style guide §8, steering page "smart tap"): squad tags and the
// roster at the top left, pause and map at the top right, FIRE and GRENADE under the left
// thumb with the go-code button beside them. Everything else on the screen is the street:
// tap to walk or to act, drag to lead, hold to throw.
import Phaser from "phaser";
import type { GameScene } from "../render/GameScene";
import type { SimEvent, Unit } from "../sim/types";
import { cmdSelectSquad, cmdOrder, cmdPause, cmdSignal, cmdTapEnemy, cmdHelp, cmdPick } from "../sim/commands";
import { PAL, hex, css } from "../art/palette";
import { readSafeInsets } from "../render/view";
import { screen, fitCamera, artPoint } from "../render/screen";
import { sound } from "../render/sound";
import { hudArt, type HudArt, type HudImage } from "./hudart";
import { txt, capsOf, capShift, fitLine, PX, PXS, PXB } from "./text";
import { nextHint, markSeen, type Hint } from "./hints";
import { placeArrows, arrowMask, type Box } from "./pointers";
import { sx, sy } from "../render/iso";
import type { RGB } from "../art/palette";

type OrderKind = "hold" | "cover" | "signal";

type Btn = {
  kind: "squad" | "order" | "chip" | "pause" | "map" | "fire" | "grenade" | "go";
  /** Which squad or which chip it stands for. */
  index: number;
  order?: OrderKind;
  /** Its image's name, fixed for the scene. */
  key: string;
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
  private texts = new Map<string, Phaser.GameObjects.Text>();
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
  private hint: { h: Hint; t: number } | null = null;
  private hintShown = new Set<string>();
  private hintCheck = 0;
  private hintBox: { x: number; y: number; w: number; h: number } | null = null;

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
    fitCamera(this);
    this.art = hudArt(this);
    this.gfx = this.add.graphics().setDepth(10);
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
    this.safe = readSafeInsets(screen.zoom);
    const W = screen.w, H = screen.h;
    const S = this.safe;
    const L = S.left + 6, R = W - S.right - 6, B = H - S.bottom - 6;
    const sim = () => this.g.run.sim;
    this.btns = [];
    // squad tags
    for (let i = 0; i < 3; i++) {
      this.btns.push({
        kind: "squad", index: i, key: `squad${i}`, x: L + i * 60, y: S.top + 5, w: 56, h: 22,
        visible: () => !!sim().state.squads[i]?.inPlay,
        onUp: () => this.tapSquad(i),
        onLong: () => { this.orderMenu = this.orderMenu === i ? -1 : i; sound.ui("ui_tap"); },
      });
    }
    // order menu for a squad you are not leading
    const orders: OrderKind[] = ["hold", "cover", "signal"];
    orders.forEach((o, k) => {
      this.btns.push({
        kind: "order", index: k, order: o, key: `order_${o}`, x: 0, y: S.top + 31 + k * 33, w: 30, h: 30,
        visible: () => this.orderMenu >= 0 && this.orderMenu !== sim().state.controlled,
        onUp: () => this.giveOrder(o),
      });
    });
    // roster chips of the squad you lead
    for (let k = 0; k < 6; k++) {
      this.btns.push({
        kind: "chip", index: k, key: `chip${k}`, x: L + k * 36, y: S.top + 31, w: 34, h: 28,
        visible: () => this.orderMenu < 0 && k < this.members().length,
        onUp: () => this.tapChip(k),
      });
    }
    // pause and map
    this.btns.push({ kind: "pause", index: 0, key: "pause", x: R - 30, y: S.top + 5, w: 30, h: 30, visible: () => true, onUp: () => this.togglePause() });
    this.btns.push({ kind: "map", index: 0, key: "map", x: R - 64, y: S.top + 5, w: 30, h: 30, visible: () => true, onUp: () => { this.g.toggleMap(!this.g.mapView); sound.ui("ui_tap"); } });
    // thumb buttons
    this.btns.push({
      kind: "fire", index: 0, key: "fire", x: L + 2, y: B - 44, w: 44, h: 44, visible: () => true,
      onDown: () => { this.fireHeld = true; },
      onUp: (_p, held) => {
        this.fireHeld = false;
        if (held < 250) this.lockNearest();
      },
    });
    this.btns.push({
      kind: "grenade", index: 0, key: "grenade", x: L + 50, y: B - 38, w: 36, h: 36, visible: () => this.throwables() > 0,
      onUp: () => { this.grenadeArmed = !this.grenadeArmed; sound.ui("ui_tap"); },
    });
    this.btns.push({
      kind: "go", index: 0, key: "go", x: L + 90, y: B - 32, w: 48, h: 30,
      visible: () => sim().state.signalReady && !sim().state.signalGiven,
      onUp: () => { cmdSignal(sim()); sound.ui("ui_go"); this.say("Orsza's whistle: go!", "good"); },
    });
    this.positionOrderMenu();
  }

  private positionOrderMenu() {
    const i = this.orderMenu;
    const x = this.safe.left + 6 + Math.max(0, i) * 60 + 13;
    for (const b of this.btns) if (b.kind === "order") b.x = x;
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

  private giveOrder(o: OrderKind) {
    const sim = this.g.run.sim;
    const i = this.orderMenu;
    if (i < 0) return;
    if (o === "hold") {
      if (cmdOrder(sim, i, o)) this.say(`${sim.state.squads[i].name}: hold here`, "info");
      else this.say("One order per squad during the pause", "bad");
      this.orderMenu = -1;
    } else {
      this.pendingOrder = { squad: i, kind: o };
      this.say(o === "cover" ? "Tap where they should cover" : "Tap where they go on the signal", "info");
      this.orderMenu = -1;
    }
    sound.ui("ui_ok");
  }

  /** The portrait strip picks a man (design brief): he acts alone until his tag is tapped
   *  again. A man lying wounded is got up instead. */
  private tapChip(k: number) {
    const u = this.members()[k];
    if (!u) return;
    const sim = this.g.run.sim;
    this.g.toggleMap(false);
    if (u.state === "down") { if (cmdHelp(sim, u.id)) sound.ui("ui_ok"); return; }
    if (u.state !== "ok") return;
    const picked = cmdPick(sim, u.id);
    this.say(picked ? `${u.name} goes alone: tap the street, a guard or a job` : `${u.name} is back in the column`, "info");
    sound.ui(picked ? "ui_ok" : "ui_back");
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
    // the HUD is laid out in art px; the street (this.g) takes the canvas point as it came
    const a = artPoint(p);
    const hb = this.hintBox;
    if (this.hint && hb && a.x >= hb.x && a.y >= hb.y && a.x < hb.x + hb.w && a.y < hb.y + hb.h) {
      markSeen(this.hint.h.id);
      this.hint = null;
      sound.ui("ui_tap");
      return;
    }
    const btn = this.btnAt(a.x, a.y);
    const g: Gesture = { id: p.id, x0: a.x, y0: a.y, t0: this.time.now, moved: false, btn, held: false, lastDrag: 0 };
    this.gestures.set(p.id, g);
    if (btn?.onDown) btn.onDown(p);
    if (!btn && this.fireHeld) this.g.fireAt(p.x, p.y);
  }

  private move(p: Phaser.Input.Pointer) {
    const g = this.gestures.get(p.id);
    if (!g || !p.isDown) return;
    const a = artPoint(p);
    if (Math.hypot(a.x - g.x0, a.y - g.y0) > 8) g.moved = true;
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
    // a drag let go: the walk it led is judged now, once
    if (g.moved) { this.g.dragEnded(); return; }
    if (held > 480) { this.g.holdWorld(p.x, p.y); return; }
    this.g.tapWorld(p.x, p.y);
  }

  // ------------------------------------------------------------------ events and text

  private onEvents(events: SimEvent[]) {
    const sim = this.g.run.sim;
    for (const e of events) {
      if (e.t === "pause") { this.pauseReason = e.reason; this.say(e.reason, "bad"); }
      else if (e.t === "message") this.say(e.text, e.tone);
      else if (e.t === "alarm") this.say("Alarm! The Germans are coming.", "bad");
      else if (e.t === "death") {
        const u = sim.unit(e.unit);
        if (u && u.side === "pl" && u.name) this.say(`${u.name} has fallen`, "bad");
      }
    }
  }

  say(text: string, tone: string) {
    this.toast.push({ text, t: this.time.now, tone });
    if (this.toast.length > 3) this.toast.shift();
  }

  /** A line of the HUD's type, created once per key and reused every frame (redrawn only when it changes). */
  private text(key: string, x: number, y: number, str: string, o: { size?: number; color?: RGB; align?: number; font?: string; shadow?: RGB } = {}) {
    let t = this.texts.get(key);
    const font = o.font ?? (o.size && o.size <= 6 ? PXS : PX);
    if (!t) {
      t = txt(this, 0, 0, "", { font, face: "sans" }).setDepth(20);
      this.texts.set(key, t);
    }
    const body = capsOf(font) ? str.toLocaleUpperCase("pl") : str;
    if (t.text !== body) t.setText(body);
    t.setPosition(Math.round(x), Math.round(y) + capShift(t, "sans", font)).setOrigin(o.align ?? 0, 0).setVisible(true).setAlpha(1);
    const col = css(o.color ?? PAL.shared.chalk);
    if (t.style.color !== col) t.setColor(col);
    const shade = o.shadow ? css(o.shadow) : "";
    // a canvas shadow's offset is in the text's own pixels, whatever its resolution: one art px
    const off = Math.max(1, Math.round(screen.s));
    if (shade && (t.style.shadowColor !== shade || t.style.shadowOffsetX !== off)) t.setShadow(off, off, shade, 0, false, true);
    return t;
  }

  /** A dark panel behind a text, so it reads over any street. */
  private panelBehind(t: Phaser.GameObjects.Text, pad = 3, alpha = 0.62) {
    const b = t.getBounds();
    this.gfx.fillStyle(hex(PAL.shared.outline), alpha).fillRect(Math.floor(b.x - pad), Math.floor(b.y - pad + 1), Math.ceil(b.width + pad * 2), Math.ceil(b.height + pad * 2 - 2));
  }

  /** A 7-pixel box beside an objective: empty while open, a tick when done, a cross when failed. */
  private checkbox(x: number, y: number, status: string, col: RGB) {
    const g = this.gfx;
    g.fillStyle(hex(col), 1);
    g.fillRect(x, y, 7, 1).fillRect(x, y + 6, 7, 1).fillRect(x, y, 1, 7).fillRect(x + 6, y, 1, 7);
    const marks: Record<string, number[][]> = {
      done: [[1, 3], [2, 4], [3, 3], [4, 2], [5, 1]],
      failed: [[1, 1], [2, 2], [3, 3], [4, 4], [5, 5], [5, 1], [4, 2], [2, 4], [1, 5]],
    };
    for (const [px, py] of marks[status] ?? []) g.fillRect(x + px, y + py, 1, 1);
  }

  private hideTextsExcept(keep: Set<string>) {
    for (const [k, t] of this.texts) if (!keep.has(k)) t.setVisible(false);
  }

  override update() {
    const g = this.gfx;
    g.clear();
    const keep = new Set<string>();
    // what the HUD covers this frame: the arrows keep clear of it
    const blocked: Box[] = [];
    const cover = (t: Phaser.GameObjects.Text, pad: number) => { const b = t.getBounds(); blocked.push({ x: b.x - pad, y: b.y - pad, w: b.width + pad * 2, h: b.height + pad * 2 }); };
    const W = screen.w;
    const sim = this.g.run.sim;
    const s = sim.state;
    for (const b of this.btns) {
      if (!b.visible()) { this.images.get(b.key)?.setVisible(false); continue; }
      this.drawButton(b, keep);
      blocked.push({ x: b.x, y: b.y, w: b.w, h: b.h });
    }
    // objectives: top right, under pause and map, on a dark panel
    const objs = s.objectives.filter((o) => o.primary || o.status !== "open");
    const ox = W - this.safe.right - 6;
    objs.forEach((o, k) => {
      const col = o.status === "done" ? PAL.hud.hp_ok : o.status === "failed" ? PAL.hud.hp_low : PAL.shared.chalk;
      keep.add(`obj${k}`);
      const y = this.safe.top + 40 + k * 10;
      const t = this.text(`obj${k}`, ox - 10, y, o.text, { color: col, align: 1 });
      const b = t.getBounds();
      this.gfx.fillStyle(hex(PAL.shared.outline), 0.55).fillRect(Math.floor(b.x - 2), y - 1, Math.ceil(b.width) + 14, 9);
      blocked.push({ x: Math.floor(b.x - 2), y: y - 1, w: Math.ceil(b.width) + 14, h: 9 });
      this.checkbox(ox - 7, y, o.status, col);
    });
    const banner = this.g.run.phase.banner?.(sim);
    if (banner && !s.paused) { keep.add("banner"); const t = this.text("banner", W / 2, this.safe.top + 92, banner, { align: 0.5 }); this.panelBehind(t, 3, 0.7); cover(t, 3); }
    // toasts
    const now = this.time.now;
    this.toast = this.toast.filter((t) => now - t.t < 3200);
    this.toast.forEach((t, k) => {
      const col = t.tone === "good" ? PAL.hud.hp_ok : t.tone === "bad" ? PAL.hud.hp_low : PAL.shared.chalk;
      keep.add(`toast${k}`);
      const tx = this.text(`toast${k}`, W / 2, screen.h - this.safe.bottom - 16 - (this.toast.length - 1 - k) * 11, t.text, { align: 0.5, color: col });
      const a = Math.min(1, (3200 - (now - t.t)) / 500);
      this.panelBehind(tx, 2, 0.6 * a);
      tx.setAlpha(a);
      cover(tx, 2);
    });
    // pause banner
    if (s.paused) {
      keep.add("paused");
      const msg = this.pauseReason ? `${this.pauseReason}. Paused: one order per squad, then play` : "Paused: one order per squad, then play";
      const t = this.text("paused", W / 2, this.safe.top + 92, msg, { align: 0.5, color: PAL.hud.paper_ink });
      const b = t.getBounds();
      g.fillStyle(hex(PAL.hud.paper[1]), 0.96).fillRect(Math.floor(b.x - 6), Math.floor(b.y - 4), Math.ceil(b.width + 12), Math.ceil(b.height + 7));
      g.lineStyle(1, hex(PAL.shared.outline), 1).strokeRect(Math.floor(b.x - 6), Math.floor(b.y - 4), Math.ceil(b.width + 12), Math.ceil(b.height + 7));
      cover(t, 6);
    }
    // first-time hints: one at a time, on paper, under the banners
    if (!this.hint && now - this.hintCheck > 500) {
      this.hintCheck = now;
      const h = nextHint(sim, this.g.run.phase, this.hintShown);
      if (h) { this.hint = { h, t: now }; this.hintShown.add(h.id); }
    }
    this.hintBox = null;
    if (this.hint) {
      if (now - this.hint.t > 7000) { markSeen(this.hint.h.id); this.hint = null; }
      else {
        keep.add("hint");
        const y = this.safe.top + (s.paused || banner ? 108 : 92);
        const t = this.text("hint", W / 2, y, this.hint.h.text, { align: 0.5, color: PAL.hud.paper_ink });
        const b = t.getBounds();
        const box = { x: Math.floor(b.x - 7), y: Math.floor(b.y - 4), w: Math.ceil(b.width + 14), h: Math.ceil(b.height + 8) };
        g.fillStyle(hex(PAL.hud.paper[1]), 0.97).fillRect(box.x, box.y, box.w, box.h);
        g.lineStyle(1, hex(PAL.shared.outline), 1).strokeRect(box.x, box.y, box.w, box.h);
        this.hintBox = box;
        blocked.push(box);
      }
    }
    if (this.pendingOrder) { keep.add("pending"); const t = this.text("pending", W / 2, screen.h - 22, this.pendingOrder.kind === "cover" ? "Tap where they should cover" : "Tap where they go on the signal", { align: 0.5, color: PAL.shared.chalk }); this.panelBehind(t); cover(t, 3); }
    if (this.grenadeArmed) { keep.add("armed"); const t = this.text("armed", W / 2, screen.h - 22, "Tap where to throw", { align: 0.5, color: PAL.shared.chalk }); this.panelBehind(t); cover(t, 3); }
    this.drawArrows(blocked);
    this.hideTextsExcept(keep);
  }

  /** A chalk arrow on the screen's inner edge for each job and place the phase asks of you
   *  that is off the screen (Tom, 2026-09-28: "dont reealy know where is it"). */
  private drawArrows(blocked: Box[]) {
    const cam = this.g.cameras.main;
    // the map view shows the whole zone
    if (cam.zoom !== screen.s) return;
    // the street's view in world art px: the camera zooms about its centre
    const vw = cam.width / cam.zoom, vh = cam.height / cam.zoom;
    const left = cam.scrollX + (cam.width - vw) / 2, top = cam.scrollY + (cam.height - vh) / 2;
    const marks = this.g.marksOf().map((m) => ({ key: m.key, x: sx(m.x) - left, y: sy(m.y) - top }));
    for (const { x, y, angle } of placeArrows(marks, screen.w, screen.h, this.safe, blocked)) {
      const m = arrowMask(angle);
      this.gfx.fillStyle(hex(PAL.shared.outline), 1);
      for (const [dx, dy] of m.edge) this.gfx.fillRect(x + dx, y + dy, 1, 1);
      this.gfx.fillStyle(hex(PAL.shared.chalk), 1);
      for (const [dx, dy] of m.fill) this.gfx.fillRect(x + dx, y + dy, 1, 1);
    }
  }

  private drawButton(b: Btn, keep: Set<string>) {
    const sim = this.g.run.sim;
    const s = sim.state;
    const pressed = [...this.gestures.values()].some((q) => q.btn === b) || (b.kind === "grenade" && this.grenadeArmed) || (b.kind === "fire" && this.fireHeld);
    let art: HudImage | null = null;
    switch (b.kind) {
      case "squad": { const sq = s.squads[b.index]; if (sq) art = this.art.squadTag(sim, sq, s.controlled === b.index); break; }
      case "chip": { const u = this.members()[b.index]; if (u) art = this.art.chip(u, s.picked === u.id); break; }
      case "order": art = this.art.button(b.order!, pressed); break;
      case "pause": art = this.art.button(s.paused ? "play" : "pause", pressed); break;
      case "grenade": {
        // the petrol bottle's icon when only bottles are left; the badge counts both
        const ok = this.members().filter((u) => u.state === "ok");
        const g = ok.reduce((a, u) => a + u.grenades, 0), bt = ok.reduce((a, u) => a + u.bottles, 0);
        art = this.art.button(g === 0 && bt > 0 ? "bottle" : "grenade", pressed, g + bt);
        break;
      }
      default: art = this.art.button(b.kind, pressed);
    }
    let img = this.images.get(b.key);
    if (!art) { img?.setVisible(false); return; }
    if (!img) { img = this.add.image(0, 0, art.key).setOrigin(0).setDepth(12); this.images.set(b.key, img); }
    img.setTexture(art.key).setPosition(b.x, b.y).setVisible(true);
    art.labels.forEach((l, i) => {
      const key = `${b.key}:${i}`;
      keep.add(key);
      const font = l.size === "pxs" ? PXS : l.size === "pxb" ? PXB : PX;
      const line = l.max === undefined ? l.text : fitLine(l.text, l.max, font);
      this.text(key, b.x + l.x, b.y + l.y, line, { font, color: l.colour, align: l.align === "center" ? 0.5 : 0, shadow: l.shadow });
    });
  }
}
