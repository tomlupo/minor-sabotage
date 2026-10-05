// The audio layer in Node. It imports without an AudioContext and every call is a safe no-op;
// the music data is well formed (instruments exist, notes in range, bars add up); and, on a
// strict fake of the Web Audio API that throws where a browser throws (negative or non-finite
// times, starting twice, stopping before starting), every effect, loop, instrument, cue and the
// engine itself build their graphs, and every finite sound schedules its own stop.
//
// What the sounds actually sound like is measured in the browser, by the audio lab:
//   node tools/shot.mjs --page audio.html --steps '[{"eval":"window.__audioReport()"}]'
import { afterEach, describe, expect, it, vi } from "vitest";
import { Engine, LOOP_LIST, MUSIC_LIST, SFX_LIST, audio } from "../src/audio";
import { AMB_EVENTS, Ambience, playAmbEvent } from "../src/audio/ambience";
import { analyse, chroma } from "../src/audio/analysis";
import { INSTRUMENTS, type Instrument } from "../src/audio/instruments";
import { collect, makeKit, mulberry } from "../src/audio/kit";
import { LOOPS, startLoop, stopLoop, updateLoop } from "../src/audio/loops";
import { buildMaster, softClipCurve } from "../src/audio/master";
import { CUES, type CueDef } from "../src/audio/score";
import { CuePlayer, cueSeconds, getCue, layerLevel, noteToMidi, parseCue } from "../src/audio/sequencer";
import { SFX, startSfx } from "../src/audio/sfx";
import { HEAR_M, spatial } from "../src/audio/spatial";
import { VoicePool } from "../src/audio/voices";

// ---------------------------------------------------------------------------------------------
// A strict fake of the parts of Web Audio the layer uses.

function checkTime(t: number, what: string): void {
  if (!Number.isFinite(t) || t < 0) throw new RangeError(`${what}: time ${t} must be finite and non-negative`);
}
function checkValue(v: number, what: string): void {
  if (!Number.isFinite(v)) throw new TypeError(`${what}: value ${v} is not finite`);
}

class FParam {
  value: number;
  constructor(
    readonly ctx: FCtx,
    v: number,
  ) {
    this.value = v;
  }
  setValueAtTime(v: number, t: number) {
    checkValue(v, "setValueAtTime");
    checkTime(t, "setValueAtTime");
    return this;
  }
  linearRampToValueAtTime(v: number, t: number) {
    checkValue(v, "linearRamp");
    checkTime(t, "linearRamp");
    return this;
  }
  exponentialRampToValueAtTime(v: number, t: number) {
    checkValue(v, "exponentialRamp");
    checkTime(t, "exponentialRamp");
    if (v === 0) throw new RangeError("exponentialRamp to 0");
    return this;
  }
  setTargetAtTime(v: number, t: number, tc: number) {
    checkValue(v, "setTarget");
    checkTime(t, "setTarget");
    if (!Number.isFinite(tc) || tc < 0) throw new RangeError(`setTarget: time constant ${tc}`);
    return this;
  }
  cancelScheduledValues(t: number) {
    checkTime(t, "cancel");
    return this;
  }
}

class FNode {
  channelCount = 2;
  channelCountMode = "max";
  channelInterpretation = "speakers";
  outs = new Set<FNode | FParam>();
  ins = 0;
  constructor(readonly ctx: FCtx) {
    ctx.created++;
  }
  connect(d: FNode | FParam) {
    if (!(d instanceof FNode) && !(d instanceof FParam)) throw new TypeError("connect: not a node or param");
    if (d.ctx !== this.ctx) throw new Error("connect: another context");
    this.outs.add(d);
    if (d instanceof FNode) d.ins++;
    return d instanceof FNode ? d : undefined;
  }
  disconnect() {
    this.outs.clear();
  }
  addEventListener() {}
}
const p = (n: FNode, v: number) => new FParam(n.ctx, v);

