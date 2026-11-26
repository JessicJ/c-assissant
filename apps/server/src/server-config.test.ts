import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { loadServerConfig } from "./server-config.js";

test("本地启动包模式只读取显式包外配置，不发现源码环境文件", () => {
  const root = mkdtempSync(join(tmpdir(), "landi-server-config-"));
  const fakeEntry = resolve(root, "apps", "server", "lib", "index.js");
  mkdirSync(resolve(root, "apps", "server", "lib"), { recursive: true });
  writeFileSync(resolve(root, ".env"), "LANDI_CONFIG_DISCOVERY_PROBE=不应读取\n");
  const previous = { localPackage: process.env.LANDI_LOCAL_PACKAGE, appRoot: process.env.LANDI_APP_ROOT, envPath: process.env.C_ASSISTANT_ENV_PATH, probe: process.env.LANDI_CONFIG_DISCOVERY_PROBE };
  try {
    process.env.LANDI_LOCAL_PACKAGE = "1";
    process.env.LANDI_APP_ROOT = root;
    delete process.env.C_ASSISTANT_ENV_PATH;
    delete process.env.LANDI_CONFIG_DISCOVERY_PROBE;
    const config = loadServerConfig(pathToFileURL(fakeEntry).href);
    assert.equal(config.projectRoot, root);
    assert.equal(process.env.LANDI_CONFIG_DISCOVERY_PROBE, undefined);
  } finally {
    for (const [key, value] of Object.entries({ LANDI_LOCAL_PACKAGE: previous.localPackage, LANDI_APP_ROOT: previous.appRoot, C_ASSISTANT_ENV_PATH: previous.envPath, LANDI_CONFIG_DISCOVERY_PROBE: previous.probe })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    rmSync(root, { recursive: true, force: true });
  }
});
