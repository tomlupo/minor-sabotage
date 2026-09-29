// What a press and a lift on the screen do, decided apart from Phaser so the rules can be tested
// without a browser (ADR-0001); HudScene acts on them. A finger is one gesture from its press to its
// lift; the mouse is one pointer whatever its buttons, so it is one gesture from its first button
// down to its last button up.

/** A finger on the screen (or the mouse), from its press to its lift. */
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

/** What the HUD has waiting when a finger lifts: FIRE held, an order's spot, a grenade armed. */
export interface Waiting {
  fire: boolean;
  order: boolean;
  grenade: boolean;
}

/**
 * What a lift does. "held": another of the mouse's buttons is still down, and the gesture goes on;
 * "button": a HUD button's own; "drag": a drag let go, judged now, and nothing else; "none": FIRE
 * held, or a finger that moved without leading; then what waits ("order", "grenade"), else a
 * "hold" or a "tap".
 */
export type Lift = "held" | "button" | "drag" | "none" | "order" | "grenade" | "hold" | "tap";

/** `buttons`: the mouse's buttons still down after this lift (Phaser's pointer.buttons; a finger's
 *  lift leaves none). */
export function liftOf(g: Gesture, heldMs: number, buttons: number, w: Waiting): Lift {
  if (buttons) return "held";
  if (g.btn) return "button";
  // review round 19: let go with FIRE held, a grenade armed or an order waiting, a drag was never
  // judged; round 20: its lift threw a grenade armed meanwhile where it lifted
  if (g.dragged) return "drag";
  if (w.fire) return "none";
  if (w.order) return "order";
  if (w.grenade) return "grenade";
  if (g.moved) return "none";
  return heldMs > 480 ? "hold" : "tap";
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

  /** A press opens a gesture, unless its pointer has one under way: the mouse's second button joins
   *  it (null). Review round 21: it took the gesture over, and the drag's lift was never heard. */
  open(g: Gesture<B>): Gesture<B> | null {
    if (this.all.has(g.id)) return null;
    this.all.set(g.id, g);
    return g;
  }

  /** A lift: what it does, and the gesture it ends (unless a button is still held). */
  lift(id: number, now: number, buttons: number, w: Waiting): { g: Gesture<B>; lift: Lift } | null {
    const g = this.all.get(id);
    if (!g) return null;
    const lift = liftOf(g, now - g.t0, buttons, w);
    if (lift !== "held") this.all.delete(id);
    return { g, lift };
  }
}
