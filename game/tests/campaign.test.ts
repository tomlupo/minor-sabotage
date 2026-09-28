// Ironman (vault decision, veterans: no loading during a phase). The save names the phase
// being played; a phase left without its one-time bookmark counts as failed, never replayed.
import { describe, it, expect } from "vitest";
import { newCampaign, settleAbandoned, tasksLeft } from "../src/missions/campaign";

describe("campaign", () => {
  it("settles a task left mid-way as failed, so continuing cannot replay it", () => {
    const c = newCampaign();
    c.inPhase = "ghetto";
    expect(settleAbandoned(c)).toBe("ghetto");
    expect(c.results.ghetto?.outcome).toBe("fail");
    expect(c.results.ghetto?.flags).toEqual({});
    expect(tasksLeft(c)).not.toContain("ghetto");
    expect(c.inPhase).toBeUndefined();
    expect(settleAbandoned(c)).toBeNull();
  });

  it("leaves a result the phase already earned alone", () => {
    const c = newCampaign();
    c.results.signal = { outcome: "success", silent: true, flags: { signal: true }, seconds: 100 };
    c.inPhase = "signal";
    settleAbandoned(c);
    expect(c.results.signal.outcome).toBe("success");
  });

  it("settles the finale as Rudy not freed", () => {
    const c = newCampaign();
    c.inPhase = "finale";
    settleAbandoned(c);
    expect(c.finale?.outcome).toBe("fail");
    expect(c.finale?.rudy).toBe("lost");
  });
});
