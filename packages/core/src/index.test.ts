import assert from "node:assert/strict";
import test from "node:test";

import { assessPolicyPreparation, blueprintPresentation, compilePlanProposal, confirmPlan, createInitialWorkspace, createPlanFromDraft, createPlanFromRequest, inferStagePresentationKind, isPreDepartureChecklistTask, planPresentationIntegrityIssues, recommendPlanTransport, resolveCurrentPlanDestination, type PlanCompilationProposal, type PlanPresentation, type TripBlueprint } from "./index.js";

function compilationProposal(planId: string, planVersion: number): PlanCompilationProposal {
  return {
    planRef: { id: planId, version: planVersion },
    countryPack: { id: "china", version: "0.0.0", name: "China Country Pack" },
    composition: { skillId: "china-arrival-plan", version: "0.1.0", status: "degraded" },
    compilationKey: "china-arrival-preparation",
    stage: { title: "China arrival preparation", description: "Source-backed preparation proposed by the China Country Pack." },
    tasks: [{
      proposalId: "arrival-preparation:carry-entry-documents",
      title: "Carry entry documents",
      description: "Keep the reviewed documents accessible.",
      owner: "user",
      dueLabel: "Before departure",
      sourceSkills: [{ id: "policy-applicability", version: "0.1.0" }, { id: "arrival-preparation", version: "0.1.0" }],
      reminder: { dueAt: "2026-08-31T21:00:00.000Z", timeZone: "Asia/Shanghai", purpose: "Carry entry documents", refreshFacts: [] }
    }],
    knownInformation: ["Local food orientation: Learn about 葱油拌面 (scallion oil noodles)."],
    assumptions: ["The exact document set still requires source-backed review."],
    limitations: ["No entry eligibility conclusion has been made."]
  };
}

test("a confirmed demo Plan becomes active and leaves an inbox receipt", () => {
  const workspace = createInitialWorkspace();
  const confirmed = confirmPlan(workspace, workspace.activePlan.id);

  assert.equal(confirmed.activePlan.status, "active");
  assert.equal(confirmed.inbox[0]?.tone, "ready");
});

test("Blueprint presentation preserves explicit empty tips and preparation checklist", () => {
  const blueprint: TripBlueprint = {
    schemaVersion: 1,
    id: "blueprint-empty-guidance",
    version: 1,
    generationKey: "generation-empty-guidance",
    proposalRef: { sessionId: "session-empty-guidance", proposalVersion: 1 },
    skillLineage: { skillId: "interactive-trip-planner", skillVersion: "0.2.0" },
    researchSetId: "research-empty-guidance",
    title: "Tokyo",
    summary: "Neighborhood route.",
    language: "en",
    destinations: ["Tokyo"],
    startDate: "2026-10-12",
    endDate: "2026-10-12",
    sources: [],
    places: [{ id: "a", name: "A", locationLabel: "Tokyo", city: "Tokyo", category: "museum", priority: "must", coordinates: [35.68, 139.76], whyWorthIt: "A", plan: "Visit A", evidence: [] }],
    events: [],
    days: [{ id: "day-1", date: "2026-10-12", kind: "scheduled", city: "Tokyo", title: "Day", summary: "Flow", stops: [{ placeId: "a", order: 1 }], candidatePlaceIds: [] }],
    movements: [],
    actionRequirements: [],
    travelTips: [],
    preparationChecklist: [],
    createdAt: "2026-08-26T00:00:00.000Z"
  };
  const presentation = blueprintPresentation(blueprint);
  assert.deepEqual(presentation.travelTips, []);
  assert.deepEqual(presentation.preparationChecklist, []);
});

