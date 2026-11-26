import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createServer } from "node:net";
import test from "node:test";
import { instanceProof, resolveRuntimeLayout, startLocalLandi, stopLocalLandi, verifyOwnedInstance } from "./local-launcher.mjs";

const launcherPath = fileURLToPath(new URL("./local-launcher.mjs", import.meta.url));

test("源码交付仅保留规范启动包路径，旧安装、预览和卸载入口全部退役", () => {
  const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  for (const command of ["service:install:macos", "service:preview:macos", "service:remove:macos"]) {
    assert.equal(Object.hasOwn(manifest.scripts, command), false);
  }
  for (const file of ["macos-service.mjs", "macos-service.test.mjs"]) {
    assert.equal(existsSync(new URL(file, import.meta.url)), false);
    assert.equal(Object.values(manifest.scripts).some((command) => command.includes(file)), false);
  }
  assert.match(manifest.scripts.test, /scripts\/local-launcher\.test\.mjs/);
  assert.equal(manifest.scripts["package:macos"], "node scripts/package-macos.mjs");
  assert.match(manifest.scripts["test:local-launch"], /scripts\/local-launcher\.test\.mjs/);
});

function assertNoInternalDetails(message, forbidden = []) {
  for (const value of ["LANDI_LOCAL_PORT", "local-launcher.mjs", "--package-root", "--port", "--no-open", ...forbidden]) {
    assert.equal(message.includes(value), false, `错误文案不应包含内部细节：${value}`);
  }
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "landi-launcher-test-"));
  const packageRoot = join(root, "package");
  const userRoot = join(root, "user");
  const logRoot = join(root, "logs");
  const controlPath = join(root, "readiness.json");
  const requestsPath = join(root, "requests.jsonl");
  for (const path of [join(packageRoot, "runtime", "bin"), join(packageRoot, "app", "server", "lib"), join(packageRoot, "app", "apps", "web", "dist")]) mkdirSync(path, { recursive: true });
  symlinkSync(process.execPath, join(packageRoot, "runtime", "bin", "node"));
  writeFileSync(join(packageRoot, "app", "apps", "web", "dist", "index.html"), "<!doctype html><title>Landi</title>");
  writeFileSync(join(packageRoot, "app", "server", "lib", "index.js"), `
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
const controlPath = ${JSON.stringify(controlPath)};
const requestsPath = ${JSON.stringify(requestsPath)};
const proof = createHash("sha256").update("landi-local-workspace\\0" + process.env.LANDI_INSTANCE_TOKEN).digest("hex");
const server = createServer((request, response) => {
  const control = existsSync(controlPath) ? JSON.parse(readFileSync(controlPath, "utf8")) : {};
  appendFileSync(requestsPath, JSON.stringify(request.url) + "\\n");
  if (control.unreadyPaths?.includes(request.url)) response.statusCode = 503;
  response.setHeader("content-type", "application/json");
  if (request.url === "/health") response.end(JSON.stringify({ status: "ok", service: "landi-local-workspace", protocolVersion: "1", instanceProof: proof }));
  else if (request.url === "/api/workspace") response.end(JSON.stringify({ profile: { status: "empty" } }));
  else { response.setHeader("content-type", "text/html"); response.end("<!doctype html><title>Landi</title>"); }
});
server.listen(Number(process.env.C_ASSISTANT_PORT), "127.0.0.1");
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => server.close(() => process.exit(0)));
`);
  return { root, packageRoot, userRoot, logRoot, controlPath, requestsPath };
}

async function freePort() {
  const server = createServer();
  await new Promise((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
  const address = server.address();
  await new Promise((resolvePromise) => server.close(resolvePromise));
  return address.port;
}

async function withFixture(operation) {
  const value = fixture();
  const before = { ...process.env };
  process.env.LANDI_LOCAL_USER_ROOT = value.userRoot;
  process.env.LANDI_LOCAL_LOG_ROOT = value.logRoot;
  process.env.LANDI_SKIP_BROWSER = "1";
  try { await operation(value); }
  finally {
    await stopLocalLandi({ packageRoot: value.packageRoot, timeoutMs: 1_000 }).catch(() => {});
    process.env = before;
    rmSync(value.root, { recursive: true, force: true });
  }
}

async function waitForRequest(requestsPath, path, after = 0) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const requests = existsSync(requestsPath) ? readFileSync(requestsPath, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)) : [];
    const count = requests.filter((entry) => entry === path).length;
    if (count > after) return count;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
  }
  assert.fail(`隔离实例未收到就绪检查：${path}`);
}

