import { planningAccommodationRequired, planningRequestForGenerationWithBookings } from "./planning-session-generation.js";
import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { CodexRuntimeAdapter, LANDI_BLUEPRINT_SKILL, LEGACY_BLUEPRINT_SKILL, RuntimeAdapterError, type SemanticTravelPlan, type SemanticTravelPlanRequest, type SemanticTravelPlanResult, type SkillImageEnrichmentArtifact, type SkillResearchBatchRequest, type SkillItineraryRequest } from "@c-assistant/agent-adapters";
import { importSkillItinerary, importSkillResearchBatches, type PlanningSession, type SkillResearchBatchArtifact, type SkillItineraryArtifact } from "@c-assistant/core";
import { SqliteWorkspaceStore } from "@c-assistant/storage";
import { canUseDateLocalCorrection, withSingleTransientRetry, accommodationResearchNeeded, assertItineraryQualityRepairPreservesStops, buildAccommodationResearchRequest, createPlanningGenerationService, hasPlaceOutsideGateway, recoverValidatedDiagnosticBlueprint, researchScopeBatchId, restoreUnrelatedQualityRepairDays, restoreUntargetedItineraryDays } from "./planning-generation.js";
import { registerPlanningSessionRoutes } from "./planning-session-routes.js";
import { destinationGateComparison } from "./semantic-draft-canary.js";
import { mergePlannedPlaceImageEnrichment } from "./planned-place-image-coverage.js";
import "./planned-place-image-coverage.test.js";
import "./planned-place-image-pipeline.test.js";

const now = "2026-09-08T00:00:00.000Z";
test("research batch identities stay stable on retry and change when a scope changes", () => {
  assert.equal(researchScopeBatchId(0, "New Zealand"), researchScopeBatchId(0, "New Zealand"));
  assert.notEqual(researchScopeBatchId(0, "New Zealand"), researchScopeBatchId(0, "New Zealand: signature regions"));
});
test("retry recovers structural diagnostic work and leaves content corrections to the publication gate", () => {
  const store = new SqliteWorkspaceStore(":memory:");
  try {
    const session = confirmedSession(store, {});
    const key = `${session.id}:1:landi-trip-blueprint@1.0.0`;
    store.saveBlueprintGeneration({ generationKey: key, proposalRef: { sessionId: session.id, proposalVersion: 1 }, skillLineage: LANDI_BLUEPRINT_SKILL, status: "failed", stage: "import", createdAt: now, updatedAt: now });
    const research = store.saveResearchSet(importSkillResearchBatches([batch({ batch: { id: "scope-1", scopeLabel: "Lisbon" } } as SkillResearchBatchRequest)], {
      researchSetId: "research-recovery", generationKey: key, proposalRef: { sessionId: session.id, proposalVersion: 1 }, skillLineage: LANDI_BLUEPRINT_SKILL, createdAt: now, updatedAt: now
    }));
    const museumId = research.places[0]!.id;
    const artifact: SkillItineraryArtifact = {
      title: "Lisbon", summary: "Museum visit", language: "en", destinations: ["Lisbon"], startDate: "2026-10-12", endDate: "2026-10-12",
      days: [{ id: "day", date: "2026-10-12", kind: "scheduled", city: "Lisbon", title: "Museum visit", summary: "Museum", stops: [{ placeId: museumId, order: 1, time: "09:00" }], candidatePlaceIds: [], blocks: [{ id: "museum-block", kind: "stop", order: 1, placeId: museumId, startTime: "09:00", durationMinutes: 300, evidence: [] }] }], movements: []
    };
    const blueprint = store.saveTripBlueprint(importSkillItinerary(research, artifact, { blueprintId: "blueprint-recovery", blueprintVersion: 1, createdAt: now }));
    store.saveDiagnosticArtifact({ generationKey: key, createdAt: "2026-09-08T00:00:01.000Z", expiresAt: "2026-09-22T00:00:00.000Z", rawResponse: JSON.stringify({ type: "blueprint_import_failure_v1", artifact }) });
    const input = { store, generationKey: key, research, blueprint, session: { facts: [] } as unknown as PlanningSession, bookingConstraints: [] };
    assert.equal(recoverValidatedDiagnosticBlueprint(input)?.version, 2);
    assert.equal(recoverValidatedDiagnosticBlueprint({ ...input, blueprint: undefined })?.version, 1);
    const needsTiming = { ...artifact, days: [{ ...artifact.days[0]!, stops: [{ placeId: museumId, order: 1 }], blocks: [{ ...artifact.days[0]!.blocks![0]!, startTime: undefined }] }] };
    store.saveDiagnosticArtifact({ generationKey: key, createdAt: "2026-09-08T00:00:01.500Z", expiresAt: "2026-09-22T00:00:00.000Z", rawResponse: JSON.stringify({ type: "blueprint_import_failure_v1", artifact: needsTiming }) });
    assert.ok(recoverValidatedDiagnosticBlueprint(input), "Missing proposed timing must reach the publication repair instead of repeating itinerary generation.");
    store.saveDiagnosticArtifact({ generationKey: key, createdAt: "2026-09-08T00:00:02.000Z", expiresAt: "2026-09-22T00:00:00.000Z", rawResponse: JSON.stringify({ type: "blueprint_import_failure_v1", artifact: { ...artifact, days: [{ ...artifact.days[0]!, stops: [], blocks: [] }] } }) });
    assert.equal(recoverValidatedDiagnosticBlueprint(input), undefined);
  } finally {
    store.close();
  }
});
test("quality repair can remove an optional ferry from an overloaded day but protects fixed anchors", () => {
  const day = (date: string, placeIds: string[]) => ({ id: date, date, kind: "scheduled" as const, city: "Auckland", title: date, summary: date, stops: placeIds.map((placeId, index) => ({ placeId, order: index + 1 })), candidatePlaceIds: [], blocks: [] });
  const original: SkillItineraryArtifact = { title: "NZ", summary: "NZ", language: "en", destinations: ["New Zealand"], startDate: "2026-11-10", endDate: "2026-11-12", days: [day("2026-11-10", ["akl"]), day("2026-11-11", ["hotel", "ferry", "museum"]), day("2026-11-12", ["akl"])], movements: [] };
  const research = { places: [
    { id: "akl", name: "Auckland Airport", category: "airport" },
    { id: "hotel", name: "Recommended Hotel", category: "hotel", accommodation: { state: "recommended" as const } },
    { id: "ferry", name: "Waiheke Island Ferry", category: "ferry day trip" },
    { id: "museum", name: "Museum", category: "museum" }
  ] } as Parameters<typeof assertItineraryQualityRepairPreservesStops>[2];
  const repaired = { ...original, days: [original.days[0]!, day("2026-11-11", ["hotel", "museum"]), original.days[2]!] };
  const overplanned = [{ code: "overplanned_day" as const, date: "2026-11-11" }];
  assert.doesNotThrow(() => assertItineraryQualityRepairPreservesStops(original, repaired, research, overplanned));
  assert.throws(() => assertItineraryQualityRepairPreservesStops(original, repaired, research, [{ ...overplanned[0]!, date: "2026-11-10" }]), /ferry/);
  const confirmed = { places: research.places.map((place) => place.id === "ferry" ? { ...place, accommodation: { state: "confirmed" as const } } : place) };
  assert.throws(() => assertItineraryQualityRepairPreservesStops(original, repaired, confirmed, overplanned), /ferry/);
  const bookedFerry = [{ id: "booking-ferry", type: "ticket", title: "Waiheke Island Ferry", status: "confirmed", sourceLabel: "Traveler booking", importedAt: now, constraintStrength: "hard", segments: [{ id: "segment-ferry", segmentType: "other", title: "Waiheke Island Ferry", startAtLocal: "2026-11-11T09:00", location: "Auckland", constraintStrength: "hard", fixedCommitment: true, needsReviewReasons: [] }] }] as Parameters<typeof assertItineraryQualityRepairPreservesStops>[4];
  assert.throws(() => assertItineraryQualityRepairPreservesStops(original, repaired, research, overplanned, bookedFerry), /ferry/);
  const missingAirport = { ...original, days: [day("2026-11-10", []), ...original.days.slice(1)] };
  assert.throws(() => assertItineraryQualityRepairPreservesStops(original, missingAirport, research, [{ code: "destination_scope_collapse" }]), /akl/);
});
test("quality repair restores an unrelated excursion day and its movements", () => {
  const day = (id: string, date: string, placeIds: string[]) => ({ id, date, kind: "scheduled" as const, city: "New Zealand", title: date, summary: date, stops: placeIds.map((placeId, index) => ({ placeId, order: index + 1 })), candidatePlaceIds: [], blocks: [] });
  const original: SkillItineraryArtifact = {
    title: "NZ", summary: "NZ", language: "en", destinations: ["New Zealand"], startDate: "2026-11-11", endDate: "2026-11-14",
    days: [day("empty", "2026-11-11", ["hotel"]), day("cruise", "2026-11-14", ["hotel", "milford-cruise"])],
    movements: [{ id: "to-cruise", dayId: "cruise", originPlaceId: "hotel", destinationPlaceId: "milford-cruise", mode: "driving", status: "recheck", evidence: [] }]
  };
  const repaired: SkillItineraryArtifact = {
    ...original,
    days: [day("empty", "2026-11-11", ["hotel", "museum"]), day("changed-cruise", "2026-11-14", ["hotel"])],
    movements: [{ id: "wrong-route", dayId: "changed-cruise", originPlaceId: "hotel", destinationPlaceId: "museum", mode: "driving", status: "recheck", evidence: [] }]
  };
  const restored = restoreUnrelatedQualityRepairDays(original, repaired, ["2026-11-11"]);
  assert.deepEqual(restored.days[0], repaired.days[0]);
  assert.deepEqual(restored.days[1], original.days[1]);
  assert.deepEqual(restored.movements, original.movements);
  const sameDayRepair = { ...repaired, days: [original.days[0]!, day("changed-cruise", "2026-11-14", ["hotel", "museum"])] };
  assert.deepEqual(restoreUnrelatedQualityRepairDays(original, sameDayRepair, []).days[1], original.days[1]);
  assert.equal(restoreUnrelatedQualityRepairDays(original, repaired, ["2026-11-11"], true), repaired);
});
test("day completion cannot convert an unrelated transit day into sightseeing", () => {
  const transit = { id: "travel", date: "2026-11-06", kind: "transit" as const, city: "Rotorua to South Island", title: "Transfer south", summary: "Travel day", stops: [], candidatePlaceIds: [], blocks: [] };
  const target = { id: "visit", date: "2026-11-08", kind: "scheduled" as const, city: "Aoraki", title: "Walk", summary: "Walk", stops: [{ placeId: "track", order: 1 }], candidatePlaceIds: [], blocks: [] };
  const original: SkillItineraryArtifact = { title: "NZ", summary: "NZ", language: "en", destinations: ["New Zealand"], startDate: transit.date, endDate: target.date, days: [transit, target], movements: [] };
  const composed: SkillItineraryArtifact = { ...original, days: [{ ...transit, kind: "scheduled", title: "Extra Rotorua tour", stops: [{ placeId: "forest", order: 1 }] }, { ...target, stops: [...target.stops, { placeId: "museum", order: 2 }] }] };
  const restored = restoreUntargetedItineraryDays(original, composed, [target.date]);
  assert.deepEqual(restored.days[0], transit);
  assert.deepEqual(restored.days[1], composed.days[1]);
  assert.deepEqual(restoreUnrelatedQualityRepairDays(original, composed, [target.date]).days[0], transit);
  const originalWithRoute = { ...original, movements: [{ id: "saved-route", dayId: transit.id, originPlaceId: "station", destinationPlaceId: "hotel", mode: "driving" as const, status: "recheck" as const, evidence: [] }] };
  const changedMovementOnly = { ...originalWithRoute, movements: [{ ...originalWithRoute.movements[0]!, id: "invalid-route", destinationPlaceId: "museum" }] };
  assert.deepEqual(restoreUntargetedItineraryDays(originalWithRoute, changedMovementOnly, [target.date]).movements, originalWithRoute.movements);
  assert.deepEqual(restoreUnrelatedQualityRepairDays(originalWithRoute, changedMovementOnly, [target.date]).movements, originalWithRoute.movements);
});
test("region research distinguishes the country gateway from other travel bases", () => {
  assert.equal(hasPlaceOutsideGateway([{ city: "Wellington" }, { city: " wellington " }], "Wellington"), false);
  assert.equal(hasPlaceOutsideGateway([{ city: "Wellington" }, { city: "Picton", category: "waterfront" }], "Wellington"), true);
  assert.equal(hasPlaceOutsideGateway([{ city: "Wellington" }, { city: "Picton", category: "hotel" }], "Wellington"), false);
  assert.equal(hasPlaceOutsideGateway([{ city: "Wellington" }, {}], "Wellington"), false);
});
function batch(input: SkillResearchBatchRequest): SkillResearchBatchArtifact {
  return {
    ...input.batch, completedAt: now, sources: [], events: [], actionRequirements: [],
    places: [{ id: "museum", name: "Museum", locationLabel: "Lisbon", city: "Lisbon", category: "museum", whyWorthIt: "Local ceramic collection", plan: "Explore the collection", sourceUrls: [] }]
  };
}

test("bounded accommodation research is requested once only when no selected stay or candidate exists", () => {
  const research = importSkillResearchBatches([batch({ batch: { id: "scope-1", scopeLabel: "Bali" } } as SkillResearchBatchRequest)], {
    researchSetId: "research",
    generationKey: "generation",
    proposalRef: { sessionId: "session", proposalVersion: 1 },
    skillLineage: LANDI_BLUEPRINT_SKILL,
    createdAt: now,
    updatedAt: now
  });
  assert.equal(accommodationResearchNeeded(research, []), true);
  const withCandidate = { ...research, places: [...research.places, { ...research.places[0]!, id: "hotel", name: "Real Hotel", category: "hotel", coordinates: [-8.5, 115.2] as [number, number], accommodation: { state: "recommended" as const } }] };
  assert.equal(accommodationResearchNeeded(withCandidate, []), false);
  const withLodge = { ...research, places: [...research.places, { ...research.places[0]!, id: "picton-lodge", name: "Picton Lodge", category: "motor lodge", coordinates: [-41.3, 174] as [number, number] }] };
  assert.equal(accommodationResearchNeeded(withLodge, []), false);
  const afterBoundedPass = { ...research, batches: [...research.batches, { id: "accommodation-anchors", scopeLabel: "Bali stays", status: "completed" as const, placeIds: [], eventIds: [], sourceIds: [] }] };
  assert.equal(accommodationResearchNeeded(afterBoundedPass, []), false);
  assert.match(buildAccommodationResearchRequest("Plan Bali"), /Recommended means not booked/);
  assert.match(buildAccommodationResearchRequest("Plan Bali"), /Do not add attractions, dining, shopping, transport tabs, prices, availability/i);
});

