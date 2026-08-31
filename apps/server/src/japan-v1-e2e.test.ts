import assert from "node:assert/strict";
import test from "node:test";
import type { ConnectorResult, GeocodedPlaceFact, RouteFact, WeatherSnapshot } from "@c-assistant/connectors";
import { listJapanPolicySourceIds, listJapanReferenceSourceIds } from "@c-assistant/japan-country-pack/reference-catalog";
import { SqliteWorkspaceStore } from "@c-assistant/storage";
import { createJapanArrivalFactCollector, type JapanMapsReader } from "./japan-arrival-facts.js";
import { createJapanCompilationService } from "./japan-plan-compilation.js";
import { createJapanSourcePreparationService } from "./japan-source-preparation.js";

const now = "2026-08-24T00:00:00.000Z";
const available = <T>(provider: "google_maps" | "google_weather", data: T): ConnectorResult<T> => ({ status: "available", provider, observedAt: now, data });
const registryUrls: Record<string, string> = {
  "jp-mofa-visa-exemption": "https://www.mofa.go.jp/j_info/visit/visa/short/novisa.html",
  "jp-mofa-visa-faq": "https://www.mofa.go.jp/j_info/visit/visa/faq.html",
  "jp-visit-japan-web": "https://services.digital.go.jp/en/visit-japan-web/",
  "jp-jnto-ic-cards": "https://www.japan.travel/en/plan/ic-card/",
  "jp-jreast-welcome-suica": "https://www.jreast.co.jp/en/multi/welcomesuica/welcomesuica.html",
  "jp-jnto-emergencies": "https://www.japan.travel/en/plan/emergencies/",
  "jp-haneda-access": "https://tokyo-haneda.com/en/access/index.html",
  "jp-go-tokyo-food": "https://www.gotokyo.org/en/see-and-do/drinking-and-dining/tokyo-local-food/index.html"
};