class FGain extends FNode {
  gain = p(this, 1);
}
class FFilter extends FNode {
  type = "lowpass";
  frequency = p(this, 350);
  Q = p(this, 1);
  gain = p(this, 0);
  detune = p(this, 0);
}
class FPanner extends FNode {
  pan = p(this, 0);
}
class FSource extends FNode {
  started = false;
  stopAt = Infinity;
  onended: (() => void) | null = null;
  constructor(ctx: FCtx) {
    super(ctx);
    ctx.sources.push(this);
  }
  start(when = 0, offset = 0) {
    if (this.started) throw new Error("InvalidStateError: started twice");
    checkTime(when, "start");
    if (!(offset >= 0)) throw new RangeError(`start: offset ${offset}`);
    this.started = true;
  }
  stop(when = 0) {
    if (!this.started) throw new Error("InvalidStateError: stop before start");
    checkTime(when, "stop");
    this.stopAt = when;
  }
}
class FOsc extends FSource {
  frequency = p(this, 440);
  detune = p(this, 0);
  private t = "sine";
  get type() {
    return this.t;
  }
  set type(v: string) {
    if (!["sine", "square", "sawtooth", "triangle"].includes(v)) throw new TypeError(`oscillator type ${v}`);
    this.t = v;
  }
  setPeriodicWave(w: unknown) {
    if (!(w instanceof FWave)) throw new TypeError("setPeriodicWave: not a wave");
    this.t = "custom";
  }
}
class FBufferSource extends FSource {
  buffer: FBuffer | null = null;
  loop = false;
  playbackRate = p(this, 1);
  detune = p(this, 0);
}
class FBuffer {
  data: Float32Array[];
  constructor(
    readonly numberOfChannels: number,
    readonly length: number,
    readonly sampleRate: number,
  ) {
    if (!(length >= 1)) throw new RangeError(`buffer length ${length}`);
    if (!(sampleRate >= 3000 && sampleRate <= 768000)) throw new RangeError(`buffer rate ${sampleRate}`);
    this.data = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }
  get duration() {
    return this.length / this.sampleRate;
  }
  getChannelData(c: number) {
    return this.data[c];
  }
}
class FWave {}
class FCompressor extends FNode {
  threshold = p(this, -24);
  knee = p(this, 30);
  ratio = p(this, 12);
  attack = p(this, 0.003);
  release = p(this, 0.25);
}
class FShaper extends FNode {
  curve: Float32Array | null = null;
  oversample = "none";
}
class FConvolver extends FNode {
  normalize = true;
  buffer: FBuffer | null = null;
}

class FCtx {
  sampleRate = 22050;
  currentTime = 0;
  state = "running";
  created = 0;
  sources: FSource[] = [];
  destination: FNode = new FNode(this);
  createGain() {
    return new FGain(this);
  }
  createBiquadFilter() {
    return new FFilter(this);
  }
  createStereoPanner() {
    return new FPanner(this);
  }
  createOscillator() {
    return new FOsc(this);
  }
  createBufferSource() {
    return new FBufferSource(this);
  }
  createBuffer(c: number, l: number, sr: number) {
    return new FBuffer(c, l, sr);
  }
  createPeriodicWave(re: Float32Array, im: Float32Array) {
    if (re.length !== im.length || re.length < 2) throw new Error("periodic wave: bad arrays");
    return new FWave();
  }
  createDynamicsCompressor() {
    return new FCompressor(this);
  }
  createWaveShaper() {
    return new FShaper(this);
  }
  createConvolver() {
    return new FConvolver(this);
  }
  createChannelMerger() {
    return new FNode(this);
  }
  createChannelSplitter() {
    return new FNode(this);
  }
  resume() {
    this.state = "running";
    return Promise.resolve();
  }
  suspend() {
    this.state = "suspended";
    return Promise.resolve();
  }
  addEventListener() {}
}

function rig(seed = 1) {
  const ctx = new FCtx();
  const k = makeKit(ctx as unknown as BaseAudioContext, mulberry(seed));
  const m = buildMaster(k, ctx.destination as unknown as AudioNode);
  return { ctx, k, m };
}

// ---------------------------------------------------------------------------------------------

