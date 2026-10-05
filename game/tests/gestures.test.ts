import { describe, expect, it } from "vitest";
import { Gestures, leads, liftOf, type Gesture, type Waiting } from "../src/ui/gestures";

/** A finger pressed at 1 s; `over` says what it did since. */
const finger = (id: number, over: Partial<Gesture> = {}): Gesture => ({ id, x0: 100, y0: 100, t0: 1000, moved: false, btn: null, dragged: false, lastDrag: 0, ...over });
const nothing: Waiting = { fire: false, order: false, grenade: false };
const fire: Waiting = { ...nothing, fire: true };
const order: Waiting = { ...nothing, order: true };
const grenade: Waiting = { ...nothing, grenade: true };

describe("what a finger's lift does", () => {
  it("a drag let go is judged, and answers nothing that waits", () => {
    // review round 19: let go with FIRE held, a grenade armed or an order waiting, it was never
    // judged; round 20: it threw a grenade armed meanwhile, by the other thumb, where it lifted
    for (const w of [nothing, fire, order, grenade]) expect(liftOf(finger(1, { moved: true, dragged: true }), 900, w)).toBe("drag");
  });

  it("a HUD button's lift is the button's own, FIRE's too while FIRE is held", () => {
    expect(liftOf(finger(1, { btn: {} }), 100, fire)).toBe("button");
    expect(liftOf(finger(1, { btn: {} }), 100, { fire: true, order: true, grenade: true })).toBe("button");
  });

  it("with FIRE held a street finger does nothing more; else an order waiting comes before a grenade", () => {
    expect(liftOf(finger(1), 100, { fire: true, order: true, grenade: true })).toBe("none");
    expect(liftOf(finger(1), 100, { ...nothing, order: true, grenade: true })).toBe("order");
  });

  it("a finger that led no one answers what waits: a grenade armed first is thrown where it lifts", () => {
    expect(liftOf(finger(1, { moved: true }), 900, grenade)).toBe("grenade");
    expect(liftOf(finger(1), 100, order)).toBe("order");
  });

  it("a finger still is a tap, and held past 480 ms a hold; one that moved leading no one is neither", () => {
    expect(liftOf(finger(1), 470, nothing)).toBe("tap");
    expect(liftOf(finger(1), 490, nothing)).toBe("hold");
    expect(liftOf(finger(1, { moved: true }), 600, nothing)).toBe("none");
  });
});

describe("the gestures under way", () => {
  it("a finger and the mouse's first button lead; the mouse's other buttons do nothing", () => {
    // review rounds 21 and 22: a second button pressed mid-drag took the gesture over, and then,
    // joining it, held a click on into a hold, and a grenade was thrown
    expect(leads(0)).toBe(true);
    expect(leads(1)).toBe(false);
    expect(leads(2)).toBe(false);
  });

  it("a press on a HUD button presses it, on the street with FIRE held fires, else waits", () => {
    const all = new Gestures();
    expect(all.press(finger(1, { btn: {} }), fire).press).toBe("button");
    expect(all.press(finger(2), fire).press).toBe("fire");
    expect(all.press(finger(3), nothing).press).toBe("street");
  });

  it("a finger leads the squad once it has moved, a walk at most every 0.12 s", () => {
    const all = new Gestures();
    all.press(finger(1), nothing);
    expect(all.move(1, 104, 104, 1100, nothing), "not yet moved").toBe("none");
    expect(all.move(1, 110, 100, 1200, nothing)).toBe("drag");
    expect(all.move(1, 112, 100, 1300, nothing), "0.1 s on").toBe("none");
    expect(all.move(1, 114, 100, 1330, nothing), "0.13 s on").toBe("drag");
    expect(all.get(1)!.dragged).toBe(true);
    expect(all.lift(1, 1400, nothing)?.lift).toBe("drag");
  });

  it("a finger on a HUD button, or with FIRE held, leads no one", () => {
    const all = new Gestures();
    all.press(finger(1, { btn: {} }), nothing);
    expect(all.move(1, 120, 100, 1200, nothing)).toBe("none");
    all.press(finger(2), fire);
    expect(all.move(2, 120, 100, 1200, fire)).toBe("fire");
    expect(all.get(2)!.dragged).toBe(false);
  });

  it("a grenade armed first: the finger aims it, leading no one, and it is thrown where the finger lifts", () => {
    const all = new Gestures();
    all.press(finger(1), grenade);
    expect(all.move(1, 130, 100, 1300, grenade)).toBe("none");
    expect(all.lift(1, 1500, grenade)?.lift).toBe("grenade");
    all.press(finger(2), order);
    expect(all.move(2, 130, 100, 1300, order)).toBe("none");
  });

  it("a lift is timed from its own press, and ends its gesture", () => {
    const all = new Gestures();
    all.press(finger(1), nothing);
    const l = all.lift(1, 1300, nothing)!;
    expect(l.lift).toBe("tap");
    expect(l.held).toBe(300);
    expect(all.get(1)).toBeUndefined();
    expect(all.lift(1, 1400, nothing), "no gesture left to lift").toBeNull();
  });

  it("a press on a pointer whose lift was never heard opens a new gesture, and hands back the old one", () => {
    // its drag is let go (HudScene): else the next drag would be judged from where it began
    const all = new Gestures();
    all.press(finger(0), nothing);
    all.move(0, 120, 100, 1200, nothing);
    const again = finger(0, { t0: 9000 });
    const { press, stale } = all.press(again, nothing);
    expect(press).toBe("street");
    expect(stale?.dragged, "the lost drag, to be let go").toBe(true);
    expect(all.get(0)).toBe(again);
    expect(all.lift(0, 9100, nothing)?.lift, "the new click is a tap, timed from its own press").toBe("tap");
  });

  it("two fingers are two gestures", () => {
    const all = new Gestures();
    all.press(finger(1), nothing);
    expect(all.press(finger(2), nothing).stale).toBeNull();
    expect([...all.values()].length).toBe(2);
  });
});