test("首启须等待首页和工作区 API 全部就绪后才完成", () => withFixture(async (value) => {
  const { packageRoot, controlPath, requestsPath } = value;
  writeFileSync(controlPath, JSON.stringify({ unreadyPaths: ["/", "/api/workspace"] }));
  let completed = false;
  const starting = startLocalLandi({ packageRoot, port: await freePort() }).then((result) => { completed = true; return result; });
  const homeCount = await waitForRequest(requestsPath, "/");
  const workspaceCount = await waitForRequest(requestsPath, "/api/workspace");
  assert.equal(completed, false);
  writeFileSync(controlPath, JSON.stringify({ unreadyPaths: ["/api/workspace"] }));
  await waitForRequest(requestsPath, "/", homeCount);
  await waitForRequest(requestsPath, "/api/workspace", workspaceCount);
  assert.equal(completed, false);
  writeFileSync(controlPath, JSON.stringify({ unreadyPaths: [] }));
  assert.equal((await starting).status, "started");
}));

for (const path of ["/", "/api/workspace"]) {
  test(`重复启动在${path === "/" ? "首页" : "工作区 API"}暂不可用时等待并复用原实例`, () => withFixture(async ({ packageRoot, controlPath, requestsPath }) => {
    const port = await freePort();
    const first = await startLocalLandi({ packageRoot, port });
    const layout = resolveRuntimeLayout(packageRoot);
    const originalReceipt = readFileSync(layout.receiptPath, "utf8");
    writeFileSync(controlPath, JSON.stringify({ unreadyPaths: [path] }));
    const before = readFileSync(requestsPath, "utf8").trim().split("\n").map((line) => JSON.parse(line)).filter((entry) => entry === path).length;
    let completed = false;
    const repeating = startLocalLandi({ packageRoot, port }).then((result) => { completed = true; return result; });
    await waitForRequest(requestsPath, path, before);
    assert.equal(completed, false);
    assert.equal((await verifyOwnedInstance(JSON.parse(originalReceipt))).owned, true);
    writeFileSync(controlPath, JSON.stringify({ unreadyPaths: [] }));
    const repeated = await repeating;
    assert.equal(repeated.status, "already_running");
    assert.equal(repeated.pid, first.pid);
    assert.equal(readFileSync(layout.receiptPath, "utf8"), originalReceipt);
  }));
}

test("重复启动就绪超时不停止原实例或删除收据和数据", (context) => withFixture(async ({ packageRoot, controlPath, requestsPath }) => {
  const port = await freePort();
  const first = await startLocalLandi({ packageRoot, port });
  const layout = resolveRuntimeLayout(packageRoot);
  const originalReceipt = readFileSync(layout.receiptPath, "utf8");
  writeFileSync(layout.databasePath, "隔离持久数据");
  writeFileSync(controlPath, JSON.stringify({ unreadyPaths: ["/api/workspace"] }));
  const before = readFileSync(requestsPath, "utf8").trim().split("\n").map((line) => JSON.parse(line)).filter((entry) => entry === "/api/workspace").length;
  const currentTime = Date.now;
  let expire = false;
  const clock = context.mock.method(Date, "now", () => currentTime() + (expire ? 60_000 : 0));
  try {
    const repeating = startLocalLandi({ packageRoot, port });
    const rejected = assert.rejects(repeating, /The Landi workspace did not finish starting/);
    await waitForRequest(requestsPath, "/api/workspace", before);
    expire = true;
    await rejected;
  } finally {
    clock.mock.restore();
  }
  assert.equal(process.kill(first.pid, 0), true);
  assert.equal((await verifyOwnedInstance(JSON.parse(originalReceipt))).owned, true);
  assert.equal(readFileSync(layout.receiptPath, "utf8"), originalReceipt);
  assert.equal(readFileSync(layout.databasePath, "utf8"), "隔离持久数据");
  writeFileSync(controlPath, JSON.stringify({ unreadyPaths: [] }));
  const recovered = await startLocalLandi({ packageRoot, port });
  assert.equal(recovered.status, "already_running");
  assert.equal(recovered.pid, first.pid);
}));

test("实例证明不暴露原始随机令牌", () => {
  const proof = instanceProof("fixture-token");
  assert.match(proof, /^[a-f0-9]{64}$/);
  assert.equal(proof.includes("fixture-token"), false);
});

