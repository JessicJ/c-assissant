import assert from "node:assert/strict";
import test from "node:test";

import { compileTripBlueprint, importSkillItinerary, tripBlueprintIntegrityIssues, type ResearchSet } from "../packages/core/src/index.ts";
import {
  assessSemanticPlanFidelity,
  hardenSemanticPlanContract,
  semanticFixedCommitmentsFromBookingConstraints,
  structureSemanticTravelPlan,
  type SemanticTravelExperience,
  type SemanticTravelPlan
} from "../packages/agent-adapters/src/index.ts";

const research: ResearchSet = {
  schemaVersion: 1,
  id: "research-test",
  generationKey: "generation-test",
  proposalRef: { sessionId: "session-test", proposalVersion: 1 },
  skillLineage: { skillId: "landi-trip-blueprint", skillVersion: "1.0.0" },
  status: "completed",
  batches: [],
  places: [
    { id: "tegallalang", name: "Tegallalang Rice Terrace", locationLabel: "Ubud", city: "Bali", area: "Ubud", category: "rice terrace", priority: "preferred", whyWorthIt: "Rice terrace.", plan: "Visit.", evidence: [] },
    { id: "tirta", name: "Tirta Empul Temple", locationLabel: "Tampaksiring", city: "Bali", area: "Ubud", category: "temple", priority: "preferred", whyWorthIt: "Temple.", plan: "Visit.", evidence: [] },
    { id: "jatiluwih", name: "Jatiluwih Rice Terraces", locationLabel: "Jatiluwih", city: "Bali", area: "Tabanan", category: "rice terraces", priority: "must", whyWorthIt: "Subak landscape.", plan: "Visit.", evidence: [] },
    { id: "waterbom", name: "Waterbom Bali", locationLabel: "Kuta", city: "Bali", area: "South Bali", category: "water park", priority: "preferred", whyWorthIt: "Recreation day.", plan: "Visit.", evidence: [] },
    { id: "uluwatu", name: "Uluwatu Temple", locationLabel: "Uluwatu", city: "Bali", area: "South Bali", category: "temple", priority: "must", whyWorthIt: "Cliff temple.", plan: "Visit.", evidence: [] },
    { id: "kecak", name: "Uluwatu Kecak Dance", locationLabel: "Uluwatu", city: "Bali", area: "South Bali", category: "performance", priority: "must", whyWorthIt: "Performance.", plan: "Attend.", evidence: [] },
    { id: "arma", name: "Agung Rai Museum of Art", locationLabel: "Ubud", city: "Bali", area: "Ubud", category: "museum", priority: "nearby", whyWorthIt: "Museum and cultural center.", plan: "Visit the museum.", evidence: [] }
  ],
  events: [],
  sources: [],
  actionRequirements: [],
  createdAt: "2026-09-14T00:00:00.000Z",
  updatedAt: "2026-09-14T00:00:00.000Z",
  completedAt: "2026-09-14T00:00:00.000Z"
};