test("invalid confirmed travel dates are rejected before a generation run or Research call", () => {
  const store = new SqliteWorkspaceStore(":memory:");
  let researchCalls = 0;
  const adapter = new class extends CodexRuntimeAdapter {
    override async generateSkillResearchBatch(input: SkillResearchBatchRequest): Promise<SkillResearchBatchArtifact> {
      researchCalls++;
      return batch(input);
    }
  }();
  try {
    const session = confirmedSession(store, { destination: "Bali", travel_dates: "10/3 to 10/12", arrival: "DPS at 13:50", departure: "DPS at 14:25", party_size: "3", transport_preference: "walking" });
    const service = createPlanningGenerationService({ store, codex: adapter, setGeneratingPlan: () => {}, logGenerationFailure: () => {} });
    const workspace = store.getWorkspace();
    workspace.runtime.selectedKind = "codex";
    assert.throws(() => service.enqueuePlanningSessionGeneration(session, workspace), /travel_dates/);
    assert.equal(researchCalls, 0);
    assert.equal(store.getPlanningSessionById(session.id)?.status, "proposal_confirmed");
  } finally {
    store.close();
  }
});

test("research import failure retains the generated batch for contract replay", async () => {
  const store = new SqliteWorkspaceStore(":memory:");
  let researchCalls = 0;
  let finished!: () => void;
  const completion = new Promise<void>((resolve) => { finished = resolve; });
  const adapter = new class extends CodexRuntimeAdapter {
    override async generateSkillResearchBatch(input: SkillResearchBatchRequest): Promise<SkillResearchBatchArtifact> {
      researchCalls++;
      const artifact = batch(input);
      artifact.places[0]!.accommodation = { state: "recommended", baseLabel: "Lisbon" };
      if (input.repair) artifact.places = [];
      return artifact;
    }
  }();
  try {
    const session = confirmedSession(store, { destination: "Lisbon", travel_dates: "2026-10-12 to 2026-10-13", arrival: "Lisbon airport at 09:00", departure: "Lisbon airport at 18:00", party_size: "2", transport_preference: "walking" });
    const service = createPlanningGenerationService({ store, codex: adapter, setGeneratingPlan: (running) => { if (!running) finished(); }, logGenerationFailure: () => {} });
    const workspace = store.getWorkspace();
    workspace.runtime.selectedKind = "codex";
    const job = service.enqueuePlanningSessionGeneration(session, workspace);
    await completion;
    assert.equal(job.status, "failed");
    assert.equal(researchCalls, 2);
    assert.equal(store.getBlueprintGeneration(job.generationKey)?.stage, "research");
    const diagnostic = JSON.parse(store.listDiagnosticArtifacts(job.generationKey)[0]!.rawResponse);
    assert.equal(diagnostic.type, "research_import_failure_v1");
    assert.match(diagnostic.error, /Research repair removed existing places/);
    assert.equal(diagnostic.rejectedArtifact.places[0].category, "museum");
    assert.equal(diagnostic.rejectedArtifact.places[0].accommodation.state, "recommended");
    assert.equal(diagnostic.artifact.places.length, 0);
  } finally {
    store.close();
  }
});

test("research contract repair runs once and saves the corrected checkpoint", async () => {
  const store = new SqliteWorkspaceStore(":memory:");
  let finished!: () => void;
  const completion = new Promise<void>((resolve) => { finished = resolve; });
  let repairCalls = 0;
  const adapter = new class extends CodexRuntimeAdapter {
    override async generateSkillResearchBatch(input: SkillResearchBatchRequest): Promise<SkillResearchBatchArtifact> {
      const artifact = batch(input);
      artifact.places[0] = { ...artifact.places[0]!, id: "lisbon-lodge", name: "Lisbon Lodge", category: input.repair ? "motor lodge" : "sight", coordinates: [38.7, -9.1], accommodation: { state: "recommended", baseLabel: "Lisbon" } };
      if (input.repair) {
        repairCalls++;
        assert.match(input.repair.issues[0] ?? "", /accommodation state requires a lodging place/);
        assert.equal(input.repair.rejected.places[0]?.category, "sight");
      }
      return artifact;
    }
    override async generateSkillItinerary(): Promise<SkillItineraryArtifact> {
      throw new RuntimeAdapterError("invalid_request", "Stop after the saved research checkpoint.");
    }
  }();
  try {
    const session = confirmedSession(store, { destination: "Lisbon", travel_dates: "2026-10-12 to 2026-10-13", arrival: "Lisbon airport at 09:00", departure: "Lisbon airport at 18:00", party_size: "2", transport_preference: "walking" });
    const service = createPlanningGenerationService({ store, codex: adapter, setGeneratingPlan: (running) => { if (!running) finished(); }, logGenerationFailure: () => {} });
    const workspace = store.getWorkspace();
    workspace.runtime.selectedKind = "codex";
    const job = service.enqueuePlanningSessionGeneration(session, workspace);
    await completion;
    assert.equal(repairCalls, 1);
    assert.equal(store.getResearchSetByGenerationKey(job.generationKey)?.places[0]?.category, "motor lodge");
    assert.equal(store.getBlueprintGeneration(job.generationKey)?.stage, "itinerary");
  } finally {
    store.close();
  }
});

test("itinerary contract repair corrects a stop and block time mismatch once", async () => {
  const store = new SqliteWorkspaceStore(":memory:");
  let finished!: () => void;
  const completion = new Promise<void>((resolve) => { finished = resolve; });
  let repairCalls = 0;
  const adapter = new class extends CodexRuntimeAdapter {
    override async generateSkillResearchBatch(input: SkillResearchBatchRequest): Promise<SkillResearchBatchArtifact> {
      const artifact = batch(input);
      artifact.places.push({ id: "lodge", name: "Lisbon Lodge", locationLabel: "Lisbon", category: "motor lodge", coordinates: [38.7, -9.1], whyWorthIt: "A base.", plan: "Stay.", accommodation: { state: "recommended", baseLabel: "Lisbon" } });
      return artifact;
    }
    override async generateSkillItinerary(input: SkillItineraryRequest): Promise<SkillItineraryArtifact> {
      const museum = input.research.places.find((place) => place.name === "Museum")!;
      if (input.repair) {
        repairCalls++;
        assert.match(input.repair.issues[0] ?? "", /time must equal block/);
      }
      return {
        title: "Lisbon", summary: "Museum day", language: "en", destinations: ["Lisbon"], startDate: "2026-10-12", endDate: "2026-10-12",
        days: [{ id: "d1", date: "2026-10-12", kind: "scheduled", city: "Lisbon", title: "Museum", summary: "Visit the museum.", stops: [{ placeId: museum.id, order: 1, time: "15:00" }], blocks: [{ id: "museum-block", kind: "stop", order: 1, placeId: museum.id, startTime: input.repair ? "15:00" : "16:00", evidence: [] }], candidatePlaceIds: [] }],
        movements: []
      };
    }
  }();
  try {
    const session = confirmedSession(store, { destination: "Lisbon", travel_dates: "2026-10-12 to 2026-10-12", arrival: "Lisbon airport at 09:00", departure: "Lisbon airport at 18:00", party_size: "2", transport_preference: "walking" });
    const service = createPlanningGenerationService({ store, codex: adapter, setGeneratingPlan: (running) => { if (!running) finished(); }, logGenerationFailure: () => {} });
    const workspace = store.getWorkspace();
    workspace.runtime.selectedKind = "codex";
    const job = service.enqueuePlanningSessionGeneration(session, workspace);
    await completion;
    assert.equal(repairCalls, 1);
    assert.equal(store.getTripBlueprintByGenerationKey(job.generationKey)?.days[0]?.blocks?.[0]?.startTime, "15:00");
  } finally {
    store.close();
  }
});

test("generation reviews an overloaded day and repairs it before publishing", async () => {
  const store = new SqliteWorkspaceStore(":memory:");
  let finished!: () => void;
  const completion = new Promise<void>((resolve) => { finished = resolve; });
  let reviewRepairCalls = 0;
  const adapter = new class extends CodexRuntimeAdapter {
    override async generateSkillResearchBatch(input: SkillResearchBatchRequest): Promise<SkillResearchBatchArtifact> {
      return batch(input);
    }
    override async generateSkillItinerary(input: SkillItineraryRequest): Promise<SkillItineraryArtifact> {
      if (input.repair) {
        reviewRepairCalls++;
        assert.match(input.repair.issues.join(" "), /comfortable window/);
      }
      const museum = input.research.places.find((place) => place.name === "Museum")!;
      return {
        title: "Lisbon", summary: "Museum day", language: "en", destinations: ["Lisbon"], startDate: "2026-10-12", endDate: "2026-10-12",
        days: [{ id: "d1", date: "2026-10-12", kind: "scheduled", city: "Lisbon", title: "Museum", summary: "A substantial museum visit", stops: [{ placeId: museum.id, order: 1, time: "09:00" }], candidatePlaceIds: [], blocks: [{ id: "museum-block", kind: "stop", order: 1, placeId: museum.id, startTime: "09:00", durationMinutes: input.repair ? 300 : 540, evidence: [] }] }], movements: []
      };
    }
  }();
  try {
    const session = confirmedSession(store, { destination: "Lisbon", travel_dates: "2026-10-12 to 2026-10-12", arrival: "Lisbon airport at 09:00", departure: "Lisbon airport at 18:00", party_size: "2", transport_preference: "walking" });
    const service = createPlanningGenerationService({ store, codex: adapter, setGeneratingPlan: (running) => { if (!running) finished(); }, logGenerationFailure: () => {} });
    const workspace = store.getWorkspace();
    workspace.runtime.selectedKind = "codex";
    const job = service.enqueuePlanningSessionGeneration(session, workspace);
    await completion;
    assert.equal(job.status, "succeeded", job.message);
    assert.equal(reviewRepairCalls, 1);
    assert.equal(store.getTripBlueprintByGenerationKey(job.generationKey)?.days[0]?.blocks?.[0]?.durationMinutes, 300);
  } finally {
    store.close();
  }
});

