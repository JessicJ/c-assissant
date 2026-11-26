import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { SqliteWorkspaceStore } from "@c-assistant/storage";
import { registerLocalWebRoutes } from "./local-web-routes.js";

test("恢复读取的工作区接口不公开底层诊断", async () => {
  const server = Fastify({ logger: false });
  const store = { getWorkspace() { throw new Error("虚构内部诊断 /private/fixture-only changed before"); } } as unknown as SqliteWorkspaceStore;
  try {
    await registerLocalWebRoutes(server, { store, webAssetsPath: "/tmp/landi-test-missing-assets", webTripMapPath: "/tmp/landi-test-missing-trip-map", webIndexPath: "/tmp/landi-test-missing-index.html" });
    const response = await server.inject({ method: "GET", url: "/api/workspace" });
    assert.equal(response.statusCode, 500);
    assert.equal(response.json().code, "internal_error");
    assert.equal(response.body.includes("虚构内部诊断"), false);
    assert.equal(response.body.includes("/private/"), false);
  } finally { await server.close(); }
});

test("local Web routes reject non-local browser origins before handlers run", async () => {
  const server = Fastify({ logger: false });
  const store = new SqliteWorkspaceStore(":memory:");
  try {
    await registerLocalWebRoutes(server, {
      store,
      webAssetsPath: "/tmp/landi-test-missing-assets",
      webTripMapPath: "/tmp/landi-test-missing-trip-map",
      webIndexPath: "/tmp/landi-test-missing-index.html"
    });

    const blocked = await server.inject({ method: "GET", url: "/health", headers: { origin: "https://example.com" } });
    assert.equal(blocked.statusCode, 403);

    const local = await server.inject({ method: "GET", url: "/health", headers: { origin: "http://127.0.0.1:5173" } });
    assert.equal(local.statusCode, 200);
    assert.deepEqual(local.json(), { status: "ok", service: "c-assistant-core", mode: "local" });
  } finally {
    await server.close();
    store.close();
  }
});

test("local Web routes keep profile updates scoped to the workspace store", async () => {
  const server = Fastify({ logger: false });
  const store = new SqliteWorkspaceStore(":memory:");
  try {
    await registerLocalWebRoutes(server, {
      store,
      webAssetsPath: "/tmp/landi-test-missing-assets",
      webTripMapPath: "/tmp/landi-test-missing-trip-map",
      webIndexPath: "/tmp/landi-test-missing-index.html"
    });

    const response = await server.inject({
      method: "PUT",
      url: "/api/profile",
      payload: {
        displayName: "Avery",
        preferredLanguage: "English",
        nationality: "Canada",
        gender: "not_specified",
        immigrationStatus: "tourist_visa"
      }
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().profile.status, "ready");
    assert.equal(store.getWorkspace().profile.nationality, "Canada");
  } finally {
    await server.close();
    store.close();
  }
});

test("local package health binds readiness to the launcher instance proof", async () => {
  const server = Fastify({ logger: false });
  const store = new SqliteWorkspaceStore(":memory:");
  try {
    await registerLocalWebRoutes(server, {
      store,
      webAssetsPath: "/tmp/landi-test-missing-assets",
      webTripMapPath: "/tmp/landi-test-missing-trip-map",
      webIndexPath: "/tmp/landi-test-missing-index.html",
      instanceHealth: { service: "landi-local-workspace", protocolVersion: "1", proof: "proof-fixture" }
    });
    const response = await server.inject({ method: "GET", url: "/health" });
    assert.deepEqual(response.json(), {
      status: "ok",
      service: "landi-local-workspace",
      mode: "local_package",
      protocolVersion: "1",
      instanceProof: "proof-fixture"
    });
  } finally {
    await server.close();
    store.close();
  }
});
