import assert from "node:assert/strict";
import test from "node:test";

import { AmapConnector, createAmapDrivingHandoff, createAmapPlaceHandoff, QWeatherConnector, TelegramConnector } from "./index.js";

test("Amap place search normalizes official response fields without exposing the key", async () => {
  const connector = new AmapConnector({
    apiKey: "test-key",
    fetcher: async () => new Response(JSON.stringify({
      status: "1",
      pois: [{ id: "poi-1", name: "Shanghai Railway Station", address: "Jing'an", location: "121.455,31.249", type: "Transport", cityname: "Shanghai", citycode: "021", adname: "Jing'an" }]
    }))
  });

  const result = await connector.searchPlaces({ query: "Shanghai Railway Station", region: "Shanghai" });
  assert.equal(result.status, "available");
  assert.equal(result.data?.[0]?.location, "121.455,31.249");
  assert.equal(result.data?.[0]?.cityCode, "021");
});

test("Amap connector reports an unconfigured key without making a request", async () => {
  const connector = new AmapConnector({ apiKey: "" });
  const result = await connector.drivingRoute({ origin: "121.4,31.2", destination: "121.5,31.3" });
  assert.equal(result.status, "not_configured");
});

test("Amap walking route returns distance and duration facts", async () => {
  let requestUrl = "";
  const connector = new AmapConnector({
    apiKey: "test-key",
    fetcher: async (input) => {
      requestUrl = String(input);
      return new Response(JSON.stringify({ status: "1", route: { origin: "121.455,31.249", destination: "121.475,31.230", paths: [{ distance: "2650", cost: { duration: "1900" } }] } }));
    }
  });

  const result = await connector.walkingRoute({ origin: "121.455,31.249", destination: "121.475,31.230", originId: "origin-poi", destinationId: "destination-poi" });
  const url = new URL(requestUrl);
  assert.equal(result.status, "available");
  assert.equal(result.data?.mode, "walking");
  assert.equal(result.data?.distanceMeters, 2650);
  assert.equal(result.data?.durationSeconds, 1900);
  assert.equal(url.pathname, "/v5/direction/walking");
  assert.equal(url.searchParams.get("show_fields"), "cost");
});