test("Blueprint presentation preserves sourced place images for Web detail surfaces", () => {
  const blueprint: TripBlueprint = {
    schemaVersion: 1,
    id: "blueprint-place-image",
    version: 1,
    generationKey: "generation-place-image",
    proposalRef: { sessionId: "session-place-image", proposalVersion: 1 },
    skillLineage: { skillId: "interactive-trip-planner", skillVersion: "0.2.0" },
    researchSetId: "research-place-image",
    title: "Bali",
    summary: "Ubud route.",
    language: "en",
    destinations: ["Bali"],
    startDate: "2026-10-12",
    endDate: "2026-10-12",
    sources: [{ id: "photo-source", title: "Official gallery", authority: "Museum", url: "https://example.com/gallery", retrievedAt: "2026-08-26", status: "verified" }],
    places: [{ id: "museum", name: "Museum", locationLabel: "Ubud", city: "Bali", category: "museum", priority: "must", coordinates: [-8.5, 115.26], whyWorthIt: "Art", plan: "Visit", evidence: [], images: [{ url: "https://example.com/museum.jpg", alt: "Museum courtyard", sourceId: "photo-source", usage: ["detail"], status: "verified" }] }],
    events: [],
    days: [{ id: "day-1", date: "2026-10-12", kind: "scheduled", city: "Bali", title: "Day", summary: "Flow", stops: [{ placeId: "museum", order: 1 }], candidatePlaceIds: [] }],
    movements: [],
    actionRequirements: [],
    createdAt: "2026-08-26T00:00:00.000Z"
  };

  const presentation = blueprintPresentation(blueprint);
  assert.deepEqual(presentation.places[0]?.images, [{ url: "https://example.com/museum.jpg", alt: "Museum courtyard", sourceId: "photo-source", usage: ["detail"], status: "verified" }]);
  assert.deepEqual(presentation.sourceCatalog?.[0]?.id, "photo-source");
});

test("Blueprint presentation keeps movement evidence for route read surfaces", () => {
  const blueprint: TripBlueprint = {
    schemaVersion: 1,
    id: "blueprint-route-evidence",
    version: 1,
    generationKey: "generation-route-evidence",
    proposalRef: { sessionId: "session-route-evidence", proposalVersion: 1 },
    skillLineage: { skillId: "interactive-trip-planner", skillVersion: "0.2.0" },
    researchSetId: "research-route-evidence",
    title: "Tokyo",
    summary: "Neighborhood route.",
    language: "en",
    destinations: ["Tokyo"],
    startDate: "2026-10-12",
    endDate: "2026-10-12",
    sources: [{ id: "route-source", title: "Tokyo route note", authority: "Transit guide", url: "https://example.com/route", retrievedAt: "2026-08-26", status: "verified" }],
    places: [
      { id: "a", name: "A", locationLabel: "Tokyo", city: "Tokyo", category: "museum", priority: "must", coordinates: [35.68, 139.76], whyWorthIt: "A", plan: "Visit A", evidence: [] },
      { id: "b", name: "B", locationLabel: "Tokyo", city: "Tokyo", category: "garden", priority: "preferred", coordinates: [35.69, 139.77], whyWorthIt: "B", plan: "Visit B", evidence: [] }
    ],
    events: [],
    days: [{ id: "day-1", date: "2026-10-12", kind: "scheduled", city: "Tokyo", title: "Day", summary: "Flow", stops: [{ placeId: "a", order: 1 }, { placeId: "b", order: 2 }], candidatePlaceIds: [] }],
    movements: [{ id: "route-1", dayId: "day-1", originPlaceId: "a", destinationPlaceId: "b", mode: "walking", status: "verified", evidence: [{ sourceId: "route-source", status: "verified", supports: ["walking time"], checkedAt: "2026-08-26" }] }],
    actionRequirements: [],
    createdAt: "2026-08-26T00:00:00.000Z"
  };
  const presentation = blueprintPresentation(blueprint);
  assert.deepEqual(presentation.routeSegments[0]?.sourceRefs, ["https://example.com/route"]);
  assert.deepEqual(presentation.routeSegments[0]?.evidence, [{ sourceId: "route-source", status: "verified", supports: ["walking time"], checkedAt: "2026-08-26" }]);
});

