#!/usr/bin/env node
// Plays through, in headless Chrome, what a phone that played the C++ prototype sees when the
// site's root becomes the TypeScript game (public/sw.js explains why this needs checking):
//   1. the old root: a page registering the prototype's own service worker
//      (Projects/emscripten/web/sw.js, with a two-file list), which then controls the page;
//   2. the new build WITHOUT sw.js: the old worker must still serve the old page. This proves
//      the check can fail, so a pass in step 3 means something;
//   3. the new build WITH sw.js: within a couple of navigations the game must load.
//   node tools/check-sw-handover.mjs [dist]      (after npm run build) — exits 1 on any failure
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync, mkdtempSync, writeFileSync } from "node:fs";
import { resolve, extname, join } from "node:path";
import { tmpdir } from "node:os";
import { chromium } from "playwright-core";

const root = resolve(import.meta.dirname, "..");
const dist = resolve(process.argv[2] || resolve(root, "dist"));
if (!existsSync(resolve(dist, "sw.js"))) { console.log(`FAILED: ${dist}/sw.js is missing (npm run build first)`); process.exit(1); }

// the old root, as the prototype's build left it
const old = mkdtempSync(join(process.env.CLAUDE_JOB_DIR ? resolve(process.env.CLAUDE_JOB_DIR, "tmp") : tmpdir(), "old-root-"));
const protoSw = readFileSync(resolve(root, "../Projects/emscripten/web/sw.js"), "utf8")
  .replace("@OPENFODDER_BUILD@", "handover-test")
  .replace(/const FILES = \[[\s\S]*?\];/, "const FILES = ['./', 'index.html'];");
writeFileSync(resolve(old, "sw.js"), protoSw);
writeFileSync(resolve(old, "index.html"), `<!doctype html><meta charset="utf-8"><title>old</title><p id="old">THE OLD PROTOTYPE</p>
<script>navigator.serviceWorker.register('sw.js');</script>`);

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json", ".jpg": "image/jpeg", ".png": "image/png", ".webmanifest": "application/manifest+json" };
let site = old;
let hideSw = false;
const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  let p = resolve(site, "." + path);
  if (existsSync(p) && statSync(p).isDirectory()) p = resolve(p, "index.html");
  if (!p.startsWith(site) || !existsSync(p) || (hideSw && path === "/sw.js")) { res.statusCode = 404; return res.end("not found"); }
  res.setHeader("content-type", TYPES[extname(p)] || "application/octet-stream");
  res.setHeader("cache-control", "max-age=600"); // what GitHub Pages sends
  res.end(readFileSync(p));
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const url = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const context = await browser.newContext({ viewport: { width: 852, height: 393 } });
const page = await context.newPage();
let failed = 0;
const fail = (why) => { failed++; console.log(`FAILED: ${why}`); };
const shows = async () => page.evaluate(() => (document.getElementById("old") ? "old" : window.__ms ? "game" : "other")).catch(() => "navigating");

// 1. the prototype's worker takes the page
await page.goto(url);
await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 15000 }).catch(() => fail("the old worker never controlled the page"));
console.log(`1. old root: the page is controlled by the prototype's worker, shows ${await shows()}`);

// 2. the new build without the handover: the old page must still come back
site = dist;
hideSw = true;
await page.goto(url);
await page.waitForTimeout(1500);
await page.reload();
await page.waitForTimeout(1500);
const stuck = await shows();
console.log(`2. new build, no sw.js: shows ${stuck}`);
if (stuck !== "old") fail("without sw.js the old page should still be served (the check cannot tell a fix from luck)");

// 3. with the handover: the game must come up
hideSw = false;
let got = "";
for (let k = 0; k < 3 && got !== "game"; k++) {
  await page.goto(url).catch(() => {});
  await page.waitForFunction(() => window.__ms && window.__ms.ready, null, { timeout: 8000 }).catch(() => {});
  got = await shows();
  console.log(`3. new build with sw.js, visit ${k + 1}: shows ${got}`);
}
if (got !== "game") fail("the game did not replace the old page");
const left = await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).map((r) => r.scope));
console.log(`   registrations left: ${JSON.stringify(left)}`);
if (left.length) fail("a worker is still registered at the root");

await browser.close();
server.close();
console.log(failed ? `FAILED: ${failed}` : "OK: a phone that played the prototype gets the game");
process.exit(failed ? 1 : 0);
