import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = new URL("../", import.meta.url);
const archive = new URL("scripts/historical/travel-types/", root);
const manifest = JSON.parse(readFileSync(new URL("manifest.json", archive), "utf8"));
const declarations = readFileSync(new URL(manifest.archivePath, archive));
const current = readFileSync(new URL(manifest.originalPath, root));
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const ts = createRequire(new URL("package.json", root))("typescript");

test("archived declarations reconstruct the exact original file with unchanged remaining bytes", () => {
  assert.equal(declarations.length, manifest.bytes);
  assert.equal(digest(declarations), manifest.sha256);
  assert.equal(current.length, manifest.originalByteOffset);
  assert.equal(digest(current), manifest.remainingFileSha256);
  assert.equal(digest(Buffer.concat([current, declarations])), manifest.originalFileSha256);
});

test("only the seven unused type exports were removed; every other declaration remains identical", () => {
  const parse = (bytes) => ts.createSourceFile("index.ts", bytes.toString("utf8"), ts.ScriptTarget.Latest, true);
  const oldSource = parse(Buffer.concat([current, declarations]));
  const newSource = parse(current);
  assert.equal(oldSource.parseDiagnostics.length, 0);
  assert.equal(newSource.parseDiagnostics.length, 0);
  const archivedSource = parse(declarations);
  assert.equal(archivedSource.statements.length, 7);
  assert.deepEqual(archivedSource.statements.map((node) => node.name?.text), manifest.declarationNames);
  assert.ok(archivedSource.statements.every((node) =>
    (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node))
    && node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)));
  assert.deepEqual(newSource.statements.map((node) => node.getText(newSource)),
    oldSource.statements.slice(0, -7).map((node) => node.getText(oldSource)));
});

test("no active source or existing test refers to the archived types", () => {
  const scan = spawnSync("rg", ["-n", "-w", manifest.declarationNames.join("|"),
    "apps", "packages", "tests", "scripts", "-g", "*.ts", "-g", "*.tsx", "-g", "*.mjs",
    "-g", "!lib/**", "-g", "!dist/**", "-g", "!scripts/historical/**"], {
    cwd: fileURLToPath(root), encoding: "utf8"
  });
  assert.ifError(scan.error);
  assert.equal(scan.status, 1, scan.stdout + scan.stderr);
});
