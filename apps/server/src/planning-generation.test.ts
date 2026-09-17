import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { CodexRuntimeAdapter, LANDI_BLUEPRINT_SKILL, LEGACY_BLUEPRINT_SKILL, RuntimeAdapterError, type SemanticTravelPlanRequest, type SemanticTravelPlanResult, type SkillResearchBatchRequest, type SkillItineraryRequest } from "@c-assistant/agent-adapters";
import { importSkillResearchBatches, type SkillResearchBatchArtifact, type SkillItineraryArtifact } from "@c-assistant/core";
import { SqliteWorkspaceStore } from "@c-assistant/storage";
import { createPlanningGenerationService } from "./planning-generation.js";
import { registerPlanningSessionRoutes } from "./planning-session-routes.js";

const now = "2026-09-08T00:00:00.000Z";
function batch(input: SkillResearchBatchRequest): SkillResearchBatchArtifact {
  return {
    ...input.batch, completedAt: now, sources: [], events: [], actionRequirements: [],
    places: [{ id: "museum", name: "Museum", locationLabel: "Lisbon", city: "Lisbon", category: "museum", whyWorthIt: "Local ceramic collection", plan: "Explore the collection", sourceUrls: [] }]
  };
}

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
      assert.equal(researchCalls, legacy ? 0 : 1);

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
      assert.equal(researchCalls, legacy ? 0 : 1);
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
      assert.equal(researchCalls, legacy ? 0 : 1);
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
    assert.equal(researchCalls, 2);
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

function semanticPlanResult(): SemanticTravelPlanResult {
  return {
    rawJson: "{}",
    plan: {
      title: "Lisbon semantic shadow",
      language: "en",
      tripStrategy: "Keep the existing legacy draft authoritative while shadowing a compact semantic plan.",
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

async function waitFor(condition: () => boolean): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > 2_000) throw new Error("Timed out waiting for condition.");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
