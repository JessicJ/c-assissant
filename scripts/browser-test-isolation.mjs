import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import net from "node:net";
import tls from "node:tls";
import dgram from "node:dgram";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";

/** Browser fixtures may listen locally but cannot contact providers or launch agents. */
export function isolateBrowserTestServer() {
  const port = process.env.LANDI_BROWSER_PORT ?? "8765";
  if (!/^\d+$/.test(port) || Number(port) < 1024 || Number(port) > 65535) throw new Error("Invalid LANDI_BROWSER_PORT.");
  const directory = mkdtempSync(join(tmpdir(), "landi-playwright-"));
  const envPath = join(directory, "empty.env");
  writeFileSync(envPath, "", { mode: 0o600 });
  const retained = new Set(["PATH", "HOME", "TMPDIR", "TMP", "TEMP", "SYSTEMROOT", "LANG", "LC_ALL", "TZ"]);
  for (const key of Object.keys(process.env)) if (!retained.has(key)) delete process.env[key];
  Object.assign(process.env, {
    NODE_ENV: "test",
    LANDI_SERVER_MODE: "standard",
    C_ASSISTANT_HOST: "127.0.0.1",
    C_ASSISTANT_PORT: port,
    C_ASSISTANT_ENV_PATH: envPath,
    C_ASSISTANT_DATA_PATH: join(directory, "workspace.sqlite"),
    LANDI_BLUEPRINT_GENERATION: "0",
    LANDI_SEMANTIC_SHADOW: "0",
    LANDI_SEMANTIC_DRAFT_CANARY: "0"
  });
  const blocked = () => { throw new Error("Browser test isolation blocks outbound network and subprocesses."); };
  net.Socket.prototype.connect = blocked;
  tls.connect = blocked;
  dgram.Socket.prototype.send = blocked;
  globalThis.fetch = blocked;
  for (const method of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) childProcess[method] = blocked;
  syncBuiltinESMExports();
  return { directory, cleanup: () => rmSync(directory, { recursive: true, force: true }) };
}
