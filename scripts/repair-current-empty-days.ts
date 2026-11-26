import { readFileSync, writeFileSync } from "node:fs";
import { CodexRuntimeAdapter } from "../packages/agent-adapters/src/index.js";
import { assertTripBlueprintIntegrity, compileTripBlueprint, importSkillItinerary, importSkillResearchBatches, mergeResearchSetCheckpoint, type SkillItineraryArtifact } from "../packages/core/src/index.js";
import { SqliteWorkspaceStore } from "../packages/storage/src/index.js";
import { buildCompletionItineraryRequest, completionTargetsForBlueprint, emptyDestinationDayDates } from "../apps/server/src/day-completion.js";
import { reviewItineraryQuality } from "../apps/server/src/itinerary-quality-review.js";
import { sparseItineraryTimingDates } from "../apps/server/src/itinerary-timing-quality.js";
import { missingPlannedPlaceImages } from "../apps/server/src/planned-place-image-coverage.js";
import { runPlannedPlaceImagePass } from "../apps/server/src/planned-place-image-pipeline.js";
import { planningRequestForGenerationWithBookings } from "../apps/server/src/planning-session-generation.js";

const expectedPlanId = process.argv[2];
const researchPath = process.argv[3];
const artifactPath = process.argv[4];
const apply = process.argv.includes("--apply");
if (!expectedPlanId || !researchPath || !artifactPath) throw new Error("Usage: tsx scripts/repair-current-empty-days.ts <draft-plan-id> <research-json> <itinerary-json> [--apply]");

