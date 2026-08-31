import { CodexRuntimeAdapter } from "../packages/agent-adapters/lib/index.js";
import { compileTripBlueprint, importSkillItinerary, importSkillResearchBatches } from "../packages/core/lib/index.js";

const adapter = new CodexRuntimeAdapter();
const now = new Date().toISOString();
const request = [
  "Create a one-day Lisbon trip for 2026-10-12.",
  "Two adult travelers want architecture and local neighborhood life at a relaxed pace.",
  "Keep a rich place catalog, but schedule only a practical subset. No accommodation is confirmed."
].join(" ");
const profile = { preferredLanguage: "English", nationality: "Singapore", gender: "prefer_not_to_say", immigrationStatus: "not_obtained" };
let batch;
try {
  batch = await adapter.generateSkillResearchBatch({ request, batch: { id: "lisbon", scopeLabel: "Lisbon" }, profile });
} catch (error) {
  if (error instanceof Error && error.cause instanceof Error) process.stderr.write(`${error.cause.message}\n`);
  throw error;
}
const research = importSkillResearchBatches([batch], {
  researchSetId: "live-research",
  generationKey: "live-e2e:1:interactive-trip-planner@0.2.0",
  proposalRef: { sessionId: "live-e2e", proposalVersion: 1 },
  skillLineage: { skillId: "interactive-trip-planner", skillVersion: "0.2.0" },
  createdAt: now,
  updatedAt: now
});
const itinerary = await adapter.generateSkillItinerary({ request, research, profile });
const blueprint = importSkillItinerary(research, itinerary, { blueprintId: "live-blueprint", blueprintVersion: 1, createdAt: new Date().toISOString() });
const compilation = compileTripBlueprint(blueprint, { createdAt: new Date().toISOString() });
if (blueprint.places.length !== research.places.length) throw new Error("Blueprint compressed the Research Set place catalog.");
if (new Set(blueprint.places.map((place) => place.id)).size !== research.places.length) throw new Error("Blueprint changed place identity during import.");
process.stdout.write(JSON.stringify({
  skill: research.skillLineage,
  places: research.places.length,
  deepPlaces: research.places.filter((place) => place.contentTier === "deep").length,
  detailedPlaces: research.places.filter((place) => place.detailSections?.length).length,
  sources: research.sources.length,
  days: blueprint.days.length,
  movements: blueprint.movements.length,
  actionRequirements: blueprint.actionRequirements.length,
  planStages: compilation.plan.stages.length,
  identitiesPreserved: true
}, null, 2));