test("Amap public transit requires city codes and returns fare facts", async () => {
  let requestUrl = "";
  const connector = new AmapConnector({
    apiKey: "test-key",
    fetcher: async (input) => {
      requestUrl = String(input);
      return new Response(JSON.stringify({ status: "1", route: { transits: [{ distance: "5100", cost: { duration: "2100", transit_fee: "4" } }] } }));
    }
  });

  const missingCityCode = await connector.transitRoute({ origin: "121.455,31.249", destination: "121.475,31.230" });
  assert.equal(missingCityCode.status, "unsupported");
  assert.equal(missingCityCode.failure?.code, "missing_city_code");

  const result = await connector.transitRoute({ origin: "121.455,31.249", destination: "121.475,31.230", originCityCode: "021", destinationCityCode: "021" });
  const url = new URL(requestUrl);
  assert.equal(result.status, "available");
  assert.equal(result.data?.mode, "transit");
  assert.equal(result.data?.durationSeconds, 2100);
  assert.equal(result.data?.transitCostYuan, 4);
  assert.equal(url.pathname, "/v5/direction/transit/integrated");
  assert.equal(url.searchParams.get("city1"), "021");
  assert.equal(url.searchParams.get("city2"), "021");
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

test("Amap nearby accommodation discovery keeps booking outside C-assistant", async () => {
  let requestUrl = "";
  const connector = new AmapConnector({
    apiKey: "test-key",
    fetcher: async (input) => {
      requestUrl = String(input);
      return new Response(JSON.stringify({
        status: "1",
        pois: [{ id: "stay-1", name: "Riverside Hotel", address: "1 River Road", location: "121.456,31.250", type: "Accommodation", cityname: "Shanghai", adname: "Jing'an", distance: "480" }]
      }));
    }
  });

  const result = await connector.nearbyAccommodation({ location: "121.455,31.249" });
  const url = new URL(requestUrl);
  assert.equal(result.status, "available");
  assert.equal(result.data?.[0]?.distanceMeters, 480);
  assert.equal(url.searchParams.get("types"), "100000");
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

test("Amap route handoff can use a saved Plan place without inventing a POI id", () => {
  const handoff = createAmapDrivingHandoff({
    origin: { id: "", name: "Saved stay", address: "Shanghai", location: "121.455,31.249", type: "Plan accommodation", city: "", district: "" },
    destination: { id: "destination-poi", name: "Shanghai Museum", address: "Huangpu", location: "121.475,31.230", type: "Museum", city: "Shanghai", district: "Huangpu" }
  });

  const url = new URL(handoff.url);
  assert.equal(url.searchParams.has("sid"), false);
  assert.equal(url.searchParams.get("did"), "destination-poi");
});

test("Amap place handoff opens a known POI without creating an external transaction", () => {
  const handoff = createAmapPlaceHandoff({
    place: { id: "restaurant-poi", name: "Noodle House", address: "Market Street", location: "121.456,31.250", type: "Food", city: "Shanghai", district: "Jing'an" }
  });

  const url = new URL(handoff.url);
  assert.equal(url.origin, "https://uri.amap.com");
  assert.equal(url.pathname, "/marker");
  assert.equal(url.searchParams.get("poiid"), "restaurant-poi");
  assert.equal(url.searchParams.get("callnative"), "1");
  assert.equal(handoff.requiresUserAction, true);
});

test("Amap place handoff uses verified coordinates for a saved Plan place without a POI id", () => {
  const handoff = createAmapPlaceHandoff({
    place: { id: "", name: "Saved stay", address: "Shanghai", location: "121.455,31.249", type: "Plan accommodation", city: "", district: "" }
  });

  const url = new URL(handoff.url);
  assert.equal(url.searchParams.has("poiid"), false);
  assert.equal(url.searchParams.get("position"), "121.455,31.249");
  assert.equal(url.searchParams.get("name"), "Saved stay");
  assert.equal(url.searchParams.get("coordinate"), "gaode");
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

test("Telegram update polling normalizes only a usable private-chat message", async () => {
  let requestBody = "";
  const connector = new TelegramConnector({
    botToken: "test-token",
    fetcher: async (_input, init) => {
      requestBody = String(init?.body);
      return new Response(JSON.stringify({ ok: true, result: [
        { update_id: 11, message: { text: "/start pair_code_123", chat: { id: 1001, type: "private" }, from: { id: 1001, first_name: "Avery", username: "avery" } } },
        { update_id: 12, message: { chat: { id: 1002 }, from: { id: 1002 } } }
      ] }));
    }
  });

  const result = await connector.getUpdates({ offset: 10 });
  assert.equal(result.status, "available");
  assert.equal(result.data?.updates.length, 1);
  assert.equal(result.data?.updates[0]?.kind, "message");
  assert.equal(result.data?.updates[0]?.chatId, "1001");
  assert.equal(result.data?.updates[0]?.chatType, "private");
  assert.equal(result.data?.updates[0]?.text, "/start pair_code_123");
  assert.equal(result.data?.nextOffset, 13);
  assert.match(requestBody, /"offset":10/);
  assert.match(requestBody, /callback_query/);
  assert.doesNotMatch(JSON.stringify(result), /test-token/);
});

test("Telegram supports an arrival callback and an explicit shared location without exposing the token", async () => {
  const bodies: string[] = [];
  const connector = new TelegramConnector({
    botToken: "test-token",
    fetcher: async (input, init) => {
      bodies.push(String(init?.body));
      const url = String(input);
      if (url.endsWith("/getUpdates")) return new Response(JSON.stringify({ ok: true, result: [
        { update_id: 14, callback_query: { id: "callback-1", data: "arrival_not_here", from: { id: 1001, first_name: "Avery" }, message: { chat: { id: 1001, type: "private" } } } },
        { update_id: 15, message: { location: { latitude: 31.23, longitude: 121.47 }, chat: { id: 1001, type: "private" }, from: { id: 1001, first_name: "Avery" } } }
      ] }));
      if (url.endsWith("/sendMessage")) return new Response(JSON.stringify({ ok: true, result: { message_id: 3, chat: { id: 1001 } } }));
      return new Response(JSON.stringify({ ok: true, result: true }));
    }
  });

  const updates = await connector.getUpdates();
  assert.equal(updates.data?.updates[0]?.kind, "callback");
  assert.equal(updates.data?.updates[0]?.callbackData, "arrival_not_here");
  assert.deepEqual(updates.data?.updates[1]?.location, { latitude: 31.23, longitude: 121.47 });
  await connector.answerCallbackQuery({ callbackId: "callback-1", text: "Share location" });
  await connector.sendMessage({ chatId: "1001", text: "Share location", replyMarkup: { keyboard: [[{ text: "Share current location", request_location: true }]], resize_keyboard: true, one_time_keyboard: true } });
  assert.ok(bodies.some((body) => /callback_query_id/.test(body)));
  assert.ok(bodies.some((body) => /request_location/.test(body)));
  assert.doesNotMatch(JSON.stringify({ bodies }), /test-token/);
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
