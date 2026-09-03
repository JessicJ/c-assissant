import type { PlanGenerationState } from "./api-client.js";

export function generationStageMessage(stage: PlanGenerationState["stage"]): string {
  if (stage === "queued") return "Starting plan generation…";
  if (stage === "research") return "Researching places by geographic area and saving each batch…";
  if (stage === "itinerary") return "Creating the daily itinerary from the saved place catalog…";
  if (stage === "import") return "Publishing the complete Trip Blueprint…";
  if (stage === "compile") return "Preparing reviewable execution tasks…";
  if (stage === "ready") return "The complete Trip Blueprint and Plan are ready.";
  if (stage === "cancelled") return "Plan generation was cancelled.";
  return "Plan generation did not finish. Your trip details are saved.";
}

export function generationProgressMessage(generation: PlanGenerationState): string {
  const base = generationStageMessage(generation.stage);
  const scope = generation.scopeLabel ? ` Current area: ${generation.scopeLabel}.` : "";
  const saved = generation.savedPlaceCount !== undefined ? ` ${generation.savedPlaceCount} places saved.` : "";
  return `${base}${scope}${saved}`;
}
