// The music, written as data for the sequencer (sequencer.ts). Every cue is an original
// composition for this game.
//
// Notation. A melodic track is `notes`: space-separated tokens NOTE[:steps], a chord
// NOTE+NOTE+NOTE[:steps], or a rest .[:steps]; a step is a sixteenth, so :4 is a quarter note.
// A leading > accents a note and ~ softens it. A drum track is `hits`, one character per
// step: X accent, x hit, o ghost, r and R a roll (two thirty-seconds), . rest. In both, | is a
// bar line and is checked. A track shorter than its section repeats. `oct` transposes by
// octaves, `layer` fades a track in as intensity rises past it, `fadeAbove` fades it out.
//
// The leitmotif: the title march opens with a jaunty arpeggio (F A C, then up to F). The
// finale brings it back in D minor and then in F major, heroic; the fallen sting slows it
// down in minor. The march's B section turns bittersweet on a minor iv (B flat minor), the
// Cannon Fodder wink: the tune keeps marching while the harmony grieves.
import type { InstrumentId } from "./instruments";
import type { Music } from "./types";

export interface TrackDef {
  inst: InstrumentId;
  notes?: string;
  hits?: string;
  /** Pitch for percussion hits (the clock's tick and tock, a drum's tuning). */
  pitch?: string;
  oct?: number;
  vol?: number;
  pan?: number;
  /** Reverb send. */
  verb?: number;
  layer?: number;
  fadeAbove?: number;
}

export interface SectionDef {
  bars: number;
  tracks: TrackDef[];
}

export interface CueDef {
  bpm: number;
  beatsPerBar?: number;
  stepsPerBeat?: number;
  /** Delay of the off-beat sixteenths, as a fraction of a step. */
  swing?: number;
  /** Tempo lean at intensity 1 (0.1 = 10% faster). */
  push?: number;
  gain?: number;
  sections: Record<string, SectionDef>;
  order: string[];
  /** Index into `order` the loop returns to; absent means the cue plays once. */
  loopFrom?: number;
  /** Seconds a one-shot cue rings after its last step. */
  tail?: number;
}

const bars = (...b: string[]) => b.join(" | ");
const times = (s: string, n: number) => Array<string>(n).fill(s).join(" | ");
const quiet = (n: number) => times("................", n);

// ---------------------------------------------------------------------------------------------
// Title: "Mały Sabotaż", a street-band march in F major.

const T_MEL = bars(
  "F4:3 A4:1 C5:3 A4:1 F5:4 C5:4",
  "D5:2 C5:2 Bb4:2 G4:2 A4:6 .:2",
  "E4:3 G4:1 Bb4:3 G4:1 E5:4 C5:4",
  "D5:2 C5:2 Bb4:2 A4:2 G4:6 .:2",
  "F4:3 A4:1 C5:3 A4:1 F5:4 C5:4",
  "D5:4 Db5:4 C5:4 Bb4:2 A4:2",
  "G4:2 A4:2 Bb4:2 B4:2 C5:3 A4:1 G4:3 E4:1",
  "F4:4 .:2 C4:1 .:1 F4:4 .:4",
);
const T_TUBA = bars(
  "F2:3 .:5 C2:3 .:5",
  "Bb1:3 .:5 F2:3 .:5",
  "C2:3 .:5 G1:3 .:5",
  "C2:3 .:5 C2:4 D2:2 E2:2",
  "F2:3 .:5 C2:3 .:5",
  "Bb1:3 .:5 C2:3 .:5",
  "C2:3 .:5 G1:3 .:5",
  "F2:3 .:3 C2:1 .:1 F2:3 .:5",
);
const pah = (a: string, b = a) => `.:4 ${a}:2 .:6 ${b}:2 .:2`;
const cF = "A3+C4+F4", cBb = "Bb3+D4+F4", cC7 = "Bb3+C4+E4", cC7b = "G3+Bb3+E4", cBbm = "Bb3+Db4+F4";
const T_PAH = bars(pah(cF), pah(cBb, cF), pah(cC7), pah(cC7), pah(cF), pah(cBbm, cF), pah(cC7, cC7b), pah(cF));
const T_ARP = bars(
  "F3:2 A3:2 C4:2 A3:2 F3:2 A3:2 C4:2 A3:2",
  "Bb2:2 D3:2 F3:2 D3:2 F3:2 A3:2 C4:2 A3:2",
  "C3:2 E3:2 G3:2 Bb3:2 C4:2 Bb3:2 G3:2 E3:2",
  "C3:2 E3:2 G3:2 Bb3:2 C4:2 Bb3:2 G3:2 E3:2",
  "F3:2 A3:2 C4:2 A3:2 F3:2 A3:2 C4:2 A3:2",
  "Bb2:2 D3:2 Db3:2 F3:2 C3:2 F3:2 A3:2 C4:2",
  "C3:2 E3:2 G3:2 Bb3:2 C4:2 Bb3:2 G3:2 E3:2",
  "F3:2 A3:2 C4:2 F4:2 C4:2 A3:2 F3:4",
);
const MARCH = "X..ox.o.X..ox.oo";
const T_SNARE = [MARCH, MARCH, MARCH, "X..ox.o.X.xxX.x.", MARCH, MARCH, MARCH, "X..ox.o.X...rrrr"].join(" | ");
const T_BD = `${times("X.......X.......", 7)} | X.....x.X.......`;
const CRASH1 = `X............... | ${quiet(7)}`;

