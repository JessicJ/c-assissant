import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import { AmapConnector, createAmapDrivingHandoff, createAmapNavigationHandoff, createAmapPlaceHandoff, createGoogleMapsNavigationHandoff, createGoogleMapsPlaceHandoff, createUberRideHandoff, GoogleMapsConnector, GoogleWeatherConnector, OfficialSourceConnector, QWeatherConnector, TelegramConnector, WhatsAppConnector } from "./index.js";

const officialSources = [{
  id: "immigration",
  authority: "National Immigration Administration",
  title: "Immigration information",
  url: "https://en.nia.gov.cn/",
  allowedDomains: ["en.nia.gov.cn"],
  topics: ["immigration", "arrival"],
  language: "en" as const
}];

test("Official source Connector fetches a bounded snapshot only from an approved official domain", async () => {
  let requested = "";
  const connector = new OfficialSourceConnector({
    sources: officialSources,
    fetcher: async (input) => {
      requested = String(input);
      return new Response("<html><head><title>Guidelines for Foreigners</title></head><body><main>Official arrival guidance for visitors.</main></body></html>", { headers: { "content-type": "text/html" } });
    }
  });

  const result = await connector.fetchSnapshot({ sourceId: "immigration" });
  assert.equal(result.status, "available");
  assert.equal(result.data?.titleOriginal, "Guidelines for Foreigners");
  assert.match(result.data?.excerpt ?? "", /Official arrival guidance/);
  assert.match(result.data?.contentHash ?? "", /^[a-f0-9]{64}$/);
  assert.equal(requested, "https://en.nia.gov.cn/");
});

test("Official source Connector rejects unapproved URLs without fetching them", async () => {
  let calls = 0;
  const connector = new OfficialSourceConnector({
    sources: officialSources,
    fetcher: async () => {
      calls += 1;
      return new Response();
    }
  });

  const result = await connector.fetchSnapshot({ sourceId: "immigration", url: "https://example.com/visa" });
  assert.equal(result.status, "unsupported");
  assert.equal(result.failure?.code, "unapproved_source_url");
  assert.equal(calls, 0);
});

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

test("Google Maps normalizes Places and route facts without exposing its key", async () => {
  const requested: string[] = [];
  const connector = new GoogleMapsConnector({
    apiKey: "google-test-key",
    fetcher: async (input) => {
      requested.push(String(input));
      if (String(input).includes("places.googleapis.com")) return new Response(JSON.stringify({ places: [{ id: "place-1", displayName: { text: "Example Hotel" }, formattedAddress: "1 Example Road", location: { latitude: 31.23, longitude: 121.47 }, primaryType: "lodging", addressComponents: [{ longText: "Shanghai", types: ["locality"] }, { longText: "China", types: ["country"] }], businessStatus: "CLOSED_TEMPORARILY" }] }));
      return new Response(JSON.stringify({ routes: [{ distanceMeters: 2400, duration: "720s", polyline: { encodedPolyline: "_p~iF~ps|U_ulLnnqC_mqNvxq`@" } }] }));
    }
  });
  const places = await connector.searchPlaces({ query: "Example Hotel" });
  const route = await connector.drivingRoute({ origin: "121.46,31.22", destination: "121.47,31.23" });
  assert.equal(places.provider, "google_maps");
  assert.equal(places.data?.[0]?.name, "Example Hotel");
  assert.equal(places.data?.[0]?.provider, "google_maps");
  assert.equal(places.data?.[0]?.country, "China");
  assert.equal(places.data?.[0]?.businessStatus, "temporarily_closed");
  assert.equal(route.data?.provider, "google_maps");
  assert.equal(route.data?.durationSeconds, 720);
  assert.deepEqual(route.data?.geometry, [[-120.2, 38.5], [-120.95, 40.7], [-126.453, 43.252]]);
  assert.equal(route.data?.strategy, "google_maps_recommended");
  assert.doesNotMatch(JSON.stringify({ places, route, requested }), /google-test-key/);
});

