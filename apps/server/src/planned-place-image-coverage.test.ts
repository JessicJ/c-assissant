import assert from "node:assert/strict";
import test from "node:test";
import { LANDI_BLUEPRINT_SKILL, type SkillImageEnrichmentArtifact } from "@c-assistant/agent-adapters";
import { importSkillItinerary, importSkillResearchBatches, type SkillItineraryArtifact, type SkillResearchBatchArtifact } from "@c-assistant/core";
import { auditPlannedPlaceImageCoverage, itinerarySemanticSnapshot, mergePlannedPlaceImageEnrichment, missingPlannedPlaceImages, plannedConcretePlaceIds } from "./planned-place-image-coverage.js";

const now = "2026-09-23T00:00:00.000Z";

function fixture() {
  const batch: SkillResearchBatchArtifact = {
    id: "scope-1", scopeLabel: "Ubud", completedAt: now,
    sources: [{ id: "existing", title: "Museum", authority: "Museum", url: "https://museum.example/gallery", retrievedAt: "2026-09-23", status: "verified", official: true }],
    places: [
      { id: "museum", name: "Museum", locationLabel: "Ubud", city: "Ubud", category: "art museum", priority: "must", coordinates: [-8.5, 115.2], whyWorthIt: "Art", plan: "Visit", sourceUrls: ["https://museum.example/gallery"], images: [{ url: "https://museum.example/a.jpg", alt: "Museum courtyard", sourceUrl: "https://museum.example/gallery", usage: ["card"], status: "verified" }] },
      { id: "restaurant", name: "Exact Restaurant", locationLabel: "Ubud", city: "Ubud", category: "restaurant", priority: "preferred", coordinates: [-8.51, 115.21], whyWorthIt: "Food", plan: "Dine", sourceUrls: [] },
      { id: "optional", name: "Optional Gallery", locationLabel: "Ubud", city: "Ubud", category: "gallery", priority: "nearby", coordinates: [-8.52, 115.22], whyWorthIt: "Art", plan: "Browse", sourceUrls: [] }
    ],
    events: [], relationships: [], localFoods: [], localProducts: [], experienceThemes: [], travelTips: [], actionRequirements: []
  };
  const research = importSkillResearchBatches([batch], { researchSetId: "research", generationKey: "generation", proposalRef: { sessionId: "session", proposalVersion: 1 }, skillLineage: LANDI_BLUEPRINT_SKILL, createdAt: now, updatedAt: now });
  const ids = Object.fromEntries(research.places.map((place) => [place.name, place.id]));
  const itinerary: SkillItineraryArtifact = {
    title: "Ubud", summary: "Ubud", language: "en", destinations: ["Ubud"], startDate: "2026-10-06", endDate: "2026-10-06",
    days: [{ id: "day", date: "2026-10-06", kind: "scheduled", city: "Ubud", title: "Ubud", summary: "Art and food", stops: [{ placeId: ids.Museum!, order: 1 }, { placeId: ids["Exact Restaurant"]!, order: 2 }], candidatePlaceIds: [ids["Optional Gallery"]!], blocks: [
      { id: "museum", kind: "stop", order: 1, placeId: ids.Museum!, planRole: "planned", evidence: [] },
      { id: "meal", kind: "meal", order: 2, placeId: ids["Exact Restaurant"]!, planRole: "planned", evidence: [] },
      { id: "optional", kind: "stop", order: 3, placeId: ids["Optional Gallery"]!, planRole: "optional", evidence: [] }
    ] }], movements: []
  };
  const blueprint = importSkillItinerary(research, itinerary, { blueprintId: "blueprint", blueprintVersion: 1, createdAt: now });
  return { research, blueprint, ids };
}

test("coverage audits only planned concrete Timeline places and skips enrichment when an image exists", () => {
  const { research, blueprint, ids } = fixture();
  assert.deepEqual(plannedConcretePlaceIds(blueprint), [ids.Museum, ids["Exact Restaurant"]]);
  assert.deepEqual(auditPlannedPlaceImageCoverage(blueprint, research).map((row) => [row.place, row.status, row.candidateCount]), [["Museum", "image_available", 1], ["Exact Restaurant", "image_missing", 0]]);
  assert.deepEqual(missingPlannedPlaceImages(blueprint, research).map((place) => place.name), ["Exact Restaurant"]);
  assert.equal(missingPlannedPlaceImages(blueprint, research).some((place) => place.id === ids["Optional Gallery"]), false);
});

test("image-only merge preserves existing images, sanitizes source bindings, dedupes URLs, and leaves itinerary semantics unchanged", () => {
  const { research, blueprint, ids } = fixture();
  const enrichment: SkillImageEnrichmentArtifact = {
    sources: [{ id: "official-restaurant", title: "Restaurant gallery", authority: "Exact Restaurant", url: "https://restaurant.example/gallery#photos", retrievedAt: "2026-09-23", status: "verified", official: true }],
    images: [
      { placeId: ids["Exact Restaurant"]!, url: "https://restaurant.example/dining.jpg", alt: "Dining room at Exact Restaurant", sourceUrl: "https://restaurant.example/gallery", usage: ["detail"], status: "verified" },
      { placeId: ids["Exact Restaurant"]!, url: "https://restaurant.example/dining.jpg#duplicate", alt: "Duplicate", sourceUrl: "https://restaurant.example/gallery", usage: ["detail"], status: "verified" },
      { placeId: ids["Optional Gallery"]!, url: "https://optional.example/gallery.jpg", alt: "Optional gallery", sourceUrl: "https://restaurant.example/gallery", usage: ["detail"], status: "verified" },
      { placeId: ids["Exact Restaurant"]!, url: "https://restaurant.example/unsupported.jpg", alt: "Unsupported", sourceUrl: "https://missing.example/source", usage: ["detail"], status: "verified" }
    ], omitted: []
  };
  const semantics = itinerarySemanticSnapshot(blueprint);
  const merged = mergePlannedPlaceImageEnrichment(research, blueprint, enrichment, "2026-09-23T01:00:00.000Z");
  assert.equal(merged.acceptedImageCount, 1);
  assert.deepEqual(itinerarySemanticSnapshot(merged.blueprint), semantics);
  assert.equal(merged.research.places.find((place) => place.id === ids.Museum)?.images?.[0]?.url, "https://museum.example/a.jpg");
  assert.equal(merged.research.places.find((place) => place.id === ids["Exact Restaurant"])?.images?.length, 1);
  assert.equal(merged.research.places.find((place) => place.id === ids["Optional Gallery"])?.images, undefined);
  assert.deepEqual(merged.blueprint.places.find((place) => place.id === ids["Exact Restaurant"])?.images?.[0]?.usage, ["card", "detail"]);
});

test("empty enrichment result is a no-op so publication can continue", () => {
  const { research, blueprint } = fixture();
  const merged = mergePlannedPlaceImageEnrichment(research, blueprint, { sources: [], images: [], omitted: [] }, now);
  assert.equal(merged.acceptedImageCount, 0);
  assert.equal(merged.research, research);
  assert.equal(merged.blueprint, blueprint);
});
