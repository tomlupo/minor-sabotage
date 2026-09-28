// The briefing's city plan (style guide §9): the operation's map drawn like an underground
// sketch on paper, from the same map data the game plays on. Buildings hatched in pencil,
// streets left white with their names, the van's route dotted, the S-bend marked.
import type { MapData } from "../content/mapdata";
import { F_SIGHT } from "../content/mapdata";
import type { PixelImage } from "../art/pixel";
import { img, px, line, hash2, blit } from "../art/pixel";
import { PAL, mix } from "../art/palette";
import { FONT_SMALL, drawText, measure } from "../art/font";
import { buildPaper } from "../art/hud";

export interface PlanView {
  image: PixelImage;
  /** metres -> plan px */
  sx: (x: number) => number;
  sy: (y: number) => number;
}

export function drawPlan(md: MapData, w: number, h: number): PlanView {
  const im = img(w, h);
  const paperD = PAL.hud.paper[0];
  const ink = PAL.hud.paper_ink;
  const pencil = mix(paperD, ink, 0.45);
  blit(im, buildPaper(w, h, 7), 0, 0);
  const pad = 6;
  const k = Math.min((w - pad * 2) / md.w, (h - pad * 2) / md.h);
  const ox = Math.round((w - md.w * k) / 2), oy = Math.round((h - md.h * k) / 2);
  const sx = (x: number) => ox + x * k;
  const sy = (y: number) => oy + y * k;
  // buildings: pencil hatching inside, ink outline
  for (let py = 0; py < h; py++) {
    for (let pxx = 0; pxx < w; pxx++) {
      const mx = Math.floor((pxx - ox) / k), my = Math.floor((py - oy) / k);
      if (mx < 0 || my < 0 || mx >= md.w || my >= md.h) continue;
      const i = my * md.w + mx;
      const solid = md.building[i] >= 0 || (md.flags[i] & F_SIGHT) !== 0;
      if (!solid) continue;
      const edge = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
        const ax = Math.floor((pxx + dx - ox) / k), ay = Math.floor((py + dy - oy) / k);
        if (ax < 0 || ay < 0 || ax >= md.w || ay >= md.h) return false;
        const j = ay * md.w + ax;
        return !(md.building[j] >= 0 || (md.flags[j] & F_SIGHT) !== 0);
      });
      if (edge) px(im, pxx, py, ink);
      else if ((pxx + py) % 4 === 0) px(im, pxx, py, pencil);
    }
  }
  // the Arsenal in heavier ink, the ruins as rubble dots
  const ars = md.buildings.find((b) => b.kind === "arsenal");
  if (ars) {
    for (let t = 0; t < 2; t++) {
      const x0 = sx(ars.x) + t, y0 = sy(ars.y) + t, x1 = sx(ars.x + ars.w) - 1 - t, y1 = sy(ars.y + ars.d) - 1 - t;
      line(im, x0, y0, x1, y0, ink); line(im, x1, y0, x1, y1, ink); line(im, x1, y1, x0, y1, ink); line(im, x0, y1, x0, y0, ink);
    }
    const lbl = "ARSENAŁ";
    drawText(im, FONT_SMALL, Math.round(sx(ars.x + ars.w / 2) - measure(FONT_SMALL, lbl) / 2), Math.round(sy(ars.y + ars.d / 2) - 3), lbl, ink);
  }
  const ruins = md.streets.find((s) => s.name === "the ruins");
  if (ruins) {
    for (let my = 0; my < md.h; my++) for (let mx = 0; mx < md.w; mx++) {
      if (md.street[my * md.w + mx] !== ruins.id) continue;
      if (hash2(mx, my, 11) < 0.35) px(im, Math.round(sx(mx + 0.5)), Math.round(sy(my + 0.5)), pencil);
    }
  }
  // street names along the streets
  const label = (text: string, x: number, y: number, vertical = false) => {
    if (!vertical) { drawText(im, FONT_SMALL, Math.round(sx(x) - measure(FONT_SMALL, text) / 2), Math.round(sy(y) - 2), text, ink); return; }
    let yy = Math.round(sy(y) - (text.length * 6) / 2);
    for (const ch of text) { drawText(im, FONT_SMALL, Math.round(sx(x) - 2), yy, ch, ink); yy += 6; }
  };
  label("DŁUGA", 40, 79);
  label("DŁUGA", 226, 79);
  label("BIELAŃSKA", 131, 110, true);
  label("NALEWKI", 93, 30, true);
  label("TŁOMACKIE", 90, 133);
  label("PRZEJAZD", 12, 44, true);
  // the van's route: dotted, with an arrow into Nalewki
  const route = md.paths.find((p) => p.name === "truck");
  if (route) {
    let n = 0;
    for (let i = 1; i < route.pts.length; i++) {
      const a = route.pts[i - 1], b = route.pts[i];
      const d = Math.hypot(b.x - a.x, b.y - a.y) * k;
      for (let t = 0; t < d; t += 1) {
        const x = sx(a.x) + ((sx(b.x) - sx(a.x)) * t) / d, y = sy(a.y) + ((sy(b.y) - sy(a.y)) * t) / d;
        if (y < 0 || y >= h) continue;
        if (n++ % 3 === 0) px(im, Math.round(x), Math.round(y), PAL.shared.poppy_red);
      }
    }
  }
  // the bend: a cross where the van was to be stopped
  const bend = md.zones.find((z) => z.name === "bend");
  if (bend) {
    const cx = Math.round(sx(104)), cy = Math.round(sy(77));
    for (let t = -3; t <= 3; t++) { px(im, cx + t, cy + t, PAL.shared.poppy_red); px(im, cx + t, cy - t, PAL.shared.poppy_red); px(im, cx + t + 1, cy + t, PAL.shared.poppy_red); px(im, cx + t + 1, cy - t, PAL.shared.poppy_red); }
  }
  return { image: im, sx, sy };
}
