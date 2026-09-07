import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import type { CodexRuntimeAdapter } from "@c-assistant/agent-adapters";
import { applyDirectBlueprintRevision, compileTripBlueprint, DirectBlueprintReplanRequirementError, prepareDirectBlueprintAssistedReplanningHandoff, TRIP_BLUEPRINT_SCHEMA_VERSION, type GeneratedPlanDraft, type ResearchSet, type TripBlueprint } from "@c-assistant/core";
import { SqliteWorkspaceStore } from "@c-assistant/storage";
import type { PlanningGenerationService } from "./planning-generation-service.js";
import { registerWebAgentRoutes } from "./web-agent-routes.js";

test("Web Agent keeps ordinary Blueprint-backed revise blocked but accepts assisted handoff", async () => {
  const server = Fastify({ logger: false });
  const store = new SqliteWorkspaceStore(":memory:");
  store.updateProfile({ displayName: "Alex", preferredLanguage: "English", nationality: "Canada", gender: "not_specified", immigrationStatus: "tourist_visa" });
  let generating = false;
  let generatedRequest = "";
  let generatedCurrentPlanTitle = "";
  const runtime = {
    generatePlanDraft: async (input: { request: string; currentPlan?: { title: string } }): Promise<GeneratedPlanDraft> => {
      generatedRequest = input.request;
      generatedCurrentPlanTitle = input.currentPlan?.title ?? "";
      return {
        title: "Tokyo replanned draft",
        location: "Tokyo",
        dates: "2026-09-01",
        knownInformation: ["The affected itinerary day was replanned from an assisted handoff."],
        assumptions: [],
        nextAction: "Review the replanned day.",
        stages: [{ title: "Adjusted itinerary", description: "Review the affected day.", tasks: [{ title: "Visit Faraway dinner", owner: "assistant", dueLabel: "2026-09-01" }] }]
      };
    }
  } as unknown as CodexRuntimeAdapter;
  const generation = {
    planGenerationFailureCode: () => "generation_failed"
  } as unknown as PlanningGenerationService;
  try {
    registerWebAgentRoutes(server, {
      store,
      blueprintGenerationEnabled: true,
      generation,
      getGeneratingPlan: () => generating,
      setGeneratingPlan: (running) => { generating = running; },
      selectedRuntimeAdapter: () => runtime,
      prepareGeneratedPlanEvidence: async () => ({ workspace: store.getWorkspace(), status: "partial" })
    });
    const blueprint = createTestTripBlueprint(store);
    const compiled = store.createCompiledBlueprintPlan(compileTripBlueprint(blueprint, { createdAt: "2026-08-26T00:02:01.000Z" })).activePlan;
    const revision = { kind: "add_place_to_day", placeId: "b", dayId: "d1", position: { kind: "end" }, createdAt: "2026-08-27T00:00:00.000Z" } as const;
    let requirement: DirectBlueprintReplanRequirementError["replanRequirement"] | undefined;
    try {
      applyDirectBlueprintRevision(blueprint, revision);
      assert.fail("Expected a structured assisted replanning requirement.");
    } catch (caught) {
      assert.ok(caught instanceof DirectBlueprintReplanRequirementError);
      requirement = caught.replanRequirement;
    }
    const handoff = prepareDirectBlueprintAssistedReplanningHandoff(blueprint, { replanRequirement: requirement, revisions: [revision] });

    const ordinary = await server.inject({
      method: "POST",
      url: "/api/agent/chat",
      payload: { mode: "revise_plan", message: "Move this dinner.", expectedPlanId: compiled.id, expectedVersion: compiled.version, impactConfirmed: true }
    });
    assert.equal(ordinary.statusCode, 409, ordinary.body);
    assert.match(ordinary.json().error, /assisted itinerary handoff/i);
    assert.equal(generatedRequest, "");

    const staleHandoff = await server.inject({
      method: "POST",
      url: "/api/agent/chat",
      payload: { mode: "revise_plan", message: handoff.request, expectedPlanId: compiled.id, expectedVersion: compiled.version, impactConfirmed: true, assistedReplanning: { ...handoff, baseBlueprintVersion: 99 } }
    });
    assert.equal(staleHandoff.statusCode, 409, staleHandoff.body);
    assert.match(staleHandoff.json().error, /Trip Blueprint changed/i);
    assert.equal(generatedRequest, "");

    const tamperedHandoff = await server.inject({
      method: "POST",
      url: "/api/agent/chat",
      payload: { mode: "revise_plan", message: "Different request", expectedPlanId: compiled.id, expectedVersion: compiled.version, impactConfirmed: true, assistedReplanning: handoff }
    });
    assert.equal(tamperedHandoff.statusCode, 409, tamperedHandoff.body);
    assert.match(tamperedHandoff.json().error, /prepared replanning request/i);
    assert.equal(generatedRequest, "");

    const assisted = await server.inject({
      method: "POST",
      url: "/api/agent/chat",
      payload: { mode: "revise_plan", message: handoff.request, expectedPlanId: compiled.id, expectedVersion: compiled.version, impactConfirmed: true, assistedReplanning: handoff }
    });
    assert.equal(assisted.statusCode, 200, assisted.body);
    assert.equal(generatedRequest, handoff.request);
    assert.equal(generatedCurrentPlanTitle, "Tokyo");
    const payload = assisted.json();
    assert.equal(payload.workspace.activePlan.title, "Tokyo replanned draft");
    assert.equal(payload.workspace.activePlan.status, "draft");
    assert.equal(payload.workspace.latestPlanReplacement.impact, "high");
    assert.deepEqual(payload.workspace.latestPlanReplacement.affectedAreas, ["itinerary"]);
  } finally {
    await server.close();
    store.close();
  }
});