// B: the bittersweet turn. A lament bass falls D C Bb Bb(m) A F# G C under the reed.
const T_MEL_B = bars(
  "A4:6 Bb4:2 A4:4 F4:4",
  "G4:6 A4:2 G4:4 E4:4",
  "F4:6 G4:2 A4:4 D5:4",
  "Db5:8 C5:8",
  "C5:6 Bb4:2 A4:4 F4:4",
  "A4:6 F#4:2 D5:4 C5:4",
  "Bb4:6 A4:2 G4:4 D5:4",
  "C5:4 Bb4:2 A4:2 G4:4 E4:4",
);
const T_TUBA_B = bars("D2:8 A1:8", "C2:8 G1:8", "Bb1:8 F2:8", "Bb1:8 F2:8", "A1:8 C2:8", "F#1:8 D2:8", "G1:8 D2:8", "C2:8 E2:4 C2:4");
const T_PAD_B = bars(
  "D3+F3+A3:16", "C3+E3+G3:16", "Bb2+D3+F3:16", "Bb2+Db3+F3:16",
  "A2+C3+F3:16", "F#2+C3+D3:16", "G2+Bb2+D3+F3:16", "G2+Bb2+C3+E3:16",
);
const T_PAH_B = bars(
  pah("D4+F4+A4"), pah("C4+E4+G4"), pah("Bb3+D4+F4"), pah("Bb3+Db4+F4"),
  pah("A3+C4+F4"), pah("F#3+C4+D4"), pah("G3+Bb3+D4"), pah("G3+Bb3+E4"),
);

const title: CueDef = {
  bpm: 116,
  sections: {
    intro: {
      bars: 2,
      tracks: [
        { inst: "snare", hits: "X.o.X.o.X.o.Xxxx | X.o.X.o.rrrrRRRR", vol: 0.85, pan: -0.1 },
        { inst: "bassdrum", hits: "X.......X....... | X.......X.......", vol: 0.8 },
        { inst: "tuba", notes: "F2:3 .:5 C2:3 .:5 | F2:3 .:5 C2:4 D2:2 E2:2", vol: 0.9 },
      ],
    },
    A: {
      bars: 8,
      tracks: [
        { inst: "pulse", notes: T_MEL, vol: 0.9, verb: 0.15 },
        { inst: "fife", notes: T_MEL, oct: 1, vol: 0.45, pan: 0.2, verb: 0.2 },
        { inst: "tuba", notes: T_TUBA, vol: 0.9 },
        { inst: "reed", notes: T_PAH, vol: 0.75, pan: 0.25, verb: 0.15 },
        { inst: "snare", hits: T_SNARE, vol: 0.8, pan: -0.1 },
        { inst: "bassdrum", hits: T_BD, vol: 0.8 },
        { inst: "crash", hits: CRASH1, vol: 0.5, pan: 0.3 },
      ],
    },
    A2: {
      bars: 8,
      tracks: [
        { inst: "pulse", notes: T_MEL, vol: 0.85, verb: 0.15 },
        { inst: "fife", notes: T_MEL, oct: 1, vol: 0.6, pan: 0.2, verb: 0.2 },
        { inst: "glock", notes: T_MEL, oct: 1, vol: 0.45, pan: -0.25, verb: 0.3 },
        { inst: "pluck", notes: T_ARP, vol: 0.5, pan: -0.3, verb: 0.15 },
        { inst: "tuba", notes: T_TUBA, vol: 0.9 },
        { inst: "reed", notes: T_PAH, vol: 0.7, pan: 0.25, verb: 0.15 },
        { inst: "snare", hits: T_SNARE, vol: 0.8, pan: -0.1 },
        { inst: "bassdrum", hits: T_BD, vol: 0.8 },
      ],
    },
    B: {
      bars: 8,
      tracks: [
        { inst: "reed", notes: T_MEL_B, vol: 1, pan: 0.1, verb: 0.25 },
        { inst: "strings", notes: T_PAD_B, vol: 0.8, verb: 0.3 },
        { inst: "pluck", notes: T_PAH_B, vol: 0.45, pan: -0.3, verb: 0.15 },
        { inst: "tuba", notes: T_TUBA_B, vol: 0.75 },
        { inst: "snare", hits: `${times("o...o...o...o...", 7)} | o...o...rrrrRRRR`, vol: 0.7, pan: -0.1 },
        { inst: "bassdrum", hits: `${times("X...............", 7)} | X.......X...X.X.`, vol: 0.7 },
      ],
    },
    A3: {
      bars: 8,
      tracks: [
        { inst: "pulse", notes: T_MEL, vol: 0.85, verb: 0.15 },
        { inst: "fife", notes: T_MEL, oct: 1, vol: 0.6, pan: 0.2, verb: 0.2 },
        { inst: "glock", notes: T_MEL, oct: 1, vol: 0.4, pan: -0.25, verb: 0.3 },
        { inst: "brass", notes: T_MEL, oct: -1, vol: 0.6, pan: -0.1, verb: 0.2 },
        { inst: "pluck", notes: T_ARP, vol: 0.45, pan: -0.3, verb: 0.15 },
        { inst: "tuba", notes: T_TUBA, vol: 0.9 },
        { inst: "reed", notes: T_PAH, vol: 0.7, pan: 0.25, verb: 0.15 },
        { inst: "snare", hits: T_SNARE, vol: 0.85, pan: -0.1 },
        { inst: "bassdrum", hits: T_BD, vol: 0.85 },
        { inst: "crash", hits: CRASH1, vol: 0.5, pan: 0.3 },
      ],
    },
  },
  order: ["intro", "A", "A2", "B", "A3"],
  loopFrom: 1,
};

