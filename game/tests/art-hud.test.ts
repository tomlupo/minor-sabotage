// Fonts and HUD art (src/art/font.ts, src/art/hud.ts): every promised character exists, the
// text functions measure and wrap honestly, every piece has its size, and nothing leaves the
// palette or borrows a reserved colour (style guide §3).
import { describe, expect, it } from "vitest";
import { PAL, colour, type RGB } from "../src/art/palette";
import { img, px, type PixelImage } from "../src/art/pixel";
import {
  CHARSETS, FONT, FONT_BIG, FONT_SMALL, buildFontAtlas, drawText, fitText, hasGlyph, measure, wrapText, type PixelFont,
} from "../src/art/font";
import {
  BUTTON_KINDS, BUTTON_SIZE, GLYPH_NAMES, ICON_NAMES, RANK_NAMES, buildBanner, buildButton, buildCard, buildGlyph,
  buildHoldFlag, buildIcon, buildLogo, buildPanel, buildPaper, buildRank, buildRouteEnd, buildSelection, buildSquadTag,
  buildTag, buildTapRing, buildTurtle, buildWaitMark, type Hp, type Order,
} from "../src/art/hud";
import { offPalette, opaqueCount } from "./helpers/palette-check";

// ---------------------------------------------------------------- helpers

const key = (c: RGB) => `${c[0]},${c[1]},${c[2]}`;
function colours(im: PixelImage): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < im.data.length; i += 4) if (im.data[i + 3]) out.add(`${im.data[i]},${im.data[i + 1]},${im.data[i + 2]}`);
  return out;
}
function uses(im: PixelImage, c: RGB): boolean {
  return colours(im).has(key(c));
}
function partialAlpha(im: PixelImage): number {
  let n = 0;
  for (let i = 3; i < im.data.length; i += 4) if (im.data[i] !== 0 && im.data[i] !== 255) n++;
  return n;
}
const same = (a: PixelImage, b: PixelImage) => a.w === b.w && a.h === b.h && a.data.every((v, i) => v === b.data[i]);

function face(): PixelImage {
  const f = img(10, 10);
  for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) px(f, x, y, y < 4 ? PAL.troopers.headgear.cap[1] : PAL.troopers.skin[1]);
  return f;
}

// The brief's lists, spelled out here so a shrinking CHARSETS cannot pass unnoticed.
const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const LOWER = "abcdefghijklmnopqrstuvwxyz";
const DIGITS = "0123456789";
const PL_UPPER = "ĄĆĘŁŃÓŚŹŻ";
const PL_LOWER = "ąćęłńóśźż";
const WANT: [PixelFont, string][] = [
  [FONT, UPPER + LOWER + PL_LOWER + PL_UPPER + "äöüßÄÖÜ" + DIGITS + ".,:;!?'\"()-–—/+%&*#@…„”«»°★✝→←"],
  [FONT_SMALL, UPPER + DIGITS + PL_UPPER + ".,:;!?'\"()-/"],
  [FONT_BIG, UPPER + PL_UPPER + DIGITS],
];

// ---------------------------------------------------------------- fonts

