// The title: the street at dusk behind the name, the minor-sabotage turtle, and a way in.
// A bookmark left by a locked phone offers its one resume here.
import Phaser from "phaser";
import type { Flow } from "../../game/flow";
import { mapData, simForMap } from "../../game/flow";
import type { Sim } from "../../sim/sim";
import { WorldView } from "../../render/world";
import { allLooks } from "../../content/arsenal/roster";
import { PAL, hex, lightHex } from "../../art/palette";
import { toCanvas } from "../../art/pixel";
import { buildLogo, buildTurtle } from "../../art/hud";
import { txt, PX, PXS } from "../text";
import { sx, sy } from "../../render/iso";
import { readSafeInsets } from "../../render/view";
import { screen, fitCamera } from "../../render/screen";
import { sound } from "../../render/sound";
import { store, type Bookmark } from "../../game/store";

export class TitleScene extends Phaser.Scene {
  flow!: Flow;
  private t = 0;
  private sim!: Sim;
  private world!: WorldView;
  private bookmark: Bookmark | null = null;
  private hasSave = false;
  /** The map's extent in art px, which the drift stays inside. */
  private mapW = 0;
  private mapH = 0;

  constructor() {
    super("title");
  }
  init(data: { flow: Flow }) {
    this.flow = data.flow;
  }

  async create() {
    // the menu is fixed to the screen from its top-left, so the drift below scrolls by hand
    fitCamera(this);
    const md = mapData();
    this.sim = simForMap(md, 1);
    this.world = new WorldView(this, md, allLooks());
    this.mapW = sx(md.w);
    this.mapH = sy(md.h);
    // the street at dusk (style guide §5: the ambient multiplies the finished frame), then soot
    this.add.rectangle(0, 0, screen.w, screen.h, lightHex(PAL.light.ambient.dusk))
      .setOrigin(0).setScrollFactor(0).setDepth(3e6).setBlendMode(Phaser.BlendModes.MULTIPLY);
    this.add.rectangle(0, 0, screen.w, screen.h, hex(PAL.city_1943.soot[0]), 0.45).setOrigin(0).setScrollFactor(0).setDepth(3e6 + 1);
    this.bookmark = await store.takeBookmark();
    const saved = await store.loadCampaign();
    this.hasSave = !!saved && saved.stage !== "note";
    this.drawUi();
    sound.music("title");
  }

  private drawUi() {
    const W = screen.w, H = screen.h;
    const S = readSafeInsets(screen.zoom);
    const cx = W / 2;
    const d = 3e6 + 10;
    let y = S.top + 18;
    if (!this.textures.exists("logo")) this.textures.addCanvas("logo", toCanvas(buildLogo()));
    const logo = this.textures.getFrame("logo");
    this.add.image(Math.round(cx - logo.width / 2), y, "logo").setOrigin(0).setScrollFactor(0).setDepth(d);
    y += logo.height + 6;
    if (!this.textures.exists("turtle")) this.textures.addCanvas("turtle", toCanvas(buildTurtle(28)));
    this.add.image(W - S.right - 20, H - S.bottom - 16, "turtle").setOrigin(1, 1).setScrollFactor(0).setDepth(d).setAlpha(0.9);
    txt(this, W - S.right - 20, H - S.bottom - 12, "PRACUJ POWOLI", { font: PXS, color: PAL.shared.chalk, align: 1 }).setScrollFactor(0).setDepth(d);
    txt(this, cx, y + 4, "Warsaw, 26 March 1943", { font: PX, color: PAL.shared.chalk, align: 0.5 }).setScrollFactor(0).setDepth(d);
    txt(this, cx, y + 16, "The demo: Akcja pod Arsenałem", { font: PXS, color: PAL.hud.paper[1], align: 0.5 }).setScrollFactor(0).setDepth(d);

    const buttons: [string, () => void][] = [];
    if (this.bookmark) buttons.push([`RESUME ${this.bookmark.phase.toUpperCase()} (ONCE)`, () => this.flow.resume(this.bookmark!)]);
    // with a bookmark the phase goes on from it, once; without, the phase it left is settled
    if (this.hasSave && !this.bookmark) buttons.push(["CONTINUE THE OPERATION", () => void this.flow.continueSaved()]);
    buttons.push([this.hasSave ? "NEW OPERATION" : "BEGIN", () => this.flow.newOperation()]);
    let by = H * 0.56;
    for (const [label, act] of buttons) {
      const bw = 200;
      const b = this.add.rectangle(cx - bw / 2, by, bw, 26, hex(PAL.hud.button_olive[1])).setOrigin(0).setScrollFactor(0).setDepth(d).setStrokeStyle(1, hex(PAL.hud.button_rim));
      txt(this, cx, by + 8, label, { color: PAL.hud.button_ink, align: 0.5 }).setScrollFactor(0).setDepth(d + 1);
      b.setInteractive({ useHandCursor: true }).on("pointerup", () => { sound.unlock(); sound.ui("ui_go"); act(); });
      by += 32;
    }
    txt(this, S.left + 10, H - S.bottom - 22, "A game about the Polish underground. The people are real;", { font: PXS, color: PAL.hud.paper[1] }).setScrollFactor(0).setDepth(d);
    txt(this, S.left + 10, H - S.bottom - 14, "the note at the end tells what really happened.", { font: PXS, color: PAL.hud.paper[1] }).setScrollFactor(0).setDepth(d);
    txt(this, S.left + 10, S.top + 6, "Inspired by Cannon Fodder and Commandos", { font: PXS, color: PAL.hud.paper[0] }).setScrollFactor(0).setDepth(d);
  }

  override update(_t: number, delta: number) {
    this.t += delta / 1000;
    const cam = this.cameras.main;
    // a slow drift along Długa towards the Arsenal
    const x = 200 - ((this.t * 2.2) % 150);
    const left = Math.round(sx(x)) - Math.round(screen.w / 2), top = Math.round(sy(74)) - Math.round(screen.h / 2);
    cam.setScroll(Math.max(0, Math.min(left, this.mapW - screen.w)), Math.max(0, Math.min(top, this.mapH - screen.h)));
    this.world.update(this.sim, delta / 1000);
  }
}
