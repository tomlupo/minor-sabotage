// How big an art pixel is on this screen.
//
// The style guide fixes 1.5 pt per art pixel on an iPhone, so an iPhone 15 held sideways
// (852 x 393 pt) shows 568 x 262 art px. Art is scaled up by a whole number or by 1.5, with
// nearest-neighbour sampling (§2): any other step (2.5, 3.5) would draw some art pixels a
// CSS pixel wider than their neighbours. On other screens we pick the largest such scale
// that still shows at least MIN_W x MIN_H art px, so the view never shrinks below what the
// missions are designed for.

export const MIN_W = 480;
export const MIN_H = 240;

export interface ViewSize {
  /** Canvas size in art pixels. */
  w: number;
  h: number;
  /** CSS pixels per art pixel. */
  zoom: number;
}

/** The largest allowed scale (1, 1.5, 2, 3, 4...) not above `fit`; 1 when nothing fits. */
export function pickZoom(fit: number): number {
  if (fit >= 2) return Math.floor(fit);
  return fit >= 1.5 ? 1.5 : 1;
}

export function computeView(cssW: number, cssH: number): ViewSize {
  const zoom = pickZoom(Math.min(cssW / MIN_W, cssH / MIN_H));
  return { w: Math.ceil(cssW / zoom), h: Math.ceil(cssH / zoom), zoom };
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