for (const correctionOutcome of ["first", "second", "invalid_first", "never"] as const) test(`resumed blueprint final review ${correctionOutcome} correction of an overnight mismatch`, async () => {
  const store = new SqliteWorkspaceStore(":memory:");
  let finished!: () => void;
  const completion = new Promise<void>((resolve) => { finished = resolve; });
  let repairCalls = 0;
  let imageSearchCalls = 0;
  let editorialCalls = 0;
  let museumId = "";
  let hotelAId = "";
  let hotelBId = "";
  const adapter = new class extends CodexRuntimeAdapter {
    override async generatePlannedPlaceImageEnrichment(input: Parameters<CodexRuntimeAdapter["generatePlannedPlaceImageEnrichment"]>[0]): Promise<SkillImageEnrichmentArtifact> {
      imageSearchCalls++;
      assert.ok(repairCalls > 0, "Image search must use the itinerary after final review repairs.");
      assert.deepEqual(input.places.map((place) => place.name).sort(), ["City Museum", "Hotel A", "Hotel B"].sort());
      return {
        sources: input.places.map((place) => ({ id: `photo-${place.id}`, title: place.name, authority: place.name, url: `https://example.com/${place.id}`, retrievedAt: "2026-10-04", status: "verified" })),
        images: input.places.map((place) => ({ placeId: place.id, url: `https://example.com/${place.id}.jpg`, alt: place.name, sourceUrl: `https://example.com/${place.id}`, usage: ["card", "detail"], status: "verified" })),
        omitted: []
      };
    }
    override async generateSkillItinerary(input: SkillItineraryRequest): Promise<SkillItineraryArtifact> {
      repairCalls++;
      assert.ok(input.repair);
      assert.match(input.repair.issues.join(" "), /starts from a different property|budget includes/);
      const corrected = structuredClone(input.repair.rejected);
      if (correctionOutcome === "invalid_first" && repairCalls === 1) {
        corrected.days[0]!.stops.push({ placeId: "nonexistent-place", order: 2 });
        return corrected;
      }
      if (correctionOutcome === "first" || (["second", "invalid_first"].includes(correctionOutcome) && repairCalls === 2)) {
        corrected.summary = "Two museum days";
        corrected.days[1]!.blocks![0]!.placeId = hotelAId;
        for (const movement of corrected.movements) {
          if (movement.dayId === corrected.days[1]!.id && movement.originPlaceId === hotelBId) movement.originPlaceId = hotelAId;
        }
      }
      return corrected;
    }
  }();
  try {
    const session = confirmedSession(store, { destination: "Lisbon", travel_dates: "2026-10-12 to 2026-10-13", arrival: "Lisbon airport at 09:00", departure: "Lisbon airport at 18:00", party_size: "2", transport_preference: "walking" });
    const key = `${session.id}:1:${LANDI_BLUEPRINT_SKILL.skillId}@${LANDI_BLUEPRINT_SKILL.skillVersion}`;
    store.saveBlueprintGeneration({ generationKey: key, proposalRef: { sessionId: session.id, proposalVersion: 1 }, skillLineage: LANDI_BLUEPRINT_SKILL, status: "failed", stage: "import", createdAt: now, updatedAt: now });
    const research = store.saveResearchSet(importSkillResearchBatches([{
      id: "scope-1", scopeLabel: "Lisbon", completedAt: now, sources: [], events: [], actionRequirements: [], places: [
        { id: "museum", name: "City Museum", locationLabel: "Lisbon", city: "Lisbon", category: "museum", durationMinutes: 240, whyWorthIt: "A substantive visit", plan: "Visit", sourceUrls: [] },
        { id: "hotel-a", name: "Hotel A", locationLabel: "Lisbon", city: "Lisbon", category: "hotel", accommodation: { state: "recommended" }, whyWorthIt: "First base", plan: "Stay", sourceUrls: [] },
        { id: "hotel-b", name: "Hotel B", locationLabel: "Lisbon", city: "Lisbon", category: "hotel", accommodation: { state: "recommended" }, whyWorthIt: "Alternative base", plan: "Stay", sourceUrls: [] }
      ]
    }], { researchSetId: "research-final-review", generationKey: key, proposalRef: { sessionId: session.id, proposalVersion: 1 }, skillLineage: LANDI_BLUEPRINT_SKILL, createdAt: now, updatedAt: now }));
    museumId = research.places.find((place) => place.name === "City Museum")!.id;
    hotelAId = research.places.find((place) => place.name === "Hotel A")!.id;
    hotelBId = research.places.find((place) => place.name === "Hotel B")!.id;
    const day = (date: string, startHotel: string, endHotel: string) => ({ id: `day-${date}`, date, kind: "scheduled" as const, city: "Lisbon", title: "Museum day", summary: "Explore the museum", stops: [{ placeId: museumId, order: 1, time: "09:00" }], candidatePlaceIds: [], blocks: [
      { id: `start-${date}`, kind: "lodging" as const, order: 1, placeId: startHotel, evidence: [] },
      { id: `museum-${date}`, kind: "stop" as const, order: 2, placeId: museumId, startTime: "09:00", durationMinutes: 240, evidence: [] },
      { id: `end-${date}`, kind: "lodging" as const, order: 3, placeId: endHotel, evidence: [] }
    ] });
    store.saveTripBlueprint(importSkillItinerary(research, {
      title: "Lisbon", summary: "The budget is assumed to exclude international flights.", language: "en", destinations: ["Lisbon"], startDate: "2026-10-12", endDate: "2026-10-13",
      days: [day("2026-10-12", hotelAId, hotelAId), day("2026-10-13", hotelBId, hotelBId)], movements: []
    }, { blueprintId: "blueprint-final-review", blueprintVersion: 1, createdAt: now }));
    if (correctionOutcome === "second") store.saveResearchSet({ ...research, updatedAt: new Date().toISOString(), places: [...research.places, { ...research.places[0]!, id: "later-researched-place", name: "Alternative museum" }] });
    if (correctionOutcome === "first") {
      const current = store.getTripBlueprintByGenerationKey(key)!;
      const seeded = mergePlannedPlaceImageEnrichment(research, current, {
        sources: research.places.map((place) => ({ id: `existing-${place.id}`, title: place.name, authority: place.name, url: `https://example.com/existing-${place.id}`, retrievedAt: "2026-10-04", status: "verified" as const })),
        images: research.places.map((place) => ({ placeId: place.id, url: `https://example.com/existing-${place.id}.jpg`, alt: place.name, sourceUrl: `https://example.com/existing-${place.id}`, usage: ["card", "detail"] as ["card", "detail"], status: "verified" as const })), omitted: []
      }, new Date().toISOString());
      store.saveResearchSetAndTripBlueprint(seeded.research, seeded.blueprint);
    }
    const service = createPlanningGenerationService({ store, codex: adapter, plannedPlaceImageEnrichment: correctionOutcome === "first", probeImageUrl: async (url) => !url.includes("/existing-"), itineraryContentReview: async () => { editorialCalls++; return []; }, setGeneratingPlan: (running) => { if (!running) finished(); }, logGenerationFailure: () => {} });
    const workspace = store.getWorkspace();
    workspace.runtime.selectedKind = "codex";
    const job = service.enqueuePlanningSessionGeneration(session, workspace);
    await completion;
    assert.equal(job.status, correctionOutcome === "never" ? "failed" : "succeeded", job.message);
    assert.equal(repairCalls, correctionOutcome === "first" ? 1 : 2);
    if (correctionOutcome === "second") assert.ok(store.getTripBlueprintByGenerationKey(key)?.places.some((place) => place.id === "later-researched-place"), "Research saved before a failed import must remain in the resumed catalog.");
    assert.ok(editorialCalls <= repairCalls + 1, "There is at most one review per saved corrected route.");
    assert.equal(store.getTripBlueprintByGenerationKey(key)?.days[1]?.blocks?.[0]?.placeId, hotelAId);
    assert.equal(store.getPlanningSessionById(session.id)?.status, correctionOutcome === "never" ? "proposal_ready" : "draft_ready");
    if (correctionOutcome === "first") {
      assert.equal(imageSearchCalls, 1);
      const plan = store.getWorkspace().activePlan;
      assert.ok(plan.presentation?.places.find((place) => place.name === "Hotel A")?.images?.length);
      assert.ok(plan.presentation?.places.find((place) => place.name === "City Museum")?.images?.length);
    }
    if (correctionOutcome === "never") {
      assert.match(job.message ?? "", /final review failed/);
      const diagnostic = JSON.parse(store.listDiagnosticArtifacts(key).at(-1)!.rawResponse);
      assert.equal(diagnostic.type, "blueprint_import_failure_v1");
      assert.ok(diagnostic.rejectedArtifact);
      assert.ok(diagnostic.artifact);
      const correctedArtifact = structuredClone(diagnostic.artifact) as SkillItineraryArtifact;
      correctedArtifact.summary = "Two museum days";
      correctedArtifact.days[1]!.blocks![0]!.placeId = hotelAId;
      store.saveDiagnosticArtifact({ generationKey: key, createdAt: new Date(Date.now() + 1_000).toISOString(), expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60_000).toISOString(), rawResponse: JSON.stringify({ type: "blueprint_import_failure_v1", artifact: correctedArtifact }) });
      let resumed!: () => void;
      const resumedCompletion = new Promise<void>((resolve) => { resumed = resolve; });
      const resumedService = createPlanningGenerationService({ store, codex: adapter, setGeneratingPlan: (running) => { if (!running) resumed(); }, logGenerationFailure: () => {} });
      const priorRepairCalls = repairCalls;
      const resumedJob = resumedService.enqueuePlanningSessionGeneration(session, workspace);
      await resumedCompletion;
      assert.equal(resumedJob.status, "succeeded", resumedJob.message);
      assert.equal(repairCalls, priorRepairCalls);
      assert.equal(store.getPlanningSessionById(session.id)?.status, "draft_ready");
    }
  } finally {
    store.close();
  }
});

for (const withImages of [false, true]) test(`independent content review repairs an operator meeting point; background images=${withImages}`, async () => {
  const store = new SqliteWorkspaceStore(":memory:");
  let finished!: () => void;
  const done = new Promise<void>((resolve) => { finished = resolve; });
  let compositionCalls = 0;
  let lookupStartedBeforeComposition = false;
  let reviews = 0;
  let imageSearches = 0;
  let releaseImages!: () => void;
  const imagesReleased = new Promise<void>(resolve => { releaseImages = resolve; });
  const adapter = new class extends CodexRuntimeAdapter {
    override async generateSkillResearchBatch(input: SkillResearchBatchRequest): Promise<SkillResearchBatchArtifact> {
      return { ...input.batch, completedAt: now, sources: [], events: [], actionRequirements: [], places: [
        { id: "cave", name: "Cave excursion", locationLabel: "Te Anau", city: "Te Anau", category: "tour", durationMinutes: 300, whyWorthIt: "A substantial excursion", plan: "Report to the visitor centre first", sourceUrls: [] },
        { id: "centre", name: "Visitor Centre", locationLabel: "Te Anau", city: "Te Anau", category: "visitor centre", durationMinutes: 15, whyWorthIt: "Operator boarding point", plan: "Check in here before the excursion", sourceUrls: [] }
      ] };
    }
    override async generatePlannedPlaceImageEnrichment(input: Parameters<CodexRuntimeAdapter["generatePlannedPlaceImageEnrichment"]>[0]) {
      imageSearches++;
      if (imageSearches === 1) return { sources: [], images: [], omitted: [] };
      await imagesReleased;
      return {
        sources: input.places.map(place => ({ id: `image-${place.id}`, title: place.name, authority: place.name, url: `https://example.com/${place.id}`, retrievedAt: "2026-10-10", status: "verified" as const })),
        images: input.places.map(place => ({ placeId: place.id, url: `https://example.com/${place.id}.jpg`, alt: place.name, sourceUrl: `https://example.com/${place.id}`, usage: ["card" as const, "detail" as const], status: "verified" as const })), omitted: []
      };
    }
    override async generateSkillItinerary(input: SkillItineraryRequest): Promise<SkillItineraryArtifact> {
      compositionCalls++;
      if (withImages) assert.equal(lookupStartedBeforeComposition, true, "Public image prefetch starts after the research checkpoint and before composition");
      const cave = input.research.places.find((place) => place.name === "Cave excursion")!;
      const centre = input.research.places.find((place) => place.name === "Visitor Centre")!;
      if (input.repair) {
        assert.match(input.repair.issues.join(" "), /operator meeting point/);
        assert.deepEqual(input.dayPatch?.dates, ["2026-11-09"], "Dated optional route advice must not force a full rewrite");
      }
      return { title: "Te Anau", summary: "One excursion day", language: "en", destinations: ["Te Anau"], startDate: "2026-11-09", endDate: "2026-11-09",
        days: [{ id: "d1", date: "2026-11-09", kind: "scheduled", city: "Te Anau", title: "Cave excursion", summary: "Use the operator-managed excursion", candidatePlaceIds: [],
          stops: [...(input.repair ? [{ placeId: centre.id, order: 1, time: "08:30" }] : []), { placeId: cave.id, order: input.repair ? 2 : 1, time: "09:00" }],
          blocks: [...(input.repair ? [{ id: "meeting", kind: "stop" as const, order: 1, placeId: centre.id, startTime: "08:30", durationMinutes: 15, evidence: [] }] : []), { id: "cave", kind: "stop" as const, order: input.repair ? 2 : 1, placeId: cave.id, startTime: "09:00", durationMinutes: 300, evidence: [] }]
        }], movements: [] };
    }
  }();
  try {
    const session = confirmedSession(store, { destination: "Te Anau", travel_dates: "2026-11-09 to 2026-11-09", arrival: "already in Te Anau", departure: "after the trip", party_size: "3", transport_preference: "walking" });
    const workspace = store.getWorkspace();
    workspace.runtime.selectedKind = "codex";
    const service = createPlanningGenerationService({ store, codex: adapter, plannedPlaceImageEnrichment: withImages, probeImageUrl: async () => true, lookupKnownImages: async () => { lookupStartedBeforeComposition = true; return { sources: [], images: [], omitted: [] }; },
      itineraryContentReview: async (input) => {
        reviews++;
        return input.itinerary.days[0]!.stops.some((stop) => input.research.places.find((place) => place.id === stop.placeId)?.name === "Visitor Centre") ? [] : [{ code: "excursion_meeting_point", date: "2026-11-09", blocking: true, explanation: "The operator meeting point is missing from the route.", repairInstruction: "Visit the researched Visitor Centre before boarding." }, { code: "route_efficiency", date: "2026-11-09", blocking: false, explanation: "Keep the local meeting point on the way to the excursion.", repairInstruction: "Prefer this order without changing other dates." }];
      }, setGeneratingPlan: (running) => { if (!running) finished(); }, logGenerationFailure: () => {} });
    const job = service.enqueuePlanningSessionGeneration(session, workspace);
    await done;
    assert.equal(job.status, "succeeded", job.message);
    assert.equal(compositionCalls, 2);
    assert.equal(reviews, 2);
    assert.equal(store.getPlanningSessionById(session.id)?.status, "draft_ready");
    if (withImages) {
      assert.equal(service.imageContinuations!.size, 1, "Draft is ready before background photos return");
      store.confirmPlan(store.getWorkspace().activePlan.id);
      releaseImages();
      await Promise.all(service.imageContinuations!.values());
      assert.equal(store.getExecutionPlan()!.presentation!.places.filter(place => place.images?.length).length, 2);
      assert.equal(store.getExecutionPlan()!.status, "active");
    }
    const b = store.getTripBlueprintByGenerationKey(job.generationKey)!;
    assert.equal(b.places.find((place) => place.id === b.days[0]!.stops[0]!.placeId)?.name, "Visitor Centre");
  } finally { store.close(); }
});