// ---------------------------------------------------------------------------------------------
// Briefing: D minor, a clock ticking over the sketch map, pizzicato clockwork, a music box.

const B_PIZZ_A = bars(
  "D3:2 A3:2 D4:2 A3:2 E4:2 A3:2 D4:2 A3:2",
  "D3:2 A3:2 D4:2 A3:2 F4:2 A3:2 E4:2 A3:2",
  "Bb2:2 F3:2 Bb3:2 F3:2 C4:2 F3:2 Bb3:2 F3:2",
  "Bb2:2 F3:2 Bb3:2 F3:2 D4:2 F3:2 C4:2 F3:2",
  "G2:2 D3:2 G3:2 D3:2 A3:2 D3:2 G3:2 D3:2",
  "G2:2 D3:2 G3:2 D3:2 Bb3:2 D3:2 A3:2 D3:2",
  "A2:2 E3:2 A3:2 E3:2 C#4:2 E3:2 A3:2 E3:2",
  "A2:2 E3:2 A3:2 E3:2 G3:2 E3:2 C#4:2 E3:2",
);
const B_PIZZ_B = bars(
  "D3:2 A3:2 D4:2 A3:2 E4:2 A3:2 D4:2 A3:2",
  "D3:2 A3:2 D4:2 A3:2 F4:2 A3:2 E4:2 A3:2",
  "C3:2 A3:2 C4:2 A3:2 E4:2 A3:2 C4:2 A3:2",
  "C3:2 A3:2 C4:2 A3:2 F4:2 A3:2 E4:2 A3:2",
  "Bb2:2 F3:2 A3:2 F3:2 D4:2 F3:2 A3:2 F3:2",
  "Bb2:2 F3:2 A3:2 F3:2 C4:2 F3:2 A3:2 F3:2",
  "A2:2 E3:2 A3:2 E3:2 D4:2 E3:2 A3:2 E3:2",
  "A2:2 E3:2 A3:2 E3:2 C#4:2 E3:2 G3:2 E3:2",
);
const TICK: TrackDef = { inst: "tick", hits: "x.......x.......", pitch: "E7", vol: 0.5, pan: 0.15 };
const TOCK: TrackDef = { inst: "tick", hits: "....x.......x...", pitch: "B6", vol: 0.42, pan: 0.15 };

