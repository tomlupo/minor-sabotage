// Style guide §3: nothing hard-codes a colour. Count the opaque pixels of an image whose
// colour is not in docs/art/palette.json. Art tests assert this is zero.
import type { PixelImage } from "../../src/art/pixel";
import { paletteColours } from "../../src/art/palette";

const PALETTE = paletteColours();

export function offPalette(im: PixelImage, minAlpha = 255): { count: number; examples: string[] } {
  let count = 0;
  const examples = new Set<string>();
  for (let i = 0; i < im.data.length; i += 4) {
    if (im.data[i + 3] < minAlpha) continue;
    const key = `${im.data[i]},${im.data[i + 1]},${im.data[i + 2]}`;
    if (!PALETTE.has(key)) {
      count++;
      if (examples.size < 8) examples.add(key);
    }
  }
  return { count, examples: [...examples] };
}

export function opaqueCount(im: PixelImage): number {
  let n = 0;
  for (let i = 3; i < im.data.length; i += 4) if (im.data[i] > 0) n++;
  return n;
}
