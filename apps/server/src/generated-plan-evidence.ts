import type { ConnectorResult, GeocodedPlaceFact, WeatherSnapshot } from "@c-assistant/connectors";
import type { Plan, WorkspaceSnapshot } from "@c-assistant/core";
import type { SqliteWorkspaceStore } from "@c-assistant/storage";
import type { CountryPackResolution } from "./country-pack-resolver.js";
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

interface GeneratedPlanEvidenceSourcePreparation {
  prepareCurrentPlan(input: { planId: string; now?: string }): Promise<{ status: "ready" | "blocked" }>;
}

export function createGeneratedPlanEvidencePreparer(dependencies: {
  store: SqliteWorkspaceStore;
  getMaps: () => GeneratedPlanEvidenceMaps;
  getWeather: () => GeneratedPlanEvidenceWeather;
  resolvePlanCountryPack: (planId: string) => Promise<CountryPackResolution>;
  sourcePreparation: {
    china: GeneratedPlanEvidenceSourcePreparation;
    japan: GeneratedPlanEvidenceSourcePreparation;
  };
}) {
  const { store, getMaps, getWeather, resolvePlanCountryPack, sourcePreparation } = dependencies;

  return async function prepareGeneratedPlanEvidence(planId: string): Promise<{ workspace: WorkspaceSnapshot; status: "verified" | "partial" }> {
    let sourcesVerified = false;
    try {
      const resolution = await resolvePlanCountryPack(planId);
      if (resolution.status === "resolved") {
        const result = resolution.countryPackId === "japan"
          ? await sourcePreparation.japan.prepareCurrentPlan({ planId })
          : await sourcePreparation.china.prepareCurrentPlan({ planId });
        sourcesVerified = result.status === "ready";
      }
    } catch { /* Route enrichment can still proceed when destination evidence is partial. */ }
    let routesVerified = true;
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
        const savedRoutes = routeResult.refreshed.length
          ? store.saveGeneratedPlanRouteRefresh({ planId, expectedVersion: plan.version, provider: "google_maps", routes: routeResult.refreshed })
          : undefined;
        routesVerified = routeResult.failedSegmentIds.length === 0
          && routeResult.refreshed.length === eligibleRoutes.length
          && !savedRoutes?.scheduleConflictDayIds.length;
      } else if (eligibleRoutes.length) {
        routesVerified = false;
      }
    } catch {
      routesVerified = false;
    }
    return { workspace: store.getWorkspace(), status: sourcesVerified && routesVerified ? "verified" : "partial" };
  };
}

function routeRefreshEligibleSegments(plan: Plan, planId: string) {
  return plan.id === planId && plan.presentation?.kind === "itinerary"
    ? plan.presentation.routeSegments.filter((segment) => segment.mode === "driving" || segment.mode === "walking" || segment.mode === "transit")
    : [];
}
