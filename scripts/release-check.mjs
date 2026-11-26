import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { reviewedTravelDataPaths, isForbiddenTrackedPath, trackedContentFailures } from "./release-check-policy.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const failures = [];

function fail(message) {
  failures.push(message);
}

function readJson(relativePath) {
  try {
    return JSON.parse(readFileSync(resolve(projectRoot, relativePath), "utf8"));
  } catch (error) {
    fail(`${relativePath} is missing or invalid JSON: ${error instanceof Error ? error.message : "unknown error"}`);
    return undefined;
  }
}

function trackedFiles() {
  try {
    return execFileSync("git", ["ls-files", "-z"], { cwd: projectRoot, encoding: "utf8" }).split("\0").filter(Boolean);
  } catch (error) {
    fail(`Git tracked files could not be inspected: ${error instanceof Error ? error.message : "unknown error"}`);
    return [];
  }
}

const nodeMajor = Number(process.versions.node.split(".")[0]);
if (!Number.isInteger(nodeMajor) || nodeMajor < 22) fail(`Node.js 22 or newer is required; found ${process.versions.node}.`);

const rootPackage = readJson("package.json");
const releaseVersion = "0.1.0";
if (rootPackage?.version !== releaseVersion) fail(`package.json version must be ${releaseVersion} for the V1 release; found ${String(rootPackage?.version)}.`);
if (rootPackage?.packageManager !== "pnpm@11.20.0") fail("package.json must pin pnpm@11.20.0 for reproducible V1 installs.");
for (const script of ["build", "typecheck", "test", "test:browser", "release:check"]) {
  if (typeof rootPackage?.scripts?.[script] !== "string" || !rootPackage.scripts[script].trim()) fail(`package.json is missing the ${script} script.`);
}

const workspacePackages = [
  "apps/server/package.json",
  "apps/web/package.json",
  "packages/agent-adapters/package.json",
  "packages/connectors/package.json",
  "packages/core/package.json",
  "packages/storage/package.json",
  "packages/travel-support/package.json"
];
const packageNames = new Set();
for (const relativePath of workspacePackages) {
  const workspacePackage = readJson(relativePath);
  if (!workspacePackage) continue;
  if (workspacePackage.version !== releaseVersion) fail(`${relativePath} version must match the V1 release version ${releaseVersion}.`);
  if (workspacePackage.private !== true) fail(`${relativePath} must remain private until publishing is deliberately designed.`);
  if (typeof workspacePackage.name !== "string" || !workspacePackage.name.trim()) fail(`${relativePath} has no package name.`);
  else if (packageNames.has(workspacePackage.name)) fail(`Duplicate workspace package name: ${workspacePackage.name}.`);
  else packageNames.add(workspacePackage.name);
}

for (const catalogPath of reviewedTravelDataPaths) {
  readJson(catalogPath);
}

try {
  const example = readFileSync(resolve(projectRoot, ".env.example"), "utf8");
  for (const key of ["C_ASSISTANT_RUNTIME", "GOOGLE_MAPS_API_KEY", "C_ASSISTANT_HOST", "C_ASSISTANT_PORT", "C_ASSISTANT_DATA_PATH"]) {
    if (!new RegExp(`^${key}=`, "m").test(example)) fail(`.env.example is missing ${key}.`);
  }
  for (const key of ["GOOGLE_MAPS_API_KEY", "LANDI_SMTP_PASSWORD", "LANDI_EMAIL_ACTION_SECRET"]) {
    if (new RegExp(`^${key}=[ \\t]*[^\\s#]`, "m").test(example)) fail(`.env.example must not contain a value for ${key}.`);
  }
} catch (error) {
  fail(`.env.example could not be inspected: ${error instanceof Error ? error.message : "unknown error"}`);
}

for (const relativePath of trackedFiles()) {
  if (isForbiddenTrackedPath(relativePath)) {
    fail(`Sensitive or runtime-only path is tracked by Git: ${relativePath}.`);
    continue;
  }
  const absolutePath = resolve(projectRoot, relativePath);
  try {
    if (statSync(absolutePath).size > 1_000_000) continue;
    const content = readFileSync(absolutePath);
    if (content.includes(0)) continue;
    const text = content.toString("utf8");
    for (const failure of trackedContentFailures(relativePath, text)) fail(failure);
  } catch (error) {
    fail(`Tracked file ${relativePath} could not be inspected: ${error instanceof Error ? error.message : "unknown error"}`);
  }
}

if (failures.length) {
  console.error("Landi release preflight failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Landi release preflight passed: Node ${process.versions.node}, ${workspacePackages.length} workspaces, reviewed travel data, tracked-file safety checks complete.`);
}
