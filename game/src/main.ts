import Phaser from "phaser";
import { computeView } from "./render/view";
import { GameScene } from "./render/GameScene";
import { HudScene } from "./ui/HudScene";
import { Flow, fakeResults } from "./game/flow";

const parent = document.getElementById("game")!;
const v0 = computeView(window.innerWidth, window.innerHeight);

class Boot extends Phaser.Scene {
  constructor() { super("boot"); }
  create() {
    const q = new URLSearchParams(location.search);
    const flow = new Flow(this.game);
    (window as unknown as { __ms: Record<string, unknown> }).__ms.flow = flow;
    const phase = q.get("phase");
    if (q.get("tasks") !== null) fakeResults(flow.campaign, q.get("tasks")!);
    if (phase) flow.play(phase);
    else flow.play("signal");
    (window as unknown as { __ms: { ready: boolean } }).__ms.ready = true;
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
  scene: [Boot, GameScene, HudScene],
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

// Debug handle for the headless playtest harness (tools/shot.mjs).
(window as unknown as { __ms: unknown }).__ms = { game, ready: false };
