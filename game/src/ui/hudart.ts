// HUD textures from the art (src/art/hud.ts, style guide §8): stamped identity tags with the
// trooper's face, squad tags in their colour, olive buttons. Each texture is cached under a key
// that says what it shows: unit ids and squad indices are numbered afresh in every phase, so
// a key built from them would show the last phase's man.
import Phaser from "phaser";
import type { Sim } from "../sim/sim";
import type { Squad, Unit } from "../sim/types";
import { img, toCanvas, type PixelImage } from "../art/pixel";
import { buildButton, buildSquadTag, buildTag, type ButtonKind } from "../art/hud";

export interface HudArt {
  /** A man's identity tag on the portrait strip; `picked` stamps it as the one acting alone. */
  chip(u: Unit, picked: boolean): string;
  /** A squad's tag: its colour, leader, order and who is left. */
  squadTag(sim: Sim, sq: Squad, led: boolean): string;
  /** An olive button; `count` puts a badge on the grenade and bottle buttons. */
  button(kind: ButtonKind, pressed: boolean, count?: number): string;
}

export function hudArt(scene: Phaser.Scene): HudArt {
  const tex = (key: string, make: () => PixelImage): string => {
    if (!scene.textures.exists(key)) scene.textures.addCanvas(key, toCanvas(make()));
    return key;
  };

  // the 10 x 10 face on a tag is cropped from the trooper's own south-facing idle frame
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

  return {
    chip(u, picked) {
      const hp = hpOf(u);
      const rank = Math.min(7, u.rank);
      return tex(`hud:tag:${u.look}:${u.name}:${hp}:${rank}:${picked}`, () => buildTag({ name: u.name, rank, face: faceOf(u), hp, selected: picked }));
    },
    squadTag(sim, sq, led) {
      const alive = sim.membersOf(sq).filter((u) => u.state !== "dead").length;
      const order = led ? "follow" : sq.order;
      const colour = ((sq.colour % 3) + 1) as 1 | 2 | 3;
      return tex(`hud:sq:${sq.name}:${sq.colour}:${led}:${order}:${alive}:${sq.members.length}`, () =>
        buildSquadTag({ leader: sq.name, colour, selected: led, order, alive, total: sq.members.length }));
    },
    button(kind, pressed, count) {
      return tex(`hud:btn:${kind}:${pressed}:${count ?? ""}`, () => buildButton(kind, pressed, count === undefined ? {} : { count }));
    },
  };
}
