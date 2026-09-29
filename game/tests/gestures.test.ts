import { describe, expect, it } from "vitest";
import { Gestures, liftOf, type Gesture, type Waiting } from "../src/ui/gestures";

/** A finger pressed at time 0; `over` says what it did since. */
const finger = (id: number, over: Partial<Gesture> = {}): Gesture => ({ id, x0: 0, y0: 0, t0: 0, moved: false, btn: null, dragged: false, lastDrag: 0, ...over });
const nothing: Waiting = { fire: false, order: false, grenade: false };

describe("what a finger's lift does", () => {
  it("a drag let go is judged, and answers nothing that waits", () => {
    // review round 19: let go with FIRE held, a grenade armed or an order waiting, it was never
    // judged; round 20: it threw a grenade armed meanwhile, by the other thumb, where it lifted
    for (const w of [nothing, { ...nothing, fire: true }, { ...nothing, order: true }, { ...nothing, grenade: true }]) {
      expect(liftOf(finger(1, { moved: true, dragged: true }), 900, 0, w)).toBe("drag");
    }
  });

  it("a finger that led no one answers what waits: a grenade armed first is thrown where it lifts", () => {
    expect(liftOf(finger(1, { moved: true }), 900, 0, { ...nothing, grenade: true })).toBe("grenade");
    expect(liftOf(finger(1), 100, 0, { ...nothing, order: true })).toBe("order");
    expect(liftOf(finger(1), 100, 0, { ...nothing, fire: true })).toBe("none");
  });

  it("a finger still is a tap, or a hold when held; one that moved leading no one is neither", () => {
    expect(liftOf(finger(1), 100, 0, nothing)).toBe("tap");
    expect(liftOf(finger(1), 600, 0, nothing)).toBe("hold");
    expect(liftOf(finger(1, { moved: true }), 600, 0, nothing)).toBe("none");
  });

  it("a HUD button's lift is the button's own", () => {
    expect(liftOf(finger(1, { btn: {} }), 100, 0, { ...nothing, grenade: true })).toBe("button");
  });
});

describe("the mouse, one pointer whatever its buttons", () => {
  it("a second button pressed during a drag joins it, and the drag is let go with the last button up", () => {
    // review round 21: the second button took the gesture over, the drag's lift was never heard, and
    // the next drag was judged from where this one began; held, the right button threw a grenade
    const all = new Gestures();
    const drag = all.open(finger(0))!;
    drag.moved = drag.dragged = true;
    expect(all.open(finger(0, { t0: 300 })), "the right button joins the drag").toBeNull();
    expect(all.lift(0, 1400, 1, nothing)?.lift, "the right button up, the left still down").toBe("held");
    expect(all.get(0), "the drag goes on").toBe(drag);
    expect(all.lift(0, 1600, 0, nothing)?.lift, "the left button up").toBe("drag");
    expect(all.get(0)).toBeUndefined();
  });

  it("a lift ends its gesture, and the next press opens a new one", () => {
    const all = new Gestures();
    all.open(finger(0));
    expect(all.lift(0, 100, 0, nothing)?.lift).toBe("tap");
    expect(all.lift(0, 200, 0, nothing), "no gesture left to lift").toBeNull();
    expect(all.open(finger(0, { t0: 300 }))).not.toBeNull();
  });

  it("two fingers are two gestures", () => {
    const all = new Gestures();
    all.open(finger(1));
    expect(all.open(finger(2))).not.toBeNull();
    expect([...all.values()].length).toBe(2);
  });
});
