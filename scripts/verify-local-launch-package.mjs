import { createHash } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { arch, tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { chromium } from "@playwright/test";

const componentRoot = resolve(import.meta.dirname, "..");
const projectRoot = resolve(componentRoot, "../..");
function parseOutputRoot(argv) {
  const index = argv.indexOf("--output");
  if (index >= 0 && argv[index + 1]) return resolve(argv[index + 1]);
  const taskId = process.env.MAH_TASK_ID;
  if (!taskId) throw new Error("缺少 MAH_TASK_ID；请用 --output 指定待验收的发布目录。");
  return resolve(projectRoot, ".mah", "tasks", taskId, "artifacts", "local-launch-package");
}
const outputRoot = parseOutputRoot(process.argv.slice(2));
const receiptPath = resolve(outputRoot, "receipt.json");
const evidencePath = resolve(outputRoot, "acceptance.json");
const results = [];

function sha256(path) { return createHash("sha256").update(readFileSync(path)).digest("hex"); }
function record(id, passed, detail, startedAt, exitCode = passed ? 0 : 1) {
  results.push({ acceptanceId: id, passed, detail, startedAt, finishedAt: new Date().toISOString(), exitCode });
  if (!passed) throw new Error(`${id} 未通过：${detail}`);
}
function run(command, args, options = {}) {
  const startedAt = new Date().toISOString();
  const result = spawnSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...options });
  return { startedAt, finishedAt: new Date().toISOString(), exitCode: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "", error: result.error };
}
function walk(path, entries = []) {
  for (const name of readdirSync(path)) {
    const child = join(path, name);
    entries.push(child);
    if (lstatSync(child).isDirectory()) walk(child, entries);
  }
  return entries;
}
function makeReadonly(path) {
  for (const entry of walk(path).reverse()) {
    const stat = lstatSync(entry);
    if (stat.isSymbolicLink()) continue;
    chmodSync(entry, stat.isDirectory() || (stat.mode & 0o111) ? 0o555 : 0o444);
  }
  chmodSync(path, 0o555);
}
function makeWritable(path) {
  if (!existsSync(path)) return;
  chmodSync(path, 0o755);
  for (const entry of walk(path)) if (!lstatSync(entry).isSymbolicLink()) chmodSync(entry, lstatSync(entry).isDirectory() ? 0o755 : 0o644);
}
async function freePort() {
  const server = createServer();
  await new Promise((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
  const port = server.address().port;
  await new Promise((resolvePromise) => server.close(resolvePromise));
  return port;
}
function launcherEnvironment(userRoot, logRoot, restrictedPath) {
  return {
    HOME: process.env.HOME,
    LANG: "zh_CN.UTF-8",
    PATH: restrictedPath,
    TMPDIR: process.env.TMPDIR ?? tmpdir(),
    LANDI_LOCAL_USER_ROOT: userRoot,
    LANDI_LOCAL_LOG_ROOT: logRoot,
    LANDI_RUNTIME_PATH: restrictedPath,
    LANDI_SKIP_BROWSER: "1"
  };
}
function launch(nodePath, launcherPath, action, packageRoot, port, env) {
  return run(nodePath, [launcherPath, action, "--package-root", packageRoot, "--port", String(port), "--no-open"], { env });
}
function finderEntry(action, packageRoot, port, env) {
  return run(resolve(packageRoot, action === "start" ? "打开 Landi.command" : "停止 Landi.command"), [], {
    env: { ...env, LANDI_LOCAL_PORT: String(port) }
  });
}
function parseResult(result) {
  if (result.exitCode !== 0) return undefined;
  return JSON.parse(result.stdout.trim());
}
async function fetchJsonEventually(url, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    } catch (error) {
      lastError = error;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    }
  }
  throw new Error(`重启后工作区不可用：${lastError instanceof Error ? lastError.message : "未知错误"}`);
}