const semanticPlan: SemanticTravelPlan = {
  title: "Bali S1.2 fixture",
  language: "en",
  tripStrategy: "Use Ubud first, then South Bali. Preserve lodging uncertainty.",
  fixedCommitments: [],
  targetedResearch: [],
  dailyItinerary: [
    {
      date: "2026-10-08",
      area: "North and northeast of Ubud",
      startContext: { label: "Ubud accommodation - exact property pending", status: "planned_base_pending_property" },
      endContext: { label: "Ubud accommodation - exact property pending", status: "planned_base_pending_property" },
      plan: "Visit Tegallalang Rice Terrace, then continue to Tirta Empul Temple. Do not assume admission permits purification.",
      experiences: [
        { title: "Tegallalang Rice Terrace", placeName: "Tegallalang Rice Terrace", planRole: "planned", summary: "Weather-aware terrace walk.", operationalConditions: [{ kind: "weather", note: "Adjust walk if rain or mud makes paths uncomfortable." }] },
        { title: "Tirta Empul Temple", placeName: "Tirta Empul Temple", planRole: "planned", summary: "Ordinary temple visit.", operationalConditions: [{ kind: "access", note: "Do not assume purification access." }] }
      ]
    },
    {
      date: "2026-10-09",
      area: "Ubud to Jatiluwih, Mengwi, and Jimbaran",
      startContext: { label: "Ubud accommodation - exact property pending", status: "planned_base_pending_property" },
      endContext: { label: "Jimbaran accommodation - exact property pending", status: "planned_base_pending_property" },
      plan: "Jatiluwih is the principal transfer-day experience. Taman Ayun is optional if route and energy allow.",
      experiences: [
        { title: "Jatiluwih Rice Terraces", placeName: "Jatiluwih Rice Terraces", planRole: "planned", primaryExperience: true, summary: "Principal rice-landscape experience.", operationalConditions: [{ kind: "weather", note: "Use a weather-appropriate route." }] },
        { title: "Taman Ayun", planRole: "optional", summary: "Energy-dependent transfer stop.", operationalConditions: [{ kind: "route", note: "Depends on selected hotels." }, { kind: "traveler_choice", note: "Use only if the group has energy." }] }
      ]
    },
    {
      date: "2026-10-10",
      area: "Kuta and Jimbaran",
      startContext: { label: "Jimbaran accommodation - exact property pending", status: "planned_base_pending_property" },
      endContext: { label: "Jimbaran accommodation - exact property pending", status: "planned_base_pending_property" },
      plan: "Waterbom is the core day plan. Jimbaran Beach replaces it if travelers do not want a water park.",
      experiences: [
        { title: "Waterbom Bali", placeName: "Waterbom Bali", planRole: "planned", primaryExperience: true, summary: "Core recreational plan.", startTime: "09:30", operationalConditions: [{ kind: "reservation", note: "Consider advance tickets." }] },
        { title: "Jimbaran Beach", planRole: "replacement", replacementFor: "Waterbom Bali", summary: "Slow beach replacement if travelers reject the water park.", operationalConditions: [{ kind: "traveler_choice", note: "Traveler preference decides this replacement." }] }
      ]
    },
    {
      date: "2026-10-11",
      area: "Jimbaran and Uluwatu",
      startContext: { label: "Jimbaran accommodation - exact property pending", status: "planned_base_pending_property" },
      endContext: { label: "Jimbaran accommodation - exact property pending", status: "planned_base_pending_property" },
      plan: "Light Jimbaran Beach morning, then planned Uluwatu Temple and Kecak finale with session confirmation.",
      experiences: [
        { title: "Jimbaran Beach", planRole: "planned", summary: "Light morning beach experience.", startTime: "09:30" },
        { title: "Uluwatu Temple", placeName: "Uluwatu Temple", planRole: "planned", summary: "Planned cliff temple.", startTime: "15:00" },
        { title: "Uluwatu Kecak Dance", placeName: "Uluwatu Kecak Dance", planRole: "planned", summary: "Planned performance.", operationalConditions: [{ kind: "session", note: "Confirm session." }, { kind: "reservation", note: "Confirm tickets." }] }
      ]
    }
  ],
  unresolvedExperiences: ["Taman Ayun remains route- and energy-dependent."],
  preparation: ["Confirm and buy three Uluwatu Kecak tickets after the October 11 performance time is published.", "Carry light rain shells and shoes suitable for wet paths."],
  tips: ["Do not use straight-line map distances to judge Bali journeys.", "At temples, cover shoulders and knees."],
  researchGrounding: ["Fixture research grounding."],
  followUpChecks: ["Confirm Kecak ticket inventory."],
  markdown: "x".repeat(1200)
};

test("S1.2 preserves plan role separately from operational conditions", () => {
  const { artifact } = structureSemanticTravelPlan(semanticPlan, research, { hardenContract: false });
  const oct8 = artifact.days.find((day) => day.date === "2026-10-08")!;
  const tirta = oct8.blocks?.find((block) => block.title === "Tirta Empul Temple");
  assert.equal(tirta?.planRole, "planned");
  assert.deepEqual(tirta?.operationalConditions?.map((item) => item.kind), ["access"]);
});

test("S1.2 preserves Jatiluwih as planned primary and Taman Ayun as optional", () => {
  const { artifact } = structureSemanticTravelPlan(semanticPlan, research, { hardenContract: false });
  const oct9 = artifact.days.find((day) => day.date === "2026-10-09")!;
  const jatiluwih = oct9.blocks?.find((block) => block.title === "Jatiluwih Rice Terraces");
  const tamanAyun = oct9.blocks?.find((block) => block.title === "Taman Ayun");
  assert.equal(jatiluwih?.planRole, "planned");
  assert.equal(jatiluwih?.primaryExperience, true);
  assert.equal(tamanAyun?.planRole, "optional");
});

test("S1.2 preserves Waterbom replacement relationship", () => {
  const { artifact } = structureSemanticTravelPlan(semanticPlan, research, { hardenContract: false });
  const oct10 = artifact.days.find((day) => day.date === "2026-10-10")!;
  const waterbom = oct10.blocks?.find((block) => block.title === "Waterbom Bali");
  const beach = oct10.blocks?.find((block) => block.title === "Jimbaran Beach");
  assert.equal(waterbom?.planRole, "planned");
  assert.equal(waterbom?.primaryExperience, true);
  assert.equal(beach?.planRole, "replacement");
  assert.equal(beach?.replacementFor, "Waterbom Bali");
  assert.equal(beach?.replacementForBlockId, waterbom?.id);
});

test("S1.2 preserves Kecak as planned with session and reservation conditions", () => {
  const { artifact } = structureSemanticTravelPlan(semanticPlan, research, { hardenContract: false });
  const kecak = artifact.days.find((day) => day.date === "2026-10-11")?.blocks?.find((block) => block.title === "Uluwatu Kecak Dance");
  assert.equal(kecak?.planRole, "planned");
  assert.deepEqual(kecak?.operationalConditions?.map((item) => item.kind).sort(), ["reservation", "session"]);
});

