import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { resolve } from "node:path";
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pruneServerBuild } from "./prune-server-build.mjs";

test("retired compiled handlers are removed without deleting current email output or data", () => {
  const root = mkdtempSync(join(tmpdir(), "landi-build-prune-"));
  try {
    const source = join(root, "src"), output = join(root, "lib");
    mkdirSync(source); mkdirSync(output);
    writeFileSync(join(source, "email-plan-monitoring.ts"), "");
    for (const name of ["email-plan-monitoring.js", "telegram-poller.js", "telegram-poller.d.ts", "telegram-poller.js.map", "data.json"]) writeFileSync(join(output, name), "fixture");
    assert.deepEqual(pruneServerBuild(source, output).sort(), ["telegram-poller.d.ts", "telegram-poller.js", "telegram-poller.js.map"]);
    assert.equal(existsSync(join(output, "email-plan-monitoring.js")), true);
    assert.equal(existsSync(join(output, "data.json")), true);
    assert.deepEqual(pruneServerBuild(source, output), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});


test("macOS production pruning excludes offline MAH fixtures and retains production modules", () => {
  const packager = readFileSync(new URL("package-macos.mjs", import.meta.url), "utf8");
  const match = packager.match(/function removeBuildOnlyFiles\(directory\) \{[\s\S]*?\n\}\n(?=\nfunction pruneOwnedWorkspacePackages)/g);
  assert.equal(match?.length, 1, "Exercise the actual existing production pruning function");
  const root = mkdtempSync(join(tmpdir(), "landi-test-fixture-packaging-"));
  try {
    // 使用当前离线队列、就绪与邮件 fixture，验证其编译产物不会进入生产包。
    const names = ["mah-queue.fixture.test", "mah-readiness.fixture.test", "email.fixture.test"];
    for (const name of names) {
      assert.equal(existsSync(new URL(`../apps/server/src/${name}.ts`, import.meta.url)), true);
      for (const extension of ["js", "js.map", "d.ts"]) writeFileSync(join(root, `${name}.${extension}`), "offline fixture");
    }
    writeFileSync(join(root, "mah-materialization-contract.js"), "production gate");
    const prune = vm.runInNewContext(`${match[0]}; removeBuildOnlyFiles`, { existsSync, readdirSync, resolve, rmSync });
    prune(root);
    assert.deepEqual(readdirSync(root), ["mah-materialization-contract.js"]);
    for (const old of ["mah-protocol-test-loader", "mah-readiness-test-fixtures", "email-test-fixture", "execution-test-mode"]) {
      assert.equal(existsSync(new URL(`../apps/server/src/${old}.ts`, import.meta.url)), false);
    }
    assert.equal(existsSync(new URL("historical/execution-test-mode.ts.txt", import.meta.url)), true);
    assert.equal(existsSync(new URL("../apps/server/src/execution-acceptance.fixture.test.ts", import.meta.url)), false);
    const serverSource = new URL("../apps/server/src/", import.meta.url);
    for (const file of readdirSync(serverSource).filter(name => name.endsWith(".ts") && !name.includes(".test."))) {
      assert.doesNotMatch(readFileSync(new URL(file, serverSource), "utf8"), /(?:mah-(?:protocol|queue|readiness)|email|execution-acceptance)\.fixture\.test/);
    }
    // Other new test-only helpers live under scripts/, which is not copied into the server package.
    assert.doesNotMatch(packager, /cpSync\(resolve\(componentRoot, "scripts"\)/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
