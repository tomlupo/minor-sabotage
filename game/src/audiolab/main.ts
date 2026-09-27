// Sound lab (dev only, audio.html): a button for every sound, loop and music cue, and
// window.__audioReport(), which renders each of them offline through the game's own graphs
// and measures them, because nobody can listen in a headless browser.
//
//   node tools/shot.mjs --page audio.html --steps '[{"eval":"window.__audioReport()"},{"shot":"audio"}]'
//
// __audioReport() returns a text table plus the checks; __audioReport("json") the raw rows.
import { type Engine, LOOP_LIST, MUSIC_LIST, SFX_LIST, audio, type Loop, type Music, type Sfx } from "../audio";
import { AMB_EVENTS, type AmbEvent } from "../audio/ambience";
import { type Stats, analyse, chroma } from "../audio/analysis";
import { DEFAULT_MUSIC, DEFAULT_SFX } from "../audio/master";
import { type Rendered, renderAmbEvent, renderAmbience, renderLoop, renderMix, renderMusic, renderSfx } from "../audio/offline";
import { cueSeconds, getCue } from "../audio/sequencer";

const eng = audio as Engine;
const root = document.getElementById("lab")!;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = "", attrs: Record<string, string> = {}): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (text) e.textContent = text;
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

function section(title: string): HTMLDivElement {
  const row = el("div", "", { class: "row" });
  root.append(el("h2", title), row);
  return row;
}

function button(row: HTMLElement, label: string, fn: (b: HTMLButtonElement) => void): HTMLButtonElement {
  const b = el("button", label);
  b.addEventListener("click", () => {
    audio.unlock();
    fn(b);
  });
  row.append(b);
  return b;
}

function slider(row: HTMLElement, label: string, min: number, max: number, step: number, value: number, fn: (v: number) => void): HTMLInputElement {
  const l = el("label", label);
  const s = el("input", "", { type: "range", min: String(min), max: String(max), step: String(step), value: String(value) });
  const out = el("span", String(value));
  s.addEventListener("input", () => {
    out.textContent = s.value;
    fn(Number(s.value));
  });
  l.append(s, out);
  row.append(l);
  return s;
}

// ---------------------------------------------------------------------------------------------
// Audition

const status = el("div", "", { id: "status" });
root.append(status);

const mix = section("mix");
let muted = false;
button(mix, "unlock", () => {});
button(mix, "mute", (b) => {
  muted = !muted;
  b.classList.toggle("on", muted);
  audio.setMuted(muted);
});
let vMusic = DEFAULT_MUSIC;
let vSfx = DEFAULT_SFX;
slider(mix, "music", 0, 1, 0.05, vMusic, (v) => audio.setVolumes((vMusic = v), vSfx));
slider(mix, "sfx", 0, 1, 0.05, vSfx, (v) => audio.setVolumes(vMusic, (vSfx = v)));
button(mix, "duck 0.7 for 1.5 s", () => audio.duck(0.7, 1.5));

const where = section("position (listener at 0, 0; metres)");
let positional = false;
let px = 20;
let py = 0;
button(where, "positional", (b) => {
  positional = !positional;
  b.classList.toggle("on", positional);
});
slider(where, "x", -80, 80, 1, px, (v) => (px = v));
slider(where, "y", -40, 40, 1, py, (v) => (py = v));
const at = () => (positional ? { x: px, y: py } : {});

const sfxRow = section("sound effects");
for (const s of SFX_LIST) button(sfxRow, s, () => audio.play(s, at()));

const loopRow = section("loops");
const loopRate: Record<string, number> = {};
const loopOn: Record<string, boolean> = {};
for (const l of LOOP_LIST) {
  loopRate[l] = 1;
  const b = button(loopRow, l, () => {
    loopOn[l] = !loopOn[l];
    b.classList.toggle("on", loopOn[l]);
    audio.loop(l, `lab-${l}`, loopOn[l] ? { rate: loopRate[l], ...at() } : null);
  });
  slider(loopRow, "rate", 0.5, 3, 0.1, 1, (v) => {
    loopRate[l] = v;
    if (loopOn[l]) audio.loop(l, `lab-${l}`, { rate: v, ...at() });
  });
}

