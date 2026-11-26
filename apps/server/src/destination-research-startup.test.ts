import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import Fastify from "fastify";
import type { SqliteWorkspaceStore } from "@c-assistant/storage";
import { registerOfficialSourceRoutes } from "./official-source-routes.js";
import type { OfficialSourceService } from "./official-source-service.js";

test("destination startup loads only official registries, without the three retired catalogs", async () => {
  const originalRead = fs.readFileSync;
  const reads: string[] = [];
  fs.readFileSync = ((path: unknown, ...args: unknown[]) => {
    const name = String(path);
    if (/\/data\/(china|japan)\//.test(name)) {
      reads.push(name);
      if (!name.endsWith("/official-source-registry.json")) throw new Error("Retired catalog accessed during startup");
    }
    return Reflect.apply(originalRead, fs, [path, ...args]);
  }) as typeof fs.readFileSync;
  syncBuiltinESMExports();
  try {
    const { createDestinationResearch } = await import("./destination-research.js");
    const research = createDestinationResearch({
      store: {} as SqliteWorkspaceStore,
      getConnectors: () => { throw new Error("Startup/discovery must not call providers"); }
    });
    assert.deepEqual(Object.keys(research).sort(), ["officialSources", "japanOfficialSources", "resolvePlanDestination"].sort());
    assert.equal(reads.length, 2);
    assert.ok(reads.some((name) => name.endsWith("/china/official-source-registry.json")));
    assert.ok(reads.some((name) => name.endsWith("/japan/official-source-registry.json")));
    for (const service of [research.officialSources, research.japanOfficialSources]) {
      const result = service.discover();
      assert.equal(result.status, "available");
      assert.ok(result.data?.length);
    }
  } finally {
    fs.readFileSync = originalRead;
    syncBuiltinESMExports();
  }
});

test("official source GET and POST keep destination routing with isolated fake refresh", async () => {
  const { createDestinationResearch } = await import("./destination-research.js");
  let country = "China";
  const store = { getWorkspace: () => ({ activePlan: { id: "fictional-plan", location: "Fictional city" } }) } as unknown as SqliteWorkspaceStore;
  const research = createDestinationResearch({ store, getConnectors: () => ({ maps: {
    geocodeAddress: async () => ({ status: "available", data: { country } })
  } }) as never });
  const server = Fastify();
  const refreshed: string[] = [];
  const fakeRefresh = (label: string): OfficialSourceService["refresh"] => async ({ sourceId }) => {
    refreshed.push(`${label}:${sourceId}`);
    return { status: "available", provider: "official_source", observedAt: "2026-11-01T00:00:00Z" };
  };
  registerOfficialSourceRoutes(server, {
    store, resolvePlanDestination: research.resolvePlanDestination,
    sources: {
      china: { ...research.officialSources, refresh: fakeRefresh("china") },
      japan: { ...research.japanOfficialSources, refresh: fakeRefresh("japan") }
    }
  });
  try {
    for (const [value, label] of [["China", "china"], ["Japan", "japan"]]) {
      country = value!;
      const get = await server.inject({ method: "GET", url: "/api/official-sources" });
      assert.equal(get.statusCode, 200);
      assert.ok(get.json().data.length);
      const post = await server.inject({ method: "POST", url: "/api/official-sources/fictional-source/refresh", payload: {} });
      assert.equal(post.statusCode, 200);
      assert.equal(refreshed.at(-1), `${label}:fictional-source`);
    }
    country = "Portugal";
    const unsupported = await server.inject({ method: "GET", url: "/api/official-sources" });
    assert.equal(unsupported.statusCode, 422);
    assert.equal(unsupported.json().reasonCode, "unsupported_country");
  } finally {
    await server.close();
  }
});
