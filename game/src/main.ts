import Phaser from "phaser";
import { computeView } from "./render/view";
import { BootScene } from "./render/BootScene";

const parent = document.getElementById("game")!;
const v0 = computeView(window.innerWidth, window.innerHeight);

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
  scene: [BootScene],
});

let pending = 0;
function relayout() {
  cancelAnimationFrame(pending);
  pending = requestAnimationFrame(() => {
    const v = computeView(window.innerWidth, window.innerHeight);
    game.scale.resize(v.w, v.h);
    game.scale.setZoom(v.zoom);
    game.events.emit("relayout", v);
  });
}
window.addEventListener("resize", relayout);
window.addEventListener("orientationchange", relayout);

// Debug handle for the headless playtest harness (tools/shot.mjs). Harmless in play.
(window as unknown as { __ms: unknown }).__ms = { game, ready: false };
