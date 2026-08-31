import assert from "node:assert/strict";
import test from "node:test";
import { createSkillRegistry } from "@c-assistant/skill-runtime";
import { runJapanArrivalPlanSkill, runJapanPolicyApplicabilitySkill, runJapanTransportPlannerSkill, japanArrivalPlanSupportingSkillOrder } from "./index.js";
import { japanSkillRegistrations, japanSkillRegistry } from "./registry.js";

const now = "2026-08-24T00:00:00.000Z";
const evidence = (sourceId: string, age = "2026-08-23T00:00:00.000Z") => ({ id: `snapshot-${sourceId}`, sourceId, authority: "Ministry of Foreign Affairs of Japan", titleOriginal: sourceId, url: `https://www.mofa.go.jp/${sourceId}.html`, retrievedAt: age, contentHash: sourceId.length.toString(16).padStart(64, "a").slice(-64) });

test("Japan manifest registry loads with namespaced Skill IDs", () => {
  assert.equal(japanSkillRegistry.list().length, 8);
  assert.ok(japanSkillRegistry.list().every((item) => item.country === "japan" && item.id.startsWith("japan-")));
  assert.throws(() => createSkillRegistry([japanSkillRegistrations[0]!, japanSkillRegistrations[0]!]), /Duplicate Skill id/);
  assert.throws(() => createSkillRegistry([{ ...japanSkillRegistrations[0]!, entrypoint: "wrongBinding" }]), /Entrypoint mismatch/);
});

test("Japan policy preparation requires explicit identity facts and two fresh MOFA snapshots", () => {
  const missing = runJapanPolicyApplicabilitySkill({ evidence: [], now });
  assert.equal(missing.status, "needs_input");
  assert.deepEqual(missing.needsInput.map((item) => item.field), ["nationality", "travelPurpose", "stayDays", "departureDate", "arrivalDate", "passportConfirmed", "officialEvidence"]);
  const stale = runJapanPolicyApplicabilitySkill({ nationality: "Canada", travelPurpose: "tourism", stayDays: 7, departureDate: "2026-11-24", arrivalDate: "2026-11-24", passportConfirmed: true, evidence: [evidence("jp-mofa-visa-exemption", "2026-07-01T00:00:00.000Z"), evidence("jp-mofa-visa-faq", "2026-07-01T00:00:00.000Z")], now });
  assert.equal(stale.status, "blocked");
  const misbound = runJapanPolicyApplicabilitySkill({ nationality: "Canada", travelPurpose: "tourism", stayDays: 7, departureDate: "2026-11-24", arrivalDate: "2026-11-24", passportConfirmed: true, evidence: [{ ...evidence("jp-mofa-visa-exemption"), url: "https://www.gotokyo.org/en/" }, evidence("jp-mofa-visa-faq")], now });
  assert.equal(misbound.status, "blocked");
  const ready = runJapanPolicyApplicabilitySkill({ nationality: "Canada", travelPurpose: "tourism", stayDays: 7, departureDate: "2026-11-24", arrivalDate: "2026-11-24", passportConfirmed: true, evidence: [evidence("jp-mofa-visa-exemption"), evidence("jp-mofa-visa-faq")], now });
  assert.equal(ready.status, "success");
  assert.match(ready.warnings.join(" "), /does not decide visa exemption/i);
});

test("Japan composition preserves declared order and fails closed on a missing result", () => {
  const results = japanArrivalPlanSupportingSkillOrder.slice(0, -1).reverse().map((id) => ({ skill: { id, version: "0.1.0" as const }, status: "success" as const, summary: id, facts: [], assumptions: [], recommendations: [], proposedPlanChanges: [], proposedTasks: [], proposedReminders: [], actionCards: [], sources: [], warnings: [] }));
  const blocked = runJapanArrivalPlanSkill({ planId: "plan-1", planVersion: 2, supportingResults: results });
  assert.equal(blocked.status, "blocked");
  assert.deepEqual(blocked.missingSkills, ["japan-arrival-preparation"]);
  assert.deepEqual(blocked.facts.map((item: any) => item.skillId), japanArrivalPlanSupportingSkillOrder.slice(0, -1));
});

test("Japan transport uses the saved Plan preference and degrades without airport route facts", () => {
  const preferred = runJapanTransportPlannerSkill({
    observedAt: now,
    preference: "public_transit",
    routeFacts: [
      { mode: "driving", distanceMeters: 14_000, durationSeconds: 1_200 },
      { mode: "transit", distanceMeters: 18_000, durationSeconds: 2_400 }
    ]
  });
  assert.equal((preferred.recommendations[0] as { mode: string }).mode, "transit");
  assert.match((preferred.recommendations[0] as { reason: string }).reason, /preference saved/i);

  const unavailable = runJapanTransportPlannerSkill({ observedAt: now, preference: "taxi", routeFacts: [] });
  assert.equal(unavailable.status, "degraded");
  assert.deepEqual(unavailable.facts, []);
  assert.deepEqual(unavailable.sources, []);
});
