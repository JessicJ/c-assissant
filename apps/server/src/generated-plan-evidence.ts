import type { ConnectorResult, GeocodedPlaceFact, WeatherSnapshot } from "@c-assistant/connectors";
import type { Plan, WorkspaceSnapshot } from "@c-assistant/core";
import type { SqliteWorkspaceStore } from "@c-assistant/storage";
import { resolvePlanArrivalTimeZone } from "./plan-arrival-timezone.js";
import { refreshGeneratedPlanRoutes } from "./plan-route-refresh.js";

interface GeneratedPlanEvidenceMaps {
  configurationStatus(): { status: string };
  geocodeAddress(input: { address: string }): Promise<ConnectorResult<GeocodedPlaceFact>>;
  drivingRoute(input: Parameters<typeof refreshGeneratedPlanRoutes>[1]["drivingRoute"] extends (input: infer Input) => unknown ? Input : never): ReturnType<Parameters<typeof refreshGeneratedPlanRoutes>[1]["drivingRoute"]>;
  walkingRoute(input: Parameters<typeof refreshGeneratedPlanRoutes>[1]["walkingRoute"] extends (input: infer Input) => unknown ? Input : never): ReturnType<Parameters<typeof refreshGeneratedPlanRoutes>[1]["walkingRoute"]>;
  transitRoute(input: Parameters<typeof refreshGeneratedPlanRoutes>[1]["transitRoute"] extends (input: infer Input) => unknown ? Input : never): ReturnType<Parameters<typeof refreshGeneratedPlanRoutes>[1]["transitRoute"]>;
}

interface GeneratedPlanEvidenceWeather {
  weather(input: { coordinates: string; locationName: string; adminArea?: string; country?: string; language?: "en" | "zh" }): Promise<ConnectorResult<WeatherSnapshot>>;
}

export function createGeneratedPlanEvidencePreparer(dependencies: {
  store: SqliteWorkspaceStore;
  getMaps: () => GeneratedPlanEvidenceMaps;
  getWeather: () => GeneratedPlanEvidenceWeather;
}) {
  const { store, getMaps, getWeather } = dependencies;

  return async function prepareGeneratedPlanEvidence(planId: string): Promise<{ workspace: WorkspaceSnapshot; status: "verified" | "partial" }> {
    try {
      const workspace = store.getWorkspace();
      const maps = getMaps();
      const timeZone = await resolvePlanArrivalTimeZone(workspace.activePlan, { geocodeAddress: (input) => maps.geocodeAddress(input), weather: (input) => getWeather().weather(input) });
      if (timeZone) store.saveGeneratedPlanArrivalTimeZone({ planId, expectedVersion: workspace.activePlan.version, timeZone });
    } catch { /* An unresolved timezone safely leaves arrival reminders disabled. */ }
    try {
      const workspace = store.getWorkspace();
      const maps = getMaps();
      const plan = workspace.activePlan;
      const eligibleRoutes = routeRefreshEligibleSegments(plan, planId);
      if (eligibleRoutes.length && maps.configurationStatus().status === "available") {
        const routeResult = await refreshGeneratedPlanRoutes(plan, {
          geocodeAddress: (input) => maps.geocodeAddress(input),
          drivingRoute: (input) => maps.drivingRoute(input),
          walkingRoute: (input) => maps.walkingRoute(input),
          transitRoute: (input) => maps.transitRoute(input)
        });
        if (routeResult.refreshed.length) store.saveGeneratedPlanRouteRefresh({ planId, expectedVersion: plan.version, provider: "google_maps", routes: routeResult.refreshed });
      }
    } catch {
      // Keep the saved draft reviewable when route enrichment fails.
    }
    // Map and timezone enrichment does not verify policy or all destination facts.
    return { workspace: store.getWorkspace(), status: "partial" };
  };
}

function routeRefreshEligibleSegments(plan: Plan, planId: string) {
  return plan.id === planId && plan.presentation?.kind === "itinerary"
    ? plan.presentation.routeSegments.filter((segment) => segment.mode === "driving" || segment.mode === "walking" || segment.mode === "transit")
    : [];
}
