import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

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
  "packages/skill-runtime/package.json",
  "packages/storage/package.json",
  "country-packs/china/package.json",
  "country-packs/japan/package.json"
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

const expectedSkillIds = [
  "arrival-preparation",
  "china-arrival-plan",
  "digital-life-setup",
  "food-nearby",
  "housing-area-recommendation",
  "local-food-guide",
  "policy-applicability",
  "transport-planner",
  "weather-and-packing"
];
const manifestIds = new Set();
for (const skillId of expectedSkillIds) {
  const manifest = readJson(`country-packs/china/skills/${skillId}/skill.json`);
  if (!manifest) continue;
  if (manifest.id !== skillId) fail(`China Skill manifest ${skillId} declares id ${String(manifest.id)}.`);
  if (manifest.visibility !== "internal") fail(`China Skill ${skillId} must remain internal in V1.`);
  if (manifestIds.has(manifest.id)) fail(`Duplicate China Skill id: ${String(manifest.id)}.`);
  manifestIds.add(manifest.id);
}
const expectedJapanSkillIds = [
  "japan-arrival-plan",
  "japan-policy-applicability",
  "japan-weather-and-packing",
  "japan-housing-area-recommendation",
  "japan-transport-planner",
  "japan-local-food-guide",
  "japan-digital-life-setup",
  "japan-arrival-preparation"
];
for (const skillId of expectedJapanSkillIds) {
  const manifest = readJson(`country-packs/japan/skills/${skillId}/skill.json`);
  if (!manifest) continue;
  if (manifest.id !== skillId) fail(`Japan Skill manifest ${skillId} declares id ${String(manifest.id)}.`);
  if (manifest.country !== "japan" || manifest.visibility !== "internal") fail(`Japan Skill ${skillId} must remain internal and bound to Japan.`);
  if (manifestIds.has(manifest.id)) fail(`Duplicate cross-Pack Skill id: ${String(manifest.id)}.`);
  manifestIds.add(manifest.id);
}

try {
  const example = readFileSync(resolve(projectRoot, ".env.example"), "utf8");
  for (const key of ["C_ASSISTANT_RUNTIME", "TELEGRAM_BOT_TOKEN", "GOOGLE_MAPS_API_KEY", "WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_BUSINESS_ACCOUNT_ID", "WHATSAPP_APP_SECRET", "WHATSAPP_VERIFY_TOKEN", "WHATSAPP_ALLOWED_USER_NUMBER", "WHATSAPP_REMINDER_TEMPLATE_NAME", "WHATSAPP_GRAPH_API_VERSION", "C_ASSISTANT_HOST", "C_ASSISTANT_PORT", "C_ASSISTANT_DATA_PATH"]) {
    if (!new RegExp(`^${key}=`, "m").test(example)) fail(`.env.example is missing ${key}.`);
  }
  for (const key of ["TELEGRAM_BOT_TOKEN", "GOOGLE_MAPS_API_KEY", "WHATSAPP_ACCESS_TOKEN", "WHATSAPP_APP_SECRET", "WHATSAPP_VERIFY_TOKEN"]) {
    if (new RegExp(`^${key}=[ \\t]*[^\\s#]`, "m").test(example)) fail(`.env.example must not contain a value for ${key}.`);
  }
} catch (error) {
  fail(`.env.example could not be inspected: ${error instanceof Error ? error.message : "unknown error"}`);
}

const forbiddenTrackedPath = /(^|\/)(?:\.env(?:\..+)?|data|runtime|secrets)(?:\/|$)|\.(?:sqlite(?:-shm|-wal)?|pem|key|p12|pfx)$/i;
const secretAssignment = /^\s*(?:TELEGRAM_BOT_TOKEN|GOOGLE_MAPS_API_KEY|AMAP_API_KEY|QWEATHER_API_KEY|QWEATHER_API_HOST|WHATSAPP_ACCESS_TOKEN|WHATSAPP_APP_SECRET|WHATSAPP_VERIFY_TOKEN)\s*=\s*([^\s#][^\r\n]*)/gm;
const telegramToken = /\b\d{8,12}:[A-Za-z0-9_-]{30,}\b/;
const privateKey = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/;

for (const relativePath of trackedFiles()) {
  if (relativePath !== ".env.example" && forbiddenTrackedPath.test(relativePath)) {
    fail(`Sensitive or runtime-only path is tracked by Git: ${relativePath}.`);
    continue;
  }
  const absolutePath = resolve(projectRoot, relativePath);
  try {
    if (statSync(absolutePath).size > 1_000_000) continue;
    const content = readFileSync(absolutePath);
    if (content.includes(0)) continue;
    const text = content.toString("utf8");
    secretAssignment.lastIndex = 0;
    if (relativePath !== ".env.example" && secretAssignment.test(text)) fail(`A populated Connector secret assignment may be tracked in ${relativePath}.`);
    if (telegramToken.test(text)) fail(`A Telegram-style bot token may be tracked in ${relativePath}.`);
    if (privateKey.test(text)) fail(`A private key may be tracked in ${relativePath}.`);
  } catch (error) {
    fail(`Tracked file ${relativePath} could not be inspected: ${error instanceof Error ? error.message : "unknown error"}`);
  }
}

if (failures.length) {
  console.error("Landi release preflight failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Landi release preflight passed: Node ${process.versions.node}, ${workspacePackages.length} workspaces, ${manifestIds.size} internal Country Pack Skills, tracked-file safety checks complete.`);
}
