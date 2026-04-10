import { build, context } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const projectRoot = process.cwd();
const srcDir = path.join(projectRoot, "src");
const outDir = path.join(projectRoot, "dist");
const watchMode = process.argv.includes("--watch");

const staticEntries = [
  "manifest.json",
  "popup.html",
  "popup.css",
  "content.css",
  "global.css",
  "fonts",
  "icon16.png",
  "icon48.png",
  "icon128.png",
];

const bundleOptions = {
  entryPoints: [
    path.join(srcDir, "background.js"),
    path.join(srcDir, "content.js"),
    path.join(srcDir, "popup.js"),
  ],
  bundle: true,
  format: "iife",
  target: "chrome120",
  outdir: outDir,
  sourcemap: false,
  legalComments: "none",
};

async function copyStaticEntries() {
  await mkdir(outDir, { recursive: true });
  await Promise.all(
    staticEntries.map(async (entry) => {
      await cp(path.join(srcDir, entry), path.join(outDir, entry), {
        force: true,
        recursive: true,
      });
    }),
  );
}

async function runBuild() {
  await rm(outDir, { recursive: true, force: true });
  await copyStaticEntries();
  await build(bundleOptions);
}

if (watchMode) {
  await copyStaticEntries();
  const ctx = await context(bundleOptions);
  await ctx.watch();
  console.log("Watching extension sources...");
} else {
  await runBuild();
}
