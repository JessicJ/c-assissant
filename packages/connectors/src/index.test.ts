import assert from "node:assert/strict";
import test from "node:test";

import { AmapConnector, createAmapDrivingHandoff, QWeatherConnector, TelegramConnector } from "./index.js";

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

test("Amap geocoding resolves a city fact without exposing the key", async () => {
  const connector = new AmapConnector({
    apiKey: "test-key",
    fetcher: async (input) => {
      assert.match(String(input), /\/v3\/geocode\/geo/);
      return new Response(JSON.stringify({ status: "1", geocodes: [{ formatted_address: "Shanghai City", location: "121.4737,31.2304", province: "Shanghai", city: "Shanghai", district: "Huangpu", level: "city" }] }));
    }
  });
  const result = await connector.geocodeAddress({ address: "Shanghai" });
  assert.equal(result.status, "available");
  assert.equal(result.data?.location, "121.4737,31.2304");
});

test("Amap nearby restaurant discovery keeps distance facts and uses the restaurant category", async () => {
  let requestUrl = "";
  const connector = new AmapConnector({
    apiKey: "test-key",
    fetcher: async (input) => {
      requestUrl = String(input);
      return new Response(JSON.stringify({
        status: "1",
        pois: [{ id: "restaurant-1", name: "Noodle House", address: "12 Market Street", location: "121.456,31.250", type: "Food", cityname: "Shanghai", adname: "Jing'an", distance: "284" }]
      }));
    }
  });

  const result = await connector.nearbyRestaurants({ location: "121.455,31.249" });
  const url = new URL(requestUrl);
  assert.equal(result.status, "available");
  assert.equal(result.data?.[0]?.distanceMeters, 284);
  assert.equal(url.pathname, "/v5/place/around");
  assert.equal(url.searchParams.get("types"), "050000");
  assert.equal(url.searchParams.get("sortrule"), "distance");
  assert.equal(url.searchParams.has("radius"), false);
  assert.doesNotMatch(JSON.stringify(result), /test-key/);
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

test("QWeather combines current facts and a daily forecast from country-pack coordinates without exposing its key", async () => {
  const requests: Array<{ url: string; key: string | null }> = [];
  const connector = new QWeatherConnector({
    apiKey: "test-qweather-key",
    apiHost: "demo.qweatherapi.com",
    fetcher: async (input, init) => {
      const url = new URL(String(input));
      requests.push({ url: `${url.pathname}${url.search}`, key: new Headers(init?.headers).get("X-QW-Api-Key") });
      if (url.pathname === "/v7/weather/now") return new Response(JSON.stringify({ code: "200", now: { obsTime: "2026-08-06T09:00+08:00", temp: "29", feelsLike: "31", icon: "101", text: "Cloudy", windDir: "East", windScale: "3", humidity: "72", precip: "0" } }));
      return new Response(JSON.stringify({ code: "200", fxLink: "https://www.qweather.com", daily: [{ fxDate: "2026-08-06", textDay: "Cloudy", textNight: "Clear", tempMax: "31", tempMin: "25", precip: "0", uvIndex: "7" }] }));
    }
  });

  const result = await connector.weather({ coordinates: "121.47,31.23", locationName: "Shanghai", adminArea: "Shanghai", country: "China" });
  assert.equal(result.status, "available");
  assert.equal(result.data?.location.id, "121.47,31.23");
  assert.equal(result.data?.current.temperatureC, 29);
  assert.equal(result.data?.daily[0]?.highC, 31);
  assert.equal(requests.length, 2);
  assert.ok(requests.every((request) => request.key === "test-qweather-key"));
  assert.doesNotMatch(JSON.stringify(result), /test-qweather-key/);
});

test("QWeather reports missing configuration without making a request", async () => {
  let requests = 0;
  const connector = new QWeatherConnector({
    apiKey: "",
    apiHost: "demo.qweatherapi.com",
    fetcher: async () => {
      requests += 1;
      return new Response();
    }
  });
  const result = await connector.weather({ coordinates: "121.47,31.23", locationName: "Shanghai" });
  assert.equal(result.status, "not_configured");
  assert.equal(requests, 0);
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