test("generation researches a missing flight origin and publishes a split airport route", async () => {
  const store = new SqliteWorkspaceStore(":memory:");
  let finished!: () => void;
  const completion = new Promise<void>((resolve) => { finished = resolve; });
  let airportResearchCalls = 0;
  const adapter = new class extends CodexRuntimeAdapter {
    override async generateSkillResearchBatch(input: SkillResearchBatchRequest): Promise<SkillResearchBatchArtifact> {
      if (input.batch.id === "flight-origin-airports") {
        airportResearchCalls++;
        return { ...batch(input), places: [{ id: "chc-airport", name: "Christchurch Airport", city: "Christchurch", locationLabel: "Christchurch, New Zealand", category: "airport", coordinates: [-43.4894, 172.5322], whyWorthIt: "Flight departure node", plan: "Check in for the selected flight.", sourceUrls: [] }] };
      }
      return { ...batch(input), places: [
        { id: "hotel", name: "Hotel Give", city: "Christchurch", locationLabel: "Christchurch", category: "hotel", coordinates: [-43.53, 172.63], whyWorthIt: "Overnight base", plan: "Stay overnight.", accommodation: { state: "recommended", baseLabel: "Christchurch" }, sourceUrls: [] },
        { id: "wlg", name: "Wellington Airport", city: "Wellington", locationLabel: "Wellington", category: "airport", coordinates: [-41.33, 174.81], whyWorthIt: "Arrival node", plan: "Collect baggage.", sourceUrls: [] }
      ] };
    }
    override async generateSkillItinerary(input: SkillItineraryRequest): Promise<SkillItineraryArtifact> {
      const hotel = input.research.places.find((place) => place.name === "Hotel Give")!;
      const arrival = input.research.places.find((place) => place.name === "Wellington Airport")!;
      return { title: "Flight", summary: "Fly to Wellington", language: "en", destinations: ["Christchurch", "Wellington"], startDate: "2026-10-12", endDate: "2026-10-12", days: [{ id: "d1", date: "2026-10-12", kind: "transit", city: "Christchurch and Wellington", title: "Flight to Wellington", summary: "Book the flight.", stops: [{ placeId: arrival.id, order: 1 }], candidatePlaceIds: [], blocks: [
        { id: "hotel-depart", kind: "lodging", order: 1, placeId: hotel.id, title: "Depart from Hotel Give", evidence: [] },
        { id: "flight", kind: "transfer", order: 2, title: "Christchurch–Wellington flight", evidence: [] },
        { id: "wlg", kind: "stop", order: 3, placeId: arrival.id, title: "Wellington arrival", evidence: [] }
      ] }], movements: [{ id: "direct", dayId: "d1", originPlaceId: hotel.id, destinationPlaceId: arrival.id, mode: "unknown", status: "recheck", evidence: [] }] };
    }
  }();
  try {
    const session = confirmedSession(store, { destination: "New Zealand", travel_dates: "2026-10-12 to 2026-10-12", arrival: "Christchurch airport at 09:00", departure: "Wellington airport at 18:00", party_size: "2", transport_preference: "walking" });
    const service = createPlanningGenerationService({ store, codex: adapter, setGeneratingPlan: (running) => { if (!running) finished(); }, logGenerationFailure: () => {} });
    const workspace = store.getWorkspace();
    workspace.runtime.selectedKind = "codex";
    const job = service.enqueuePlanningSessionGeneration(session, workspace);
    await completion;
    assert.equal(job.status, "succeeded", job.message);
    assert.equal(airportResearchCalls, 1);
    const blueprint = store.getTripBlueprintByGenerationKey(job.generationKey)!;
    assert.ok(blueprint.days[0]?.stops.some((stop) => blueprint.places.find((place) => place.id === stop.placeId)?.name === "Christchurch Airport"));
    assert.ok(blueprint.movements.some((movement) => movement.mode === "flight"));
    assert.ok(!blueprint.movements.some((movement) => movement.originPlaceId === blueprint.places.find((place) => place.name === "Hotel Give")?.id && movement.destinationPlaceId === blueprint.places.find((place) => place.name === "Wellington Airport")?.id));
  } finally {
    store.close();
  }
});

for (const legacy of [false, true]) {
  test(`${legacy ? "legacy" : "Landi"} generation resumes after timeout with matching policy and preserves place identities`, async () => {
    const store = new SqliteWorkspaceStore(":memory:");
    const server = Fastify({ logger: false });
    let researchCalls = 0;
    let itineraryCalls = 0;
    let finished!: () => void;
    let completion = new Promise<void>((resolve) => { finished = resolve; });
    const lineage = legacy ? LEGACY_BLUEPRINT_SKILL : LANDI_BLUEPRINT_SKILL;
    const adapter = new class extends CodexRuntimeAdapter {
      override async generateSkillResearchBatch(input: SkillResearchBatchRequest): Promise<SkillResearchBatchArtifact> {
        researchCalls++;
        assert.deepEqual(input.skillLineage, lineage);
        return batch(input);
      }
      override async generateSkillItinerary(input: SkillItineraryRequest): Promise<SkillItineraryArtifact> {
        itineraryCalls++;
        assert.deepEqual(input.research.skillLineage, lineage);
        if (itineraryCalls === 1) throw new RuntimeAdapterError("timed_out", "Fixture times out after saved research.");
        return {
          title: "Lisbon", summary: "A ceramic collection and an open rest day", language: "en", destinations: ["Lisbon"], startDate: "2026-10-12", endDate: "2026-10-13",
          days: [
            { id: "d1", date: "2026-10-12", kind: "scheduled", city: "Lisbon", title: "Collection", summary: "Museum", stops: [{ placeId: input.research.places[0]!.id, order: 1 }], candidatePlaceIds: [] },
            { id: "d2", date: "2026-10-13", kind: "rest", city: "Lisbon", title: "Rest", summary: "User requested a full rest day", stops: [], candidatePlaceIds: [] }
          ], movements: []
        };
      }
    }();
    const makeService = () => createPlanningGenerationService({ store, codex: adapter, setGeneratingPlan: (running) => { if (!running) finished(); }, logGenerationFailure: () => {} });
    try {
      const created = store.createPlanningSession("travel");
      store.savePlanningSession({ ...created, status: "proposal_ready", facts: Object.entries({ destination: "Lisbon", travel_dates: "2026-10-12 to 2026-10-13", arrival: "Lisbon airport at 09:00", departure: "Lisbon airport at 18:00", party_size: "2", transport_preference: "walking" }).map(([key, value]) => ({ key, value, source: "user", confirmed: true, updatedAt: now })), proposal: { version: 1, title: "Lisbon", objective: "Lisbon", theme: "Ceramics", segments: ["Lisbon"], skeleton: ["2026-10-12", "2026-10-13"], tradeoffs: [], assumptions: [], decisionPoints: [] }, updatedAt: now });
      const session = store.confirmPlanningSession(created.id, 1);
      const key = `${session.id}:1:${lineage.skillId}@${lineage.skillVersion}`;
      if (legacy) {
        store.saveBlueprintGeneration({ generationKey: key, proposalRef: { sessionId: session.id, proposalVersion: 1 }, skillLineage: lineage, status: "failed", stage: "itinerary", createdAt: now, updatedAt: now });
        const artifact = batch({ request: "Lisbon", batch: { id: "scope-1", scopeLabel: "Lisbon" }, profile: { preferredLanguage: "English", nationality: "Canada", gender: "not_specified", immigrationStatus: "not_obtained" } });
        store.saveResearchSet(importSkillResearchBatches([artifact], { researchSetId: "old-research", generationKey: key, proposalRef: { sessionId: session.id, proposalVersion: 1 }, skillLineage: lineage, createdAt: now, updatedAt: now }));
      }
      const service = makeService();
      const workspace = store.getWorkspace();
      workspace.runtime.selectedKind = "codex";
      const job = service.enqueuePlanningSessionGeneration(session, workspace);
      assert.equal(job.generationKey, key);
      assert.equal(service.enqueuePlanningSessionGeneration(session, workspace), job);
      await completion;
      assert.equal(job.status, "failed");
      assert.equal(job.failureCode, "timed_out");
      assert.equal(itineraryCalls, 1);
      const savedResearch = store.getResearchSetByGenerationKey(key)!;
      assert.ok(savedResearch.places.length);
      assert.equal(researchCalls, legacy ? 1 : 2);

      // A fresh service has no in-memory jobs, as after a service restart.
      const resumedService = makeService();
      registerPlanningSessionRoutes(server, { store, generation: resumedService });
      const status = await server.inject({ method: "GET", url: `/api/planning-sessions/${session.id}/generation` });
      assert.equal(status.statusCode, 200);
      assert.equal(status.json().snapshot.generationKey, key);
      assert.ok(status.json().events.length);
      completion = new Promise<void>((resolve) => { finished = resolve; });
      const resumed = resumedService.enqueuePlanningSessionGeneration(session, workspace);
      await completion;
      assert.equal(resumed.status, "succeeded", resumed.message);
      assert.equal(researchCalls, legacy ? 1 : 2);
      const blueprint = store.getTripBlueprintByGenerationKey(key)!;
      assert.deepEqual(blueprint.skillLineage, lineage);
      assert.deepEqual(blueprint.places.map((place) => place.id), savedResearch.places.map((place) => place.id));
      assert.equal(blueprint.days.length, 2);
      assert.equal(store.getWorkspace().activeBlueprint?.id, blueprint.id);
      assert.deepEqual(store.getResearchSetByGenerationKey(key), savedResearch);
      const planId = store.getWorkspace().activePlan.id;
      completion = new Promise<void>((resolve) => { finished = resolve; });
      makeService().enqueuePlanningSessionGeneration(session, workspace);
      await completion;
      assert.equal(store.getWorkspace().activePlan.id, planId);
      assert.equal(itineraryCalls, 2);
      assert.equal(researchCalls, legacy ? 1 : 2);
    } finally {
      await server.close();
      store.close();
    }
  });
}

test("Landi generation runs targeted day-completion research for a candidate-gap sightseeing day", async () => {
  const store = new SqliteWorkspaceStore(":memory:");
  let researchCalls = 0;
  let targetedRequest = "";
  let targetedScope = "";
  let itineraryCalls = 0;
  let finished!: () => void;
  const completion = new Promise<void>((resolve) => { finished = resolve; });
  const adapter = new class extends CodexRuntimeAdapter {
    override async generateSkillResearchBatch(input: SkillResearchBatchRequest): Promise<SkillResearchBatchArtifact> {
      researchCalls++;
      if (input.batch.id.startsWith("completion-")) {
        targetedRequest = input.request;
        targetedScope = input.batch.scopeLabel;
        const anchorMatch = /Current anchors: (\[[^\n]+\])/u.exec(input.request);
        const anchorId = anchorMatch
          ? JSON.parse(anchorMatch[1]!)[0].id
          : "tanah-lot";
        return {
          ...input.batch,
          completedAt: now,
          sources: [],
          events: [{ id: "anchor-event", title: "Anchor-only context", placeId: anchorId, description: "Should lose the broad-place reference during targeted import.", sourceUrls: [] }],
          actionRequirements: [{ id: "anchor-ticket", kind: "reservation", title: "Anchor ticket", description: "Broad-place action context.", accountableParty: "traveler", completionCondition: "Review before final scheduling.", placeId: anchorId, sourceUrls: [] }],
          places: [
            { id: "kediri-market", name: "Kediri Market", locationLabel: "Kediri, Tabanan", city: "Tabanan", area: "Beraban", category: "market", priority: "preferred", coordinates: [-8.58, 115.13], durationMinutes: 90, whyWorthIt: "Adds local food and daily-life context near the coastal temple.", plan: "Pair with Tanah Lot when completing a west-coast day.", sourceUrls: [] },
            { id: "yeh-gangga", name: "Yeh Gangga Beach", locationLabel: "Tabanan", city: "Tabanan", area: "Beraban", category: "beach", priority: "nearby", coordinates: [-8.59, 115.1], durationMinutes: 120, whyWorthIt: "A slower coastal walk after the temple and market.", plan: "Walk the shore in daylight.", sourceUrls: [] }
          ],
          relationships: [{ kind: "same_area", fromPlaceId: "kediri-market", toPlaceId: anchorId, rationale: "Both sit in the same west-coast Tabanan direction." }],
          localFoods: [{ id: "market-food", title: "Market snacks", description: "Use only retained targeted candidates.", context: "Lunch", diningPlaceIds: ["kediri-market", anchorId, "place-scope-1-2121-design-sight-e4ot95"], sourceUrls: [] }],
          localProducts: [{ id: "market-craft", title: "Market craft", description: "Local goods near the added candidate.", context: "Shopping", purchasePlaceIds: ["kediri-market", anchorId], sourceUrls: [] }],
          experienceThemes: [{ id: "market-theme", title: "Market texture", description: "Complements the day without retaining broad refs.", context: "Afternoon", offeringPlaceIds: ["kediri-market", anchorId], sourceUrls: [] }],
          travelTips: [{ id: "anchor-tip", title: "Anchor context", body: "Check local transport timing.", context: "Timing", placeId: anchorId, sourceUrls: [] }],
          preparationChecklist: [{ id: "anchor-prep", title: "Anchor prep", group: "bookings_departure", completionCondition: "Review the booking window.", placeId: anchorId, sourceUrls: [] }]
        };
      }
      return {
        ...input.batch,
        completedAt: now,
        sources: [],
        events: [],
        actionRequirements: [],
        places: [{ id: "tanah-lot", name: "Tanah Lot", locationLabel: "Beraban, Tabanan", city: "Tabanan", area: "Beraban", category: "sea temple", priority: "preferred", coordinates: [-8.6212, 115.0868], durationMinutes: 90, whyWorthIt: "Offshore sea-temple setting.", plan: "Visit permitted areas and check tide.", sourceUrls: [] }]
      };
    }
    override async generateSkillItinerary(input: SkillItineraryRequest): Promise<SkillItineraryArtifact> {
      itineraryCalls++;
      const anchor = input.research.places.find((place) => place.name === "Tanah Lot");
      const candidate = input.research.places.find((place) => place.name === "Kediri Market");
      const extra = input.research.places.find((place) => place.name === "Yeh Gangga Beach");
      assert.ok(anchor);
      const hasCompletionCandidate = Boolean(candidate);
      return {
        title: "Bali", summary: "West-coast completion", language: "en", destinations: ["Bali"], startDate: "2026-10-11", endDate: "2026-10-11",
        days: [{
          id: "day-2026-10-11",
          date: "2026-10-11",
          kind: "scheduled",
          city: "Tabanan",
          title: "Tanah Lot Coastal Temple",
          summary: hasCompletionCandidate ? "A fuller west-coast day." : "A one-anchor final sightseeing day.",
          stops: hasCompletionCandidate && candidate
            ? [{ placeId: anchor.id, order: 1 }, { placeId: candidate.id, order: 2 }, ...(input.repair && extra ? [{ placeId: extra.id, order: 3 }] : [])]
            : [{ placeId: anchor.id, order: 1 }],
          blocks: hasCompletionCandidate && candidate
            ? [
              { id: "tanah", kind: "stop", order: 1, placeId: anchor.id, durationMinutes: 90, evidence: [] },
              { id: "market", kind: "stop", order: 2, placeId: candidate.id, durationMinutes: 90, evidence: [] },
              ...(input.repair && extra ? [{ id: "beach", kind: "stop" as const, order: 3, placeId: extra.id, durationMinutes: 120, evidence: [] }] : [])
            ]
            : [{ id: "tanah", kind: "stop", order: 1, placeId: anchor.id, durationMinutes: 90, evidence: [] }],
          candidatePlaceIds: []
        }],
        movements: hasCompletionCandidate && candidate ? [{ id: "m1", dayId: "day-2026-10-11", originPlaceId: anchor.id, destinationPlaceId: candidate.id, mode: "driving", status: "recheck", durationMinutes: 25, evidence: [] }] : []
      };
    }
  }();
  try {
    const session = confirmedSession(store, {
      destination: "Bali",
      travel_dates: "2026-10-11 to 2026-10-11",
      arrival: "arrive at 09:00",
      departure: "depart after the trip",
      party_size: "3",
      transport_preference: "Landi推荐"
    });
    const service = createPlanningGenerationService({ store, codex: adapter, setGeneratingPlan: (running) => { if (!running) finished(); }, logGenerationFailure: () => {} });
    const workspace = store.getWorkspace();
    workspace.runtime.selectedKind = "codex";
    const job = service.enqueuePlanningSessionGeneration(session, workspace);
    await completion;
    assert.equal(job.status, "succeeded", job.message);
    const blueprint = store.getTripBlueprintByGenerationKey(`${session.id}:1:${LANDI_BLUEPRINT_SKILL.skillId}@${LANDI_BLUEPRINT_SKILL.skillVersion}`)!;
    assert.equal(researchCalls, 2, "A same-day trip researches its route and completion candidates, without an overnight-anchor batch.");
    assert.equal(itineraryCalls, 3);
    assert.match(targetedRequest, /Targeted Stage 3\.10 day-completion research/);
    assert.match(targetedRequest, /Target date: 2026-10-11/);
    assert.match(targetedScope, /day completion near Beraban/);
    assert.equal(blueprint.days[0]!.stops.length, 3);
    const research = store.getResearchSetByGenerationKey(blueprint.generationKey)!;
    assert.ok(research.places.some((place) => place.name === "Kediri Market"));
    const placeIds = new Set(research.places.map((place) => place.id));
    for (const item of research.localFoods ?? []) for (const id of item.diningPlaceIds) assert.equal(placeIds.has(id), true);
    for (const item of research.localProducts ?? []) for (const id of item.purchasePlaceIds) assert.equal(placeIds.has(id), true);
    for (const item of research.experienceThemes ?? []) for (const id of item.offeringPlaceIds) assert.equal(placeIds.has(id), true);
    assert.equal(research.events.find((event) => event.id.includes("anchor-event"))?.placeId, undefined);
    assert.equal(research.actionRequirements.find((requirement) => requirement.id.includes("anchor-ticket"))?.placeId, undefined);
    assert.equal(research.travelTips?.find((tip) => tip.id.includes("anchor-tip"))?.placeId, undefined);
    assert.equal(research.preparationChecklist?.find((item) => item.id.includes("anchor-prep"))?.placeId, undefined);
  } finally {
    store.close();
  }
});

