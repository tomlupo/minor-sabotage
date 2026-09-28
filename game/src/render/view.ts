// How big an art pixel is on this screen.
//
// The style guide fixes 1.5 pt per art pixel on an iPhone, so an iPhone 15 held sideways
// (852 x 393 pt) shows 568 x 262 art px. Art is scaled up with nearest-neighbour sampling
// (§2), and every art pixel must come out the same size. So on a screen where one physical
// pixel can be seen (fewer than 2 to a CSS pixel: a desktop, or a laptop at 125 % or 150 %),
// an art pixel is a whole number of physical pixels: the largest that still shows at least
// MIN_W x MIN_H art px, the view the missions are designed for. On a denser screen, a phone,
// the step is counted in points as the style guide counts it (1, 1.5, 2, 3...), since a
// physical pixel more or less cannot be seen there.
//
// The canvas is drawn at the screen's own resolution, so text is drawn as sharp as the screen
// allows; the art keeps its grid through the cameras' zoom (render/screen.ts).

export const MIN_W = 480;
export const MIN_H = 240;

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
    ? Math.max(1, Math.floor(Math.min(canvasW / MIN_W, canvasH / MIN_H)))
    : pickZoom(Math.min(cssW / MIN_W, cssH / MIN_H)) * dpr;
  return { w: Math.floor(canvasW / s), h: Math.floor(canvasH / s), zoom: s / dpr, s, canvasW, canvasH };
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
