// The music sequencer. parseCue() turns a cue from score.ts into per-step events and checks
// it (bar lines, instrument, range); CuePlayer schedules those events ahead of the clock. The
// engine calls schedule() from a setTimeout loop with a look-ahead window; the offline
// renderer calls it once for the whole render. Same code, same notes.
import { INSTRUMENTS, type Instrument, type InstrumentId } from "./instruments";
import { type Kit, gain } from "./kit";
import { CUES, type CueDef, type TrackDef } from "./score";
import type { Music } from "./types";

const PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** "A4" is 69, "C4" is 60; sharps with #, flats with b. */
export function noteToMidi(s: string): number {
  const m = /^([A-G])(#|b)?(-?\d)$/.exec(s);
  if (!m) throw new Error(`bad note "${s}"`);
  return 12 * (Number(m[3]) + 1) + PC[m[1]] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0);
}

export interface NoteEv {
  midis: number[];
  /** Length in steps. */
  steps: number;
  vel: number;
  roll: boolean;
}

export interface ParsedTrack {
  def: TrackDef;
  inst: Instrument;
  /** Length in steps (the track repeats within its section). */
  len: number;
  at: (NoteEv[] | undefined)[];
  bus: string;
}

export interface ParsedSection {
  name: string;
  steps: number;
  tracks: ParsedTrack[];
}

export interface ParsedCue {
  name: string;
  def: CueDef;
  stepsPerBeat: number;
  stepsPerBar: number;
  order: ParsedSection[];
  loopFrom: number | null;
  /** Lowest and highest MIDI note actually used, per instrument (for the tests). */
  used: Map<InstrumentId, [number, number]>;
}

const HIT_VEL: Record<string, [number, boolean]> = {
  X: [1, false],
  x: [0.75, false],
  o: [0.42, false],
  r: [0.55, true],
  R: [0.9, true],
};

function parseHits(src: string, perBar: number, pitch: number[], where: string): { len: number; at: (NoteEv[] | undefined)[] } {
  const barsIn = src.split("|").map((b) => b.replace(/\s+/g, ""));
  const at: (NoteEv[] | undefined)[] = [];
  barsIn.forEach((b, i) => {
    if (b.length !== perBar) throw new Error(`${where}: bar ${i + 1} has ${b.length} steps, not ${perBar}`);
    for (const ch of b) {
      if (ch === ".") {
        at.push(undefined);
        continue;
      }
      const v = HIT_VEL[ch];
      if (!v) throw new Error(`${where}: bad hit "${ch}"`);
      at.push([{ midis: pitch, steps: 1, vel: v[0], roll: v[1] }]);
    }
  });
  return { len: at.length, at };
}

function parseNotes(src: string, perBar: number, oct: number, where: string): { len: number; at: (NoteEv[] | undefined)[] } {
  const at: (NoteEv[] | undefined)[] = [];
  let pos = 0;
  for (const tok of src.trim().split(/\s+/)) {
    if (tok === "|") {
      if (pos % perBar !== 0) throw new Error(`${where}: bar line at step ${pos} is not on a bar boundary`);
      continue;
    }
    const m = /^([>~]?)([^:]+)(?::(\d+))?$/.exec(tok);
    if (!m) throw new Error(`${where}: bad token "${tok}"`);
    const steps = m[3] ? Number(m[3]) : 1;
    if (!(steps >= 1)) throw new Error(`${where}: bad length in "${tok}"`);
    if (m[2] !== ".") {
      const midis = m[2].split("+").map((n) => noteToMidi(n) + 12 * oct);
      const vel = m[1] === ">" ? 1 : m[1] === "~" ? 0.55 : 0.82;
      at[pos] = [{ midis, steps, vel, roll: false }];
    }
    pos += steps;
  }
  if (pos === 0 || pos % perBar !== 0) throw new Error(`${where}: ${pos} steps is not a whole number of bars`);
  at.length = pos;
  return { len: pos, at };
}

