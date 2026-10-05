// Minor Sabotage's audio: every sound synthesised with the Web Audio API, no recordings.
//
//   import { audio } from "./audio";
//   pointerup → audio.unlock()            (the first gesture; iOS needs it)
//   audio.music("title"); audio.ambience(true);
//   audio.setListener(camX, camY);        (world metres)
//   audio.play("sten", { x, y });         (one round per call; { rounds: 4 } plays a burst)
//   audio.loop("truck_engine", "truck", { x, y, rate }); audio.loop("truck_engine", "truck", null);
//   audio.intensity(alarm);               (0..1; the music layers and leans forward)
//
// Safe to import anywhere, Node included: nothing touches the browser until unlock().
import { Engine } from "./engine";
import type { Audio } from "./types";

export type { Audio, Loop, LoopOpts, Music, PlayOpts, Sfx } from "./types";
export { LOOP_LIST, MUSIC_LIST, SFX_LIST } from "./types";
export { Engine } from "./engine";

export const audio: Audio = new Engine();
