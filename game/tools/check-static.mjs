#!/usr/bin/env node
// Opens a built page from a folder over a plain static server (no Vite) in headless Chrome at
// iPhone landscape, waits for the game to boot, screenshots it, and fails on page errors.
//   node tools/check-static.mjs <dir> <out.png>
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { resolve, extname } from "node:path";
import { chromium } from "playwright-core";

const dir = resolve(process.argv[2] || "dist");
const out = resolve(process.argv[3] || "shots/static.png");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json", ".jpg": "image/jpeg", ".png": "image/png", ".webmanifest": "application/manifest+json" };
const server = createServer((req, res) => {
  let p = resolve(dir, "." + decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (existsSync(p) && statSync(p).isDirectory()) p = resolve(p, "index.html");
  if (!p.startsWith(dir) || !existsSync(p)) { res.statusCode = 404; return res.end("not found"); }
  res.setHeader("content-type", TYPES[extname(p)] || "application/octet-stream");
  res.end(readFileSync(p));
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const url = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await (await browser.newContext({ viewport: { width: 852, height: 393 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })).newPage();
let errors = 0;
page.on("pageerror", (e) => { errors++; console.log(`[uncaught] ${e.message}`); });
page.on("response", (r) => { if (r.status() >= 400) console.log(`[http ${r.status()}] ${r.url()}`); });
page.on("console", (m) => { if (m.type() === "error") { errors++; console.log(`[page error] ${m.text()}`); } });
await page.goto(url);
await page.waitForFunction(() => window.__ms && window.__ms.ready, null, { timeout: 30000 });
await page.waitForTimeout(3000);
await page.screenshot({ path: out });
console.log(`[shot] ${out}`);
await browser.close();
server.close();
process.exit(errors ? 1 : 0);