export function parseCue(name: string, def: CueDef): ParsedCue {
  const stepsPerBeat = def.stepsPerBeat ?? 4;
  const stepsPerBar = (def.beatsPerBar ?? 4) * stepsPerBeat;
  if (!(def.bpm >= 30 && def.bpm <= 240)) throw new Error(`${name}: bpm ${def.bpm} out of range`);
  const used = new Map<InstrumentId, [number, number]>();
  const sections = new Map<string, ParsedSection>();
  for (const [sname, s] of Object.entries(def.sections)) {
    const steps = s.bars * stepsPerBar;
    const tracks = s.tracks.map((t, i): ParsedTrack => {
      const where = `${name}/${sname}/${i}:${t.inst}`;
      const inst = INSTRUMENTS[t.inst] as Instrument | undefined;
      if (!inst) throw new Error(`${where}: no instrument "${t.inst}"`);
      if (!!t.notes === !!t.hits) throw new Error(`${where}: a track has notes or hits, not both`);
      if (t.hits && !inst.perc) throw new Error(`${where}: hits need a percussion instrument`);
      const pitch = t.pitch ? [noteToMidi(t.pitch)] : [];
      const p = t.hits ? parseHits(t.hits, stepsPerBar, pitch, where) : parseNotes(t.notes!, stepsPerBar, t.oct ?? 0, where);
      if (steps % p.len !== 0) throw new Error(`${where}: ${p.len} steps do not divide the section's ${steps}`);
      for (const evs of p.at)
        for (const e of evs ?? [])
          for (const m of e.midis) {
            if (m < inst.range[0] || m > inst.range[1]) throw new Error(`${where}: note ${m} outside ${t.inst} ${inst.range.join("..")}`);
            const u = used.get(t.inst);
            used.set(t.inst, u ? [Math.min(u[0], m), Math.max(u[1], m)] : [m, m]);
          }
      const bus = `${t.layer ?? 0}|${t.fadeAbove ?? 2}|${t.pan ?? 0}|${t.verb ?? 0}`;
      return { def: t, inst, len: p.len, at: p.at, bus };
    });
    sections.set(sname, { name: sname, steps, tracks });
  }
  const order = def.order.map((o) => {
    const s = sections.get(o);
    if (!s) throw new Error(`${name}: order names a missing section "${o}"`);
    return s;
  });
  if (!order.length) throw new Error(`${name}: empty order`);
  const loopFrom = def.loopFrom ?? null;
  if (loopFrom !== null && !(loopFrom >= 0 && loopFrom < order.length)) throw new Error(`${name}: loopFrom out of range`);
  return { name, def, stepsPerBeat, stepsPerBar, order, loopFrom, used };
}

const parsed = new Map<string, ParsedCue>();
export function getCue(m: Music): ParsedCue {
  let p = parsed.get(m);
  if (!p) {
    p = parseCue(m, CUES[m]);
    parsed.set(m, p);
  }
  return p;
}

/** Seconds from the start of the order to its end, and of the looping part, at intensity 0. */
export function cueSeconds(p: ParsedCue): { total: number; loop: number } {
  const step = 60 / p.def.bpm / p.stepsPerBeat;
  const steps = p.order.map((s) => s.steps);
  const total = steps.reduce((a, b) => a + b, 0) * step;
  const loop = p.loopFrom === null ? 0 : steps.slice(p.loopFrom).reduce((a, b) => a + b, 0) * step;
  return { total, loop };
}

/** How loud a layer is at intensity v: fades in around `layer`, out around `above`. */
export function layerLevel(layer: number, above: number, v: number): number {
  const s = (e0: number, e1: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  };
  const up = layer <= 0 ? 1 : s(layer - 0.12, layer + 0.08, v);
  const down = above >= 1.5 ? 1 : 1 - s(above - 0.08, above + 0.12, v);
  return up * down;
}

interface Bus {
  g: GainNode;
  layer: number;
  above: number;
  level: number;
}

export class CuePlayer {
  readonly out: GainNode;
  private buses = new Map<string, Bus>();
  private nodes: AudioNode[] = [];
  private sec = 0;
  private step = 0;
  private next: number;
  private level: number;
  private stopAt = Infinity;
  private endAt = Infinity;

