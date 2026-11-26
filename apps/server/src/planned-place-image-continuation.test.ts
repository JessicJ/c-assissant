import assert from "node:assert/strict";
import test from "node:test";
import { CodexRuntimeAdapter, LANDI_BLUEPRINT_SKILL, type SkillImageEnrichmentArtifact } from "@c-assistant/agent-adapters";
import { compileTripBlueprint, importSkillItinerary, importSkillResearchBatches, type SkillItineraryArtifact, type SkillResearchBatchArtifact } from "@c-assistant/core";
import { SqliteWorkspaceStore } from "@c-assistant/storage";
import { continuePublishedPlanImages } from "./planned-place-image-continuation.js";
const date = "2026-10-06";

function fixture(count = 6) {
  const places = Array.from({ length: count }, (_, index) => ({ id: `place-${index + 1}`, name: `Place ${index + 1}`, locationLabel: "Lisbon", city: "Lisbon", category: "museum", whyWorthIt: "Visit", plan: "Explore", sourceUrls: [] }));
  const batch: SkillResearchBatchArtifact = { id: "lisbon", scopeLabel: "Lisbon", completedAt: `${date}T00:00:00.000Z`, sources: [], places, events: [], relationships: [], localFoods: [], localProducts: [], experienceThemes: [], travelTips: [], actionRequirements: [] };
  const research = importSkillResearchBatches([batch], { researchSetId: "research", generationKey: "generation", proposalRef: { sessionId: "session", proposalVersion: 1 }, skillLineage: LANDI_BLUEPRINT_SKILL, createdAt: `${date}T00:00:00.000Z`, updatedAt: `${date}T00:00:00.000Z` });
  const ids = research.places.map((place) => place.id);
  const itinerary: SkillItineraryArtifact = { title: "Lisbon", summary: "Lisbon", language: "en", destinations: ["Lisbon"], startDate: date, endDate: date, days: [{ id: "day", date, kind: "scheduled", city: "Lisbon", title: "Lisbon", summary: "Museums", stops: ids.map((placeId, index) => ({ placeId, order: index + 1 })), candidatePlaceIds: [], blocks: ids.map((placeId, index) => ({ id: `block-${index + 1}`, kind: "stop" as const, order: index + 1, placeId, planRole: "planned" as const, evidence: [] })) }], movements: ids.slice(0, -1).map((originPlaceId, index) => ({ id: `movement-${index + 1}`, dayId: "day", originPlaceId, destinationPlaceId: ids[index + 1]!, mode: "unknown" as const, status: "recheck" as const, evidence: [] })) };
  const blueprint = importSkillItinerary(research, itinerary, { blueprintId: "blueprint", blueprintVersion: 1, createdAt: `${date}T00:00:00.000Z` });
  return { research, blueprint };
}

function imagesFor(places: { id: string; name: string }[]): SkillImageEnrichmentArtifact {
  return {
    sources: places.map((place) => ({ id: `source-${place.id}`, title: place.name, authority: place.name, url: `https://example.com/${place.id}`, retrievedAt: date, status: "verified" as const })),
    images: places.map((place) => ({ placeId: place.id, url: `https://example.com/${place.id}.jpg`, alt: place.name, sourceUrl: `https://example.com/${place.id}`, usage: ["card" as const, "detail" as const], status: "verified" as const })),
    omitted: []
  };
}


for (const outcome of ["confirmed", "replaced", "researched", "revised"] as const) test(`photo continuation preserves confirmation and stops after the plan is ${outcome}`, async () => {
  const store = new SqliteWorkspaceStore(":memory:");
  const { research, blueprint } = fixture(2);
  const session = store.createPlanningSession("travel");
  research.proposalRef.sessionId = session.id;
  blueprint.proposalRef.sessionId = session.id;
  store.saveBlueprintGeneration({ generationKey: research.generationKey, proposalRef: research.proposalRef, skillLineage: research.skillLineage, stage: "ready", status: "completed", createdAt: blueprint.createdAt, updatedAt: blueprint.createdAt });
  store.saveResearchSetAndTripBlueprint(research, blueprint);
  const plan = store.createCompiledBlueprintPlan(compileTripBlueprint(blueprint, { createdAt: blueprint.createdAt })).activePlan;
  let searches = 0;
  const runtime = new class extends CodexRuntimeAdapter {
    override async generatePlannedPlaceImageEnrichment(input: Parameters<CodexRuntimeAdapter["generatePlannedPlaceImageEnrichment"]>[0]) {
      searches++;
      if (outcome === "confirmed") store.confirmPlan(plan.id);
      else if (outcome === "revised") {
        store.saveTripBlueprint({ ...structuredClone(blueprint), version: 2, title: "Unpublished traveler revision" });
      } else if (outcome === "researched") {
        const revised = structuredClone(research);
        revised.places[0]!.whyWorthIt = "New traveler-approved facts";
        store.saveResearchSet(revised);
      } else {
        const replacement = { ...structuredClone(blueprint), version: 2, title: "Traveler revised trip" };
        store.saveTripBlueprint(replacement);
        store.createCompiledBlueprintPlan(compileTripBlueprint(replacement, { createdAt: blueprint.createdAt }));
      }
      return imagesFor(input.places);
    }
  }();
  try {
    const run = continuePublishedPlanImages({ store, codex: runtime, planId: plan.id, research, blueprint, request: "Find photographs", profile: store.getWorkspace().profile, probeImageUrl: async () => true, lookupKnownImages: async () => ({ sources: [], images: [], omitted: [] }) });
    if (outcome === "revised") {
      await assert.rejects(run, /blueprint changed/);
      assert.equal(store.getTripBlueprintByGenerationKey(blueprint.generationKey)!.title, "Unpublished traveler revision");
      assert.equal(store.getWorkspace().activePlan.id, plan.id);
      assert.equal(store.getWorkspace().activePlan.presentation!.places.some(place => place.images?.length), false);
    } else if (outcome === "researched") {
      await assert.rejects(run, /Research changed/);
      assert.equal(store.getResearchSet(research.id)!.places[0]!.whyWorthIt, "New traveler-approved facts");
      assert.equal(store.getWorkspace().activePlan.presentation!.places.some(place => place.images?.length), false);
    } else if (outcome === "replaced") {
      await assert.rejects(run, /plan changed|blueprint changed/i);
      assert.equal(store.getWorkspace().activePlan.title, "Traveler revised trip");
      assert.equal(store.getWorkspace().activePlan.presentation!.places.some(place => place.images?.length), false);
      assert.equal(store.getResearchSet(research.id)!.places.some(place => place.images?.length), false);
    } else {
      const result = await run;
      assert.equal(result!.remainingPlaceCount, 0);
      const active = store.getExecutionPlan()!;
      assert.equal(active.id, plan.id);
      assert.equal(active.status, "active");
      assert.deepEqual(active.configuration, plan.configuration);
      assert.deepEqual(active.presentation!.days, plan.presentation!.days);
      assert.equal(active.presentation!.places.filter(place => place.images?.length).length, 2);
      assert.throws(() => store.saveResearchSetAndTripBlueprint(result!.research, { ...result!.blueprint, title: "Unauthorized rewrite" }, { planId: plan.id, expectedBlueprint: result!.blueprint, expectedResearch: result!.research }), /itinerary content/);
      assert.equal(store.getExecutionPlan()!.title, plan.title);
    }
    assert.equal(searches, 1);
  } finally { store.close(); }
});
