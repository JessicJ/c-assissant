import assert from "node:assert/strict";
import test from "node:test";
import { createPlanFromRequest } from "@c-assistant/core";
import { orchestrateJapanArrivalPlan } from "./orchestrator.js";
import { japanArrivalPlanSupportingSkillOrder } from "./index.js";

const now = "2026-08-24T00:00:00.000Z";
const source = (sourceId: string, host = "www.mofa.go.jp") => ({ id: `snapshot-${sourceId}`, sourceId, authority: "Official Japan authority", titleOriginal: sourceId, url: `https://${host}/official`, retrievedAt: "2026-08-23T00:00:00.000Z", contentHash: (sourceId.length % 10).toString().repeat(64) });

test("Japan orchestrator runs supporting Skills in declared order and compiles an inert draft", async () => {
  const plan = createPlanFromRequest({ request: "Tokyo trip" });
  plan.location = "Tokyo, Japan";
  plan.dates = "2026-11-24 to 2026-12-01";
  const policySources = [source("jp-mofa-visa-exemption"), source("jp-mofa-visa-faq")];
  const foodSource = source("jp-go-tokyo-food", "www.gotokyo.org");
  const digitalSource = source("jp-visit-japan-web", "services.digital.go.jp");
  const result = await orchestrateJapanArrivalPlan({
    plan,
    profile: { nationality: "Canada" },
    now,
    policy: { travelPurpose: "tourism", stayDays: 7, departureDate: "2026-11-24", arrivalDate: "2026-11-24", passportConfirmed: true, evidence: policySources },
    weather: { availability: "not_supported", locationName: "Tokyo", retrievedAt: now, provider: "google_weather" },
    housing: { centreName: "Tokyo Station", candidates: [], observedAt: now },
    transport: { routeFacts: [], observedAt: now },
    catalog: { items: [{ id: "visit-japan-web", capability: "digital_entry", nameOriginal: "Visit Japan Web（入国手続オンラインサービス）", nameEnglish: "Visit Japan Web", explanationEnglish: "Review the official arrival service.", sourceId: digitalSource.sourceId }], foodFacts: [{ id: "monjayaki", nameOriginal: "もんじゃ焼き", nameEnglish: "Monjayaki", explanationEnglish: "Tokyo griddle-food culture.", sourceId: foodSource.sourceId }], sources: [foodSource, digitalSource] },
    schedule: { departureAt: "2026-11-24T09:00:00+09:00", arrivalAt: "2026-11-24T12:00:00+09:00", returnAt: "2026-12-01T12:00:00+09:00", timeZone: "Asia/Tokyo" }
  });
  assert.equal(result.status, "compiled", JSON.stringify(result));
  if (result.status !== "compiled") return;
  assert.deepEqual(result.composite.facts.map((item: any) => item.skillId), japanArrivalPlanSupportingSkillOrder);
  assert.equal(result.compilation.plan.status, "draft");
  assert.equal(result.compilation.audit.countryPackId, "japan");
  assert.equal(result.compilation.audit.compositionSkillId, "japan-arrival-plan");
  assert.ok(result.compilation.plan.stages.at(-1)?.tasks.every((task) => task.origin?.countryPackId === "japan"));
  assert.ok(result.compilation.plan.stages.at(-1)?.tasks.some((task) => task.reminder?.timeZone === "Asia/Tokyo"));
});
