import type { BlueprintRuntime } from "./agent-work-contract.js";
import { RuntimeAdapterError, type CodexRuntimeAdapter } from "@c-assistant/agent-adapters";
import type { BlueprintGenerationEvent, ResearchSet, TripBlueprint } from "@c-assistant/core";
import type { SqliteWorkspaceStore } from "@c-assistant/storage";
import { missingPlannedPlaceImages } from "./planned-place-image-coverage.js";
import { probeRemoteImageUrl, runPlannedPlaceImagePass } from "./planned-place-image-pipeline.js";
import { searchWikipediaPlaceImages } from "./wikipedia-place-images.js";

/** One bounded image-only continuation after publication. It never activates or replaces a plan. */
export async function continuePublishedPlanImages(input: {
  store: SqliteWorkspaceStore;
  codex: BlueprintRuntime;
  planId: string;
  research: ResearchSet;
  blueprint: TripBlueprint;
  request: string;
  profile: Parameters<CodexRuntimeAdapter["generatePlannedPlaceImageEnrichment"]>[0]["profile"];
  signal?: AbortSignal;
  probeImageUrl?: (url: string) => Promise<boolean | undefined>;
  lookupKnownImages?: Parameters<typeof runPlannedPlaceImagePass>[0]["lookupKnownImages"];
  runWithStageContext?: <T>(identity: { phase: string; round: number }, operation: () => Promise<T>) => Promise<T>;
  sequentialCarriers?: boolean;
  rejectCandidate?: Parameters<typeof runPlannedPlaceImagePass>[0]["rejectCandidate"];
  carrierCheckpoint?: (value: { generationKey: string; requestedPlaceIds: string[]; savedPlaceCount: number; createdAt: string; candidate?: unknown }) => {
    carrierTaskIds: readonly string[];
    generationEvent: Omit<BlueprintGenerationEvent, "sequence">;
  };
}) {
  let expectedBlueprint = input.blueprint;
  let expectedResearch = input.research;
  let saveError: RuntimeAdapterError | undefined;
  const controller = new AbortController();
  const signal = input.signal ? AbortSignal.any([input.signal, controller.signal]) : controller.signal;
  if (!missingPlannedPlaceImages(input.blueprint, input.research).length) return;
  return runPlannedPlaceImagePass({
    research: input.research, blueprint: input.blueprint, signal, sequentialCarriers: input.sequentialCarriers === true,
    ...(input.rejectCandidate ? { rejectCandidate: input.rejectCandidate } : {}),
    probeImageUrl: (url, signal) => input.probeImageUrl ? input.probeImageUrl(url) : probeRemoteImageUrl(url, { signal }),
    lookupKnownImages: input.lookupKnownImages ?? ((places, signal) => searchWikipediaPlaceImages(places, { signal, sources: input.research.sources })),
    search: (places, timeoutMs, rejectedImageUrls, signal, imageStage) => {
      const operation = () => input.codex.generatePlannedPlaceImageEnrichment({
      request: `${input.request}\nFind photographs only for these remaining places. Do not change itinerary content. Do not reuse rejected image URLs: ${rejectedImageUrls.join(", ")}`,
      scopeLabel: input.blueprint.destinations.join(" / "), places, sources: input.research.sources, rejectedImageUrls, profile: input.profile, timeoutMs, signal
      });
      return input.runWithStageContext ? input.runWithStageContext({ phase: "图片发布后补充", round: imageStage.round }, operation) : operation();
    },
    save: (research, blueprint, saveContext) => {
      try {
        const carrierCheckpoint = saveContext.source === "agent_generation" && input.carrierCheckpoint
          ? input.carrierCheckpoint({
            generationKey: research.generationKey,
            requestedPlaceIds: saveContext.requestedPlaceIds,
            candidate: saveContext.candidate,
            savedPlaceCount: research.places.length,
            createdAt: new Date().toISOString()
          })
          : undefined;
        const saved = input.store.saveResearchSetAndTripBlueprint(
          research,
          blueprint,
          { planId: input.planId, expectedBlueprint, expectedResearch },
          carrierCheckpoint
        );
        expectedBlueprint = saved.blueprint;
        expectedResearch = saved.research;
        return saved;
      } catch (error) {
        saveError = new RuntimeAdapterError("superseded", error instanceof Error ? error.message : "The plan changed during image continuation.");
        controller.abort();
        // Stop further searches as soon as this continuation becomes stale.
        throw saveError;
      }
    }
  }).catch(error => { throw saveError ?? error; });
}
