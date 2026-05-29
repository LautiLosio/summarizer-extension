import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";

const projectRoot = process.cwd();
const distDir = path.join(projectRoot, "dist");
const artifactsDir = path.join(projectRoot, "artifacts");
const packageJsonPath = path.join(projectRoot, "package.json");
const manifestPath = path.join(distDir, "manifest.json");

const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

manifest.version = packageJson.version;
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

const archiveName = `${packageJson.name}-${packageJson.version}.zip`;
const archivePath = path.join(artifactsDir, archiveName);

await mkdir(artifactsDir, { recursive: true });
await rm(archivePath, { force: true });

await new Promise((resolve, reject) => {
  const zip = spawn(
    "zip",
    ["-qr", archivePath, ".", "-x", "*.DS_Store", "__MACOSX/*"],
    {
      cwd: distDir,
      stdio: "inherit",
    },
  );

  zip.on("error", reject);
  zip.on("close", (code) => {
    if (code === 0) {
      resolve();
      return;
    }

    reject(new Error(`zip exited with code ${code}`));
  });
});

console.log(`Created ${path.relative(projectRoot, archivePath)}`);
