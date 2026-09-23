import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { CodexRuntimeAdapter, LANDI_BLUEPRINT_SKILL } from "../packages/agent-adapters/src/index.ts";
import { SqliteWorkspaceStore } from "../packages/storage/src/index.ts";
import { createPlanningGenerationService } from "../apps/server/src/planning-generation.ts";
import { semanticCanaryGenerationKey } from "../apps/server/src/planning-generation-state.ts";

const databasePath = resolve(process.env.C_ASSISTANT_DATA_PATH ?? "data/c-assistant.sqlite");
const sourceSessionId = process.env.LANDI_SOURCE_SESSION_ID ?? "fff221d7-5734-4bc3-a1aa-a18f48472bad";
const store = new SqliteWorkspaceStore(databasePath);

try {
  const sourceSession = store.getPlanningSessionById(sourceSessionId);
  if (!sourceSession?.proposal || !sourceSession.confirmedProposalVersion) throw new Error("The latest confirmed Bali planning session is unavailable.");
  const sourceGenerationKey = `${sourceSession.id}:${sourceSession.confirmedProposalVersion}:${LANDI_BLUEPRINT_SKILL.skillId}@${LANDI_BLUEPRINT_SKILL.skillVersion}`;
  const sourceResearch = store.getResearchSetByGenerationKey(sourceGenerationKey);
  if (!sourceResearch) throw new Error(`Research Set missing for ${sourceGenerationKey}.`);

  const created = store.createPlanningSession(sourceSession.objectiveType);
  const prepared = store.savePlanningSession({
    ...created,
    status: "proposal_ready",
    messages: structuredClone(sourceSession.messages),
    facts: structuredClone(sourceSession.facts),
    unresolved: structuredClone(sourceSession.unresolved),
    deferred: structuredClone(sourceSession.deferred),
    proposal: structuredClone(sourceSession.proposal),
    updatedAt: new Date().toISOString()
  });
  const session = store.confirmPlanningSession(prepared.id, sourceSession.confirmedProposalVersion);
  for (const booking of store.listTravelBookingsForPlanningSession(sourceSession.id)) {
    store.saveTravelBooking({ ...structuredClone(booking), id: `${booking.id}-anchor-${randomUUID()}`, planningSessionId: session.id, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  }

  const generationKey = semanticCanaryGenerationKey(session.id, session.confirmedProposalVersion!);
  const checkpointTime = new Date().toISOString();
  store.saveBlueprintGeneration({
    generationKey,
    proposalRef: { sessionId: session.id, proposalVersion: session.confirmedProposalVersion! },
    skillLineage: LANDI_BLUEPRINT_SKILL,
    status: "pending",
    stage: "research",
    createdAt: checkpointTime,
    updatedAt: checkpointTime
  });
  store.saveResearchSet({
    ...structuredClone(sourceResearch),
    id: `research-${randomUUID()}`,
    generationKey,
    proposalRef: { sessionId: session.id, proposalVersion: session.confirmedProposalVersion! },
    createdAt: checkpointTime,
    updatedAt: checkpointTime,
    completedAt: checkpointTime
  });

  let finish!: () => void;
  const completed = new Promise<void>((resolveDone) => { finish = resolveDone; });
  const service = createPlanningGenerationService({
    store,
    codex: new CodexRuntimeAdapter(),
    semanticDraftCanary: { enabled: true, localEnvironment: true, allowedSessionIds: [session.id] },
    setGeneratingPlan: (running) => { if (!running) finish(); },
    logGenerationFailure: (details, message) => process.stderr.write(`${message}: ${JSON.stringify(details)}\n`)
  });
  const workspace = store.getWorkspace();
  workspace.runtime.selectedKind = "codex";
  const job = service.enqueuePlanningSessionGeneration(session, workspace);
  await completed;
  if (job.status !== "succeeded") throw new Error(job.message);

  const result = store.getWorkspace();
  const blueprint = result.activeBlueprint;
  if (!blueprint) throw new Error("Fresh generation did not publish a Blueprint.");
  const accommodations = blueprint.places.filter((place) => place.accommodation);
  const summary = {
    sessionId: session.id,
    generationKey,
    plan: { id: result.activePlan.id, version: result.activePlan.version, title: result.activePlan.title },
    blueprint: { id: blueprint.id, version: blueprint.version, researchSetId: blueprint.researchSetId },
    accommodations: accommodations.map((place) => ({ id: place.id, name: place.name, area: place.area, coordinates: place.coordinates, officialUrl: place.officialUrl, bookingUrl: place.bookingUrl, accommodation: place.accommodation, evidence: place.evidence })),
    days: blueprint.days.map((day) => ({ date: day.date, startContext: day.startContext, endContext: day.endContext, blocks: (day.blocks ?? []).map((block) => ({ kind: block.kind, title: block.title, placeId: block.placeId, startTime: block.startTime, endTime: block.endTime, durationMinutes: block.durationMinutes, timingStatus: block.display?.timingStatus })) })),
    movements: blueprint.movements.map((movement) => ({ dayId: movement.dayId, originPlaceId: movement.originPlaceId, destinationPlaceId: movement.destinationPlaceId, mode: movement.mode, durationMinutes: movement.durationMinutes, status: movement.status }))
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
} finally {
  store.close();
}