test("S1.2 carries start and end context into artifact and TripBlueprint", () => {
  const { artifact } = structureSemanticTravelPlan(semanticPlan, research, { hardenContract: false });
  const blueprint = importSkillItinerary(research, artifact, { blueprintId: "blueprint-test", blueprintVersion: 1, createdAt: "2026-09-14T00:00:00.000Z" });
  assert.equal(artifact.days[1]?.startContext?.label, "Ubud accommodation - exact property pending");
  assert.equal(blueprint.days[1]?.endContext?.label, "Jimbaran accommodation - exact property pending");
});

test("S1.2 maps preparation and tips to native structures", () => {
  const { artifact, importedBlueprint } = structureSemanticTravelPlan(semanticPlan, research, { hardenContract: false, importBlueprint: true, createdAt: "2026-09-14T00:00:00.000Z" });
  assert.equal(artifact.preparationChecklist?.length, 2);
  assert.equal(artifact.travelTips?.length, 2);
  assert.equal(importedBlueprint?.preparationChecklist?.length, 2);
  assert.equal(importedBlueprint?.travelTips?.length, 2);
});

test("S1.2 fidelity reports no changed or dropped decisions", () => {
  const { fidelity } = structureSemanticTravelPlan(semanticPlan, research, { hardenContract: false, importBlueprint: true, createdAt: "2026-09-14T00:00:00.000Z" });
  assert.equal(fidelity.some((item) => item.classification === "CHANGED" || item.classification === "DROPPED"), false);
});

test("fidelity preserves the order of repeated execution-node titles", () => {
  const plan = structuredClone(semanticPlan);
  const day = plan.dailyItinerary[0]!;
  day.experiences = [
    {
      title: "Return to Jimbaran base",
      kind: "lodging",
      planRole: "planned",
      summary: "Pause at the base before the evening plan.",
      startTime: "15:00",
      timingStatus: "estimated"
    },
    {
      title: "Return to Jimbaran base",
      kind: "lodging",
      planRole: "planned",
      summary: "Finish the day at the same base.",
      startTime: "21:00",
      timingStatus: "estimated"
    }
  ];

  const structured = structureSemanticTravelPlan(plan, research, { hardenContract: false });

  assert.deepEqual(structured.artifact.days[0]?.blocks?.map((block) => block.order), [1, 2]);
  assert.equal(structured.fidelity.some((item) => item.classification === "CHANGED" || item.classification === "DROPPED"), false);
});

test("contract hardening supplies accepted Bali metadata when old V2.4 plan lacks experiences", () => {
  const oldPlan: SemanticTravelPlan = { ...semanticPlan, dailyItinerary: semanticPlan.dailyItinerary.map(({ experiences: _experiences, ...day }) => day) };
  const hardened = hardenSemanticPlanContract(oldPlan);
  assert.equal(hardened.dailyItinerary.find((day) => day.date === "2026-10-10")?.experiences?.find((item) => item.title === "Jimbaran Beach")?.planRole, "replacement");
});

test("resolved replacement keeps identity without becoming a committed stop", () => {
  const replacementResearch: ResearchSet = {
    ...research,
    places: [...research.places, { id: "archaeology", name: "Museu Arqueologico do Carmo", locationLabel: "Lisbon", city: "Lisbon", area: "Chiado", category: "museum", priority: "preferred", whyWorthIt: "Archaeology collection.", plan: "Use as an alternative.", evidence: [] }]
  };
  const plan = singleExperiencePlan({
    title: "Compact archaeological alternative",
    placeName: "Museu Arqueologico do Carmo",
    planRole: "replacement",
    replacementFor: "Main museum visit"
  });
  const { artifact, fidelity } = structureSemanticTravelPlan(plan, replacementResearch, { hardenContract: false, destinations: ["Lisbon"] });
  const block = artifact.days[0]?.blocks?.[0];
  assert.equal(block?.kind, "flexible");
  assert.equal(block?.placeId, "archaeology");
  assert.equal(artifact.days[0]?.stops.length, 0);
  assert.equal(fidelity.some((item) => item.classification === "CHANGED" || item.classification === "DROPPED"), false);
});

test("title and explicit placeName remain distinct while Research identity follows placeName", () => {
  const plan = singleExperiencePlan({ title: "Quiet collection before lunch", placeName: "Waterbom Bali", planRole: "optional" });
  const { artifact } = structureSemanticTravelPlan(plan, research, { hardenContract: false, destinations: ["Bali"] });
  const block = artifact.days[0]?.blocks?.[0];
  assert.equal(block?.title, "Quiet collection before lunch");
  assert.equal(block?.placeId, "waterbom");
  assert.equal(block?.kind, "flexible");
  assert.equal(artifact.days[0]?.stops.length, 0);
});