test("Google Weather normalizes current and three-day facts", async () => {
  const connector = new GoogleWeatherConnector({
    apiKey: "google-weather-key",
    fetcher: async (input) => {
      if (String(input).includes("currentConditions")) {
        return new Response(JSON.stringify({ currentTime: "2026-08-12T08:00:00Z", timeZone: { id: "Asia/Shanghai" }, weatherCondition: { type: "CLOUDY", description: { text: "Cloudy" } }, temperature: { degrees: 29 }, feelsLikeTemperature: { degrees: 31 }, relativeHumidity: 70, precipitation: { qpf: { quantity: 0 } } }));
      }
      return new Response(JSON.stringify({ timeZone: { id: "Asia/Shanghai" }, forecastDays: [{ displayDate: { year: 2026, month: 8, day: 12 }, daytimeForecast: { weatherCondition: { description: { text: "Rain" } }, precipitation: { qpf: { quantity: 3 } }, uvIndex: 6 }, nighttimeForecast: { weatherCondition: { description: { text: "Cloudy" } }, precipitation: { qpf: { quantity: 1 } } }, maxTemperature: { degrees: 32 }, minTemperature: { degrees: 25 } }] }));
    }
  });
  const result = await connector.weather({ coordinates: "121.47,31.23", locationName: "Shanghai" });
  assert.equal(result.provider, "google_weather");
  assert.equal(result.data?.provider, "google_weather");
  assert.equal(result.data?.daily[0]?.precipitationMm, 4);
  assert.equal(result.data?.daily[0]?.uvIndex, 6);
  assert.doesNotMatch(JSON.stringify(result), /google-weather-key/);
});

test("Google Weather classifies a location coverage 404 as unsupported", async () => {
  const connector = new GoogleWeatherConnector({ apiKey: "google-weather-key", fetcher: async () => new Response(JSON.stringify({ error: { code: 404 } }), { status: 404 }) });
  const result = await connector.weather({ coordinates: "121.47,31.23", locationName: "Unsupported location" });
  assert.equal(result.status, "unsupported");
  assert.equal(result.failure?.code, "http_404");
  assert.match(result.failure?.message ?? "", /does not provide weather facts/i);
  assert.doesNotMatch(JSON.stringify(result), /google-weather-key/);
});

test("Google Maps handoffs use portable HTTPS URLs", () => {
  const origin = { id: "", name: "Current location", address: "", location: "121.46,31.22", type: "point", city: "", district: "" };
  const destination = { id: "place-1", name: "Example Hotel", address: "1 Example Road", location: "121.47,31.23", type: "lodging", city: "Shanghai", district: "" };
  const legacyRoute = new URL(createGoogleMapsNavigationHandoff({ origin, destination, transport: "transit" }).url);
  const googlePlace = new URL(createGoogleMapsPlaceHandoff({ place: { ...destination, provider: "google_maps" } }).url);
  assert.match(legacyRoute.toString(), /^https:\/\/www\.google\.com\/maps\/dir/);
  assert.equal(legacyRoute.searchParams.has("destination_place_id"), false);
  assert.equal(googlePlace.searchParams.get("query_place_id"), "place-1");
});

test("Uber ride handoff uses device GPS and destination text without requiring a secret", () => {
  const handoff = createUberRideHandoff({
    pickup: { latitude: 31.2304, longitude: 121.4737 },
    destination: { name: "Riverside Hotel", address: "1 River Road, Shanghai" }
  });
  const url = new URL(handoff.url);
  assert.equal(handoff.provider, "uber");
  assert.equal(url.origin, "https://m.uber.com");
  assert.equal(url.pathname, "/looking");
  assert.deepEqual(JSON.parse(url.searchParams.get("pickup") ?? "{}"), { latitude: 31.2304, longitude: 121.4737, addressLine1: "Current location" });
  assert.deepEqual(JSON.parse(url.searchParams.get("drop[0]") ?? "{}"), { addressLine1: "Riverside Hotel", addressLine2: "1 River Road, Shanghai" });
  assert.equal(url.searchParams.has("client_id"), false);
});

