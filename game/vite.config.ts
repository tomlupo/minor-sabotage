import { defineConfig } from "vite";

// base './' so the same build works on GitHub Pages (a sub-path) and inside a preview page.
export default defineConfig({
  base: "./",
  build: {
    target: "es2022",
    outDir: "dist",
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 4000,
  },
  // The palette lives in ../docs/art/palette.json, outside the game folder.
  server: { host: true, port: 5173, fs: { allow: [".."] } },
  preview: { host: true, port: 4173 },
});
