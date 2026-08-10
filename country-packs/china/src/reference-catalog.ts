import { readFileSync } from "node:fs";

import type { SourceSnapshot } from "@c-assistant/core";

import type {
  DigitalLifeCapability,
  DigitalLifeSetupItemInput,
  LocalFoodGuideFactInput,
  LocalFoodGuideSourceInput
} from "./index.js";

interface DigitalLifeCatalogFile {
  version: string;
  approvedSourceIds: string[];
  items: DigitalLifeSetupItemInput[];
}

interface LocalFoodCatalogCity {
  id: string;
  aliases: string[];
  approvedSourceIds: string[];
  facts: LocalFoodGuideFactInput[];
}

interface LocalFoodCatalogFile {
  version: string;
  cities: LocalFoodCatalogCity[];
}

export interface ChinaReferenceCatalogResult {
  localFood: {
    facts: LocalFoodGuideFactInput[];
    sources: LocalFoodGuideSourceInput[];
    approvedSourceIds: string[];
  };
  digitalLife: {
    requiredCapabilities: DigitalLifeCapability[];
    completedItemIds: string[];
    items: DigitalLifeSetupItemInput[];
    sources: Array<{
      id: string;
      sourceSnapshotId: string;
      authority: string;
      titleOriginal: string;
      url: string;
      retrievedAt: string;
      contentHash: string;
    }>;
    approvedSourceIds: string[];
  };
}

const digitalLifeCatalog = parseDigitalLifeCatalog(JSON.parse(readFileSync(new URL("../sources/digital-life-catalog.json", import.meta.url), "utf8")) as unknown);
const localFoodCatalog = parseLocalFoodCatalog(JSON.parse(readFileSync(new URL("../sources/local-food-catalog.json", import.meta.url), "utf8")) as unknown);
const allCapabilities: DigitalLifeCapability[] = ["mobile_connectivity", "communication", "map_navigation", "local_payments"];

export function listChinaDigitalLifeSourceIds(): string[] {
  return [...digitalLifeCatalog.approvedSourceIds];
}

export function listChinaLocalFoodSourceIds(locationName: string): string[] {
  return [...(matchingLocalFoodCity(locationName)?.approvedSourceIds ?? [])];
}

/** Joins static Country Pack guidance to current immutable source snapshots without passing excerpts. */
export function createChinaReferenceCatalog(input: {
  snapshots: SourceSnapshot[];
  locationName?: string;
  requiredCapabilities?: DigitalLifeCapability[];
  completedItemIds?: string[];
}): ChinaReferenceCatalogResult {
  const requiredCapabilities = input.requiredCapabilities ? [...new Set(input.requiredCapabilities)] : [...allCapabilities];
  if (!requiredCapabilities.every((capability) => allCapabilities.includes(capability))) throw new Error("The China reference catalog received an unsupported digital-life capability.");
  const completedItemIds = [...new Set(input.completedItemIds ?? [])].filter((id) => typeof id === "string" && Boolean(id.trim())).map((id) => id.trim());
  const approvedSourceIds = new Set(digitalLifeCatalog.approvedSourceIds);
  const latestBySource = new Map<string, SourceSnapshot>();
  for (const snapshot of input.snapshots) {
    if (!approvedSourceIds.has(snapshot.sourceId)) continue;
    const current = latestBySource.get(snapshot.sourceId);
    if (!current || Date.parse(snapshot.retrievedAt) > Date.parse(current.retrievedAt)) latestBySource.set(snapshot.sourceId, snapshot);
  }
  const sources = [...latestBySource.values()].map((snapshot) => ({
    id: snapshot.sourceId,
    sourceSnapshotId: snapshot.id,
    authority: snapshot.authority,
    titleOriginal: snapshot.titleOriginal,
    url: snapshot.url,
    retrievedAt: snapshot.retrievedAt,
    contentHash: snapshot.contentHash
  }));
  const availableSourceIds = new Set(sources.map((source) => source.id));
  const items = digitalLifeCatalog.items.filter((item) => requiredCapabilities.includes(item.category) && availableSourceIds.has(item.sourceId)).map((item) => structuredClone(item));
  return {
    localFood: createLocalFoodReference(input.snapshots, input.locationName),
    digitalLife: {
      requiredCapabilities,
      completedItemIds,
      items,
      sources,
      approvedSourceIds: digitalLifeCatalog.approvedSourceIds.filter((id) => availableSourceIds.has(id))
    }
  };
}

