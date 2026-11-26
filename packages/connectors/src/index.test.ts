import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { AmapConnector, createAmapDrivingHandoff, createAmapNavigationHandoff, createAmapPlaceHandoff, createGoogleMapsNavigationHandoff, createGoogleMapsPlaceHandoff, createUberRideHandoff, GoogleMapsConnector, GoogleWeatherConnector, OfficialSourceConnector, QWeatherConnector } from "./index.js";

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
      return new Response(JSON.stringify({ routes: [{ distanceMeters: 2400, duration: "720s", staticDuration: "600s", polyline: { encodedPolyline: "_p~iF~ps|U_ulLnnqC_mqNvxq`@" } }] }));
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
  assert.equal(route.data?.staticDurationSeconds, 600);
  assert.deepEqual(route.data?.geometry, [[-120.2, 38.5], [-120.95, 40.7], [-126.453, 43.252]]);
  assert.equal(route.data?.strategy, "google_maps_recommended");
  assert.doesNotMatch(JSON.stringify({ places, route, requested }), /google-test-key/);
});

test("restaurant searches request and preserve sourced dining introductions", async () => {
  const masks: string[] = [];
  const connector = new GoogleMapsConnector({ apiKey: "test", fetcher: async (_input, init) => {
    masks.push(new Headers(init?.headers).get("X-Goog-FieldMask") ?? "");
    return new Response(JSON.stringify({ places: [{ id: "restaurant", displayName: { text: "Example Restaurant" }, formattedAddress: "Auckland", location: { latitude: -36.844, longitude: 174.769 }, primaryType: "japanese_restaurant", primaryTypeDisplayName: { text: "Japanese restaurant" }, editorialSummary: { text: "Japanese dishes in a relaxed dining room." }, priceLevel: "PRICE_LEVEL_MODERATE", servesVegetarianFood: true, websiteUri: "https://example.com/restaurant" }] }));
  } });
  const result = await connector.nearbyRestaurants({ location: "174.769,-36.844" });
  assert.match(masks[0]!, /places.editorialSummary/);
  assert.equal(result.data?.[0]?.dining?.summary, "Japanese dishes in a relaxed dining room.");
  assert.equal(result.data?.[0]?.dining?.priceLevel, "PRICE_LEVEL_MODERATE");
  assert.equal(result.data?.[0]?.dining?.servesVegetarianFood, true);
  await connector.searchPlaces({ query: "hotel" });
  assert.doesNotMatch(masks[1]!, /editorialSummary/);
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


test("Google reverse geocoding resolves pickup country and city with latitude first", async () => {
  const connector = new GoogleMapsConnector({ apiKey: "test", fetcher: async input => {
    const url = new URL(String(input));
    assert.equal(url.searchParams.get("latlng"), "-36.8442,174.7695");
    return new Response(JSON.stringify({ status: "OK", results: [{ formatted_address: "29 Galway Street, Auckland, New Zealand", address_components: [
      { long_name: "Auckland", short_name: "Auckland", types: ["locality"] },
      { long_name: "New Zealand", short_name: "NZ", types: ["country"] }
    ] }] }));
  } });
  const result = await connector.reverseGeocode({ location: "174.7695,-36.8442" });
  assert.equal(result.data?.country, "New Zealand");
  assert.equal(result.data?.city, "Auckland");
});

test("Google reverse geocoding failure does not manufacture a pickup area", async () => {
  for (const status of ["ZERO_RESULTS", "REQUEST_DENIED", "OVER_QUERY_LIMIT"]) {
    const connector = new GoogleMapsConnector({ apiKey: "test", fetcher: async () => new Response(JSON.stringify({ status })) });
    const result = await connector.reverseGeocode({ location: "174.7695,-36.8442" });
    assert.notEqual(result.status, "available");
    assert.equal(result.data, undefined);
  }
});


test("hourly forecasts preserve provider intervals and omit incomplete rain evidence", async () => {
  const connector = new GoogleWeatherConnector({apiKey:"test",fetcher:async input=>{
    const url=new URL(String(input));assert.equal(url.pathname,"/v1/forecast/hours:lookup");
    assert.equal(url.searchParams.get("location.latitude"),"-37.872");assert.equal(url.searchParams.get("hours"),"6");
    return new Response(JSON.stringify({forecastHours:[{interval:{startTime:"2026-11-05T12:00:00Z",endTime:"2026-11-05T13:00:00Z"},weatherCondition:{description:{text:"Cloudy"}},precipitation:{qpf:{quantity:0},probability:{percent:10}}},{interval:{startTime:"2026-11-05T13:00:00Z",endTime:"2026-11-05T14:00:00Z"},precipitation:{}}]}));
  }});
  const result=await connector.hourlyForecast({coordinates:"175.683,-37.872"});
  assert.equal(result.data?.length,1);assert.equal(result.data?.[0]?.precipitationProbability,10);assert.equal(result.data?.[0]?.startAt,"2026-11-05T12:00:00Z");
});

test("email Uber handoff delegates pickup to Uber while preserving destination and public client configuration",()=>{
 const url=new URL(createUberRideHandoff({destination:{name:"Museum & Gallery",address:"Rotorua"},clientId:"public-test-client"}).url);
 assert.equal(url.searchParams.get("pickup"),"my_location");
 assert.equal(JSON.parse(url.searchParams.get("drop[0]")!).addressLine1,"Museum & Gallery");
 assert.equal(url.searchParams.get("client_id"),"public-test-client");
 assert.equal(url.origin,"https://m.uber.com");
});