const musicRow = section("music");
let fade = 1.2;
const cueButtons = new Map<string, HTMLButtonElement>();
for (const m of MUSIC_LIST) {
  const secs = cueSeconds(getCue(m));
  cueButtons.set(m, button(musicRow, `${m} (${Math.round(secs.loop || secs.total)} s)`, () => audio.music(m, fade)));
}
button(musicRow, "stop", () => audio.music(null, fade));
const musicRow2 = el("div", "", { class: "row" });
root.append(musicRow2);
slider(musicRow2, "intensity", 0, 1, 0.05, 0, (v) => audio.intensity(v));
slider(musicRow2, "fade s", 0, 4, 0.1, fade, (v) => (fade = v));

const ambRow = section("ambience");
let ambOn = false;
button(ambRow, "Warsaw afternoon", (b) => {
  ambOn = !ambOn;
  b.classList.toggle("on", ambOn);
  audio.ambience(ambOn);
});
for (const e of AMB_EVENTS) button(ambRow, e, () => eng.ambienceEvent(e));

setInterval(() => {
  const busy = eng.busy;
  const peak = eng.meter();
  const db = peak > 1e-5 ? `${(20 * Math.log10(peak)).toFixed(0)} dBFS` : "silent";
  status.textContent = `context: ${eng.state} · music: ${eng.currentMusic ?? "none"} · voices: ${busy.voices} · loops: ${busy.loops} · output: ${db}`;
  for (const [m, b] of cueButtons) b.classList.toggle("on", eng.currentMusic === m);
}, 250);

// ---------------------------------------------------------------------------------------------
// Report

interface Row extends Stats {
  name: string;
  kind: string;
  flags: string[];
}

/** Expected rendered length of each effect, in seconds. */
const DUR: Partial<Record<Sfx, [number, number]>> = {
  sten: [0.2, 1.1], pistol: [0.15, 1.1], rifle: [0.6, 1.3], mp40: [0.2, 1.3],
  grenade_throw: [0.2, 0.95], explosion: [1.2, 4.6], explosion_far: [1.5, 4.8],
  bottle_throw: [0.2, 0.95], bottle_smash: [0.5, 2.4], fire_whoosh: [0.5, 2.3],
  knife: [0.1, 0.5], body_fall: [0.3, 0.9], hit: [0.05, 0.4], ricochet: [0.3, 1], glass: [0.6, 1.8],
  step: [0.04, 0.3], whistle: [1, 1.9], shout: [0.5, 1.2],
  truck_brake: [0.8, 2], car_door: [0.15, 0.75], truck_doors: [0.9, 2.15], car_start: [1.5, 2.8],
  tram_bell: [0.6, 5], pigeons: [0.6, 2],
  ui_tap: [0.01, 0.2], ui_ok: [0.05, 0.6], ui_back: [0.05, 0.5], ui_pause: [0.05, 0.4], ui_go: [0.1, 0.7], ui_alert: [0.1, 0.6],
  typewriter: [0.02, 0.2], paper: [0.2, 0.7], promotion: [0.6, 3.7], fallen: [1, 3.4], mission_done: [1.2, 4.6],
};

async function measure(rows: Row[], name: string, kind: string, r: Promise<Rendered>, dur?: [number, number]): Promise<Rendered> {
  const x = await r;
  const s = analyse(x.post, x.sr, x.pre);
  const flags: string[] = [];
  if (s.silent) flags.push("SILENT");
  if (s.clips) flags.push("CLIPS");
  if (dur && (s.dur < dur[0] || s.dur > dur[1])) flags.push(`DUR∉[${dur[0]},${dur[1]}]`);
  // an effect still sounding when its render ends was cut short (its `len` is too small)
  if (kind === "sfx" && s.dur > x.post[0].length / x.sr - 0.02) flags.push("TRUNCATED");
  rows.push({ name, kind, ...s, flags });
  return x;
}

// What key each cue is written in: its scale's pitch classes (minor keys with the raised
// seventh they use). The render's chromagram should sit mostly inside them.
const PC = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const scale = (root: number, minor: boolean) => (minor ? [0, 2, 3, 5, 7, 8, 10, 11] : [0, 2, 4, 5, 7, 9, 11]).map((i) => (root + i) % 12);
const KEY: Record<Music, [string, number[]]> = {
  title: ["F major", scale(5, false)],
  briefing: ["D minor", scale(2, true)],
  stealth: ["E minor", scale(4, true)],
  action: ["D minor", scale(2, true)],
  finale: ["D minor, F major", [...new Set([...scale(2, true), ...scale(5, false)])]],
  note: ["D minor", scale(2, true)],
  fallen: ["D minor", scale(2, true)],
};
const IN_KEY = 0.8;

