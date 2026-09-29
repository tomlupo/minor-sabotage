// Art lab: the soldier bake-off (style guide §10) as a phone page. Two partisan riflemen walk
// a circle each on the cobbles, side by side and in step, so every moment shows both in the
// same facing and frame: on the left the pixel templates (src/art/troopers.ts, drawn by the
// game at boot), on the right the Blender render (tools/art/blender_trooper.py, loaded from
// public/bakeoff/). The walk runs at the game's pace (TROOPER_ANIMS.walk, SPEED.partisan) and
// the facing comes from the direction of travel as in the game (render/iso.ts facingOf), the
// west mirrored. Below the stage, both contact sheets at 4x.
//   ?only=bakeoff        the page
//   &zoom=3              CSS px per art px (default 1.5, the game's scale on an iPhone);
//                        a tap on the stage switches between 1.5 and 3
import { css, PAL } from "../../art/palette";
import { hash2, img, px, toCanvas } from "../../art/pixel";
import { buildTrooperSheet, TROOPER_ANIMS } from "../../art/troopers";
import { ANIM_FRAMES, FACINGS, TROOPER_CELL, type Facing } from "../../art/types";
import { facingOf, PX_X, PX_Y } from "../../render/iso";
import { SPEED } from "../../sim/tuning";
import type { LabSection } from "../main";
import { PARTISANS } from "./troopers";

/** What tools/art/blender_trooper.py writes beside its sheet. */
interface Manifest {
  cell: number;
  /** Where the ground point under the soldier sits in each cell. */
  anchor: [number, number];
  /** Cell columns, "idle_0", "walk_0"... */
  columns: string[];
  rows: Facing[];
}

/** One soldier's frames: a sheet, where a frame sits on it, and the cell's ground point. */
interface Soldier {
  label: string;
  source: string;
  sheet: CanvasImageSource;
  at: (anim: "idle" | "walk", facing: Facing, i: number) => [number, number];
  ax: number;
  ay: number;
}

const CELL = TROOPER_CELL.w;
const GAME_ZOOM = 1.5;
const SHEET_URL = "bakeoff/blender.png";
const MANIFEST_URL = "bakeoff/blender.json";

function pixelSoldier(): Soldier {
  const rifleman = PARTISANS[0][1]; // the art lab's rifleman: partisan, cap, sten
  const sheet = buildTrooperSheet(rifleman);
  const byName = new Map(sheet.frames.map((f) => [f.name, f]));
  return {
    label: "pixel",
    source: "src/art/troopers.ts",
    sheet: toCanvas(sheet.image),
    at: (anim, facing, i) => {
      const f = byName.get(`${anim}_${facing}_${i}`);
      if (!f) throw new Error(`bakeoff: no pixel frame ${anim}_${facing}_${i}`);
      return [f.x, f.y];
    },
    ax: TROOPER_CELL.ax,
    ay: TROOPER_CELL.ay,
  };
}

async function blenderSoldier(): Promise<Soldier> {
  const res = await fetch(MANIFEST_URL);
  if (!res.ok) throw new Error(`bakeoff: ${MANIFEST_URL}: HTTP ${res.status}`);
  const m = (await res.json()) as Manifest;
  const img = new Image();
  img.src = SHEET_URL;
  await img.decode();
  return {
    label: "Blender",
    source: "tools/art/blender_trooper.py",
    sheet: img,
    at: (anim, facing, i) => {
      const col = m.columns.indexOf(`${anim}_${i}`);
      const row = m.rows.indexOf(facing);
      if (col < 0 || row < 0) throw new Error(`bakeoff: no Blender frame ${anim}_${facing}_${i}`);
      return [col * m.cell, row * m.cell];
    },
    ax: m.anchor[0],
    ay: m.anchor[1],
  };
}

/** Draw a frame with its ground point on (x, y); flipped frames mirror about it, as Phaser's
 *  setFlipX does with the origin on the anchor. */
