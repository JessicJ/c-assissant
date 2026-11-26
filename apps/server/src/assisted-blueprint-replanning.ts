import { RuntimeAdapterError, type CodexPlanRequest, type CodexRuntimeAdapter, type SkillItineraryReviewRequest, type SkillItineraryReviewFinding } from "@c-assistant/agent-adapters";
import { compileTripBlueprint, importSkillItinerary, type DirectBlueprintAssistedReplanningHandoff, type PlanningSession, type SkillItineraryArtifact, type TripBlueprint } from "@c-assistant/core";
import type { SqliteWorkspaceStore } from "@c-assistant/storage";
import { materializeRecommendedAccommodationAnchors } from "./accommodation-anchor-materialization.js";
import { correctImpossibleFlightMovements } from "./gateway-node-completion.js";
import { itineraryArtifactFromBlueprint, reviewItineraryForPublication } from "./itinerary-publication-review.js";
import { normalizeUnverifiedBookedTimes } from "./itinerary-quality-review.js";
import { materializeProposedHotelDepartures } from "./proposed-departure-times.js";
import { completeDepartureEndpoint } from "./departure-endpoint-completion.js";
import { ITINERARY_CONTENT_REQUIREMENTS, normalizeDayCandidates } from "./itinerary-content-review.js";
import { auditItineraryContent } from "./itinerary-content-audit.js";

/** A conversational edit produces a new Blueprint-backed Draft from the saved place catalog. */
export async function assistedBlueprintReplan(input: {
  store: SqliteWorkspaceStore;
  runtime: Pick<CodexRuntimeAdapter, "generateSkillItinerary">;
  base: TripBlueprint;
  session: PlanningSession;
  request: string;
  profile: CodexPlanRequest["profile"];
  expectedPlanId: string;
  expectedPlanVersion: number;
  handoff?: DirectBlueprintAssistedReplanningHandoff;
  reviewContent?: (request: SkillItineraryReviewRequest) => Promise<SkillItineraryReviewFinding[]>;
}): Promise<ReturnType<SqliteWorkspaceStore["getWorkspace"]>> {
  const research = input.store.getResearchSet(input.base.researchSetId);
  if (!research) throw new Error("The saved place catalog is unavailable. The existing plan has not changed.");
  const oldArtifact = itineraryArtifactFromBlueprint(input.base);
  const affectedDates = new Set(input.handoff?.affectedDayIds.map((id) => input.base.days.find((day) => day.id === id)?.date).filter((date): date is string => Boolean(date)) ?? []);
  const request = [
    input.request,
    ITINERARY_CONTENT_REQUIREMENTS,
    "Replan the complete itinerary using only the saved Research Set place identities. Return every confirmed date. Preserve confirmed bookings, selected lodging, arrival and departure constraints, and the full date range. Keep uncertain service times provisional. End a departure day at its transport node, without a hotel return.",
    input.handoff ? `Only these dates may change: ${[...affectedDates].join(", ")}. All other dates will be restored exactly from the saved Blueprint.` : "Keep unrelated days unchanged wherever possible.",
    `Current itinerary artifact: ${JSON.stringify(oldArtifact)}`
  ].join("\n\n");
  let artifact: SkillItineraryArtifact | undefined;
  let lastError: Error | undefined;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let receivedArtifact = false;
    try {
      artifact = await input.runtime.generateSkillItinerary({
        request, research,
        profile: input.profile,
        ...(attempt && artifact ? { repair: { rejected: artifact, issues: [lastError?.message ?? "The itinerary review found an issue."] } } : {})
      });
      receivedArtifact = true;
      const createdAt = new Date().toISOString();
      let candidate = importSkillItinerary(research, artifact, {
        blueprintId: input.base.id,
        blueprintVersion: input.base.version + 1,
        createdAt,
        bookingConstraints: input.base.bookingConstraints ?? []
      });
      if (input.handoff) candidate = preserveUnaffectedDays(input.base, candidate, affectedDates);
      candidate = {
        ...candidate,
        places: candidate.places.map((place) => input.base.places.find((saved) => saved.id === place.id) ?? place),
        bookingConstraints: structuredClone(input.base.bookingConstraints ?? [])
      };
      candidate = materializeProposedHotelDepartures(completeDepartureEndpoint(correctImpossibleFlightMovements(normalizeUnverifiedBookedTimes(materializeRecommendedAccommodationAnchors(candidate).blueprint)), input.session), input.session);
      candidate = normalizeDayCandidates(candidate);
      const findings = reviewItineraryForPublication(candidate, input.session);
      if (input.reviewContent) {
        const editorial = await auditItineraryContent({ store: input.store, generationKey: input.base.generationKey,
          request: { request, research, itinerary: itineraryArtifactFromBlueprint(candidate), profile: input.profile }, review: input.reviewContent });
        findings.push(...editorial.filter((finding) => finding.blocking));
      }
      if (findings.length) throw new Error(findings.map((finding) => `${finding.date ?? "Trip"}: ${finding.explanation} ${finding.repairInstruction}`).join("; "));
      const current = input.store.getWorkspace();
      if (current.activePlan.id !== input.expectedPlanId || current.activePlan.version !== input.expectedPlanVersion || current.activeBlueprint?.version !== input.base.version) {
        throw new Error("The plan changed while this edit was being prepared. Review the latest version before trying again.");
      }
      const saved = input.store.saveTripBlueprint(candidate);
      const completedRequirementIds = [current.activePlan, current.executionPlan]
        .filter((plan) => Boolean(plan))
        .flatMap((plan) => plan!.stages.flatMap((stage) => stage.tasks))
        .filter((task) => task.status === "completed" && task.requirementId)
        .map((task) => task.requirementId!);
      return input.store.createCompiledBlueprintPlan(compileTripBlueprint(saved, { createdAt, completedRequirementIds }));
    } catch (error) {
      if (error instanceof RuntimeAdapterError) throw error;
      if (!receivedArtifact) throw error;
      lastError = error instanceof Error ? error : new Error("The itinerary could not be reviewed.");
      if (/plan changed while this edit/i.test(lastError.message)) throw lastError;
    }
  }
  throw new Error("The itinerary edit could not pass the route review. Your current plan is unchanged. Please retry.");
}

function preserveUnaffectedDays(base: TripBlueprint, candidate: TripBlueprint, affectedDates: Set<string>): TripBlueprint {
  const savedDays = new Map(base.days.map((day) => [day.date, day] as const));
  const days = candidate.days.map((day) => affectedDates.has(day.date) ? day : structuredClone(savedDays.get(day.date) ?? day));
  const affectedIds = new Set(days.filter((day) => affectedDates.has(day.date)).map((day) => day.id));
  const oldUnaffectedIds = new Set(base.days.filter((day) => !affectedDates.has(day.date)).map((day) => day.id));
  return {
    ...candidate,
    title: base.title,
    summary: base.summary,
    language: base.language,
    destinations: structuredClone(base.destinations),
    days,
    movements: [
      ...candidate.movements.filter((movement) => affectedIds.has(movement.dayId)),
      ...base.movements.filter((movement) => oldUnaffectedIds.has(movement.dayId))
    ],
    // Keep the saved presentation context for a scoped map edit.
    ...(base.guideTheme ? { guideTheme: structuredClone(base.guideTheme) } : {}),
    ...(base.travelTips ? { travelTips: structuredClone(base.travelTips) } : {}),
    ...(base.preparationChecklist ? { preparationChecklist: structuredClone(base.preparationChecklist) } : {}),
    actionRequirements: structuredClone(base.actionRequirements),
    startDate: base.startDate,
    endDate: base.endDate
  };
}