function keyCheck(m: Music, x: Rendered): { line: string; ok: boolean } {
  const mono = x.post[0].map((v, i) => (v + x.post[1][i]) / 2);
  const c = chroma(mono, x.sr);
  const [name, pcs] = KEY[m];
  const inKey = pcs.reduce((a, pc) => a + c[pc], 0);
  const top = c.map((v, i) => [v, i] as const).sort((a, b) => b[0] - a[0]).slice(0, 4).map(([, i]) => PC[i]).join(" ");
  const ok = inKey >= IN_KEY;
  return { line: `${m}: ${Math.round(inKey * 100)}% in ${name} (strongest ${top}) ${ok ? "OK" : "OFF KEY"}`, ok };
}

const f = (v: number, d = 1) => (v <= -179 ? "-inf" : v.toFixed(d));

function table(rows: Row[]): string {
  const head = ["name", "kind", "dur s", "peak", "pre", "rms dB", "loud dB", "phone dB", "centroid", "flags"];
  const body = rows.map((r) => [
    r.name, r.kind, r.dur.toFixed(2), r.peak.toFixed(3), r.peakPre.toFixed(2), f(r.rmsDb), f(r.loudDb), f(r.phoneDb),
    String(Math.round(r.centroid)), r.flags.join(" "),
  ]);
  const w = head.map((h, i) => Math.max(h.length, ...body.map((b) => b[i].length)));
  const line = (c: string[]) => c.map((v, i) => (i < 2 ? v.padEnd(w[i]) : v.padStart(w[i]))).join("  ").trimEnd();
  return [line(head), ...body.map(line)].join("\n");
}

function checks(rows: Row[]): { ok: boolean; lines: string[] } {
  const by = (n: string) => rows.find((r) => r.name === n)!;
  const lines: string[] = [];
  let ok = true;
  const silent = rows.filter((r) => r.silent).map((r) => r.name);
  const clips = rows.filter((r) => r.clips).map((r) => r.name);
  const dur = rows.filter((r) => r.flags.some((x) => x.startsWith("DUR") || x === "TRUNCATED")).map((r) => r.name);
  lines.push(`silent: ${silent.join(", ") || "none"}`);
  lines.push(`clipping (peak >= 0.99): ${clips.join(", ") || "none"}; highest peak ${Math.max(...rows.map((r) => r.peak)).toFixed(3)}`);
  lines.push(`durations outside expectation: ${dur.join(", ") || "none"}`);
  ok &&= !silent.length && !clips.length && !dur.length;
  for (const key of ["loudDb", "phoneDb"] as const) {
    const chain = ["explosion", "rifle", "sten", "pistol", "step"].map(by);
    const inOrder = chain.every((r, i) => i === 0 || chain[i - 1][key] > r[key]);
    lines.push(`order by ${key}: ${chain.map((r) => `${r.name} ${f(r[key])}`).join(" > ")} ${inOrder ? "OK" : "WRONG"}`);
    const ui = rows.filter((r) => r.name.startsWith("ui_"));
    const loudest = ui.reduce((a, b) => (b[key] > a[key] ? b : a));
    const uiOk = loudest[key] < by("pistol")[key] - 6;
    lines.push(`UI quiet by ${key}: loudest ${loudest.name} ${f(loudest[key])} vs pistol ${f(by("pistol")[key])} - 6 ${uiOk ? "OK" : "TOO LOUD"}`);
    ok &&= inOrder && uiOk;
  }
  lines.unshift(ok ? "CHECKS: all passed" : "CHECKS: FAILED");
  return { ok, lines };
}

