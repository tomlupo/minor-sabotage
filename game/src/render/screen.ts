// The screen as the scenes lay it out: a view in art pixels (render/view.ts), drawn on a
// canvas at the screen's own resolution. Every scene lays out in art pixels and its camera
// scales them up (`s` physical pixels to the art pixel), so the art keeps its grid while text
// is drawn as sharp as the screen allows.
import Phaser from "phaser";
import type { ViewSize } from "./view";

export const screen = { w: 480, h: 270, zoom: 1, s: 1 };

/** Art px a full-screen layer is drawn to: more than any view, so neither the view's floor to
 *  whole art pixels nor a resize bares a strip along its edge. */
export const COVER = 4096;

export function setScreen(v: ViewSize): void {
  screen.w = v.w;
  screen.h = v.h;
  screen.zoom = v.zoom;
  screen.s = v.s;
}

/**
 * A screen's camera: art pixel (x, y) at the top-left corner (x * s, y * s), for scenes laid out
 * in screen space (the menus, the HUD, the chapter card). Kept so across resizes, with the
 * scene's text redrawn at the new sharpness.
 */
export function fitCamera(scene: Phaser.Scene): void {
  const cam = scene.cameras.main;
  const apply = () => {
    cam.setOrigin(0, 0).setZoom(screen.s);
    sharpenText(scene);
  };
  apply();
  scene.scale.on("resize", apply);
  scene.events.once("shutdown", () => scene.scale.off("resize", apply));
}

/** Redraw every text of a scene at the screen's sharpness (after a resize changed it). */
export function sharpenText(scene: Phaser.Scene): void {
  for (const o of scene.children.list) if (o instanceof Phaser.GameObjects.Text && o.style.resolution !== screen.s) o.setResolution(screen.s);
}

/** A pointer's position in the art pixels a screen is laid out in. */
export function artPoint(p: { x: number; y: number }): { x: number; y: number } {
  return { x: p.x / screen.s, y: p.y / screen.s };
}
