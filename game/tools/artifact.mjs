#!/usr/bin/env node
// Builds a self-contained preview page from dist/ (after `npm run build`): the page's CSS
// and body, with the game's bundle inlined as a module script, and the history photos
// copied beside it. For sharing a playable build before it is merged and on Pages.
//   node tools/artifact.mjs <out-dir>
import { readFileSync, writeFileSync, mkdirSync, readdirSync, copyFileSync, rmSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(process.argv[2] || resolve(root, "dist-artifact"));
const dist = resolve(root, "dist");
const html = readFileSync(resolve(dist, "index.html"), "utf8");
const style = html.match(/<style>([\s\S]*?)<\/style>/)[1];
const body = html.match(/<body>([\s\S]*?)<\/body>/)[1].replace(/<script[\s\S]*?<\/script>/g, "").trim();
const jsFile = readdirSync(resolve(dist, "assets")).find((f) => f.endsWith(".js"));
// a literal "</script" inside the bundle would end the inline script early
const js = readFileSync(resolve(dist, "assets", jsFile), "utf8").replace(/<\/script/gi, "<\\/script");

const page = `<title>Minor Sabotage</title>
<link rel="icon" href="data:,">
<style>${style}
  body { background: #24201a; color: #e8e4d8; }
</style>
${body}
<script type="module">${js}</script>
`;
// the photos are copied afresh: one dropped from the build must not linger from an older run
rmSync(resolve(out, "history"), { recursive: true, force: true });
mkdirSync(resolve(out, "history"), { recursive: true });
writeFileSync(resolve(out, "index.html"), page);
for (const f of readdirSync(resolve(dist, "history"))) copyFileSync(resolve(dist, "history", f), resolve(out, "history", f));
// the fonts' licences travel with the fonts (SIL OFL)
rmSync(resolve(out, "licenses"), { recursive: true, force: true });
mkdirSync(resolve(out, "licenses"), { recursive: true });
for (const f of readdirSync(resolve(dist, "licenses"))) copyFileSync(resolve(dist, "licenses", f), resolve(out, "licenses", f));
console.log(`${resolve(out, "index.html")} ${(page.length / 1024 / 1024).toFixed(2)} MB, history: ${readdirSync(resolve(out, "history")).length} files, licenses: ${readdirSync(resolve(out, "licenses")).length}`);
