import { readFileSync } from "node:fs";

import type { SourceSnapshot } from "@c-assistant/core";

import type {
  DigitalLifeCapability,
  DigitalLifeSetupItemInput
} from "./index.js";

interface DigitalLifeCatalogFile {
  version: string;
  approvedSourceIds: string[];
  items: DigitalLifeSetupItemInput[];
}

export interface ChinaReferenceCatalogResult {
  localFood: { facts: []; sources: []; approvedSourceIds: [] };
  digitalLife: {
    requiredCapabilities: DigitalLifeCapability[];
    completedItemIds: string[];
    items: DigitalLifeSetupItemInput[];
    sources: Array<{
      id: string;
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
const allCapabilities: DigitalLifeCapability[] = ["mobile_connectivity", "communication", "map_navigation", "local_payments"];

/** Joins static Country Pack guidance to current immutable source snapshots without passing excerpts. */
export function createChinaReferenceCatalog(input: {
  snapshots: SourceSnapshot[];
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
    authority: snapshot.authority,
    titleOriginal: snapshot.titleOriginal,
    url: snapshot.url,
    retrievedAt: snapshot.retrievedAt,
    contentHash: snapshot.contentHash
  }));
  const availableSourceIds = new Set(sources.map((source) => source.id));
  const items = digitalLifeCatalog.items.filter((item) => requiredCapabilities.includes(item.category) && availableSourceIds.has(item.sourceId)).map((item) => structuredClone(item));
  return {
    localFood: { facts: [], sources: [], approvedSourceIds: [] },
    digitalLife: {
      requiredCapabilities,
      completedItemIds,
      items,
      sources,
      approvedSourceIds: digitalLifeCatalog.approvedSourceIds.filter((id) => availableSourceIds.has(id))
    }
  };
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