test("Blueprint presentation keeps event evidence for event read surfaces", () => {
  const blueprint: TripBlueprint = {
    schemaVersion: 1,
    id: "blueprint-event-evidence",
    version: 1,
    generationKey: "generation-event-evidence",
    proposalRef: { sessionId: "session-event-evidence", proposalVersion: 1 },
    skillLineage: { skillId: "interactive-trip-planner", skillVersion: "0.2.0" },
    researchSetId: "research-event-evidence",
    title: "Kyoto",
    summary: "Festival route.",
    language: "en",
    destinations: ["Kyoto"],
    startDate: "2026-10-12",
    endDate: "2026-10-12",
    sources: [{ id: "event-source", title: "Kyoto festival calendar", authority: "City events", url: "https://example.com/event", retrievedAt: "2026-08-26", status: "verified" }],
    places: [{ id: "temple", name: "Temple", locationLabel: "Kyoto", city: "Kyoto", category: "temple", priority: "must", coordinates: [35.01, 135.76], whyWorthIt: "Temple context.", plan: "Visit before the evening event.", evidence: [] }],
    events: [{ id: "event-1", title: "Evening light-up", description: "Nearby evening crowds.", startDate: "2026-10-12", placeId: "temple", evidence: [{ sourceId: "event-source", status: "verified", supports: ["event timing"], checkedAt: "2026-08-26" }] }],
    days: [{ id: "day-1", date: "2026-10-12", kind: "scheduled", city: "Kyoto", title: "Day", summary: "Flow", stops: [{ placeId: "temple", order: 1 }], candidatePlaceIds: [] }],
    movements: [],
    actionRequirements: [],
    createdAt: "2026-08-26T00:00:00.000Z"
  };
  const presentation = blueprintPresentation(blueprint);
  assert.deepEqual(presentation.events?.[0]?.sourceRefs, ["https://example.com/event"]);
  assert.deepEqual(presentation.events?.[0]?.evidence, [{ sourceId: "event-source", status: "verified", supports: ["event timing"], checkedAt: "2026-08-26" }]);
});

const multiCityPresentation: PlanPresentation = {
  kind: "itinerary",
  summary: "Paris followed by London.",
  startDate: "2026-10-06",
  endDate: "2026-10-12",
  cities: ["Paris", "London"],
  places: [],
  routeSegments: [],
  days: [
    { id: "paris-1", label: "October 6", date: "2026-10-06", city: "Paris", placeIds: [] },
    { id: "paris-2", label: "October 7", date: "2026-10-07", city: "Paris", placeIds: [] },
    { id: "london-1", label: "October 9", date: "2026-10-09", city: "London", placeIds: [] }
  ]
};

test("formal itinerary integrity rejects missing coordinates and candidate assignment overlap", () => {
  const presentation: PlanPresentation = {
    kind: "itinerary",
    summary: "Paris",
    startDate: "2026-10-06",
    endDate: "2026-10-06",
    days: [{ id: "day-1", label: "October 6", date: "2026-10-06", city: "Paris", placeIds: ["louvre"], candidates: ["louvre"], stops: [{ placeId: "louvre", order: 1 }] }],
    places: [{ id: "louvre", name: "Louvre", locationLabel: "Paris", city: "Paris", category: "museum", priority: "must", whyWorthIt: "Art", plan: "Visit", detailSections: [], sourceRefs: [] }],
    routeSegments: []
  };
  const issues = planPresentationIntegrityIssues(presentation);
  assert.equal(issues.some((issue) => /also a candidate/.test(issue)), true);
  assert.equal(issues.some((issue) => /persistent coordinates/.test(issue)), true);
});

