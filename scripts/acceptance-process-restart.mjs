import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, open, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { SqliteWorkspaceStore } from "../packages/storage/lib/index.js";

const directory = resolve(process.argv[2] ?? "/private/tmp/landi-process-restart-acceptance");
assert.ok(directory.startsWith("/private/tmp/"));
await mkdir(directory, { recursive: true });
const sourceIndex = process.argv.indexOf("--plan-source");
if (sourceIndex >= 0) {
  const sourcePath = resolve(process.argv[sourceIndex + 1]);
  assert.ok(sourcePath.startsWith("/private/tmp/"), "Only isolated acceptance plans may be copied.");
  const source = new SqliteWorkspaceStore(sourcePath);
  const target = new SqliteWorkspaceStore(resolve(directory, "workspace.sqlite"));
  try {
    const { title, location, dates, knownInformation, assumptions, nextAction, presentation, stages } = source.getWorkspace().activePlan;
    assert.equal(presentation?.kind, "itinerary");
    const generated = target.createGeneratedPlan({ title, location, dates, knownInformation, assumptions, nextAction, presentation, stages });
    target.confirmPlan(generated.activePlan.id);
  } finally { source.close(); target.close(); }
}
const base = "http://127.0.0.1:8891";
// Refuse to interrupt any service already using the test port.
let occupied = false;
try { await fetch(`${base}/health`, { signal: AbortSignal.timeout(1_000) }); occupied = true; } catch {}
assert.equal(occupied, false, "The isolated test port is already occupied.");
const log = await open(resolve(directory, "server.log"), "a");
let child;
async function start() {
  child = spawn(process.execPath, [resolve("apps/server/lib/index.js")], {
    cwd: process.cwd(), stdio: ["ignore", log.fd, log.fd],
    env: { ...process.env, C_ASSISTANT_HOST: "127.0.0.1", C_ASSISTANT_PORT: "8891", C_ASSISTANT_DATA_PATH: resolve(directory, "workspace.sqlite"), TELEGRAM_BOT_TOKEN: "", WHATSAPP_ACCESS_TOKEN: "", LANDI_SEMANTIC_SHADOW: "0" }
  });
  for (let attempt = 0; attempt < 100; attempt++) {
    assert.equal(child.exitCode, null, "Test server exited during startup.");
    try { const response = await fetch(`${base}/health`, { signal: AbortSignal.timeout(1_000) }); if (response.ok) return; } catch {}
    await delay(100);
  }
  throw new Error("Isolated server startup timed out.");
}
async function stop(signal) {
  const stopped = once(child, "exit");
  child.kill(signal);
  await Promise.race([stopped, delay(15_000).then(() => { throw new Error("Server shutdown timed out."); })]);
  child = undefined;
}
async function workspace() {
  const response = await fetch(`${base}/api/workspace`, { signal: AbortSignal.timeout(5_000) });
  assert.equal(response.status, 200); return response.json();
}
const checks = [];
try {
  await start();
  const saved = await fetch(`${base}/api/profile`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ displayName: "Restart acceptance", preferredLanguage: "English", nationality: "China", gender: "prefer_not_to_say", immigrationStatus: "unknown" }) });
  assert.equal(saved.status, 200);
  const baseline = await workspace();
  if (sourceIndex >= 0) assert.equal(baseline.activePlan.status, "active");
  assert.equal(baseline.system.telegram, "not_configured");
  for (const signal of ["SIGTERM", "SIGKILL"]) {
    await stop(signal); await start();
    const restored = await workspace();
    assert.deepEqual(restored.profile, baseline.profile);
    assert.deepEqual(restored.activePlan, baseline.activePlan);
    assert.equal(restored.system.telegram, "not_configured");
    checks.push({ signal, profilePreserved: true, planPreserved: true, workspaceStatus: 200 });
  }
  const report = { status: "passed", checks, telegramMessagesSent: 0, scope: "Real isolated backend process restart and saved workspace persistence; no supervisor, browser recovery, live reminder delivery or unattended uptime is tested." };
  await writeFile(resolve(directory, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  if (child) { child.kill("SIGKILL"); await once(child, "exit"); }
  await log.close();
}
