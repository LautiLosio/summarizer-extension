import { readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";

const projectRoot = process.cwd();
const packageJsonPath = path.join(projectRoot, "package.json");
const packageLockPath = path.join(projectRoot, "package-lock.json");

function getBumpType(args) {
  if (args.includes("--major")) return "major";
  if (args.includes("--minor")) return "minor";
  if (args.includes("--patch")) return "patch";

  return "patch";
}

function bumpVersion(version, type) {
  const parts = version.split(".").map((part) => Number.parseInt(part, 10));

  if (parts.length !== 3 || parts.some((part) => Number.isNaN(part))) {
    throw new Error(`Expected x.y.z version, got ${version}`);
  }

  const [major, minor, patch] = parts;

  if (type === "major") return `${major + 1}.0.0`;
  if (type === "minor") return `${major}.${minor + 1}.0`;
  if (type === "patch") return `${major}.${minor}.${patch + 1}`;

  throw new Error(`Unknown bump type: ${type}. Use patch, minor, or major.`);
}

function writeJson(filePath, value) {
  return writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function updatePackageLock(version) {
  const packageLock = JSON.parse(await readFile(packageLockPath, "utf8"));

  packageLock.version = version;

  if (packageLock.packages?.[""]) {
    packageLock.packages[""].version = version;
  }

  await writeJson(packageLockPath, packageLock);
}

async function runScript(scriptPath) {
  await new Promise((resolve, reject) => {
    const script = spawn("node", [scriptPath], {
      cwd: projectRoot,
      stdio: "inherit",
    });

    script.on("error", reject);
    script.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${scriptPath} exited with code ${code}`));
    });
  });
}

const bumpType = getBumpType(process.argv.slice(2));
const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
const nextVersion = bumpVersion(packageJson.version, bumpType);

packageJson.version = nextVersion;

await writeJson(packageJsonPath, packageJson);
await updatePackageLock(nextVersion);

console.log(`Bumped ${bumpType} version to ${nextVersion}`);
await runScript("scripts/build.mjs");
await runScript("scripts/package.mjs");
