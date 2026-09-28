// The briefing (style guide §9): a city plan on paper, three task cards, and the squad tags
// you put on them. Between tasks it shows what each left behind for the finale.
import Phaser from "phaser";
import type { Flow } from "../../game/flow";
import { mapData } from "../../game/flow";
import { TASKS, tasksLeft, fit, type TaskId } from "../../missions/campaign";
import { SQUADS } from "../../content/arsenal/roster";
import { PAL, SQUAD_COLOURS, hex, mix } from "../../art/palette";
import { toCanvas } from "../../art/pixel";
import { drawPlan } from "../plan";
import { registerFonts, txt, PX, PXS, PXB } from "../text";
import { readSafeInsets } from "../../render/view";
import { sound } from "../../render/sound";

const INFO: Record<TaskId, { letter: string; title: string; place: string; job: string; helps?: string; at: [number, number] }> = {
  signal: { letter: "A", title: "Sygnalizacja", place: "Bielańska", job: "Set three posts to signal the van: the telephone, Tłomackie, the Bank Polski.", helps: "Scouts know the street.", at: [131, 138] },
  ghetto: { letter: "B", title: "Getto", place: "Długa at Przejazd", job: "Cut the telephone of the police post at the ghetto wall; cover Długa west.", at: [28, 58] },
  oldtown: { letter: "C", title: "Stare Miasto", place: "Długa, to the Old Town", job: "Silence the Arbeitsamt's gate; disable the Wehrmacht truck before it leaves.", at: [196, 80] },
};

/** A task that went partly: ochre ink, between the green of done and the red of failed
 *  (select_gold is only for your selection, style guide §3). */
const PARTIAL = PAL.city_1943.plaster_ochre[0];

export class BriefingScene extends Phaser.Scene {
  flow!: Flow;
  private sel: TaskId = "signal";
  private layer!: Phaser.GameObjects.Container;

  constructor() {
    super("briefing");
  }

  init(data: { flow: Flow }) {
    this.flow = data.flow;
    const left = tasksLeft(this.flow.campaign);
    this.sel = left[0] ?? "signal";
  }

  create() {
    registerFonts(this);
    this.cameras.main.setBackgroundColor(hex(PAL.city_1943.soot[0]));
    this.draw();
    this.scale.on("resize", this.draw, this);
    this.events.once("shutdown", () => this.scale.off("resize", this.draw, this));
    sound.music("briefing");
    this.flow.campaign.stage = "tasks";
  }