test("generation does not deliver a hotel-only full destination day after a failed completion repair", async () => {
  const store = new SqliteWorkspaceStore(":memory:");
  let itineraryCalls = 0;
  let finished!: () => void;
  const completion = new Promise<void>((resolve) => { finished = resolve; });
  const adapter = new class extends CodexRuntimeAdapter {
    override async generateSkillResearchBatch(input: SkillResearchBatchRequest): Promise<SkillResearchBatchArtifact> {
      return {
        ...input.batch, completedAt: now, sources: [], events: [], actionRequirements: [],
        places: input.batch.id.startsWith("completion-")
          ? [{ id: "museum", name: "Wellington Museum", city: "Wellington", category: "museum", locationLabel: "Wellington", coordinates: [-41.28, 174.78], durationMinutes: 90, whyWorthIt: "Local culture", plan: "Visit the museum", sourceUrls: [] }]
          : [{ id: "hotel", name: "Wellington Hotel", city: "Wellington", category: "hotel", locationLabel: "Wellington", coordinates: [-41.28, 174.78], accommodation: { state: "recommended" }, whyWorthIt: "Central base", plan: "Stay here", sourceUrls: [] }]
      };
    }
    override async generateSkillItinerary(input: SkillItineraryRequest): Promise<SkillItineraryArtifact> {
      itineraryCalls++;
      const hotel = input.research.places.find((place) => place.name === "Wellington Hotel")!;
      return {
        title: "Wellington", summary: "Budget trip", language: "en", destinations: ["Wellington"], startDate: "2026-12-17", endDate: "2026-12-17",
        days: [{ id: "day", date: "2026-12-17", kind: "free_time", city: "Wellington", title: "Weather buffer", summary: "Use the day for weather flexibility.", stops: [], candidatePlaceIds: [], blocks: [
          { id: "start", kind: "lodging", order: 1, placeId: hotel.id, title: "Wellington Hotel", summary: "Start from the hotel base.", evidence: [] },
          { id: "end", kind: "lodging", order: 2, placeId: hotel.id, title: "Wellington Hotel", summary: "Return to the hotel base.", evidence: [] }
        ] }], movements: []
      };
    }
  }();
  try {
    const session = confirmedSession(store, { destination: "Wellington", travel_dates: "2026-12-17 to 2026-12-17", arrival: "already in Wellington", departure: "after the trip", party_size: "2", transport_preference: "walking" });
    const service = createPlanningGenerationService({ store, codex: adapter, setGeneratingPlan: (running) => { if (!running) finished(); }, logGenerationFailure: () => {} });
    const workspace = store.getWorkspace();
    workspace.runtime.selectedKind = "codex";
    const job = service.enqueuePlanningSessionGeneration(session, workspace);
    await completion;
    assert.equal(itineraryCalls, 4);
    assert.equal(job.status, "failed");
    assert.match(job.message ?? "", /has no usable daytime plan/);
    assert.equal(store.getWorkspace().activePlan.id, workspace.activePlan.id);
    let resumed!: () => void;
    const retryFinished = new Promise<void>((resolve) => { resumed = resolve; });
    const retryService = createPlanningGenerationService({ store, codex: adapter, setGeneratingPlan: (running) => { if (!running) resumed(); }, logGenerationFailure: () => {} });
    const retryJob = retryService.enqueuePlanningSessionGeneration(session, workspace);
    await retryFinished;
    assert.equal(retryJob.status, "failed");
    assert.equal(itineraryCalls, 6, "Retry reuses the completed composition and spends only the two shared corrections.");
    assert.ok(store.getBlueprintGenerationEvents(job.generationKey).some((event) => event.detail.startsWith("Reusing saved day-completion work")));
  } finally {
    store.close();
  }
});

test("generation supplements an exhausted Explore catalog once and keeps the accepted itinerary unchanged", async () => {
  const store = new SqliteWorkspaceStore(":memory:");
  let researchCalls = 0;
  let timingRepairCalls = 0;
  let finished!: () => void;
  const completion = new Promise<void>((resolve) => { finished = resolve; });
  const initialPlaces = ["museum", "garden", "market", "gallery"].map((id, index) => ({
    id,
    name: id,
    locationLabel: "Central Lisbon",
    city: "Lisbon",
    area: "Central Lisbon",
    category: index === 2 ? "food market" : "museum",
    coordinates: [38.71 + index * 0.001, -9.14] as [number, number],
    display: { type: index === 2 ? "dining" as const : "attraction" as const },
    durationMinutes: 300,
    whyWorthIt: `${id} supports the formal route.`,
    plan: `Use ${id} as the day's anchor.`,
    sourceUrls: []
  }));
  const adapter = new class extends CodexRuntimeAdapter {
    override async generateSkillResearchBatch(input: SkillResearchBatchRequest): Promise<SkillResearchBatchArtifact> {
      researchCalls++;
      if (input.batch.id === "explore-supply") {
        assert.match(input.request, /Keep them unscheduled/i);
        assert.equal(input.timeoutMs, 5 * 60_000);
        return {
          ...input.batch,
          completedAt: now,
          sources: [], events: [], actionRequirements: [],
          places: [
            { id: "cafe", name: "Neighborhood cafe", locationLabel: "Central Lisbon", city: "Lisbon", area: "Central Lisbon", category: "cafe", coordinates: [38.715, -9.142], display: { type: "dining" }, durationMinutes: 60, whyWorthIt: "A low-energy local pause near the main route.", plan: "Add only when the traveler wants a slower afternoon.", sourceUrls: [] },
            { id: "workshop", name: "Tile workshop", locationLabel: "Central Lisbon", city: "Lisbon", area: "Central Lisbon", category: "craft workshop", coordinates: [38.716, -9.141], display: { type: "experience" }, durationMinutes: 120, whyWorthIt: "A hands-on local experience distinct from the museum route.", plan: "Add after checking the session time.", sourceUrls: [] }
          ]
        };
      }
      return { ...input.batch, completedAt: now, sources: [], events: [], actionRequirements: [], places: initialPlaces };
    }
    override async generateSkillItinerary(input: SkillItineraryRequest): Promise<SkillItineraryArtifact> {
      if (input.repair) {
        timingRepairCalls++;
        assert.match(input.repair.issues.join(" "), /lacks a useful proposed start/);
      }
      return {
        title: "Lisbon", summary: "Four accepted city days", language: "en", destinations: ["Lisbon"], startDate: "2026-10-12", endDate: "2026-10-15",
        days: input.research.places.slice(0, 4).map((place, index) => ({ id: `d${index + 1}`, date: `2026-10-${12 + index}`, kind: "scheduled" as const, city: "Lisbon", title: place.name, summary: `A complete day around ${place.name}.`, stops: [{ placeId: place.id, order: 1, ...(input.repair ? { time: "10:00" } : {}) }], blocks: [{ id: `b${index + 1}`, kind: "stop" as const, order: 1, placeId: place.id, ...(input.repair ? { startTime: "10:00", display: { timingStatus: "planned" as const } } : {}), durationMinutes: 300, evidence: [] }], candidatePlaceIds: [] })),
        movements: []
      };
    }
  }();
  try {
    const session = confirmedSession(store, { destination: "Lisbon", travel_dates: "2026-10-12 to 2026-10-15", arrival: "arrive before the trip", departure: "depart after the trip", party_size: "2", transport_preference: "walking" });
    const service = createPlanningGenerationService({ store, codex: adapter, setGeneratingPlan: (running) => { if (!running) finished(); }, logGenerationFailure: () => {} });
    const workspace = store.getWorkspace();
    workspace.runtime.selectedKind = "codex";
    const job = service.enqueuePlanningSessionGeneration(session, workspace);
    await completion;
    assert.equal(job.status, "succeeded", job.message);
    assert.equal(timingRepairCalls, 1);
    assert.equal(researchCalls, 3);
    const blueprint = store.getTripBlueprintByGenerationKey(job.generationKey)!;
    const nameById = new Map(blueprint.places.map((place) => [place.id, place.name] as const));
    assert.deepEqual(blueprint.days.flatMap((day) => day.stops.map((stop) => nameById.get(stop.placeId))), ["museum", "garden", "market", "gallery"]);
    assert.deepEqual(blueprint.places.filter((place) => !blueprint.days.some((day) => day.stops.some((stop) => stop.placeId === place.id))).map((place) => place.name), ["Neighborhood cafe", "Tile workshop"]);
    assert.equal(blueprint.version, 3);
    assert.deepEqual(store.getResearchSetByGenerationKey(job.generationKey)?.places.map((place) => place.id), blueprint.places.map((place) => place.id));
  } finally {
    store.close();
  }
});

test("Explore supplement failure is fail-soft and does not discard the accepted draft", async () => {
  const store = new SqliteWorkspaceStore(":memory:");
  let finished!: () => void;
  const completion = new Promise<void>((resolve) => { finished = resolve; });
  let calls = 0;
  const adapter = new class extends CodexRuntimeAdapter {
    override async generateSkillResearchBatch(input: SkillResearchBatchRequest): Promise<SkillResearchBatchArtifact> {
      calls++;
      if (input.batch.id === "explore-supply") {
        assert.equal(input.timeoutMs, 5 * 60_000);
        throw new RuntimeAdapterError("timed_out", "Supplement timed out.");
      }
      return {
        ...input.batch, completedAt: now, sources: [], events: [], actionRequirements: [],
        places: ["a", "b", "c"].map((id, index) => ({ id, name: id, locationLabel: "Ubud", city: "Bali", area: "Ubud", category: "museum", coordinates: [-8.5 + index * 0.001, 115.2], display: { type: "attraction" }, durationMinutes: 300, whyWorthIt: `${id} is a sourced anchor.`, plan: `Use ${id} on its accepted day.`, sourceUrls: [] }))
      };
    }
    override async generateSkillItinerary(input: SkillItineraryRequest): Promise<SkillItineraryArtifact> {
      return { title: "Bali", summary: "Accepted route", language: "en", destinations: ["Bali"], startDate: "2026-10-06", endDate: "2026-10-08", days: input.research.places.map((place, index) => ({ id: `d${index}`, date: `2026-10-0${6 + index}`, kind: "scheduled" as const, city: "Bali", title: place.name, summary: place.name, stops: [{ placeId: place.id, order: 1, time: "10:00" }], blocks: [{ id: `b${index}`, kind: "stop" as const, order: 1, placeId: place.id, startTime: "10:00", display: { timingStatus: "planned" as const }, durationMinutes: 300, evidence: [] }], candidatePlaceIds: [] })), movements: [] };
    }
  }();
  try {
    const session = confirmedSession(store, { destination: "Bali", travel_dates: "2026-10-06 to 2026-10-08", arrival: "arrive before the trip", departure: "depart after the trip", party_size: "2", transport_preference: "walking" });
    const service = createPlanningGenerationService({ store, codex: adapter, setGeneratingPlan: (running) => { if (!running) finished(); }, logGenerationFailure: () => {} });
    const workspace = store.getWorkspace();
    workspace.runtime.selectedKind = "codex";
    const job = service.enqueuePlanningSessionGeneration(session, workspace);
    await completion;
    assert.equal(job.status, "succeeded", job.message);
    assert.equal(calls, 3);
    assert.equal(store.getWorkspace().activePlan.status, "draft");
    assert.equal(store.getWorkspace().activeBlueprint?.places.length, 3);
  } finally {
    store.close();
  }
});

