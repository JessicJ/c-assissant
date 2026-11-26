import assert from "node:assert/strict";
import test from "node:test";
import type { SkillItineraryReviewRequest } from "@c-assistant/agent-adapters";
import { SqliteWorkspaceStore } from "@c-assistant/storage";
import { auditItineraryContent } from "./itinerary-content-audit.js";

function request(): SkillItineraryReviewRequest {
  return { request: "Three travelers, New Zealand", profile: { preferredLanguage: "English", nationality: "Canada", gender: "not_specified", immigrationStatus: "unknown" },
    itinerary: { title: "Trip", summary: "Visit", language: "en", destinations: ["Auckland"], startDate: "2026-11-04", endDate: "2026-11-04", days: [{ id: "d1", date: "2026-11-04", kind: "scheduled", city: "Auckland", title: "Visit", summary: "Visit", stops: [{ placeId: "museum", order: 1 }], candidatePlaceIds: [] }], movements: [] },
    research: { places: [{ id: "museum", name: "Museum", city: "Auckland", category: "museum", plan: "Visit", durationMinutes: 120 }] } as SkillItineraryReviewRequest["research"] };
}

test("content review survives a new coordinator and reruns only when the itinerary or supplied facts change", async () => {
  const store = new SqliteWorkspaceStore(":memory:");
  const session = store.createPlanningSession("travel");
  store.saveBlueprintGeneration({ generationKey: "generation", proposalRef: { sessionId: session.id, proposalVersion: 1 }, skillLineage: { skillId: "interactive-trip-planner", skillVersion: "0.2.0" }, status: "running", stage: "import", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  const input = request();
  let calls = 0;
  const review = async () => { calls++; return []; };
  try {
    await auditItineraryContent({ store, generationKey: "generation", request: input, review });
    await auditItineraryContent({ store, generationKey: "generation", request: structuredClone(input), review });
    assert.equal(calls, 1);
    input.research.places[0]!.durationMinutes = 240;
    await auditItineraryContent({ store, generationKey: "generation", request: input, review });
    assert.equal(calls, 2);
    input.itinerary.days[0]!.summary = "Changed route";
    await auditItineraryContent({ store, generationKey: "generation", request: input, review });
    assert.equal(calls, 3);
    assert.ok(store.listDiagnosticArtifacts("generation").every((entry) => !entry.rawResponse.includes("Three travelers")), "Cache stores verdicts and input fingerprints, not full prompts.");
  } finally { store.close(); }
});

test("an invalid reviewer date is never persisted as an accepted verdict", async () => {
  const store = new SqliteWorkspaceStore(":memory:");
  try {
    await assert.rejects(auditItineraryContent({ store, generationKey: "generation", request: request(), review: async () => [{ code: "day_pacing", date: "2026-12-25", blocking: true, explanation: "Wrong date", repairInstruction: "Fix" }] }), /unknown date/);
    assert.deepEqual(store.listDiagnosticArtifacts("generation"), []);
  } finally { store.close(); }
});