const briefing: CueDef = {
  bpm: 92,
  gain: 1.8,
  sections: {
    a: {
      bars: 8,
      tracks: [
        TICK,
        TOCK,
        { inst: "pizz", notes: B_PIZZ_A, vol: 0.7, pan: -0.15, verb: 0.2 },
        { inst: "strings", notes: "D3+F3+A3:32 | Bb2+D3+F3:32 | G2+Bb2+D3:32 | A2+C#3+E3:32", vol: 0.45, verb: 0.3 },
        {
          inst: "glock",
          notes: bars(".:16", ".:16", ".:16", ".:16", ".:8 D5:2 F5:2 A5:2 G5:2", "F5:4 E5:4 .:8", ".:8 C#5:2 E5:2 A5:2 G5:2", "E5:8 .:8"),
          vol: 0.4, pan: 0.3, verb: 0.35,
        },
        {
          inst: "pencil",
          hits: [
            "................", "....x...........", "..........x.....", "................",
            "................", "..x.............", "............x...", "................",
          ].join(" | "),
          vol: 0.8, pan: -0.35,
        },
      ],
    },
    b: {
      bars: 8,
      tracks: [
        TICK,
        TOCK,
        { inst: "pizz", notes: B_PIZZ_B, vol: 0.7, pan: -0.15, verb: 0.2 },
        { inst: "strings", notes: "D3+F3+A3:32 | C3+F3+A3:32 | Bb2+D3+F3+A3:32 | A2+D3+E3:16 | A2+C#3+E3+G3:16", vol: 0.5, verb: 0.3 },
        { inst: "piano", notes: "D2+D3:32 | C2+C3:32 | Bb1+Bb2:32 | A1+A2:32", vol: 0.35, verb: 0.3 },
        {
          inst: "glock",
          notes: bars(".:16", ".:16", ".:8 A5:2 F5:2 E5:2 D5:2", "E5:8 .:8", ".:16", ".:16", ".:4 E5:2 D5:2 C#5:8", ".:16"),
          vol: 0.4, pan: 0.3, verb: 0.35,
        },
        { inst: "shaker", hits: times("o.o.o.o.o.o.o.o.", 8), vol: 0.35, pan: 0.25 },
        { inst: "tom", hits: times("o...............", 8), pitch: "D2", vol: 0.5 },
        {
          inst: "pencil",
          hits: [
            "......x.........", "................", "................", "x...............",
            "........x.......", "................", "................", "................",
          ].join(" | "),
          vol: 0.8, pan: -0.35,
        },
      ],
    },
  },
  order: ["a", "b"],
  loopFrom: 0,
};

// ---------------------------------------------------------------------------------------------
// Stealth: E minor, a slow heartbeat and space for footsteps. Intensity adds a ticking
// ostinato (0.3), tremolo strings and a drum (0.6), and the enemy's own march snare (0.85).

const HB = (n: string) => `${n}:2 .:1 ${n}:3 .:2 ${n}:2 .:1 ${n}:3 .:2`;
const OST = (a: string, b: string, c: string) => `${a}:2 ${b}:2 ${c}:2 ${b}:2 ${a}:2 ${b}:2 ${c}:2 ${b}:2`;
const S_SNARE: TrackDef = { inst: "snare", hits: "x..ox.o.x..ox.oo", vol: 0.5, pan: -0.15, layer: 0.85 };
const S_SHAKER: TrackDef = { inst: "shaker", hits: "o.o.o.o.o.o.o.o.", vol: 0.55, pan: 0.3, layer: 0.3 };
const S_TOM: TrackDef = { inst: "tom", hits: "x.......x.......", pitch: "E2", vol: 0.7, layer: 0.6 };

const stealth: CueDef = {
  bpm: 84,
  push: 0.1,
  sections: {
    s1: {
      bars: 8,
      tracks: [
        { inst: "bass", notes: bars(HB("E2"), HB("E2"), HB("C2"), HB("C2"), HB("A1"), HB("A1"), HB("B1"), HB("B1")), vol: 0.65 },
        { inst: "strings", notes: "E3+G3+B3:32 | C3+E3+G3+B3:32 | A2+C3+E3:32 | B2+E3+F#3+A3:16 | B2+D#3+F#3+A3:16", vol: 0.45, verb: 0.3 },
        {
          inst: "piano",
          notes: bars(".:16", ".:8 B4:4 .:4", ".:16", ".:4 G4:4 F#4:4 .:4", ".:16", ".:8 C5:4 .:4", ".:16", ".:4 A4:4 D#4:8"),
          vol: 0.55, pan: 0.2, verb: 0.4,
        },
        S_SHAKER,
        {
          inst: "pizz",
          notes: bars(
            OST("E3", "B3", "E4"), OST("E3", "B3", "G4"), OST("C3", "G3", "E4"), OST("C3", "G3", "B3"),
            OST("A2", "E3", "C4"), OST("A2", "E3", "A3"), OST("B2", "F#3", "A3"), OST("B2", "D#3", "A3"),
          ),
          vol: 0.55, pan: -0.2, verb: 0.2, layer: 0.3,
        },
        { inst: "trem", notes: "B3+C4:32 | B3+C4:32 | A3+B3:32 | A3+C4:32", vol: 0.6, verb: 0.25, layer: 0.6 },
        S_TOM,
        S_SNARE,
        {
          inst: "horn",
          notes: bars("E3+G3+B3:4 .:12", ".:16", "C3+E3+G3:4 .:12", ".:16", "A2+C3+E3:4 .:12", ".:16", "B2+D#3+F#3:4 .:12", ".:16"),
          vol: 0.6, verb: 0.3, layer: 0.85,
        },
      ],
    },
    s2: {
      bars: 8,
      tracks: [
        { inst: "bass", notes: bars(HB("E2"), HB("E2"), HB("E2"), HB("E2"), HB("A1"), HB("A1"), HB("B1"), HB("B1")), vol: 0.65 },
        { inst: "strings", notes: "E3+G3+B3:32 | F3+A3+C4:32 | A2+C3+E3:16 | G2+C3+E3:16 | B2+D#3+F#3+A3:32", vol: 0.45, verb: 0.3 },
        {
          inst: "piano",
          notes: bars(".:16", ".:4 E5:4 D5:4 B4:4", ".:16", ".:8 C5:4 B4:4", ".:16", ".:8 A4:4 G4:4", ".:16", ".:4 F#4:4 D#4:8"),
          vol: 0.55, pan: 0.2, verb: 0.4,
        },
        S_SHAKER,
        {
          inst: "pizz",
          notes: bars(
            OST("E3", "B3", "E4"), OST("E3", "B3", "G4"),
            "E3:2 C4:2 F4:2 C4:2 E3:2 C4:2 A3:2 C4:2", "E3:2 C4:2 F4:2 C4:2 E3:2 C4:2 A3:2 C4:2",
            OST("A2", "E3", "C4"), OST("G2", "E3", "C4"), OST("B2", "F#3", "A3"), OST("B2", "D#3", "A3"),
          ),
          vol: 0.55, pan: -0.2, verb: 0.2, layer: 0.3,
        },
        { inst: "trem", notes: "B3+C4:32 | E4+F4:32 | A3+B3:32 | A3+C4:32", vol: 0.6, verb: 0.25, layer: 0.6 },
        S_TOM,
        S_SNARE,
        {
          inst: "horn",
          notes: bars("E3+G3+B3:4 .:12", ".:16", "F3+A3+C4:4 .:12", ".:16", "A2+C3+E3:4 .:12", ".:16", "B2+D#3+F#3:4 .:12", ".:16"),
          vol: 0.6, verb: 0.3, layer: 0.85,
        },
      ],
    },
  },
  order: ["s1", "s2"],
  loopFrom: 0,
};

