import { createHash } from "node:crypto";
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { arch } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const nodeVersion = "v25.9.0";
const nodeArtifacts = {
  arm64: { name: `node-${nodeVersion}-darwin-arm64`, sha256: "e479f3c469d3d9303a44f00a8ea37a3788395d171bb8059c48a4bbbd2e371b59" },
  x64: { name: `node-${nodeVersion}-darwin-x64`, sha256: "7d737b53ce191142bfa1c17cfa5b070d96e84eebf76b8dd06d84981cbdc3f7e3" }
};
const componentRoot = resolve(import.meta.dirname, "..");
const projectRoot = resolve(componentRoot, "../..");

function run(command, args, cwd = componentRoot) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`${command} ${args.join(" ")} 失败：${result.stderr || result.error?.message || "未知错误"}`);
  return result.stdout.trim();
}

function hashFile(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function sourceState() {
  const status = run("git", ["status", "--porcelain=v1", "--untracked-files=all"]);
  if (!status) return { sourceState: "committed" };
  const digest = createHash("sha256");
  digest.update(run("git", ["diff", "--binary", "HEAD"]));
  const untracked = run("git", ["ls-files", "--others", "--exclude-standard"]).split("\n").filter(Boolean).sort();
  for (const relative of untracked) {
    digest.update(`\0${relative}\0`);
    digest.update(readFileSync(resolve(componentRoot, relative)));
  }
  return { sourceState: "working_tree", sourceChangesSha256: digest.digest("hex") };
}

function removeBuildOnlyFiles(directory) {
  if (!existsSync(directory)) return;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) removeBuildOnlyFiles(path);
    else if (/\.test\.(?:js|js\.map|d\.ts)$/.test(entry.name) || /\.(?:js\.map|d\.ts)$/.test(entry.name)) rmSync(path, { force: true });
  }
}

function pruneOwnedWorkspacePackages(serverRoot) {
  removeBuildOnlyFiles(resolve(serverRoot, "lib"));
  const virtualStore = resolve(serverRoot, "node_modules", ".pnpm");
  for (const entry of readdirSync(virtualStore)) {
    if (!entry.startsWith("@c-assistant+")) continue;
    const scopeRoot = resolve(virtualStore, entry, "node_modules", "@c-assistant");
    if (!existsSync(scopeRoot)) continue;
    for (const packageName of readdirSync(scopeRoot)) {
      const packageRoot = resolve(scopeRoot, packageName);
      if (!lstatSync(packageRoot).isDirectory()) continue;
      for (const child of readdirSync(packageRoot)) {
        if (!["lib", "package.json", "data", "README.md", "LICENSE"].includes(child)) rmSync(resolve(packageRoot, child), { recursive: true, force: true });
      }
      removeBuildOnlyFiles(resolve(packageRoot, "lib"));
    }
  }
}

function parseOutput(argv) {
  const index = argv.indexOf("--output");
  if (index >= 0 && argv[index + 1]) return resolve(argv[index + 1]);
  const taskId = process.env.MAH_TASK_ID;
  if (!taskId) throw new Error("缺少 MAH_TASK_ID；请用 --output 指定受管发布目录。");
  return resolve(projectRoot, ".mah", "tasks", taskId, "artifacts", "local-launch-package");
}

function writeFinderEntrypoint(path, action) {
  writeFileSync(path, `#!/bin/zsh\nset -eu\nROOT=\"$(cd \"$(/usr/bin/dirname \"$0\")\" && pwd)\"\n\"$ROOT/runtime/bin/node\" \"$ROOT/bin/local-launcher.mjs\" ${action} --package-root \"$ROOT\"\n`, { mode: 0o755 });
}

function inspectArchiveTree(packageRoot) {
  const forbidden = [];
  const output = run("/usr/bin/find", [packageRoot, "-print"]);
  for (const absolute of output.split("\n")) {
    const relative = absolute.slice(packageRoot.length + 1);
    if (!relative) continue;
    if (/(^|\/)(?:\.env(?:\..+)?|\.mah|coverage|playwright-report|\.pnpm-store)(?:\/|$)/i.test(relative)
      || /^(?:config|data|logs?|run)(?:\/|$)/i.test(relative)
      || /^app\/server\/data(?:\/|$)/i.test(relative)
      || /(^|\/)node_modules\/\.cache(?:\/|$)/i.test(relative)
      || /^app\/server\/lib\/.*\.test\./i.test(relative)
      || /node_modules\/\.pnpm\/@c-assistant\+[^/]+\/node_modules\/@c-assistant\/[^/]+\/src(?:\/|$)/i.test(relative)
      || /\.(?:sqlite(?:-shm|-wal)?|pem|key|p12|pfx)$/i.test(relative)) forbidden.push(relative);
  }
  if (forbidden.length) throw new Error(`归档包含禁止路径：${forbidden.slice(0, 10).join("、")}`);
}

