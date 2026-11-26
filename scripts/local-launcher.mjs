import { createHash, randomBytes } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import net from "node:net";

export const serviceIdentity = "landi-local-workspace";
export const protocolVersion = "1";

class UserFacingError extends Error {}

function userFacingError(message) {
  return new UserFacingError(message);
}

export function instanceProof(token) {
  return createHash("sha256").update(`${serviceIdentity}\0${token}`).digest("hex");
}

export function resolveRuntimeLayout(packageRoot, environment = process.env) {
  const userRoot = environment.LANDI_LOCAL_USER_ROOT || resolve(homedir(), "Library", "Application Support", "Landi");
  const logsRoot = environment.LANDI_LOCAL_LOG_ROOT || resolve(homedir(), "Library", "Logs", "Landi");
  return {
    packageRoot: resolve(packageRoot),
    nodePath: resolve(packageRoot, "runtime", "bin", "node"),
    serverEntry: resolve(packageRoot, "app", "server", "lib", "index.js"),
    appRoot: resolve(packageRoot, "app"),
    configRoot: resolve(userRoot, "config"),
    dataRoot: resolve(userRoot, "data"),
    runRoot: resolve(userRoot, "run"),
    logsRoot,
    envPath: resolve(userRoot, "config", "landi.env"),
    databasePath: resolve(userRoot, "data", "workspace.sqlite"),
    receiptPath: resolve(userRoot, "run", "instance.json"),
    logPath: resolve(logsRoot, "server.log")
  };
}

function assertPackage(layout) {
  const requiredComponents = [
    [layout.nodePath, "bundled runtime"],
    [layout.serverEntry, "Landi service"],
    [resolve(layout.appRoot, "apps", "web", "dist", "index.html"), "Landi workspace"]
  ];
  for (const [path, component] of requiredComponents) {
    if (!existsSync(path)) throw userFacingError(`The launch package is incomplete: ${component} is missing. Download and extract the complete Landi package again.`);
  }
}

function ensureUserDirectories(layout) {
  for (const path of [layout.configRoot, layout.dataRoot, layout.runRoot, layout.logsRoot]) mkdirSync(path, { recursive: true, mode: 0o700 });
  if (!existsSync(layout.envPath)) writeFileSync(layout.envPath, "# Landi 本地配置。可在工作台中安全更新。\n", { mode: 0o600 });
}

function readReceipt(path) {
  try {
    const value = JSON.parse(readFileSync(path, "utf8"));
    return value?.schemaVersion === 1 ? value : undefined;
  } catch {
    return undefined;
  }
}

function writeReceipt(path, receipt) {
  const temporary = `${path}.partial`;
  writeFileSync(temporary, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, path);
}

function removeReceipt(path) {
  try { unlinkSync(path); } catch (error) { if (error?.code !== "ENOENT") throw error; }
}