// ---------------------------------------------------------------------------------------------
// Action: D minor, 144 bpm, driving bass and snare.

const DRV = (r: string, h: string) => `${r}:2 ${r}:2 ${h}:2 ${r}:2 ${r}:2 ${h}:2 ${r}:2 ${h}:2`;
const DRV2 = (r1: string, h1: string, r2: string, h2: string) => `${r1}:2 ${r1}:2 ${h1}:2 ${r1}:2 ${r2}:2 ${r2}:2 ${h2}:2 ${r2}:2`;
const STAB = (c: string) => `${c}:2 .:8 ${c}:2 .:4`;
const S16 = (n: string) => Array<string>(16).fill(`${n}:1`).join(" ");
const A16 = (a: string, b: string, c: string) => Array<string>(4).fill(`${a}:1 ${b}:1 ${c}:1 ${b}:1`).join(" ");
const cDm = "D4+F4+A4", cBb4 = "D4+F4+Bb4", cC = "C4+E4+G4", cGm = "D4+G4+Bb4", cA = "C#4+E4+A4";
const KICK = "X.....x.X.....x.";
const SNR = "....X..o....X.o.";
const SNR_FILL = "....X..oX.XXRRRR";
const HAT8 = "x.x.x.x.x.x.x.x.";
const HAT16 = ".o.o.o.o.o.o.o.o";

const A_LEAD = bars(
  "D5:2 .:1 D5:1 F5:2 E5:2 D5:2 .:2 A4:4",
  "D5:2 .:1 D5:1 F5:2 G5:2 A5:4 .:4",
  "Bb5:2 A5:2 G5:2 F5:2 G5:4 D5:4",
  "E5:2 D5:2 C5:2 E5:2 G5:4 .:4",
  "D5:2 .:1 D5:1 F5:2 E5:2 D5:2 .:2 A4:4",
  "D5:2 .:1 D5:1 F5:2 G5:2 A5:4 C6:4",
  "Bb5:3 A5:3 G5:2 D5:4 G5:4",
  "A5:4 G5:2 F5:2 E5:2 C#5:2 A4:4",
);
const A_BASS = bars(DRV("D2", "D3"), DRV("D2", "D3"), DRV("Bb1", "Bb2"), DRV("C2", "C3"), DRV("D2", "D3"), DRV("D2", "D3"), DRV("G1", "G2"), DRV("A1", "A2"));
const A_STABS = bars(STAB(cDm), STAB(cDm), STAB(cBb4), STAB(cC), STAB(cDm), STAB(cDm), STAB(cGm), STAB(cA));
const A_DRUMS: TrackDef[] = [
  { inst: "kick", hits: KICK, vol: 0.75 },
  { inst: "snare", hits: `${times(SNR, 7)} | ${SNR_FILL}`, vol: 0.85, pan: -0.1, verb: 0.1 },
  { inst: "hat", hits: HAT8, vol: 0.7, pan: 0.25 },
  { inst: "hat", hits: HAT16, vol: 0.55, pan: -0.25, layer: 0.5 },
];
const B_BRASS = bars(
  "F4:6 G4:2 A4:4 Bb4:4",
  "C5:6 Bb4:2 A4:4 G4:4",
  "A4:6 F4:2 D4:8",
  ".:16",
  "F4:6 G4:2 A4:4 Bb4:4",
  "C5:6 D5:2 E5:4 G5:4",
  "A4:6 C#5:2 E5:4 A5:4",
  "G5:4 F5:4 E5:4 C#5:4",
);

