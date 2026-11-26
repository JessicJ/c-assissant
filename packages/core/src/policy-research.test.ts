import assert from "node:assert/strict";
import test from "node:test";
import { assessPolicyResearch, policyResearchForTrip, type PolicyResearchInput } from "./policy-research.js";
import { importSkillResearchBatches, importSkillItinerary, mergeResearchSetCheckpoint, type SkillResearchBatchArtifact } from "./skill-importer.js";
import type { BlueprintSource } from "./trip-blueprint.js";

const now = "2026-10-22T00:00:00Z";
const source: BlueprintSource = { id: "official", title: "Fictional authority", authority: "Fictional", url: "https://example.test/entry", retrievedAt: now, official: true, status: "verified" };
const summary = (): PolicyResearchInput => ({ destination: "Portugal", transitCountries: [], nationality: "Example nationality", passportCountry: "Example passport country", purpose: "Tourism", startDate: "2026-11-10", endDate: "2026-11-10", checkedAt: now, sourceUrls: [source.url], missingInformation: [], findings: ["Fictional research notes; no eligibility decision."] });
const context = { researchSetId: "research", generationKey: "generation", proposalRef: { sessionId: "session", proposalVersion: 1 }, skillLineage: { skillId: "landi-trip-blueprint", skillVersion: "1.0.0" }, createdAt: now, updatedAt: now };
function batch(policyResearch?: unknown): SkillResearchBatchArtifact {
  return { id: "lisbon", scopeLabel: "Lisbon", completedAt: now, sources: [source], places: [{ id: "place", name: "Fictional park", city: "Lisbon", locationLabel: "Lisbon", category: "attraction", whyWorthIt: "Fictional visit", plan: "Review a draft visit" }], events: [], ...(policyResearch === undefined ? {} : { policyResearch }) };
}
function itinerary(research: ReturnType<typeof importSkillResearchBatches>, startDate = "2026-11-10") {
  return importSkillItinerary(research, { title: "Fictional trip", summary: "Draft", language: "en", destinations: ["Lisbon"], startDate, endDate: startDate,
    preparationChecklist: [], days: [{ id: "day", date: startDate, kind: "scheduled", city: "Lisbon", title: "Day", summary: "Draft", candidatePlaceIds: [], stops: [{ placeId: research.places[0]!.id, order: 1 }] }], movements: [] },
  { blueprintId: "blueprint", blueprintVersion: 1, createdAt: now });
}

test("missing old data is unassessed without mutation or a generation gate", () => {
  const research = importSkillResearchBatches([batch()], context);
  assert.equal(research.batches[0]!.policyResearch!.status, "not_assessed");
  delete research.batches[0]!.policyResearch;
  const before = structuredClone(research);
  const blueprint = itinerary(research);
  assert.equal(blueprint.policyResearch![0]!.status, "not_assessed");
  assert.ok(blueprint.preparationChecklist!.some((item) => item.title === "Check entry and transit requirements"));
  assert.deepEqual(research, before);
});

test("complete metadata never proves eligibility; explicit empty checklist cannot hide the pending check", () => {
  const research = importSkillResearchBatches([batch(summary())], context);
  const blueprint = itinerary(research);
  assert.equal(blueprint.policyResearch![0]!.status, "needs_recheck");
  const item = blueprint.preparationChecklist!.find((item) => item.id.startsWith("policy-review"))!;
  assert.equal(item.group, "documents");
  assert.equal(item.evidence[0]!.sourceId, research.sources[0]!.id);
  assert.equal(item.evidence[0]!.status, "recheck");
});

test("invalid optional summaries and unsupported private fields become pending work, not import failures", () => {
  for (const value of ["invalid", {}, { ...summary(), passportNumber: "fictional-sensitive-field" }, { ...summary(), findings: [false] }]) {
    const research = importSkillResearchBatches([batch(value)], context);
    assert.equal(research.batches[0]!.policyResearch!.status, "needs_recheck");
    assert.equal(research.batches[0]!.policyResearch!.context, undefined);
    assert.ok(itinerary(research).preparationChecklist!.length);
  }
});

test("unknown traveler context, unrecorded sources, invalid dates and future checks retain uncertainty", () => {
  const unknown = assessPolicyResearch({ ...summary(), nationality: "unknown", passportCountry: "", missingInformation: ["Confirm the transit route"] }, [source], now);
  assert.equal(unknown.status, "needs_input");
  const invalid = assessPolicyResearch({ ...summary(), startDate: "2026-02-30", checkedAt: "2027-01-01", sourceUrls: ["http://example.test", "https://missing.test"] }, [source], now);
  assert.match(invalid.issues.join(" "), /travel dates/);
  assert.match(invalid.issues.join(" "), /check date/);
  assert.match(invalid.issues.join(" "), /recorded official sources/);
  const stale = assessPolicyResearch(summary(), [{ ...source, status: "stale", official: false }], now);
  assert.match(stale.issues.join(" "), /authority, freshness/);
});

test("date changes require recheck and checkpoints keep policy metadata", () => {
  const research = importSkillResearchBatches([batch(summary())], context);
  const merged = mergeResearchSetCheckpoint(undefined, research, { status: "completed", updatedAt: now });
  assert.deepEqual(merged.batches[0]!.policyResearch, research.batches[0]!.policyResearch);
  const blueprint = itinerary(research, "2026-11-11");
  assert.match(blueprint.policyResearch![0]!.issues.join(" "), /trip dates differ/);
  const before = structuredClone(research.batches[0]!.policyResearch);
  policyResearchForTrip(before, research.sources, now, "2026-11-11", "2026-11-11");
  assert.deepEqual(research.batches[0]!.policyResearch, before);
});

test("multi-region research produces one pending document review without changing supplied checklist items", () => {
  const research = importSkillResearchBatches([batch(summary()), { ...batch(), id: "porto", places: [] }], context);
  const blueprint = itinerary(research);
  assert.equal(blueprint.policyResearch!.length, 2);
  assert.equal(blueprint.preparationChecklist!.filter((item) => item.id.startsWith("policy-review")).length, 1);
});
