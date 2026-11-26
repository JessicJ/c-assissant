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

const liveGenerationMessages = new Set([
  "Researching specific accommodation anchors.",
  "Building the daily itinerary from saved places.",
  "Importing the validated final Semantic plan.",
  "Validating and publishing the Trip Blueprint.",
  "Checking flight departure airports before final review.",
  "Researching confirmed airport and station route nodes.",
  "Reusing the saved content review.",
  "Reviewing route, daily pace and travel connections.",
  "Correcting final whole-trip review findings.",
  "Compiling deterministic Plan tasks.",
  "Local task supervision stopped. Restarting will resume the same MAH task.",
  "Re-composing under-planned days.",
  "Finding optional local choices for the guide…",
  "Preparing itinerary cards…"
]);

function knownGenerationMessage(generation: PlanGenerationState): string | undefined {
  const message = generation.message;
  if (generation.status !== "running" || !message) return undefined;
  if (liveGenerationMessages.has(message)) return message;
  if (generation.scopeLabel && (message === `Researching ${generation.scopeLabel}.`
    || message === `Finding optional local choices near ${generation.scopeLabel}…`)) return message;
  if (Number.isSafeInteger(generation.savedPlaceCount) && generation.savedPlaceCount! >= 0
    && message === `Saved ${generation.savedPlaceCount} researched places.`) return message;
  if (/^Researching completion candidates for \d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])\.$/.test(message)) return message;
  return undefined;
}

export function generationProgressMessage(generation: PlanGenerationState, now = new Date()): string {
  const liveMessage = knownGenerationMessage(generation);
  const base = liveMessage || generationStageMessage(generation.stage);
  const scope = !liveMessage && generation.scopeLabel ? ` Current area: ${generation.scopeLabel}.` : "";
  const saved = generation.savedPlaceCount === 0 && generation.stage === "research" ? " Researching the first place batch; nothing saved yet."
    : generation.savedPlaceCount !== undefined ? ` ${generation.savedPlaceCount} places saved.` : "";
  const elapsedMs = now.getTime() - Date.parse(generation.startedAt);
  const elapsed = generation.status === "running" && elapsedMs >= 60_000 && elapsedMs < 86_400_000
    ? ` Running for ${Math.floor(elapsedMs / 60_000)} min.` : "";
  return `${base}${scope}${saved}${elapsed}`;
}

export function generationFailureMessage(generation: PlanGenerationState): string {
  if (generation.failureCode === "mah_not_configured") return "MAH is not configured. MAH manages agent selection. Plan generation still needs verification after setup. Your workspace and saved plans are available.";
  if (["mah_not_ready", "mah_capability_unavailable", "mah_cli_failed", "mah_cli_timed_out"].includes(generation.failureCode ?? "")) return "The MAH connection needed for plan generation could not be verified. MAH manages agent selection. Your proposal and completed progress are saved.";
  if (generation.failureCode === "mah_slot_unavailable") return "MAH has no available interactive capacity. Your original generation request and completed progress are saved. Wait for the current work to finish, then try again.";
  if (generation.failureCode === "mah_scheduler_unavailable" || generation.failureCode === "mah_submission_unknown") return "The MAH task is queued or temporarily unavailable. Your original request and completed progress are saved. Check MAH and try again with your saved trip details.";
  if (["mah_personal_os_schema_unsupported", "mah_personal_os_projection_invalid", "mah_execution_carriers_schema_unsupported", "mah_execution_carriers_invalid"].includes(generation.failureCode ?? "")) return "This MAH version is incompatible with the current Landi connection. Update MAH and try again. Your original request and completed progress are saved.";
  if (["mah_provider_route_unsupported", "mah_provider_route_unverified"].includes(generation.failureCode ?? "")) return "The MAH agent connection could not be verified. Your original request and completed progress are saved. Check MAH before trying again.";
  if ((generation.failureCode ?? "").startsWith("mah_artifact_") || ["mah_business_contract_mismatch", "mah_business_payload_invalid", "mah_business_integrity_failed"].includes(generation.failureCode ?? "")) return "The MAH result did not pass Landi verification. Your saved research and itinerary progress are kept. Check your MAH version before trying again.";
  if (generation.message?.startsWith("Trip Blueprint final review failed:")) {
    const dates = [...new Set(generation.message.match(/\b\d{4}-\d{2}-\d{2}\b/g) ?? [])];
    if (dates.length) return `The itinerary still needs a better daytime route on ${dates.join(", ")}. Your trip details and completed research are saved.`;
  }
  if (generation.failureCode === "timed_out") return "Plan generation took too long. Your trip details and completed research are saved; please retry.";
  if (generation.stage === "import" || generation.stage === "itinerary") return "I couldn't finish checking the daily route. Your trip details and completed research are saved; please retry.";
  return "Plan generation did not finish. Your trip details and completed work are saved; please retry.";
}
