// Style guide §3: nothing hard-codes a colour. The code that draws (src/render, src/ui,
// src/art, src/main.ts) takes every colour from docs/art/palette.json through
// src/art/palette.ts; a colour written into the source is a second copy that can drift.
// index.html is the one exception: its boot line shows before any script runs, so its
// colours are literals, and each must be a palette colour.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { paletteColours } from "../src/art/palette";

const ROOT = join(__dirname, "..");
const SCOPE = ["src/render", "src/ui", "src/art", "src/main.ts"];

/** A colour written as a literal: #rgb, #rrggbb (and alpha forms), 0xrrggbb, rgb()/hsl() with numbers,
 *  or a CSS colour name assigned to a colour property. */
const LITERALS: [string, RegExp][] = [
  ["#hex", /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/],
  ["0xrrggbb", /\b0x[0-9a-fA-F]{6}\b/],
  ["rgb()/hsl()", /\b(?:rgba?|hsla?)\(\s*[\d.]/],
  ["named colour", /\b(?:color|colour|background(?:Color)?|fill(?:Style)?|stroke(?:Style)?|tint)\s*[:=]\s*["'`](?:white|black|red|green|blue|yellow|orange|purple|pink|brown|gr[ae]y|silver|gold)["'`]/i],
];

function files(rel: string): string[] {
  const abs = join(ROOT, rel);
  if (statSync(abs).isFile()) return [abs];
  return readdirSync(abs).flatMap((f) => files(join(rel, f)));
}

/** The source without comments, line by line (a comment may name a colour it replaced). */
function codeLines(text: string): string[] {
  const out: string[] = [];
  let block = false;
  for (const raw of text.split("\n")) {
    let line = raw;
    if (block) {
      const end = line.indexOf("*/");
      if (end < 0) { out.push(""); continue; }
      line = line.slice(end + 2);
      block = false;
    }
    line = line.replace(/\/\*.*?\*\//g, "");
    const open = line.indexOf("/*");
    if (open >= 0 && !/["'`]/.test(line.slice(0, open))) { block = true; line = line.slice(0, open); }
    // a line comment starts at "//" after whitespace or at the line's start ("https://" keeps)
    line = line.replace(/(^|\s)\/\/.*$/, "$1");
    out.push(line);
  }
  return out;
}

describe("colour literals (style guide §3)", () => {
  const sources = SCOPE.flatMap(files).filter((f) => /\.(ts|js|mjs)$/.test(f));

  it("looks at the drawing code", () => {
    // a guard aimed at nothing passes silently: hold it to the folders it is meant to read
    expect(sources.length).toBeGreaterThan(40);
    for (const dir of ["src/render/", "src/ui/", "src/art/", "src/main.ts"]) {
      expect(sources.some((f) => relative(ROOT, f).startsWith(dir)), dir).toBe(true);
    }
  });

  it("finds no colour written into src/render, src/ui, src/art or src/main.ts", () => {
    const hits: string[] = [];
    for (const f of sources) {
      codeLines(readFileSync(f, "utf8")).forEach((line, i) => {
        for (const [kind, re] of LITERALS) {
          const m = line.match(re);
          if (m) hits.push(`${relative(ROOT, f)}:${i + 1} ${kind} ${m[0]}`);
        }
      });
    }
    expect(hits, hits.join("\n")).toEqual([]);
  });

  it("catches the shapes it is meant to catch", () => {
    const caught = (s: string) => codeLines(s).some((l) => LITERALS.some(([, re]) => re.test(l)));
    for (const s of ['backgroundColor: "#24201a",', "stroke: '#fff'", "setTint(0xffffff)", "fillStyle = `rgba(0, 0, 0, 0.5)`", 'color: "white"']) expect(caught(s), s).toBe(true);
    for (const s of ["css(PAL.shared.outline)", "`rgb(${c[0]},${c[1]},${c[2]})`", "Math.imul(h, 0x27d4eb2d)", "// was #f0d2c8", 'querySelector("#n-lang")']) expect(caught(s), s).toBe(false);
  });

  it("lets index.html carry only palette colours", () => {
    const palette = paletteColours();
    const html = readFileSync(join(ROOT, "index.html"), "utf8");
    const found = [...html.matchAll(/#([0-9a-fA-F]{6})\b/g)].map((m) => m[1].toLowerCase());
    expect(found.length).toBeGreaterThan(0);
    const off = found.filter((h) => !palette.has([0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).join(",")));
    expect(off, `index.html colours not in docs/art/palette.json: ${off.join(" ")}`).toEqual([]);
    expect(html).not.toMatch(/\b(?:rgba?|hsla?)\(\s*[\d.]/);
  });
});
