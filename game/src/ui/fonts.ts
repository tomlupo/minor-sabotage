// The game's two typefaces, carried in the bundle (the preview is one self-contained page):
// Courier Prime, a typewriter, for the papers (the briefing, the decision, the history note),
// and Barlow Semi Condensed, a sturdy sans, for the HUD, labels and buttons. Both are under the
// SIL Open Font License (public/licenses). Latin-ext carries the Polish letters.
import cpLatin400 from "@fontsource/courier-prime/files/courier-prime-latin-400-normal.woff2?inline";
import cpExt400 from "@fontsource/courier-prime/files/courier-prime-latin-ext-400-normal.woff2?inline";
import cpLatin700 from "@fontsource/courier-prime/files/courier-prime-latin-700-normal.woff2?inline";
import cpExt700 from "@fontsource/courier-prime/files/courier-prime-latin-ext-700-normal.woff2?inline";
import bsLatin500 from "@fontsource/barlow-semi-condensed/files/barlow-semi-condensed-latin-500-normal.woff2?inline";
import bsExt500 from "@fontsource/barlow-semi-condensed/files/barlow-semi-condensed-latin-ext-500-normal.woff2?inline";
import bsLatin700 from "@fontsource/barlow-semi-condensed/files/barlow-semi-condensed-latin-700-normal.woff2?inline";
import bsExt700 from "@fontsource/barlow-semi-condensed/files/barlow-semi-condensed-latin-ext-700-normal.woff2?inline";

export const TYPEWRITER = "Courier Prime";
export const SANS = "Barlow Semi Condensed";

// the ranges each file covers, as @fontsource declares them
const LATIN = "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD";
const LATIN_EXT = "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF";

const FACES: [string, string, string, string][] = [
  [TYPEWRITER, "400", cpLatin400, LATIN], [TYPEWRITER, "400", cpExt400, LATIN_EXT],
  [TYPEWRITER, "700", cpLatin700, LATIN], [TYPEWRITER, "700", cpExt700, LATIN_EXT],
  [SANS, "500", bsLatin500, LATIN], [SANS, "500", bsExt500, LATIN_EXT],
  [SANS, "700", bsLatin700, LATIN], [SANS, "700", bsExt700, LATIN_EXT],
];

/** The bytes of an inlined font. Handed to FontFace as data, a face is never fetched, so a page
 *  whose content policy refuses fonts from data: URLs (a preview host may) still gets it. */
function bytesOf(dataUrl: string): ArrayBuffer {
  const bin = atob(dataUrl.slice(dataUrl.indexOf(",") + 1));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

/**
 * Load both faces before any text is drawn: a text measured in a face still loading is
 * measured in the fallback, and keeps that size. Never throws; a face that fails to load
 * falls back to the browser's own.
 */
export async function loadFonts(): Promise<void> {
  await Promise.all(FACES.map(async ([family, weight, src, range]) => {
    try {
      const face = new FontFace(family, bytesOf(src), { weight, unicodeRange: range });
      document.fonts.add(face);
      await face.load();
    } catch {
      // the fallback face draws it
    }
  }));
}
