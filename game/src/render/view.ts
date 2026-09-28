// How big an art pixel is on this screen.
//
// The style guide fixes 1.5 pt per art pixel on an iPhone, so an iPhone 15 held sideways
// (852 x 393 pt) shows 568 x 262 art px. On a screen that dense (2 or more physical pixels to a
// CSS pixel: a phone, a tablet, a Mac) the step is counted in points as the style guide counts
// it (1, 1.5, 2, 3...): the largest that still shows MIN_W x MIN_H art px, the view the missions
// are designed for. A PC shows the same map in any window (Tom, 2026-09-28: "the screen should
// shows same map everywhere"): the full-screen 1080p view, PC_W x PC_H art px, fitted to the
// window. Full screen at 1080p, 125 % or 150 % that is 4 physical pixels to an art pixel; in a
// window of another height an art pixel comes out a physical pixel wider or narrower by turns.
// Art is scaled with nearest-neighbour sampling either way, never smoothed (§2).
//
// The canvas is drawn at the screen's own resolution, so text is drawn as sharp as the screen
// allows; the art keeps its grid through the cameras' zoom (render/screen.ts).

export const MIN_W = 480;
export const MIN_H = 240;
/** The view a PC shows in any window: 1080p's full screen at 4 physical pixels an art pixel. */
export const PC_W = 480;
export const PC_H = 270;

export interface ViewSize {
  /** The view in art pixels. */
  w: number;
  h: number;
  /** CSS pixels per art pixel. */
  zoom: number;
  /** Physical pixels per art pixel: the cameras' zoom. */
  s: number;
  /** The canvas in physical pixels. */
  canvasW: number;
  canvasH: number;
}

/** The largest allowed scale in points (1, 1.5, 2, 3, 4...) not above `fit`; 1 when nothing fits. */
export function pickZoom(fit: number): number {
  if (fit >= 2) return Math.floor(fit);
  return fit >= 1.5 ? 1.5 : 1;
}

export function computeView(cssW: number, cssH: number, dpr = 1): ViewSize {
  const canvasW = Math.round(cssW * dpr), canvasH = Math.round(cssH * dpr);
  const s = dpr < 2
    ? Math.max(1, Math.min(canvasW / PC_W, canvasH / PC_H))
    : pickZoom(Math.min(cssW / MIN_W, cssH / MIN_H)) * dpr;
  // the fitted side divides exactly: a rounding hair under a whole art pixel still counts as one
  return { w: Math.floor(canvasW / s + 1e-6), h: Math.floor(canvasH / s + 1e-6), zoom: s / dpr, s, canvasW, canvasH };
}

export interface SafeInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Safe-area insets in art pixels, read from a probe element styled with env(). */
export function readSafeInsets(zoom: number): SafeInsets {
  const el = typeof document !== "undefined" ? document.getElementById("safe-probe") : null;
  if (!el) return { top: 0, right: 0, bottom: 0, left: 0 };
  const cs = getComputedStyle(el);
  const px = (v: string) => Math.ceil((parseFloat(v) || 0) / zoom);
  return { top: px(cs.top), right: px(cs.right), bottom: px(cs.bottom), left: px(cs.left) };
}
