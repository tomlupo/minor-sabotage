// HUD textures: stamped identity tags with the trooper's face, squad tags in their colour,
// olive thumb buttons (style guide §8). Built by src/art/hud.ts when it exists, otherwise by
// the stand-ins below; each texture is cached by the state it shows.
import Phaser from "phaser";
import type { Sim } from "../sim/sim";
import type { Unit } from "../sim/types";
import type { PixelImage } from "../art/pixel";
import { img, rect, ellipse, outline, toCanvas, px, line, hline, vline } from "../art/pixel";
import { PAL, SQUAD_COLOURS, css, type RGB } from "../art/palette";
import { WOUND } from "../sim/tuning";

type Mod = Record<string, unknown>;
const MODS = import.meta.glob<Mod>("../art/hud.ts", { eager: true });
const HUD = Object.values(MODS)[0] ?? {};
const f = <T>(name: string) => (typeof HUD[name] === "function" ? (HUD[name] as T) : null);

type BuildTag = (o: { name: string; rank: number; face: PixelImage; hp: "ok" | "low" | "down" | "dead"; selected?: boolean }) => PixelImage;
type BuildSquadTag = (o: { leader: string; colour: 1 | 2 | 3; selected: boolean; order?: "hold" | "follow" | "cover" | "signal" | null; alive: number; total: number }) => PixelImage;
type BuildButton = (kind: string, pressed: boolean, extra?: unknown) => PixelImage;

export interface Label { text: string; x: number; y: number; size?: number; align?: number; color?: RGB }
export interface HudArt {
  button(b: { id: string; w: number; h: number }, pressed: boolean, sim: Sim): string | null;
  label(b: { id: string; w: number; h: number }, sim: Sim): Label | null;
}

