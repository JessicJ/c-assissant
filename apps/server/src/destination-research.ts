import { OfficialSourceConnector } from "@c-assistant/connectors";
import type { SqliteWorkspaceStore } from "@c-assistant/storage";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import type { ConnectorBundle } from "./connector-bundle.js";
import { createOfficialSourceService, parseOfficialSourceRegistry } from "./official-sources.js";
export type DestinationCatalogId = "china" | "japan";
export type DestinationResolution =
  | { status: "resolved"; catalogId: DestinationCatalogId; normalizedCountry: "CN" | "JP" }
  | { status: "needs_confirmation"; reasonCode: "missing_country" | "unsupported_country" | "ambiguous_country"; message: string };
const aliases: Record<string, { catalogId: DestinationCatalogId; normalizedCountry: "CN" | "JP" }> = {
  cn: { catalogId: "china", normalizedCountry: "CN" }, china: { catalogId: "china", normalizedCountry: "CN" },
  "people's republic of china": { catalogId: "china", normalizedCountry: "CN" }, "peoples republic of china": { catalogId: "china", normalizedCountry: "CN" },
  jp: { catalogId: "japan", normalizedCountry: "JP" }, japan: { catalogId: "japan", normalizedCountry: "JP" }
};
/** Selects reviewed source data only from a provider-normalized country fact. */
export function resolveDestinationCatalog(country: string | undefined): DestinationResolution {
  const normalized = country?.trim().toLowerCase().replaceAll(/\s+/g, " ") ?? "";
  if (!normalized) return { status: "needs_confirmation", reasonCode: "missing_country", message: "Confirm the destination country before checking local sources." };
  if (normalized.includes(",") || normalized.includes("/")) return { status: "needs_confirmation", reasonCode: "ambiguous_country", message: "Choose the destination whose sources should be checked." };
  const match = aliases[normalized];
  return match ? { status: "resolved", ...match } : { status: "needs_confirmation", reasonCode: "unsupported_country", message: "Reviewed local sources are not yet available for this destination. Other travel facts remain usable." };
}
export function createDestinationResearch(dependencies: { store: SqliteWorkspaceStore; getConnectors: () => Pick<ConnectorBundle, "maps" | "googleWeather"> }) {
  const { store, getConnectors } = dependencies;
  const moduleRoot = resolve(dirname(createRequire(import.meta.url).resolve("@c-assistant/travel-support")), "..");
  const sourceService = (country: DestinationCatalogId) => createOfficialSourceService(new OfficialSourceConnector({ sources: parseOfficialSourceRegistry(JSON.parse(readFileSync(resolve(moduleRoot, "data", country, "official-source-registry.json"), "utf8")) as unknown) }), store);
  const officialSources = sourceService("china"), japanOfficialSources = sourceService("japan");
  async function resolvePlanDestination(planId: string): Promise<DestinationResolution> {
    const plan = store.getWorkspace().activePlan;
    if (plan.id !== planId) return { status: "needs_confirmation", reasonCode: "missing_country", message: "The requested Plan is not the current Plan." };
    const destination = await getConnectors().maps.geocodeAddress({ address: plan.location });
    return resolveDestinationCatalog(destination.status === "available" ? destination.data?.country : undefined);
  }
  return { officialSources, japanOfficialSources, resolvePlanDestination };
}
export type DestinationResearch = ReturnType<typeof createDestinationResearch>;