test("explicit unresolved placeName is retained without fabricating a Research identity", () => {
  const plan = singleExperiencePlan({ title: "Small studio visit", placeName: "Atelier Not Yet Researched", planRole: "optional" });
  const { artifact, importedBlueprint, fidelity } = structureSemanticTravelPlan(plan, research, { hardenContract: false, destinations: ["Lisbon"], importBlueprint: true });
  const block = artifact.days[0]?.blocks?.[0];
  assert.equal(block?.placeId, undefined);
  assert.equal(block?.placeName, "Atelier Not Yet Researched");
  assert.equal(importedBlueprint?.days[0]?.blocks?.[0]?.placeName, "Atelier Not Yet Researched");
  assert.equal(fidelity.some((item) => item.subject.includes("unresolved place identity") && item.classification === "PRESERVED"), true);
});

test("descriptive optional title is not promoted to canonical Research identity", () => {
  const plan = singleExperiencePlan({ title: "Waterbom Bali", planRole: "optional" });
  const { artifact, fidelity } = structureSemanticTravelPlan(plan, research, { hardenContract: false, destinations: ["Bali"] });
  const block = artifact.days[0]?.blocks?.[0];
  assert.equal(block?.placeId, undefined);
  assert.equal(block?.placeName, undefined);
  assert.equal(fidelity.some((item) => item.subject.includes("place identity") && item.classification === "REPRESENTED DIFFERENTLY"), true);
});

test("non-Bali and multi-destination metadata contains no Bali fallback", () => {
  const lisbon = singleExperiencePlan({ title: "Unstructured morning", planRole: "optional" });
  lisbon.dailyItinerary.push({ ...structuredClone(lisbon.dailyItinerary[0]!), date: "2026-10-13", area: "Porto" });
  const { artifact } = structureSemanticTravelPlan(lisbon, research, { hardenContract: false, destinations: ["Lisbon", "Porto"] });
  assert.deepEqual(artifact.destinations, ["Lisbon", "Porto"]);
  assert.deepEqual(artifact.days.map((day) => day.city), ["Lisbon", "Porto"]);
  assert.equal(JSON.stringify(artifact).includes("Bali"), false);
});

test("confirmed flight origin is not promoted into trip destinations", () => {
  const plan = singleExperiencePlan({ title: "Arrival pause", planRole: "optional" });
  const { artifact } = structureSemanticTravelPlan(plan, research, {
    hardenContract: false,
    destinations: ["Lisbon"],
    bookingConstraints: [{
      id: "flight", type: "flight", status: "confirmed", title: "London to Lisbon", source: "user", sourceLabel: "fixture", sourceHash: "fixture", constraintStrength: "hard",
      segments: [{ id: "leg", segmentType: "flight_leg", title: "London to Lisbon", status: "confirmed", origin: "London", destination: "Lisbon", constraintStrength: "hard", fixedCommitment: true, needsReviewReasons: [] }],
      importedAt: "2026-09-14T00:00:00.000Z", updatedAt: "2026-09-14T00:00:00.000Z"
    }]
  });
  assert.deepEqual(artifact.destinations, ["Lisbon"]);
});

test("genuine place substitution and deletion remain blocking fidelity failures", () => {
  const plan = singleExperiencePlan({ title: "Waterbom day", placeName: "Waterbom Bali", planRole: "planned" });
  const { artifact } = structureSemanticTravelPlan(plan, research, { hardenContract: false, destinations: ["Bali"] });
  const substituted = structuredClone(artifact);
  substituted.days[0]!.blocks![0]!.placeId = "tirta";
  assert.equal(assessSemanticPlanFidelity(plan, substituted, research).some((item) => item.classification === "CHANGED"), true);
  const deleted = structuredClone(artifact);
  deleted.days[0]!.blocks = [];
  assert.equal(assessSemanticPlanFidelity(plan, deleted, research).some((item) => item.classification === "DROPPED"), true);
});

test("full path keeps planned A to B stops and movement mutually consistent", () => {
  const plan = planWithExperiences([
    { title: "Waterbom visit", placeName: "Waterbom Bali", planRole: "planned", summary: "Visit A." },
    { title: "Temple visit", placeName: "Tirta Empul Temple", planRole: "planned", summary: "Visit B." }
  ]);
  const { blueprint, compilation } = fullPath(plan, ["Bali"]);
  assert.deepEqual(blueprint.days[0]?.stops.map((stop) => stop.placeId), ["waterbom", "tirta"]);
  assert.deepEqual(blueprint.movements.map((movement) => [movement.originPlaceId, movement.destinationPlaceId]), [["waterbom", "tirta"]]);
  assert.equal(compilation.plan.status, "draft");
});

test("semantic private-driver guidance yields driving/recheck while an unqualified route never defaults to rail", () => {
  const driven = planWithExperiences([
    { title: "Waterbom visit", placeName: "Waterbom Bali", planRole: "planned", summary: "Depart with a private driver." },
    { title: "Temple visit", placeName: "Tirta Empul Temple", planRole: "planned", summary: "Continue the private-driver loop." }
  ]);
  const drivenBlueprint = fullPath(driven, ["Bali"]).blueprint;
  assert.deepEqual(drivenBlueprint.movements.map((movement) => [movement.mode, movement.status]), [["driving", "recheck"]]);

  const unqualified = planWithExperiences([
    { title: "Waterbom visit", placeName: "Waterbom Bali", planRole: "planned", summary: "Visit A." },
    { title: "Temple visit", placeName: "Tirta Empul Temple", planRole: "planned", summary: "Visit B." }
  ]);
  assert.equal(fullPath(unqualified, ["Bali"]).blueprint.movements[0]?.mode, "unknown");
});

