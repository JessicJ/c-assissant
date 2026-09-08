import assert from "node:assert/strict";
import test from "node:test";
import type { BlueprintMapPointDisplay, BlueprintRouteSegmentDisplay, ItineraryRouteRefreshDisplay } from "./landi-blueprint-workspace-display.js";
import { fallbackRouteLineState, routeLineRenderState, routeLinesForMap } from "./blueprint-map-route-lines.js";

const places: BlueprintMapPointDisplay[] = [
  { id: "a", placeId: "a", title: "A", coordinates: [35.68, 139.76] },
  { id: "b", placeId: "b", title: "B", coordinates: [35.69, 139.77] },
  { id: "c", placeId: "c", title: "C", coordinates: [35.7, 139.78] }
];

function segment(id: string, originPlaceId: string, destinationPlaceId: string, mapLineState: BlueprintRouteSegmentDisplay["mapLineState"]): BlueprintRouteSegmentDisplay {
  return {
    id,
    originPlaceId,
    destinationPlaceId,
    label: "Walk",
    verification: mapLineState === "formal" ? "verified" : "needs_verification",
    needsRefresh: mapLineState === "needs_refresh",
    mapLineState,
    sources: []
  };
}

test("map route lines keep per-leg formal and route-check states", () => {
  assert.deepEqual(routeLinesForMap(places, [
    segment("route-1", "a", "b", "formal"),
    segment("route-2", "b", "c", "needs_refresh")
  ]).map((line) => [line.id, line.mapLineState, line.points.map((point) => point.placeId)]), [
    ["route-1", "formal", ["a", "b"]],
    ["route-2", "needs_refresh", ["b", "c"]]
  ]);
});

test("map route line render state shows checking only for pending travel checks", () => {
  assert.equal(routeLineRenderState("needs_refresh", true), "checking");
  assert.equal(routeLineRenderState("needs_refresh", false), "needs_refresh");
  assert.equal(routeLineRenderState("formal", true), "formal");
  assert.equal(routeLineRenderState("reference", true), "reference");
});

test("map fallback line is only used for old itinerary data with no route state", () => {
  assert.equal(fallbackRouteLineState([], undefined), "formal");
  assert.equal(fallbackRouteLineState([segment("route-1", "a", "b", "formal")], undefined), undefined);
  assert.equal(fallbackRouteLineState([segment("route-1", "a", "b", "needs_refresh")], undefined), undefined);
  assert.equal(fallbackRouteLineState([], {
    segmentCount: 1,
    segmentIds: [],
    dayLabel: "10/04",
    summary: "Routes will be checked after you confirm.",
    request: "Check routes.",
    actionable: false
  } satisfies ItineraryRouteRefreshDisplay), undefined);
});

test("map fallback does not replace route segments that cannot currently draw", () => {
  const { coordinates: _coordinates, ...placeWithoutCoordinates } = places[1]!;
  const lines = routeLinesForMap([places[0]!, placeWithoutCoordinates], [segment("route-1", "a", "b", "needs_refresh")]);

  assert.deepEqual(lines, []);
  assert.equal(fallbackRouteLineState([segment("route-1", "a", "b", "needs_refresh")], undefined), undefined);
});