describe("fonts: character sets", () => {
  for (const [font, want] of WANT) {
    it(`${font.name} draws every character the brief lists`, () => {
      expect([...want].filter((c) => !hasGlyph(font, c))).toEqual([]);
    });
  }
  it("each face draws everything its CHARSETS entry promises", () => {
    for (const [font, set] of [[FONT, CHARSETS.text], [FONT_SMALL, CHARSETS.small], [FONT_BIG, CHARSETS.big]] as const) {
      expect([...set].filter((c) => !hasGlyph(font, c)), font.name).toEqual([]);
    }
  });
  it("every glyph other than the space has ink", () => {
    for (const font of [FONT, FONT_SMALL, FONT_BIG]) {
      const empty = [...font.glyphs].filter(([cp, g]) => cp !== 32 && g.bits.reduce((s, b) => s + b, 0) === 0).map(([cp]) => String.fromCodePoint(cp));
      expect(empty, font.name).toEqual([]);
    }
  });
  it("accented letters differ from their base letters", () => {
    const pairs: [PixelFont, string, string][] = [
      ...[...PL_UPPER].map((c, i) => [FONT, c, "ACELNOSZZ"[i]] as [PixelFont, string, string]),
      ...[...PL_LOWER].map((c, i) => [FONT, c, "acelnoszz"[i]] as [PixelFont, string, string]),
      ...[...PL_UPPER].map((c, i) => [FONT_SMALL, c, "ACELNOSZZ"[i]] as [PixelFont, string, string]),
      ...[...PL_UPPER].map((c, i) => [FONT_BIG, c, "ACELNOSZZ"[i]] as [PixelFont, string, string]),
    ];
    for (const [f, a, b] of pairs) {
      const ga = f.glyphs.get(a.codePointAt(0)!)!, gb = f.glyphs.get(b.codePointAt(0)!)!;
      const differ = ga.w !== gb.w || ga.h !== gb.h || ga.yoff !== gb.yoff || ga.bits.some((v, i) => v !== gb.bits[i]);
      expect(differ, `${f.name} ${a} vs ${b}`).toBe(true);
    }
    // Ż and Ź are told apart (a dot against a stroke)
    for (const f of [FONT, FONT_SMALL, FONT_BIG]) {
      const z1 = f.glyphs.get("Ż".codePointAt(0)!)!, z2 = f.glyphs.get("Ź".codePointAt(0)!)!;
      expect(z1.bits.some((v, i) => v !== z2.bits[i]) || z1.w !== z2.w, f.name).toBe(true);
    }
  });
});