test("full path preserves resolved optional and replacement identities outside the committed route", () => {
  const plan = planWithExperiences([
    { title: "Waterbom visit", placeName: "Waterbom Bali", planRole: "planned", summary: "Visit A." },
    { title: "Temple visit", placeName: "Tirta Empul Temple", planRole: "planned", summary: "Visit B." },
    { title: "Cliff alternative", placeName: "Uluwatu Temple", planRole: "replacement", replacementFor: "Temple visit", summary: "Use C only as a replacement." },
    { title: "Art option", placeName: "Uluwatu Kecak Dance", planRole: "optional", summary: "Keep this optional." }
  ]);
  const { blueprint } = fullPath(plan, ["Bali"]);
  assert.deepEqual(blueprint.days[0]?.stops.map((stop) => stop.placeId), ["waterbom", "tirta"]);
  assert.deepEqual(blueprint.movements.map((movement) => [movement.originPlaceId, movement.destinationPlaceId]), [["waterbom", "tirta"]]);
  assert.deepEqual(blueprint.days[0]?.blocks?.slice(2).map((block) => [block.kind, block.planRole, block.placeId]), [
    ["flexible", "replacement", "uluwatu"],
    ["flexible", "optional", "kecak"]
  ]);
});

test("full path preserves two semantic experiences sharing one entity without duplicating the committed stop", () => {
  const plan = planWithExperiences([
    { title: "Museum collection", placeName: "Waterbom Bali", planRole: "planned", summary: "Primary experience." },
    { title: "Same-site optional program", placeName: "Waterbom Bali", planRole: "optional", summary: "Optional second semantic experience." },
    { title: "Same-site replacement", placeName: "Waterbom Bali", planRole: "replacement", replacementFor: "Museum collection", summary: "Replacement concept at the same entity." }
  ]);
  const { blueprint } = fullPath(plan, ["Bali"]);
  assert.deepEqual(blueprint.days[0]?.stops.map((stop) => stop.placeId), ["waterbom"]);
  assert.equal(blueprint.days[0]?.blocks?.length, 3);
  assert.deepEqual(blueprint.days[0]?.blocks?.map((block) => block.planRole), ["planned", "optional", "replacement"]);
});

test("full path preserves complete day logistics when accommodation property is pending", () => {
  const plan = planWithExperiences([
    { title: "Breakfast near the Ubud base", kind: "meal", planRole: "planned", summary: "Begin close to the suggested accommodation area so the day has a practical start.", startTime: "08:00", endTime: "08:45", timingStatus: "planned" },
    { title: "Transfer from Ubud base to ARMA", kind: "transfer", planRole: "planned", summary: "Travel from the Ubud accommodation area to the first planned stop; exact property and live travel time need recheck.", startTime: "09:00", durationMinutes: 20, timingStatus: "estimated", operationalConditions: [{ kind: "route", note: "Recheck after the exact hotel is selected." }] },
    { title: "ARMA museum and gardens", kind: "experience", placeName: "Agung Rai Museum of Art", planRole: "planned", summary: "Morning museum and garden visit.", startTime: "09:30", durationMinutes: 120, timingStatus: "planned" },
    { title: "Lunch in central Ubud", kind: "meal", planRole: "planned", summary: "Use a central Ubud lunch window before the afternoon activity.", startTime: "12:30", endTime: "13:45", timingStatus: "planned" },
    { title: "Afternoon recovery near Ubud", kind: "rest", planRole: "planned", summary: "A timed shade and heat buffer before continuing.", startTime: "14:00", endTime: "15:00", timingStatus: "planned" },
    { title: "Tirta Empul Temple", kind: "experience", placeName: "Tirta Empul Temple", planRole: "planned", summary: "Ordinary temple visit after the midday break.", startTime: "15:30", durationMinutes: 90, timingStatus: "planned" },
    { title: "Dinner and return to Ubud accommodation area", kind: "lodging", planRole: "planned", summary: "Dinner near the base and return to the Ubud accommodation area; exact property pending.", startTime: "18:30", endTime: "20:00", timingStatus: "planned" }
  ]);
  plan.dailyItinerary[0]!.startContext = { label: "Ubud accommodation area - exact property pending", status: "planned_base_pending_property" };
  plan.dailyItinerary[0]!.endContext = { label: "Ubud accommodation area - exact property pending", status: "planned_base_pending_property" };
  const { structured, blueprint, compilation } = fullPath(plan, ["Bali"]);
  const blocks = blueprint.days[0]?.blocks ?? [];
  assert.deepEqual(blocks.map((block) => [block.kind, block.title, block.startTime, block.endTime, block.display?.timingStatus]), [
    ["meal", "Breakfast near the Ubud base", "08:00", "08:45", "planned"],
    ["transfer", "Transfer from Ubud base to ARMA", "09:00", undefined, "estimated"],
    ["stop", "ARMA museum and gardens", "09:30", undefined, "planned"],
    ["meal", "Lunch in central Ubud", "12:30", "13:45", "planned"],
    ["rest", "Afternoon recovery near Ubud", "14:00", "15:00", "planned"],
    ["stop", "Tirta Empul Temple", "15:30", undefined, "planned"],
    ["lodging", "Dinner and return to Ubud accommodation area", "18:30", "20:00", "planned"]
  ]);
  assert.deepEqual(blueprint.days[0]?.stops.map((stop) => stop.placeId), ["arma", "tirta"]);
  assert.equal(blueprint.days[0]?.startContext?.status, "planned_base_pending_property");
  assert.equal(structured.fidelity.some((item) => item.classification === "CHANGED" || item.classification === "DROPPED"), false);
  assert.equal(compilation.plan.status, "draft");
});

