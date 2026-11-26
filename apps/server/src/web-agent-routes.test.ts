import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import type { CodexRuntimeAdapter } from "@c-assistant/agent-adapters";
import { applyDirectBlueprintRevision, compileTripBlueprint, DirectBlueprintReplanRequirementError, prepareDirectBlueprintAssistedReplanningHandoff, TRIP_BLUEPRINT_SCHEMA_VERSION, type GeneratedPlanDraft, type ResearchSet, type TripBlueprint } from "@c-assistant/core";
import { SqliteWorkspaceStore } from "@c-assistant/storage";
import type { PlanningGenerationService } from "./planning-generation-service.js";
import { registerWebAgentRoutes } from "./web-agent-routes.js";
import { itineraryArtifactFromBlueprint } from "./itinerary-publication-review.js";

test("Web Agent keeps generation gated until the user supplies essential details and selects Generate plan", async () => {
  const server = Fastify({ logger: false });
  const store = new SqliteWorkspaceStore(":memory:");
  store.updateProfile({ displayName: "Alex", preferredLanguage: "English", nationality: "Canada", gender: "not_specified", immigrationStatus: "tourist_visa" });
  let queued = 0;
  let generating = false;
  const runtime = { continuePlanningConversation: async () => ({
    reply: "I have your destination and interests. When will you travel?",
    facts: [{ key: "destination", value: "Wellington" }, { key: "purpose", value: "See museums" }, { key: "timing", value: "October" }]
  }) } as unknown as CodexRuntimeAdapter;
  const generation = {
    jobs: new Map(),
    enqueuePlanningSessionGeneration: () => { queued += 1; throw new Error("Generation should not be queued yet"); }
  } as unknown as PlanningGenerationService;
  try {
    registerWebAgentRoutes(server, {
      store, blueprintGenerationEnabled: true, generation,
      getGeneratingPlan: () => generating,
      setGeneratingPlan: (running) => { generating = running; },
      business: runtime,
      prepareGeneratedPlanEvidence: async () => ({ workspace: store.getWorkspace(), status: "partial" })
    });
    const chat = await server.inject({ method: "POST", url: "/api/agent/chat", payload: { mode: "new_plan", message: "I want to see museums in Wellington in October", messageId: "new-requirements-test", expectedRevision: 0 } });
    assert.equal(chat.statusCode, 200, chat.body);
    assert.equal(chat.json().planningStatus, "collecting");
    assert.equal(chat.json().blocked, true);
    assert.equal(queued, 0);
    const confirmation = await server.inject({ method: "POST", url: `/api/planning-sessions/${chat.json().planningSession.id}/confirm`, payload: { proposalVersion: 1 } });
    assert.equal(confirmation.statusCode, 503, confirmation.body);
    assert.match(confirmation.json().error, /MAH generation is not ready/i);
    assert.equal(queued, 0);
    assert.equal(store.getPlanningSession()?.status, "collecting");
  } finally {
    await server.close();
    store.close();
  }
});

