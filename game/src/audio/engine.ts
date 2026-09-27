// The live audio engine behind `audio`. Until unlock() runs inside a user gesture there is no
// AudioContext: every call only records what the game wants (music cue, ambience, loops,
// volumes), and unlock() starts that state. In Node (the tests) unlock() finds no window and
// the whole engine stays a quiet no-op.
//
// One setTimeout loop drives everything timed: it schedules music steps and ambience events
// a quarter of a second ahead of the AudioContext clock, so a janky frame on an iPhone never
// makes the music stumble. The loop runs only while music or ambience is on.
//
// No call ever throws into the game: a failure is reported once per kind with console.warn
// and the game carries on without that sound.
import { type AmbEvent, Ambience, playAmbEvent } from "./ambience";
import { type Kit, clamp, makeKit } from "./kit";
import { type LoopHandle, startLoop, stopLoop, updateLoop } from "./loops";
import { DEFAULT_MUSIC, DEFAULT_SFX, type Master, buildMaster } from "./master";
import { CuePlayer, getCue } from "./sequencer";
import { SFX, startSfx } from "./sfx";
import type { Audio, Loop, LoopOpts, Music, PlayOpts, Sfx } from "./types";
import { type VoiceLike, VoicePool } from "./voices";

const LOOKAHEAD = 0.25;
const TICK_MS = 40;
const MAX_VOICES = 24;
const MAX_LOOPS = 8;

interface Voice extends VoiceLike {
  sources: AudioScheduledSourceNode[];
}

type AC = typeof AudioContext;

const num = (v: number, dflt: number) => (Number.isFinite(v) ? v : dflt);

export class Engine implements Audio {
  private ctx: AudioContext | null = null;
  private k: Kit | null = null;
  private m: Master | null = null;
  private pool = new VoicePool<Voice>(MAX_VOICES);
  private loops = new Map<string, LoopHandle>();
  private wantLoops = new Map<string, { l: Loop; o: LoopOpts }>();
  private muted = false;
  private vMusic = DEFAULT_MUSIC;
  private vSfx = DEFAULT_SFX;
  private lx = 0;
  private ly = 0;
  private level = 0;
  private wantMusic: Music | null = null;
  private cur: { name: Music; p: CuePlayer } | null = null;
  private fading: CuePlayer[] = [];
  private amb: Ambience | null = null;
  private wantAmb = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private duckEnd = 0;
  private duckAmt = 0;
  private warned = new Set<string>();
  private analyser: AnalyserNode | null = null;
  private scope: Float32Array<ArrayBuffer> | null = null;

  /** The context state, or "locked" before unlock (for the audio lab). */
  get state(): string {
    return this.ctx ? this.ctx.state : "locked";
  }

  get currentMusic(): Music | null {
    return this.cur?.name ?? null;
  }

  /** Sounding voices and loops (for the audio lab). */
  get busy(): { voices: number; loops: number } {
    return { voices: this.pool.list.length, loops: this.loops.size };
  }

  /** The output's peak over the last ~40 ms, 0 before unlock (for the audio lab's meter). */
  meter(): number {
    const { ctx, m } = this;
    if (!ctx || !m) return 0;
    if (!this.analyser) {
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.scope = new Float32Array(this.analyser.fftSize);
      m.out.connect(this.analyser);
    }
    this.analyser.getFloatTimeDomainData(this.scope!);
    let peak = 0;
    for (const v of this.scope!) peak = Math.max(peak, Math.abs(v));
    return peak;
  }

  /** One ambience event now, whether or not the ambience is on (for the audio lab). */
  ambienceEvent(e: AmbEvent): void {
    this.guard(`ambience ${e}`, () => {
      const { ctx, k, m } = this;
      if (ctx && k && m && ctx.state === "running") playAmbEvent(k, m.amb, e, ctx.currentTime + 0.02);
    });
  }

  unlock(): void {
    this.guard("unlock", () => {
      if (typeof window === "undefined") return;
      if (!this.ctx) this.create();
      if (this.ctx && this.ctx.state !== "running") this.ctx.resume().catch(() => {});
      this.restore();
    });
  }

  setMuted(m: boolean): void {
    this.muted = !!m;
    this.guard("volume", () => this.applyVolumes(0.03));
  }