test("non-experience day nodes with place names do not create duplicate formal stops", () => {
  const plan = planWithExperiences([
    { title: "Transfer toward DPS", kind: "transfer", placeName: "I Gusti Ngurah Rai International Airport", planRole: "planned", summary: "Go to the airport with a buffer.", startTime: "13:00", durationMinutes: 60, timingStatus: "estimated" },
    { title: "Airport formalities", kind: "transfer", placeName: "I Gusti Ngurah Rai International Airport", planRole: "planned", summary: "Check in and clear security.", startTime: "14:00", durationMinutes: 150, timingStatus: "planned" },
    { title: "Departure from DPS", kind: "event", placeName: "I Gusti Ngurah Rai International Airport", planRole: "planned", summary: "Confirmed flight departure.", startTime: "17:10", timingStatus: "confirmed" },
    { title: "Unresolved local performance", kind: "event", planRole: "planned", summary: "Selected event idea without a Research event identity.", startTime: "20:00", timingStatus: "recheck" }
  ]);
  const airportResearch: ResearchSet = {
    ...research,
    places: [...research.places, { id: "dps", name: "I Gusti Ngurah Rai International Airport", locationLabel: "DPS", city: "Bali", area: "South Bali", category: "airport", priority: "must", whyWorthIt: "Departure node.", plan: "Depart.", evidence: [] }]
  };
  const structured = structureSemanticTravelPlan(plan, airportResearch, { hardenContract: false, destinations: ["Bali"] });
  const blueprint = importSkillItinerary(airportResearch, structured.artifact, importContext());
  assert.deepEqual(blueprint.days[0]?.stops.map((stop) => stop.placeId), ["dps"]);
  assert.deepEqual(blueprint.days[0]?.blocks?.map((block) => [block.kind, block.title, block.placeId ?? "", block.placeName ?? ""]), [
    ["transfer", "Transfer toward DPS", "dps", ""],
    ["transfer", "Airport formalities", "dps", ""],
    ["event", "Departure from DPS", "dps", ""],
    ["flexible", "Unresolved local performance", "", ""]
  ]);
  assert.equal(blueprint.movements.length, 0);
  assert.equal(structured.fidelity.some((item) => item.classification === "CHANGED" || item.classification === "DROPPED"), false);
});

test("full path preserves two consecutive planned experiences at one stop only with explicit offering evidence", () => {
  const coLocatedResearch: ResearchSet = {
    ...research,
    experienceThemes: [{
      id: "theme-arma-workshop",
      title: "Same-site workshop",
      description: "A separately described program at the researched venue.",
      context: "Runs at the same venue after the main visit.",
      offeringPlaceIds: ["arma"],
      evidence: []
    }]
  };
  const plan = planWithExperiences([
    { title: "ARMA museum and gardens", placeName: "Agung Rai Museum of Art", planRole: "planned", summary: "Main visit.", startTime: "09:00", durationMinutes: 120 },
    { title: "Same-site workshop", placeName: "Agung Rai Museum of Art", planRole: "planned", summary: "Separately preserved workshop.", startTime: "11:30", durationMinutes: 90, operationalConditions: [{ kind: "reservation", note: "Reserve the workshop." }] }
  ]);
  const structured = structureSemanticTravelPlan(plan, coLocatedResearch, { hardenContract: false, destinations: ["Bali"] });
  const blueprint = importSkillItinerary(coLocatedResearch, structured.artifact, importContext());
  const compilation = compileTripBlueprint(blueprint, { createdAt: "2026-09-18T00:00:00.000Z" });
  assert.deepEqual(blueprint.days[0]?.stops.map((stop) => stop.placeId), ["arma"]);
  assert.equal(blueprint.days[0]?.blocks?.length, 2);
  assert.deepEqual(blueprint.days[0]?.blocks?.map((block) => [block.title, block.placeId, block.startTime, block.durationMinutes]), [
    ["ARMA museum and gardens", "arma", "09:00", 120],
    ["Same-site workshop", "arma", "11:30", 90]
  ]);
  assert.deepEqual(blueprint.days[0]?.blocks?.[1]?.operationalConditions, [{ kind: "reservation", note: "Reserve the workshop." }]);
  assert.equal(blueprint.movements.length, 0);
  assert.equal(structured.fidelity.some((item) => item.classification === "CHANGED" || item.classification === "DROPPED"), false);
  assert.equal(compilation.plan.status, "draft");
});