describe("fonts: metrics", () => {
  const capsOf = (f: PixelFont, skip = "") => [...UPPER].filter((c) => !skip.includes(c)).map((c) => f.glyphs.get(c.codePointAt(0)!)!);
  it("FONT: capitals 7 px from the line box's top offset, line height 10", () => {
    expect(FONT.lineHeight).toBe(10);
    expect(FONT.cap).toBe(7);
    for (const g of capsOf(FONT)) { expect(g.h).toBe(7); expect(g.yoff).toBe(FONT.top); }
    expect(FONT.glyphs.get("x".codePointAt(0)!)!.h).toBe(5); // x-height
    expect(FONT.glyphs.get("g".codePointAt(0)!)!.yoff + FONT.glyphs.get("g".codePointAt(0)!)!.h).toBe(FONT.top + 9); // 2 px descender
  });
  it("FONT_SMALL: capitals 5 px, line height 7", () => {
    expect(FONT_SMALL.lineHeight).toBe(7);
    for (const g of capsOf(FONT_SMALL)) { expect(g.h).toBe(5); expect(g.yoff).toBe(FONT_SMALL.top); }
  });
  it("FONT_BIG: capitals 12 px", () => {
    expect(FONT_BIG.cap).toBe(12);
    for (const g of capsOf(FONT_BIG, "Q")) { expect(g.h).toBe(12); expect(g.yoff).toBe(FONT_BIG.top); }
  });
  it("accents on capitals stay inside the line box", () => {
    for (const f of [FONT, FONT_SMALL, FONT_BIG]) {
      for (const c of PL_UPPER) expect(f.glyphs.get(c.codePointAt(0)!)!.yoff, `${f.name} ${c}`).toBeGreaterThanOrEqual(0);
    }
  });
  it("FONT: everything but a capital keeps to rows 0-8, so lines 10 apart never touch", () => {
    const caps = new Set([...UPPER, ...PL_UPPER, ..."ÄÖÜ"]);
    for (const [cp, g] of FONT.glyphs) {
      const ch = String.fromCodePoint(cp);
      if (caps.has(ch) || !g.h) continue;
      expect(g.yoff - FONT.top, `${ch} top`).toBeGreaterThanOrEqual(0);
      expect(g.yoff - FONT.top + g.h, `${ch} bottom`).toBeLessThanOrEqual(9);
    }
    // and in practice: two lines of Polish with descenders over accents keep a blank row
    const im = img(80, 24);
    drawText(im, FONT, 0, 0, "gęsią jagodę\nóśćźń żółw", PAL.hud.paper_ink);
    const rowInk = (y: number) => { for (let x = 0; x < im.w; x++) if (im.data[(y * im.w + x) * 4 + 3]) return true; return false; };
    expect(rowInk(FONT.top + 8)).toBe(true); // the descenders' last row
    expect(rowInk(FONT.top + 9)).toBe(false); // the blank row
    expect(rowInk(FONT.top + 10)).toBe(true); // the accents of the next line
  });
  it("advances include one pixel of spacing and the space is a real gap", () => {
    for (const f of [FONT, FONT_SMALL, FONT_BIG]) {
      expect(f.spacing).toBe(1);
      expect(f.glyphs.get(32)!.adv).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("fonts: measure, drawText, wrapText, fitText", () => {
  const H = FONT.glyphs.get(72)!, I = FONT.glyphs.get(73)!;
  it("measure sums advances without the trailing spacing", () => {
    expect(measure(FONT, "")).toBe(0);
    expect(measure(FONT, "H")).toBe(H.w);
    expect(measure(FONT, "HI")).toBe(H.adv + I.w);
    expect(measure(FONT, "HI\nH")).toBe(measure(FONT, "HI"));
    expect(measure(FONT, "H H")).toBe(H.adv + FONT.glyphs.get(32)!.adv + H.w);
  });
  it("measure matches the ink drawText puts down", () => {
    for (const [f, t] of [[FONT, "Zażółć gęślą jaźń"], [FONT_SMALL, "ZOŚKA 1943"], [FONT_BIG, "MAŁY SABOTAŻ"]] as const) {
      const w = measure(f, t);
      const im = img(w + 20, f.lineHeight + 6);
      drawText(im, f, 10, 2, t, PAL.hud.paper_ink);
      let x0 = Infinity, x1 = -Infinity;
      for (let y = 0; y < im.h; y++) for (let x = 0; x < im.w; x++) if (im.data[(y * im.w + x) * 4 + 3]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); }
      expect(x0, f.name).toBe(10);
      expect(x1 - x0 + 1, f.name).toBeLessThanOrEqual(w + 1); // an ogonek may lean a pixel past the last advance
      expect(x1 - x0 + 1, f.name).toBeGreaterThanOrEqual(w - 1);
    }
  });
  it("drawText places capitals `top` rows down, aligns, and drops a shadow", () => {
    const c = PAL.hud.paper_ink, s = PAL.hud.paper[0];
    const im = img(40, 14);
    const w = drawText(im, FONT, 0, 0, "H", c);
    expect(w).toBe(H.w);
    expect(im.data[(FONT.top * im.w + 0) * 4 + 3]).toBe(255);
    expect(im.data[((FONT.top - 1) * im.w + 0) * 4 + 3]).toBe(0);
    const r = img(40, 14);
    drawText(r, FONT, 30, 0, "H", c, { align: "right" });
    expect(r.data[(FONT.top * r.w + 29) * 4 + 3]).toBe(255);
    expect(r.data[(FONT.top * r.w + 30) * 4 + 3]).toBe(0);
    const m = img(40, 14);
    drawText(m, FONT, 20, 0, "H", c, { align: "center" });
    // a 5 px H centred on x = 20 covers 18..22
    expect(m.data[(FONT.top * m.w + 18) * 4 + 3]).toBe(255);
    expect(m.data[(FONT.top * m.w + 22) * 4 + 3]).toBe(255);
    expect(m.data[(FONT.top * m.w + 17) * 4 + 3]).toBe(0);
    const sh = img(40, 14);
    drawText(sh, FONT, 0, 0, "I", c, { shadow: s });
    // I's bottom serif ends at x = 2; its shadow shows at (3, bottom + 1)
    const yb = FONT.top + 7;
    expect([...sh.data.slice((yb * sh.w + 3) * 4, (yb * sh.w + 3) * 4 + 3)]).toEqual([...s]);
  });
  it("draws what it cannot draw with a stand-in, never nothing", () => {
    const im = img(40, 14);
    drawText(im, FONT_SMALL, 0, 0, "é", PAL.hud.tag_ink); // no é in the tag face: falls back to E
    expect(opaqueCount(im)).toBeGreaterThan(0);
    expect(measure(FONT_SMALL, "abc")).toBe(measure(FONT_SMALL, "ABC"));
  });
  it("wrapText keeps every line inside the width and every word in order", () => {
    const text = "Akcja pod Arsenałem, 26 marca 1943: dwudziestu jeden więźniów odbitych z rąk gestapo. Jan Bytnar „Rudy” umarł 30 marca.";
    for (const width of [60, 120, 200]) {
      const lines = wrapText(FONT, text, width);
      for (const l of lines) expect(measure(FONT, l), `${width}: "${l}"`).toBeLessThanOrEqual(width);
      expect(lines.join(" ")).toBe(text);
    }
    expect(wrapText(FONT, "one\n\ntwo", 200)).toEqual(["one", "", "two"]);
    expect(wrapText(FONT, "", 50)).toEqual([""]);
    const cut = wrapText(FONT, "Przeciwpancerny", 30);
    expect(cut.length).toBeGreaterThan(1);
    for (const l of cut) expect(measure(FONT, l)).toBeLessThanOrEqual(30);
    expect(cut.join("")).toBe("Przeciwpancerny");
  });
  it("fitText cuts with an abbreviation dot", () => {
    expect(fitText(FONT_SMALL, "RUDY", 28)).toBe("RUDY");
    const t = fitText(FONT_SMALL, "SZCZERBIEC", 28);
    expect(t.endsWith(".")).toBe(true);
    expect(measure(FONT_SMALL, t)).toBeLessThanOrEqual(28);
  });
});

describe("fonts: atlas", () => {
  for (const font of [FONT, FONT_SMALL, FONT_BIG]) {
    it(`${font.name}: white glyphs, one cell per character, metrics copied`, () => {
      const a = buildFontAtlas(font);
      expect(a.lineHeight).toBe(font.lineHeight);
      expect(a.size).toBe(font.size);
      expect(Object.keys(a.chars).length).toBe(font.glyphs.size);
      expect([...colours(a.image)]).toEqual([key(colour("hud_extra", "tint"))]);
      expect(offPalette(a.image).count).toBe(0);
      for (const [cp, g] of font.glyphs) {
        const c = a.chars[cp];
        expect(c, String.fromCodePoint(cp)).toBeDefined();
        expect([c.w, c.h, c.xoff, c.yoff, c.adv]).toEqual([g.w, g.h, g.xoff, g.yoff, g.adv]);
        for (let j = 0; j < g.h; j++) for (let i = 0; i < g.w; i++) {
          expect(a.image.data[((c.y + j) * a.image.w + c.x + i) * 4 + 3] > 0).toBe(g.bits[j * g.w + i] === 1);
        }
      }
    });
  }
});

// ---------------------------------------------------------------- HUD pieces

const HPS: Hp[] = ["ok", "low", "down", "dead"];
const ORDERS: (Order | null)[] = [null, "hold", "follow", "cover", "signal"];

/** Every piece the HUD builds, with the size it must have. */
function allPieces(): { name: string; im: PixelImage; w: number; h: number }[] {
  const out: { name: string; im: PixelImage; w: number; h: number }[] = [];
  const f = face();
  for (const hp of HPS) for (let r = 0; r <= 7; r++) for (const selected of [false, true]) {
    out.push({ name: `tag ${hp} r${r} ${selected}`, im: buildTag({ name: "Zośka", rank: r, face: f, hp, selected }), w: 34, h: 28 });
  }
  for (const c of [1, 2, 3] as const) for (const order of ORDERS) for (const selected of [false, true]) {
    out.push({ name: `squad ${c} ${order} ${selected}`, im: buildSquadTag({ leader: "Orsza", colour: c, selected, order, alive: 3, total: 5 }), w: 56, h: 22 });
  }
  for (const k of BUTTON_KINDS) for (const pressed of [false, true]) {
    out.push({ name: `button ${k} ${pressed}`, im: buildButton(k, pressed, { count: 3 }), w: BUTTON_SIZE[k].w, h: BUTTON_SIZE[k].h });
  }
  for (const n of ICON_NAMES) out.push({ name: `icon ${n}`, im: buildIcon(n), w: 12, h: 12 });
  for (const n of GLYPH_NAMES) out.push({ name: `glyph ${n}`, im: buildGlyph(n), w: 7, h: 9 });
  for (let r = 0; r <= 7; r++) out.push({ name: `rank ${r}`, im: buildRank(r), w: 7, h: 5 });
  for (let fr = 0; fr < 4; fr++) out.push({ name: `tap ${fr}`, im: buildTapRing(fr), w: 16, h: 13 });
  out.push({ name: "route end", im: buildRouteEnd(), w: 9, h: 7 });
  out.push({ name: "selection", im: buildSelection(), w: 14, h: 6 });
  for (const s of [1, 2, 3] as const) {
    out.push({ name: `hold ${s}`, im: buildHoldFlag(s), w: 9, h: 14 });
    out.push({ name: `wait ${s}`, im: buildWaitMark(s), w: 9, h: 14 });
  }
  out.push({ name: "paper", im: buildPaper(160, 100, 1), w: 160, h: 100 });
  out.push({ name: "paper small", im: buildPaper(30, 20, 9), w: 30, h: 20 });
  out.push({ name: "banner", im: buildBanner(260, "Rudy hit — Długa Street"), w: 260, h: 18 });
  out.push({ name: "banner cut", im: buildBanner(120, "Wicher is down on Bielańska by the Arsenal"), w: 120, h: 18 });
  out.push({ name: "card", im: buildCard(72, 52, 1), w: 72, h: 52 });
  out.push({ name: "panel", im: buildPanel(120, 40), w: 120, h: 40 });
  out.push({ name: "panel small", im: buildPanel(12, 8), w: 12, h: 8 });
  const logo = buildLogo();
  out.push({ name: "logo", im: logo, w: logo.w, h: logo.h });
  for (const s of [16, 24, 32, 48, 64]) out.push({ name: `turtle ${s}`, im: buildTurtle(s), w: s, h: s });
  return out;
}

describe("hud: sizes", () => {
  const pieces = allPieces();
  it("looks at every piece (4 hp x 8 ranks x 2 tags, 30 squad tags, 24 buttons, 22 icons, ...)", () => {
    expect(pieces.length).toBe(180);
  });
  it("builds every piece at its size, with ink on it", () => {
    for (const p of pieces) {
      expect([p.im.w, p.im.h], p.name).toEqual([p.w, p.h]);
      if (p.name !== "rank 0") expect(opaqueCount(p.im), p.name).toBeGreaterThan(0);
    }
  });
  it("touch targets are at least 29 x 29 art px (44 pt)", () => {
    for (const k of BUTTON_KINDS) expect(Math.min(BUTTON_SIZE[k].w, BUTTON_SIZE[k].h), k).toBeGreaterThanOrEqual(29);
  });
  it("the logo is about 220 px wide and has its subtitle; the turtle's caption adds a line", () => {
    const logo = buildLogo();
    expect(logo.w).toBeGreaterThanOrEqual(200);
    expect(logo.w).toBeLessThanOrEqual(260);
    expect(logo.h).toBeGreaterThanOrEqual(40);
    const t = buildTurtle(48, { caption: true });
    expect(t.h).toBeGreaterThan(48);
  });
});

describe("hud: palette (style guide §3)", () => {
  const pieces = allPieces();
  it("every opaque pixel is a palette colour, and nothing is half transparent", () => {
    for (const p of pieces) {
      const off = offPalette(p.im);
      expect(off.count, `${p.name}: ${off.examples.join(" ")}`).toBe(0);
      expect(partialAlpha(p.im), p.name).toBe(0);
    }
  });
  it("cone_yellow is never used", () => {
    for (const p of pieces) expect(uses(p.im, PAL.shared.cone_yellow), p.name).toBe(false);
  });
  it("select_gold only on a selection, the tap ring, the route's end and the knife", () => {
    const allowed = /^(tag .* true|squad .* true|tap \d|route end|selection|glyph knife)$/;
    for (const p of pieces) {
      if (!allowed.test(p.name)) expect(uses(p.im, PAL.shared.select_gold), p.name).toBe(false);
    }
    expect(uses(buildSelection(), PAL.shared.select_gold)).toBe(true);
  });
  it("squad colours only on squad tags and order markers", () => {
    const sq = [PAL.hud.squads.squad_1, PAL.hud.squads.squad_2, PAL.hud.squads.squad_3];
    for (const p of pieces) {
      if (/^(squad|hold|wait) /.test(p.name)) continue;
      for (const c of sq) expect(uses(p.im, c), `${p.name} uses ${key(c)}`).toBe(false);
    }
  });
  it("poppy_red only for danger and the grave", () => {
    const allowed = /^(tag dead .*|glyph alert|banner.*)$/;
    for (const p of pieces) if (!allowed.test(p.name)) expect(uses(p.im, PAL.shared.poppy_red), p.name).toBe(false);
  });
  it("the three squads read as three colours", () => {
    const tags = [1, 2, 3].map((c) => buildSquadTag({ leader: "Orsza", colour: c as 1 | 2 | 3, selected: false, order: "hold", alive: 3, total: 5 }));
    const main = tags.map((t) => [PAL.hud.squads.squad_1, PAL.hud.squads.squad_2, PAL.hud.squads.squad_3].filter((c) => uses(t, c)).map(key));
    expect(main).toEqual([[key(PAL.hud.squads.squad_1)], [key(PAL.hud.squads.squad_2)], [key(PAL.hud.squads.squad_3)]]);
  });
});

describe("hud: states and determinism", () => {
  it("each health state and each rank draws a different tag", () => {
    const f = face();
    const hp = HPS.map((h) => buildTag({ name: "Kruk", rank: 3, face: f, hp: h }));
    for (let i = 0; i < hp.length; i++) for (let j = i + 1; j < hp.length; j++) expect(same(hp[i], hp[j]), `${HPS[i]} ${HPS[j]}`).toBe(false);
    const ranks = [0, 1, 2, 3, 4, 5, 6, 7].map((r) => buildRank(r));
    for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++) expect(same(ranks[i], ranks[j]), `rank ${i} ${j}`).toBe(false);
    expect(RANK_NAMES.length).toBe(8);
    expect(same(buildTag({ name: "Kruk", rank: 3, face: f, hp: "ok" }), buildTag({ name: "Kruk", rank: 3, face: f, hp: "ok", selected: true }))).toBe(false);
  });
  it("pressed buttons differ from released ones and keep their size", () => {
    for (const k of BUTTON_KINDS) expect(same(buildButton(k), buildButton(k, true)), k).toBe(false);
  });
  it("the grave tag keeps the name and loses the face", () => {
    const f = face();
    const dead = buildTag({ name: "Smyk", rank: 1, face: f, hp: "dead" });
    expect(uses(dead, PAL.troopers.skin[1])).toBe(false);
    expect(uses(dead, PAL.forest.birch_bark[1])).toBe(true);
  });
  it("builds the same pixels every time; seeds change paper and cards", () => {
    const a = allPieces(), b = allPieces();
    a.forEach((p, i) => expect(same(p.im, b[i].im), p.name).toBe(true));
    expect(same(buildPaper(80, 60, 1), buildPaper(80, 60, 2))).toBe(false);
    expect(same(buildPaper(80, 60, 3), buildPaper(80, 60, 3))).toBe(true);
  });
  it("tap ring frames grow", () => {
    const n = [0, 1, 2, 3].map((f) => {
      const im = buildTapRing(f);
      let x0 = 99, x1 = -1;
      for (let y = 0; y < im.h; y++) for (let x = 0; x < im.w; x++) if (im.data[(y * im.w + x) * 4 + 3]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); }
      return x1 - x0;
    });
    expect(n[0]).toBeLessThan(n[1]);
    expect(n[1]).toBeLessThan(n[2]);
    expect(n[2]).toBeLessThanOrEqual(n[3]);
  });
});