test("Uber ride handoff includes an explicitly configured public client ID", () => {
  const handoff = createUberRideHandoff({
    pickup: { latitude: 31.2304, longitude: 121.4737 },
    destination: { name: "Riverside Hotel", address: "1 River Road, Shanghai" },
    clientId: "public-client-id"
  });
  assert.equal(new URL(handoff.url).searchParams.get("client_id"), "public-client-id");
  assert.doesNotMatch(handoff.url, /client_secret|server_token|access_token/i);
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
      return new Response(JSON.stringify({ status: "1", geocodes: [{ formatted_address: "Shanghai City", location: "121.4737,31.2304", adcode: "310101", province: "Shanghai", city: "Shanghai", district: "Huangpu", level: "city" }] }));
    }
  });
  const result = await connector.geocodeAddress({ address: "Shanghai" });
  assert.equal(result.status, "available");
  assert.equal(result.data?.location, "121.4737,31.2304");
  assert.equal(result.data?.adcode, "310101");
});

test("Amap basic weather preserves only returned facts and never exposes its key", async () => {
  const requestUrls: string[] = [];
  const connector = new AmapConnector({
    apiKey: "test-key",
    fetcher: async (input) => {
      requestUrls.push(String(input));
      return new Response(JSON.stringify({
        status: "1",
        lives: [{ province: "上海", city: "黄浦区", adcode: "310101", weather: "多云", temperature: "30", winddirection: "东", windpower: "3", humidity: "68", reporttime: "2026-08-08 11:00:00" }],
        forecasts: [{ casts: [{ date: "2026-08-08", dayweather: "多云", nightweather: "晴", daytemp: "32", nighttemp: "26", daywind: "东", nightwind: "东南", daypower: "3", nightpower: "2" }] }]
      }));
    }
  });

  const result = await connector.basicWeather({ adcode: "310101", locationName: "Shanghai" });
  assert.equal(result.status, "available");
  assert.equal(result.data?.source, "amap");
  assert.equal(result.data?.current.temperatureC, 30);
  assert.equal(result.data?.daily[0]?.highC, 32);
  assert.equal(requestUrls.length, 2);
  assert.ok(requestUrls.every((requestUrl) => new URL(requestUrl).pathname === "/v3/weather/weatherInfo"));
  assert.deepEqual(requestUrls.map((requestUrl) => new URL(requestUrl).searchParams.get("extensions")).sort(), ["all", "base"]);
  assert.doesNotMatch(JSON.stringify(result), /test-key/);
  assert.equal("precipitationMm" in (result.data?.current ?? {}), false);
});

test("Amap classifies official daily quota responses as rate limited", async () => {
  const connector = new AmapConnector({ apiKey: "test-key", fetcher: async () => new Response(JSON.stringify({ status: "0", infocode: "10003", info: "DAILY_QUERY_OVER_LIMIT" })) });
  const result = await connector.basicWeather({ adcode: "310101", locationName: "Shanghai" });
  assert.equal(result.status, "rate_limited");
  assert.equal(result.failure?.retryable, true);
});

test("Amap converts a GPS coordinate before using it as an Amap route point", async () => {
  let requestUrl = "";
  const connector = new AmapConnector({
    apiKey: "test-key",
    fetcher: async (input) => {
      requestUrl = String(input);
      return new Response(JSON.stringify({ status: "1", locations: "121.476,31.228" }));
    }
  });

  const result = await connector.convertGpsCoordinate({ location: "121.4700001,31.2300001" });
  const url = new URL(requestUrl);
  assert.equal(result.data?.location, "121.476,31.228");
  assert.equal(url.pathname, "/v3/assistant/coordinate/convert");
  assert.equal(url.searchParams.get("coordsys"), "gps");
  assert.equal(url.searchParams.get("locations"), "121.470000,31.230000");
});

