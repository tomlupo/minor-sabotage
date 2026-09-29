// What a press, a move and a lift on the screen do, decided apart from Phaser so the rules can be
// tested without a browser (ADR-0001); HudScene does what they say. A finger is one gesture from its
// press to its lift. The mouse leads with its first button only: its others do nothing (review
// rounds 21 and 22: a second button pressed during a gesture took it over, then, joining it, held a
// click on into a hold, and a grenade was thrown).

/** A finger on the screen (or the mouse's first button), from its press to its lift. */
export interface Gesture<B = unknown> {
  id: number;
  x0: number; y0: number;
  t0: number;
  moved: boolean;
  btn: B | null;
  /** It has led the squad: a drag, judged when it is let go. */
  dragged: boolean;
  lastDrag: number;
}

/** What the HUD has waiting: FIRE held, an order's spot, a grenade armed. */
export interface Waiting {
  fire: boolean;
  order: boolean;
  grenade: boolean;
}

/** What a press does: "button" presses a HUD button; "fire", with FIRE held, fires there; "street"
 *  waits for the finger to move or lift. */
export type Press = "button" | "fire" | "street";

/** What a move does: "fire" while FIRE is held; "drag" leads the squad toward the finger, once it has
 *  moved and at most every 0.12 s, unless an order's spot or a grenade waits (armed first, the finger
 *  aims it, and it is thrown where the finger lifts); else "none". */
export type Move = "none" | "fire" | "drag";

/** What a lift does: "button", a HUD button's own; "drag", a drag let go, judged now, and nothing else;
 *  "none" while FIRE is held, or for a finger that moved without leading; then what waits ("order",
 *  "grenade"); else a "hold" (a throw) or a "tap". */
export type Lift = "button" | "drag" | "none" | "order" | "grenade" | "hold" | "tap";

/** A still finger held longer than this (ms) is a hold. */
export const HOLD_MS = 480;

/** Whether a press or a lift of this button is the HUD's (Phaser's pointer.button: a finger's is 0, as
 *  is the mouse's first). */
export function leads(button: number): boolean {
  return button === 0;
}

export function liftOf(g: Gesture, heldMs: number, w: Waiting): Lift {
  if (g.btn) return "button";
  // review round 19: let go with FIRE held, a grenade armed or an order waiting, a drag was never
  // judged; round 20: its lift threw a grenade armed meanwhile where it lifted
  if (g.dragged) return "drag";
  if (w.fire) return "none";
  if (w.order) return "order";
  if (w.grenade) return "grenade";
  if (g.moved) return "none";
  return heldMs > HOLD_MS ? "hold" : "tap";
}

/** The gestures under way, by pointer. */
export class Gestures<B = unknown> {
  private all = new Map<number, Gesture<B>>();

  get(id: number): Gesture<B> | undefined {
    return this.all.get(id);
  }

  values(): IterableIterator<Gesture<B>> {
    return this.all.values();
  }

  clear(): void {
    this.all.clear();
  }

  /** A press opens a gesture. One its pointer left open, whose lift the page never heard (the window
   *  lost mid-click), is replaced and returned, for its drag to be let go. */
  press(g: Gesture<B>, w: Waiting): { press: Press; stale: Gesture<B> | null } {
    const stale = this.all.get(g.id) ?? null;
    this.all.set(g.id, g);
    return { press: g.btn ? "button" : w.fire ? "fire" : "street", stale };
  }

  /** A move of the pointer to (x, y), art px. */
  move(id: number, x: number, y: number, now: number, w: Waiting): Move {
    const g = this.all.get(id);
    if (!g) return "none";
    if (Math.hypot(x - g.x0, y - g.y0) > 8) g.moved = true;
    if (g.btn) return "none";
    if (w.fire) return "fire";
    if (!g.moved || now - g.lastDrag <= 120 || w.order || w.grenade) return "none";
    g.lastDrag = now;
    g.dragged = true;
    return "drag";
  }

  /** A lift ends its gesture: what it does, and how long the finger was down. */
  lift(id: number, now: number, w: Waiting): { g: Gesture<B>; lift: Lift; held: number } | null {
    const g = this.all.get(id);
    if (!g) return null;
    this.all.delete(id);
    const held = now - g.t0;
    return { g, lift: liftOf(g, held, w), held };
  }
}