test("Web Agent replans a Blueprint handoff into another Blueprint-backed draft", async () => {
  const server = Fastify({ logger: false });
  const store = new SqliteWorkspaceStore(":memory:");
  store.updateProfile({ displayName: "Alex", preferredLanguage: "English", nationality: "Canada", gender: "not_specified", immigrationStatus: "tourist_visa" });
  let generating = false;
  let generatedRequest = "";
  let generatedCurrentPlanTitle = "";
  let itineraryArtifact: ReturnType<typeof itineraryArtifactFromBlueprint> | undefined;
  const runtime = {
    generateSkillItinerary: async (input: { request: string }) => {
      generatedRequest = input.request;
      if (!itineraryArtifact) throw new Error("Missing test itinerary.");
      return itineraryArtifact;
    },
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
      business: runtime,
      prepareGeneratedPlanEvidence: async () => ({ workspace: store.getWorkspace(), status: "partial" })
    });
    const blueprint = createTestTripBlueprint(store);
    itineraryArtifact = structuredClone(itineraryArtifactFromBlueprint(blueprint));
    itineraryArtifact.days[0]!.stops = [{ placeId: "a", order: 1, time: "09:00" }, { placeId: "b", order: 2, time: "18:00" }];
    itineraryArtifact.days[0]!.blocks = [
      { id: "morning", kind: "stop", order: 1, placeId: "a", title: "Morning anchor", startTime: "09:00", endTime: "11:00", evidence: [] },
      { id: "dinner", kind: "meal", order: 2, placeId: "b", title: "Faraway dinner", startTime: "18:00", endTime: "19:00", evidence: [] }
    ];
    itineraryArtifact.movements = [{ id: "a-to-b", dayId: "d1", originPlaceId: "a", destinationPlaceId: "b", mode: "unknown", status: "recheck", label: "Travel to dinner", evidence: [] }];
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
      payload: { mode: "revise_plan", message: "Change the trip date and hotel.", expectedPlanId: compiled.id, expectedVersion: compiled.version }
    });
    assert.equal(ordinary.statusCode, 409, ordinary.body);
    assert.match(ordinary.json().error, /high-impact Plan change/i);
    assert.equal(generatedRequest, "");

    const staleHandoff = await server.inject({
      method: "POST",
      url: "/api/agent/chat",
      payload: { mode: "revise_plan", message: handoff.request, expectedPlanId: compiled.id, expectedVersion: compiled.version, impactConfirmed: true, assistedReplanning: { ...handoff, baseBlueprintVersion: 99 } }
    });
    assert.equal(staleHandoff.statusCode, 409, staleHandoff.body);
    assert.equal(staleHandoff.json().code, "version_conflict");
    assert.equal(generatedRequest, "");

    const tamperedHandoff = await server.inject({
      method: "POST",
      url: "/api/agent/chat",
      payload: { mode: "revise_plan", message: "Different request", expectedPlanId: compiled.id, expectedVersion: compiled.version, impactConfirmed: true, assistedReplanning: handoff }
    });
    assert.equal(tamperedHandoff.statusCode, 409, tamperedHandoff.body);
    assert.equal(tamperedHandoff.json().code, "request_identity_conflict");
    assert.equal(generatedRequest, "");

    const assisted = await server.inject({
      method: "POST",
      url: "/api/agent/chat",
      payload: { mode: "revise_plan", message: handoff.request, expectedPlanId: compiled.id, expectedVersion: compiled.version, impactConfirmed: true, assistedReplanning: handoff }
    });
    assert.equal(assisted.statusCode, 200, assisted.body);
    assert.equal(generatedRequest.startsWith(handoff.request), true);
    assert.equal(generatedCurrentPlanTitle, "");
    const payload = assisted.json();
    assert.equal(payload.workspace.activePlan.title, "Tokyo");
    assert.equal(payload.workspace.activePlan.status, "draft");
    assert.equal(payload.workspace.activeBlueprint.version, blueprint.version + 1);
    assert.deepEqual(payload.workspace.activeBlueprint.days[0].stops.map((stop: { placeId: string }) => stop.placeId), ["a", "b"]);
    const conversational = await server.inject({
      method: "POST", url: "/api/agent/chat",
      payload: { mode: "revise_plan", message: "Keep this dinner in the day plan.", expectedPlanId: payload.workspace.activePlan.id, expectedVersion: payload.workspace.activePlan.version, impactConfirmed: true }
    });
    assert.equal(conversational.statusCode, 200, conversational.body);
    assert.equal(conversational.json().workspace.activeBlueprint.version, blueprint.version + 2);
    assert.equal(generatedCurrentPlanTitle, "");
    const current = conversational.json().workspace;
    itineraryArtifact.days[0]!.stops = [{ placeId: "unknown-place", order: 1 }];
    const rejected = await server.inject({ method: "POST", url: "/api/agent/chat", payload: {
      mode: "revise_plan", message: "Change the route using a nonexistent place.", expectedPlanId: current.activePlan.id, expectedVersion: current.activePlan.version, impactConfirmed: true
    } });
    // 内部候选完整性异常不再冒充旅行者输入错误，也不公开内部关联诊断。
    assert.equal(rejected.statusCode, 500);
    assert.equal(rejected.json().code, "internal_error");
    assert.equal(rejected.body.includes("unknown-place"), false);
    assert.equal(store.getWorkspace().activePlan.id, current.activePlan.id);
    assert.equal(store.getWorkspace().activeBlueprint?.version, current.activeBlueprint.version);
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
