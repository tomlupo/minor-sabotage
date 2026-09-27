#!/usr/bin/env node
// Headless playtest harness: starts Vite, opens the game in Chrome at iPhone 15 landscape
// with touch, runs scripted steps and saves screenshots to game/shots/.
//
//   node tools/shot.mjs --q "scene=game&debug=1" --out game --wait 1500
//   node tools/shot.mjs --steps steps.json          (a JSON array of steps, see below)
//   node tools/shot.mjs --steps '[{"wait":500},{"tap":[400,200]},{"shot":"after-tap"}]'
//
// Steps: {"wait": ms} | {"tap": [cssX, cssY]} | {"drag": [x0,y0,x1,y1,ms]} |
//        {"eval": "js"} (result printed) | {"until": "js expr", "timeout": ms} |
//        {"shot": "name"} | {"hold": [cssX, cssY, ms]}
//
// Exits 1 if the page logs an error or an uncaught exception, so a broken frame never
// passes as a screenshot.
import { createServer } from "vite";
import { chromium } from "playwright-core";
import { mkdirSync, readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith("--")) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith("--") ? arr[i + 1] : "1"]);
    return acc;
  }, []),
);
const size = (args.size || "852x393").split("x").map(Number);
const dsf = Number(args.dsf || 2);
const q = args.q || "";
let steps = [];
if (args.steps) steps = JSON.parse(existsSync(args.steps) ? readFileSync(args.steps, "utf8") : args.steps);
if (!steps.some((s) => s.shot)) steps.push({ wait: Number(args.wait || 1200) }, { shot: args.out || "shot" });

mkdirSync(resolve(root, "shots"), { recursive: true });
const server = await createServer({ root, logLevel: "error", server: { port: 0, host: "127.0.0.1" } });
await server.listen();
const base = server.resolvedUrls.local[0];
const browser = await chromium.launch({
  executablePath: process.env.CHROME || "/usr/bin/google-chrome",
  headless: true,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"],
});
const ctx = await browser.newContext({
  viewport: { width: size[0], height: size[1] },
  deviceScaleFactor: dsf,
  isMobile: true,
  hasTouch: true,
});
const page = await ctx.newPage();
let failed = 0;
page.on("console", (m) => {
  const t = m.type();
  if (t === "error") { failed++; console.log(`[page error] ${m.text()}`); }
  else if (t === "warning" && !/GPU stall|WebGL|swiftshader|Automatic fallback/i.test(m.text())) console.log(`[page warn] ${m.text()}`);
  else if (t === "log" && args.log) console.log(`[page] ${m.text()}`);
});
page.on("pageerror", (e) => { failed++; console.log(`[uncaught] ${e.message}\n${e.stack || ""}`); });

// --page art.html opens the art lab instead of the game; --full takes a full-page shot.
const url = `${base}${args.page || ""}?${q}`;
await page.goto(url, { waitUntil: "load" });
await page.waitForFunction(() => window.__ms && window.__ms.ready, null, { timeout: Number(args.timeout || 20000) });

for (const s of steps) {
  if (s.wait) await page.waitForTimeout(s.wait);
  if (s.tap) await page.touchscreen.tap(s.tap[0], s.tap[1]);
  if (s.hold) {
    const [x, y, ms] = s.hold;
    await page.evaluate(([x, y, ms]) => new Promise((res) => {
      const el = document.querySelector("#game canvas");
      const t = (type) => el.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, touches: type === "touchend" ? [] : [new Touch({ identifier: 1, target: el, clientX: x, clientY: y })], changedTouches: [new Touch({ identifier: 1, target: el, clientX: x, clientY: y })] }));
      t("touchstart"); setTimeout(() => { t("touchend"); res(); }, ms);
    }), [x, y, ms]);
  }
  if (s.drag) {
    const [x0, y0, x1, y1, ms = 300] = s.drag;
    await page.evaluate(([x0, y0, x1, y1, ms]) => new Promise((res) => {
      const el = document.querySelector("#game canvas");
      const mk = (x, y) => new Touch({ identifier: 2, target: el, clientX: x, clientY: y });
      const fire = (type, x, y) => el.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, touches: type === "touchend" ? [] : [mk(x, y)], changedTouches: [mk(x, y)] }));
      fire("touchstart", x0, y0);
      const n = Math.max(2, Math.round(ms / 16)); let i = 0;
      const tick = () => { i++; const k = i / n; fire("touchmove", x0 + (x1 - x0) * k, y0 + (y1 - y0) * k); if (i < n) setTimeout(tick, 16); else { fire("touchend", x1, y1); res(); } };
      setTimeout(tick, 16);
    }), [x0, y0, x1, y1, ms]);
  }
  if (s.eval) {
    const r = await page.evaluate(s.eval);
    if (r !== undefined) console.log(`[eval] ${typeof r === "string" ? r : JSON.stringify(r)}`);
  }
  if (s.until) await page.waitForFunction(s.until, null, { timeout: s.timeout || 20000, polling: 100 });
  if (s.shot) {
    const file = resolve(root, "shots", `${s.shot}.png`);
    await page.screenshot({ path: file, fullPage: !!args.full });
    console.log(`[shot] ${file}`);
  }
}

await browser.close();
await server.close();
if (failed) { console.log(`FAILED: ${failed} page error(s)`); process.exit(1); }
