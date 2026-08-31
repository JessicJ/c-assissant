import assert from "node:assert/strict";
import test from "node:test";
import { createJapanReferenceCatalog, listJapanReferenceSourceIds } from "./reference-catalog.js";

const snapshot = (sourceId: string) => ({ id: `snapshot-${sourceId}`, sourceId, authority: "Official Japan authority", titleOriginal: sourceId, url: "https://www.japan.travel/en/", retrievedAt: "2026-08-23T00:00:00.000Z", contentHash: "a".repeat(64), excerpt: "not passed to skills" });

test("Japan catalog joins only Japan snapshots and keeps Tokyo food separate from China", () => {
  const result = createJapanReferenceCatalog({ snapshots: [...listJapanReferenceSourceIds().map(snapshot), snapshot("china-working-living-guide-2025")], locationName: "Tokyo, Japan" });
  assert.equal(result.items.length, 5);
  assert.equal(result.foodFacts.length, 5);
  assert.ok(result.sources.every((item) => item.sourceId.startsWith("jp-") && !("excerpt" in item)));
  assert.ok(result.foodFacts.some((item) => item.nameOriginal === "江戸前寿司"));
});

test("catalog files alone never satisfy freshness or availability", () => {
  const result = createJapanReferenceCatalog({ snapshots: [], locationName: "Tokyo" });
  assert.deepEqual(result.items, []);
  assert.deepEqual(result.foodFacts, []);
});
