import assert from "node:assert/strict";
import test from "node:test";
import { createPlanFromDraft } from "@c-assistant/core";
import type { ConnectorResult, PlaceFact } from "@c-assistant/connectors";
import { venueSourceCandidate } from "./plan-venue-monitor.js";

function venuePlan() {
  return createPlanFromDraft({
    title: "Paris",
    location: "Paris",
    dates: "October 2026",
    knownInformation: ["Travel"], assumptions: [], nextAction: "Review", stages: [],
    presentation: {
      kind: "itinerary", summary: "Paris", startDate: "2026-10-06",
      days: [{ id: "day-1", label: "Oct 6", date: "2026-10-06", city: "Paris", placeIds: ["museum", "hotel"] }],
      places: [
        { id: "museum", name: "Example Museum", locationLabel: "Paris", category: "museum", priority: "must", whyWorthIt: "Art", plan: "Visit", detailSections: [], officialUrl: "https://museum.example/", sourceRefs: [] },
        { id: "hotel", name: "Example Hotel", locationLabel: "Paris", category: "accommodation", priority: "booked", whyWorthIt: "Base", plan: "Stay", detailSections: [], sourceRefs: [] }
      ],
      routeSegments: []
    }
  });
}

const now=new Date("2026-10-01T08:00:00Z");
const result=(data:PlaceFact[]):ConnectorResult<PlaceFact[]>=>({status:"available",provider:"google_maps",observedAt:now.toISOString(),data});
const candidate={id:"g-1",name:"Example Museum",address:"Paris",location:"2.3,48.8",type:"museum",city:"Paris",district:"",businessStatus:"temporarily_closed" as const};
test("营业状态和名称匹配只产生候选，不伪造事实时间或目标日期结论",()=>{
  const evidence=venueSourceCandidate(venuePlan().presentation!.places[0]!,"Paris",result([candidate]),now);
  assert.equal(evidence.status,"unknown");assert.equal(evidence.factObservedAt,null);assert.ok(evidence.fingerprint);assert.match(evidence.reason,/候选/);
});
test("异地同名和多个候选均保留身份歧义",()=>{
  const evidence=venueSourceCandidate(venuePlan().presentation!.places[0]!,"Paris",result([candidate,candidate]),now);
  assert.equal(evidence.status,"ambiguous");
  assert.equal(venueSourceCandidate(venuePlan().presentation!.places[0]!,"Paris",result([{...candidate,city:"London"}]),now).status,"ambiguous");
});
test("失败和过期不推断恢复",()=>{
  assert.equal(venueSourceCandidate(venuePlan().presentation!.places[0]!,"Paris",{status:"unavailable",provider:"google_maps",observedAt:now.toISOString()},now).status,"failed");
  assert.equal(venueSourceCandidate(venuePlan().presentation!.places[0]!,"Paris",{...result([candidate]),observedAt:"2026-09-01T08:00:00Z"},now).status,"expired");
});
test("超前查询时间保留候选但不能成为正常或恢复",()=>{
  const evidence=venueSourceCandidate(venuePlan().presentation!.places[0]!,"Paris",{...result([{...candidate,businessStatus:"operational"}]),observedAt:"2026-10-01T09:00:00Z"},now);
  assert.equal(evidence.status,"unknown");assert.equal(evidence.factObservedAt,null);assert.equal(evidence.fingerprint,null);assert.match(evidence.reason,/超前/);assert.equal(evidence.candidate?.kind,"venue");
});
