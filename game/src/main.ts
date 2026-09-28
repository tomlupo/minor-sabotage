import Phaser from "phaser";
import { computeView } from "./render/view";
import { setScreen } from "./render/screen";
import { GameScene } from "./render/GameScene";
import { HudScene } from "./ui/HudScene";
import { TitleScene } from "./ui/screens/TitleScene";
import { BriefingScene } from "./ui/screens/BriefingScene";
import { DecisionScene } from "./ui/screens/DecisionScene";
import { NoteScene } from "./ui/screens/NoteScene";
import { IntroScene } from "./ui/screens/IntroScene";
import { CardScene } from "./ui/screens/CardScene";
import { Flow, fakeResults, bootDone } from "./game/flow";
import { loadFonts } from "./ui/fonts";
import { PAL, hex } from "./art/palette";

const parent = document.getElementById("game")!;
const dpr = () => window.devicePixelRatio || 1;
const v0 = computeView(window.innerWidth, window.innerHeight, dpr());
setScreen(v0);

// Debug entry points (the headless playtest harness uses them):
//   ?phase=signal|ghetto|oldtown|finale   straight into a phase
//   ?tasks=signal,line,post,gate,truck    pretend the tasks went so (with ?phase=finale)
//   ?screen=briefing|decision|note        straight to a screen
class Boot extends Phaser.Scene {
  constructor() { super("boot"); }
  create() {
    // both faces are in before any text is measured (a text set in a face still loading keeps
    // the fallback's size)
    void loadFonts().then(() => this.start());
  }

  private start() {
    const q = new URLSearchParams(location.search);
    const flow = new Flow(this.game);
    const ms = (window as unknown as { __ms: Record<string, unknown> }).__ms;
    ms.flow = flow;
    if (q.get("tasks") !== null) fakeResults(flow.campaign, q.get("tasks")!);
    // ?hurt=alek&taken=hubert&dead=buzdygan&rudy=escaped: a campaign with losses (screens)
    const mark = (k: string, st: "wounded" | "captured" | "dead") => { for (const key of (q.get(k) ?? "").split(",").filter(Boolean)) if (flow.campaign.soldiers[key]) flow.campaign.soldiers[key].state = st; };
    mark("hurt", "wounded"); mark("taken", "captured"); mark("dead", "dead");
    if (q.get("rudy")) flow.campaign.finale = { outcome: q.get("rudy") === "escaped" ? "success" : "fail", rudy: q.get("rudy") as "escaped" | "lost" | "killed", freed: 14, prisonersKilled: 3, fallen: (q.get("dead") ?? "").split(",").filter(Boolean), germansKilled: 9, seconds: 400 };
    const phase = q.get("phase");
    const screen = q.get("screen");
    if (phase) flow.play(phase);
    else if (screen) { bootDone(this.game.scene.getScene(screen)); this.game.scene.start(screen, { flow }); }
    else flow.toTitle();
    ms.ready = true;
  }
}

const game = new Phaser.Game({
  type: Phaser.WEBGL,
  parent,
  backgroundColor: hex(PAL.shared.outline),
  pixelArt: true,
  antialias: false,
  roundPixels: true,
  // the canvas at the screen's own resolution, shown at the window's CSS size
  scale: { mode: Phaser.Scale.NONE, width: v0.canvasW, height: v0.canvasH, zoom: 1 / dpr() },
  input: { activePointers: 3 },
  audio: { noAudio: true },
  disableContextMenu: true,
  banner: false,
  scene: [Boot, TitleScene, IntroScene, BriefingScene, DecisionScene, NoteScene, GameScene, HudScene, CardScene],
});

let pending = 0;
function relayout() {
  cancelAnimationFrame(pending);
  pending = requestAnimationFrame(() => {
    const v = computeView(window.innerWidth, window.innerHeight, dpr());
    // the scenes read the new view on the resize event, so it is set first
    setScreen(v);
    game.scale.resize(v.canvasW, v.canvasH);
    game.scale.setZoom(1 / dpr());
  });
}
window.addEventListener("resize", relayout);
window.addEventListener("orientationchange", relayout);
// a window moved to a screen of another density changes the ratio and fires no resize
let density: MediaQueryList | null = null;
function watchDensity() {
  density?.removeEventListener("change", onDensity);
  density = window.matchMedia(`(resolution: ${dpr()}dppx)`);
  density.addEventListener("change", onDensity);
}
function onDensity() {
  relayout();
  watchDensity();
}
watchDensity();

(window as unknown as { __ms: unknown }).__ms = { game, ready: false };
