import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";

test("browser server isolates database, credentials, network and agent processes", () => {
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import assert from 'node:assert/strict';
    import { existsSync, readFileSync } from 'node:fs';
    import net from 'node:net';
    import tls from 'node:tls';
    import dgram from 'node:dgram';
    import { spawn } from 'node:child_process';
    import { isolateBrowserTestServer } from './scripts/browser-test-isolation.mjs';
    const first = isolateBrowserTestServer();
    try {
      assert.equal(process.env.LANDI_SMTP_PASSWORD, undefined);
      assert.equal(process.env.LANDI_LIVE_AGENT_E2E, undefined);
      assert.equal(process.env.LANDI_MAH_CLI_COMMAND, undefined);
      assert.equal(process.env.C_ASSISTANT_HOST, '127.0.0.1');
      assert.equal(readFileSync(process.env.C_ASSISTANT_ENV_PATH, 'utf8'), '');
      assert.ok(process.env.C_ASSISTANT_DATA_PATH.startsWith(first.directory + '/'));
      const second = isolateBrowserTestServer();
      assert.notEqual(first.directory, second.directory); second.cleanup();
      for (const action of [() => net.connect(25, 'example.test'), () => tls.connect(465, 'example.test'), () => spawn('mah'), () => fetch('https://example.test'), () => { const socket = dgram.createSocket('udp4'); try { socket.send('x', 25, 'example.test'); } finally { socket.close(); } }]) assert.throws(action, /isolation blocks/);
    } finally { first.cleanup(); }
    assert.equal(existsSync(first.directory), false);
  `], { cwd: new URL("../", import.meta.url), encoding: "utf8", env: { ...process.env, LANDI_SMTP_PASSWORD: "fictional-secret", LANDI_LIVE_AGENT_E2E: "1", LANDI_MAH_CLI_COMMAND: "/fictional/mah" } });
  assert.equal(result.status, 0, result.stderr);
});
