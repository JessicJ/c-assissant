import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { CodexRuntimeAdapter, LANDI_BLUEPRINT_SKILL, LEGACY_BLUEPRINT_SKILL, RuntimeAdapterError, type SemanticTravelPlan, type SemanticTravelPlanRequest, type SemanticTravelPlanResult, type SkillResearchBatchRequest, type SkillItineraryRequest } from "@c-assistant/agent-adapters";
import { importSkillResearchBatches, type SkillResearchBatchArtifact, type SkillItineraryArtifact } from "@c-assistant/core";
import { SqliteWorkspaceStore } from "@c-assistant/storage";
import { accommodationResearchNeeded, buildAccommodationResearchRequest, createPlanningGenerationService } from "./planning-generation.js";
import { registerPlanningSessionRoutes } from "./planning-session-routes.js";
import { destinationGateComparison } from "./semantic-draft-canary.js";
import "./planned-place-image-coverage.test.js";

const now = "2026-09-08T00:00:00.000Z";
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

for (const legacy of [false, true]) {
  test(`${legacy ? "legacy" : "Landi"} generation resumes saved research with matching policy and preserves place identities`, async () => {
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
        if (itineraryCalls === 1) throw new RuntimeAdapterError("invalid_request", "Fixture pauses after saved research.");
        return {
          title: "Lisbon", summary: "A ceramic collection and an open rest day", language: "en", destinations: ["Lisbon"], startDate: "2026-10-12", endDate: "2026-10-13",
          days: [
            { id: "d1", date: "2026-10-12", kind: "scheduled", city: "Lisbon", title: "Collection", summary: "Museum", stops: [{ placeId: input.research.places[0]!.id, order: 1 }], candidatePlaceIds: [] },
            { id: "d2", date: "2026-10-13", kind: "rest", city: "Lisbon", title: "Rest", summary: "Leave the day open", stops: [], candidatePlaceIds: [] }
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
          places: [{ id: "kediri-market", name: "Kediri Market", locationLabel: "Kediri, Tabanan", city: "Tabanan", area: "Beraban", category: "market", priority: "preferred", coordinates: [-8.58, 115.13], durationMinutes: 90, whyWorthIt: "Adds local food and daily-life context near the coastal temple.", plan: "Pair with Tanah Lot when completing a west-coast day.", sourceUrls: [] }],
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
            ? [{ placeId: anchor.id, order: 1 }, { placeId: candidate.id, order: 2 }]
            : [{ placeId: anchor.id, order: 1 }],
          blocks: hasCompletionCandidate && candidate
            ? [
              { id: "tanah", kind: "stop", order: 1, placeId: anchor.id, durationMinutes: 90, evidence: [] },
              { id: "market", kind: "stop", order: 2, placeId: candidate.id, durationMinutes: 90, evidence: [] }
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
    assert.equal(researchCalls, 3);
    assert.equal(itineraryCalls, 2);
    assert.match(targetedRequest, /Targeted Stage 3\.10 day-completion research/);
    assert.match(targetedRequest, /Target date: 2026-10-11/);
    assert.match(targetedScope, /day completion near Beraban/);
    assert.equal(blueprint.days[0]!.stops.length, 2);
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

test("generation supplements an exhausted Explore catalog once and keeps the accepted itinerary unchanged", async () => {
  const store = new SqliteWorkspaceStore(":memory:");
  let researchCalls = 0;
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
      return {
        title: "Lisbon", summary: "Four accepted city days", language: "en", destinations: ["Lisbon"], startDate: "2026-10-12", endDate: "2026-10-15",
        days: input.research.places.slice(0, 4).map((place, index) => ({ id: `d${index + 1}`, date: `2026-10-${12 + index}`, kind: "scheduled" as const, city: "Lisbon", title: place.name, summary: `A complete day around ${place.name}.`, stops: [{ placeId: place.id, order: 1 }], blocks: [{ id: `b${index + 1}`, kind: "stop" as const, order: 1, placeId: place.id, durationMinutes: 300, evidence: [] }], candidatePlaceIds: [] })),
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
    assert.equal(researchCalls, 3);
    const blueprint = store.getTripBlueprintByGenerationKey(job.generationKey)!;
    const nameById = new Map(blueprint.places.map((place) => [place.id, place.name] as const));
    assert.deepEqual(blueprint.days.flatMap((day) => day.stops.map((stop) => nameById.get(stop.placeId))), ["museum", "garden", "market", "gallery"]);
    assert.deepEqual(blueprint.places.filter((place) => !blueprint.days.some((day) => day.stops.some((stop) => stop.placeId === place.id))).map((place) => place.name), ["Neighborhood cafe", "Tile workshop"]);
    assert.equal(blueprint.version, 2);
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
      if (input.batch.id === "explore-supply") throw new RuntimeAdapterError("timed_out", "Supplement timed out.");
      return {
        ...input.batch, completedAt: now, sources: [], events: [], actionRequirements: [],
        places: ["a", "b", "c"].map((id, index) => ({ id, name: id, locationLabel: "Ubud", city: "Bali", area: "Ubud", category: "museum", coordinates: [-8.5 + index * 0.001, 115.2], display: { type: "attraction" }, durationMinutes: 300, whyWorthIt: `${id} is a sourced anchor.`, plan: `Use ${id} on its accepted day.`, sourceUrls: [] }))
      };
    }
    override async generateSkillItinerary(input: SkillItineraryRequest): Promise<SkillItineraryArtifact> {
      return { title: "Bali", summary: "Accepted route", language: "en", destinations: ["Bali"], startDate: "2026-10-06", endDate: "2026-10-08", days: input.research.places.map((place, index) => ({ id: `d${index}`, date: `2026-10-0${6 + index}`, kind: "scheduled" as const, city: "Bali", title: place.name, summary: place.name, stops: [{ placeId: place.id, order: 1 }], blocks: [{ id: `b${index}`, kind: "stop" as const, order: 1, placeId: place.id, durationMinutes: 300, evidence: [] }], candidatePlaceIds: [] })), movements: [] };
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
    assert.match(diagnostic.importFailure.issues.join(" "), /must connect adjacent stops/);
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
      arrival: "Arrive Lisbon airport at 07:25 on 2026-10-12",
      departure: "Depart Lisbon airport at 23:10 on 2026-10-13",
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
        { id: "d2", date: "2026-10-13", kind: "rest", city: "Lisbon", title: "Rest", summary: "Leave the day open", stops: [], candidatePlaceIds: [] }
      ],
      movements: []
    };
  }
}

function semanticPlanResult(fixedCommitments: SemanticTravelPlanRequest["fixedCommitments"] = []): SemanticTravelPlanResult {
  return {
    rawJson: "{}",
    plan: {
      title: "Lisbon semantic shadow",
      language: "en",
      tripStrategy: "Keep the existing legacy draft authoritative while shadowing a compact semantic plan.",
      fixedCommitments,
      targetedResearch: [],
      dailyItinerary: [{
        date: "2026-10-12",
        area: "Lisbon",
        startContext: { label: "Lisbon", status: "confirmed_property" },
        endContext: { label: "Lisbon", status: "confirmed_property" },
        plan: "Visit the museum.",
        experiences: [{ title: "Museum", placeName: "Museum", planRole: "planned", summary: "Explore the collection." }]
      }],
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
