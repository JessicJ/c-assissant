import { readFileSync } from "node:fs";
import type { SourceSnapshot } from "@c-assistant/core";
import type { JapanEvidenceInput, JapanFoodFact, JapanReferenceItem } from "./index.js";

interface Catalog { version: string; items: JapanReferenceItem[]; food: { city: string; aliases: string[]; sourceId: string; facts: Array<Omit<JapanFoodFact, "sourceId">> } }
const catalog = parseJapanReferenceCatalog(JSON.parse(readFileSync(new URL("../sources/reference-catalog.json", import.meta.url), "utf8")) as unknown);

export function listJapanReferenceSourceIds(): string[] { return [...new Set([...catalog.items.map((item) => item.sourceId), catalog.food.sourceId])]; }
export function listJapanPolicySourceIds(): string[] { return ["jp-mofa-visa-exemption", "jp-mofa-visa-faq"]; }

export function createJapanReferenceCatalog(input: { snapshots: SourceSnapshot[]; locationName: string }): { items: JapanReferenceItem[]; foodFacts: JapanFoodFact[]; sources: JapanEvidenceInput[] } {
  const allowed = new Set(listJapanReferenceSourceIds());
  const latest = new Map<string, SourceSnapshot>();
  for (const snapshot of input.snapshots) {
    if (!allowed.has(snapshot.sourceId)) continue;
    const current = latest.get(snapshot.sourceId);
    if (!current || Date.parse(snapshot.retrievedAt) > Date.parse(current.retrievedAt)) latest.set(snapshot.sourceId, snapshot);
  }
  const sources = [...latest.values()].map((item) => ({ id: item.id, sourceId: item.sourceId, authority: item.authority, titleOriginal: item.titleOriginal, url: item.url, retrievedAt: item.retrievedAt, contentHash: item.contentHash }));
  const available = new Set(sources.map((item) => item.sourceId));
  const locationMatches = catalog.food.aliases.some((alias) => input.locationName.toLowerCase().includes(alias.toLowerCase()));
  return {
    items: catalog.items.filter((item) => available.has(item.sourceId)).map((item) => structuredClone(item)),
    foodFacts: locationMatches && available.has(catalog.food.sourceId) ? catalog.food.facts.map((item) => ({ ...structuredClone(item), sourceId: catalog.food.sourceId })) : [],
    sources
  };
}

export function parseJapanReferenceCatalog(value: unknown): Catalog {
  if (!record(value) || typeof value.version !== "string" || !/^\d+\.\d+\.\d+$/.test(value.version) || !Array.isArray(value.items) || !record(value.food)) throw new Error("The Japan reference catalog is malformed.");
  const items = value.items as JapanReferenceItem[];
  const food = value.food as unknown as Catalog["food"];
  if (!items.every((item) => record(item) && strings(item.id, item.capability, item.nameOriginal, item.nameEnglish, item.explanationEnglish, item.sourceId) && item.sourceId.startsWith("jp-"))
    || !strings(food.city, food.sourceId) || !Array.isArray(food.aliases) || !food.aliases.every((item) => typeof item === "string" && item.trim()) || !Array.isArray(food.facts)
    || !food.facts.every((item) => record(item) && strings(item.id, item.nameOriginal, item.nameEnglish, item.explanationEnglish))) throw new Error("The Japan reference catalog contains an invalid item.");
  if (new Set(items.map((item) => item.id)).size !== items.length) throw new Error("The Japan reference catalog contains duplicate item IDs.");
  return structuredClone(value) as Catalog;
}
function record(value: unknown): value is Record<string, any> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function strings(...values: unknown[]): boolean { return values.every((value) => typeof value === "string" && Boolean(value.trim())); }