test("semantic shadow stays disabled by default and does not call semantic planner", async () => {
  const store = new SqliteWorkspaceStore(":memory:");
  let semanticCalls = 0;
  let finished!: () => void;
  const completion = new Promise<void>((resolve) => { finished = resolve; });
  const adapter = new class extends BasicGenerationAdapter {
    override async generateSemanticTravelPlan(_input: SemanticTravelPlanRequest): Promise<SemanticTravelPlanResult> {
      semanticCalls++;
      return semanticPlanResult();
    }
  }();
  try {
    const session = confirmedSession(store, {
      destination: "Lisbon",
      travel_dates: "2026-10-12 to 2026-10-13",
      arrival: "Lisbon airport at 09:00",
      departure: "Lisbon airport at 18:00",
      party_size: "2",
      transport_preference: "walking"
    });
    const service = createPlanningGenerationService({ store, codex: adapter, setGeneratingPlan: (running) => { if (!running) finished(); }, logGenerationFailure: () => {} });
    const workspace = store.getWorkspace();
    workspace.runtime.selectedKind = "codex";
    const job = service.enqueuePlanningSessionGeneration(session, workspace);
    await completion;
    assert.equal(job.status, "succeeded", job.message);
    assert.equal(semanticCalls, 0);
    assert.equal(store.listDiagnosticArtifacts(job.generationKey).length, 0);
  } finally {
    store.close();
  }
});

test("eligible local Canary uses the direct Semantic chain, publishes a draft, and does not schedule Shadow", async () => {
  const store = new SqliteWorkspaceStore(":memory:");
  let itineraryCalls = 0;
  let semanticCalls = 0;
  let repairCalls = 0;
  let shadowSchedulingReached = 0;
  let semanticRequest = "";
  let finished!: () => void;
  const completion = new Promise<void>((resolve) => { finished = resolve; });
  const adapter = new class extends BasicGenerationAdapter {
    override async generateSkillItinerary(input: SkillItineraryRequest): Promise<SkillItineraryArtifact> {
      itineraryCalls++;
      return super.generateSkillItinerary(input);
    }
    override async generateSemanticTravelPlan(input: SemanticTravelPlanRequest): Promise<SemanticTravelPlanResult> {
      semanticCalls++;
      semanticRequest = input.request;
      return { rawJson: "{}", plan: semanticCanaryPlan([], "Lisbon", true) };
    }
    override async generateSemanticTravelPlanRepair(): Promise<SemanticTravelPlanResult> {
      repairCalls++;
      return { rawJson: "{}", plan: semanticCanaryPlan() };
    }
  }();
  try {
    const session = confirmedSession(store, {
      destination: "Lisbon",
      travel_dates: "October 12–12, 2026",
      arrival: "Lisbon airport at 09:00",
      departure: "Lisbon airport at 18:00",
      party_size: "2",
      transport_preference: "walking"
    });
    const service = createPlanningGenerationService({
      store,
      codex: adapter,
      semanticDraftCanary: { enabled: true, localEnvironment: true, allowedSessionIds: [session.id] },
      semanticShadow: { enabled: true, sampleRate: 1, timeoutMs: 5_000 },
      onSemanticShadowDiagnostic: (event) => { if (event.event === "scheduling_branch_reached") shadowSchedulingReached++; },
      setGeneratingPlan: (running) => { if (!running) finished(); },
      logGenerationFailure: () => {}
    });
    const workspace = store.getWorkspace();
    workspace.runtime.selectedKind = "codex";
    const job = service.enqueuePlanningSessionGeneration(session, workspace);
    await completion;
    assert.equal(job.status, "succeeded", job.message);
    assert.equal(job.strategy, "semantic_canary");
    assert.equal(itineraryCalls, 0);
    assert.equal(semanticCalls, 1);
    assert.match(semanticRequest, /travel_dates: October 12–12, 2026/);
    assert.match(semanticRequest, /2026-10-12 to 2026-10-12/);
    assert.equal(repairCalls, 0);
    assert.equal(shadowSchedulingReached, 0);
    assert.equal(store.getWorkspace().activePlan.status, "draft");
    assert.equal(store.getWorkspace().activePlan.location, "Lisbon");
    assert.deepEqual(store.getTripBlueprintByGenerationKey(job.generationKey)?.destinations, ["Lisbon"]);
    assert.equal(store.getWorkspace().executionPlan, undefined);
    const report = JSON.parse(store.listDiagnosticArtifacts(job.generationKey)[0]!.rawResponse);
    assert.equal(report.type, "semantic_draft_canary_v1");
    assert.equal(report.validator.finalResult, "pass_with_rechecks");
    assert.equal(report.calls.legacyItinerary, 0);
    assert.equal(report.calls.semanticShadow, 0);
    assert.equal(report.semanticArtifact.rawSemanticOutput, "{}");
    assert.equal(report.semanticArtifact.finalPlan.title, "Lisbon controlled draft");
    assert.equal(report.semanticArtifact.finalPlan.dailyItinerary[0].date, "2026-10-12");
    assert.equal(report.semanticArtifact.finalValidatorReport.result, "pass_with_rechecks");
    assert.equal(report.semanticArtifact.structurer.fidelity.some((item: { classification: string }) => item.classification === "CHANGED" || item.classification === "DROPPED"), false);
    assert.deepEqual(report.semanticArtifact.publicationGate, { passed: true });
    assert.equal(report.readinessTrace.occurrences.length, 1);
    assert.equal(store.getTripBlueprintByGenerationKey(job.generationKey)?.days[0]?.blocks?.find((block) => block.title === "Compact archaeological alternative")?.kind, "flexible");
  } finally {
    store.close();
  }
});

test("Porto Canary keeps a confirmed hotel address out of destination scopes and completes the full publication path", async () => {
  const store = new SqliteWorkspaceStore(":memory:");
  const researchScopes: string[] = [];
  let plannerCommitments: SemanticTravelPlanRequest["fixedCommitments"] = [];
  let finished!: () => void;
  const completion = new Promise<void>((resolve) => { finished = resolve; });
  const adapter = new class extends BasicGenerationAdapter {
    override async generateSkillResearchBatch(input: SkillResearchBatchRequest): Promise<SkillResearchBatchArtifact> {
      researchScopes.push(input.batch.scopeLabel);
      return super.generateSkillResearchBatch(input);
    }
    override async generateSemanticTravelPlan(input: SemanticTravelPlanRequest): Promise<SemanticTravelPlanResult> {
      plannerCommitments = input.fixedCommitments;
      return { rawJson: "{}", plan: semanticCanaryPlan(plannerCommitments, "Porto, Portugal") };
    }
  }();
  try {
    const session = confirmedSession(store, {
      destination: "Porto, Portugal",
      travel_dates: "2026-10-12 to 2026-10-12",
      arrival: "Porto airport at 09:00",
      departure: "Porto airport at 18:00",
      party_size: "2",
      transport_preference: "walking"
    });
    saveConfirmedHotel(store, session.id);
    const service = createPlanningGenerationService({
      store,
      codex: adapter,
      semanticDraftCanary: { enabled: true, localEnvironment: true, allowedSessionIds: [session.id] },
      semanticShadow: { enabled: false, sampleRate: 0, timeoutMs: 5_000 },
      setGeneratingPlan: (running) => { if (!running) finished(); },
      logGenerationFailure: () => {}
    });
    const workspace = store.getWorkspace();
    workspace.runtime.selectedKind = "codex";
    const job = service.enqueuePlanningSessionGeneration(session, workspace);
    await completion;

    assert.equal(job.status, "succeeded", job.message);
    assert.deepEqual(researchScopes, ["Porto, Portugal"]);
    assert.equal(store.getWorkspace().activePlan.status, "draft");
    assert.deepEqual(store.getTripBlueprintByGenerationKey(job.generationKey)?.destinations, ["Porto, Portugal"]);
    assert.equal(store.getWorkspace().executionPlan, undefined);
    const diagnostic = JSON.parse(store.listDiagnosticArtifacts(job.generationKey)[0]!.rawResponse);
    assert.deepEqual(diagnostic.inputs.confirmedTripDestinations, [{ value: "Porto, Portugal", source: "user" }]);
    assert.deepEqual(diagnostic.inputs.researchScopes, ["Porto, Portugal"]);
    assert.equal(diagnostic.inputs.accommodationLocations[0].value, "Praca da Batalha, Porto, Portugal");
    assert.equal(diagnostic.destinationGate.matched, true);
    assert.deepEqual(diagnostic.stages, { importExecuted: true, importCompleted: true, compileExecuted: true, compileCompleted: true });
  } finally {
    store.close();
  }
});

test("destination gate comparison still rejects a genuinely different Semantic destination", () => {
  assert.equal(destinationGateComparison(["Porto, Portugal"], ["Lisbon, Portugal"]).matched, false);
  assert.equal(destinationGateComparison(["Lisbon", "Porto"], ["Porto", "Lisbon"]).matched, true);
});

test("Canary eligibility cannot be forced outside the trusted local environment", async () => {
  const store = new SqliteWorkspaceStore(":memory:");
  let itineraryCalls = 0;
  let semanticCalls = 0;
  let finished!: () => void;
  const completion = new Promise<void>((resolve) => { finished = resolve; });
  const adapter = new class extends BasicGenerationAdapter {
    override async generateSkillItinerary(input: SkillItineraryRequest): Promise<SkillItineraryArtifact> {
      itineraryCalls++;
      return super.generateSkillItinerary(input);
    }
    override async generateSemanticTravelPlan(): Promise<SemanticTravelPlanResult> {
      semanticCalls++;
      return { rawJson: "{}", plan: semanticCanaryPlan() };
    }
  }();
  try {
    const session = confirmedSession(store, { destination: "Bali", travel_dates: "2026-10-12 to 2026-10-12", arrival: "DPS airport at 09:00", departure: "DPS airport at 18:00", party_size: "2", transport_preference: "walking" });
    const service = createPlanningGenerationService({
      store,
      codex: adapter,
      semanticDraftCanary: { enabled: true, localEnvironment: false, allowedSessionIds: [session.id] },
      setGeneratingPlan: (running) => { if (!running) finished(); },
      logGenerationFailure: () => {}
    });
    const workspace = store.getWorkspace();
    workspace.runtime.selectedKind = "codex";
    const job = service.enqueuePlanningSessionGeneration(session, workspace);
    await completion;
    assert.equal(job.strategy, "legacy");
    assert.equal(job.status, "succeeded", job.message);
    assert.ok(itineraryCalls > 0);
    assert.equal(semanticCalls, 0);
  } finally {
    store.close();
  }
});

test("Canary repairs at most once and refuses publication when a hard commitment is still missing", async () => {
  const store = new SqliteWorkspaceStore(":memory:");
  let itineraryCalls = 0;
  let semanticCalls = 0;
  let repairCalls = 0;
  let finished!: () => void;
  const completion = new Promise<void>((resolve) => { finished = resolve; });
  const adapter = new class extends BasicGenerationAdapter {
    override async generateSkillItinerary(input: SkillItineraryRequest): Promise<SkillItineraryArtifact> {
      itineraryCalls++;
      return super.generateSkillItinerary(input);
    }
    override async generateSemanticTravelPlan(): Promise<SemanticTravelPlanResult> {
      semanticCalls++;
      return { rawJson: "{}", plan: semanticCanaryPlan() };
    }
    override async generateSemanticTravelPlanRepair(): Promise<SemanticTravelPlanResult> {
      repairCalls++;
      return { rawJson: "{}", plan: semanticCanaryPlan() };
    }
  }();
  try {
    const originalPlanId = store.getWorkspace().activePlan.id;
    const session = confirmedSession(store, { destination: "Bali", travel_dates: "2026-10-12 to 2026-10-12", arrival: "DPS airport at 09:00", departure: "DPS airport at 18:00", party_size: "2", transport_preference: "walking" });
    saveConfirmedFlight(store, session.id);
    const service = createPlanningGenerationService({
      store,
      codex: adapter,
      semanticDraftCanary: { enabled: true, localEnvironment: true, allowedSessionIds: [session.id] },
      setGeneratingPlan: (running) => { if (!running) finished(); },
      logGenerationFailure: () => {}
    });
    const workspace = store.getWorkspace();
    workspace.runtime.selectedKind = "codex";
    const job = service.enqueuePlanningSessionGeneration(session, workspace);
    await completion;
    assert.equal(job.status, "failed");
    assert.equal(semanticCalls, 1);
    assert.equal(repairCalls, 1);
    assert.equal(itineraryCalls, 0);
    assert.equal(store.getWorkspace().activePlan.id, originalPlanId);
    assert.equal(store.getWorkspace().executionPlan, undefined);
    assert.equal(store.getPlanningSessionById(session.id)?.status, "proposal_ready");
    const diagnostic = JSON.parse(store.listDiagnosticArtifacts(job.generationKey)[0]!.rawResponse);
    assert.equal(diagnostic.status.value, "failed");
    assert.equal(diagnostic.status.failureStage, "post_repair_validator");
    assert.equal(diagnostic.authority.draftPublished, false);
  } finally {
    store.close();
  }
});

