// Before the finale (decision 2026-09-27): a wounded veteran is evacuated (his squad sits the
// finale out) or fights on (one more hit kills him); a man who was taken is left, or his
// squad goes to get him back (and sits the finale out). The weight is in these choices.
import Phaser from "phaser";
import type { Flow } from "../../game/flow";
import type { Decision } from "../../missions/campaign";
import { SQUADS, PEOPLE } from "../../content/arsenal/roster";
import { PAL, SQUAD_COLOURS, hex } from "../../art/palette";
import { registerFonts, txt, PX, PXS, PXB } from "../text";
import { buildPortraitTexture } from "../../render/artbank";
import { readSafeInsets } from "../../render/view";
import { sound } from "../../render/sound";

export class DecisionScene extends Phaser.Scene {
  flow!: Flow;
  constructor() {
    super("decision");
  }
  init(data: { flow: Flow }) {
    this.flow = data.flow;
  }

  /** The people this screen is about. */
  static cases(flow: Flow): string[] {
    return Object.values(flow.campaign.soldiers).filter((s) => s.state === "wounded" || s.state === "captured").map((s) => s.key);
  }

  create() {
    registerFonts(this);
    this.cameras.main.setBackgroundColor(hex(PAL.hud.paper[0]));
    this.flow.campaign.stage = "decision";
    for (const k of DecisionScene.cases(this.flow)) if (!this.flow.campaign.decisions[k]) this.flow.campaign.decisions[k] = this.flow.campaign.soldiers[k].state === "wounded" ? "fight" : "leave";
    this.draw();
    sound.music("briefing");
  }

  private benched(): number[] {
    const c = this.flow.campaign;
    const out = new Set<number>();
    for (const [k, d] of Object.entries(c.decisions)) {
      if (d !== "evacuate" && d !== "rescue") continue;
      const i = SQUADS.findIndex((s) => s.people.some((p) => p.key === k));
      if (i >= 0) out.add(i);
    }
    return [...out];
  }

  private draw() {
    this.children.removeAll(true);
    const c = this.flow.campaign;
    const W = this.scale.width, H = this.scale.height;
    const S = readSafeInsets(1.5);
    const L = S.left + 12, R = W - S.right - 12, T = S.top + 8, B = H - S.bottom - 8;
    txt(this, L, T, "BEFORE THE ARSENAL", { font: PXB, color: PAL.hud.paper_ink });
    txt(this, L, T + 16, "17:25. The van will be here soon. Who goes, and who does not?", { color: PAL.hud.paper_ink });
    const cases = DecisionScene.cases(this.flow);
    const bench = this.benched();
    cases.forEach((key, k) => {
      const p = PEOPLE[key];
      const st = c.soldiers[key].state;
      const y = T + 34 + k * 46;
      const sqi = SQUADS.findIndex((s) => s.people.some((q) => q.key === key));
      this.add.rectangle(L, y, R - L, 42, hex(PAL.hud.paper[1])).setOrigin(0).setStrokeStyle(1, hex(PAL.hud.paper_ink));
      this.add.rectangle(L + 1, y + 1, 4, 40, hex(SQUAD_COLOURS[SQUADS[sqi].colour])).setOrigin(0);
      const tex = buildPortraitTexture(this, key, p.look, p.look.seed ?? 1);
      this.add.image(L + 8, y + 7, tex).setOrigin(0);
      txt(this, L + 38, y + 5, `${p.pseudonym}, ${p.name}`, { color: PAL.hud.paper_ink });
      txt(this, L + 38, y + 16, st === "wounded" ? `Wounded. ${SQUADS[sqi].name}'s squad.` : `Taken by the Germans. ${SQUADS[sqi].name}'s squad.`, { font: PXS, color: PAL.hud.paper_ink });
      const opts: [Decision, string][] = st === "wounded"
        ? [["evacuate", "Evacuate him (the squad stays out)"], ["fight", "He fights on (one more hit)"]]
        : [["leave", "Leave him"], ["rescue", "Get him back (the squad stays out)"]];
      opts.forEach(([d, label], j) => {
        const bw = Math.floor((R - L - 44) / 2) - 4, bx = L + 38 + j * (bw + 6), by = y + 25;
        const on = c.decisions[key] === d;
        // benching the last squad is not allowed: somebody has to go
        const wouldBench = (d === "evacuate" || d === "rescue") && !bench.includes(sqi) && bench.length + 1 >= SQUADS.filter((_, i) => this.fitCount(i) > 0).length;
        const b = this.add.rectangle(bx, by, bw, 14, hex(on ? PAL.hud.button_olive[1] : PAL.hud.paper[0])).setOrigin(0).setStrokeStyle(1, hex(wouldBench ? PAL.hud.hp_low : PAL.hud.paper_ink));
        txt(this, bx + 4, by + 3, label, { font: PXS, color: on ? PAL.hud.button_ink : PAL.hud.paper_ink });
        if (!wouldBench) b.setInteractive({ useHandCursor: true }).on("pointerup", () => { c.decisions[key] = d; sound.ui("ui_tap"); this.draw(); });
      });
    });
    if (!cases.length) txt(this, L, T + 40, "Everyone is fit. All three squads go.", { color: PAL.hud.paper_ink });
    const out = this.benched();
    const going = SQUADS.map((s, i) => (out.includes(i) || this.fitCount(i) === 0 ? null : s.name)).filter(Boolean);
    txt(this, L, B - 30, `To the Arsenal: ${going.join(", ") || "nobody"}`, { color: PAL.hud.paper_ink });
    const bw = 150;
    const go = this.add.rectangle(R - bw, B - 30, bw, 26, hex(PAL.hud.button_olive[1])).setOrigin(0).setStrokeStyle(1, hex(PAL.hud.button_rim));
    txt(this, R - bw / 2, B - 22, "TO THE ARSENAL", { align: 0.5, color: PAL.hud.button_ink, font: PX });
    go.setInteractive({ useHandCursor: true }).on("pointerup", () => {
      sound.ui("ui_go");
      c.benched = this.benched();
      for (const [k, d] of Object.entries(c.decisions)) {
        if (d === "evacuate") c.soldiers[k].state = "evacuated";
        if (d === "rescue") c.soldiers[k].state = "wounded";
      }
      this.flow.play("finale");
    });
  }

  private fitCount(i: number): number {
    return SQUADS[i].people.filter((p) => {
      const st = this.flow.campaign.soldiers[p.key]?.state;
      return st === "ok" || st === "wounded";
    }).length;
  }
}
