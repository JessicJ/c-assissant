import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

test("retired verification exits unsuccessfully without dependencies or output artifacts", () => {
  const isolated = mkdtempSync(join(tmpdir(), "landi-retired-review-entry-"));
  try {
    // No project packages, browser installation, server or workspace data are available here.
    const entry = join(isolated, "verify-email-review.ts");
    copyFileSync(new URL("scripts/verify-email-review.ts", root), entry);
    const result = spawnSync(process.execPath, [entry, "must-not-create"], {
      cwd: isolated,
      encoding: "utf8",
      timeout: 5000,
      env: { PATH: "", HOME: isolated, TMPDIR: isolated },
    });
    assert.ifError(result.error);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /email_review_verification_retired/);
    assert.match(result.stderr, /Landi workspace/);
    assert.deepEqual(readdirSync(isolated), ["verify-email-review.ts"]);
  } finally {
    rmSync(isolated, { recursive: true, force: true });
  }
});

test("current server acceptance selects retirement coverage and preserves historical sources", () => {
  const tokens = JSON.parse(read("apps/server/package.json")).scripts.test.split(/\s+/);
  assert.equal(tokens.filter((token) => token === "src/email-review-retirement.test.ts").length, 1);
  assert.equal(tokens.includes("src/email-review.test.ts"), false);
  assert.ok(read("apps/server/src/email-review.test.ts").length > 0);
  assert.ok(read("scripts/email-review-page-recovery.test.mjs").length > 0);
  const archive = readFileSync(new URL("scripts/historical/verify-email-review.ts.txt", root));
  assert.equal(createHash("sha256").update(archive).digest("hex"),
    "6ec61d7ea22c47b723604a211ba108bedfc29a3b0bcb9b64ee741ebceb5aa48b");
});
