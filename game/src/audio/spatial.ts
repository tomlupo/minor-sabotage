// Where a sound is, relative to the listener (the camera centre), in world metres. The screen
// is about 47 m across (style guide §2), so an edge-of-screen shot is still clearly heard and
// a sound two screens away is gone.

export const HEAR_M = 70;
const NEAR_M = 6;

export interface Spatial {
  /** Linear gain, 1 up close, 0 at HEAR_M and beyond. */
  gain: number;
  /** Stereo pan -1..1 from the horizontal offset only. */
  pan: number;
  /** Low-pass cutoff in Hz: distance and walls take the top off. */
  cutoff: number;
  /** Seconds the sound takes to arrive (343 m/s). */
  delay: number;
}

export function spatial(dx: number, dy: number): Spatial {
  const d = Math.hypot(dx, dy);
  if (!(d < HEAR_M)) return { gain: 0, pan: 0, cutoff: 0, delay: 0 };
  const gain = d <= NEAR_M ? 1 : Math.pow((HEAR_M - d) / (HEAR_M - NEAR_M), 1.6);
  const pan = Math.max(-1, Math.min(1, dx / 30)) * 0.8;
  const cutoff = 18000 * Math.pow(0.08, d / HEAR_M);
  return { gain, pan, cutoff, delay: d / 343 };
}
