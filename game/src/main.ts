import Phaser from "phaser";
import { computeView } from "./render/view";
import { GameScene } from "./render/GameScene";
import { HudScene } from "./ui/HudScene";
import { TitleScene } from "./ui/screens/TitleScene";
import { BriefingScene } from "./ui/screens/BriefingScene";
import { DecisionScene } from "./ui/screens/DecisionScene";
import { NoteScene } from "./ui/screens/NoteScene";
import { IntroScene } from "./ui/screens/IntroScene";
import { Flow, fakeResults } from "./game/flow";
import { registerFonts } from "./ui/text";

const parent = document.getElementById("game")!;
const v0 = computeView(window.innerWidth, window.innerHeight);

// Debug entry points (the headless playtest harness uses them):
//   ?phase=signal|ghetto|oldtown|finale   straight into a phase
//   ?tasks=signal,line,post,gate,truck    pretend the tasks went so (with ?phase=finale)
//   ?screen=briefing|decision|note        straight to a screen
class Boot extends Phaser.Scene {
  constructor() { super("boot"); }
  create() {
    registerFonts(this);
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
    else if (screen) this.game.scene.start(screen, { flow });
    else flow.toTitle();
    ms.ready = true;
  }
}

const game = new Phaser.Game({
  type: Phaser.WEBGL,
  parent,
  backgroundColor: "#24201a",
  pixelArt: true,
  antialias: false,
  roundPixels: true,
  scale: { mode: Phaser.Scale.NONE, width: v0.w, height: v0.h, zoom: v0.zoom },
  input: { activePointers: 3 },
  audio: { noAudio: true },
  disableContextMenu: true,
  banner: false,
  scene: [Boot, TitleScene, IntroScene, BriefingScene, DecisionScene, NoteScene, GameScene, HudScene],
});

let pending = 0;
function relayout() {
  cancelAnimationFrame(pending);
  pending = requestAnimationFrame(() => {
    const v = computeView(window.innerWidth, window.innerHeight);
    game.scale.resize(v.w, v.h);
    game.scale.setZoom(v.zoom);
  });
}
window.addEventListener("resize", relayout);
window.addEventListener("orientationchange", relayout);

(window as unknown as { __ms: unknown }).__ms = { game, ready: false };