export function parseLocalFoodCatalog(value: unknown): LocalFoodCatalogFile {
  if (!isRecord(value) || typeof value.version !== "string" || !/^\d+\.\d+\.\d+$/.test(value.version) || !Array.isArray(value.cities)) {
    throw new Error("The China local-food catalog is malformed.");
  }
  const cityIds = new Set<string>();
  const aliases = new Set<string>();
  const cities = (value.cities as unknown[]).map((city) => {
    if (!isRecord(city) || !nonEmptyString(city.id) || cityIds.has(city.id) || !Array.isArray(city.aliases) || !city.aliases.length || !city.aliases.every(nonEmptyString)
      || !Array.isArray(city.approvedSourceIds) || !city.approvedSourceIds.length || !city.approvedSourceIds.every(nonEmptyString) || !Array.isArray(city.facts)) {
      throw new Error("The China local-food catalog contains an invalid city.");
    }
    const normalizedAliases = city.aliases.map((alias) => alias.trim());
    if (normalizedAliases.some((alias) => aliases.has(alias.toLocaleLowerCase()))) throw new Error("The China local-food catalog contains a duplicate city alias.");
    const approvedSourceIds = [...new Set(city.approvedSourceIds.map((id) => id.trim()))];
    const approved = new Set(approvedSourceIds);
    const factIds = new Set<string>();
    const facts = (city.facts as unknown[]).map((fact) => {
      if (!isRecord(fact) || !nonEmptyString(fact.id) || factIds.has(fact.id) || !nonEmptyString(fact.nameOriginal) || !nonEmptyString(fact.nameEnglish)
        || !nonEmptyString(fact.descriptionEnglish) || !nonEmptyString(fact.sourceId) || !approved.has(fact.sourceId)) {
        throw new Error("The China local-food catalog contains an invalid fact.");
      }
      factIds.add(fact.id);
      return { id: fact.id.trim(), nameOriginal: fact.nameOriginal.trim(), nameEnglish: fact.nameEnglish.trim(), descriptionEnglish: fact.descriptionEnglish.trim(), sourceId: fact.sourceId.trim() };
    });
    cityIds.add(city.id);
    normalizedAliases.forEach((alias) => aliases.add(alias.toLocaleLowerCase()));
    return { id: city.id.trim(), aliases: normalizedAliases, approvedSourceIds, facts };
  });
  return { version: value.version, cities };
}

function createLocalFoodReference(snapshots: SourceSnapshot[], locationName?: string): ChinaReferenceCatalogResult["localFood"] {
  const city = matchingLocalFoodCity(locationName);
  if (!city) return { facts: [], sources: [], approvedSourceIds: [] };
  const approved = new Set(city.approvedSourceIds);
  const latestBySource = new Map<string, SourceSnapshot>();
  for (const snapshot of snapshots) {
    if (!approved.has(snapshot.sourceId)) continue;
    const current = latestBySource.get(snapshot.sourceId);
    if (!current || Date.parse(snapshot.retrievedAt) > Date.parse(current.retrievedAt)) latestBySource.set(snapshot.sourceId, snapshot);
  }
  const sources = [...latestBySource.values()].map((snapshot) => ({
    id: snapshot.sourceId,
    sourceSnapshotId: snapshot.id,
    authority: snapshot.authority,
    titleOriginal: snapshot.titleOriginal,
    url: snapshot.url,
    retrievedAt: snapshot.retrievedAt,
    contentHash: snapshot.contentHash
  }));
  const available = new Set(sources.map((source) => source.id));
  return {
    facts: city.facts.filter((fact) => available.has(fact.sourceId)).map((fact) => structuredClone(fact)),
    sources,
    approvedSourceIds: city.approvedSourceIds.filter((id) => available.has(id))
  };
}

function matchingLocalFoodCity(locationName?: string): LocalFoodCatalogCity | undefined {
  const normalized = locationName?.trim().toLocaleLowerCase();
  if (!normalized) return undefined;
  return localFoodCatalog.cities.find((city) => city.aliases.some((alias) => {
    const candidate = alias.toLocaleLowerCase();
    if (/^[\p{L}\p{N}]+$/u.test(candidate) && /^[\x00-\x7F]+$/.test(candidate)) return new RegExp(`(^|[^a-z0-9])${escapeRegex(candidate)}([^a-z0-9]|$)`, "i").test(normalized);
    return normalized.includes(candidate);
  }));
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function parseDigitalLifeCatalog(value: unknown): DigitalLifeCatalogFile {
  if (!isRecord(value) || typeof value.version !== "string" || !/^\d+\.\d+\.\d+$/.test(value.version)
    || !Array.isArray(value.approvedSourceIds) || !value.approvedSourceIds.every(nonEmptyString)
    || !Array.isArray(value.items)) throw new Error("The China digital-life catalog is malformed.");
  const approved = new Set(value.approvedSourceIds as string[]);
  const itemIds = new Set<string>();
  const capabilities: DigitalLifeCapability[] = ["mobile_connectivity", "communication", "map_navigation", "local_payments"];
  const items = (value.items as unknown[]).map((item) => {
    if (!isRecord(item) || !nonEmptyString(item.id) || itemIds.has(item.id) || !nonEmptyString(item.nameOriginal) || !nonEmptyString(item.nameEnglish)
      || typeof item.category !== "string" || !capabilities.includes(item.category as DigitalLifeCapability)
      || !nonEmptyString(item.reasonEnglish) || !Array.isArray(item.stepsEnglish) || item.stepsEnglish.length < 1 || item.stepsEnglish.length > 8
      || !item.stepsEnglish.every(nonEmptyString) || !nonEmptyString(item.sourceId) || !approved.has(item.sourceId)) {
      throw new Error("The China digital-life catalog contains an invalid item.");
    }
    itemIds.add(item.id);
    return {
      id: item.id.trim(),
      nameOriginal: item.nameOriginal.trim(),
      nameEnglish: item.nameEnglish.trim(),
      category: item.category as DigitalLifeCapability,
      reasonEnglish: item.reasonEnglish.trim(),
      stepsEnglish: item.stepsEnglish.map((step) => step.trim()),
      sourceId: item.sourceId.trim()
    };
  });
  return { version: value.version, approvedSourceIds: [...approved], items };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && Boolean(value.trim());
}
