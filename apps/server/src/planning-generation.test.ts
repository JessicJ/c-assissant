import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { CodexRuntimeAdapter, LANDI_BLUEPRINT_SKILL, LEGACY_BLUEPRINT_SKILL, RuntimeAdapterError, type SkillResearchBatchRequest, type SkillItineraryRequest } from "@c-assistant/agent-adapters";
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
