// Art lab (dev only, art.html): renders every generator's output for review and contact
// sheets. Each art module registers a file in ./sections/ exporting a default function that
// returns sections; this file never needs editing when a generator is added.
//   ?only=<section file name without .ts>   render one section file
//   ?scale=4                                   the zoom of the large copy (default 4)
import type { PixelImage } from "../art/pixel";
import { toCanvas } from "../art/pixel";

export interface LabItem {
  label: string;
  image: PixelImage;
  /** Zoom for the large copy; 0 hides it. Default from ?scale. */
  scale?: number;
  /** CSS background behind the image. */
  bg?: string;
}
export interface LabSection {
  title: string;
  items: LabItem[];
}

const params = new URLSearchParams(location.search);
const only = params.get("only");
const bigScale = Number(params.get("scale") || 4);
const modules = import.meta.glob<{ default: () => LabSection[] }>("./sections/*.ts", { eager: true });
const root = document.getElementById("lab")!;

function canvasAt(im: PixelImage, scale: number, bg?: string): HTMLCanvasElement {
  const c = toCanvas(im);
  c.style.width = `${im.w * scale}px`;
  c.style.height = `${im.h * scale}px`;
  if (bg) c.style.setProperty("--bg", bg);
  return c;
}

for (const [path, mod] of Object.entries(modules)) {
  const name = path.replace(/^.*\/(.*)\.ts$/, "$1");
  if (only && only !== name) continue;
  let sections: LabSection[] = [];
  try {
    sections = mod.default();
  } catch (e) {
    const err = document.createElement("pre");
    err.textContent = `${name}: ${(e as Error).stack || e}`;
    root.append(err);
    console.error(`art lab section ${name} failed`, e);
    continue;
  }
  for (const s of sections) {
    const h = document.createElement("h2");
    h.textContent = `${name} / ${s.title}`;
    const row = document.createElement("div");
    row.className = "row";
    for (const it of s.items) {
      const fig = document.createElement("figure");
      const sc = it.scale ?? bigScale;
      fig.append(canvasAt(it.image, 1, it.bg));
      if (sc > 1) fig.append(canvasAt(it.image, sc, it.bg));
      const cap = document.createElement("figcaption");
      cap.textContent = `${it.label} (${it.image.w}x${it.image.h})`;
      fig.append(cap);
      row.append(fig);
    }
    root.append(h, row);
  }
}
(window as unknown as { __ms: { ready: boolean } }).__ms = { ready: true };
