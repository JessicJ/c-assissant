import assert from "node:assert/strict";
import test from "node:test";
import { createPlanFromDraft } from "@c-assistant/core";
import type { ConnectorResult, GeocodedPlaceFact, RouteFact } from "@c-assistant/connectors";
import { PlanRouteRefreshError, refreshGeneratedPlanRoutes, refreshPlanRouteFacts, type PlanRouteMaps } from "./plan-route-refresh.js";

const plan = createPlanFromDraft({
  title: "Lisbon route", location: "Lisbon", dates: "October 2026", knownInformation: [], assumptions: [], nextAction: "Refresh.",
  presentation: { kind: "itinerary", summary: "Arrival route.", days: [{ id: "day-1", label: "Day 1", placeIds: ["airport", "hotel"] }], places: [
    { id: "airport", name: "Lisbon Airport", locationLabel: "Lisbon", category: "transport", priority: "must", whyWorthIt: "Arrival.", plan: "Continue.", detailSections: [], sourceRefs: [] },
    { id: "hotel", name: "Hotel", locationLabel: "Baixa, Lisbon", category: "accommodation", priority: "booked", whyWorthIt: "Base.", plan: "Check in.", detailSections: [], sourceRefs: [] }
  ], routeSegments: [{ id: "route-1", originPlaceId: "airport", destinationPlaceId: "hotel", mode: "transit", verification: "needs_verification", sourceRefs: [] }] },
  stages: [{ title: "Itinerary", description: "Arrival.", presentationKind: "itinerary", tasks: [{ title: "Reach hotel", owner: "user", dueLabel: "Day 1" }] }]
});

function available<T>(data: T): ConnectorResult<T> { return { status: "available", provider: "google_maps", observedAt: "2026-08-17T10:00:00.000Z", data }; }

test("route refresh resolves exact Plan places before requesting one route", async () => {
  const geocodeQueries: string[] = [];
  const routeCalls: Array<{ origin: string; destination: string }> = [];
  const maps: PlanRouteMaps = {
    geocodeAddress: async ({ address }) => { geocodeQueries.push(address); return available<GeocodedPlaceFact>({ provider: "google_maps", formattedAddress: address, location: address.startsWith("Lisbon Airport") ? "-9.135,38.774" : "-9.142,38.711", province: "", city: "Lisbon", district: "", level: "place" }); },
    drivingRoute: async () => { throw new Error("wrong mode"); },
    walkingRoute: async () => { throw new Error("wrong mode"); },
    transitRoute: async (input) => { routeCalls.push(input); return available<RouteFact>({ provider: "google_maps", mode: "transit", origin: input.origin, destination: input.destination, distanceMeters: 8_400, durationSeconds: 1_620, geometry: [[-9.135, 38.774], [-9.142, 38.711]], strategy: "public_transit_recommended" }); }
  };
  const result = await refreshPlanRouteFacts(plan, "route-1", maps);
  assert.deepEqual(geocodeQueries, ["Lisbon Airport, Lisbon", "Hotel, Baixa, Lisbon"]);
  assert.deepEqual(routeCalls, [{ origin: "-9.135,38.774", destination: "-9.142,38.711" }]);
  assert.deepEqual(result, { segmentId: "route-1", observedAt: "2026-08-17T10:00:00.000Z", distanceMeters: 8_400, durationSeconds: 1_620, originCoordinates: [-9.135, 38.774], destinationCoordinates: [-9.142, 38.711], geometry: [[-9.135, 38.774], [-9.142, 38.711]] });
});

test("generated route enrichment keeps successful facts when another segment fails", async () => {
  const twoRoutes = structuredClone(plan);
  twoRoutes.presentation!.routeSegments.push({ id: "route-missing", originPlaceId: "airport", destinationPlaceId: "hotel", mode: "walking", verification: "needs_verification", sourceRefs: [] });
  const maps: PlanRouteMaps = {
    geocodeAddress: async ({ address }) => available<GeocodedPlaceFact>({ provider: "google_maps", formattedAddress: address, location: address.startsWith("Lisbon Airport") ? "-9.135,38.774" : "-9.142,38.711", province: "", city: "Lisbon", district: "", level: "place" }),
    drivingRoute: async () => { throw new Error("unused"); },
    transitRoute: async (input) => available<RouteFact>({ provider: "google_maps", mode: "transit", origin: input.origin, destination: input.destination, distanceMeters: 8_400, durationSeconds: 1_620, strategy: "public_transit_recommended" }),
    walkingRoute: async () => ({ status: "unavailable", provider: "google_maps", observedAt: "2026-08-17T10:00:00.000Z", failure: { code: "network", message: "offline", retryable: true } })
  };
  const result = await refreshGeneratedPlanRoutes(twoRoutes, maps, 2);
  assert.deepEqual(result.refreshed.map((route) => route.segmentId), ["route-1"]);
  assert.deepEqual(result.failedSegmentIds, ["route-missing"]);
});

test("route refresh fails without mutation-ready facts", async () => {
  const unavailable: ConnectorResult<GeocodedPlaceFact> = { status: "not_configured", provider: "google_maps", observedAt: "2026-08-17T10:00:00.000Z", failure: { code: "not_configured", message: "missing", retryable: false } };
  const maps = { geocodeAddress: async () => unavailable, drivingRoute: async () => { throw new Error("unused"); }, walkingRoute: async () => { throw new Error("unused"); }, transitRoute: async () => { throw new Error("unused"); } } as PlanRouteMaps;
  await assert.rejects(refreshPlanRouteFacts(plan, "route-1", maps), (error: unknown) => error instanceof PlanRouteRefreshError && error.code === "origin_unavailable" && error.connectorStatus === "not_configured");
  const unsupported = structuredClone(plan);
  unsupported.presentation!.routeSegments[0]!.mode = "rail";
  await assert.rejects(refreshPlanRouteFacts(unsupported, "route-1", maps), (error: unknown) => error instanceof PlanRouteRefreshError && error.code === "unsupported_mode");
});