test("formal itinerary integrity requires an executable daily timeline and explained movement", () => {
  const presentation: PlanPresentation = {
    kind: "itinerary",
    summary: "A timed Paris day.",
    startDate: "2026-10-06",
    endDate: "2026-10-06",
    days: [{
      id: "day-1", label: "October 6", date: "2026-10-06", city: "Paris",
      title: "Historic Paris", summary: "Follow one compact central axis with a midday rest.",
      placeIds: ["notre-dame", "luxembourg"],
      stops: [{ placeId: "notre-dame", order: 1 }, { placeId: "luxembourg", order: 2, time: "14:00" }]
    }],
    places: [
      { id: "notre-dame", name: "Notre-Dame", locationLabel: "Paris", city: "Paris", coordinates: [48.853, 2.349], category: "landmark", priority: "must", whyWorthIt: "Historic anchor", plan: "Visit", detailSections: [], sourceRefs: [] },
      { id: "luxembourg", name: "Luxembourg Gardens", locationLabel: "Paris", city: "Paris", coordinates: [48.846, 2.337], category: "garden", priority: "preferred", whyWorthIt: "Rest stop", plan: "Pause", detailSections: [], sourceRefs: [] }
    ],
    routeSegments: [{ id: "route-1", dayId: "day-1", originPlaceId: "notre-dame", destinationPlaceId: "luxembourg", mode: "unknown", verification: "needs_verification", sourceRefs: [] }]
  };
  const issues = planPresentationIntegrityIssues(presentation);
  assert.equal(issues.some((issue) => /every scheduled stop.*HH:mm/.test(issue)), true);
  assert.equal(issues.some((issue) => /explain why its scheduled sequence/.test(issue)), true);
  assert.equal(issues.some((issue) => /planned transport mode/.test(issue)), true);
  assert.equal(issues.some((issue) => /planned duration/.test(issue)), true);
  assert.equal(issues.some((issue) => /movement label/.test(issue)), true);
  assert.equal(issues.some((issue) => /movement and its evidence status/.test(issue)), true);
  assert.equal(issues.some((issue) => /realistic visit duration/.test(issue)), true);
});

test("formal itinerary integrity checks that visits and movement fit between start times", () => {
  const presentation: PlanPresentation = {
    kind: "itinerary", summary: "A feasible museum morning.", startDate: "2026-10-06", endDate: "2026-10-06",
    days: [{ id: "day-1", label: "October 6", date: "2026-10-06", city: "Paris", title: "Two museums", summary: "Visit one collection before moving to the next.", placeIds: ["a", "b"], stops: [{ placeId: "a", order: 1, time: "10:00" }, { placeId: "b", order: 2, time: "11:00" }], routeReview: { sequenceRationale: "Keep two nearby museums together." } }],
    places: [
      { id: "a", name: "Museum A", locationLabel: "Paris", city: "Paris", coordinates: [48.85, 2.34], category: "museum", priority: "must", durationMinutes: 50, whyWorthIt: "Art", plan: "Visit", detailSections: [], sourceRefs: [] },
      { id: "b", name: "Museum B", locationLabel: "Paris", city: "Paris", coordinates: [48.86, 2.35], category: "museum", priority: "preferred", durationMinutes: 60, whyWorthIt: "Design", plan: "Visit", detailSections: [], sourceRefs: [] }
    ],
    routeSegments: [{ id: "a-b", dayId: "day-1", originPlaceId: "a", destinationPlaceId: "b", mode: "walking", verification: "needs_verification", durationMinutes: 20, label: "Walk to Museum B", detail: "Allow twenty minutes and refresh before leaving.", sourceRefs: [] }]
  };
  const issues = planPresentationIntegrityIssues(presentation);
  assert.equal(issues.some((issue) => /does not leave enough time/.test(issue)), true);
  presentation.days[0]!.stops![1]!.time = "11:10";
  assert.equal(planPresentationIntegrityIssues(presentation).some((issue) => /does not leave enough time/.test(issue)), false);
});

test("current destination stays on the first city before a multi-city trip", () => {
  assert.deepEqual(resolveCurrentPlanDestination(multiCityPresentation, { now: new Date("2026-09-20T12:00:00Z") }), {
    city: "Paris", dayId: "paris-1", basis: "first_destination"
  });
});