const action: CueDef = {
  bpm: 144,
  push: 0.06,
  sections: {
    a: {
      bars: 8,
      tracks: [
        ...A_DRUMS,
        { inst: "crash", hits: CRASH1, vol: 0.55, pan: 0.3 },
        { inst: "bass", notes: A_BASS, vol: 0.75 },
        { inst: "brass", notes: A_STABS, vol: 0.65, pan: 0.15, verb: 0.15 },
        { inst: "pulse", notes: A_LEAD, vol: 0.95, verb: 0.15 },
        { inst: "pluck", notes: bars(S16("A4"), S16("A4"), S16("F4"), S16("G4"), S16("A4"), S16("A4"), S16("G4"), S16("E4")), vol: 0.35, pan: -0.3, layer: 0.5 },
        { inst: "timp", notes: bars("D2:16", "D2:16", "Bb1:16", "C2:16", "D2:16", "D2:16", "G2:16", "A1:16"), vol: 0.8, layer: 0.8 },
      ],
    },
    b: {
      bars: 8,
      tracks: [
        { inst: "kick", hits: KICK, vol: 0.75 },
        { inst: "snare", hits: `${times(SNR, 3)} | ${SNR_FILL} | ${times(SNR, 3)} | ${SNR_FILL}`, vol: 0.85, pan: -0.1, verb: 0.1 },
        { inst: "hat", hits: HAT8, vol: 0.7, pan: 0.25 },
        { inst: "hat", hits: HAT16, vol: 0.55, pan: -0.25, layer: 0.5 },
        { inst: "bass", notes: bars(DRV("Bb1", "Bb2"), DRV("C2", "C3"), DRV("D2", "D3"), DRV("D2", "D3"), DRV("Bb1", "Bb2"), DRV("C2", "C3"), DRV("A1", "A2"), DRV("A1", "A2")), vol: 0.75 },
        { inst: "brass", notes: B_BRASS, vol: 0.85, verb: 0.2 },
        { inst: "reed", notes: bars(STAB(cBb4), STAB(cC), STAB(cDm), STAB(cDm), STAB(cBb4), STAB(cC), STAB(cA), STAB(cA)), vol: 0.6, pan: 0.25, verb: 0.15 },
        { inst: "pluck", notes: bars(S16("F4"), S16("G4"), S16("A4"), S16("A4"), S16("F4"), S16("G4"), S16("E4"), S16("E4")), vol: 0.35, pan: -0.3, layer: 0.5 },
        { inst: "timp", notes: bars("Bb1:16", "C2:16", "D2:16", "D2:16", "Bb1:16", "C2:16", "A1:16", "A1:16"), vol: 0.8, layer: 0.8 },
      ],
    },
    c: {
      bars: 8,
      tracks: [
        { inst: "kick", hits: `${times("X.......X.......", 7)} | X.X.X.X.X.X.X.X.`, vol: 0.75 },
        { inst: "snare", hits: `${times("........X.......", 7)} | X.X.X.X.RRRRRRRR`, vol: 0.85, pan: -0.1, verb: 0.15 },
        { inst: "hat", hits: HAT8, vol: 0.6, pan: 0.25 },
        { inst: "bass", notes: bars(DRV("G1", "G2"), DRV("A1", "A2"), DRV("D2", "D3"), DRV("Bb1", "Bb2"), DRV("G1", "G2"), DRV("Eb2", "Eb3"), DRV("A1", "A2"), DRV("A1", "A2")), vol: 0.75 },
        {
          inst: "pulse",
          notes: bars(A16("G4", "Bb4", "D5"), A16("A4", "C#5", "E5"), A16("A4", "D5", "F5"), A16("Bb4", "D5", "F5"), A16("G4", "Bb4", "D5"), A16("G4", "Bb4", "Eb5"), A16("A4", "C#5", "E5"), A16("G4", "C#5", "E5")),
          vol: 0.55, pan: 0.2, verb: 0.15,
        },
        { inst: "brass", notes: bars("G4:16", "A4:16", "F4:16", "F4:16", "G4:16", "G4:16", "E4:16", "C#5:16"), vol: 0.7, verb: 0.25 },
        { inst: "strings", notes: bars("G3+Bb3+D4:16", "A3+C#4+E4:16", "A3+D4+F4:16", "Bb3+D4+F4:16", "G3+Bb3+D4:16", "G3+Bb3+Eb4:16", "A3+C#4+E4:16", "G3+A3+C#4+E4:16"), vol: 0.6, verb: 0.3 },
        { inst: "timp", notes: "G2:8 G2:8 | A1:8 A1:8 | D2:16 | Bb1:16 | G2:16 | Eb2:16 | A1:4 A1:4 A1:4 A1:4 | A1:2 A1:2 A1:2 A1:2 A1:2 A1:2 A1:2 A1:2", vol: 0.8, layer: 0.8 },
      ],
    },
  },
  order: ["a", "b", "a", "c"],
  loopFrom: 0,
};