test("Amap reverse geocoding returns the live city code needed for public transit", async () => {
  let requestUrl = "";
  const connector = new AmapConnector({
    apiKey: "test-key",
    fetcher: async (input) => {
      requestUrl = String(input);
      return new Response(JSON.stringify({ status: "1", regeocode: { formatted_address: "Shanghai Huangpu District", addressComponent: { city: [], citycode: "021", adcode: "310101", district: "Huangpu" } } }));
    }
  });
  const result = await connector.reverseGeocode({ location: "121.4700001,31.2300001" });
  const url = new URL(requestUrl);
  assert.equal(result.data?.cityCode, "021");
  assert.equal(result.data?.adcode, "310101");
  assert.equal(result.data?.district, "Huangpu");
  assert.equal(url.pathname, "/v3/geocode/regeo");
  assert.equal(url.searchParams.get("location"), "121.470000,31.230000");
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

test("Amap nearby accommodation discovery keeps booking outside Landi", async () => {
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

test("Amap navigation handoff uses a portable HTTPS route link", () => {
  const handoff = createAmapNavigationHandoff({
    origin: { id: "", name: "Shared current location", address: "", location: "121.455,31.249", type: "Current location", city: "", district: "" },
    destination: { id: "stay-1", name: "Riverside Hotel", address: "1 River Road", location: "121.456,31.250", type: "Accommodation", city: "Shanghai", district: "Jing'an" },
    transport: "transit"
  });
  const url = new URL(handoff.url);
  assert.equal(url.origin, "https://uri.amap.com");
  assert.equal(url.pathname, "/navigation");
  assert.equal(url.searchParams.get("mode"), "bus");
  assert.equal(url.searchParams.get("callnative"), "1");
  assert.equal(handoff.requiresUserAction, true);
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
  await connector.sendMessage({ chatId: "1001", text: "Open Amap", replyMarkup: { inline_keyboard: [[{ text: "Open route in Amap", url: "https://uri.amap.com/navigation?mode=car" }]] } });
  assert.ok(bodies.some((body) => /callback_query_id/.test(body)));
  assert.ok(bodies.some((body) => /request_location/.test(body)));
  assert.ok(bodies.some((body) => /uri\.amap\.com\/navigation/.test(body)));
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

test("WhatsApp remains optional and reports actionable readiness states without exposing secrets", () => {
  const absent = new WhatsAppConnector({});
  assert.equal(absent.configurationStatus().status, "not_configured");

  const outboundOnly = new WhatsAppConnector({ accessToken: "wa-access-token", phoneNumberId: "phone-1" });
  const webhookPending = outboundOnly.configurationStatus();
  assert.equal(webhookPending.status, "degraded");
  assert.equal(webhookPending.data?.state, "webhook_pending");

  const templatePending = new WhatsAppConnector({ accessToken: "wa-access-token", phoneNumberId: "phone-1", appSecret: "wa-app-secret", verifyToken: "wa-verify-token" }).configurationStatus();
  assert.equal(templatePending.data?.state, "template_pending");

  const ready = new WhatsAppConnector({ accessToken: "wa-access-token", phoneNumberId: "phone-1", appSecret: "wa-app-secret", verifyToken: "wa-verify-token", reminderTemplateName: "landi_reminder" }).configurationStatus();
  assert.equal(ready.status, "available");
  assert.equal(ready.data?.state, "available");
  assert.doesNotMatch(JSON.stringify({ webhookPending, templatePending, ready }), /wa-access-token|wa-app-secret|wa-verify-token/);
});

test("WhatsApp verifies its phone and separates service-window text from proactive templates", async () => {
  const requests: Array<{ url: string; body: string }> = [];
  const connector = new WhatsAppConnector({
    accessToken: "wa-access-token",
    phoneNumberId: "phone-1",
    appSecret: "wa-app-secret",
    verifyToken: "wa-verify-token",
    reminderTemplateName: "landi_reminder",
    fetcher: async (input, init) => {
      const url = String(input);
      requests.push({ url, body: String(init?.body ?? "") });
      if (url.includes("fields=")) return new Response(JSON.stringify({ id: "phone-1", display_phone_number: "+1 555 0100", verified_name: "Landi", quality_rating: "GREEN" }));
      return new Response(JSON.stringify({ contacts: [{ wa_id: "15550100" }], messages: [{ id: "wamid.1" }] }));
    }
  });

  const identity = await connector.verifyPhoneNumber();
  assert.equal(identity.data?.verifiedName, "Landi");

  const expired = await connector.sendText({ to: "+1 (555) 0100", text: "Free-form reminder", serviceWindowExpiresAt: "2020-01-01T00:00:00Z" });
  assert.equal(expired.status, "unsupported");
  assert.equal(expired.failure?.code, "template_required");

  const text = await connector.sendText({ to: "+1 (555) 0100", text: "How can I help?", serviceWindowExpiresAt: "2099-01-01T00:00:00Z" });
  const template = await connector.sendTemplate({ to: "15550100", templateName: "landi_reminder", languageCode: "en_US", bodyParameters: ["Bring your passport"] });
  assert.equal(text.data?.messageId, "wamid.1");
  assert.equal(template.data?.messageId, "wamid.1");
  assert.ok(requests.some((request) => /"type":"text"/.test(request.body)));
  assert.ok(requests.some((request) => /"type":"template"/.test(request.body)));
  assert.doesNotMatch(JSON.stringify({ identity, text, template, requests }), /wa-access-token/);
});

test("WhatsApp accepts only signed webhooks and normalizes text, location, actions, and delivery state", () => {
  const appSecret = "wa-app-secret";
  const connector = new WhatsAppConnector({ accessToken: "wa-access-token", phoneNumberId: "phone-1", appSecret, verifyToken: "wa-verify-token", reminderTemplateName: "landi_reminder" });
  const challenge = connector.verifyWebhookChallenge({ mode: "subscribe", verifyToken: "wa-verify-token", challenge: "challenge-123" });
  assert.equal(challenge.data, "challenge-123");

  const rawBody = JSON.stringify({ object: "whatsapp_business_account", entry: [{ changes: [{ field: "messages", value: {
    contacts: [{ wa_id: "15550100", profile: { name: "Avery" } }],
    messages: [
      { id: "wamid.text", from: "15550100", timestamp: "1786665600", type: "text", text: { body: "Hello Landi" } },
      { id: "wamid.location", from: "15550100", timestamp: "1786665601", type: "location", location: { latitude: 48.85, longitude: 2.35 } },
      { id: "wamid.button", from: "15550100", timestamp: "1786665602", type: "interactive", interactive: { button_reply: { id: "not_arrived", title: "I haven't arrived" } } }
    ],
    statuses: [{ id: "wamid.outbound", recipient_id: "15550100", status: "delivered", timestamp: "1786665603" }]
  } }] }] });
  const signature = `sha256=${createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;
  assert.equal(connector.receiveWebhook({ rawBody, signature: "sha256=" + "0".repeat(64) }).status, "unauthorized");
  const result = connector.receiveWebhook({ rawBody, signature });
  assert.equal(result.status, "available");
  assert.equal(result.data?.messages[0]?.text, "Hello Landi");
  assert.deepEqual(result.data?.messages[1]?.location, { latitude: 48.85, longitude: 2.35 });
  assert.equal(result.data?.messages[2]?.actionId, "not_arrived");
  assert.equal(result.data?.deliveryStatuses[0]?.status, "delivered");
  assert.match(result.data?.messages[0]?.serviceWindowExpiresAt ?? "", /^2026-/);
  assert.doesNotMatch(JSON.stringify(result), /wa-app-secret|wa-access-token/);
});
