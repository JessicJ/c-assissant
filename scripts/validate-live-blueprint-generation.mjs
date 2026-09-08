import { CodexRuntimeAdapter, LANDI_BLUEPRINT_SKILL } from "../packages/agent-adapters/lib/index.js";
import { blueprintPresentation, compileTripBlueprint, importSkillItinerary, importSkillResearchBatches } from "../packages/core/lib/index.js";

const adapter = new CodexRuntimeAdapter();
const now = new Date().toISOString();
const timeoutMs = Number.parseInt(process.env.LANDI_LIVE_BLUEPRINT_TIMEOUT_MS ?? String(55 * 60_000), 10);
const startedAt = Date.now();
const controller = new AbortController();
let timeoutExpired = false;
const timeoutTimer = Number.isFinite(timeoutMs) && timeoutMs > 0
  ? setTimeout(() => {
    timeoutExpired = true;
    controller.abort(`Live Blueprint validation exceeded ${timeoutMs}ms.`);
  }, timeoutMs)
  : undefined;
timeoutTimer?.unref?.();

function elapsedSeconds() {
  return Math.round((Date.now() - startedAt) / 1000);
}

function log(message) {
  process.stderr.write(`[live-blueprint +${elapsedSeconds()}s] ${message}\n`);
}

function stageLogger(label) {
  return (stage) => log(`${label}: ${stage}`);
}

function rethrowLiveError(error) {
  if (error instanceof Error && error.cause instanceof Error) process.stderr.write(`${error.cause.message}\n`);
  if (timeoutExpired) throw new Error(`Live Blueprint validation timed out after ${timeoutMs}ms.`, { cause: error });
  throw error;
}

const request = [
  "Create a four-day Lisbon trip from 2026-10-12 through 2026-10-15.",
  "Two adult travelers want architecture, local neighborhood life, cafes, and one light shopping or craft thread at a relaxed pace.",
  "They arrive at Lisbon Airport around 14:30 on 2026-10-12 and leave from Lisbon Airport around 18:20 on 2026-10-15.",
  "Keep the trip based in Lisbon; do not add overnight stays or day trips outside the Lisbon area for this validation run.",
  "Keep a rich place catalog, schedule only a practical subset, preserve unscheduled alternatives, and keep any background food/product/experience themes informational until a concrete venue exists."
].join(" ");
const profile = { preferredLanguage: "English", nationality: "Singapore", gender: "prefer_not_to_say", immigrationStatus: "not_obtained" };
let batch;
try {
  log(`starting native live generation acceptance for ${LANDI_BLUEPRINT_SKILL.skillId}@${LANDI_BLUEPRINT_SKILL.skillVersion}`);
  log("requesting research batch");
  batch = await adapter.generateSkillResearchBatch({ request, batch: { id: "lisbon", scopeLabel: "Lisbon" }, profile, skillLineage: LANDI_BLUEPRINT_SKILL, signal: controller.signal, onStage: stageLogger("research") });
  log(`research batch returned ${batch.places.length} places, ${batch.sources.length} sources`);
} catch (error) {
  if (timeoutTimer) clearTimeout(timeoutTimer);
  rethrowLiveError(error);
}
log("importing research set");
const research = importSkillResearchBatches([batch], {
  researchSetId: "live-research",
  generationKey: `live-e2e:1:${LANDI_BLUEPRINT_SKILL.skillId}@${LANDI_BLUEPRINT_SKILL.skillVersion}`,
  proposalRef: { sessionId: "live-e2e", proposalVersion: 1 },
  skillLineage: LANDI_BLUEPRINT_SKILL,
  createdAt: now,
  updatedAt: now
});
try {
  log("requesting itinerary from imported research set");
  const itinerary = await adapter.generateSkillItinerary({ request, research, profile, signal: controller.signal, onStage: stageLogger("itinerary") });
  log(`itinerary returned ${itinerary.days.length} days, ${itinerary.movements.length} movements`);
  log("importing itinerary into Trip Blueprint");
  const blueprint = importSkillItinerary(research, itinerary, { blueprintId: "live-blueprint", blueprintVersion: 1, createdAt: new Date().toISOString() });
  log("compiling Blueprint into deterministic Plan work and Web presentation");
  const compilation = compileTripBlueprint(blueprint, { createdAt: new Date().toISOString() });
  const presentation = blueprintPresentation(blueprint);
  log("running live acceptance assertions");
  if (blueprint.places.length !== research.places.length) throw new Error("Blueprint compressed the Research Set place catalog.");
  if (new Set(blueprint.places.map((place) => place.id)).size !== research.places.length) throw new Error("Blueprint changed place identity during import.");
  if (blueprint.skillLineage.skillId !== LANDI_BLUEPRINT_SKILL.skillId || blueprint.skillLineage.skillVersion !== LANDI_BLUEPRINT_SKILL.skillVersion) throw new Error("Blueprint did not preserve the Landi generation policy lineage.");
  if (blueprint.days.length < 4) throw new Error("Live Blueprint did not produce the requested multi-day itinerary.");
  if (blueprint.days.some((day) => !day.blocks?.length)) throw new Error("Every live itinerary day must include typed display blocks.");
  if (!blueprint.places.some((place) => place.schedulingEligibility?.decision === "schedulable" && !blueprint.days.some((day) => day.stops.some((stop) => stop.placeId === place.id)))) throw new Error("Live Blueprint did not preserve schedulable unscheduled alternatives.");
  if (!blueprint.sources.length) throw new Error("Live Blueprint did not preserve a source catalog.");
  if (!blueprint.actionRequirements.length) throw new Error("Live Blueprint did not include preparation or recheck action requirements.");
  if (!((blueprint.localFoods?.length ?? 0) || (blueprint.localProducts?.length ?? 0) || (blueprint.experienceThemes?.length ?? 0))) throw new Error("Live Blueprint did not include guide catalog context.");
  if (presentation.kind !== "itinerary" || presentation.days.length !== blueprint.days.length) throw new Error("Blueprint did not produce a Web itinerary presentation.");
  if (!compilation.plan.stages.length || compilation.lineage.blueprintId !== blueprint.id) throw new Error("Compiled Plan did not keep deterministic execution work and Blueprint lineage.");
  process.stdout.write(JSON.stringify({
    skill: research.skillLineage,
    places: research.places.length,
    deepPlaces: research.places.filter((place) => place.contentTier === "deep").length,
    detailedPlaces: research.places.filter((place) => place.detailSections?.length).length,
    sources: research.sources.length,
    days: blueprint.days.length,
    blockDays: blueprint.days.filter((day) => day.blocks?.length).length,
    movements: blueprint.movements.length,
    actionRequirements: blueprint.actionRequirements.length,
    localFoods: blueprint.localFoods?.length ?? 0,
    localProducts: blueprint.localProducts?.length ?? 0,
    experienceThemes: blueprint.experienceThemes?.length ?? 0,
    planStages: compilation.plan.stages.length,
    presentationDays: presentation.days.length,
    identitiesPreserved: true
  }, null, 2));
  log("live acceptance passed");
} catch (error) {
  rethrowLiveError(error);
} finally {
  if (timeoutTimer) clearTimeout(timeoutTimer);
}
