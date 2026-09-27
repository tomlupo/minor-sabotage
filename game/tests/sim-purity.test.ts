// ADR-0001: the rules are plain TypeScript, not Phaser code. This test fails when anything
// under src/sim imports Phaser or the render/ui layers, or reaches for browser globals, so
// the snapshot/resume and headless tests stay possible.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SIM = resolve(__dirname, "../src");
const RULE_DIRS = ["sim", "missions"];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : p.endsWith(".ts") ? [p] : [];
  });
}

const FORBIDDEN: [RegExp, string][] = [
  [/from\s+["']phaser["']/, "imports Phaser"],
  [/from\s+["']\.\.\/(render|ui|audio)\b/, "imports a presentation layer"],
  [/\b(window|document|localStorage|indexedDB|requestAnimationFrame)\s*[.[(]/, "touches a browser global"],
  [/\bMath\.random\s*\(/, "uses Math.random (use the seeded RNG so replays and resumes are exact)"],
  [/\bDate\.now\s*\(|\bperformance\.now\s*\(/, "reads the wall clock (the sim runs on its own tick)"],
];

describe("sim purity (ADR-0001)", () => {
  const list = RULE_DIRS.flatMap((d) => files(join(SIM, d)));
  it("has sim files to check", () => {
    expect(list.length).toBeGreaterThan(0);
  });
  for (const f of list) {
    it(f.slice(SIM.length + 1), () => {
      const src = readFileSync(f, "utf8");
      const hits = FORBIDDEN.filter(([re]) => re.test(src)).map(([, why]) => why);
      expect(hits, `${f} ${hits.join(", ")}`).toEqual([]);
    });
  }
});
