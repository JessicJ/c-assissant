import process from "node:process";
import { fileURLToPath } from "node:url";

const DEFAULT_WEB_URL = "http://127.0.0.1:5173";
const DEFAULT_CORE_PORTS = ["8787", "8877"];
const DEFAULT_TIMEOUT_MS = 3_000;

function stripTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}

function endpoint(baseUrl, path) {
  return `${stripTrailingSlash(baseUrl)}${path}`;
}

function parseNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function parseArgs(argv = process.argv.slice(2), env = process.env) {
  const options = {
    webUrl: env.C_ASSISTANT_WEB_URL || DEFAULT_WEB_URL,
    coreUrl: env.C_ASSISTANT_CORE_URL || "",
    corePort: env.C_ASSISTANT_PORT || "",
    timeoutMs: DEFAULT_TIMEOUT_MS
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const readValue = () => {
      const next = argv[index + 1];
      index += 1;
      return next ?? "";
    };
    if (arg === "--web-url") options.webUrl = readValue();
    else if (arg.startsWith("--web-url=")) options.webUrl = arg.slice("--web-url=".length);
    else if (arg === "--core-url") options.coreUrl = readValue();
    else if (arg.startsWith("--core-url=")) options.coreUrl = arg.slice("--core-url=".length);
    else if (arg === "--core-port") options.corePort = readValue();
    else if (arg.startsWith("--core-port=")) options.corePort = arg.slice("--core-port=".length);
    else if (arg === "--timeout-ms") options.timeoutMs = parseNumber(readValue(), DEFAULT_TIMEOUT_MS);
    else if (arg.startsWith("--timeout-ms=")) options.timeoutMs = parseNumber(arg.slice("--timeout-ms=".length), DEFAULT_TIMEOUT_MS);
  }

  return {
    webUrl: stripTrailingSlash(options.webUrl || DEFAULT_WEB_URL),
    coreUrl: options.coreUrl ? stripTrailingSlash(options.coreUrl) : "",
    corePort: options.corePort,
    timeoutMs: options.timeoutMs
  };
}

async function fetchWithTimeout(fetchImpl, url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { signal: controller.signal, cache: "no-store" });
  } finally {
    clearTimeout(timer);
  }
}

async function requestText(fetchImpl, url, timeoutMs) {
  try {
    const response = await fetchWithTimeout(fetchImpl, url, timeoutMs);
    const text = await response.text();
    return { ok: response.ok, status: response.status, text };
  } catch (error) {
    return { ok: false, status: 0, text: "", error };
  }
}

async function requestJson(fetchImpl, url, timeoutMs) {
  const result = await requestText(fetchImpl, url, timeoutMs);
  if (!result.ok) return { ...result, payload: undefined };
  try {
    return { ...result, payload: JSON.parse(result.text) };
  } catch (error) {
    return { ...result, ok: false, error, payload: undefined };
  }
}

function resultError(result) {
  if (result.error instanceof Error) return result.error.message;
  if (result.status) return `HTTP ${result.status}`;
  return "request failed";
}

function workspaceLooksComplete(payload) {
  return Boolean(
    payload &&
    typeof payload === "object" &&
    "profile" in payload &&
    "runtime" in payload &&
    "activePlan" in payload
  );
}

function coreCandidates(options) {
  if (options.coreUrl) return [options.coreUrl];
  const ports = unique([options.corePort, ...DEFAULT_CORE_PORTS]);
  return ports.map((port) => `http://127.0.0.1:${port}`);
}

async function findCore(fetchImpl, options) {
  const checked = [];
  for (const baseUrl of coreCandidates(options)) {
    const result = await requestJson(fetchImpl, endpoint(baseUrl, "/health"), options.timeoutMs);
    checked.push(baseUrl);
    if (result.ok && result.payload && result.payload.status === "ok") return { baseUrl, checked };
  }
  return { baseUrl: "", checked };
}

async function checkWorkspace(rawOptions = {}) {
  const options = {
    ...parseArgs([], rawOptions.env ?? process.env),
    ...rawOptions
  };
  options.webUrl = stripTrailingSlash(options.webUrl || DEFAULT_WEB_URL);
  options.timeoutMs = parseNumber(options.timeoutMs, DEFAULT_TIMEOUT_MS);

  const fetchImpl = options.fetch ?? globalThis.fetch;
  const lines = [];
  const failures = [];

  const webRoot = await requestText(fetchImpl, options.webUrl, options.timeoutMs);
  if (webRoot.ok) lines.push(`Web workspace reachable at ${options.webUrl}`);
  else failures.push(`Web workspace is not reachable at ${options.webUrl}: ${resultError(webRoot)}.`);

  const core = await findCore(fetchImpl, options);
  if (core.baseUrl) lines.push(`Core service health is OK at ${core.baseUrl}/health`);
  else failures.push(`Core service health did not respond on ${core.checked.join(", ")}. Start the backend or pass --core-url.`);

  const proxyHealthUrl = endpoint(options.webUrl, "/health");
  const proxyHealth = await requestJson(fetchImpl, proxyHealthUrl, options.timeoutMs);
  if (proxyHealth.ok && proxyHealth.payload?.status === "ok") lines.push(`Web proxy health is OK at ${proxyHealthUrl}`);
  else failures.push(`Web proxy health failed at ${proxyHealthUrl}: ${resultError(proxyHealth)}.`);

  const workspaceUrl = endpoint(options.webUrl, "/api/workspace");
  const workspace = await requestJson(fetchImpl, workspaceUrl, options.timeoutMs);
  if (workspace.ok && workspaceLooksComplete(workspace.payload)) lines.push(`Workspace data is complete at ${workspaceUrl}`);
  else if (workspace.ok) failures.push(`Workspace data is incomplete at ${workspaceUrl}: expected profile, runtime, and activePlan.`);
  else failures.push(`Workspace data failed at ${workspaceUrl}: ${resultError(workspace)}.`);

  return { ok: failures.length === 0, lines, failures };
}

async function main() {
  const result = await checkWorkspace(parseArgs());
  console.log("Landi workspace check");
  for (const line of result.lines) console.log(`[ok] ${line}`);
  if (result.failures.length) {
    for (const failure of result.failures) console.error(`[fail] ${failure}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}

export { checkWorkspace, parseArgs };