describe("audio in Node", () => {
  it("really has no AudioContext and no window here", () => {
    expect(typeof (globalThis as { AudioContext?: unknown }).AudioContext).toBe("undefined");
    expect(typeof (globalThis as { window?: unknown }).window).toBe("undefined");
  });

  it("every API call is a safe no-op", () => {
    expect(() => {
      audio.setVolumes(0.5, 0.8);
      audio.setVolumes(NaN, Infinity);
      audio.setMuted(true);
      audio.setMuted(false);
      audio.setListener(10, 20);
      audio.setListener(NaN, 0);
      for (const s of SFX_LIST) {
        audio.play(s);
        audio.play(s, { x: 1, y: 2, gain: 0.5, rate: 1.2, rounds: 1 });
      }
      for (const l of LOOP_LIST) {
        audio.loop(l, `t-${l}`);
        audio.loop(l, `t-${l}`, { x: 3, y: 4, rate: 2 });
        audio.loop(l, `t-${l}`, null);
      }
      for (const mu of MUSIC_LIST) audio.music(mu, 0.5);
      audio.music(null);
      audio.intensity(0.7);
      audio.intensity(-3);
      audio.ambience(true);
      audio.ambience(false);
      audio.duck(0.6, 1);
      audio.duck(0, 0);
      audio.unlock();
    }).not.toThrow();
    expect((audio as Engine).state).toBe("locked");
  });
});

describe("sound tables", () => {
  it("every Sfx has a recipe with a sane priority, cap and length", () => {
    expect(Object.keys(SFX).sort()).toEqual([...SFX_LIST].sort());
    for (const s of SFX_LIST) {
      const d = SFX[s];
      expect([1, 2, 3], s).toContain(d.prio);
      expect(d.cap, s).toBeGreaterThanOrEqual(1);
      expect(d.len, s).toBeGreaterThan(0.05);
      expect(d.len, s).toBeLessThan(6);
    }
  });

  it("every Loop has a builder and every Music a cue", () => {
    expect(Object.keys(LOOPS).sort()).toEqual([...LOOP_LIST].sort());
    expect(Object.keys(CUES).sort()).toEqual([...MUSIC_LIST].sort());
  });
});

describe("score", () => {
  it("reads note names", () => {
    expect(noteToMidi("A4")).toBe(69);
    expect(noteToMidi("C4")).toBe(60);
    expect(noteToMidi("Bb1")).toBe(34);
    expect(noteToMidi("F#2")).toBe(42);
    expect(noteToMidi("C#5")).toBe(73);
    expect(() => noteToMidi("H4")).toThrow();
    expect(() => noteToMidi("C")).toThrow();
  });

  for (const mu of MUSIC_LIST) {
    describe(mu, () => {
      // getCue parses: it throws on a bar that does not add up, an unknown instrument, a note
      // out of range, hits on a melodic instrument or an order naming a missing section.
      const cue = getCue(mu);

      it("every track names an instrument and stays inside its range", () => {
        for (const s of cue.order)
          for (const tr of s.tracks) {
            const inst = INSTRUMENTS[tr.def.inst] as Instrument | undefined;
            expect(inst, tr.def.inst).toBeDefined();
            if (tr.def.hits) expect(inst!.perc, `${tr.def.inst} plays hits`).toBe(true);
          }
        expect(cue.used.size).toBeGreaterThan(0);
        for (const [id, [lo, hi]] of cue.used) {
          const [min, max] = INSTRUMENTS[id].range;
          expect(lo, id).toBeGreaterThanOrEqual(min);
          expect(hi, id).toBeLessThanOrEqual(max);
        }
      });

      it("every section is whole bars and every track fits its section", () => {
        for (const s of cue.order) {
          expect(s.steps % cue.stepsPerBar).toBe(0);
          for (const tr of s.tracks) {
            expect(tr.len % cue.stepsPerBar, `${s.name}/${tr.def.inst}`).toBe(0);
            expect(s.steps % tr.len, `${s.name}/${tr.def.inst}`).toBe(0);
          }
        }
      });

      it("has a sensible length", () => {
        const { total, loop } = cueSeconds(cue);
        if (mu === "fallen") {
          expect(cue.loopFrom).toBeNull();
          expect(total).toBeLessThan(10);
        } else if (mu === "title") {
          expect(loop).toBeGreaterThanOrEqual(60);
          expect(loop).toBeLessThanOrEqual(90);
        } else {
          expect(loop).toBeGreaterThanOrEqual(25);
          expect(loop).toBeLessThanOrEqual(90);
        }
      });
    });
  }

  const one = (tracks: CueDef["sections"][string]["tracks"], order = ["a"]): CueDef => ({ bpm: 100, sections: { a: { bars: 1, tracks } }, order });
  it("the parser refuses what the tests above rely on it refusing", () => {
    expect(() => parseCue("x", one([{ inst: "pulse", notes: "C4:4 D4:4 | E4:8" }]))).toThrow(/bar/);
    expect(() => parseCue("x", one([{ inst: "pulse", notes: "C4:4 D4:4" }]))).toThrow(/bars/);
    expect(() => parseCue("x", one([{ inst: "nope" as "pulse", notes: "C4:16" }]))).toThrow(/instrument/);
    expect(() => parseCue("x", one([{ inst: "pulse", notes: "C1:16" }]))).toThrow(/outside/);
    expect(() => parseCue("x", one([{ inst: "pulse", hits: "x..............." }]))).toThrow(/percussion/);
    expect(() => parseCue("x", one([{ inst: "snare", hits: "x......" }]))).toThrow(/steps/);
    expect(() => parseCue("x", one([{ inst: "snare", hits: "x..............." }], ["b"]))).toThrow(/missing/);
    expect(() => parseCue("x", one([{ inst: "snare", hits: "x..............." }]))).not.toThrow();
  });
});