function createTestTripBlueprint(store: SqliteWorkspaceStore): TripBlueprint {
  const session = store.createPlanningSession("travel", new Date("2026-08-26T00:00:00.000Z"));
  const proposal = { version: 1, title: "Tokyo", objective: "Visit Tokyo", theme: "Culture", segments: ["Tokyo"], skeleton: ["2026-09-01"], tradeoffs: [], assumptions: [], decisionPoints: [] };
  store.savePlanningSession({ ...session, status: "proposal_ready", proposal, updatedAt: "2026-08-26T00:00:01.000Z" });
  store.confirmPlanningSession(session.id, 1);
  const generationKey = `${session.id}:1:interactive-trip-planner@0.2.0`;
  const proposalRef = { sessionId: session.id, proposalVersion: 1 };
  const skillLineage = { skillId: "interactive-trip-planner", skillVersion: "0.2.0" };
  store.saveBlueprintGeneration({
    generationKey,
    proposalRef,
    skillLineage,
    status: "running",
    stage: "research",
    createdAt: "2026-08-26T00:00:02.000Z",
    updatedAt: "2026-08-26T00:00:02.000Z"
  });
  const research: ResearchSet = {
    schemaVersion: TRIP_BLUEPRINT_SCHEMA_VERSION,
    id: "research-tokyo-agent-route",
    generationKey,
    proposalRef,
    skillLineage,
    status: "completed",
    batches: [{ id: "tokyo", scopeLabel: "Tokyo", status: "completed", placeIds: ["a", "b"], eventIds: [], sourceIds: [], completedAt: "2026-08-26T00:01:00.000Z" }],
    places: [
      { id: "a", name: "Morning anchor", locationLabel: "Tokyo", city: "Tokyo", category: "sight", priority: "preferred", coordinates: [35.68, 139.76], whyWorthIt: "A clear morning anchor.", plan: "Visit first.", evidence: [] },
      { id: "b", name: "Faraway dinner", locationLabel: "Tokyo", city: "Tokyo", category: "restaurant", priority: "preferred", coordinates: [35.69, 139.77], whyWorthIt: "A high-impact dinner.", plan: "Add only after replanning.", schedulingEligibility: { decision: "high_impact", reason: "Requires another city day.", highImpactReasons: ["Different city"] }, evidence: [] }
    ],
    events: [],
    sources: [],
    actionRequirements: [],
    createdAt: "2026-08-26T00:00:02.000Z",
    updatedAt: "2026-08-26T00:01:00.000Z",
    completedAt: "2026-08-26T00:01:00.000Z"
  };
  store.saveResearchSet(research);
  const blueprint: TripBlueprint = {
    schemaVersion: TRIP_BLUEPRINT_SCHEMA_VERSION,
    id: "blueprint-tokyo-agent-route",
    version: 1,
    generationKey,
    proposalRef,
    skillLineage,
    researchSetId: research.id,
    title: "Tokyo",
    summary: "Tokyo plan",
    language: "en",
    destinations: ["Tokyo"],
    startDate: "2026-09-01",
    endDate: "2026-09-01",
    places: research.places,
    events: [],
    sources: [],
    days: [{ id: "d1", date: "2026-09-01", kind: "scheduled", city: "Tokyo", title: "Day one", summary: "One stop", stops: [{ placeId: "a", order: 1 }], candidatePlaceIds: ["b"] }],
    movements: [],
    actionRequirements: [],
    createdAt: "2026-08-26T00:02:00.000Z"
  };
  return store.saveTripBlueprint(blueprint);
}