test("current destination ignores an origin-only airport day", () => {
  const presentation: PlanPresentation = {
    kind: "itinerary", summary: "New York departure followed by Paris.", startDate: "2026-10-10", endDate: "2026-10-12",
    places: [
      { id: "jfk", name: "JFK", locationLabel: "New York", city: "New York City", coordinates: [40.64, -73.77], category: "International airport", priority: "must", whyWorthIt: "Departure", plan: "Fly", detailSections: [], sourceRefs: [] },
      { id: "louvre", name: "Louvre", locationLabel: "Paris", city: "Paris", coordinates: [48.86, 2.34], category: "museum", priority: "must", whyWorthIt: "Art", plan: "Visit", detailSections: [], sourceRefs: [] }
    ],
    routeSegments: [],
    days: [
      { id: "departure", label: "October 10", date: "2026-10-10", city: "New York City", placeIds: ["jfk"] },
      { id: "paris", label: "October 11", date: "2026-10-11", city: "Paris", placeIds: ["louvre"] }
    ]
  };
  assert.deepEqual(resolveCurrentPlanDestination(presentation, { now: new Date("2026-08-19T12:00:00Z") }), {
    city: "Paris", dayId: "paris", basis: "first_destination"
  });
});

test("current destination follows the dated itinerary stage when no arrival events exist", () => {
  assert.equal(resolveCurrentPlanDestination(multiCityPresentation, { now: new Date("2026-10-08T12:00:00Z") })?.city, "Paris");
  assert.equal(resolveCurrentPlanDestination(multiCityPresentation, { now: new Date("2026-10-09T12:00:00Z") })?.city, "London");
});

test("confirmed arrivals keep weather on Paris until London is actually reached", () => {
  const parisArrival = { city: "Paris", arrivedAt: "2026-10-06T09:00:00Z", confirmed: true };
  assert.equal(resolveCurrentPlanDestination(multiCityPresentation, { now: new Date("2026-10-09T10:00:00Z"), arrivals: [parisArrival] })?.city, "Paris");
  assert.equal(resolveCurrentPlanDestination(multiCityPresentation, {
    now: new Date("2026-10-09T14:00:00Z"),
    arrivals: [parisArrival, { city: "London", arrivedAt: "2026-10-09T13:00:00Z", confirmed: true }]
  })?.city, "London");
});

test("Core normalizes legacy stage titles into stable presentation kinds once", () => {
  assert.equal(inferStagePresentationKind("每日行程"), "itinerary");
  assert.equal(inferStagePresentationKind("Budget and contingency"), "budget");
  assert.equal(inferStagePresentationKind("Emergency information"), "details");
  const plan = createPlanFromDraft({
    title: "Typed workspace",
    location: "Lisbon, Portugal",
    dates: "October 2026",
    knownInformation: ["A five-day trip."],
    assumptions: [],
    nextAction: "Review.",
    stages: [{ title: "Custom route", description: "A route.", presentationKind: "transport", tasks: [{ title: "Airport transfer", owner: "external", dueLabel: "Arrival" }] }]
  });
  assert.equal(plan.stages[0]?.presentationKind, "transport");
});

test("a natural-language request creates a draft Plan with transparent assumptions", () => {
  const plan = createPlanFromRequest({ request: "I am going to Shanghai in September 2026 for an exhibition." });

  assert.equal(plan.status, "draft");
  assert.equal(plan.location, "Shanghai, China");
  assert.equal(plan.configuration.accommodation.status, "not_set");
  assert.equal(plan.configuration.arrival.expectedAtLocal, undefined);
  assert.equal(plan.configuration.transport.preference, "plan_recommended");
  assert.equal(plan.configuration.travelContext.luggage, "unknown");
  assert.equal(plan.stages[2]?.tasks[0]?.activationTrigger, "arrival");
  assert.match(plan.assumptions[0] ?? "", /does not yet use Codex/i);
});

test("a validated Agent draft becomes a draft Plan with user-owned follow-up Tasks", () => {
  const plan = createPlanFromDraft({
    title: "Settle into Shanghai",
    location: "Shanghai, China",
    dates: "September 2026",
    knownInformation: ["Purpose: study"],
    assumptions: ["Accommodation is not confirmed."],
    nextAction: "Review the complete Plan.",
    stages: [{ title: "Before departure", description: "Prepare essentials.", tasks: [{ title: "Check documents", owner: "user", dueLabel: "Two hours before departure", reminder: { scheduledAtLocal: "2026-09-01T05:00", timeZone: "Asia/Shanghai", purpose: "Check passport and essential items.", refreshFacts: ["weather"] } }] }]
  });

  assert.equal(plan.status, "draft");
  assert.equal(plan.stages[0]?.tasks[0]?.status, "waiting_user");
  assert.equal(plan.stages[0]?.tasks[0]?.reminder?.timeZone, "Asia/Shanghai");
  assert.deepEqual(plan.stages[0]?.tasks[0]?.reminder?.refreshFacts, ["weather"]);
});