  constructor(
    private k: Kit,
    readonly cue: ParsedCue,
    dest: AudioNode,
    verb: AudioNode | null,
    t0: number,
    intensity: number,
  ) {
    this.out = gain(k, (cue.def.gain ?? 1), dest);
    this.next = t0;
    this.level = intensity;
    for (const s of cue.order)
      for (const tr of s.tracks) {
        if (this.buses.has(tr.bus)) continue;
        const d = tr.def;
        const layer = d.layer ?? 0;
        const above = d.fadeAbove ?? 2;
        const level = layerLevel(layer, above, intensity);
        const g = gain(k, level);
        let head: AudioNode = this.out;
        if (d.pan && k.ctx.createStereoPanner) {
          const p = k.ctx.createStereoPanner();
          p.pan.value = d.pan;
          p.connect(this.out);
          head = p;
          this.nodes.push(p);
        }
        g.connect(head);
        this.nodes.push(g);
        if (d.verb && verb) {
          const send = gain(k, d.verb, verb);
          g.connect(send);
          this.nodes.push(send);
        }
        this.buses.set(tr.bus, { g, layer, above, level });
      }
  }

  get ended(): boolean {
    return this.endAt < Infinity || this.stopAt < Infinity;
  }

  setIntensity(v: number, now: number): void {
    this.level = v;
    for (const b of this.buses.values()) {
      const l = layerLevel(b.layer, b.above, v);
      if (Math.abs(l - b.level) < 0.005) continue;
      b.level = l;
      b.g.gain.setTargetAtTime(l, now, 0.6);
    }
  }

  fadeIn(now: number, dur: number): void {
    const target = this.cue.def.gain ?? 1;
    if (dur <= 0) return;
    this.out.gain.setValueAtTime(0, now);
    this.out.gain.linearRampToValueAtTime(target, now + dur);
  }

  fadeOut(now: number, dur: number): void {
    const p = this.out.gain;
    p.cancelScheduledValues(now);
    p.setValueAtTime(p.value, now);
    p.linearRampToValueAtTime(0, now + Math.max(0.02, dur));
    this.stopAt = now + Math.max(0.02, dur);
  }

  /** True once everything scheduled has rung out. */
  done(now: number): boolean {
    return now > Math.min(this.stopAt + 0.3, this.endAt);
  }

  dispose(): void {
    this.out.disconnect();
    for (const n of this.nodes) n.disconnect();
    this.nodes = [];
  }

  private stepDur(): number {
    const push = this.cue.def.push ?? 0;
    return 60 / (this.cue.def.bpm * (1 + push * this.level)) / this.cue.stepsPerBeat;
  }

  /** Schedules every step that starts before `until`. */
  schedule(now: number, until: number): void {
    if (this.endAt < Infinity) return;
    // After a stall (a locked phone, a busy frame) jump ahead instead of playing catch-up.
    if (this.next < now - 0.2) this.next = now + 0.05;
    const swing = this.cue.def.swing ?? 0;
    while (this.next < until && this.next < this.stopAt) {
      const sec = this.cue.order[this.sec];
      const dt = this.stepDur();
      const t = this.next + (this.step % 2 === 1 ? swing * dt : 0);
      for (const tr of sec.tracks) {
        const evs = tr.at[this.step % tr.len];
        if (!evs) continue;
        const bus = this.buses.get(tr.bus)!;
        if (bus.level < 0.02) continue; // a silent layer costs nothing
        const vol = tr.def.vol ?? 1;
        for (const e of evs) {
          const vel = e.vel * vol * (0.95 + 0.1 * this.k.rnd());
          tr.inst.play(this.k, bus.g, t, e.midis, e.steps * dt, vel);
          if (e.roll) tr.inst.play(this.k, bus.g, t + dt / 2, e.midis, dt / 2, vel * 0.85);
        }
      }
      this.next += dt;
      if (++this.step >= sec.steps) {
        this.step = 0;
        if (++this.sec >= this.cue.order.length) {
          if (this.cue.loopFrom === null) {
            this.endAt = this.next + (this.cue.def.tail ?? 3);
            return;
          }
          this.sec = this.cue.loopFrom;
        }
      }
    }
  }
}
