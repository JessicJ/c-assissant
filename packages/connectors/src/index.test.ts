import assert from "node:assert/strict";
import test from "node:test";

import { AmapConnector } from "./index.js";

test("Amap place search normalizes official response fields without exposing the key", async () => {
  const connector = new AmapConnector({
    apiKey: "test-key",
    fetcher: async () => new Response(JSON.stringify({
      status: "1",
      pois: [{ id: "poi-1", name: "Shanghai Railway Station", address: "Jing'an", location: "121.455,31.249", type: "Transport", cityname: "Shanghai", adname: "Jing'an" }]
    }))
  });

  const result = await connector.searchPlaces({ query: "Shanghai Railway Station", region: "Shanghai" });
  assert.equal(result.status, "available");
  assert.equal(result.data?.[0]?.location, "121.455,31.249");
});

test("Amap connector reports an unconfigured key without making a request", async () => {
  const connector = new AmapConnector({ apiKey: "" });
  const result = await connector.drivingRoute({ origin: "121.4,31.2", destination: "121.5,31.3" });
  assert.equal(result.status, "not_configured");
});