export function processStartIdentity(pid) {
  if (!Number.isInteger(pid) || pid <= 1) return undefined;
  const result = spawnSync("/bin/ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  const value = result.status === 0 ? result.stdout.trim() : "";
  return value || undefined;
}

function processAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function getJson(url, timeoutMs = 1_000) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

export async function verifyOwnedInstance(receipt) {
  if (!receipt || !processAlive(receipt.pid)) return { owned: false, reason: "进程不存在" };
  if (processStartIdentity(receipt.pid) !== receipt.processStartIdentity) return { owned: false, reason: "PID 启动身份不匹配" };
  try {
    const health = await getJson(`http://127.0.0.1:${receipt.port}/health`);
    const owned = health.service === serviceIdentity
      && health.protocolVersion === protocolVersion
      && health.instanceProof === receipt.instanceProof;
    return owned ? { owned: true, health } : { owned: false, reason: "实例健康证明不匹配" };
  } catch {
    return { owned: false, reason: "实例健康证明不可用" };
  }
}

async function portIsOpen(port) {
  return new Promise((resolvePromise) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    const finish = (open) => { socket.destroy(); resolvePromise(open); };
    socket.setTimeout(400);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

async function waitForReadiness(receipt, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    if (!processAlive(receipt.pid)) throw userFacingError("Landi exited before startup completed. Check the Landi logs before trying again.");
    try {
      const ownership = await verifyOwnedInstance(receipt);
      if (!ownership.owned) throw new Error(ownership.reason);
      const [home, workspace] = await Promise.all([
        fetch(`http://127.0.0.1:${receipt.port}/`, { signal: AbortSignal.timeout(1_000) }),
        fetch(`http://127.0.0.1:${receipt.port}/api/workspace`, { signal: AbortSignal.timeout(1_000) })
      ]);
      if (home.ok && workspace.ok) return;
      lastError = new Error(`首页 ${home.status}，工作区 ${workspace.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 200));
  }
  throw userFacingError("The Landi workspace did not finish starting. Check the Landi logs before trying again.");
}

function openWorkspace(port, noOpen) {
  if (noOpen || process.env.LANDI_SKIP_BROWSER === "1") return;
  const result = spawnSync("/usr/bin/open", [`http://127.0.0.1:${port}/`], { stdio: "ignore" });
  if (result.status !== 0) throw userFacingError("The Landi workspace is ready, but the browser could not open. Open the launcher in your Landi package again. If it still fails, check the Landi logs.");
}

export async function startLocalLandi({ packageRoot, port, noOpen = false }) {
  const layout = resolveRuntimeLayout(packageRoot);
  assertPackage(layout);
  ensureUserDirectories(layout);
  const existing = readReceipt(layout.receiptPath);
  if (existing) {
    const ownership = await verifyOwnedInstance(existing);
    if (ownership.owned) {
      await waitForReadiness(existing);
      openWorkspace(existing.port, noOpen);
      return { status: "already_running", pid: existing.pid, port: existing.port, instanceProof: existing.instanceProof };
    }
    if (processAlive(existing.pid)) throw userFacingError("Landi found a running instance whose ownership could not be verified. Startup was stopped to protect other services. Close other Landi windows and try again. If it still fails, check the Landi logs.");
    removeReceipt(layout.receiptPath);
  }
  if (await portIsOpen(port)) throw userFacingError("Another service is using Landi’s local port. Landi did not start or change that service. Choose another port in the Landi configuration and try again.");

  const token = randomBytes(32).toString("hex");
  const proof = instanceProof(token);
  const logFd = openSync(layout.logPath, "a", 0o600);
  const child = spawn(layout.nodePath, [layout.serverEntry], {
    cwd: layout.packageRoot,
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: {
      HOME: homedir(),
      LANG: process.env.LANG ?? "zh_CN.UTF-8",
      PATH: process.env.LANDI_RUNTIME_PATH ?? "/usr/bin:/bin",
      TMPDIR: process.env.TMPDIR ?? "/tmp",
      LANDI_LOCAL_PACKAGE: "1",
      LANDI_APP_ROOT: layout.appRoot,
      LANDI_INSTANCE_TOKEN: token,
      LANDI_INSTANCE_PROTOCOL: protocolVersion,
      C_ASSISTANT_ENV_PATH: layout.envPath,
      C_ASSISTANT_DATA_PATH: layout.databasePath,
      C_ASSISTANT_HOST: "127.0.0.1",
      C_ASSISTANT_PORT: String(port)
    }
  });
  closeSync(logFd);
  if (!child.pid) throw userFacingError("The Landi workspace could not be started. Check the Landi logs before trying again.");
  child.unref();
  let identity;
  for (let attempt = 0; attempt < 20 && !identity; attempt += 1) {
    identity = processStartIdentity(child.pid);
    if (!identity) await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  }
  if (!identity) {
    try { process.kill(child.pid, "SIGTERM"); } catch {}
    throw userFacingError("The Landi instance could not be verified. Startup was cancelled to protect other services. Check the Landi logs before trying again.");
  }
  const receipt = { schemaVersion: 1, pid: child.pid, processStartIdentity: identity, port, instanceProof: proof, startedAt: new Date().toISOString() };
  writeReceipt(layout.receiptPath, receipt);
  try {
    await waitForReadiness(receipt);
  } catch (error) {
    const ownership = await verifyOwnedInstance(receipt);
    if (ownership.owned || processStartIdentity(child.pid) === identity) {
      try { process.kill(child.pid, "SIGTERM"); } catch {}
    }
    removeReceipt(layout.receiptPath);
    throw error;
  }
  openWorkspace(port, noOpen);
  return { status: "started", pid: child.pid, port, instanceProof: proof };
}

export async function stopLocalLandi({ packageRoot, timeoutMs = 10_000 }) {
  const layout = resolveRuntimeLayout(packageRoot);
  const receipt = readReceipt(layout.receiptPath);
  if (!receipt) return { status: "not_running" };
  const ownership = await verifyOwnedInstance(receipt);
  if (!ownership.owned) throw userFacingError("The running instance could not be verified as Landi, so it was not stopped. Keep your data and check the Landi logs.");
  process.kill(receipt.pid, "SIGTERM");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && processAlive(receipt.pid)) await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  if (processAlive(receipt.pid)) {
    const repeated = await verifyOwnedInstance(receipt);
    if (!repeated.owned) throw userFacingError("Landi could not safely stop the current instance, so it was not force-stopped. Check the Landi logs.");
    process.kill(receipt.pid, "SIGKILL");
  }
  removeReceipt(layout.receiptPath);
  return { status: "stopped", pid: receipt.pid, port: receipt.port };
}

function parseArguments(argv) {
  const action = argv[0];
  let packageRoot = resolve(import.meta.dirname, "..");
  let port = Number(process.env.LANDI_LOCAL_PORT ?? 8787);
  let noOpen = false;
  for (let index = 1; index < argv.length; index += 1) {
    if (argv[index] === "--package-root") packageRoot = resolve(argv[++index]);
    else if (argv[index] === "--port") port = Number(argv[++index]);
    else if (argv[index] === "--no-open") noOpen = true;
    else throw userFacingError("The launch option is invalid. Use the start or stop shortcut in your Landi package.");
  }
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw userFacingError("The Landi local port is invalid. Choose a port from 1024 to 65535 in the Landi configuration.");
  return { action, packageRoot, port, noOpen };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  let result;
  if (options.action === "start") result = await startLocalLandi(options);
  else if (options.action === "stop") result = await stopLocalLandi(options);
  else if (options.action === "restart") {
    await stopLocalLandi(options);
    result = await startLocalLandi(options);
  } else throw userFacingError("The launch action is invalid. Use the start or stop shortcut in your Landi package.");
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(import.meta.filename)) {
  main().catch((error) => {
    const message = error instanceof UserFacingError
      ? error.message
      : "Landi could not complete the operation. Check the Landi logs before trying again.";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
