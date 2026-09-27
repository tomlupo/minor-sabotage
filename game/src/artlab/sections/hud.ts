// Art lab: fonts and HUD pieces (src/art/font.ts, src/art/hud.ts).
//   art.html?only=hud&scale=3              everything, on one page
//   art.html?only=hud&scale=3&part=tags    one group: phone, fonts, tags, buttons, symbols,
//                                          markers, panels, title
// Small pieces show at the page's scale; the big ones (the phone view, paper, the logo, text
// samples) at 1.5x or 2x, so the whole page stays under the 8192 device px a headless full-page
// shot can capture in one piece (tools/shot.mjs at dsf 2: 4096 css px).
import type { LabItem, LabSection } from "../main";
import { PAL, css, type RGB } from "../../art/palette";
import { blit, img, px, rect, type PixelImage } from "../../art/pixel";
import { FONT, FONT_BIG, FONT_SMALL, buildFontAtlas, drawText, measure, wrapText, type PixelFont } from "../../art/font";
import {
  BUTTON_KINDS, GLYPH_NAMES, ICON_NAMES, RANK_NAMES, buildBanner, buildButton, buildCard, buildGlyph, buildHoldFlag, buildIcon,
  buildLogo, buildPanel, buildPaper, buildRank, buildRouteEnd, buildSelection, buildSquadTag, buildTag, buildTapRing, buildTurtle,
  buildWaitMark, type Hp, type Order,
} from "../../art/hud";

const part = new URLSearchParams(location.search).get("part");
const want = (p: string) => !part || part === p;

const DARK = css(PAL.hud.button_rim);
const STREET = css(PAL.city_1943.cobble[1]);
const SNOW = css(PAL.city_1943.dirty_snow[1]);
const PAPER = css(PAL.hud.paper[0]);

/** Text on a plain field, padded, at 1x. */
function textImage(font: PixelFont, text: string, ink: RGB, o: { pad?: number; field?: RGB; shadow?: RGB; lineGap?: number } = {}): PixelImage {
  const pad = o.pad ?? 3;
  const lines = text.split("\n").length;
  const im = img(measure(font, text) + pad * 2 + 1, lines * (font.lineHeight + (o.lineGap ?? 0)) + pad * 2 + 2);
  if (o.field) rect(im, 0, 0, im.w, im.h, o.field);
  drawText(im, font, pad, pad, text, ink, { shadow: o.shadow, lineGap: o.lineGap });
  return im;
}

// ---------------------------------------------------------------- sample faces (10 x 10)

const T = PAL.troopers;
const FACE_ROWS: Record<string, string[]> = {
  cap: ["..oooooo..", ".oHHHhhho.", ".ohhhhhhDo", "oDDDDDDDDo", ".osssssSo.", ".oseSseSo.", ".osssssSo.", "..oSssSo..", ".ojjwrjjo.", "ojjjwrjjjo"],
  hat: ["...oooo...", "..oHhhho..", ".ohhhhhhDo", "oDDDDDDDDo", ".osssssSo.", ".oseSseSo.", ".osssssSo.", "..oSssSo..", ".ojjjjwro.", "ojjjjjjwro"],
  helmet: ["..oooooo..", ".oHHhhhho.", "oHhhhhhhDo", "oDDDDDDDDo", "oosssssSoo", ".oseSseSo.", ".osssssSo.", "..oSssSo..", ".ojjwrjjo.", "ojjjwrjjjo"],
  rookie: [".oooooooo.", "oHHhhhhhDo", "ohhhhhhhDo", "oDDDDDDDDo", "oDDDDDDDDo", ".osssssSo.", ".osssssSo.", "..oSssSo..", ".ojjjwrjo.", "ojjjjwrjjo"],
};
/** Stand-in faces until the trooper sheets supply the real crops. */
function sampleFace(kind: keyof typeof FACE_ROWS, jacket: number): PixelImage {
  const hg = ({ cap: T.headgear.cap, hat: T.headgear.hat, helmet: T.headgear.helmet_wz31, rookie: T.headgear.stahlhelm } as Record<string, readonly RGB[]>)[kind]!;
  const key: Record<string, RGB> = {
    o: PAL.shared.outline, H: hg[2], h: hg[1], D: hg[0], s: T.skin[1], S: T.skin[0], e: T.eye,
    j: T.partisan_jackets[jacket % 4][1], w: T.armband.white, r: T.armband.red,
  };
  const im = img(10, 10);
  FACE_ROWS[kind].forEach((row, y) => [...row].forEach((ch, x) => { if (key[ch]) px(im, x, y, key[ch]); }));
  return im;
}