  setVolumes(music: number, sfx: number): void {
    this.vMusic = clamp(num(music, DEFAULT_MUSIC), 0, 1);
    this.vSfx = clamp(num(sfx, DEFAULT_SFX), 0, 1);
    this.guard("volume", () => this.applyVolumes(0.05));
  }

  setListener(x: number, y: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    this.lx = x;
    this.ly = y;
    this.guard("listener", () => {
      if (!this.ctx) return;
      const now = this.ctx.currentTime;
      for (const h of this.loops.values()) if (h.o.x !== undefined && h.o.y !== undefined) updateLoop(h, h.o, x, y, now);
    });
  }

  play(s: Sfx, o?: PlayOpts): void {
    const { ctx, k, m } = this;
    if (!ctx || !k || !m || ctx.state !== "running") return;
    this.guard(`play ${s}`, () => {
      const def = SFX[s];
      if (!def) return;
      const now = ctx.currentTime;
      if (!this.pool.admit(s, def.prio, def.cap, now)) return;
      const v = startSfx(k, m.sfx, s, now + 0.01, o ?? {}, this.lx, this.ly);
      if (!v) return;
      const voice: Voice = {
        name: s,
        prio: def.prio,
        start: now,
        end: v.end + 0.05,
        sources: v.sources,
        stop(at) {
          v.out.gain.cancelScheduledValues(at);
          v.out.gain.setTargetAtTime(0, at, 0.012);
          for (const src of v.sources) {
            try {
              src.stop(at + 0.08);
            } catch {
              // already stopped
            }
          }
          setTimeout(() => voice.release(), 150);
        },
        release() {
          for (const n of v.chain) n.disconnect();
        },
      };
      this.pool.add(voice);
    });
  }

  loop(l: Loop, id: string, o?: LoopOpts | null): void {
    if (o === null) this.wantLoops.delete(id);
    else this.wantLoops.set(id, { l, o: { ...(o ?? {}) } });
    this.guard(`loop ${l}`, () => {
      const { ctx, k, m } = this;
      if (!ctx || !k || !m) return;
      const now = ctx.currentTime;
      let h = this.loops.get(id);
      if (h && (o === null || h.l !== l)) {
        stopLoop(h, now);
        this.loops.delete(id);
        h = undefined;
      }
      if (o === null) return;
      const opts = { ...(o ?? {}) };
      if (h) updateLoop(h, opts, this.lx, this.ly, now);
      else if (this.loops.size < MAX_LOOPS) this.loops.set(id, startLoop(k, m.sfx, l, now + 0.01, opts, this.lx, this.ly));
    });
  }

  music(mu: Music | null, fade = 1.2): void {
    this.wantMusic = mu;
    this.guard("music", () => {
      const { ctx, k, m } = this;
      if (!ctx || !k || !m) return;
      if (mu && this.cur?.name === mu && !this.cur.p.ended) return;
      const now = ctx.currentTime;
      const f = Math.max(0, num(fade, 1.2));
      if (this.cur) {
        this.cur.p.fadeOut(now, f);
        this.fading.push(this.cur.p);
        this.cur = null;
      }
      if (mu) {
        const p = new CuePlayer(k, getCue(mu), m.musicIn, m.verb, now + 0.06, this.level);
        if (this.fading.length) p.fadeIn(now, Math.min(1, f * 0.5));
        this.cur = { name: mu, p };
      }
      this.kick();
    });
  }

  intensity(v: number): void {
    this.level = clamp(num(v, 0), 0, 1);
    this.guard("intensity", () => {
      if (this.ctx && this.cur) this.cur.p.setIntensity(this.level, this.ctx.currentTime);
    });
  }

  ambience(on: boolean): void {
    this.wantAmb = !!on;
    this.guard("ambience", () => {
      const { ctx, k, m } = this;
      if (!ctx || !k || !m) return;
      if (on && !this.amb) {
        this.amb = new Ambience(k, m.amb, ctx.currentTime + 0.05);
        this.kick();
      } else if (!on && this.amb) {
        this.amb.stop(ctx.currentTime);
        this.amb = null;
      }
    });
  }

