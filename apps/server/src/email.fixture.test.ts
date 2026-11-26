import { planDraftForRevision } from "./plan-revision.js";
import { SqliteWorkspaceStore } from "@c-assistant/storage";
export function emailPlanFixture(store: SqliteWorkspaceStore, title = "Email test itinerary") {
  const workspace = store.createGeneratedPlan({ title, location: "Paris", dates: "2026-11-10", knownInformation: [], assumptions: [], nextAction: "Review", stages: [], presentation: {
    kind: "itinerary", summary: "A day of culture and food.", startDate: "2026-11-10", endDate: "2026-11-10",
    days: [{ id: "day-1", label: "Day 1", date: "2026-11-10", city: "Paris", title: "A slow day", summary: "Museum, lunch and a garden.", placeIds: ["museum", "restaurant", "garden"], startContext: { placeId: "hotel", label: "Hotel", status: "selected_property" }, stops: [{placeId:"museum",order:1,time:"09:00"},{placeId:"restaurant",order:2,time:"12:30"},{placeId:"garden",order:3,time:"15:00"}], blocks: [
      { id: "visit", kind: "stop", order: 1, title: "Museum", placeId: "museum", startTime: "09:00", durationMinutes: 90, evidence: [] },
      { id: "lunch", kind: "meal", order: 2, title: "Lunch", placeId: "restaurant", startTime: "12:30", evidence: [] },
      { id: "garden-visit", kind: "stop", order: 3, title: "Garden", placeId: "garden", startTime: "15:00", evidence: [] },
      { id: "flexible", kind: "rest", order: 4, title: "Rest when you like", evidence: [] }
    ] }],
    places: ["hotel", "museum", "restaurant", "garden"].map((id, index) => ({ id, name: id[0]!.toUpperCase() + id.slice(1), locationLabel: "Paris", city: "Paris", coordinates: [48.85 + index * .001, 2.34] as [number, number], category: id === "restaurant" ? "restaurant" : id, priority: "preferred" as const, whyWorthIt: "Saved place introduction.", plan: "Visit", detailSections: [], sourceRefs: [] })), routeSegments: [["museum","restaurant"],["restaurant","garden"]].map(([originPlaceId,destinationPlaceId], index) => ({id:`route-${index}`,dayId:"day-1",originPlaceId:originPlaceId!,destinationPlaceId:destinationPlaceId!,mode:"walking" as const,verification:"needs_verification" as const,label:"Check the route",detail:"Travel time pending",sourceRefs:[]}))
  } });
  store.confirmPlan(workspace.activePlan.id);
  return store.getExecutionPlan()!;
}
export function verifiedEmailFixture(store: SqliteWorkspaceStore) {
  store.email.updateSettings({ recipient: "traveler@example.test" });
  store.email.beginVerification("123456", "2026-11-10T07:30:00.000Z");
  store.email.finishVerificationSend(store.email.settings().revision, "accepted");
  store.email.verifyRecipient("123456", "2026-11-10T07:20:00.000Z");
  store.email.setEnabled(true);
}

export function emailReplacementFixture(store:SqliteWorkspaceStore){
  const base=emailPlanFixture(store);verifiedEmailFixture(store);
  const draft=planDraftForRevision(base);draft.title="Museum later, same day";
  draft.presentation!.days[0]!.blocks![0]!.startTime="10:00";draft.presentation!.days[0]!.stops![0]!.time="10:00";
  const workspace=store.reviseGeneratedPlan({draft,expectedPlanId:base.id,expectedVersion:base.version,changeImpact:{planId:base.id,baseVersion:base.version,impact:"high",summary:"Move the planned museum visit.",reasons:["The planned start changes."],affectedAreas:["dates"],requiresConfirmation:true,createsReplacementDraft:true}});
  return {base,draft:workspace.activePlan};
}

/** Deliberately fixed mock Agent decisions, used only by isolated regression tests. */
export function emailTimingFixture(request: import("@c-assistant/agent-adapters").EmailTimingRequest): import("@c-assistant/agent-adapters").EmailTimingResult {
  return {decisions:request.opportunities.map(item=>{
    const time=new Date(item.deadlineLocal+":00Z");time.setUTCMinutes(time.getUTCMinutes()-(item.kind==="dining"?30:20+(item.travelMinutes ?? 0)));
    return {id:item.id,sendAtLocal:item.kind==="morning"?`${item.date}T07:30`:time.toISOString().slice(0,16),rationale:"Isolated mock Agent timing decision"};
  })};
}