const ROSTER = [
  { name: "Wicher", face: sampleFace("cap", 0) },
  { name: "Ola", face: sampleFace("hat", 1) },
  { name: "Kruk", face: sampleFace("helmet", 2) },
  { name: "Smyk", face: sampleFace("rookie", 3) },
  { name: "Zośka", face: sampleFace("cap", 2) },
  { name: "Szczerbiec", face: sampleFace("hat", 0) },
];
const LEADERS = ["Zośka", "Orsza", "Kołek"];

// ---------------------------------------------------------------- sections

function fontSection(): LabSection {
  const ink = PAL.hud.button_ink, paper = PAL.hud.paper[1], pink = PAL.hud.paper_ink, shadow = PAL.shared.outline;
  const history = wrapText(FONT, "History. On 26 March 1943 the Grey Ranks freed Jan Bytnar \"Rudy\" and twenty other prisoners from a prison truck at the Arsenal in Warsaw. Rudy and Alek died of their wounds within days. The next day the Germans shot 140 prisoners, Poles and Jews, in the Pawiak courtyard.", 220);
  const note = img(228, history.length * FONT.lineHeight + 8);
  rect(note, 0, 0, note.w, note.h, paper);
  history.forEach((l, i) => drawText(note, FONT, 4, 4 + i * FONT.lineHeight, l, pink));
  return {
    title: "fonts: FONT (cap 7, line 10), FONT_SMALL (cap 5, line 7), FONT_BIG (stencil, cap 12)",
    items: [
      {
        label: "FONT pangrams: English, Polish, German",
        image: textImage(FONT, [
          "The quick brown fox jumps over the lazy dog.", "THE QUICK BROWN FOX JUMPS OVER THE LAZY DOG!",
          "Pchnąć w tę łódź jeża lub ośm skrzyń fig.", "Zażółć gęślą jaźń. ZAŻÓŁĆ GĘŚLĄ JAŹŃ.",
          "Victor jagt zwölf Boxkämpfer quer über den großen Sylter Deich.", "ÄRGER ÜBER ÖL. Straße, Maß, Fuß.",
          "0123456789 .,:;!?'\"()-–—/+%&*#@… „Kamienie na szaniec”", "«Arsenał» 26° ★ ✝ → ← ×3 · $<>=[]_|~^{}\\`",
        ].join("\n"), ink, { lineGap: 1 }),
        bg: DARK, scale: 1.5,
      },
      {
        label: "FONT on paper, running Polish at line height 10",
        image: textImage(FONT, "Rudy ranny na Długiej. — Alek, Zośka: 26 III 1943, godz. 17:00.\nAkcja pod Arsenałem: 21 więźniów odbitych.\nGęsią jagodą Zośka częstuje Rudego;\nśpiący żółw żuje źdźbło, a Jaś gra.", pink, { field: paper }),
        scale: 2,
      },
      {
        label: "HUD strings in capitals, shadowed, lineGap 1",
        image: textImage(FONT, "RUDY HIT — DŁUGA STREET\nCEL: ZATRZYMAĆ WIĘŹNIARKĘ PRZY ARSENALE\nGRANATY ×3 · BUTELKI ×2 · 17:05 → GO", ink, { shadow, lineGap: 1 }),
        bg: STREET, scale: 2,
      },
      {
        label: "FONT_SMALL: names, set, words",
        image: textImage(FONT_SMALL, "WICHER OLA KRUK SMYK ZOŚKA RUDY ALEK ORSZA\nĄĆĘŁŃÓŚŹŻ 0123456789 .,:;!?'\"()-–—/+%&#*…×°\nŻÓŁW PRACUJ POWOLI ŚWIT ŹRÓDŁO ŁĄKA GĘŚ", PAL.hud.tag_ink, { field: PAL.hud.tag_steel[1], lineGap: 1 }),
      },
      {
        label: "FONT_BIG: capitals, Polish, digits, words",
        image: textImage(FONT_BIG, "ABCDEFGHIJKLM\nNOPQRSTUVWXYZ\nĄĆĘŁŃÓŚŹŻ .,:;!?'\"()-/\n0123456789\nMAŁY SABOTAŻ GO!", ink, { shadow }),
        bg: STREET, scale: 1.5,
      },
      { label: "wrapText at 220 px", image: note, scale: 1.5 },
      ...[FONT, FONT_SMALL, FONT_BIG].map((f) => ({ label: `atlas ${f.name}`, image: buildFontAtlas(f).image, bg: "#000", scale: 1 })),
    ],
  };
}