test("full path keeps an unsupported repeated workshop unresolved instead of attaching it to the museum", () => {
  const plan = planWithExperiences([
    { title: "ARMA museum and gardens", placeName: "Agung Rai Museum of Art", planRole: "planned", summary: "Main visit.", startTime: "09:30", durationMinutes: 120 },
    { title: "Balinese cooking workshop", placeName: "Agung Rai Museum of Art", planRole: "planned", summary: "Selected but unsupported workshop.", startTime: "12:30", durationMinutes: 120, operationalConditions: [{ kind: "reservation", note: "Confirm a session." }] }
  ]);
  const { structured, blueprint, compilation } = fullPath(plan, ["Bali"]);
  const workshop = blueprint.days[0]?.blocks?.[1];
  assert.deepEqual(blueprint.days[0]?.stops.map((stop) => stop.placeId), ["arma"]);
  assert.equal(workshop?.title, "Balinese cooking workshop");
  assert.equal(workshop?.planRole, "planned");
  assert.equal(workshop?.placeId, undefined);
  assert.equal(workshop?.placeName, "Agung Rai Museum of Art");
  assert.equal(workshop?.startTime, "12:30");
  assert.equal(workshop?.durationMinutes, 120);
  assert.deepEqual(workshop?.operationalConditions, [{ kind: "reservation", note: "Confirm a session." }]);
  assert.equal(blueprint.movements.length, 0);
  assert.equal(structured.fidelity.some((item) => item.classification === "CHANGED" || item.classification === "DROPPED"), false);
  assert.equal(structured.fidelity.some((item) => item.subject.includes("unresolved place identity") && item.classification === "REPRESENTED DIFFERENTLY"), true);
  assert.equal(compilation.plan.status, "draft");
});

test("similar place names remain distinct exact identities", () => {
  const similarResearch: ResearchSet = {
    ...research,
    places: [...research.places, { id: "waterbom-annex", name: "Waterbom Bali Annex", locationLabel: "Kuta", city: "Bali", area: "South Bali", category: "activity venue", priority: "nearby", whyWorthIt: "Distinct venue.", plan: "Visit separately.", evidence: [] }]
  };
  const plan = planWithExperiences([
    { title: "Main venue", placeName: "Waterbom Bali", planRole: "planned", summary: "A." },
    { title: "Annex venue", placeName: "Waterbom Bali Annex", planRole: "planned", summary: "B." }
  ]);
  const structured = structureSemanticTravelPlan(plan, similarResearch, { hardenContract: false, destinations: ["Bali"] });
  const blueprint = importSkillItinerary(similarResearch, structured.artifact, importContext());
  compileTripBlueprint(blueprint, { createdAt: "2026-09-18T00:00:00.000Z" });
  assert.deepEqual(blueprint.days[0]?.stops.map((stop) => stop.placeId), ["waterbom", "waterbom-annex"]);
});

test("full path retains unresolved planned content without inventing a navigable identity", () => {
  const plan = planWithExperiences([{ title: "Unresearched studio", placeName: "Studio pending research", planRole: "planned", summary: "Keep the selected idea unresolved." }]);
  const { blueprint } = fullPath(plan, ["Lisbon"]);
  assert.equal(blueprint.days[0]?.stops.length, 0);
  assert.equal(blueprint.days[0]?.blocks?.[0]?.placeName, "Studio pending research");
  assert.equal(blueprint.days[0]?.blocks?.[0]?.placeId, undefined);
});

test("day context does not insert a hotel stop", () => {
  const plan = planWithExperiences([{ title: "Waterbom visit", placeName: "Waterbom Bali", planRole: "planned", summary: "Visit A." }]);
  plan.dailyItinerary[0]!.startContext = { label: "Confirmed Example Hotel", status: "confirmed_property" };
  plan.dailyItinerary[0]!.endContext = { label: "Confirmed Example Hotel", status: "confirmed_property" };
  const { blueprint } = fullPath(plan, ["Bali"]);
  assert.deepEqual(blueprint.days[0]?.stops.map((stop) => stop.placeId), ["waterbom"]);
});