test("an arrival-triggered user Task waits for the arrival event before becoming user-ready", () => {
  const plan = createPlanFromDraft({
    title: "Arrive in Shanghai",
    location: "Shanghai, China",
    dates: "September 2026",
    knownInformation: ["Arrival airport: PVG"],
    assumptions: ["The exact terminal is unknown."],
    nextAction: "Review the complete Plan.",
    stages: [{ title: "Arrival", description: "Complete arrival steps.", tasks: [{ title: "Collect baggage", owner: "user", dueLabel: "At arrival", activationTrigger: "arrival" }] }]
  });

  assert.equal(plan.stages[0]?.tasks[0]?.status, "scheduled");
  assert.equal(plan.stages[0]?.tasks[0]?.activationTrigger, "arrival");
});

test("only carry items and pre-departure work qualify for checklist interaction", () => {
  assert.equal(isPreDepartureChecklistTask({ title: "Pack passport and charger", owner: "user", dueLabel: "Any time" }, "应急资料"), true);
  assert.equal(isPreDepartureChecklistTask({ title: "Set up WeChat", owner: "user", dueLabel: "Before arrival" }, "China arrival preparation"), true);
  assert.equal(isPreDepartureChecklistTask({ title: "Choose airport transport", owner: "user", dueLabel: "Before leaving the airport" }, "Arrive in Shanghai"), false);
  assert.equal(isPreDepartureChecklistTask({ title: "Visit the museum", owner: "user", dueLabel: "Day 2 at 10:00" }, "每日行程"), false);
  assert.equal(isPreDepartureChecklistTask({ title: "Pack passport", owner: "external", dueLabel: "Before departure" }, "应急资料"), false);
});

test("a Plan preference takes precedence in an explainable transport suggestion", () => {
  const recommendation = recommendPlanTransport({
    preference: "public_transit",
    luggage: "heavy",
    routeFacts: [{ mode: "driving", distanceMeters: 4_000 }, { mode: "transit", distanceMeters: 3_600 }]
  });

  assert.equal(recommendation.mode, "transit");
  assert.match(recommendation.reasons[0] ?? "", /explicitly prefers/i);
});

test("heavy luggage makes an available driving route the preliminary choice", () => {
  const recommendation = recommendPlanTransport({
    preference: "plan_recommended",
    luggage: "heavy",
    routeFacts: [{ mode: "driving", distanceMeters: 4_000 }, { mode: "transit", distanceMeters: 3_600 }]
  });

  assert.equal(recommendation.mode, "driving");
  assert.match(recommendation.limitations[0] ?? "", /No weather fact matched/i);
});

test("the shortest timed route can preliminarily favour walking without a fixed distance threshold", () => {
  const recommendation = recommendPlanTransport({
    preference: "plan_recommended",
    luggage: "light",
    routeFacts: [{ mode: "walking", distanceMeters: 2_100, durationSeconds: 16 * 60 }, { mode: "transit", distanceMeters: 1_400, durationSeconds: 22 * 60 }]
  });

  assert.equal(recommendation.mode, "walking");
});

test("a matching rainy arrival forecast avoids automatic walking when transit is available", () => {
  const recommendation = recommendPlanTransport({
    preference: "plan_recommended",
    luggage: "light",
    weather: { condition: "Light rain", precipitationMm: 1.2 },
    routeFacts: [{ mode: "walking", distanceMeters: 1_100, durationSeconds: 16 * 60 }, { mode: "transit", distanceMeters: 1_400 }]
  });

  assert.equal(recommendation.mode, "transit");
  assert.match(recommendation.reasons.join(" "), /Rain or snow/i);
  assert.match(recommendation.limitations[0] ?? "", /matched to the expected arrival date/i);
});

