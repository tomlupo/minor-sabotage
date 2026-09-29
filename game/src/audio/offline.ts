// Offline rendering for the audio lab's report: the very same graphs the engine builds
// (startSfx, startLoop, CuePlayer, Ambience, buildMaster), rendered faster than real time into
// a 4-channel buffer: channels 0-1 are the master output, 2-3 the sum before the limiter.
//
// Music and ambience are scheduled the way the engine schedules them, a quarter of a second
// ahead in slices (the render suspends every 0.1 s to let the next slice in), so a render's
// speed is a fair measure of what the live graph costs.
import { Ambience, type AmbEvent, playAmbEvent } from "./ambience";
import { type Kit, makeKit, mulberry } from "./kit";
import { startLoop } from "./loops";
import { DEFAULT_MUSIC, DEFAULT_SFX, type Master, buildMaster } from "./master";
import { CuePlayer, getCue } from "./sequencer";
import { SFX, startSfx } from "./sfx";
import type { Loop, LoopOpts, Music, PlayOpts, Sfx } from "./types";

export const OFFLINE_RATE = 44100;

export interface Rendered {
  post: Float32Array[];
  pre: Float32Array[];
  sr: number;
}

/** Like the engine's scheduler: how far ahead, and how often. */
const AHEAD = 0.25;
const SLICE = 0.1;

/** `build` sets the graph up; if it returns a tick, the tick is called every SLICE with the render's time. */
export async function renderWith(seconds: number, seed: number, build: (k: Kit, m: Master) => ((now: number) => void) | void): Promise<Rendered> {
  const sr = OFFLINE_RATE;
  const ctx = new OfflineAudioContext(4, Math.max(128, Math.ceil(seconds * sr)), sr);
  const k = makeKit(ctx, mulberry(seed));
  const merger = ctx.createChannelMerger(4);
  merger.connect(ctx.destination);
  const post = ctx.createChannelSplitter(2);
  post.connect(merger, 0, 0);
  post.connect(merger, 1, 1);
  const pre = ctx.createChannelSplitter(2);
  pre.connect(merger, 0, 2);
  pre.connect(merger, 1, 3);
  const m = buildMaster(k, post);
  m.sum.connect(pre);
  m.music.gain.value = DEFAULT_MUSIC;
  m.sfx.gain.value = DEFAULT_SFX;
  const tick = build(k, m);
  if (tick) {
    tick(0);
    for (let t = SLICE; t < seconds; t += SLICE) {
      const at = t;
      ctx.suspend(at).then(() => {
        tick(at);
        return ctx.resume();
      });
    }
  }
  const b = await ctx.startRendering();
  return { post: [b.getChannelData(0), b.getChannelData(1)], pre: [b.getChannelData(2), b.getChannelData(3)], sr };
}

export function renderSfx(name: Sfx, seed = 1, o: PlayOpts = {}): Promise<Rendered> {
  return renderWith(SFX[name].len + 0.15, seed, (k, m) => {
    startSfx(k, m.sfx, name, 0.02, o, 0, 0);
  });
}

export function renderLoop(l: Loop, seconds: number, o: LoopOpts = {}, seed = 2): Promise<Rendered> {
  return renderWith(seconds, seed, (k, m) => {
    startLoop(k, m.sfx, l, 0.02, o, 0, 0);
  });
}

export function renderMusic(cue: Music, seconds: number, intensity = 0, seed = 3): Promise<Rendered> {
  return renderWith(seconds, seed, (k, m) => {
    const p = new CuePlayer(k, getCue(cue), m.musicIn, m.verb, 0.05, intensity);
    return (now) => p.schedule(now, now + AHEAD);
  });
}

export function renderAmbience(seconds: number, seed = 4): Promise<Rendered> {
  return renderWith(seconds, seed, (k, m) => {
    const a = new Ambience(k, m.amb, 0);
    return (now) => a.schedule(now + AHEAD);
  });
}

export function renderAmbEvent(e: AmbEvent, seconds: number, seed = 5): Promise<Rendered> {
  return renderWith(seconds, seed, (k, m) => {
    playAmbEvent(k, m.amb, e, 0.05, 0);
  });
}

/** A busy moment: the action cue at full intensity under a firefight, to check the limiter. */
export function renderMix(seconds: number, seed = 6): Promise<Rendered> {
  return renderWith(seconds, seed, (k, m) => {
    const p = new CuePlayer(k, getCue("action"), m.musicIn, m.verb, 0.05, 1);
    const a = new Ambience(k, m.amb, 0);
    startLoop(k, m.sfx, "truck_engine", 0.05, { rate: 1.5, x: 8, y: 2 }, 0, 0);
    // bursts the way the sim fires them: one call per round at the weapon's cadence
    const burst = (t: number, s: Sfx, n: number, gap: number, o: PlayOpts): [number, Sfx, PlayOpts][] =>
      Array.from({ length: n }, (_, i) => [t + i * gap, s, o] as [number, Sfx, PlayOpts]);
    const at: [number, Sfx, PlayOpts][] = [
      [0.3, "whistle", { x: -12, y: 4 }],
      [0.9, "shout", { x: -10, y: 3 }],
      ...burst(1.2, "sten", 4, 0.085, { x: -2, y: 1 }),
      ...burst(1.25, "sten", 4, 0.085, { x: 3, y: -1 }),
      ...burst(1.4, "mp40", 3, 0.11, { x: -14, y: 5 }),
      [1.6, "rifle", { x: 18, y: 6 }],
      [1.9, "explosion", { x: 4, y: 3 }],
      [2.0, "glass", { x: 6, y: 2 }],
      ...burst(2.3, "sten", 4, 0.085, { x: -1, y: 0 }),
      [2.4, "hit", { x: -13, y: 5 }],
      [2.6, "body_fall", { x: -13, y: 5 }],
      [3.0, "bottle_smash", { x: 7, y: 2 }],
      [3.4, "pistol", { x: 1, y: 1 }],
      [3.6, "explosion", { x: -2, y: 0 }],
      ...burst(3.7, "sten", 4, 0.085, { x: 0, y: 0 }),
      [4.2, "ricochet", { x: 5, y: 2 }],
    ];
    return (now) => {
      p.schedule(now, now + AHEAD);
      a.schedule(now + AHEAD);
      for (const [t, s, o] of at) if (t >= now && t < now + SLICE) startSfx(k, m.sfx, s, t, o, 0, 0);
    };
  });
}
