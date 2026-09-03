import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import type { ConnectorBundle } from "./connector-bundle.js";
import { registerMapConnectorRoutes } from "./map-connector-routes.js";

test("map connector routes call the configured maps connector", async () => {
  const server = Fastify({ logger: false });
  const calls: string[] = [];
  try {
    registerMapConnectorRoutes(server, () => ({
      maps: {
        searchPlaces: async ({ query }: { query: string }) => {
          calls.push(query);
          return { status: "available", provider: "google_maps", observedAt: "2026-09-01T00:00:00.000Z", data: [] };
        }
      }
    } as unknown as ConnectorBundle));

    const response = await server.inject({ method: "GET", url: "/api/maps/places?query=Kyoto" });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(calls, ["Kyoto"]);
  } finally {
    await server.close();
  }
});

test("temporary amap aliases remain wired to the maps connector", async () => {
  const server = Fastify({ logger: false });
  const calls: Array<{ origin: string; destination: string }> = [];
  try {
    registerMapConnectorRoutes(server, () => ({
      maps: {
        walkingRoute: async ({ origin, destination }: { origin: string; destination: string }) => {
          calls.push({ origin, destination });
          return { status: "unavailable", provider: "google_maps", observedAt: "2026-09-01T00:00:00.000Z", failure: { code: "offline", message: "offline", retryable: true } };
        }
      }
    } as unknown as ConnectorBundle));

    const response = await server.inject({ method: "GET", url: "/api/amap/routes/walking?origin=A&destination=B" });

    assert.equal(response.statusCode, 503);
    assert.deepEqual(calls, [{ origin: "A", destination: "B" }]);
  } finally {
    await server.close();
  }
});
