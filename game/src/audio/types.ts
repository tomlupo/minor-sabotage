// The public vocabulary of the audio layer: every sound effect, loop and music cue the game
// can ask for. The lists are the single source; the union types derive from them, so a name
// added here without a recipe fails to compile (the tables are Record<Sfx, ...>).

export const SFX_LIST = [
  "sten", "pistol", "rifle", "mp40",
  "grenade_throw", "explosion", "explosion_far",
  "bottle_throw", "bottle_smash", "fire_whoosh",
  "knife", "body_fall", "hit", "ricochet", "glass",
  "step",
  "whistle",
  "shout",
  "truck_brake", "car_door", "truck_doors", "car_start",
  "tram_bell", "pigeons",
  "ui_tap", "ui_ok", "ui_back", "ui_pause", "ui_go", "ui_alert",
  "typewriter", "paper",
  "promotion", "fallen", "mission_done",
] as const;
export type Sfx = (typeof SFX_LIST)[number];

export const LOOP_LIST = ["truck_engine", "car_engine", "fire", "crowd_panic"] as const;
export type Loop = (typeof LOOP_LIST)[number];

export const MUSIC_LIST = ["title", "briefing", "stealth", "action", "finale", "note", "fallen"] as const;
export type Music = (typeof MUSIC_LIST)[number];

export interface PlayOpts {
  /** World metres. With both x and y the sound is positional: panned by dx, quieter and duller with distance, silent beyond ~70 m. */
  x?: number;
  y?: number;
  /** Linear gain, default 1. */
  gain?: number;
  /** Pitch and speed factor, default 1. */
  rate?: number;
  /**
   * Guns only: rounds in this call, default 1 (the sim emits a shot event per round). A burst
   * in one call (rounds: 4) is cheaper than four calls: one graph, retriggered.
   */
  rounds?: number;
}

export interface LoopOpts {
  x?: number;
  y?: number;
  gain?: number;
  /** Engines: rpm factor (1 idle, about 2.5 driving hard). Fire: its size. Crowd: how frantic. */
  rate?: number;
}

export interface Audio {
  /** Call from the first user gesture (iOS needs it). Safe to call on every gesture. */
  unlock(): void;
  setMuted(m: boolean): void;
  setVolumes(music: number, sfx: number): void;
  /** World metres (the camera centre). */
  setListener(x: number, y: number): void;
  /** Positional when x and y are given: pan by dx, attenuate by distance (inaudible beyond ~70 m). */
  play(s: Sfx, o?: PlayOpts): void;
  /** Start or update the loop called `id`; null stops it. */
  loop(l: Loop, id: string, o?: LoopOpts | null): void;
  /** Crossfade to a cue (null fades out). Asking for the cue already playing changes nothing. */
  music(m: Music | null, fade?: number): void;
  /** 0..1, raised by the game on alarm; the music fades layers in and leans the tempo forward. */
  intensity(v: number): void;
  /** Warsaw afternoon: wind, distant traffic, a far tram, a dog, a cart, sparrows, church bells rarely. */
  ambience(on: boolean): void;
  /** Briefly lower the music by `amount` (0..1) for `seconds` (explosions, pause). duck(0, 0) releases at once. */
  duck(amount: number, seconds: number): void;
}