function tagSection(): LabSection {
  const items: LabItem[] = (["ok", "low", "down", "dead"] as Hp[]).flatMap((h, i) => [
    { label: h, image: buildTag({ name: ROSTER[i].name, rank: 4 - i, face: ROSTER[i].face, hp: h }), bg: STREET },
    { label: `${h} sel`, image: buildTag({ name: ROSTER[i].name, rank: 4 - i, face: ROSTER[i].face, hp: h, selected: true }), bg: STREET },
  ]);
  for (let r = 0; r <= 7; r++) {
    const who = ROSTER[r % ROSTER.length];
    items.push({ label: `rank ${r}`, image: buildTag({ name: who.name, rank: r, face: who.face, hp: "ok" }), bg: SNOW });
  }
  return { title: "identity tags 34x28: ok, low, down, dead (plain and selected); ranks 0-7", items };
}

function squadSection(): LabSection {
  const items: LabItem[] = [];
  for (const c of [1, 2, 3] as const) {
    items.push({ label: `${c} sel`, image: buildSquadTag({ leader: LEADERS[c - 1], colour: c, selected: true, order: null, alive: 5, total: 5 }), bg: STREET, scale: 2 });
    for (const o of ["hold", "follow", "cover", "signal"] as Order[]) {
      const sel = c === 2 && o === "cover";
      items.push({ label: `${c} ${o}${sel ? " sel" : ""}`, image: buildSquadTag({ leader: LEADERS[c - 1], colour: c, selected: sel, order: o, alive: 3 + (c % 2), total: 5 }), bg: STREET, scale: 2 });
    }
  }
  return { title: "squad tags 56x22: three squads, selected or not, each order", items };
}

function buttonSection(): LabSection {
  const items: LabItem[] = BUTTON_KINDS.flatMap((k) => [
    { label: k, image: buildButton(k, false, { count: k === "grenade" ? 3 : k === "bottle" ? 2 : undefined }), bg: STREET },
    { label: `${k} down`, image: buildButton(k, true, { count: k === "grenade" ? 3 : k === "bottle" ? 0 : undefined }), bg: STREET },
  ]);
  return { title: "buttons, released and pressed (30 art px = 45 pt, over the 44 pt minimum)", items };
}

function symbolSection(): LabSection {
  return {
    title: "icons 12x12 (button ink; task icons in paper ink), head glyphs 7x9, rank marks 7x5",
    items: [
      ...ICON_NAMES.map((n) => ({ label: n, image: buildIcon(n), bg: DARK })),
      ...(["car", "truck", "phone", "charge"] as const).map((n) => ({ label: `${n} ink`, image: buildIcon(n, PAL.hud.paper_ink), bg: css(PAL.hud.paper[1]) })),
      ...GLYPH_NAMES.map((n) => ({ label: n, image: buildGlyph(n), bg: STREET })),
      ...GLYPH_NAMES.map((n) => ({ label: "on snow", image: buildGlyph(n), bg: SNOW })),
      ...[0, 1, 2, 3, 4, 5, 6, 7].map((r) => ({ label: RANK_NAMES[r], image: buildRank(r), bg: css(PAL.hud.tag_steel[1]) })),
    ],
  };
}

function markerSection(): LabSection {
  const items: LabItem[] = [];
  for (const bg of [STREET, SNOW]) {
    for (let f = 0; f < 4; f++) items.push({ label: `tap ${f}`, image: buildTapRing(f), bg });
    items.push({ label: "route", image: buildRouteEnd(), bg });
    items.push({ label: "sel", image: buildSelection(), bg });
    for (const s of [1, 2, 3] as const) items.push({ label: `hold ${s}`, image: buildHoldFlag(s), bg });
    for (const s of [1, 2, 3] as const) items.push({ label: `wait ${s}`, image: buildWaitMark(s), bg });
  }
  return { title: "map markers: tap ring (4 frames), route end, selection, hold flag and wait mark per squad", items };
}