function drawFrame(ctx: CanvasRenderingContext2D, s: Soldier, sx: number, sy: number, x: number, y: number, flip: boolean): void {
  if (!flip) {
    ctx.drawImage(s.sheet, sx, sy, CELL, CELL, x - s.ax, y - s.ay, CELL, CELL);
    return;
  }
  ctx.save();
  ctx.translate(x, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(s.sheet, sx, sy, CELL, CELL, -s.ax, y - s.ay, CELL, CELL);
  ctx.restore();
}

/** The game's unit shadow (render/world.ts): a 10 x 4 ellipse of `shadow` at 30 %, drawn in
 *  whole pixels. */
function drawShadow(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.fillStyle = css(PAL.shared.shadow, 0.3);
  for (let yy = -2; yy < 2; yy++) {
    for (let xx = -5; xx < 5; xx++) {
      if (((xx + 0.5) / 5) ** 2 + ((yy + 0.5) / 2) ** 2 <= 1) ctx.fillRect(x + xx, y + yy, 1, 1);
    }
  }
}

/** Plain granite setts in the palette's cobble ramp and mortar: 4 x 3 px stones in staggered
 *  courses, each a tone of the ramp, lit on its top-left pixel. The game's own road painter
 *  lays slush over most of an open street, which would put a different ground behind each
 *  soldier; this keeps both on the same calm cobbles. */
function cobbles(w: number, h: number): HTMLCanvasElement {
  const im = img(w, h);
  const [dark, mid, lit] = PAL.city_1943.cobble;
  for (let y = 0; y < h; y++) {
    const course = Math.floor(y / 4);
    for (let x = 0; x < w; x++) {
      const xx = x + (course % 2) * 2;
      const stone = Math.floor(xx / 5);
      if (y % 4 === 3 || xx % 5 === 4) { px(im, x, y, PAL.city_1943.mortar); continue; }
      const r = hash2(stone, course, 1943);
      const tone = r < 0.22 ? dark : r > 0.86 ? lit : mid;
      px(im, x, y, y % 4 === 0 && xx % 5 === 0 && tone !== lit ? lit : tone);
    }
  }
  return toCanvas(im);
}

function label(text: string, sub: string): HTMLDivElement {
  const d = document.createElement("div");
  d.style.cssText = `position:absolute;padding:3px 7px;font:12px/1.3 ui-monospace,Menlo,monospace;pointer-events:none;border-radius:3px;white-space:nowrap;transform:translateX(-50%);color:${css(PAL.hud.paper[1])};background:${css(PAL.shared.outline, 0.72)}`;
  d.innerHTML = `<b>${text}</b> <span style="opacity:.7">${sub}</span>`;
  return d;
}

/** The stage: cobbles filling the screen, one circle per soldier, both walking in step.
 *  Returns the soldiers' name tags. */
function stage(root: HTMLElement, soldiers: () => Soldier[]): HTMLDivElement[] {
  const params = new URLSearchParams(location.search);
  let zoom = Number(params.get("zoom")) || GAME_ZOOM;
  const box = document.createElement("div");
  box.style.cssText = "position:relative;overflow:hidden;touch-action:manipulation;cursor:pointer";
  const cv = document.createElement("canvas");
  cv.style.cssText = "display:block;image-rendering:pixelated;background:none";
  box.append(cv);
  const tags = [label("pixel", "src/art/troopers.ts"), label("Blender", "loading...")];
  const foot = label("", "");
  foot.style.transform = "none";
  foot.style.whiteSpace = "normal";
  foot.style.right = "6px";
  box.append(...tags, foot);
  root.append(box);
  const ctx = cv.getContext("2d")!;

  let ground = cobbles(1, 1);
  let centres: [number, number][] = [];
  let radius = 1; // metres
  const layout = () => {
    const cssW = document.documentElement.clientWidth, cssH = window.innerHeight;
    const W = Math.ceil(cssW / zoom), H = Math.ceil(cssH / zoom);
    cv.width = W;
    cv.height = H;
    cv.style.width = `${W * zoom}px`;
    cv.style.height = `${H * zoom}px`;
    box.style.height = `${cssH}px`;
    ground = cobbles(W, H);
    // side by side when the phone is held sideways, one above the other when upright
    const wide = W >= H;
    const cw = wide ? W / 2 : W, ch = wide ? H : H / 2;
    centres = wide ? [[W / 4, H / 2 + 8], [(3 * W) / 4, H / 2 + 8]] : [[W / 2, H / 4 + 8], [W / 2, (3 * H) / 4 + 8]];
    radius = Math.max(1.5, Math.min((cw * 0.36) / PX_X, (ch * 0.3) / PX_Y));
    tags.forEach((t, k) => {
      t.style.left = `${centres[k][0] * zoom}px`;
      t.style.top = `${Math.max(6, (centres[k][1] - radius * PX_Y - 34) * zoom - 22)}px`;
    });
    foot.style.left = "6px";
    foot.style.bottom = "6px";
    foot.innerHTML = `walk: ${ANIM_FRAMES.walk} frames at ${TROOPER_ANIMS.walk.fps} fps, ${SPEED.partisan} m/s, facing from the direction of travel. Zoom ${zoom}${zoom === GAME_ZOOM ? ", the game's" : ""}: tap to change.`;
  };
  layout();
  window.addEventListener("resize", layout);
  box.addEventListener("click", () => {
    zoom = zoom === GAME_ZOOM ? 3 : GAME_ZOOM;
    layout();
  });

  let t0 = -1; // the first frame's time stamp: rAF's can be earlier than performance.now()
  const tick = (now: number) => {
    if (t0 < 0) t0 = now;
    const t = (now - t0) / 1000;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(ground, 0, 0);
    // clockwise on screen (y points south): moving along the tangent
    const th = (t * SPEED.partisan) / radius;
    const { f, flip } = facingOf(th + Math.PI / 2);
    const i = Math.floor(t * TROOPER_ANIMS.walk.fps) % ANIM_FRAMES.walk;
    soldiers().forEach((s, k) => {
      const x = Math.round(centres[k][0] + Math.cos(th) * radius * PX_X);
      const y = Math.round(centres[k][1] + Math.sin(th) * radius * PX_Y);
      drawShadow(ctx, x, y);
      const [sx, sy] = s.at("walk", f, i);
      drawFrame(ctx, s, sx, sy, x, y, flip);
    });
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return tags;
}

/** A contact sheet like docs/art/bakeoff/*-1x.png (idle | walk 0-3, rows s se e ne n), on
 *  the palette's mid cobble, shown at 1x and 4x. */
function contactSheet(s: Soldier): HTMLElement {
  const c = document.createElement("canvas");
  c.width = c.height = 5 * CELL;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = css(PAL.city_1943.cobble[1]);
  ctx.fillRect(0, 0, c.width, c.height);
  FACINGS.forEach((f, r) => {
    const cells: [number, number][] = [s.at("idle", f, 0), ...[0, 1, 2, 3].map((i) => s.at("walk", f, i))];
    cells.forEach(([sx, sy], col) => ctx.drawImage(s.sheet, sx, sy, CELL, CELL, col * CELL, r * CELL, CELL, CELL));
  });
  const fig = document.createElement("figure");
  const big = document.createElement("canvas");
  big.width = c.width;
  big.height = c.height;
  big.getContext("2d")!.drawImage(c, 0, 0);
  big.style.width = big.style.height = `${c.width * 4}px`;
  const cap = document.createElement("figcaption");
  cap.textContent = `${s.label}: ${s.source}`;
  fig.append(c, big, cap);
  return fig;
}

export default function bakeoff(): LabSection[] {
  if (typeof document === "undefined") return [];
  const root = document.getElementById("lab")!;
  const block = document.createElement("div");
  root.append(block);
  const pixel = pixelSoldier();
  let blender: Soldier | null = null;
  const tags = stage(block, () => (blender ? [pixel, blender] : [pixel]));

  const h = document.createElement("h2");
  h.textContent = "bakeoff / contact sheets: idle | walk 0-3, rows s se e ne n (4x)";
  const row = document.createElement("div");
  row.className = "row";
  row.append(contactSheet(pixel));
  block.append(h, row);

  blenderSoldier().then(
    (s) => {
      blender = s;
      tags[1].innerHTML = `<b>Blender</b> <span style="opacity:.7">${s.source}</span>`;
      row.append(contactSheet(s));
    },
    (e: unknown) => {
      tags[1].innerHTML = `<b>Blender</b> <span style="opacity:.7">no sheet: run tools/art/blender_trooper.py</span>`;
      console.error("bakeoff: the Blender sheet did not load", e);
    },
  );
  return [];
}
