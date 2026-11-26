import { writeFileSync } from "node:fs";
import { CodexRuntimeAdapter } from "../packages/agent-adapters/src/index.js";
import { SqliteWorkspaceStore } from "../packages/storage/src/index.js";
import { emptyDestinationDayDates } from "../apps/server/src/day-completion.js";

const expectedPlanId = process.argv[2];
const outputPath = process.argv[3];
if (!expectedPlanId || !outputPath) throw new Error("Usage: tsx scripts/research-current-empty-days.ts <draft-plan-id> <output-json>");

const store = new SqliteWorkspaceStore("data/c-assistant.sqlite");
try {
  const workspace = store.getWorkspace();
  const blueprint = workspace.activeBlueprint;
  if (workspace.activePlan.id !== expectedPlanId || workspace.activePlan.status !== "draft" || !blueprint) throw new Error("The requested draft is no longer active.");
  const dates = emptyDestinationDayDates(blueprint);
  if (!dates.length) throw new Error("The draft has no empty destination days.");
  const existingPlaces = blueprint.places.map((place) => `${place.name} (${place.city || place.area || "unknown"})`).join("; ");
  const request = [
    `Supplemental, source-grounded Wellington research for the existing ${blueprint.startDate} to ${blueprint.endDate} trip for two travelers.`,
    `The current plan has four full destination dates with no daytime activity: ${dates.join(", ")}.`,
    "Find 6 to 10 distinct, specific, geographically coherent, primarily free or low-cost Wellington experiences that could make these four days useful without requiring a new hotel. Favor museums, culture, waterfront or urban nature, and neighborhood experiences. Do not make an expensive guided tour or restaurant meal the only reason to leave the hotel.",
    "Do not duplicate these already researched places: " + existingPlaces,
    "Use real place identities, coordinates, exact source URLs, and honest 2026-12 operating uncertainty. A date-specific opening time or price is not confirmed unless the source actually proves it. Add direct place photographs with source URLs when available; do not invent image URLs.",
    "Research supplies candidates only. The planner will select a realistic daily route later."
  ].join("\n\n");
  const artifact = await new CodexRuntimeAdapter().generateSkillResearchBatch({
    request,
    batch: { id: `completion-current-${expectedPlanId}`, scopeLabel: "Wellington additional full days" },
    profile: workspace.profile,
    skillLineage: blueprint.skillLineage
  });
  writeFileSync(outputPath, JSON.stringify({ planId: expectedPlanId, blueprintVersion: blueprint.version, dates, artifact }, null, 2));
  console.log(JSON.stringify({ outputPath, places: artifact.places.map((place) => ({ name: place.name, category: place.category })), sources: artifact.sources.length }));
} finally {
  store.close();
}