const store = new SqliteWorkspaceStore("data/c-assistant.sqlite");
try {
  const workspace = store.getWorkspace();
  const originalPlan = workspace.activePlan;
  const original = workspace.activeBlueprint;
  if (originalPlan.id !== expectedPlanId || originalPlan.status !== "draft" || !original) throw new Error("The requested draft is no longer active.");
  const dates = emptyDestinationDayDates(original);
  if (!dates.length) throw new Error("The current draft has no empty destination days.");
  const cachedResearch = JSON.parse(readFileSync(researchPath, "utf8"));
  if (cachedResearch.planId !== originalPlan.id || cachedResearch.blueprintVersion !== original.version) throw new Error("Supplemental research belongs to a different draft version.");
  const research = store.getResearchSet(original.researchSetId);
  if (!research) throw new Error("The current draft's Research Set is missing.");
  const session = store.getPlanningSessionById(original.proposalRef.sessionId);
  if (!session?.proposal || !session.confirmedProposalVersion) throw new Error("The confirmed planning session is missing.");
  const now = new Date().toISOString();
  const incoming = importSkillResearchBatches([cachedResearch.artifact], {
    researchSetId: research.id,
    generationKey: research.generationKey,
    proposalRef: research.proposalRef,
    skillLineage: research.skillLineage,
    createdAt: research.createdAt,
    updatedAt: now
  });
  const expandedResearch = mergeResearchSetCheckpoint(research, incoming, { status: "completed", updatedAt: now });
  const targets = completionTargetsForBlueprint(original, expandedResearch).filter((target) => dates.includes(target.day.date));
  if (targets.length !== dates.length) throw new Error("Not all empty days were selected for repair.");
  const approvedRequest = planningRequestForGenerationWithBookings({ ...session, status: "proposal_confirmed" });
  const dayLedger = original.days.map((day) => ({ date: day.date, id: day.id, kind: day.kind, city: day.city, title: day.title, summary: day.summary, startContext: day.startContext, endContext: day.endContext, blocks: day.blocks?.map((block) => ({ id: block.id, kind: block.kind, order: block.order, placeId: block.placeId, title: block.title, startTime: block.startTime, endTime: block.endTime, durationMinutes: block.durationMinutes })), stops: day.stops }));
  const request = buildCompletionItineraryRequest([
    approvedRequest,
    `Repair this saved draft, not a new trip. Existing day ledger: ${JSON.stringify(dayLedger)}.`,
    `Only ${dates.join(", ")} need new committed daytime experiences. Keep every other date, existing stop, original hotel base, and user-approved trip scope. Do not turn weather backup into an empty baseline. Use the supplemental Wellington research for low-cost geographically coherent full days. Give selected concrete stops plausible planned start times, route transfers, and the same Hotel Waterloo start and end anchors. Do not declare unbooked places booked or invent confirmed operating hours.`
  ].join("\n\n"), targets, true);
  const adapter = new CodexRuntimeAdapter();
  let artifact: SkillItineraryArtifact;
  try {
    const cached = JSON.parse(readFileSync(artifactPath, "utf8"));
    if (cached.planId !== originalPlan.id || cached.blueprintVersion !== original.version) throw new Error("Cached itinerary belongs to a different draft version.");
    artifact = cached.artifact;
  } catch (error) {
    if (!(error instanceof Error) || !/ENOENT/.test(error.message)) throw error;
    artifact = await adapter.generateSkillItinerary({ request, research: expandedResearch, profile: workspace.profile });
    writeFileSync(artifactPath, JSON.stringify({ planId: originalPlan.id, blueprintVersion: original.version, artifact }, null, 2));
  }
  let imported;
  try {
    imported = importSkillItinerary(expandedResearch, artifact, { blueprintId: original.id, blueprintVersion: original.version + 1, createdAt: original.createdAt, bookingConstraints: original.bookingConstraints ?? [] });
  } catch (error) {
    const repaired = await adapter.generateSkillItinerary({ request, research: expandedResearch, profile: workspace.profile, repair: { rejected: artifact, issues: [error instanceof Error ? error.message : String(error)] } });
    imported = importSkillItinerary(expandedResearch, repaired, { blueprintId: original.id, blueprintVersion: original.version + 1, createdAt: original.createdAt, bookingConstraints: original.bookingConstraints ?? [] });
    artifact = repaired;
    writeFileSync(artifactPath, JSON.stringify({ planId: originalPlan.id, blueprintVersion: original.version, artifact }, null, 2));
  }
  const targetDates = new Set(dates);
  const importedDays = new Map(imported.days.map((day) => [day.date, day] as const));
  const replacements = original.days.map((day) => {
    if (!targetDates.has(day.date)) return day;
    const replacement = importedDays.get(day.date);
    if (!replacement || !replacement.stops.length) throw new Error(`No concrete stops were generated for ${day.date}.`);
    const first = replacement.blocks?.[0];
    const last = replacement.blocks?.at(-1);
    if (first?.kind !== "lodging" || first.placeId !== day.startContext?.placeId || last?.kind !== "lodging" || last.placeId !== day.endContext?.placeId) throw new Error(`The hotel base changed on ${day.date}.`);
    return { ...replacement, id: day.id, startContext: day.startContext, endContext: day.endContext };
  });
  const targetDayIds = new Set(original.days.filter((day) => targetDates.has(day.date)).map((day) => day.id));
  const importedDayIdByDate = new Map(imported.days.map((day) => [day.id, day.date] as const));
  const originalDayIdByDate = new Map(original.days.map((day) => [day.date, day.id] as const));
  const targetMovements = imported.movements.flatMap((movement) => {
    const date = importedDayIdByDate.get(movement.dayId);
    return date && targetDates.has(date) ? [{ ...movement, dayId: originalDayIdByDate.get(date)! }] : [];
  });
  const originalPlaces = new Map(original.places.map((place) => [place.id, place] as const));
  const originalSources = new Map(original.sources.map((source) => [source.id, source] as const));
  const updated = {
    ...original,
    version: original.version + 1,
    places: imported.places.map((place) => originalPlaces.get(place.id) ?? place),
    sources: imported.sources.map((source) => originalSources.get(source.id) ?? source),
    days: replacements,
    movements: [...original.movements.filter((movement) => !targetDayIds.has(movement.dayId)), ...targetMovements],
    actionRequirements: imported.actionRequirements
  };
  assertTripBlueprintIntegrity(updated, { expectedResearchPlaceIds: expandedResearch.places.map((place) => place.id) });
  const remaining = emptyDestinationDayDates(updated);
  if (remaining.length) throw new Error(`Empty days remain: ${remaining.join(", ")}`);
  const timing = sparseItineraryTimingDates(updated);
  if (timing.length) throw new Error(`Day timing remains sparse: ${timing.join(", ")}`);
  const findings = reviewItineraryQuality(updated, session).filter((finding) => finding.blocking);
  if (findings.length) throw new Error(`Quality review failed: ${findings.map((finding) => finding.explanation).join("; ")}`);
  let finalResearch = expandedResearch;
  let finalBlueprint = updated;
  if (apply && missingPlannedPlaceImages(updated, expandedResearch).length) {
    const result = await runPlannedPlaceImagePass({
      research: expandedResearch,
      blueprint: updated,
      search: (places, timeoutMs) => adapter.generatePlannedPlaceImageEnrichment({
        request: `Find exact-place photographs for the newly scheduled Wellington places in the ${original.startDate} to ${original.endDate} plan. Use source-backed actual photos, never generic or invented images.`,
        scopeLabel: "Wellington completed days",
        places,
        profile: workspace.profile,
        timeoutMs
      }),
      save: (researchResult, blueprintResult) => ({ research: researchResult, blueprint: blueprintResult }),
      onBatch: ({ requested, accepted, error }) => console.log(JSON.stringify({ imageBatch: { requested, accepted, ...(error ? { error: error instanceof Error ? error.message : String(error) } : {}) } }))
    });
    if (result.remainingPlaceCount) throw new Error(`${result.remainingPlaceCount} newly scheduled places still lack sourced images; no draft was saved.`);
    finalResearch = result.research;
    finalBlueprint = result.blueprint;
  }
  const completedRequirementIds = originalPlan.stages.flatMap((stage) => stage.tasks).filter((task) => task.status === "completed" && task.requirementId).map((task) => task.requirementId!);
  const compilation = compileTripBlueprint(finalBlueprint, { createdAt: now, completedRequirementIds });
  compilation.plan.configuration = structuredClone(originalPlan.configuration);
  if (apply) {
    const current = store.getWorkspace();
    if (current.activePlan.id !== originalPlan.id || current.activePlan.version !== originalPlan.version || current.activeBlueprint?.version !== original.version) throw new Error("The active draft changed; no repair was saved.");
    store.saveResearchSetAndTripBlueprint(finalResearch, finalBlueprint);
    store.createCompiledBlueprintPlan(compilation, "codex");
    store.updatePlanningSessionStatus(original.proposalRef.sessionId, "draft_ready", compilation.plan.id);
  }
  console.log(JSON.stringify({ applied: apply, previousPlanId: originalPlan.id, planId: apply ? compilation.plan.id : undefined, blueprintVersion: finalBlueprint.version, imageMissing: missingPlannedPlaceImages(finalBlueprint, finalResearch).map((place) => place.name), days: finalBlueprint.days.filter((day) => targetDates.has(day.date)).map((day) => ({ date: day.date, stops: day.stops.map((stop) => finalBlueprint.places.find((place) => place.id === stop.placeId)?.name ?? stop.placeId) })) }));
} finally {
  store.close();
}