function panelSection(): LabSection {
  return {
    title: "paper, pause banner, task cards, dark panel",
    items: [
      { label: "paper 160x100 seed 1", image: buildPaper(160, 100, 1), bg: DARK, scale: 1.5 },
      { label: "paper 64x48 seed 2", image: buildPaper(64, 48, 2), bg: DARK },
      { label: "card 72x52 seed 1", image: buildCard(72, 52, 1), bg: PAPER, scale: 2 },
      { label: "card 72x52 seed 2", image: buildCard(72, 52, 2), bg: PAPER, scale: 2 },
      { label: "panel 120x40", image: buildPanel(120, 40), bg: STREET, scale: 2 },
      { label: "banner 260", image: buildBanner(260, "Rudy hit — Długa Street"), bg: STREET, scale: 2 },
      { label: "banner 150 (cut)", image: buildBanner(150, "Wicher is down on Bielańska by the Arsenal"), bg: STREET, scale: 2 },
      { label: "panel 40x16", image: buildPanel(40, 16), bg: STREET },
    ],
  };
}

function titleSection(): LabSection {
  return {
    title: "title art: logo and the minor-sabotage turtle",
    items: [
      { label: "logo", image: buildLogo(), bg: css(PAL.city_1943.plaster_green[1]), scale: 2 },
      { label: "logo on brick", image: buildLogo(), bg: css(PAL.city_1943.brick[1]), scale: 1 },
      { label: "turtle 16", image: buildTurtle(16), bg: css(PAL.city_1943.plaster_ochre[0]) },
      { label: "turtle 24", image: buildTurtle(24), bg: css(PAL.city_1943.plaster_ochre[0]) },
      { label: "turtle 32", image: buildTurtle(32), bg: css(PAL.city_1943.plaster_green[0]) },
      { label: "turtle 48 + caption", image: buildTurtle(48, { caption: true }), bg: css(PAL.city_1943.brick[1]), scale: 2 },
      { label: "turtle 64 in soot + caption", image: buildTurtle(64, { caption: true, colour: PAL.city_1943.soot[0] }), bg: css(PAL.city_1943.plaster_cream[1]), scale: 1.5 },
    ],
  };
}

/** The HUD laid out on a 568 x 262 phone view, as in the port (style guide §8). */
function phoneMock(): PixelImage {
  const W = 568, H = 262;
  const im = img(W, H);
  const cob = PAL.city_1943.cobble;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) px(im, x, y, cob[((x >> 3) + (y >> 2)) % 3 === 0 ? 0 : 1]);
  const states: Hp[] = ["ok", "ok", "low", "down", "ok", "dead"];
  ROSTER.forEach((r, i) => blit(im, buildTag({ name: r.name, rank: [3, 2, 1, 0, 5, 1][i], face: r.face, hp: states[i], selected: i === 0 }), 8 + i * 36, 6));
  ([1, 2, 3] as const).forEach((c, i) => blit(im, buildSquadTag({ leader: LEADERS[i], colour: c, selected: c === 1, order: c === 1 ? null : c === 2 ? "cover" : "signal", alive: 5 - i, total: 5 }), 8 + i * 58, 38));
  blit(im, buildButton("map"), W - 8 - 30 - 34, 8);
  blit(im, buildButton("pause"), W - 8 - 30, 8);
  blit(im, buildButton("fire"), 10, H - 10 - 44);
  blit(im, buildButton("grenade", false, { count: 3 }), 60, H - 10 - 36);
  blit(im, buildButton("bottle", false, { count: 2 }), 100, H - 10 - 36);
  blit(im, buildButton("go"), 142, H - 10 - 30);
  (["hold", "follow", "cover", "signal"] as const).forEach((k, i) => blit(im, buildButton(k), W - 8 - 30 - (3 - i) * 34, H - 10 - 30));
  blit(im, buildBanner(260, "Rudy hit — Długa Street"), (W - 260) >> 1, 90);
  blit(im, buildSelection(), 300, 170);
  blit(im, buildTapRing(1), 380, 150);
  blit(im, buildRouteEnd(), 430, 190);
  blit(im, buildHoldFlag(2), 250, 140);
  blit(im, buildWaitMark(3), 470, 120);
  blit(im, buildGlyph("alert"), 330, 120);
  blit(im, buildGlyph("suspicious"), 350, 120);
  return im;
}

export default function (): LabSection[] {
  const out: LabSection[] = [];
  if (want("phone")) out.push({ title: "the HUD on a 568 x 262 phone view: 1x, and 1.5x (the phone's 1.5 pt per art px)", items: [{ label: "layout", image: phoneMock(), scale: 1.5 }] });
  if (want("fonts")) out.push(fontSection());
  if (want("tags")) out.push(tagSection(), squadSection());
  if (want("buttons")) out.push(buttonSection());
  if (want("symbols")) out.push(symbolSection());
  if (want("markers")) out.push(markerSection());
  if (want("panels")) out.push(panelSection());
  if (want("title")) out.push(titleSection());
  return out;
}
