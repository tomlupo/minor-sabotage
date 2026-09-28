// Ironman (vault decision, veterans: no loading during a phase). The save names the phase
// being played; a phase left without its one-time bookmark counts as failed, never replayed.
import { describe, it, expect } from "vitest";
import { newCampaign, recordLoss, settleAbandoned, tasksLeft } from "../src/missions/campaign";

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

  it("keeps a death recorded during a phase through the settling of it", () => {
    const c = newCampaign();
    c.inPhase = "signal";
    // a man falls, another goes down, in the phase that is then left by a reload
    expect(recordLoss(c, "kuba", "dead")).toBe(true);
    expect(recordLoss(c, "jur", "wounded")).toBe(true);
    settleAbandoned(c);
    expect(c.soldiers.kuba.state).toBe("dead");
    expect(c.soldiers.jur.state).toBe("wounded");
    // a wound never overwrites a death or a capture
    expect(recordLoss(c, "kuba", "wounded")).toBe(false);
    c.soldiers.kopec.state = "captured";
    expect(recordLoss(c, "kopec", "wounded")).toBe(false);
    expect(c.soldiers.kopec.state).toBe("captured");
  });

  it("settles the finale as Rudy not freed", () => {
    const c = newCampaign();
    c.inPhase = "finale";
    settleAbandoned(c);
    expect(c.finale?.outcome).toBe("fail");
    expect(c.finale?.rudy).toBe("lost");
  });
});