test("Canary successful repair validates once more and compiles only the repaired final plan", async () => {
  const store = new SqliteWorkspaceStore(":memory:");
  let plannerCommitments: SemanticTravelPlan["fixedCommitments"] = [];
  let itineraryCalls = 0;
  let repairCalls = 0;
  let finished!: () => void;
  const completion = new Promise<void>((resolve) => { finished = resolve; });
  const adapter = new class extends BasicGenerationAdapter {
    override async generateSkillItinerary(input: SkillItineraryRequest): Promise<SkillItineraryArtifact> {
      itineraryCalls++;
      return super.generateSkillItinerary(input);
    }
    override async generateSemanticTravelPlan(input: SemanticTravelPlanRequest): Promise<SemanticTravelPlanResult> {
      plannerCommitments = input.fixedCommitments;
      return { rawJson: "{}", plan: semanticCanaryPlan() };
    }
    override async generateSemanticTravelPlanRepair(): Promise<SemanticTravelPlanResult> {
      repairCalls++;
      return { rawJson: "{}", plan: semanticCanaryPlan(plannerCommitments) };
    }
  }();
  try {
    const session = confirmedSession(store, { destination: "Bali", travel_dates: "2026-10-12 to 2026-10-12", arrival: "DPS airport at 09:00", departure: "DPS airport at 18:00", party_size: "2", transport_preference: "walking" });
    saveConfirmedFlight(store, session.id);
    const service = createPlanningGenerationService({
      store,
      codex: adapter,
      semanticDraftCanary: { enabled: true, localEnvironment: true, allowedSessionIds: [session.id] },
      setGeneratingPlan: (running) => { if (!running) finished(); },
      logGenerationFailure: () => {}
    });
    const workspace = store.getWorkspace();
    workspace.runtime.selectedKind = "codex";
    const job = service.enqueuePlanningSessionGeneration(session, workspace);
    await completion;
    assert.equal(job.status, "succeeded", job.message);
    assert.equal(repairCalls, 1);
    assert.equal(itineraryCalls, 0);
    const blueprint = store.getTripBlueprintByGenerationKey(job.generationKey)!;
    assert.equal(blueprint.bookingConstraints?.[0]?.id, "booking-canary-flight");
    const report = JSON.parse(store.listDiagnosticArtifacts(job.generationKey)[0]!.rawResponse);
    assert.equal(report.validator.initialResult, "repair_required");
    assert.notEqual(report.validator.finalResult, "repair_required");
    assert.equal(report.calls.repair, 1);
    assert.equal(report.calls.validator, 2);
    assert.equal(store.getWorkspace().activePlan.status, "draft");
    assert.equal(store.getWorkspace().executionPlan, undefined);
  } finally {
    store.close();
  }
});

test("Canary provider failure terminates without legacy fallback or plan replacement", async () => {
  const store = new SqliteWorkspaceStore(":memory:");
  let itineraryCalls = 0;
  let finished!: () => void;
  const completion = new Promise<void>((resolve) => { finished = resolve; });
  const adapter = new class extends BasicGenerationAdapter {
    override async generateSkillItinerary(input: SkillItineraryRequest): Promise<SkillItineraryArtifact> {
      itineraryCalls++;
      return super.generateSkillItinerary(input);
    }
    override async generateSemanticTravelPlan(): Promise<SemanticTravelPlanResult> {
      throw new RuntimeAdapterError("timed_out", "Semantic provider timed out.");
    }
  }();
  try {
    const originalPlanId = store.getWorkspace().activePlan.id;
    const session = confirmedSession(store, { destination: "Bali", travel_dates: "2026-10-12 to 2026-10-12", arrival: "DPS airport at 09:00", departure: "DPS airport at 18:00", party_size: "2", transport_preference: "walking" });
    const service = createPlanningGenerationService({
      store,
      codex: adapter,
      semanticDraftCanary: { enabled: true, localEnvironment: true, allowedSessionIds: [session.id] },
      setGeneratingPlan: (running) => { if (!running) finished(); },
      logGenerationFailure: () => {}
    });
    const workspace = store.getWorkspace();
    workspace.runtime.selectedKind = "codex";
    const job = service.enqueuePlanningSessionGeneration(session, workspace);
    await completion;
    assert.equal(job.status, "failed");
    assert.equal(job.failureCode, "timed_out");
    assert.equal(itineraryCalls, 0);
    assert.equal(store.getWorkspace().activePlan.id, originalPlanId);
    assert.equal(store.getWorkspace().executionPlan, undefined);
    const diagnostic = JSON.parse(store.listDiagnosticArtifacts(job.generationKey)[0]!.rawResponse);
    assert.equal(diagnostic.status.failureStage, "planner");
    assert.equal(diagnostic.status.failureCode, "timed_out");
  } finally {
    store.close();
  }
});

test("Canary import failure preserves a bounded A-B-A stop and movement diagnostic", async () => {
  const store = new SqliteWorkspaceStore(":memory:");
  let finished!: () => void;
  const completion = new Promise<void>((resolve) => { finished = resolve; });
  const duplicatePlan = semanticCanaryPlan([], "Lisbon");
  duplicatePlan.dailyItinerary[0]!.experiences = [
    { title: "Museum collection", placeName: "Museum", planRole: "planned", summary: "See the collection." },
    { title: "Gallery visit", placeName: "Gallery", planRole: "planned", summary: "See the gallery." },
    { title: "Museum architecture", placeName: "Museum", planRole: "planned", summary: "Return to study the building." }
  ];
  const adapter = new class extends BasicGenerationAdapter {
    override async generateSkillResearchBatch(input: SkillResearchBatchRequest): Promise<SkillResearchBatchArtifact> {
      const artifact = batch(input);
      artifact.places.push({ id: "gallery", name: "Gallery", locationLabel: "Lisbon", city: "Lisbon", category: "gallery", whyWorthIt: "Local exhibition", plan: "Visit the gallery", sourceUrls: [] });
      return artifact;
    }
    override async generateSemanticTravelPlan(): Promise<SemanticTravelPlanResult> {
      return { rawJson: "{}", plan: duplicatePlan };
    }
  }();
  try {
    const originalPlanId = store.getWorkspace().activePlan.id;
    const session = confirmedSession(store, { destination: "Lisbon", travel_dates: "2026-10-12 to 2026-10-12", arrival: "Lisbon airport at 09:00", departure: "Lisbon airport at 18:00", party_size: "2", transport_preference: "walking" });
    const service = createPlanningGenerationService({
      store,
      codex: adapter,
      semanticDraftCanary: { enabled: true, localEnvironment: true, allowedSessionIds: [session.id] },
      setGeneratingPlan: (running) => { if (!running) finished(); },
      logGenerationFailure: () => {}
    });
    const workspace = store.getWorkspace();
    workspace.runtime.selectedKind = "codex";
    const job = service.enqueuePlanningSessionGeneration(session, workspace);
    await completion;
    assert.equal(job.status, "failed");
    assert.equal(store.getWorkspace().activePlan.id, originalPlanId);
    const diagnostic = JSON.parse(store.listDiagnosticArtifacts(job.generationKey)[0]!.rawResponse);
    assert.equal(diagnostic.status.failureStage, "import");
    assert.equal(diagnostic.validator.finalRepairRequiredFindingCount, 0);
    assert.equal(diagnostic.calls.semanticPlanner, 1);
    assert.equal(diagnostic.calls.legacyItinerary, 0);
    assert.equal(diagnostic.calls.semanticShadow, 0);
    assert.equal(diagnostic.importFailure.semanticDays[0].experiences.length, 3);
    const stopIds = diagnostic.importFailure.normalizedDays[0].stops.map((stop: { placeId: string }) => stop.placeId);
    assert.equal(stopIds.length, 3);
    assert.equal(stopIds[0], stopIds[2]);
    assert.notEqual(stopIds[0], stopIds[1]);
    assert.equal(diagnostic.importFailure.normalizedMovements.length, 2);
    assert.match(diagnostic.importFailure.issues.join(" "), /duplicate stops/);
    assert.equal(diagnostic.authority.draftPublished, false);
  } finally {
    store.close();
  }
});

test("semantic shadow success records diagnostics without replacing authoritative draft", async () => {
  const store = new SqliteWorkspaceStore(":memory:");
  let semanticCalls = 0;
  let finished!: () => void;
  const completion = new Promise<void>((resolve) => { finished = resolve; });
  const adapter = new class extends BasicGenerationAdapter {
    override async generateSemanticTravelPlan(_input: SemanticTravelPlanRequest): Promise<SemanticTravelPlanResult> {
      semanticCalls++;
      return semanticPlanResult();
    }
  }();
  try {
    const session = confirmedSession(store, {
      destination: "Lisbon",
      travel_dates: "2026-10-12 to 2026-10-13",
      arrival: "Lisbon airport at 09:00",
      departure: "Lisbon airport at 18:00",
      party_size: "2",
      transport_preference: "walking"
    });
    const service = createPlanningGenerationService({
      store,
      codex: adapter,
      semanticShadow: { enabled: true, sampleRate: 1, timeoutMs: 5_000 },
      setGeneratingPlan: (running) => { if (!running) finished(); },
      logGenerationFailure: () => {}
    });
    const workspace = store.getWorkspace();
    workspace.runtime.selectedKind = "codex";
    const job = service.enqueuePlanningSessionGeneration(session, workspace);
    await completion;
    const legacyPlanId = store.getWorkspace().activePlan.id;
    assert.equal(job.status, "succeeded", job.message);
    await waitFor(() => store.listDiagnosticArtifacts(job.generationKey).length > 0);
    assert.equal(semanticCalls, 1);
    assert.equal(store.getWorkspace().activePlan.id, legacyPlanId);
    const report = JSON.parse(store.listDiagnosticArtifacts(job.generationKey)[0]!.rawResponse);
    assert.equal(report.type, "semantic_shadow_v1");
    assert.equal(report.status.value, "completed");
    assert.equal(report.validator.initialResult, "pass");
    assert.equal(report.repair.attempted, false);
    assert.equal(report.structurer.success, true);
  } finally {
    store.close();
  }
});

test("production generation projects two confirmed flights into automatic Semantic Shadow", async () => {
  const store = new SqliteWorkspaceStore(":memory:");
  let plannerInput: SemanticTravelPlanRequest["fixedCommitments"] | undefined;
  let finished!: () => void;
  const completion = new Promise<void>((resolve) => { finished = resolve; });
  const adapter = new class extends BasicGenerationAdapter {
    override async generateSemanticTravelPlan(input: SemanticTravelPlanRequest): Promise<SemanticTravelPlanResult> {
      plannerInput = input.fixedCommitments;
      return semanticPlanResult(input.fixedCommitments);
    }
  }();
  try {
    const session = confirmedSession(store, {
      destination: "Lisbon",
      travel_dates: "2026-10-12 to 2026-10-13",
      arrival: "Arrive Lisbon airport at 07:25",
      departure: "Depart Lisbon airport at 23:10",
      party_size: "2",
      transport_preference: "walking"
    });
    for (const [id, title, startAtLocal, origin, destination] of [
      ["arrival", "Confirmed arrival flight", "2026-10-12T07:25", "Shanghai", "Lisbon Airport"],
      ["departure", "Confirmed departure flight", "2026-10-13T23:10", "Lisbon Airport", "Shanghai"]
    ] as const) {
      store.saveTravelBooking({
        id,
        planningSessionId: session.id,
        type: "flight",
        status: "confirmed",
        title,
        source: "user",
        sourceLabel: "Fixture booking",
        sourceHash: `hash-${id}`,
        constraintStrength: "hard",
        segments: [{ id: `segment-${id}`, segmentType: "flight_leg", title, status: "confirmed", startAtLocal, startTimeZone: "Europe/Lisbon", origin, destination, constraintStrength: "hard", fixedCommitment: true, needsReviewReasons: [] }],
        importedAt: now,
        updatedAt: now
      });
    }
    const service = createPlanningGenerationService({
      store,
      codex: adapter,
      semanticShadow: { enabled: true, sampleRate: 1, timeoutMs: 5_000 },
      setGeneratingPlan: (running) => { if (!running) finished(); },
      logGenerationFailure: () => {}
    });
    const workspace = store.getWorkspace();
    workspace.runtime.selectedKind = "codex";
    const job = service.enqueuePlanningSessionGeneration(session, workspace);
    await completion;
    await waitFor(() => store.listDiagnosticArtifacts(job.generationKey).length > 0);
    assert.equal(plannerInput?.length, 2);
    assert.deepEqual(plannerInput?.map((item) => item.type), ["flight", "flight"]);
    assert.deepEqual(plannerInput?.map((item) => item.status), ["confirmed", "confirmed"]);
    assert.deepEqual(plannerInput?.map((item) => item.fixed), [true, true]);
    const report = JSON.parse(store.listDiagnosticArtifacts(job.generationKey)[0]!.rawResponse);
    assert.equal(report.comparison.fixedCommitmentCount, 2);
    assert.equal(report.comparison.missingConfirmedCommitmentCount, 0);
    assert.equal(report.commitmentPreservation.every((item: any) => item.plannerInput.directlyProvidedAsBookingConstraint), true);
    assert.equal(store.getWorkspace().executionPlan, undefined);
  } finally {
    store.close();
  }
});

test("semantic shadow planner failure persists diagnostic without changing authoritative draft", async () => {
  const store = new SqliteWorkspaceStore(":memory:");
  let semanticCalls = 0;
  let finished!: () => void;
  const completion = new Promise<void>((resolve) => { finished = resolve; });
  const adapter = new class extends BasicGenerationAdapter {
    override async generateSemanticTravelPlan(_input: SemanticTravelPlanRequest): Promise<SemanticTravelPlanResult> {
      semanticCalls++;
      throw new RuntimeAdapterError("invalid_output", "Semantic fixture failed.");
    }
  }();
  try {
    const session = confirmedSession(store, {
      destination: "Lisbon",
      travel_dates: "2026-10-12 to 2026-10-13",
      arrival: "Lisbon airport at 09:00",
      departure: "Lisbon airport at 18:00",
      party_size: "2",
      transport_preference: "walking"
    });
    const service = createPlanningGenerationService({
      store,
      codex: adapter,
      semanticShadow: { enabled: true, sampleRate: 1, timeoutMs: 5_000 },
      setGeneratingPlan: (running) => { if (!running) finished(); },
      logGenerationFailure: () => {}
    });
    const workspace = store.getWorkspace();
    workspace.runtime.selectedKind = "codex";
    const job = service.enqueuePlanningSessionGeneration(session, workspace);
    await completion;
    const legacyPlanId = store.getWorkspace().activePlan.id;
    assert.equal(job.status, "succeeded", job.message);
    await waitFor(() => store.listDiagnosticArtifacts(job.generationKey).length > 0);
    assert.equal(semanticCalls, 1);
    assert.equal(store.getWorkspace().activePlan.id, legacyPlanId);
    assert.equal(store.getWorkspace().executionPlan, undefined);
    const report = JSON.parse(store.listDiagnosticArtifacts(job.generationKey)[0]!.rawResponse);
    assert.equal(report.type, "semantic_shadow_v1");
    assert.equal(report.status.value, "failed");
    assert.equal(report.status.failureCode, "invalid_output");
  } finally {
    store.close();
  }
});