export function hudArt(scene: Phaser.Scene): HudArt {
  const buildTag = f<BuildTag>("buildTag");
  const buildSquadTag = f<BuildSquadTag>("buildSquadTag");
  const buildButton = f<BuildButton>("buildButton");
  const hasOwnLabels = !!buildSquadTag;

  const tex = (key: string, make: () => PixelImage): string => {
    if (!scene.textures.exists(key)) {
      let im: PixelImage;
      try { im = make(); } catch (e) { console.warn("hud art failed", key, e); im = img(8, 8); }
      scene.textures.addCanvas(key, toCanvas(im));
    }
    return key;
  };

  const faceOf = (u: Unit): PixelImage => {
    const t = scene.textures.get(`tr:${u.look}`);
    const fr = t.has("idle_s_0") ? t.get("idle_s_0") : null;
    const out = img(10, 10);
    if (!fr) return out;
    const c = document.createElement("canvas");
    c.width = 10;
    c.height = 10;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(fr.source.image as CanvasImageSource, fr.cutX + 7, fr.cutY + 1, 10, 10, 0, 0, 10, 10);
    out.data.set(ctx.getImageData(0, 0, 10, 10).data);
    return out;
  };

  const hpOf = (u: Unit): "ok" | "low" | "down" | "dead" =>
    u.state === "dead" ? "dead" : u.state === "down" ? "down" : u.wounded ? "low" : "ok";

  // ---- stand-ins ------------------------------------------------------------------------------
  const olive = (w: number, h: number, pressed: boolean, round: boolean, glyph: (im: PixelImage, ox: number, oy: number) => void) => {
    const im = img(w, h);
    const [d, l] = PAL.hud.button_olive;
    if (round) {
      ellipse(im, w / 2, h / 2, w / 2 - 1, h / 2 - 1, PAL.hud.button_rim);
      ellipse(im, w / 2, h / 2, w / 2 - 2, h / 2 - 2, pressed ? d : l);
      if (!pressed) ellipse(im, w / 2, h / 2 + 1, w / 2 - 3, h / 2 - 3, d);
      ellipse(im, w / 2, h / 2 - (pressed ? 0 : 1), w / 2 - 4, h / 2 - 4, pressed ? d : l);
    } else {
      rect(im, 0, 0, w, h, PAL.hud.button_rim);
      rect(im, 1, 1, w - 2, h - 2, pressed ? d : l);
      if (!pressed) hline(im, 1, w - 2, h - 2, d);
    }
    glyph(im, pressed ? 1 : 0, pressed ? 1 : 0);
    return im;
  };
  const ink = PAL.hud.button_ink;
  const glyphs: Record<string, (im: PixelImage, ox: number, oy: number) => void> = {
    pause: (im, ox, oy) => { rect(im, 10 + ox, 9 + oy, 3, 12, ink); rect(im, 17 + ox, 9 + oy, 3, 12, ink); },
    play: (im, ox, oy) => { for (let k = 0; k < 7; k++) vline(im, 11 + k + ox, 9 + k + oy, 21 - k + oy, ink); },
    map: (im, ox, oy) => { rect(im, 8 + ox, 9 + oy, 14, 12, ink); line(im, 12 + ox, 9 + oy, 12 + ox, 21 + oy, PAL.hud.button_olive[0]); line(im, 17 + ox, 9 + oy, 17 + ox, 21 + oy, PAL.hud.button_olive[0]); },
    fire: (im, ox, oy) => { ellipse(im, 22 + ox, 22 + oy, 8, 8, ink, 255, false); hline(im, 12 + ox, 32 + ox, 22 + oy, ink); vline(im, 22 + ox, 12 + oy, 32 + oy, ink); },
    grenade: (im, ox, oy) => { ellipse(im, 18 + ox, 20 + oy, 6, 7, ink); rect(im, 16 + ox, 10 + oy, 4, 4, ink); },
    go: (im, ox, oy) => { rect(im, 6 + ox, 6 + oy, 2, 18, ink); rect(im, 8 + ox, 6 + oy, 9, 6, PAL.shared.poppy_red); },
    hold: (im, ox, oy) => { rect(im, 11 + ox, 7 + oy, 2, 16, ink); rect(im, 13 + ox, 7 + oy, 7, 5, ink); },
    cover: (im, ox, oy) => { for (let k = 0; k < 10; k++) hline(im, 15 - k + ox, 15 + k + ox, 9 + k + oy, k % 2 ? ink : PAL.hud.button_olive[1]); },
    signal: (im, ox, oy) => { ellipse(im, 15 + ox, 15 + oy, 7, 7, ink, 255, false); px(im, 15 + ox, 15 + oy, ink); },
    tail: (im, ox, oy) => { for (const d of [0, 6]) { line(im, 9 + ox, 20 - d + oy, 15 + ox, 14 - d + oy, ink); line(im, 15 + ox, 14 - d + oy, 21 + ox, 20 - d + oy, ink); } },
  };

  const standInTag = (u: Unit, selected: boolean): PixelImage => {
    const im = img(34, 28);
    const [d, l] = PAL.hud.tag_steel;
    const hp = hpOf(u);
    const base = hp === "dead" ? PAL.city_1943.soot[1] : l;
    rect(im, 1, 1, 32, 26, base);
    rect(im, 1, 1, 32, 1, d);
    ellipse(im, 5, 5, 1.6, 1.6, PAL.shared.outline);
    const face = faceOf(u);
    for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) {
      const i = (y * 10 + x) * 4;
      if (face.data[i + 3]) px(im, 3 + x, 12 + y, [face.data[i], face.data[i + 1], face.data[i + 2]]);
    }
    for (let r = 0; r < Math.min(u.rank, 6); r++) { px(im, 30 - (r % 3) * 3, 4 + Math.floor(r / 3) * 3, PAL.hud.tag_ink); px(im, 31 - (r % 3) * 3, 3 + Math.floor(r / 3) * 3, PAL.hud.tag_ink); px(im, 29 - (r % 3) * 3, 3 + Math.floor(r / 3) * 3, PAL.hud.tag_ink); }
    const hpc: RGB = hp === "ok" ? PAL.hud.hp_ok : PAL.hud.hp_low;
    rect(im, 15, 23, hp === "ok" ? 16 : hp === "low" ? 9 : 4, 2, hpc);
    if (hp === "dead") { vline(im, 22, 8, 22, PAL.forest.birch_bark[1]); hline(im, 19, 25, 12, PAL.forest.birch_bark[1]); }
    outline(im, selected ? PAL.shared.select_gold : PAL.shared.outline);
    return im;
  };

  const standInSquad = (colour: number, selected: boolean): PixelImage => {
    const im = img(56, 22);
    const c = SQUAD_COLOURS[colour];
    rect(im, 0, 0, 56, 22, PAL.hud.button_rim);
    rect(im, 1, 1, 54, 20, selected ? c : PAL.hud.button_olive[0]);
    rect(im, 1, 1, 6, 20, c);
    return im;
  };

  const squadOf = (i: number, sim: Sim) => sim.state.squads[i];

  return {
    button(b, pressed, sim) {
      const s = sim.state;
      if (b.id.startsWith("squad")) {
        const i = Number(b.id.slice(5));
        const sq = squadOf(i, sim);
        if (!sq) return null;
        const alive = sim.membersOf(sq).filter((u) => u.state !== "dead").length;
        const sel = s.controlled === i;
        const order = sel ? "follow" : sq.order === "tail" ? "follow" : (sq.order as "hold" | "cover" | "signal");
        const key = `hud:sq:${i}:${sel}:${order}:${alive}:${sq.members.length}`;
        return tex(key, () => (buildSquadTag ? buildSquadTag({ leader: sq.name, colour: ((sq.colour % 3) + 1) as 1 | 2 | 3, selected: sel, order, alive, total: sq.members.length }) : standInSquad(sq.colour % 3, sel)));
      }
      if (b.id.startsWith("chip")) {
        const k = Number(b.id.slice(4));
        const sq = sim.controlledSquad;
        const u = sq ? sim.unit(sq.members[k]) : undefined;
        if (!u) return null;
        const hp = hpOf(u);
        const key = `hud:tag:${u.id}:${hp}:${u.rank}`;
        return tex(key, () => (buildTag ? buildTag({ name: u.name, rank: Math.min(7, u.rank), face: faceOf(u), hp, selected: false }) : standInTag(u, false)));
      }
      const kind = b.id.startsWith("order_") ? b.id.slice(6) : b.id === "pause" && s.paused ? "play" : b.id;
      const key = `hud:btn:${kind}:${pressed}:${b.w}x${b.h}`;
      return tex(key, () => {
        if (buildButton) {
          try { return buildButton(kind === "tail" ? "follow" : kind, pressed); } catch { /* fall through */ }
        }
        const round = kind === "fire" || kind === "grenade";
        return olive(b.w, b.h, pressed, round, glyphs[kind] ?? (() => {}));
      });
    },
    label(b, sim) {
      if (b.id.startsWith("squad") && !hasOwnLabels) {
        const sq = squadOf(Number(b.id.slice(5)), sim);
        if (!sq) return null;
        return { text: sq.name, x: 10, y: 6, size: 8, color: PAL.hud.button_ink };
      }
      if (b.id.startsWith("chip") && !buildTag) {
        const sq = sim.controlledSquad;
        const u = sq ? sim.unit(sq.members[Number(b.id.slice(4))]) : undefined;
        if (!u) return null;
        return { text: u.name.slice(0, 7), x: 14, y: 12, size: 6, color: PAL.hud.tag_ink };
      }
      if (b.id === "grenade") {
        const sq = sim.controlledSquad;
        const n = sq ? sim.membersOf(sq).reduce((a, u) => a + (u.state === "ok" ? u.grenades + u.bottles : 0), 0) : 0;
        return { text: String(n), x: b.w - 7, y: b.h - 11, size: 8, color: PAL.hud.button_ink };
      }
      if (b.id === "go" && !buildButton) return { text: "GO", x: 22, y: 9, size: 10, color: PAL.hud.button_ink };
      return null;
    },
  };
}

export const VET_RANK = WOUND.vetRank;