export function packageMacOS(outputRoot) {
  if (process.platform !== "darwin") throw new Error("本启动包只能在 macOS 上生成。");
  const targetArch = arch();
  const nodeArtifact = nodeArtifacts[targetArch];
  if (!nodeArtifact) throw new Error(`不支持当前芯片架构：${targetArch}`);
  for (const path of [resolve(componentRoot, "apps/server/lib/index.js"), resolve(componentRoot, "apps/web/dist/index.html")]) {
    if (!existsSync(path)) throw new Error(`缺少生产构建：${path}`);
  }

  const stageRoot = resolve(outputRoot, `.stage-${process.pid}`);
  const packageRoot = resolve(stageRoot, "Landi-macOS");
  const downloadRoot = resolve(stageRoot, "download");
  rmSync(stageRoot, { recursive: true, force: true });
  mkdirSync(downloadRoot, { recursive: true, mode: 0o700 });
  mkdirSync(resolve(packageRoot, "bin"), { recursive: true });
  mkdirSync(resolve(packageRoot, "app", "apps", "web"), { recursive: true });

  const archiveName = `${nodeArtifact.name}.tar.gz`;
  const nodeArchive = resolve(downloadRoot, archiveName);
  run("/usr/bin/curl", ["--fail", "--location", "--silent", "--show-error", "--output", nodeArchive, `https://nodejs.org/dist/${nodeVersion}/${archiveName}`]);
  const nodeArchiveSha256 = hashFile(nodeArchive);
  if (nodeArchiveSha256 !== nodeArtifact.sha256) throw new Error(`官方 Node 摘要不匹配：${nodeArchiveSha256}`);
  run("/usr/bin/tar", ["-xzf", nodeArchive, "-C", downloadRoot]);
  renameSync(resolve(downloadRoot, nodeArtifact.name), resolve(packageRoot, "runtime"));
  for (const entry of readdirSync(resolve(packageRoot, "runtime"))) {
    if (!["bin", "LICENSE", "README.md", "CHANGELOG.md"].includes(entry)) rmSync(resolve(packageRoot, "runtime", entry), { recursive: true, force: true });
  }
  for (const entry of readdirSync(resolve(packageRoot, "runtime", "bin"))) {
    if (entry !== "node") rmSync(resolve(packageRoot, "runtime", "bin", entry), { recursive: true, force: true });
  }
  run(resolve(packageRoot, "runtime", "bin", "node"), ["--input-type=module", "--eval", "import { DatabaseSync } from 'node:sqlite'; const db = new DatabaseSync(':memory:'); db.exec('create table probe(value text)'); db.prepare('insert into probe values (?)').run('ok'); if (db.prepare('select value from probe').get().value !== 'ok') process.exit(1); db.close();"]);

  run("pnpm", ["--config.inject-workspace-packages=true", "--filter", "@c-assistant/server", "deploy", "--prod", resolve(packageRoot, "app", "server")]);
  for (const entry of readdirSync(resolve(packageRoot, "app", "server"))) {
    if (!["lib", "node_modules", "package.json"].includes(entry)) rmSync(resolve(packageRoot, "app", "server", entry), { recursive: true, force: true });
  }
  pruneOwnedWorkspacePackages(resolve(packageRoot, "app", "server"));
  cpSync(resolve(componentRoot, "apps", "web", "dist"), resolve(packageRoot, "app", "apps", "web", "dist"), { recursive: true });
  cpSync(resolve(componentRoot, "scripts", "local-launcher.mjs"), resolve(packageRoot, "bin", "local-launcher.mjs"));
  writeFinderEntrypoint(resolve(packageRoot, "打开 Landi.command"), "start");
  writeFinderEntrypoint(resolve(packageRoot, "停止 Landi.command"), "stop");

  const sourceCommit = run("git", ["rev-parse", "HEAD"]);
  const source = sourceState();
  const manifest = {
    schemaVersion: 1,
    product: "Landi",
    version: JSON.parse(readFileSync(resolve(componentRoot, "package.json"), "utf8")).version,
    target: `darwin-${targetArch}`,
    sourceCommit,
    ...source,
    node: { version: nodeVersion, archive: archiveName, sha256: nodeArchiveSha256 },
    launcherProtocol: "1"
  };
  writeFileSync(resolve(packageRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  inspectArchiveTree(packageRoot);

  mkdirSync(outputRoot, { recursive: true, mode: 0o700 });
  const archive = resolve(outputRoot, `Landi-${manifest.version}-macOS-${targetArch}.tar.gz`);
  const partial = `${archive}.partial`;
  rmSync(partial, { force: true });
  run("/usr/bin/tar", ["-czf", partial, "-C", stageRoot, "Landi-macOS"]);
  renameSync(partial, archive);
  const receipt = {
    schemaVersion: 1,
    state: "ready",
    archive,
    archiveSha256: hashFile(archive),
    packageManifest: manifest,
    createdAt: new Date().toISOString()
  };
  const receiptPartial = resolve(outputRoot, "receipt.json.partial");
  writeFileSync(receiptPartial, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
  renameSync(receiptPartial, resolve(outputRoot, "receipt.json"));
  rmSync(stageRoot, { recursive: true, force: true });
  return receipt;
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(import.meta.filename)) {
  try { process.stdout.write(`${JSON.stringify(packageMacOS(parseOutput(process.argv.slice(2))))}\n`); }
  catch (error) { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; }
}
