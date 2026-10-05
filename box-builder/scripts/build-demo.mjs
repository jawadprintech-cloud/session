// Builds the browser-only demo as a single self-contained HTML file (dist-demo/box-builder-demo.html).
// `--share` builds dist-demo/box-builder-share.html for the Claude artifact viewer instead: same app,
// without the PDF library (downloads are blocked there and public sharing can't review it).
import { build } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, "dist-demo");
process.env.VITE_DEMO = "1";
const share = process.argv.includes("--share");
if (share) process.env.VITE_SHARE = "1";
const name = share ? "box-builder-share.html" : "box-builder-demo.html";
// Keep the other variant's HTML, but never mix bundles from an earlier build.
rmSync(path.join(out, "assets"), { recursive: true, force: true });

await build({
  root,
  configFile: false,
  plugins: [react()],
  resolve: share ? { alias: { jspdf: path.join(root, "scripts/jspdf-stub.mjs") } } : undefined,
  css: { postcss: { plugins: [] } },
  logLevel: "warn",
  build: {
    outDir: out,
    emptyOutDir: false,
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    modulePreload: false,
    rollupOptions: { input: path.join(root, "index.html"), output: { inlineDynamicImports: true } },
  },
});

const assets = path.join(out, "assets");
const files = readdirSync(assets);
const js = files.filter((f) => f.endsWith(".js")).map((f) => readFileSync(path.join(assets, f), "utf8")).join("\n");
const css = files.filter((f) => f.endsWith(".css")).map((f) => readFileSync(path.join(assets, f), "utf8")).join("\n");
const safeJs = js.replace(/<\/script/gi, "<\\/script").replace(/<!--/g, "<\\!--");

// Page body only: the host wraps it in its own document skeleton.
const html = `<title>Custom Box Builder</title>
<meta name="description" content="Design custom packaging on a real dieline, preview it in 3D and request a quote.">
<style>${css}</style>
<div id="root"></div>
<script type="module">${safeJs}</script>
`;
writeFileSync(path.join(out, name), html);
console.log(`dist-demo/${name} — ${(html.length / 1e6).toFixed(2)} MB`);