// ---------------------------------------------------------------------------------------------
// Finale: the action cue bigger. The march's head motif returns in D minor, then the whole
// march tune in F major over the driving bass, then the action theme with the motif as a
// horn call.

const F_MEL1 = bars(
  "D4:3 F4:1 A4:3 F4:1 D5:4 A4:4",
  "Bb4:2 A4:2 G4:2 E4:2 F4:6 .:2",
  "C#4:3 E4:1 G4:3 E4:1 C#5:4 A4:4",
  "Bb4:2 A4:2 G4:2 F4:2 E4:6 .:2",
  "D4:3 F4:1 A4:3 F4:1 D5:4 A4:4",
  "Bb4:4 A4:4 G4:4 F4:2 E4:2",
  "E4:2 F4:2 G4:2 G#4:2 A4:3 F4:1 E4:3 C#4:1",
  "D4:4 .:2 A3:1 .:1 D4:4 .:4",
);
const F_DRUMS: TrackDef[] = [
  { inst: "kick", hits: KICK, vol: 0.75 },
  { inst: "snare", hits: `${times(SNR, 7)} | ${SNR_FILL}`, vol: 0.85, pan: -0.1, verb: 0.12 },
  { inst: "hat", hits: HAT8, vol: 0.7, pan: 0.25 },
  { inst: "hat", hits: HAT16, vol: 0.5, pan: -0.25 },
  { inst: "crash", hits: `X............... | ${quiet(3)} | X............... | ${quiet(3)}`, vol: 0.55, pan: 0.3 },
];

const finale: CueDef = {
  bpm: 144,
  push: 0.04,
  sections: {
    f1: {
      bars: 8,
      tracks: [
        ...F_DRUMS,
        { inst: "brass", notes: F_MEL1, vol: 0.95, verb: 0.2 },
        { inst: "pulse", notes: F_MEL1, oct: 1, vol: 0.5, pan: 0.2, verb: 0.15 },
        { inst: "bass", notes: bars(DRV("D2", "D3"), DRV2("G1", "G2", "D2", "D3"), DRV("A1", "A2"), DRV("A1", "A2"), DRV("D2", "D3"), DRV2("G1", "G2", "A1", "A2"), DRV("A1", "A2"), DRV("D2", "D3")), vol: 0.75 },
        { inst: "reed", notes: bars(STAB(cDm), `${cGm}:2 .:6 ${cDm}:2 .:6`, STAB(cA), STAB(cA), STAB(cDm), `${cGm}:2 .:6 ${cA}:2 .:6`, STAB(cA), STAB(cDm)), vol: 0.55, pan: 0.3, verb: 0.15 },
        { inst: "strings", notes: bars("D3+F3+A3:16", "D3+G3+Bb3:8 D3+F3+A3:8", "C#3+E3+G3+A3:32", "D3+F3+A3:16", "D3+G3+Bb3:8 C#3+E3+A3:8", "C#3+E3+G3+A3:16", "D3+F3+A3:16"), vol: 0.6, verb: 0.3 },
        { inst: "timp", notes: bars("D2:16", "G2:8 D2:8", "A1:16", "A1:16", "D2:16", "G2:8 A1:8", "A1:16", "D2:4 .:4 D2:4 .:4"), vol: 0.85 },
      ],
    },
    f2: {
      bars: 8,
      tracks: [
        ...F_DRUMS,
        { inst: "brass", notes: T_MEL, vol: 1, verb: 0.2 },
        { inst: "fife", notes: T_MEL, oct: 1, vol: 0.65, pan: 0.2, verb: 0.2 },
        { inst: "glock", notes: T_MEL, oct: 1, vol: 0.4, pan: -0.25, verb: 0.3 },
        { inst: "bass", notes: bars(DRV("F2", "F3"), DRV2("Bb1", "Bb2", "F2", "F3"), DRV("C2", "C3"), DRV("C2", "C3"), DRV("F2", "F3"), DRV2("Bb1", "Bb2", "C2", "C3"), DRV("C2", "C3"), DRV("F2", "F3")), vol: 0.75 },
        { inst: "strings", notes: bars("A3+C4+F4:16", "Bb3+D4+F4:8 A3+C4+F4:8", "Bb3+C4+E4:32", "A3+C4+F4:16", "Bb3+Db4+F4:8 A3+C4+F4:8", "G3+Bb3+C4+E4:16", "A3+C4+F4:16"), vol: 0.65, verb: 0.3 },
        { inst: "pluck", notes: T_ARP, vol: 0.45, pan: -0.3, verb: 0.15 },
        { inst: "timp", notes: bars("F2:16", "Bb1:8 F2:8", "C2:16", "C2:16", "F2:16", "Bb1:8 C2:8", "C2:16", "F2:4 .:4 F2:4 .:4"), vol: 0.85 },
      ],
    },
    f3: {
      bars: 8,
      tracks: [
        ...F_DRUMS,
        { inst: "bass", notes: A_BASS, vol: 0.75 },
        { inst: "brass", notes: A_STABS, vol: 0.6, pan: 0.15, verb: 0.15 },
        { inst: "pulse", notes: A_LEAD, vol: 0.95, verb: 0.15 },
        { inst: "horn", notes: bars("D4:3 F4:1 A4:3 F4:1 D5:4 A4:4", ".:16", ".:16", ".:16", "D4:3 F4:1 A4:3 F4:1 D5:4 A4:4", ".:16", ".:16", ".:16"), vol: 0.8, pan: -0.2, verb: 0.3 },
        { inst: "pluck", notes: bars(S16("A4"), S16("A4"), S16("F4"), S16("G4"), S16("A4"), S16("A4"), S16("G4"), S16("E4")), vol: 0.35, pan: -0.3 },
        { inst: "timp", notes: bars("D2:16", "D2:16", "Bb1:16", "C2:16", "D2:16", "D2:16", "G2:16", "A1:8 A1:4 A1:4"), vol: 0.85 },
      ],
    },
  },
  order: ["f1", "f2", "f3"],
  loopFrom: 0,
};