test("credential-free Tokyo workflow selects Japan facts, compiles a source-bound draft, and activates only after confirmation", async () => {
  const store = new SqliteWorkspaceStore(":memory:");
  store.updateProfile({ displayName: "Alex", preferredLanguage: "English", nationality: "Canada", gender: "not_specified", immigrationStatus: "unknown" });
  let workspace = store.createGeneratedPlan({
    title: "Tokyo trip",
    location: "Tokyo, Japan",
    dates: "2026-11-24 to 2026-12-01",
    knownInformation: ["Purpose: tourism", "Passport confirmed: yes", "Destination: Tokyo, Japan", "Arrival airport: Haneda Airport"],
    assumptions: [],
    nextAction: "Review the Plan.",
    stages: [{ title: "Tokyo itinerary", description: "Tokyo demo", presentationKind: "itinerary", tasks: [{ title: "Review Tokyo itinerary", owner: "user", dueLabel: "Before departure" }] }]
  });
  workspace = store.updatePlanAccommodation(workspace.activePlan.id, { status: "confirmed", id: "stay-1", name: "Example Stay", address: "Tokyo", location: "139.767,35.681", source: "user" });
  workspace = store.updatePlanArrival(workspace.activePlan.id, { expectedAtLocal: "2026-11-24T12:00", timeZone: "Asia/Tokyo" });
  const planId = workspace.activePlan.id;

  const requested: string[] = [];
  const sourcePreparation = createJapanSourcePreparationService({ store, refresher: { refresh: async ({ sourceId }) => {
    requested.push(sourceId);
    assert.ok(sourceId.startsWith("jp-"));
    const saved = store.saveSourceSnapshot({ sourceId, authority: sourceId.startsWith("jp-mofa") ? "Ministry of Foreign Affairs of Japan" : "Official Japan authority", titleOriginal: sourceId, url: registryUrls[sourceId]!, retrievedAt: now, contentHash: (sourceId.length % 10).toString().repeat(64), excerpt: "Bounded fixture text." });
    return { status: "available", provider: "official_source", observedAt: now, data: saved };
  } } });
  const route = (mode: RouteFact["mode"]): ConnectorResult<RouteFact> => available("google_maps", { provider: "google_maps", mode, origin: "139.767,35.681", destination: "139.770,35.680", distanceMeters: mode === "walking" ? 800 : 1200, durationSeconds: mode === "walking" ? 700 : 400, strategy: mode === "transit" ? "public_transit_recommended" : "google_maps_recommended" });
  const routeRequests: Array<{ origin: string; destination: string }> = [];
  const maps: JapanMapsReader = {
    geocodeAddress: async ({ address }) => available<GeocodedPlaceFact>("google_maps", address === "Haneda Airport"
      ? { provider: "google_maps", formattedAddress: "Haneda Airport, Tokyo, Japan", location: "139.780,35.549", province: "Tokyo", city: "Tokyo", country: "Japan", district: "Ota", level: "poi" }
      : { provider: "google_maps", formattedAddress: "Tokyo, Japan", location: "139.770,35.680", province: "Tokyo", city: "Tokyo", country: "Japan", district: "Chiyoda", level: "city" }),
    nearbyAccommodation: async () => available("google_maps", [{ provider: "google_maps", id: "stay-1", name: "Example Stay", address: "Tokyo", location: "139.767,35.681", type: "lodging", city: "Tokyo", country: "Japan", district: "Chiyoda", distanceMeters: 300 }]),
    drivingRoute: async (request) => { routeRequests.push(request); return route("driving"); }, walkingRoute: async (request) => { routeRequests.push(request); return route("walking"); }, transitRoute: async (request) => { routeRequests.push(request); return route("transit"); },
    reverseGeocode: async () => available("google_maps", { provider: "google_maps", formattedAddress: "Tokyo", city: "Tokyo", cityCode: "google", district: "Chiyoda" })
  };
  const weather: WeatherSnapshot = { location: { id: "tokyo", name: "Tokyo", adminArea: "Tokyo", country: "Japan", latitude: 35.68, longitude: 139.77, timezone: "Asia/Tokyo" }, current: { observedAt: now, condition: "Clear", conditionCode: "CLEAR", temperatureC: 24, feelsLikeC: 24, humidityPercent: 50, windDirection: "", windScale: "", precipitationMm: 0 }, daily: [], retrievedAt: now, provider: "google_weather" };
  const collector = createJapanArrivalFactCollector({ maps, weather: { weather: async () => available("google_weather", weather) }, sourceSnapshots: () => store.getWorkspace().sourceSnapshots });
  const prepared = await sourcePreparation.prepareCurrentPlan({ planId, now });
  assert.equal(prepared.status, "ready", JSON.stringify(prepared));
  assert.deepEqual(new Set(requested), new Set([...listJapanPolicySourceIds(), ...listJapanReferenceSourceIds()]));
  const result = await createJapanCompilationService({ store, factCollector: collector }).compileCurrentPlan({ now });
  assert.equal(result.status, "saved", JSON.stringify(result));
  if (result.status !== "saved") return;
  assert.equal(result.workspace.activePlan.status, "draft");
  assert.ok(result.workspace.activePlan.stages.at(-1)?.tasks.every((task) => task.origin?.countryPackId === "japan"));
  assert.ok(result.workspace.activePlan.stages.at(-1)?.tasks.some((task) => task.reminder?.timeZone === "Asia/Tokyo"));
  assert.ok(result.workspace.activePlan.knownInformation.some((item) => /Edomae sushi.*江戸前寿司/i.test(item)));
  assert.ok(routeRequests.length >= 3);
  assert.ok(routeRequests.every((item) => item.origin === "139.780,35.549" && item.destination === "139.767,35.681"));
  assert.equal(store.listRecentCountryPackSkillRuns().length, 8);
  assert.equal(store.confirmPlan(planId).activePlan.status, "active");
  store.close();
});

test("Japan fact collection rejects China-normalized destination facts", async () => {
  const store = new SqliteWorkspaceStore(":memory:");
  const collector = createJapanArrivalFactCollector({ maps: { geocodeAddress: async () => available("google_maps", { formattedAddress: "Shanghai, China", location: "121,31", province: "Shanghai", city: "Shanghai", country: "China", district: "", level: "city" }), nearbyAccommodation: async () => available("google_maps", []), drivingRoute: async () => { throw new Error("unused"); }, walkingRoute: async () => { throw new Error("unused"); }, reverseGeocode: async () => { throw new Error("unused"); }, transitRoute: async () => { throw new Error("unused"); } }, weather: { weather: async () => { throw new Error("unused"); } }, sourceSnapshots: () => [] });
  await assert.rejects(() => collector.collect({ plan: store.getWorkspace().activePlan, profile: { nationality: "Canada" }, now }), /destination_country_not_japan/);
  store.close();
});