function confirmedSession(store: SqliteWorkspaceStore, facts: Record<string, string>) {
  const created = store.createPlanningSession("travel");
  store.savePlanningSession({
    ...created,
    status: "proposal_ready",
    facts: Object.entries(facts).map(([key, value]) => ({ key, value, source: "user" as const, confirmed: true, updatedAt: now })),
    proposal: { version: 1, title: facts.destination ?? "Trip", objective: facts.destination ?? "Trip", theme: "Culture", segments: [facts.destination ?? "Trip"], skeleton: [facts.travel_dates ?? "Trip dates"], tradeoffs: [], assumptions: [], decisionPoints: [] },
    updatedAt: now
  });
  return store.confirmPlanningSession(created.id, 1);
}

class BasicGenerationAdapter extends CodexRuntimeAdapter {
  override async generateSkillResearchBatch(input: SkillResearchBatchRequest): Promise<SkillResearchBatchArtifact> {
    return batch(input);
  }

  override async generateSkillItinerary(input: SkillItineraryRequest): Promise<SkillItineraryArtifact> {
    return {
      title: "Lisbon", summary: "A ceramic collection and an open rest day", language: "en", destinations: ["Lisbon"], startDate: "2026-10-12", endDate: "2026-10-13",
      days: [
        { id: "d1", date: "2026-10-12", kind: "scheduled", city: "Lisbon", title: "Collection", summary: "Museum", stops: [{ placeId: input.research.places[0]!.id, order: 1 }], candidatePlaceIds: [] },
        { id: "d2", date: "2026-10-13", kind: "rest", city: "Lisbon", title: "Rest", summary: "User requested a full rest day", stops: [], candidatePlaceIds: [] }
      ],
      movements: []
    };
  }
}

function semanticPlanResult(fixedCommitments: SemanticTravelPlanRequest["fixedCommitments"] = []): SemanticTravelPlanResult {
  const dates = [...new Set(["2026-10-12", ...fixedCommitments.flatMap((commitment) => commitment.startAtLocal ? [commitment.startAtLocal.slice(0, 10)] : [])])].sort();
  return {
    rawJson: "{}",
    plan: {
      title: "Lisbon semantic shadow",
      language: "en",
      tripStrategy: "Keep the existing legacy draft authoritative while shadowing a compact semantic plan.",
      fixedCommitments,
      targetedResearch: [],
      dailyItinerary: dates.map((date) => ({
        date,
        area: "Lisbon",
        startContext: { label: "Lisbon", status: "confirmed_property" },
        endContext: { label: "Lisbon", status: "confirmed_property" },
        plan: "Visit the museum.",
        experiences: [
          ...(date === "2026-10-12" ? [{ title: "Museum", placeName: "Museum", planRole: "planned" as const, summary: "Explore the collection." }] : []),
          ...commitmentOccurrences(fixedCommitments, date)
        ]
      })),
      unresolvedExperiences: [],
      preparation: [],
      tips: [],
      researchGrounding: [],
      followUpChecks: [],
      markdown: "# Lisbon semantic shadow\n\nA compact shadow plan for diagnostics only."
    }
  };
}

function semanticCanaryPlan(fixedCommitments: SemanticTravelPlan["fixedCommitments"] = [], destination = "Bali", includeResolvedReplacement = false): SemanticTravelPlan {
  return {
    title: `${destination} controlled draft`,
    language: "en",
    tripStrategy: "Keep the confirmed transport fixed and preserve unknown accommodation as a recheck.",
    fixedCommitments,
    targetedResearch: [],
    dailyItinerary: [{
      date: "2026-10-12",
      area: destination,
      startContext: { label: `${destination} accommodation - exact property pending`, status: "planned_base_pending_property" },
      endContext: { label: `${destination} accommodation - exact property pending`, status: "planned_base_pending_property" },
      plan: "Visit the museum without treating the future lodging choice as confirmed.",
      experiences: [
        ...commitmentOccurrences(fixedCommitments, "2026-10-12"),
        { title: "Museum", placeName: "Museum", planRole: "planned", summary: "Explore the collection." },
        ...(includeResolvedReplacement ? [{ title: "Compact archaeological alternative", placeName: "Museum", planRole: "replacement" as const, replacementFor: "Museum", summary: "Use the same researched museum identity only as an explicit replacement." }] : [])
      ]
    }],
    unresolvedExperiences: ["Exact accommodation remains to be selected."],
    preparation: [],
    tips: [],
    researchGrounding: [],
    followUpChecks: ["Confirm the accommodation before route timing is finalized."],
    markdown: [
      `# ${destination} controlled draft`,
      "",
      "The confirmed transport remains fixed. The exact accommodation is still unknown, so route timing from the overnight base remains a recheck rather than a confirmed fact.",
      "",
      "## 2026-10-12",
      "",
      `Start and end at the planned ${destination} base, with the exact property pending. Visit the researched museum as the planned experience and retain enough flexibility for the confirmed arrival commitment.`,
      "",
      "## Preparation",
      "",
      "Confirm the accommodation before final route timing. Recheck current access details against reliable sources close to travel. No execution or booking action is implied by this draft.",
      "",
      "## Known limits",
      "",
      "The lodging identity, inventory, and route duration remain unknown. They are deliberately not presented as confirmed facts."
    ].join("\n")
  };
}

function commitmentOccurrences(commitments: SemanticTravelPlan["fixedCommitments"], date: string): NonNullable<SemanticTravelPlan["dailyItinerary"][number]["experiences"]> {
  return commitments.flatMap((commitment) => commitment.startAtLocal?.startsWith(date)
    ? [{ title: commitment.segmentTitle, summary: `${commitment.title} at the confirmed time.`, planRole: "planned" as const, kind: commitment.type === "accommodation" ? "lodging" as const : "transfer" as const, startTime: commitment.startAtLocal.slice(11, 16), timingStatus: "confirmed" as const }]
    : []);
}

function saveConfirmedFlight(store: SqliteWorkspaceStore, planningSessionId: string): void {
  store.saveTravelBooking({
    id: "canary-flight",
    planningSessionId,
    type: "flight",
    status: "confirmed",
    title: "Confirmed arrival flight",
    source: "user",
    sourceLabel: "Canary fixture",
    sourceHash: "canary-flight-hash",
    constraintStrength: "hard",
    segments: [{
      id: "canary-flight-segment",
      segmentType: "flight_leg",
      title: "Confirmed arrival flight",
      status: "confirmed",
      startAtLocal: "2026-10-12T09:00",
      startTimeZone: "Asia/Makassar",
      origin: "Singapore",
      destination: "DPS Airport",
      constraintStrength: "hard",
      fixedCommitment: true,
      needsReviewReasons: []
    }],
    importedAt: now,
    updatedAt: now
  });
}

function saveConfirmedHotel(store: SqliteWorkspaceStore, planningSessionId: string): void {
  store.saveTravelBooking({
    id: "canary-hotel",
    planningSessionId,
    type: "accommodation",
    status: "confirmed",
    title: "Confirmed Porto hotel",
    source: "user",
    sourceLabel: "Canary fixture",
    sourceHash: "canary-hotel-hash",
    constraintStrength: "hard",
    segments: [{
      id: "canary-hotel-segment",
      segmentType: "hotel_stay",
      title: "Confirmed Porto hotel",
      status: "confirmed",
      startAtLocal: "2026-10-12T15:00",
      endAtLocal: "2026-10-13T11:00",
      location: "Praca da Batalha, Porto, Portugal",
      constraintStrength: "hard",
      fixedCommitment: true,
      needsReviewReasons: []
    }],
    importedAt: now,
    updatedAt: now
  });
}

async function waitFor(condition: () => boolean): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > 2_000) throw new Error("Timed out waiting for condition.");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}


test("automatic retry only repeats early process failures and never exhausted timeouts", async () => {
  for (const [code, elapsed, expectedCalls] of [
    ["timed_out", 1, 1], ["run_failed", 120_001, 1], ["cancelled", 1, 1],
    ["invalid_output", 1, 1], ["run_failed", 120_000, 2]
  ] as const) {
    let calls = 0;
    let retries = 0;
    let clockCalls = 0;
    const failure = new RuntimeAdapterError(code, "Failure fixture");
    const result = withSingleTransientRetry(async () => {
      calls++;
      if (calls === 1) throw failure;
      return "recovered";
    }, () => { retries++; }, () => clockCalls++ === 0 ? 0 : elapsed);
    if (expectedCalls === 2) assert.equal(await result, "recovered");
    else await assert.rejects(result, error => error === failure);
    assert.equal(calls, expectedCalls);
    assert.equal(retries, expectedCalls - 1);
  }
  let calls = 0;
  await assert.rejects(withSingleTransientRetry(async () => {
    calls++;
    throw new RuntimeAdapterError("run_failed", "Still failing");
  }, () => {}, () => 0));
  assert.equal(calls, 2);
});


test("partial day patches restore omitted days, trip metadata and unrelated transport; incomplete patches fail", () => {
  const makeDay = (id: string, date: string) => ({ id, date, kind: "rest" as const, city: "Tokyo", title: id, summary: "Requested rest", stops: [], candidatePlaceIds: [], blocks: [] });
  const original: SkillItineraryArtifact = { title: "Saved trip", summary: "Saved summary", language: "en", destinations: ["Tokyo"], startDate: "2026-11-10", endDate: "2026-11-12",
    days: [makeDay("first", "2026-11-10"), makeDay("second", "2026-11-11"), makeDay("last", "2026-11-12")],
    movements: [{ id: "saved", dayId: "first", originPlaceId: "airport", destinationPlaceId: "hotel", mode: "transit", status: "recheck", evidence: [] }] };
  const patch = { ...original, title: "Unwanted title change", days: [{ ...original.days[1]!, title: "Corrected" }], movements: [] };
  const merged = restoreUntargetedItineraryDays(original, patch, ["2026-11-11"]);
  assert.equal(merged.title, original.title);
  assert.deepEqual(merged.days.map(day => day.date), original.days.map(day => day.date));
  assert.deepEqual(merged.days[0], original.days[0]);
  assert.deepEqual(merged.days[2], original.days[2]);
  assert.equal(merged.days[1]!.title, "Corrected");
  assert.deepEqual(merged.movements, original.movements);
  const fullPatch = { ...original, summary: "Corrected whole-trip summary" };
  assert.equal(restoreUntargetedItineraryDays(original, fullPatch, original.days.map(day => day.date), true).summary, original.summary);
  assert.equal(restoreUnrelatedQualityRepairDays(original, fullPatch, [], false, false).summary, fullPatch.summary);
  assert.throws(() => restoreUntargetedItineraryDays(original, { ...patch, days: [] }, ["2026-11-11"]), /omits/);
  assert.throws(() => restoreUntargetedItineraryDays(original, { ...patch, days: [...patch.days, makeDay("extra", "2026-11-13")] }, ["2026-11-11"]), /outside/);
  assert.throws(() => restoreUntargetedItineraryDays(original, { ...patch, days: [{ ...patch.days[0]!, id: "first" }] }, ["2026-11-11"]), /unrelated day identity/);
});

test("optional day-specific route advice stays local while blocking regional and undated repairs remain global", () => {
  const required = [{ code: "missing_midday_break", date: "2026-11-12" }];
  assert.equal(canUseDateLocalCorrection(required, [{ code: "route_efficiency", date: "2026-11-18" }]), true);
  assert.equal(canUseDateLocalCorrection([{ code: "route_efficiency", date: "2026-11-18" }], []), false);
  assert.equal(canUseDateLocalCorrection(required, [{ code: "route_efficiency" }]), false);
  assert.equal(canUseDateLocalCorrection(required, [], true), false);
});


test("same-day Kyoto without lodging skips accommodation research while explicit stays and multi-day trips retain it", () => {
  const store = new SqliteWorkspaceStore(":memory:");
  try {
    const session = confirmedSession(store, { destination: "Kyoto", purpose: "Temples and tea", travel_dates: "2026-12-12 to 2026-12-12",
      arrival: "Kyoto Station 09:00", departure: "Kyoto Station 20:00", party_size: "1", transport_preference: "Public transport", accommodation: "当天不需要住宿" });
    const research = importSkillResearchBatches([batch({ batch: { id: "scope-1", scopeLabel: "Kyoto" } } as SkillResearchBatchRequest)], {
      researchSetId: "day-trip-research", generationKey: "day-trip", proposalRef: { sessionId: session.id, proposalVersion: 1 },
      skillLineage: LANDI_BLUEPRINT_SKILL, createdAt: now, updatedAt: now });
    assert.equal(accommodationResearchNeeded(research, [], session), false);
    assert.match(planningRequestForGenerationWithBookings(session), /Same-day trip rule/);
    assert.doesNotMatch(planningRequestForGenerationWithBookings(session), /If no hotel was supplied/);
    const withFact = (key: string, value: string) => ({ ...session, facts: session.facts.map(fact => fact.key === key ? { ...fact, value } : fact) });
    for (const value of ["No accommodation needed", "无需住宿", "Hotel not required"]) {
      assert.equal(accommodationResearchNeeded(research, [], withFact('accommodation', value)), false);
    }
    for (const value of ["Recommend a Kyoto hotel", "Day-use hotel room", "住宿尚未确定", "不需要住宿，但想找午休酒店"]) {
      assert.equal(accommodationResearchNeeded(research, [], withFact('accommodation', value)), true);
    }
    assert.equal(accommodationResearchNeeded(research, [], withFact('travel_dates', "2026-12-12 to 2026-12-13")), true);
    assert.equal(accommodationResearchNeeded(research, [], withFact('travel_dates', "Unknown")), true);
    assert.equal(planningAccommodationRequired({ facts: session.facts.filter(fact => fact.key !== 'accommodation') }), false);
    assert.equal(planningAccommodationRequired({ facts: session.facts.map(fact => fact.key === 'travel_dates' ? { ...fact, source: 'inferred' as const } : fact) }), true);
  } finally { store.close(); }
});