describe("intensity layers", () => {
  it("a layer is silent below its threshold and full above it", () => {
    expect(layerLevel(0.6, 2, 0.3)).toBe(0);
    expect(layerLevel(0.6, 2, 0.9)).toBe(1);
    expect(layerLevel(0, 2, 0)).toBe(1);
    expect(layerLevel(0, 0.5, 1)).toBe(0);
  });

  it("stealth and action have layers for intensity to bring in", () => {
    const layered = (mu: "stealth" | "action") => new Set(getCue(mu).order.flatMap((s) => s.tracks.map((t) => t.def.layer ?? 0)).filter((l) => l > 0));
    expect(layered("stealth").size).toBeGreaterThanOrEqual(3);
    expect(layered("action").size).toBeGreaterThanOrEqual(2);
  });
});

describe("spatial", () => {
  it("is full up close and silent beyond ~70 m", () => {
    expect(spatial(0, 0).gain).toBe(1);
    expect(spatial(HEAR_M, 0).gain).toBe(0);
    expect(spatial(100, 30).gain).toBe(0);
    expect(spatial(NaN, 0).gain).toBe(0);
  });

  it("gets quieter and duller with distance", () => {
    const at = [8, 15, 30, 50, 65].map((d) => spatial(d, 0));
    for (let i = 1; i < at.length; i++) {
      expect(at[i].gain).toBeLessThan(at[i - 1].gain);
      expect(at[i].cutoff).toBeLessThan(at[i - 1].cutoff);
      expect(at[i].delay).toBeGreaterThan(at[i - 1].delay);
    }
  });

  it("pans by the horizontal offset only", () => {
    expect(spatial(20, 0).pan).toBeGreaterThan(0);
    expect(spatial(-20, 0).pan).toBeLessThan(0);
    expect(spatial(0, 30).pan).toBe(0);
  });
});