  duck(amount: number, seconds: number): void {
    this.guard("duck", () => {
      const { ctx, m } = this;
      if (!ctx || !m) return;
      const now = ctx.currentTime;
      let a = clamp(num(amount, 0), 0, 1);
      const sec = Math.max(0, num(seconds, 0));
      const p = m.duck.gain;
      p.cancelScheduledValues(now);
      if (a <= 0 && sec <= 0) {
        this.duckEnd = 0;
        this.duckAmt = 0;
        p.setTargetAtTime(1, now, 0.15);
        return;
      }
      if (this.duckEnd > now) a = Math.max(a, this.duckAmt);
      this.duckAmt = a;
      this.duckEnd = Math.max(this.duckEnd, now + sec);
      p.setTargetAtTime(1 - a, now, 0.015);
      p.setTargetAtTime(1, this.duckEnd, 0.25);
    });
  }

  // -------------------------------------------------------------------------------------------

  private guard(what: string, fn: () => void): void {
    try {
      fn();
    } catch (e) {
      if (this.warned.has(what)) return;
      this.warned.add(what);
      console.warn(`audio: ${what} failed`, e);
    }
  }

  private create(): void {
    const w = window as unknown as { AudioContext?: AC; webkitAudioContext?: AC };
    const Ctor = w.AudioContext ?? w.webkitAudioContext;
    if (!Ctor) return;
    let ctx: AudioContext;
    try {
      ctx = new Ctor({ latencyHint: "interactive" });
    } catch {
      ctx = new Ctor(); // older Safari takes no options
    }
    this.ctx = ctx;
    this.k = makeKit(ctx);
    this.m = buildMaster(this.k, ctx.destination);
    this.applyVolumes(0);
    // iOS: a sound must start inside the gesture for the context to come alive.
    const s = ctx.createBufferSource();
    s.buffer = ctx.createBuffer(1, 1, 22050);
    s.connect(ctx.destination);
    s.start(0);
    document.addEventListener("visibilitychange", this.onVisibility);
    for (const ev of ["touchend", "pointerup", "keydown"]) window.addEventListener(ev, this.onGesture, { passive: true });
    ctx.addEventListener("statechange", () => this.kick());
  }

  private applyVolumes(tau: number): void {
    const { ctx, m } = this;
    if (!ctx || !m) return;
    const now = ctx.currentTime;
    const set = (p: AudioParam, v: number) => (tau > 0 ? p.setTargetAtTime(v, now, tau) : (p.value = v));
    set(m.music.gain, this.vMusic);
    set(m.sfx.gain, this.vSfx);
    set(m.out.gain, this.muted ? 0 : 1);
  }

  /** Brings the live state in line with what the game asked for before (or while) locked. */
  private restore(): void {
    if (!this.ctx) return;
    if (this.wantAmb && !this.amb) this.ambience(true);
    if (this.wantMusic && this.cur?.name !== this.wantMusic) this.music(this.wantMusic, 0.5);
    if (this.cur) this.cur.p.setIntensity(this.level, this.ctx.currentTime);
    for (const [id, { l, o }] of this.wantLoops) if (!this.loops.has(id)) this.loop(l, id, o);
    this.kick();
  }

  private kick(): void {
    if (this.timer === null && (this.cur || this.fading.length || this.amb)) this.timer = setTimeout(this.tick, 0);
  }

  private tick = (): void => {
    this.timer = null;
    const ctx = this.ctx;
    if (!ctx) return;
    this.guard("scheduler", () => {
      if (ctx.state !== "running") return;
      const now = ctx.currentTime;
      const until = now + LOOKAHEAD;
      if (this.cur) {
        this.cur.p.schedule(now, until);
        if (this.cur.p.done(now)) {
          this.cur.p.dispose();
          if (this.wantMusic === this.cur.name) this.wantMusic = null;
          this.cur = null;
        }
      }
      this.fading = this.fading.filter((p) => {
        p.schedule(now, until);
        if (!p.done(now)) return true;
        p.dispose();
        return false;
      });
      this.amb?.schedule(until);
      this.pool.prune(now);
    });
    if (this.cur || this.fading.length || this.amb) this.timer = setTimeout(this.tick, TICK_MS);
  };

  private onVisibility = (): void => {
    const ctx = this.ctx;
    if (!ctx) return;
    if (document.hidden) ctx.suspend().catch(() => {});
    else {
      ctx.resume().catch(() => {});
      this.kick();
    }
  };

  private onGesture = (): void => {
    const ctx = this.ctx;
    if (ctx && ctx.state !== "running" && !document.hidden) ctx.resume().catch(() => {});
  };
}