test("full path preserves date contexts and fixed local-time commitments", () => {
  const booking = {
    id: "flight", type: "flight" as const, status: "confirmed" as const, title: "DPS departure", source: "user" as const, sourceLabel: "fixture", sourceHash: "fixture", constraintStrength: "hard" as const,
    segments: [{ id: "leg", segmentType: "flight_leg" as const, title: "DPS departure", status: "confirmed" as const, startAtLocal: "2026-10-12T14:25", startTimeZone: "Asia/Makassar", origin: "DPS", destination: "LAX", constraintStrength: "hard" as const, fixedCommitment: true, needsReviewReasons: [] }],
    importedAt: "2026-09-18T00:00:00.000Z", updatedAt: "2026-09-18T00:00:00.000Z"
  };
  const plan = planWithExperiences([{ title: "Waterbom visit", placeName: "Waterbom Bali", planRole: "planned", summary: "Visit A." }]);
  plan.fixedCommitments = semanticFixedCommitmentsFromBookingConstraints([booking]);
  plan.dailyItinerary[0]!.startContext = { label: "Jimbaran base", status: "planned_base_pending_property" };
  plan.dailyItinerary[0]!.endContext = { label: "DPS", status: "transport_node" };
  const structured = structureSemanticTravelPlan(plan, research, { hardenContract: false, destinations: ["Bali"], bookingConstraints: [booking] });
  const blueprint = importSkillItinerary(research, structured.artifact, { ...importContext(), bookingConstraints: structured.preservedBookingConstraints });
  const compilation = compileTripBlueprint(blueprint, { createdAt: "2026-09-18T00:00:00.000Z" });
  assert.equal(blueprint.startDate, "2026-10-12");
  assert.equal(blueprint.endDate, "2026-10-12");
  assert.deepEqual(blueprint.days[0]?.startContext, plan.dailyItinerary[0]?.startContext);
  assert.deepEqual(blueprint.days[0]?.endContext, plan.dailyItinerary[0]?.endContext);
  assert.equal(blueprint.bookingConstraints?.[0]?.segments[0]?.startAtLocal, "2026-10-12T14:25");
  assert.equal(blueprint.bookingConstraints?.[0]?.segments[0]?.startTimeZone, "Asia/Makassar");
  assert.equal(structured.fidelity.some((item) => item.classification === "CHANGED" || item.classification === "DROPPED"), false);
  assert.equal(compilation.plan.configuration.arrival.expectedAtLocal, "2026-10-12T14:25");
});

test("current Blueprint contract rejects repeated-place route visits and non-adjacent movements", () => {
  const plan = planWithExperiences([
    { title: "First A visit", placeName: "Waterbom Bali", planRole: "planned", summary: "First visit." },
    { title: "B visit", placeName: "Tirta Empul Temple", planRole: "planned", summary: "Middle visit." },
    { title: "Second A visit", placeName: "Waterbom Bali", planRole: "planned", summary: "Return visit." }
  ]);
  const structured = structureSemanticTravelPlan(plan, research, { hardenContract: false, destinations: ["Bali"] });
  assert.throws(() => importSkillItinerary(research, structured.artifact, importContext()), /contains duplicate stops/);

  const valid = fullPath(planWithExperiences([
    { title: "A", placeName: "Waterbom Bali", planRole: "planned", summary: "A." },
    { title: "B", placeName: "Tirta Empul Temple", planRole: "planned", summary: "B." },
    { title: "C", placeName: "Uluwatu Temple", planRole: "planned", summary: "C." }
  ]), ["Bali"]).blueprint;
  valid.movements[0] = { ...valid.movements[0]!, destinationPlaceId: "uluwatu" };
  assert.equal(tripBlueprintIntegrityIssues(valid).some((issue) => issue.includes("must connect adjacent committed physical occurrences")), true);
});

function fullPath(plan: SemanticTravelPlan, destinations: string[]) {
  const structured = structureSemanticTravelPlan(plan, research, { hardenContract: false, destinations });
  const blueprint = importSkillItinerary(research, structured.artifact, importContext());
  const compilation = compileTripBlueprint(blueprint, { createdAt: "2026-09-18T00:00:00.000Z" });
  return { structured, blueprint, compilation };
}

function importContext() {
  return { blueprintId: "full-path-blueprint", blueprintVersion: 1, createdAt: "2026-09-18T00:00:00.000Z" };
}

function planWithExperiences(experiences: SemanticTravelExperience[]): SemanticTravelPlan {
  const plan = singleExperiencePlan({ title: experiences[0]!.title, placeName: experiences[0]!.placeName, planRole: experiences[0]!.planRole, ...(experiences[0]!.replacementFor ? { replacementFor: experiences[0]!.replacementFor } : {}) });
  plan.dailyItinerary[0]!.experiences = experiences;
  return plan;
}

function singleExperiencePlan(experience: Omit<SemanticTravelExperience, "summary">): SemanticTravelPlan {
  return {
    title: "Structurer fixture",
    language: "en",
    tripStrategy: "Preserve the selected role and identity without making new travel decisions.",
    fixedCommitments: [],
    targetedResearch: [],
    dailyItinerary: [{
      date: "2026-10-12",
      area: "Lisbon",
      startContext: { label: "Lisbon base", status: "unresolved_base" },
      endContext: { label: "Lisbon base", status: "unresolved_base" },
      plan: "Keep the experience flexible.",
      experiences: [{ summary: "Fixture experience.", ...experience }]
    }],
    unresolvedExperiences: [], preparation: [], tips: [], researchGrounding: [], followUpChecks: [], markdown: "x".repeat(1200)
  };
}