describe("voice pool", () => {
  const mk = (name: string, prio: number, start: number, end = 10) => ({
    name, prio, start, end, stopped: false, released: false,
    stop() { this.stopped = true; },
    release() { this.released = true; },
  });

  it("steals the oldest voice of the same or lower priority when full", () => {
    const pool = new VoicePool<ReturnType<typeof mk>>(3);
    const a = mk("step", 1, 0), b = mk("ui_tap", 3, 1), c = mk("sten", 2, 2);
    for (const v of [a, b, c]) {
      expect(pool.admit(v.name, v.prio, 8, 3)).toBe(true);
      pool.add(v);
    }
    expect(pool.admit("rifle", 2, 8, 4)).toBe(true);
    expect(a.stopped).toBe(true);
    expect(b.stopped).toBe(false);
    expect(pool.list).toHaveLength(2);
  });

  it("drops a new voice when everything playing matters more", () => {
    const pool = new VoicePool<ReturnType<typeof mk>>(2);
    for (const v of [mk("explosion", 3, 0), mk("ui_ok", 3, 1)]) {
      pool.admit(v.name, v.prio, 8, 1);
      pool.add(v);
    }
    expect(pool.admit("step", 1, 8, 2)).toBe(false);
    expect(pool.list.every((v) => !v.stopped)).toBe(true);
  });

  it("caps one sound's own voices, oldest first", () => {
    const pool = new VoicePool<ReturnType<typeof mk>>(24);
    const steps = [mk("step", 1, 0), mk("step", 1, 1)];
    for (const v of steps) {
      pool.admit(v.name, v.prio, 2, v.start);
      pool.add(v);
    }
    expect(pool.admit("step", 1, 2, 2)).toBe(true);
    expect(steps[0].stopped).toBe(true);
    expect(steps[1].stopped).toBe(false);
  });

  it("releases voices that have finished", () => {
    const pool = new VoicePool<ReturnType<typeof mk>>(24);
    const done = mk("hit", 2, 0, 0.3);
    pool.add(done);
    pool.prune(1);
    expect(done.released).toBe(true);
    expect(pool.list).toHaveLength(0);
  });
});

describe("analysis", () => {
  const sr = 44100;
  const sine = (f: number, amp: number, sec: number, pad = 0) =>
    Float32Array.from({ length: Math.round((sec + pad) * sr) }, (_, i) => (i < sec * sr ? amp * Math.sin((2 * Math.PI * f * i) / sr) : 0));

  it("measures a sine", () => {
    const x = sine(1000, 0.5, 0.5);
    const s = analyse([x, x], sr, [x, x]);
    expect(s.peak).toBeCloseTo(0.5, 2);
    expect(s.peakPre).toBeCloseTo(0.5, 2);
    expect(s.rmsDb).toBeCloseTo(20 * Math.log10(0.5 / Math.SQRT2), 1);
    expect(s.dur).toBeCloseTo(0.5, 2);
    expect(Math.abs(s.centroid - 1000)).toBeLessThan(60);
    expect(s.clips).toBe(false);
    expect(s.silent).toBe(false);
  });

  it("finds where a sound ends", () => {
    expect(analyse([sine(440, 0.3, 0.2, 0.3)], sr).dur).toBeCloseTo(0.2, 2);
  });

  it("hears only what a phone speaker plays", () => {
    const lo = analyse([sine(100, 0.5, 0.5)], sr);
    const hi = analyse([sine(1000, 0.5, 0.5)], sr);
    expect(lo.loudDb).toBeCloseTo(hi.loudDb, 1);
    expect(hi.phoneDb - lo.phoneDb).toBeGreaterThan(30);
  });

  it("hears the pitch class of a tone", () => {
    const c = chroma(sine(440, 0.5, 1), sr);
    expect(c.indexOf(Math.max(...c))).toBe(9); // A
    expect(c[9]).toBeGreaterThan(0.9);
    const e = chroma(sine(329.63, 0.5, 1), sr);
    expect(e.indexOf(Math.max(...e))).toBe(4); // E
  });

  it("flags silence and clipping", () => {
    expect(analyse([new Float32Array(1000)], sr).silent).toBe(true);
    expect(analyse([sine(200, 1, 0.1)], sr).clips).toBe(true);
  });
});

