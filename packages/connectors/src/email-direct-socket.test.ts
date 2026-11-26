import assert from "node:assert/strict";
import test from "node:test";
import { Socket } from "node:net";
import { openDirectSmtpConnection } from "./email-direct-socket.js";
import { validDnsProxy, resolveSmtpHttps } from "./email-https-dns.js";
const config = { interfaceName: "en0", dnsServers: ["223.5.5.5"] };

test("HTTPS DNS proxy is restricted to credential-free explicit loopback HTTP endpoints", async () => {
  assert.equal(validDnsProxy("http://127.0.0.1:7890"), true);
  assert.equal(validDnsProxy("http://[::1]:7890"), true);
  for (const value of ["http://remote.example:7890", "http://localhost:7890", "http://127.0.0.1", "https://127.0.0.1:7890", "http://user:password@127.0.0.1:7890", "http://127.0.0.1:7890/private", "http://127.0.0.1:7890/?token=private"]) {
    assert.equal(validDnsProxy(value), false);
    await assert.rejects(resolveSmtpHttps("smtp.example.test", value), /SMTP DNS unavailable/);
  }
});

test("invalid explicit HTTPS DNS never falls back to the configured UDP resolver", async () => {
  let resolverCalls = 0;
  await assert.rejects(openDirectSmtpConnection("smtp.example.test", 587, { ...config, dnsHttpsProxy: "http://remote.example:7890" }, {
    localAddress: () => "192.0.2.10", resolve: async () => { resolverCalls++; return ["203.0.113.20"]; },
    connect: () => { throw new Error("Must never dial"); }
  }), { code: "ECONNECTION" });
  assert.equal(resolverCalls, 0);
});

test("direct connection binds both resolver and TCP to the selected current interface", async () => {
  const socket = new Socket(); let connected = false;
  const result = await openDirectSmtpConnection("smtp.example.test", 587, config, {
    localAddress: name => { assert.equal(name, "en0"); return "192.0.2.10"; },
    resolve: async (host, source, servers) => { assert.equal(host, "smtp.example.test"); assert.equal(source, "192.0.2.10"); assert.deepEqual(servers, config.dnsServers); return ["198.18.0.1", "203.0.113.20"]; },
    connect: options => { assert.deepEqual(options, { host: "203.0.113.20", port: 587, localAddress: "192.0.2.10", family: 4 }); connected = true; queueMicrotask(() => socket.emit("connect")); return socket; }
  });
  assert.equal(result, socket); assert.equal(connected, true); socket.destroy();
});

test("missing interface, invalid DNS and synthetic-only DNS fail without system fallback", async () => {
  for (const [settings, source, addresses] of [
    [config, undefined, ["203.0.113.20"]],
    [{ ...config, dnsServers: [] }, "192.0.2.10", ["203.0.113.20"]],
    [{ ...config, dnsServers: ["not-a-dns-address"] }, "192.0.2.10", ["203.0.113.20"]],
    [config, "192.0.2.10", ["198.19.0.1"]]
  ] as const) {
    await assert.rejects(openDirectSmtpConnection("smtp.example.test", 465, { ...settings, dnsServers: [...settings.dnsServers] }, {
      localAddress: () => source, resolve: async () => [...addresses], connect: () => { throw new Error("Must never dial"); }
    }), error => { assert.equal((error as { code: string }).code, "ECONNECTION"); return true; });
  }
});

test("TCP failure destroys the socket and exposes only a stable connection failure", async () => {
  const socket = new Socket();
  await assert.rejects(openDirectSmtpConnection("smtp.example.test", 587, config, {
    localAddress: () => "192.0.2.10", resolve: async () => ["203.0.113.20"],
    connect: () => { queueMicrotask(() => socket.emit("error", new Error("Private network detail"))); return socket; }
  }), error => { assert.equal((error as Error).message, "SMTP direct connection unavailable"); return true; });
  assert.equal(socket.destroyed, true);
});

test("overall deadline rejects stalled DNS and a late answer cannot open a socket", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let answer: ((addresses: string[]) => void) | undefined; let connections = 0;
  const pending = openDirectSmtpConnection("smtp.example.test", 587, config, {
    localAddress: () => "192.0.2.10", resolve: () => new Promise(resolve => { answer = resolve; }),
    connect: () => { connections++; return new Socket(); }
  });
  const rejected = assert.rejects(pending, { code: "ECONNECTION" });
  context.mock.timers.tick(10_000); await rejected;
  answer?.(["203.0.113.20"]); await Promise.resolve();
  assert.equal(connections, 0);
});
