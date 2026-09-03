import { OfficialSourceConnector } from "@c-assistant/connectors";
import { createChinaReferenceCatalog } from "@c-assistant/china-country-pack/reference-catalog";
import type { SqliteWorkspaceStore } from "@c-assistant/storage";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createChinaArrivalFactCollector } from "./china-arrival-facts.js";
import { createChinaArrivalCompilationService } from "./china-plan-compilation.js";
import { createChinaPlanWorkflow } from "./china-plan-workflow.js";
import { createChinaSourcePreparationService } from "./china-source-preparation.js";
import { createJapanArrivalFactCollector } from "./japan-arrival-facts.js";
import { createJapanCompilationService } from "./japan-plan-compilation.js";
import { createJapanSourcePreparationService } from "./japan-source-preparation.js";
import type { ConnectorBundle } from "./connector-bundle.js";
import type { CountryPackServices } from "./country-pack-service-contract.js";
import { resolveCountryPack } from "./country-pack-resolver.js";
import { createOfficialSourceService, parseOfficialSourceRegistry } from "./official-sources.js";

export function createCountryPackServices(dependencies: {
  projectRoot: string;
  store: SqliteWorkspaceStore;
  getConnectors: () => Pick<ConnectorBundle, "maps" | "googleWeather">;
}): CountryPackServices {
  const { projectRoot, store, getConnectors } = dependencies;
  const officialSourceRegistryPath = resolve(projectRoot, "country-packs", "china", "sources", "official-source-registry.json");
  const japanOfficialSourceRegistryPath = resolve(projectRoot, "country-packs", "japan", "sources", "official-source-registry.json");
  const officialSources = createOfficialSourceService(new OfficialSourceConnector({ sources: parseOfficialSourceRegistry(JSON.parse(readFileSync(officialSourceRegistryPath, "utf8")) as unknown) }), store);
  const japanOfficialSources = createOfficialSourceService(new OfficialSourceConnector({ sources: parseOfficialSourceRegistry(JSON.parse(readFileSync(japanOfficialSourceRegistryPath, "utf8")) as unknown) }), store);
  const chinaFactCollector = createChinaArrivalFactCollector({
    maps: {
      geocodeAddress: (input) => getConnectors().maps.geocodeAddress(input),
      nearbyAccommodation: (input) => getConnectors().maps.nearbyAccommodation(input),
      drivingRoute: (input) => getConnectors().maps.drivingRoute(input),
      walkingRoute: (input) => getConnectors().maps.walkingRoute(input),
      reverseGeocode: (input) => getConnectors().maps.reverseGeocode(input),
      transitRoute: (input) => getConnectors().maps.transitRoute(input)
    },
    weather: { weather: (input) => getConnectors().googleWeather.weather(input) },
    sourceSnapshots: () => store.getWorkspace().sourceSnapshots,
    referenceCatalog: (locationName) => createChinaReferenceCatalog({ snapshots: store.getWorkspace().sourceSnapshots, locationName })
  });
  const chinaCompilation = createChinaArrivalCompilationService({ store, factCollector: chinaFactCollector });
  const chinaSourcePreparation = createChinaSourcePreparationService({ store, refresher: { refresh: (input) => officialSources.refresh(input) } });
  const chinaPlanWorkflow = createChinaPlanWorkflow({ sourcePreparation: chinaSourcePreparation, compilation: chinaCompilation });
  const japanFactCollector = createJapanArrivalFactCollector({
    maps: {
      geocodeAddress: (input) => getConnectors().maps.geocodeAddress(input),
      nearbyAccommodation: (input) => getConnectors().maps.nearbyAccommodation(input),
      drivingRoute: (input) => getConnectors().maps.drivingRoute(input),
      walkingRoute: (input) => getConnectors().maps.walkingRoute(input),
      reverseGeocode: (input) => getConnectors().maps.reverseGeocode(input),
      transitRoute: (input) => getConnectors().maps.transitRoute(input)
    },
    weather: { weather: (input) => getConnectors().googleWeather.weather(input) },
    sourceSnapshots: () => store.getWorkspace().sourceSnapshots
  });
  const japanCompilation = createJapanCompilationService({ store, factCollector: japanFactCollector });
  const japanSourcePreparation = createJapanSourcePreparationService({ store, refresher: { refresh: (input) => japanOfficialSources.refresh(input) } });

  async function resolvePlanCountryPack(planId: string) {
    const plan = store.getWorkspace().activePlan;
    if (plan.id !== planId) return { status: "needs_confirmation" as const, reasonCode: "missing_country" as const, message: "The requested Plan is not the current Plan." };
    const destination = await getConnectors().maps.geocodeAddress({ address: plan.location });
    if (destination.status !== "available" || !destination.data?.country) return resolveCountryPack(undefined);
    return resolveCountryPack(destination.data.country);
  }

  async function prepareJapanPlan(planId: string) {
    const sources = await japanSourcePreparation.prepareCurrentPlan({ planId });
    if (sources.status === "blocked") return { status: "blocked" as const, stage: "source_preparation" as const, reasonCode: sources.reasonCode, message: sources.message, sources: sources.sources };
    const compilation = await japanCompilation.compileCurrentPlan();
    if (compilation.status === "blocked") return { status: "blocked" as const, stage: "compilation" as const, reasonCode: compilation.reasonCode, message: compilation.message, sources: sources.sources };
    return { status: "saved" as const, message: "The Japan Pack prepared a new complete draft. Review every Task, Reminder, limitation, and source before confirming it.", workspace: compilation.workspace, taskCount: compilation.taskCount, reminderCount: compilation.reminderCount, sources: sources.sources };
  }

  return {
    officialSources,
    japanOfficialSources,
    chinaPlanWorkflow,
    chinaSourcePreparation,
    japanSourcePreparation,
    resolvePlanCountryPack,
    prepareJapanPlan
  };
}