describe("master", () => {
  it("the soft clipper is the identity below 0.8 and never reaches 0.99", () => {
    const c = softClipCurve();
    // the shaper is fed at half level, so curve position x stands for an input of 2x
    const at = (input: number) => c[Math.round(((input / 2 + 1) / 2) * (c.length - 1))];
    expect(at(0.5)).toBeCloseTo(0.5, 3);
    expect(at(-0.7)).toBeCloseTo(-0.7, 3);
    expect(Math.max(...c)).toBeLessThan(0.99);
    expect(Math.min(...c)).toBeGreaterThan(-0.99);
    expect(at(1.5)).toBeGreaterThan(at(1));
  });
});

// ---------------------------------------------------------------------------------------------
// On the fake Web Audio: every graph builds, nothing is scheduled at an impossible time, and
// nothing finite is left running forever.

describe("graphs on a strict fake of Web Audio", () => {
  const unstopped = (ctx: FCtx) => ctx.sources.filter((s) => s.started && s.stopAt === Infinity);

  it("every effect builds, stays within its declared length and stops all it starts", () => {
    const wrong: string[] = [];
    for (const s of SFX_LIST) {
      const { ctx, k, m } = rig();
      const opts = [{}, { rate: 0.5 }, { rate: 2, rounds: 1 }, { rounds: 6 }, { x: 30, y: 10, gain: 0.5 }];
      for (const o of opts) {
        const t = 0.001;
        const v = startSfx(k, m.sfx, s, t, o, 0, 0);
        if (!v || !(v.end > t)) wrong.push(`${s} ${JSON.stringify(o)}: no sound`);
        // the offline render is `len` long, so a sound must be over by then (at its own rate)
        else if (!("rate" in o) && !("rounds" in o) && !("x" in o) && v.end - t > SFX[s].len)
          wrong.push(`${s}: rings ${(v.end - t).toFixed(2)} s, len says ${SFX[s].len}`);
      }
      if (unstopped(ctx).length) wrong.push(`${s}: leaves ${unstopped(ctx).length} sources running`);
    }
    expect(wrong).toEqual([]);
  });

  it("a sound beyond hearing costs nothing", () => {
    const { ctx, k, m } = rig();
    const before = ctx.created;
    expect(startSfx(k, m.sfx, "explosion", 0, { x: 90, y: 0 }, 0, 0)).toBeNull();
    expect(ctx.created).toBe(before);
  });

  it("every instrument plays across its range and stops what it starts", () => {
    const { ctx, k, m } = rig();
    for (const [id, inst] of Object.entries(INSTRUMENTS)) {
      const [lo, hi] = inst.range;
      for (const n of [lo, Math.round((lo + hi) / 2), hi]) {
        collect(k, () => inst.play(k, m.musicIn, 0, [n], 0.3, 1));
        collect(k, () => inst.play(k, m.musicIn, 1, [n, Math.min(hi, n + 4)], 2, 0.5));
      }
      expect(unstopped(ctx).length, id).toBe(0);
    }
  });

  it("every cue schedules a minute in look-ahead slices, at rest and at full alarm", () => {
    for (const mu of MUSIC_LIST)
      for (const lvl of [0, 1]) {
        const { ctx, k, m } = rig();
        const player = new CuePlayer(k, getCue(mu), m.musicIn, m.verb, 0.05, lvl);
        for (let now = 0; now < 60; now += 0.04) {
          player.schedule(now, now + 0.25);
          if (now > 20 && now < 20.05) player.setIntensity(1 - lvl, now);
        }
        expect(ctx.sources.length, mu).toBeGreaterThan(50);
        expect(unstopped(ctx).length, mu).toBe(0);
        if (mu === "fallen") expect(player.done(60)).toBe(true);
      }
  });

  it("loops start, glide, move and stop everything", () => {
    for (const l of LOOP_LIST) {
      const { ctx, k, m } = rig();
      const h = startLoop(k, m.sfx, l, 0, { x: 5, y: 5, rate: 1 }, 0, 0);
      updateLoop(h, { x: 40, y: 10, rate: 2.5, gain: 0.7 }, 0, 0, 1);
      updateLoop(h, { x: 400, y: 10, rate: 1 }, 0, 0, 2);
      expect(unstopped(ctx).length, `${l} runs until stopped`).toBeGreaterThan(0);
      vi.useFakeTimers();
      stopLoop(h, 3);
      vi.runAllTimers();
      vi.useRealTimers();
      expect(unstopped(ctx).length, l).toBe(0);
    }
  });

  it("the ambience schedules ten minutes of events, and each event stops itself", () => {
    const { ctx, k, m } = rig();
    const amb = new Ambience(k, m.amb, 0);
    const bed = ctx.sources.length;
    for (let now = 0; now < 600; now += 0.5) amb.schedule(now + 0.25);
    expect(ctx.sources.length).toBeGreaterThan(bed + 50);
    expect(unstopped(ctx).length).toBe(ctx.sources.slice(0, bed).length);
    vi.useFakeTimers();
    amb.stop(600);
    vi.runAllTimers();
    vi.useRealTimers();
    expect(unstopped(ctx).length).toBe(0);
    for (const e of AMB_EVENTS) expect(playAmbEvent(k, m.amb, e, 1)).toBeGreaterThan(1);
  });
});