test("an explicit walking preference remains user-owned in a rainy forecast", () => {
  const recommendation = recommendPlanTransport({
    preference: "walking",
    luggage: "light",
    weather: { condition: "Rain", precipitationMm: 0 },
    routeFacts: [{ mode: "walking", distanceMeters: 1_100, durationSeconds: 16 * 60 }, { mode: "transit", distanceMeters: 1_400 }]
  });

  assert.equal(recommendation.mode, "walking");
  assert.match(recommendation.reasons.join(" "), /explicit Plan preference is retained/i);
});

test("policy preparation asks for personal facts before it can be reviewed", () => {
  const assessment = assessPolicyPreparation({
    profile: createInitialWorkspace().profile,
    plan: createInitialWorkspace().activePlan,
    sourceSnapshots: [],
    now: new Date("2026-08-07T00:00:00.000Z")
  });

  assert.equal(assessment.status, "needs_input");
  assert.deepEqual(assessment.missingInformation.map((item) => item.field), [
    "profile.nationality",
    "profile.immigrationStatus",
    "official_source.nia-english"
  ]);
  assert.match(assessment.warning, /does not determine/i);
});

test("policy preparation treats no visa yet as a confirmed fact that needs official guidance", () => {
  const workspace = createInitialWorkspace();
  workspace.profile = { ...workspace.profile, nationality: "Canada", immigrationStatus: "no_visa", status: "ready" };
  const assessment = assessPolicyPreparation({ profile: workspace.profile, plan: workspace.activePlan, sourceSnapshots: [], now: new Date("2026-08-07T00:00:00.000Z") });
  assert.match(assessment.knownInformation.join(" "), /No China visa or residence permit has been obtained yet/i);
  assert.equal(assessment.missingInformation.some((item) => item.field === "profile.immigrationStatus"), false);
  assert.equal(assessment.missingInformation.some((item) => item.field === "official_source.nia-english"), true);
});

test("policy preparation is ready only when confirmed facts have fresh official evidence", () => {
  const workspace = createInitialWorkspace();
  workspace.profile = { ...workspace.profile, nationality: "Canada", immigrationStatus: "tourist_visa", status: "ready" };
  workspace.sourceSnapshots = [{
    id: "source-1",
    sourceId: "nia-english",
    authority: "National Immigration Administration",
    titleOriginal: "Guidance",
    url: "https://en.nia.gov.cn/",
    retrievedAt: "2026-08-06T12:00:00.000Z",
    contentHash: "a".repeat(64),
    excerpt: "Official evidence only."
  }];

  const assessment = assessPolicyPreparation({ profile: workspace.profile, plan: workspace.activePlan, sourceSnapshots: workspace.sourceSnapshots, now: new Date("2026-08-07T00:00:00.000Z") });

  assert.equal(assessment.status, "ready_for_review");
  assert.equal(assessment.evidence[0]?.sourceId, "nia-english");
  assert.equal(assessment.missingInformation.length, 0);
});

test("stale official evidence requires an explicit refresh before review", () => {
  const workspace = createInitialWorkspace();
  workspace.profile = { ...workspace.profile, nationality: "Canada", immigrationStatus: "tourist_visa", status: "ready" };
  workspace.sourceSnapshots = [{
    id: "source-1",
    sourceId: "nia-english",
    authority: "National Immigration Administration",
    titleOriginal: "Guidance",
    url: "https://en.nia.gov.cn/",
    retrievedAt: "2026-07-01T00:00:00.000Z",
    contentHash: "a".repeat(64),
    excerpt: "Official evidence only."
  }];

  const assessment = assessPolicyPreparation({ profile: workspace.profile, plan: workspace.activePlan, sourceSnapshots: workspace.sourceSnapshots, now: new Date("2026-08-07T00:00:00.000Z") });
  assert.equal(assessment.status, "needs_evidence");
  assert.equal(assessment.missingInformation[0]?.field, "official_source.nia-english");
});