// ---------------------------------------------------------------------------------------------
// The history note: D minor, slow, a lone piano over a held chord. Never a joke.

const note: CueDef = {
  bpm: 54,
  gain: 0.7,
  sections: {
    n: {
      bars: 12,
      tracks: [
        {
          inst: "strings",
          notes: bars(
            "D3+F3+A3:16", "Bb2+D3+F3:16", "A2+C3+F3:16", "G2+Bb2+D3:16", "F2+A2+D3:16", "E2+G2+Bb2+D3:16",
            "A2+D3+E3:16", "A2+C#3+E3:16", "D3+F3+A3:16", "Bb2+D3+F3:16", "G2+Bb2+D3+E3:16", "A2+C#3+E3:16",
          ),
          vol: 0.55, verb: 0.35,
        },
        {
          inst: "piano",
          notes: bars(
            ".:8 A4:8", "Bb4:8 A4:4 F4:4", "A4:4 G4:4 F4:8", ".:4 D4:4 G4:4 A4:4", "Bb4:8 A4:8", "G4:12 Bb4:4",
            "A4:4 E4:4 D4:8", "C#4:12 .:4", ".:8 F4:4 A4:4", "D5:8 C5:4 Bb4:4", "A4:8 G4:4 E4:4", "A4:16",
          ),
          vol: 0.8, pan: 0.1, verb: 0.4,
        },
        {
          inst: "piano",
          notes: bars(
            "D2+A2:16", "Bb1+F2:16", "A1+F2:16", "G1+D2:16", "F1+D2:16", "E1+Bb1:16",
            "A1+E2:16", "A1+E2:16", "D2+A2:16", "Bb1+F2:16", "G1+D2:16", "A1+E2:16",
          ),
          vol: 0.45, pan: -0.1, verb: 0.35,
        },
      ],
    },
  },
  order: ["n"],
  loopFrom: 0,
};

// ---------------------------------------------------------------------------------------------
// The fallen: a short sting. A muffled drum roll, and the march's motif slowed down in minor.

const fallen: CueDef = {
  bpm: 76,
  sections: {
    s: {
      bars: 2,
      tracks: [
        { inst: "tom", hits: "rrrrrrrr........ | x...............", pitch: "D2", vol: 0.45 },
        { inst: "strings", notes: "D3+F3+A3:16 | Bb2+D3+F3:8 A2+D3+F3:8", vol: 0.7, verb: 0.35 },
        { inst: "horn", notes: "D4:3 F4:1 A4:8 G4:2 F4:2 | E4:6 A3:2 D4:8", vol: 0.9, verb: 0.35 },
        { inst: "piano", notes: "D2+A2:16 | .:8 D2+D3:8", vol: 0.6, verb: 0.3 },
      ],
    },
  },
  order: ["s"],
  tail: 3,
};

export const CUES: Record<Music, CueDef> = { title, briefing, stealth, action, finale, note, fallen };