  private draw() {
    this.layer?.destroy();
    this.children.removeAll(true);
    this.layer = this.add.container(0, 0);
    const c = this.flow.campaign;
    const W = this.scale.width, H = this.scale.height;
    const S = readSafeInsets(1.5);
    const L = S.left + 6, R = W - S.right - 6, T = S.top + 6, B = H - S.bottom - 6;
    const planW = Math.min(310, Math.floor((R - L) * 0.55)), planH = B - T;
    const md = mapData();
    const plan = drawPlan(md, planW, planH);
    const key = `plan:${planW}x${planH}`;
    if (!this.textures.exists(key)) this.textures.addCanvas(key, toCanvas(plan.image));
    this.add.image(L, T, key).setOrigin(0);
    this.add.rectangle(L + 3, T + 3, planW - 6, 26, hex(PAL.hud.paper[1])).setOrigin(0);
    txt(this, L + 6, T + 5, "AKCJA POD ARSENAŁEM", { font: PXB, color: PAL.hud.paper_ink });
    txt(this, L + 6, T + 19, "Warsaw, 26 March 1943. The van leaves Szucha about five.", { font: PXS, color: PAL.hud.paper_ink });

    // task pins on the plan
    for (const t of TASKS) {
      const info = INFO[t];
      const res = c.results[t];
      const x = plan.sx(info.at[0]) + L, y = plan.sy(info.at[1]) + T;
      const col = res ? (res.outcome === "success" ? PAL.hud.hp_ok : res.outcome === "partial" ? PARTIAL : PAL.hud.hp_low) : PAL.hud.paper_ink;
      const ring = this.add.circle(x, y, 8, hex(PAL.hud.paper[1])).setStrokeStyle(t === this.sel ? 2 : 1, hex(t === this.sel ? PAL.shared.select_gold : col));
      ring.setInteractive({ useHandCursor: true }).on("pointerup", () => { this.sel = t; sound.ui("ui_tap"); this.draw(); });
      txt(this, x, y - 4, info.letter, { color: col, align: 0.5 });
    }
    const fx = plan.sx(104) + L, fy = plan.sy(77) + T;
    txt(this, fx + 5, fy + 3, "the van", { font: PXS, color: PAL.shared.poppy_red });

    // task cards
    const cx = L + planW + 8, cw = R - cx;
    const cardH = Math.floor((B - T - 64) / 3) - 3;
    TASKS.forEach((t, k) => {
      const info = INFO[t];
      const y = T + k * (cardH + 3);
      const res = c.results[t];
      const selected = t === this.sel;
      const sqi = c.assign[t];
      const card = this.add.rectangle(cx, y, cw, cardH, hex(PAL.hud.paper[1])).setOrigin(0).setStrokeStyle(selected ? 2 : 1, hex(selected ? PAL.shared.select_gold : PAL.hud.paper_ink));
      card.setInteractive({ useHandCursor: true }).on("pointerup", () => { if (!res) { this.sel = t; sound.ui("ui_tap"); this.draw(); } });
      this.add.rectangle(cx + 1, y + 1, 5, cardH - 2, hex(SQUAD_COLOURS[SQUADS[sqi].colour])).setOrigin(0);
      txt(this, cx + 10, y + 3, `${info.letter}. ${info.title}`, { color: PAL.hud.paper_ink });
      txt(this, cx + cw - 4, y + 3, SQUADS[sqi].name, { color: PAL.hud.paper_ink, align: 1, font: PXS });
      if (res) {
        const word = res.outcome === "success" ? "DONE" : res.outcome === "partial" ? "PART DONE" : "FAILED";
        const col = res.outcome === "success" ? PAL.hud.hp_ok : res.outcome === "partial" ? PARTIAL : PAL.hud.hp_low;
        txt(this, cx + 10, y + 14, `${word}${res.silent ? ", quietly" : ", the alarm went up"}`, { font: PXS, color: col });
        txt(this, cx + 10, y + 24, this.effect(t), { font: PX, color: PAL.hud.paper_ink, wrap: cw - 16 });
      } else {
        txt(this, cx + 10, y + 14, info.job, { font: PX, color: PAL.hud.paper_ink, wrap: cw - 16 });
        if (info.helps) txt(this, cx + 10, y + cardH - 9, info.helps, { font: PXS, color: mix(PAL.hud.paper_ink, PAL.hud.paper[0], 0.4) });
      }
    });

    // squad tags: tap one to put it on the selected task
    const ty = B - 28;
    SQUADS.forEach((sq, i) => {
      const x = cx + i * Math.floor(cw / 3);
      const alive = fit(c, i).length;
      const used = TASKS.find((t) => c.assign[t] === i)!;
      const done = !!c.results[used];
      const r = this.add.rectangle(x, ty, Math.floor(cw / 3) - 4, 26, hex(SQUAD_COLOURS[sq.colour])).setOrigin(0).setStrokeStyle(1, hex(PAL.shared.outline));
      txt(this, x + 4, ty + 3, sq.name.toUpperCase(), { font: PX, color: PAL.shared.outline });
      txt(this, x + 4, ty + 15, `${alive}/${sq.people.length} fit`, { font: PXS, color: PAL.shared.outline });
      if (!done && !c.results[this.sel]) {
        r.setInteractive({ useHandCursor: true }).on("pointerup", () => this.assign(i));
      }
    });

    // the go button
    const allDone = tasksLeft(c).length === 0;
    const label = allDone ? "TO THE ARSENAL" : `GO: ${INFO[this.sel].title.toUpperCase()}`;
    const bw = Math.min(cw, 150), bx = R - bw;
    const go = this.add.rectangle(bx, B - 58 - 2, bw, 28, hex(PAL.hud.button_olive[1])).setOrigin(0).setStrokeStyle(1, hex(PAL.hud.button_rim));
    txt(this, bx + bw / 2, B - 58 + 7, label, { align: 0.5, color: PAL.hud.button_ink });
    go.setInteractive({ useHandCursor: true }).on("pointerup", () => {
      sound.unlock();
      sound.ui("ui_go");
      if (allDone) this.flow.toFinale();
      else if (!c.results[this.sel] && fit(c, c.assign[this.sel]).length) this.flow.play(this.sel);
    });
    if (!allDone && !fit(c, c.assign[this.sel]).length) txt(this, cx, B - 70, "That squad has nobody left: give the task to another.", { font: PXS, color: PAL.hud.hp_low });
  }

  private effect(t: TaskId): string {
    const r = this.flow.campaign.results[t]!;
    if (t === "signal") return r.flags.signal ? "The finale has the go-code: you choose when." : "No signal: the van will come unannounced.";
    if (t === "ghetto") return r.flags.postSilenced ? "The wall post is silenced: the west stays empty." : r.flags.lineCut ? "The line is cut: the wall police will be slow." : "The wall police will come quickly.";
    return r.flags.gateSilenced && r.flags.truckDisabled ? "The way east is open for the escape." : r.flags.truckDisabled ? "The Arbeitsamt is still manned." : "A truck will block Plac Krasińskich.";
  }

  private assign(i: number) {
    const c = this.flow.campaign;
    const prev = c.assign[this.sel];
    if (prev === i) return;
    const other = TASKS.find((t) => c.assign[t] === i)!;
    if (c.results[other]) return;
    c.assign[other] = prev;
    c.assign[this.sel] = i;
    sound.ui("ui_ok");
    this.draw();
  }
}
