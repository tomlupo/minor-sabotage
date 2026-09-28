// The cast of the demo (vault decision 2026-09-28, demo scope and cast): every real participant
// gets a hand-set veteran's rank, so the rules for going down wounded and "one more hit" apply
// to all of them.
import { describe, it, expect } from "vitest";
import { SQUADS } from "../src/content/arsenal/roster";
import { WOUND } from "../src/sim/tuning";

describe("roster", () => {
  it("gives every real participant a veteran's rank", () => {
    const below = SQUADS.flatMap((s) => s.people).filter((p) => p.rank < WOUND.vetRank).map((p) => `${p.key} ${p.rank}`);
    expect(below).toEqual([]);
  });
});
