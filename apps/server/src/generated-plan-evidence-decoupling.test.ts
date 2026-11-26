import assert from "node:assert/strict";
import test from "node:test";
import type { WorkspaceSnapshot } from "@c-assistant/core";
import { createGeneratedPlanEvidencePreparer } from "./generated-plan-evidence.js";

type Dependencies = Parameters<typeof createGeneratedPlanEvidencePreparer>[0];

function fixture(city: string, mode: "driving" | "walking" | "transit", offline = false) {
  const workspace = {
    activePlan: {
      id: "fictional-draft", version: 7, location: city,
      configuration: { arrival: { expectedAtLocal: "2026-11-10T10:00" } },
      sources: [{ sourceSnapshotId: "historical-evidence", contentHash: "preserved" }],
      presentation: {
        kind: "itinerary", days: [{ date: "2026-11-10", city }],
        places: [
          { id: "origin", name: "Fictional origin", locationLabel: city, category: "accommodation" },
          { id: "destination", name: "Fictional destination", locationLabel: city, category: "attraction" }
        ],
        routeSegments: [{ id: "route", originPlaceId: "origin", destinationPlaceId: "destination", mode }]
      }
    },
    sourceSnapshots: [{ id: "historical-evidence", contentHash: "preserved" }]
  };
  const calls: string[] = [];
  const legacyReads: string[] = [];
  const writes: Array<Record<string, unknown>> = [];
  const available = (data: unknown) => ({ status: "available", provider: "google_maps", observedAt: "2026-11-01T00:00:00Z", data });
  const route = async (kind: string) => {
    calls.push(kind);
    if (offline) throw new Error("Fictional provider unavailable");
    return available({ distanceMeters: 1000, durationSeconds: 600 });
  };
  const dependencies = {
    store: {
      getWorkspace: () => workspace,
      saveGeneratedPlanArrivalTimeZone: (input: Record<string, unknown>) => {
        assert.equal(input.expectedVersion, workspace.activePlan.version);
        writes.push(input);
        Object.assign(workspace.activePlan.configuration.arrival, { timeZone: input.timeZone });
        workspace.activePlan.version++;
      },
      saveGeneratedPlanRouteRefresh: (input: Record<string, unknown>) => {
        assert.equal(input.expectedVersion, workspace.activePlan.version);
        writes.push(input);
        workspace.activePlan.version++;
        return { scheduleConflictDayIds: [] };
      }
    },
    getMaps: () => ({
      configurationStatus: () => ({ status: "available" }),
      geocodeAddress: async ({ address }: { address: string }) => {
        calls.push(`geocode:${address}`);
        if (offline) throw new Error("Fictional provider unavailable");
        return available({ location: address.startsWith("Fictional destination") ? "2,2" : "1,1", formattedAddress: address });
      },
      drivingRoute: () => route("driving"),
      walkingRoute: () => route("walking"),
      transitRoute: () => route("transit")
    }),
    getWeather: () => ({ weather: async () => {
      calls.push("weather");
      return available({ location: { timezone: "Etc/UTC" } });
    } })
  };
  // Legacy services must never be read, even if an older caller supplies them.
  for (const key of ["resolvePlanDestination", "sourcePreparation"]) {
    Object.defineProperty(dependencies, key, { get() { legacyReads.push(key); throw new Error(`Legacy dependency accessed: ${key}`); } });
  }
  return { workspace, calls, legacyReads, writes, prepare: createGeneratedPlanEvidencePreparer(dependencies as unknown as Dependencies) };
}

for (const [city, mode] of [["Beijing", "driving"], ["Tokyo", "walking"], ["Lisbon", "transit"]] as const) {
  test(`${city}: generic enrichment survives without country services and remains partially verified`, async () => {
    const state = fixture(city, mode);
    const historical = structuredClone({ sources: state.workspace.activePlan.sources, snapshots: state.workspace.sourceSnapshots });
    const result = await state.prepare("fictional-draft");
    assert.equal(result.status, "partial");
    assert.deepEqual(state.legacyReads, []);
    assert.equal(result.workspace, state.workspace as unknown as WorkspaceSnapshot);
    assert.ok(state.calls.includes(`geocode:${city}`));
    assert.ok(state.calls.includes("weather"));
    assert.ok(state.calls.includes(mode));
    assert.equal(state.writes.length, 2);
    assert.equal(state.writes[0]!.timeZone, "Etc/UTC");
    assert.equal(state.writes[1]!.expectedVersion, 8);
    assert.equal(state.writes[1]!.provider, "google_maps");
    assert.deepEqual((state.writes[1]!.routes as Array<{ segmentId: string }>).map((route) => route.segmentId), ["route"]);
    assert.deepEqual({ sources: state.workspace.activePlan.sources, snapshots: state.workspace.sourceSnapshots }, historical);
  });
}

test("provider failures preserve the draft and historical evidence without claiming verification", async () => {
  const state = fixture("Tokyo", "walking", true);
  const before = structuredClone(state.workspace);
  const result = await state.prepare("fictional-draft");
  assert.equal(result.status, "partial");
  assert.deepEqual(state.legacyReads, []);
  assert.deepEqual(state.writes, []);
  assert.deepEqual(state.workspace, before);
});
