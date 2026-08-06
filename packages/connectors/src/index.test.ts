import assert from "node:assert/strict";
import test from "node:test";

import { AmapConnector, createAmapDrivingHandoff, TelegramConnector } from "./index.js";

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

test("Amap route handoff keeps route planning in the user's map app", () => {
  const handoff = createAmapDrivingHandoff({
    origin: { id: "origin-poi", name: "Shanghai Railway Station", address: "Jing'an", location: "121.455,31.249", type: "Transport", city: "Shanghai", district: "Jing'an" },
    destination: { id: "destination-poi", name: "Shanghai Museum", address: "Huangpu", location: "121.475,31.230", type: "Museum", city: "Shanghai", district: "Huangpu" }
  });

  const url = new URL(handoff.url);
  assert.equal(url.protocol, "amapuri:");
  assert.equal(url.searchParams.get("sid"), "origin-poi");
  assert.equal(url.searchParams.get("did"), "destination-poi");
  assert.equal(url.searchParams.get("dev"), "0");
  assert.equal(handoff.requiresUserAction, true);
});

test("Telegram bot verification normalizes identity and keeps the token out of results", async () => {
  let requestUrl = "";
  const connector = new TelegramConnector({
    botToken: "test-bot-token",
    fetcher: async (input) => {
      requestUrl = String(input);
      return new Response(JSON.stringify({
        ok: true,
        result: { id: 321, first_name: "C Assistant", username: "c_assistant_bot", can_join_groups: true, can_read_all_group_messages: false, supports_inline_queries: false }
      }));
    }
  });

  const result = await connector.getMe();
  assert.equal(result.status, "available");
  assert.equal(result.data?.username, "c_assistant_bot");
  assert.match(requestUrl, /\/getMe$/);
  assert.doesNotMatch(JSON.stringify(result), /test-bot-token/);
});

test("Telegram does not make a request when no bot token is configured", async () => {
  let requests = 0;
  const connector = new TelegramConnector({
    botToken: "",
    fetcher: async () => {
      requests += 1;
      return new Response();
    }
  });

  const result = await connector.getMe();
  assert.equal(result.status, "not_configured");
  assert.equal(requests, 0);
});