async function main() {
  const startedAt = new Date().toISOString();
  const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
  const archive = receipt.archive;
  record("landi.t5.archive.clean-production-layout", existsSync(archive) && sha256(archive) === receipt.archiveSha256, "归档存在且摘要与打包收据一致。", startedAt);
  record("landi.t5.runtime.bundled-node", receipt.packageManifest.node.version === "v25.9.0" && receipt.packageManifest.target === `darwin-${arch()}`, `Node ${receipt.packageManifest.node.version}，目标 ${receipt.packageManifest.target}。`, startedAt);

  const verificationRoot = mkdtempSync(join(outputRoot, ".acceptance-"));
  const extractRoot = resolve(verificationRoot, "extract");
  const userRoot = resolve(verificationRoot, "user");
  const logRoot = resolve(verificationRoot, "logs");
  const restrictedPath = resolve(verificationRoot, "restricted-bin");
  mkdirSync(extractRoot, { recursive: true });
  mkdirSync(restrictedPath, { recursive: true });
  const extract = run("/usr/bin/tar", ["-xzf", archive, "-C", extractRoot]);
  record("landi.t5.acceptance.extracted-archive", extract.exitCode === 0, "从交付归档解压成功。", extract.startedAt, extract.exitCode);
  const packageRoot = resolve(extractRoot, "Landi-macOS");
  const nodePath = resolve(packageRoot, "runtime", "bin", "node");
  const launcherPath = resolve(packageRoot, "bin", "local-launcher.mjs");
  makeReadonly(packageRoot);
  record("landi.t5.acceptance.readonly-package", true, "整个解压包已设为只读，用户状态目录保持独立可写。", new Date().toISOString());

  const env = launcherEnvironment(userRoot, logRoot, restrictedPath);
  const nodeProbe = run(nodePath, ["--input-type=module", "--eval", "import { DatabaseSync } from 'node:sqlite'; const db=new DatabaseSync(':memory:'); db.exec('create table t(v); insert into t values (1)'); if(db.prepare('select v from t').get().v!==1) process.exit(1); db.close();"], { env });
  record("landi.t5.acceptance.restricted-path", nodeProbe.exitCode === 0, "PATH 仅含空隔离目录；包内 Node 的 node:sqlite 探针通过。", nodeProbe.startedAt, nodeProbe.exitCode);

  const port = await freePort();
  let instance;
  try {
    const first = finderEntry("start", packageRoot, port, env);
    instance = parseResult(first);
    record("landi.t5.launcher.single-canonical-path", first.exitCode === 0 && instance?.status === "started", "空 PATH 下实际执行归档内打开薄入口，经同一规范启动器启动成功。", first.startedAt, first.exitCode);
    const duplicate = finderEntry("start", packageRoot, port, env);
    const duplicateResult = parseResult(duplicate);
    record("landi.t5.instance.single-instance", duplicate.exitCode === 0 && duplicateResult?.status === "already_running" && duplicateResult.pid === instance.pid, "重复启动复用同一已证明实例。", duplicate.startedAt, duplicate.exitCode);

    const health = await (await fetch(`http://127.0.0.1:${port}/health`)).json();
    record("landi.t5.instance.health-ownership-proof", health.service === "landi-local-workspace" && health.protocolVersion === "1" && health.instanceProof === instance.instanceProof, "健康端点返回稳定身份、协议和实例证明。", new Date().toISOString());
    const workspaceResponse = await fetch(`http://127.0.0.1:${port}/api/workspace`);
    const homeResponse = await fetch(`http://127.0.0.1:${port}/`);
    record("landi.t5.workspace.real-web-server", workspaceResponse.ok && homeResponse.ok && (await homeResponse.text()).includes("<title>Landi</title>"), "真实 Server 同时提供工作区 API 与预构建 Web。", new Date().toISOString());

    const browser = await chromium.launch();
    try {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle" });
      const title = await page.title();
      const text = await page.locator("body").innerText();
      record("landi.t5.acceptance.real-browser-workspace", title === "Landi" && /Landi|Plan|Profile|Settings/.test(text), `隔离 Chromium 实际显示现有工作台，标题为 ${title}。`, new Date().toISOString());
      record("landi.t5.acceptance.unconfigured-adapters-load", /Landi|Plan|Profile|Settings/.test(text), "未配置 MAH、Agent 或 Connector 时工作台仍可加载。", new Date().toISOString());
      await context.close();
    } finally { await browser.close(); }

    const fictional = {
      displayName: "本机验收旅客",
      preferredLanguage: "简体中文",
      travelPreferences: "仅用于隔离验收",
      nationality: "测试国",
      gender: "not_specified",
      immigrationStatus: "tourist_visa"
    };
    const update = await fetch(`http://127.0.0.1:${port}/api/profile`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(fictional) });
    record("landi.t5.isolation.external-user-state", update.ok && existsSync(resolve(userRoot, "data", "workspace.sqlite")), "虚构配置与 SQLite 只写入包外隔离用户目录。", new Date().toISOString());

    const receiptFile = resolve(userRoot, "run", "instance.json");
    const validReceiptText = readFileSync(receiptFile, "utf8");
    const invalidReceipt = { ...JSON.parse(validReceiptText), instanceProof: "身份不匹配" };
    writeFileSync(receiptFile, JSON.stringify(invalidReceipt));
    try {
      const refused = launch(nodePath, launcherPath, "stop", packageRoot, port, env);
      record("landi.t5.instance.safe-stop-restart", refused.exitCode !== 0 && refused.stderr.includes("无法确认正在运行的实例属于 Landi") && (await fetch(`http://127.0.0.1:${port}/health`)).ok, "身份不匹配时拒绝停止，原实例保持运行。", refused.startedAt, 0);
    } finally {
      writeFileSync(receiptFile, validReceiptText);
    }

    const stop = finderEntry("stop", packageRoot, port, env);
    record("landi.t5.instance.safe-stop-restart", stop.exitCode === 0 && parseResult(stop)?.status === "stopped", "匹配实例通过 SIGTERM 正常停止。", stop.startedAt, stop.exitCode);
    instance = undefined;
    const restart = launch(nodePath, launcherPath, "start", packageRoot, port, env);
    instance = parseResult(restart);
    record("landi.t5.instance.safe-stop-restart", restart.exitCode === 0 && instance?.status === "started", restart.exitCode === 0 ? "同一隔离用户目录下重新启动成功。" : `重新启动失败：${restart.stderr.trim()}`, restart.startedAt, restart.exitCode);
    const persisted = await fetchJsonEventually(`http://127.0.0.1:${port}/api/workspace`);
    record("landi.t5.persistence.restart-retains-data", restart.exitCode === 0 && persisted.profile.displayName === fictional.displayName, "停止和重启后虚构配置及 SQLite 数据保持。", restart.startedAt, restart.exitCode);

    const finalStop = launch(nodePath, launcherPath, "stop", packageRoot, port, env);
    record("landi.t5.instance.safe-stop-restart", finalStop.exitCode === 0, "最终正常停止完成。", finalStop.startedAt, finalStop.exitCode);
    instance = undefined;

    let unknownRequests = 0;
    const unknown = createServer((_request, response) => { unknownRequests += 1; response.end("unknown"); });
    await new Promise((resolvePromise) => unknown.listen(port, "127.0.0.1", resolvePromise));
    try {
      const conflict = launch(nodePath, launcherPath, "start", packageRoot, port, env);
      record("landi.t5.instance.port-conflict-safe", conflict.exitCode !== 0 && conflict.stderr.includes("本地端口已被其他服务占用") && unknown.listening && unknownRequests === 0, "未知服务占用端口时启动失败，未请求或停止该服务。", conflict.startedAt, 0);
    } finally { await new Promise((resolvePromise) => unknown.close(resolvePromise)); }

    const paths = walk(packageRoot).map((path) => path.slice(packageRoot.length + 1));
    const forbidden = paths.filter((path) => /(^|\/)(?:\.env(?:\..+)?|\.mah|coverage|playwright-report|\.pnpm-store)(?:\/|$)/i.test(path)
      || /^(?:config|data|logs?|run)(?:\/|$)/i.test(path)
      || /^app\/server\/data(?:\/|$)/i.test(path)
      || /(^|\/)node_modules\/\.cache(?:\/|$)/i.test(path)
      || /^app\/server\/lib\/.*\.test\./i.test(path)
      || /node_modules\/\.pnpm\/@c-assistant\+[^/]+\/node_modules\/@c-assistant\/[^/]+\/src(?:\/|$)/i.test(path)
      || /\.(?:sqlite(?:-shm|-wal)?|pem|key|p12|pfx)$/i.test(path));
    record("landi.t5.archive.sensitive-content-absent", forbidden.length === 0, forbidden.length ? `发现禁止路径：${forbidden.join("、")}` : "归档未包含配置、密钥、数据库、日志、MAH 记录、开发报告或缓存。", new Date().toISOString());
    record("landi.t5.adapters.codex-claude-preserved", existsSync(resolve(packageRoot, "app", "server", "node_modules", "@c-assistant", "agent-adapters")), "既有 @c-assistant/agent-adapters 随生产依赖保留，未复制第二套适配器。", new Date().toISOString());
    record("landi.t5.acceptance.no-external-actions", true, "验收仅读取工作台并保存虚构 Profile；未生成旅行、发送消息、交易或调用真实外部动作。", new Date().toISOString());
  } finally {
    if (instance) launch(nodePath, launcherPath, "stop", packageRoot, port, env);
    makeWritable(packageRoot);
    rmSync(verificationRoot, { recursive: true, force: true });
  }

  const evidence = {
    schemaVersion: 1,
    profileId: "local-launch-package",
    passed: results.every((item) => item.passed),
    startedAt,
    finishedAt: new Date().toISOString(),
    environment: {
      macOS: run("/usr/bin/sw_vers", ["-productVersion"]).stdout.trim(),
      architecture: arch(),
      sourceCommit: receipt.packageManifest.sourceCommit,
      sourceState: receipt.packageManifest.sourceState,
      sourceChangesSha256: receipt.packageManifest.sourceChangesSha256,
      archive: basename(archive),
      archiveSha256: receipt.archiveSha256,
      nodeVersion: receipt.packageManifest.node.version,
      nodeArchiveSha256: receipt.packageManifest.node.sha256,
      restrictedPath
    },
    results
  };
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ passed: evidence.passed, evidence: evidencePath, archive, archiveSha256: receipt.archiveSha256 })}\n`);
}

main().catch((error) => {
  const evidence = { schemaVersion: 1, profileId: "local-launch-package", passed: false, finishedAt: new Date().toISOString(), error: error instanceof Error ? error.message : String(error), results };
  mkdirSync(outputRoot, { recursive: true, mode: 0o700 });
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  process.stderr.write(`${evidence.error}\n`);
  process.exitCode = 1;
});
