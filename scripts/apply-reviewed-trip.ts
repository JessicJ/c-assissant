/** Apply an already reviewed isolated draft only when the live facts and original draft still match. */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { assertTripBlueprintIntegrity, compileTripBlueprint, type WorkspaceSnapshot } from "../packages/core/src/index.js";
import { SqliteWorkspaceStore } from "../packages/storage/src/index.js";
import { auditItineraryContent } from "../apps/server/src/itinerary-content-audit.js";
import { ITINERARY_CONTENT_REQUIREMENTS } from "../apps/server/src/itinerary-content-review.js";
import { itineraryArtifactFromBlueprint, reviewItineraryForPublication } from "../apps/server/src/itinerary-publication-review.js";
import { planningRequestForGenerationWithBookings } from "../apps/server/src/planning-session-generation.js";
import { auditPlannedPlaceImageCoverage } from "../apps/server/src/planned-place-image-coverage.js";

const [isolatedPath, expectedReplacementId, originalSnapshotPath, outputPath] = process.argv.slice(2);
if (!isolatedPath || !expectedReplacementId || !originalSnapshotPath || !outputPath || !resolve(isolatedPath).startsWith("/private/tmp/")) throw new Error("Usage: tsx scripts/apply-reviewed-trip.ts <isolated-db> <replacement-draft-id> <original-snapshot> <report>");
const original = JSON.parse(await readFile(resolve(originalSnapshotPath), "utf8")) as WorkspaceSnapshot;
const isolated = new SqliteWorkspaceStore(resolve(isolatedPath));
const live = new SqliteWorkspaceStore(resolve(process.env.C_ASSISTANT_DATA_PATH ?? "data/c-assistant.sqlite"));
try {
  const replacement = isolated.getWorkspace();
  const blueprint = replacement.activeBlueprint;
  if (replacement.activePlan.id !== expectedReplacementId || replacement.activePlan.status !== "draft" || !blueprint) throw new Error("The reviewed isolated draft changed.");
  const current = live.getWorkspace();
  if (current.activePlan.id !== original.activePlan.id || current.activePlan.version !== original.activePlan.version || current.activeBlueprint?.version !== original.activeBlueprint?.version || current.activePlan.status !== "draft") throw new Error("The user draft changed; result not applied.");
  const session = live.getPlanningSessionById(blueprint.proposalRef.sessionId);
  const isolatedSession = isolated.getPlanningSessionById(blueprint.proposalRef.sessionId);
  if (!session || !isolatedSession || session.confirmedProposalVersion !== blueprint.proposalRef.proposalVersion || JSON.stringify(session.facts) !== JSON.stringify(isolatedSession.facts)) throw new Error("Planning facts changed; result not applied.");
  if (JSON.stringify(live.listTravelBookingsForPlanningSession(session.id)) !== JSON.stringify(isolated.listTravelBookingsForPlanningSession(session.id))) throw new Error("Bookings changed; result not applied.");
  if (isolated.getBlueprintGeneration(blueprint.generationKey)?.status !== "completed") throw new Error("The replacement generation did not finish.");
  assertTripBlueprintIntegrity(blueprint);
  const deterministic = reviewItineraryForPublication(blueprint, session);
  if (deterministic.length) throw new Error(JSON.stringify(deterministic));
  const research = isolated.getResearchSet(blueprint.researchSetId)!;
  const profile = { preferredLanguage: replacement.profile.preferredLanguage, nationality: replacement.profile.nationality, gender: replacement.profile.gender, immigrationStatus: replacement.profile.immigrationStatus };
  if (JSON.stringify(profile) !== JSON.stringify({ preferredLanguage: current.profile.preferredLanguage, nationality: current.profile.nationality, gender: current.profile.gender, immigrationStatus: current.profile.immigrationStatus })) throw new Error("Profile changed; result not applied.");
  const editorial = await auditItineraryContent({ store: isolated, generationKey: blueprint.generationKey,
    request: { request: `${planningRequestForGenerationWithBookings({ ...session, status: "proposal_confirmed" }, isolated.listTravelBookingsForPlanningSession(session.id))}\n\n${ITINERARY_CONTENT_REQUIREMENTS}`, research, itinerary: itineraryArtifactFromBlueprint(blueprint), profile },
    review: async () => { throw new Error("This exact itinerary and evidence have no matching independent review. Do not apply."); } });
  if (editorial.some((finding) => finding.blocking)) throw new Error(JSON.stringify(editorial));
  const originalIds = new Set(original.activeBlueprint!.places.map((place) => place.id));
  if ([...originalIds].some((id) => !blueprint.places.some((place) => place.id === id))) throw new Error("Original place catalog was reduced.");
  const compilation = compileTripBlueprint(blueprint, { createdAt: new Date().toISOString(), completedRequirementIds: current.activePlan.stages.flatMap((stage) => stage.tasks).filter((task) => task.status === "completed" && task.requirementId).map((task) => task.requirementId!) });
  compilation.plan.configuration = structuredClone(current.activePlan.configuration);
  // Validation precedes all live writes. Existing plan history remains recoverable.
  live.saveResearchSetAndTripBlueprint(research, blueprint);
  const saved = live.createCompiledBlueprintPlan(compilation, "codex");
  live.updatePlanningSessionStatus(session.id, "draft_ready", saved.activePlan.id);
  const report = { previousPlanId: current.activePlan.id, planId: saved.activePlan.id, status: saved.activePlan.status, blueprintVersion: saved.activeBlueprint?.version,
    deterministicFindings: deterministic, editorialFindings: editorial, images: auditPlannedPlaceImageCoverage(blueprint, research) };
  await writeFile(resolve(outputPath), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ previousPlanId: current.activePlan.id, planId: saved.activePlan.id, status: saved.activePlan.status, blueprintVersion: saved.activeBlueprint?.version, missingImages: report.images.filter((row) => row.status === "image_missing").map((row) => row.place) }));
} finally { isolated.close(); live.close(); }
