// Between a screen and a phase: the phase's name, place and hour on paper, like a chapter
// title. It is on screen while the phase's art is drawn (a second or two on a phone), so the
// wait reads as a page turning rather than a frozen button; then it fades off the street.
import Phaser from "phaser";
import type { Phase } from "../../missions/types";
import { PAL, hex } from "../../art/palette";
import { registerFonts, txt, PX, PXB } from "../text";

const HOLD = 0.15;
const FADE = 0.35;

export class CardScene extends Phaser.Scene {
  private phase!: Phase;
  private next: (() => void) | null = null;
  private frames = 0;
  private shown = 0;
  private layer!: Phaser.GameObjects.Container;

  constructor() {
    super("card");
  }
  init(data: { phase: Phase; next: () => void }) {
    this.phase = data.phase;
    this.next = data.next;
    this.frames = 0;
    this.shown = 0;
  }

  create() {
    registerFonts(this);
    const W = this.scale.width, H = this.scale.height;
    const bg = this.add.rectangle(0, 0, W, H, hex(PAL.hud.paper[0])).setOrigin(0);
    const title = txt(this, W / 2, H / 2 - 16, this.phase.title, { font: PXB, color: PAL.hud.paper_ink, align: 0.5 });
    const line = txt(this, W / 2, H / 2 + 8, `${this.phase.place}. ${this.phase.time}`, { font: PX, color: PAL.city_1943.brick[0], align: 0.5 });
    this.layer = this.add.container(0, 0, [bg, title, line]);
  }

  override update(_t: number, delta: number) {
    this.frames++;
    // start the phase once the card has been drawn; its first frames come up beneath the card
    if (this.frames === 3 && this.next) {
      const go = this.next;
      this.next = null;
      go();
      return;
    }
    if (this.frames <= 3) return;
    this.scene.bringToTop();
    // the frame after the phase's art is built carries a long delta: the fade starts after it
    this.shown += Math.min(delta, 50) / 1000;
    const a = Math.max(0, 1 - Math.max(0, this.shown - HOLD) / FADE);
    this.layer.setAlpha(a);
    if (a <= 0) this.scene.stop();
  }
}