describe("the engine on a fake browser", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function browser() {
    const ctxs: FCtx[] = [];
    class AC extends FCtx {
      constructor() {
        super();
        this.state = "suspended";
        ctxs.push(this);
      }
    }
    const on = () => {};
    vi.stubGlobal("window", { AudioContext: AC, addEventListener: on });
    vi.stubGlobal("document", { hidden: false, addEventListener: on });
    vi.useFakeTimers();
    return ctxs;
  }

  it("remembers what the game asked for while locked and starts it on unlock", () => {
    const ctxs = browser();
    const e = new Engine();
    e.music("stealth");
    e.intensity(0.8);
    e.ambience(true);
    e.loop("truck_engine", "truck", { x: 10, y: 0, rate: 1.2 });
    e.play("sten");
    expect(ctxs).toHaveLength(0);
    e.unlock();
    expect(ctxs).toHaveLength(1);
    const ctx = ctxs[0];
    expect(e.state).toBe("running");
    expect(e.currentMusic).toBe("stealth");
    expect(e.busy.loops).toBe(1);
    for (let i = 0; i < 100; i++) {
      ctx.currentTime += 0.04;
      vi.advanceTimersByTime(40);
    }
    expect(ctx.sources.length).toBeGreaterThan(20);
  });

  it("plays, steals, crossfades, ducks and stops without ever throwing", () => {
    const ctxs = browser();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const e = new Engine();
    e.unlock();
    const ctx = ctxs[0];
    const step = (sec: number) => {
      for (let t = 0; t < sec; t += 0.04) {
        ctx.currentTime += 0.04;
        vi.advanceTimersByTime(40);
      }
    };
    e.setListener(0, 0);
    e.music("title");
    step(1);
    for (const s of SFX_LIST) e.play(s, { x: Math.random() * 40 - 20, y: 3 });
    expect(e.busy.voices).toBeLessThanOrEqual(24);
    for (let i = 0; i < 40; i++) e.play("step", { x: 1, y: 1 });
    expect(e.busy.voices).toBeLessThanOrEqual(24);
    e.music("action", 1);
    e.intensity(1);
    e.duck(0.7, 1);
    e.duck(0.3, 0.2);
    step(3);
    expect(e.currentMusic).toBe("action");
    e.music("action");
    expect(e.currentMusic).toBe("action");
    e.music("fallen", 0.5);
    step(12);
    expect(e.currentMusic).toBe(null);
    e.loop("fire", "f", {});
    e.loop("fire", "f", { rate: 2 });
    e.loop("crowd_panic", "f", { rate: 1 });
    e.setListener(50, 50);
    e.loop("crowd_panic", "f", null);
    e.ambience(true);
    step(2);
    e.ambience(false);
    e.setMuted(true);
    e.setVolumes(0.2, 0.9);
    e.duck(0, 0);
    e.music(null, 0.2);
    step(2);
    ctx.state = "suspended";
    e.play("rifle");
    e.unlock();
    expect(ctx.state).toBe("running");
    expect(warn).not.toHaveBeenCalled();
  });
});