test("Core compiles a version-bound Country Pack proposal into a new draft Plan", () => {
  const plan = createPlanFromRequest({ request: "I will attend an exhibition in Shanghai in September 2026." });
  const result = compilePlanProposal(plan, compilationProposal(plan.id, plan.version), new Date("2026-08-07T00:00:00.000Z"));
  assert.equal(result.status, "compiled");
  if (result.status !== "compiled") return;
  assert.equal(result.plan.version, plan.version + 1);
  assert.equal(result.plan.status, "draft");
  assert.equal(plan.version, 1);
  const stage = result.plan.stages.at(-1)!;
  assert.equal(stage.origin?.compilationKey, "china-arrival-preparation");
  assert.equal(stage.tasks[0]?.description, "Keep the reviewed documents accessible.");
  assert.equal(stage.tasks[0]?.reminder?.scheduledAtLocal, "2026-09-01T05:00");
  assert.equal(stage.tasks[0]?.status, "waiting_user");
  assert.deepEqual(stage.tasks[0]?.origin?.sourceSkills.map((source) => source.id), ["policy-applicability", "arrival-preparation"]);
  assert.ok(result.plan.knownInformation.includes("Local food orientation: Learn about 葱油拌面 (scallion oil noodles)."));
  assert.equal(result.audit.sourcePlanVersion, 1);
  assert.equal(result.audit.compiledPlanVersion, 2);
  assert.match(result.plan.nextAction, /Review the complete compiled Plan/);
});

test("Core rejects stale Plan references and non-draft mutation", () => {
  const plan = createPlanFromRequest({ request: "I will arrive in Shanghai." });
  const staleRef = compilePlanProposal(plan, compilationProposal(plan.id, plan.version + 1));
  assert.equal(staleRef.status, "blocked");
  if (staleRef.status === "blocked") assert.equal(staleRef.reasonCode, "plan_reference_mismatch");
  const active = { ...plan, status: "active" as const };
  const activeResult = compilePlanProposal(active, compilationProposal(active.id, active.version));
  assert.equal(activeResult.status, "blocked");
  if (activeResult.status === "blocked") assert.equal(activeResult.reasonCode, "plan_not_draft");
});

test("Core fails closed on duplicate proposal ids and stale reminders", () => {
  const plan = createPlanFromRequest({ request: "I will arrive in Shanghai." });
  const duplicate = compilationProposal(plan.id, plan.version);
  duplicate.tasks.push({ ...duplicate.tasks[0]! });
  const duplicateResult = compilePlanProposal(plan, duplicate, new Date("2026-08-07T00:00:00.000Z"));
  assert.equal(duplicateResult.status, "blocked");
  if (duplicateResult.status === "blocked") assert.equal(duplicateResult.reasonCode, "invalid_proposal");
  const stale = compilationProposal(plan.id, plan.version);
  stale.tasks[0]!.reminder!.dueAt = "2026-01-01T00:00:00.000Z";
  const staleResult = compilePlanProposal(plan, stale, new Date("2026-08-07T00:00:00.000Z"));
  assert.equal(staleResult.status, "blocked");
  if (staleResult.status === "blocked") assert.equal(staleResult.reasonCode, "stale_reminder");
});

test("Core requires an explicit limitation before compiling a degraded composition", () => {
  const plan = createPlanFromRequest({ request: "I will arrive in Shanghai." });
  const proposal = compilationProposal(plan.id, plan.version);
  proposal.limitations = [];
  const result = compilePlanProposal(plan, proposal, new Date("2026-08-07T00:00:00.000Z"));
  assert.equal(result.status, "blocked");
  if (result.status === "blocked") assert.equal(result.reasonCode, "invalid_proposal");
  const malformed = compilePlanProposal(plan, undefined as never, new Date("2026-08-07T00:00:00.000Z"));
  assert.equal(malformed.status, "blocked");
  if (malformed.status === "blocked") assert.equal(malformed.reasonCode, "invalid_proposal");
});
