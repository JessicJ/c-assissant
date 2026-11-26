import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { reviewedTravelDataPaths, isForbiddenTrackedPath, trackedContentFailures } from "./release-check-policy.mjs";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const archiveRoot = new URL("scripts/historical/travel-catalogs/", root);
const manifest = JSON.parse(readFileSync(new URL("manifest.json", archiveRoot), "utf8"));

test("all eleven retired sources, datasets and tests retain exact recoverable bytes", () => {
  assert.equal(manifest.files.length, 11);
  assert.equal(new Set(manifest.files.map((item) => item.originalPath)).size, 11);
  for (const item of manifest.files) {
    const archived = readFileSync(new URL(item.archivePath, archiveRoot));
    const original = gunzipSync(archived);
    assert.equal(item.encoding, "gzip");
    assert.equal(original.length, item.bytes);
    assert.equal(createHash("sha256").update(original).digest("hex"), item.sha256);
    assert.equal(existsSync(new URL(item.originalPath, root)), false);
    assert.equal(isForbiddenTrackedPath(`scripts/historical/travel-catalogs/${item.archivePath}`), false);
    assert.deepEqual(trackedContentFailures(item.archivePath, archived.toString("utf8")), []);
  }
});

test("current exports, startup and default test entries exclude archived code", () => {
  const travel = JSON.parse(read("packages/travel-support/package.json"));
  assert.deepEqual(Object.keys(travel.exports), ["."]);
  assert.match(travel.scripts.build, /prune-server-build\.mjs --workspace travel-support && tsc/);
  const server = JSON.parse(read("apps/server/package.json"));
  assert.doesNotMatch(server.scripts.test, /china-source-preparation/);
  const main = JSON.parse(read("package.json"));
  assert.ok(main.scripts.test.split(/\s+/).includes("scripts/travel-catalog-retirement.test.mjs"));
  assert.doesNotMatch(main.scripts.test, /scripts\/release-check-policy\.test\.mjs/);
  assert.doesNotMatch(read("apps/server/src/destination-research.ts"), /source-preparation|reference-catalog/);
  assert.match(read("apps/server/src/official-source-routes.ts"), /server\.get.*\/api\/official-sources/);
  assert.match(read("apps/server/src/official-source-routes.ts"), /server\.post.*\/api\/official-sources\/:sourceId\/refresh/);
});

test("only two official registries bypass runtime-data rejection and retain content checks", () => {
  assert.deepEqual(reviewedTravelDataPaths, [
    "packages/travel-support/data/china/official-source-registry.json",
    "packages/travel-support/data/japan/official-source-registry.json"
  ]);
  for (const path of reviewedTravelDataPaths) {
    assert.equal(isForbiddenTrackedPath(path), false);
    assert.ok(Array.isArray(JSON.parse(read(path))));
    assert.equal(isForbiddenTrackedPath(path + ".bak"), true);
    assert.equal(trackedContentFailures(path, JSON.stringify({ note: "-----BEGIN " + "PRIVATE KEY-----" })).length, 1);
  }
  for (const path of [
    ...manifest.files.map((item) => item.originalPath).filter((path) => path.includes("/data/")),
    "data/user.json", "data/workspace.sqlite", "data/workspace.sqlite-wal", "data/backups/saved.json",
    "packages/travel-support/data/user.json", ".env", "secrets/private.key"
  ]) assert.equal(isForbiddenTrackedPath(path), true, path);
});

