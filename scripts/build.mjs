import { build, context } from "esbuild";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const projectRoot = process.cwd();
const srcDir = path.join(projectRoot, "src");
const outDir = path.join(projectRoot, "dist");
const packageJsonPath = path.join(projectRoot, "package.json");
const distManifestPath = path.join(outDir, "manifest.json");
const watchMode = process.argv.includes("--watch");

const staticEntries = [
  "manifest.json",
  "options.html",
  "options.css",
  "content.css",
  "global.css",
  "icon16.png",
  "icon48.png",
  "icon128.png",
];

const bundleOptions = {
  entryPoints: [
    path.join(srcDir, "background.js"),
    path.join(srcDir, "content.js"),
    path.join(srcDir, "options.js"),
  ],
  bundle: true,
  format: "iife",
  target: "chrome120",
  outdir: outDir,
  loader: {
    ".css": "text",
    ".svg": "text",
  },
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

async function applyPackageVersionToManifest() {
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
  const manifest = JSON.parse(await readFile(distManifestPath, "utf8"));

  manifest.version = packageJson.version;

  await writeFile(distManifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

async function runBuild() {
  await rm(outDir, { recursive: true, force: true });
  await copyStaticEntries();
  await build(bundleOptions);
  await applyPackageVersionToManifest();
}

if (watchMode) {
  await copyStaticEntries();
  await applyPackageVersionToManifest();
  const ctx = await context(bundleOptions);
  await ctx.watch();
  console.log("Watching extension sources...");
} else {
  await runBuild();
}
