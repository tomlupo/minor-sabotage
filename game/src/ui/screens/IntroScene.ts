// Before the briefing: why the operation, in a few sourced lines (docs/research/arsenal.md,
// timeline). Typed out a line at a time; a tap shows everything, a second tap goes on.
import Phaser from "phaser";
import type { Flow } from "../../game/flow";
import { PAL, hex } from "../../art/palette";
import { txt, setFace, PX, PXS, PXB } from "../text";
import { readSafeInsets } from "../../render/view";
import { screen, fitCamera } from "../../render/screen";
import { sound } from "../../render/sound";

const LINES: [string, string][] = [
  ["Tuesday, 23 March 1943, 4:30 a.m.", 'The Gestapo arrest Jan Bytnar, "Rudy", at his home. In the days that follow he is interrogated and beaten at their headquarters on Szucha Avenue.'],
  ["Friday, 26 March, 13:45.", '"Lola" brings word: Rudy is at Szucha again today. At about five he will be driven back to Pawiak prison in a van.'],
  ["The Grey Ranks decide.", "Their Storm Groups will stop the van at the Arsenal, where Bielańska, Długa and Nalewki meet, and take him back."],
];

export class IntroScene extends Phaser.Scene {
  flow!: Flow;
  private shown = 0;
  private chars = 0;
  private t = 0;
  private objs: Phaser.GameObjects.Text[] = [];
  private done = false;

  constructor() {
    super("intro");
  }
  init(data: { flow: Flow }) {
    this.flow = data.flow;
    this.shown = 0;
    this.chars = 0;
    this.t = 0;
    this.done = false;
  }

  create() {
    fitCamera(this);
    setFace(this, "type");
    this.cameras.main.setBackgroundColor(hex(PAL.hud.paper[0]));
    const W = screen.w, H = screen.h;
    const S = readSafeInsets(screen.zoom);
    const L = S.left + 22, wrap = Math.min(W - L - S.right - 22, 440);
    let y = S.top + 18;
    this.objs = [];
    for (const [head, body] of LINES) {
      const a = txt(this, L, y, "", { font: PXS, color: PAL.city_1943.brick[0] });
      const b = txt(this, L, y + 10, "", { font: PX, color: PAL.hud.paper_ink, wrap, lineGap: 1 });
      a.setData("full", head.toLocaleUpperCase("pl"));
      b.setData("full", b.text); // set below
      b.setData("wrapped", this.wrapFor(body, wrap));
      this.objs.push(a, b);
      y += 16 + Math.ceil(this.wrapFor(body, wrap).split("\n").length) * 11 + 12;
    }
    txt(this, W - S.right - 16, H - S.bottom - 18, "tap", { font: PXS, color: PAL.hud.paper_ink, align: 1 }).setAlpha(0.6);
    this.input.on("pointerup", () => {
      sound.unlock();
      if (!this.done) { this.finish(); return; }
      sound.ui("ui_ok");
      this.flow.toBriefing();
    });
    sound.music("briefing");
  }

  private wrapFor(text: string, w: number): string {
    // the same wrapping the text helper does, done once so typing does not reflow
    const t = txt(this, -9999, -9999, text, { font: PX, wrap: w });
    const s = t.text;
    t.destroy();
    return s;
  }

  private finish() {
    this.done = true;
    for (const o of this.objs) o.setText(o.getData("wrapped") ?? o.getData("full"));
  }

  override update(_t: number, delta: number) {
    if (this.done) return;
    this.t += delta / 1000;
    const o = this.objs[this.shown];
    if (!o) { this.done = true; return; }
    const full: string = o.getData("wrapped") ?? o.getData("full");
    // headings appear at once; the text types at about 40 characters a second
    const want = o.getData("wrapped") ? Math.floor(this.t * 40) : full.length;
    if (want > this.chars) {
      this.chars = Math.min(full.length, want);
      o.setText(full.slice(0, this.chars));
      if (this.chars % 3 === 0 && full[this.chars - 1] !== " ") sound.ui("typewriter");
    }
    if (this.chars >= full.length) {
      this.shown++;
      this.chars = 0;
      this.t = o.getData("wrapped") ? -0.6 : 0;
    }
  }
}

export { PXB };