test("用户状态和日志始终位于启动包外", () => withFixture(async ({ packageRoot, userRoot, logRoot }) => {
  const layout = resolveRuntimeLayout(packageRoot);
  assert.equal(layout.dataRoot.startsWith(userRoot), true);
  assert.equal(layout.logsRoot, logRoot);
  assert.equal(layout.databasePath.startsWith(packageRoot), false);
}));

test("启动包缺少组件时只显示稳定组件名称和产品级恢复动作", () => withFixture(async ({ packageRoot }) => {
  const layout = resolveRuntimeLayout(packageRoot);
  rmSync(layout.nodePath);
  await assert.rejects(startLocalLandi({ packageRoot, port: await freePort(), noOpen: true }), (error) => {
    assert.match(error.message, /launch package is incomplete: bundled runtime is missing/);
    assert.match(error.message, /Download and extract the complete Landi package again/);
    assertNoInternalDetails(error.message, [packageRoot, layout.nodePath, "runtime/bin/node"]);
    return true;
  });
}));

test("重复启动复用已证明实例并可正常停止", () => withFixture(async ({ packageRoot, userRoot }) => {
  const port = await freePort();
  const first = await startLocalLandi({ packageRoot, port, noOpen: true });
  const second = await startLocalLandi({ packageRoot, port, noOpen: true });
  assert.equal(first.status, "started");
  assert.equal(second.status, "already_running");
  assert.equal(second.pid, first.pid);
  const stopped = await stopLocalLandi({ packageRoot });
  assert.equal(stopped.status, "stopped");
  assert.equal(readFileSync(join(userRoot, "config", "landi.env"), "utf8").includes("Landi"), true);
}));

test("未知服务占用端口时失败且保持未知服务运行", () => withFixture(async ({ packageRoot }) => {
  const server = createServer((socket) => {
    socket.on("error", () => {});
    socket.end("HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nOK");
  });
  await new Promise((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
  const port = server.address().port;
  await assert.rejects(startLocalLandi({ packageRoot, port, noOpen: true }), (error) => {
    assert.match(error.message, /Another service is using Landi’s local port/);
    assert.match(error.message, /Choose another port in the Landi configuration/);
    assertNoInternalDetails(error.message, [String(port)]);
    return true;
  });
  assert.equal(server.listening, true);
  await new Promise((resolvePromise) => server.close(resolvePromise));
}));

test("收据身份不匹配时拒绝停止且不暴露内部身份或日志路径", () => withFixture(async ({ packageRoot, userRoot, logRoot }) => {
  const layout = resolveRuntimeLayout(packageRoot);
  mkdirSync(dirname(layout.receiptPath), { recursive: true });
  writeFileSync(layout.receiptPath, JSON.stringify({ schemaVersion: 1, pid: process.pid, processStartIdentity: "不匹配", port: 65534, instanceProof: "不匹配" }));
  await assert.rejects(stopLocalLandi({ packageRoot }), (error) => {
    assert.match(error.message, /running instance could not be verified as Landi/);
    assert.match(error.message, /check the Landi logs/);
    assertNoInternalDetails(error.message, [packageRoot, logRoot, layout.logPath, "PID", "实例健康证明"]);
    return true;
  });
  assert.equal(readFileSync(join(userRoot, "run", "instance.json"), "utf8").includes("不匹配"), true);
}));

test("未知参数不回显参数内容或内部命令语法", () => {
  const result = spawnSync(process.execPath, [launcherPath, "start", "--内部参数"], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /launch option is invalid/);
  assertNoInternalDetails(result.stderr, ["--内部参数", "<start|stop|restart>", launcherPath]);
});

test("无效操作只提示产品级双击入口", () => {
  const result = spawnSync(process.execPath, [launcherPath, "内部操作"], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /launch action is invalid/);
  assert.match(result.stderr, /start or stop shortcut in your Landi package/);
  assertNoInternalDetails(result.stderr, ["内部操作", "<start|stop|restart>", launcherPath]);
});

test("符号链接目录中的规范命令入口仍执行并返回产品错误", () => {
  const root = mkdtempSync(join(tmpdir(), "landi-launcher-alias-"));
  try {
    symlinkSync(dirname(launcherPath), join(root, "scripts"));
    const result = spawnSync(process.execPath, [join(root, "scripts", "local-launcher.mjs"), "内部操作"], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /launch action is invalid/);
    assertNoInternalDetails(result.stderr, [root, launcherPath]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