test("actual release preflight requires only the retained registries and rejects extra data", () => {
  const temporary = mkdtempSync(join(tmpdir(), "landi-two-registry-release-"));
  const write = (path, value) => { const target = join(temporary, path); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, value); };
  const git = (...args) => execFileSync("git", args, { cwd: temporary });
  const run = () => spawnSync(process.execPath, [join(temporary, "scripts/release-check.mjs")], { cwd: temporary, encoding: "utf8" });
  try {
    mkdirSync(join(temporary, "scripts"));
    for (const name of ["release-check.mjs", "release-check-policy.mjs"]) copyFileSync(new URL(`scripts/${name}`, root), join(temporary, "scripts", name));
    write("package.json", JSON.stringify({ version: "0.1.0", packageManager: "pnpm@11.20.0", scripts: Object.fromEntries(["build", "typecheck", "test", "test:browser", "release:check"].map((key) => [key, "fixture"])) }));
    for (const [index, path] of ["apps/server", "apps/web", "packages/agent-adapters", "packages/connectors", "packages/core", "packages/storage", "packages/travel-support"].entries()) write(`${path}/package.json`, JSON.stringify({ name: `fixture-${index}`, version: "0.1.0", private: true }));
    write(".env.example", ["C_ASSISTANT_RUNTIME", "GOOGLE_MAPS_API_KEY", "C_ASSISTANT_HOST", "C_ASSISTANT_PORT", "C_ASSISTANT_DATA_PATH"].map((key) => key + "=").join("\n"));
    for (const path of reviewedTravelDataPaths) write(path, "[]");
    git("init", "--quiet"); git("add", "--", "packages/travel-support/data");
    assert.equal(run().status, 0);
    const retired = "packages/travel-support/data/japan/reference-catalog.json";
    write(retired, "{}"); git("add", "--", retired);
    const blocked = run();
    assert.equal(blocked.status, 1);
    assert.match(blocked.stderr, /Sensitive or runtime-only path/);
    git("rm", "--cached", "--quiet", "--", retired); rmSync(join(temporary, retired));
    write(reviewedTravelDataPaths[0], "invalid-json");
    assert.match(run().stderr, /missing or invalid JSON/);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});

test("workspace cleanup removes stale outputs in isolated trees while retaining current outputs and data", () => {
  const temporary = realpathSync(mkdtempSync(join(tmpdir(), "landi-retired-catalog-build-")));
  try {
    mkdirSync(join(temporary, "scripts"));
    copyFileSync(new URL("scripts/prune-server-build.mjs", root), join(temporary, "scripts/prune-server-build.mjs"));
    for (const [workspace, retired] of [["apps/server", "china-source-preparation"], ["packages/travel-support", "japan-reference-catalog"]]) {
      for (const directory of ["src", "lib", "data"]) mkdirSync(join(temporary, workspace, directory), { recursive: true });
      writeFileSync(join(temporary, workspace, "src/current.ts"), "");
      for (const file of ["current.js", `${retired}.js`, `${retired}.js.map`, `${retired}.d.ts`, `${retired}.d.ts.map`]) writeFileSync(join(temporary, workspace, "lib", file), "fixture");
      writeFileSync(join(temporary, workspace, "data/preserved.json"), "{}");
    }
    for (const args of [[], ["--workspace", "travel-support"]]) {
      const result = spawnSync(process.execPath, [join(temporary, "scripts/prune-server-build.mjs"), ...args], { encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
    }
    for (const [workspace, retired] of [["apps/server", "china-source-preparation"], ["packages/travel-support", "japan-reference-catalog"]]) {
      assert.equal(existsSync(join(temporary, workspace, "lib/current.js")), true);
      assert.equal(readFileSync(join(temporary, workspace, "data/preserved.json"), "utf8"), "{}");
      for (const suffix of [".js", ".js.map", ".d.ts", ".d.ts.map"]) assert.equal(existsSync(join(temporary, workspace, `lib/${retired}${suffix}`)), false, `${workspace}: ${retired}${suffix}`);
    }
    const rejected = spawnSync(process.execPath, [join(temporary, "scripts/prune-server-build.mjs"), "--workspace", "../../data"], { encoding: "utf8" });
    assert.equal(rejected.status, 1);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});

test("Git ignore rules admit exactly the two public registries within travel data", () => {
  const directory = mkdtempSync(join(tmpdir(), "landi-registry-ignore-"));
  try {
    execFileSync("git", ["init", "-q", directory]);
    writeFileSync(join(directory, ".gitignore"), read(".gitignore"));
    for (const path of reviewedTravelDataPaths) {
      const result = spawnSync("git", ["check-ignore", "--no-index", "-q", path], { cwd: directory });
      assert.equal(result.status, 1, `${path} must remain trackable`);
    }
    for (const path of ["data/private.json", "packages/travel-support/data/china/private.json", "packages/travel-support/data/japan/official-source-registry.json.bak", "packages/travel-support/data/other/official-source-registry.json"]) {
      const result = spawnSync("git", ["check-ignore", "--no-index", "-q", path], { cwd: directory });
      assert.equal(result.status, 0, `${path} must remain ignored`);
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