async function report(fmt?: string): Promise<string | Row[]> {
  const rows: Row[] = [];
  const t0 = performance.now();
  for (const [i, s] of SFX_LIST.entries()) await measure(rows, s, "sfx", renderSfx(s, 100 + i), DUR[s]);
  await measure(rows, "sten burst x4", "sfx", renderSfx("sten", 7, { rounds: 4 }), [0.4, 1.1]);
  await measure(rows, "mp40 burst x3", "sfx", renderSfx("mp40", 10, { rounds: 3 }), [0.4, 1.3]);
  await measure(rows, "sten @30m", "sfx", renderSfx("sten", 8, { x: 30, y: 0 }));
  await measure(rows, "explosion @55m", "sfx", renderSfx("explosion", 9, { x: 40, y: 38 }));
  const loops: [Loop, number][] = [["truck_engine", 1], ["truck_engine", 2.5], ["car_engine", 1], ["car_engine", 2.2], ["fire", 1], ["crowd_panic", 1]];
  for (const [l, rate] of loops) await measure(rows, `${l} r${rate}`, "loop", renderLoop(l, 4, { rate }));
  const music: [Music, number, number][] = [
    ["title", 14, 0], ["briefing", 10, 0], ["stealth", 10, 0], ["stealth", 10, 1], ["action", 10, 0], ["action", 10, 1],
    ["finale", 10, 1], ["note", 12, 0], ["fallen", 10, 0],
  ];
  const keys: { line: string; ok: boolean }[] = [];
  for (const [m, sec, lvl] of music) {
    const x = await measure(rows, `${m} i${lvl}`, "music", renderMusic(m, sec, lvl));
    if (lvl === 0 || m === "finale") keys.push(keyCheck(m, x));
  }
  await measure(rows, "ambience bed", "amb", renderAmbience(8));
  const evLen: Record<AmbEvent, number> = { tram: 8.5, dog: 2.5, cart: 7.5, car: 6.5, sparrows: 3, pigeons: 2, bells: 24 };
  for (const e of AMB_EVENTS) await measure(rows, `amb ${e}`, "amb", renderAmbEvent(e, evLen[e]));
  await measure(rows, "firefight mix", "mix", renderMix(6));
  const secs = ((performance.now() - t0) / 1000).toFixed(1);

  const c = checks(rows);
  c.lines.push(`key (at least ${IN_KEY * 100}% of 110 Hz-1.8 kHz energy in the scale):`, ...keys.map((k) => `  ${k.line}`));
  if (!keys.every((k) => k.ok)) {
    c.ok = false;
    c.lines[0] = "CHECKS: FAILED";
  }
  const cues = MUSIC_LIST.map((m) => {
    const s = cueSeconds(getCue(m));
    return `${m} ${s.loop ? `loops ${s.loop.toFixed(1)} s` : `plays ${s.total.toFixed(1)} s once`}`;
  }).join(" · ");
  const text = `${table(rows)}\n\n${c.lines.join("\n")}\ncue lengths: ${cues}\nrendered ${rows.length} items in ${secs} s`;
  showReport(rows, text);
  (window as unknown as { __audioStats: Row[] }).__audioStats = rows;
  return fmt === "json" ? rows : text;
}

const reportRow = section("report");
const reportOut = el("pre");
root.append(reportOut);
button(reportRow, "render and measure everything", async (b) => {
  b.disabled = true;
  reportOut.textContent = "rendering…";
  await report();
  b.disabled = false;
});

function showReport(rows: Row[], text: string): void {
  const tbl = el("table");
  const tr = el("tr");
  for (const h of ["name", "kind", "dur s", "peak", "pre", "rms", "loud", "phone", "centroid", "flags"]) tr.append(el("th", h));
  tbl.append(tr);
  for (const r of rows) {
    const row = el("tr");
    const cells = [r.name, r.kind, r.dur.toFixed(2), r.peak.toFixed(3), r.peakPre.toFixed(2), f(r.rmsDb), f(r.loudDb), f(r.phoneDb), String(Math.round(r.centroid)), r.flags.join(" ")];
    cells.forEach((c, i) => row.append(el("td", c, i === 9 && c ? { class: "bad" } : {})));
    tbl.append(row);
  }
  reportOut.textContent = text.slice(text.indexOf("\n\n") + 2);
  reportOut.before(tbl);
}

(window as unknown as { __audioReport: typeof report }).__audioReport = report;
// the live engine, for scripted checks through the harness
(window as unknown as { __audio: Engine }).__audio = eng;
(window as unknown as { __ms: { ready: boolean } }).__ms = { ready: true };
