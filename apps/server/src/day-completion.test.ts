import assert from "node:assert/strict";
import test from "node:test";
import { importSkillItinerary, importSkillResearchBatches, type SkillResearchBatchArtifact, type TripBlueprint } from "@c-assistant/core";
import { assessBlueprintDayReasonableness, completionTargetsForBlueprint, emptyDestinationDayDates } from "./day-completion.js";

const now = "2026-09-08T00:00:00.000Z";
const lineage = { skillId: "interactive-trip-planner", skillVersion: "1.0.0" };
const proposalRef = { sessionId: "session", proposalVersion: 1 };

test("a final station route keeps departure capacity while ordinary sparse days and overloaded routes remain rejected", () => {
  const blueprint = {
    endDate: "2026-10-22", places: [{ id: "park", name: "Lake garden", category: "park" }, { id: "station", name: "Hangzhou East Railway Station", category: "railway station" }], movements: [],
    days: [{ id: "last", date: "2026-10-22", kind: "scheduled", city: "Hangzhou", title: "Garden and return to Shanghai", summary: "Collect the bags before the station journey.", stops: [{ placeId: "park", order: 1 }, { placeId: "station", order: 2 }], blocks: [
      { id: "visit", kind: "stop", order: 1, placeId: "park", durationMinutes: 75 },
      { id: "journey", kind: "transfer", order: 2, title: "Hotel to station" },
      { id: "station", kind: "stop", order: 3, placeId: "station" }
    ] }]
  } as unknown as TripBlueprint;
  assert.equal(assessBlueprintDayReasonableness(blueprint)[0]?.classification, "INTENTIONALLY_LIGHT");
  blueprint.endDate = "2026-10-23";
  assert.equal(assessBlueprintDayReasonableness(blueprint)[0]?.classification, "UNDER_PLANNED");
  blueprint.endDate = "2026-10-22";
  blueprint.days[0]!.blocks![0]!.durationMinutes = 700;
  assert.equal(assessBlueprintDayReasonableness(blueprint)[0]?.classification, "OVER_PLANNED");
});

test("a single Milford coach and cruise day can use a longer window without hiding road time", () => {
  const blueprint = {
    places: [{ id: "milford", name: "Milford Sound Coach and Cruise", category: "full-day excursion" }],
    movements: [],
    days: [{ id: "day", date: "2026-11-10", kind: "scheduled", city: "Queenstown", title: "Milford Sound day trip", summary: "Coach and cruise", stops: [{ placeId: "milford", order: 1 }], blocks: [
      { id: "out", kind: "transfer", order: 1, durationMinutes: 300 },
      { id: "cruise", kind: "stop", order: 2, placeId: "milford", durationMinutes: 120 },
      { id: "back", kind: "transfer", order: 3, durationMinutes: 300 }
    ] }]
  } as unknown as TripBlueprint;
  assert.equal(assessBlueprintDayReasonableness(blueprint)[0]?.classification, "INTENTIONALLY_LIGHT");
  blueprint.days[0]!.blocks![2]!.durationMinutes = 400;
  assert.equal(assessBlueprintDayReasonableness(blueprint)[0]?.classification, "OVER_PLANNED");
});

test("an excursion with unconfirmed operator timing is not padded with another attraction", () => {
  const blueprint = {
    places: [{ id: "milford", name: "Milford Sound Classic Cruise", category: "cruise" }],
    movements: [],
    days: [{ id: "day", date: "2026-11-13", kind: "scheduled", city: "Queenstown", title: "Milford Sound excursion", summary: "Coach and cruise timing to confirm", stops: [{ placeId: "milford", order: 1 }], blocks: [
      { id: "out", kind: "transfer", order: 1, title: "Queenstown to Milford Sound" },
      { id: "cruise", kind: "stop", order: 2, placeId: "milford" },
      { id: "back", kind: "transfer", order: 3, title: "Milford Sound to Queenstown" }
    ] }]
  } as unknown as TripBlueprint;
  assert.equal(assessBlueprintDayReasonableness(blueprint)[0]?.classification, "INTENTIONALLY_LIGHT");
});

test("a city-to-city hotel change with an afternoon visit is not treated as an empty sightseeing day", () => {
  const blueprint = {
    places: [
      { id: "te-anau-hotel", name: "Te Anau Hotel", city: "Te Anau", category: "hotel" },
      { id: "queenstown-hotel", name: "Queenstown Hotel", city: "Queenstown", category: "hotel" },
      { id: "skyline", name: "Skyline Queenstown", city: "Queenstown", category: "attraction", durationMinutes: 120 }
    ], movements: [],
    days: [{ id: "day", date: "2026-11-11", kind: "scheduled", city: "Queenstown", title: "Return to Queenstown", summary: "Travel then visit Skyline", stops: [{ placeId: "skyline", order: 1 }], blocks: [
      { id: "start", kind: "lodging", order: 1, placeId: "te-anau-hotel" },
      { id: "road", kind: "transfer", order: 2, title: "Te Anau to Queenstown", startTime: "09:00" },
      { id: "visit", kind: "stop", order: 3, placeId: "skyline", durationMinutes: 120, startTime: "15:00" },
      { id: "end", kind: "lodging", order: 4, placeId: "queenstown-hotel" }
    ] }]
  } as unknown as TripBlueprint;
  assert.equal(assessBlueprintDayReasonableness(blueprint)[0]?.classification, "INTENTIONALLY_LIGHT");
  blueprint.days[0]!.blocks![1]!.durationMinutes = 650;
  assert.equal(assessBlueprintDayReasonableness(blueprint)[0]?.classification, "OVER_PLANNED");
});

test("day capacity counts an event and its matching transfer only once", () => {
  const blueprint = {
    places: [{ id: "event-place", name: "Performance", city: "City", category: "theatre" }],
    movements: [{ id: "journey", dayId: "day", originPlaceId: "base", destinationPlaceId: "event-place", durationMinutes: 180 }],
    days: [{ id: "day", date: "2026-10-08", kind: "scheduled", city: "City", title: "Arts day", summary: "Visit the venue", stops: [{ placeId: "event-place", order: 1 }], blocks: [
      { id: "travel", kind: "transfer", order: 1, durationMinutes: 180 },
      { id: "show", kind: "event", order: 2, placeId: "event-place", durationMinutes: 240 }
    ] }]
  } as unknown as TripBlueprint;
  const [assessment] = assessBlueprintDayReasonableness(blueprint);
  assert.equal(assessment?.visitMinutes, 240);
  assert.equal(assessment?.classification, "WELL_PLANNED");
});

test("dependency-gap transfer day is preserved instead of targeted for attraction completion", () => {
  const research = researchSet([]);
  const blueprint = importSkillItinerary(research, {
    title: "Bali",
    summary: "Base change",
    language: "en",
    destinations: ["Bali"],
    startDate: "2026-10-08",
    endDate: "2026-10-08",
    days: [{
      id: "day-2026-10-08",
      date: "2026-10-08",
      kind: "transit",
      city: "South Bali",
      title: "Change to the South Bali Base",
      summary: "Move from the assumed Ubud-area base to South Bali. South Bali lodging not selected; baggage and check-in are unresolved.",
      stops: [],
      blocks: [{ id: "lodging", kind: "lodging", order: 1, title: "South Bali lodging not selected", summary: "Book the second base and confirm baggage, check-in, and transfer plan.", evidence: [] }],
      candidatePlaceIds: []
    }],
    movements: []
  }, { blueprintId: "blueprint", blueprintVersion: 1, createdAt: now });
  const [assessment] = assessBlueprintDayReasonableness(blueprint);
  assert.equal(assessment!.classification, "UNDER_PLANNED");
  assert.equal(assessment!.cause, "DEPENDENCY_GAP");
  assert.equal(completionTargetsForBlueprint(blueprint, research).length, 0);
});

test("a hotel-only free day is targeted even when its lodging copy says base", () => {
  const blueprint = {
    places: [{ id: "hotel", name: "Hotel Waterloo", city: "Wellington", category: "hotel", accommodation: { state: "recommended" } }],
    movements: [],
    days: [{ id: "day", date: "2026-12-17", kind: "free_time", city: "Wellington", title: "Open budget and weather day", summary: "Keep this day free for weather and budget flexibility.", stops: [], candidatePlaceIds: [], blocks: [
      { id: "start", kind: "lodging", order: 1, placeId: "hotel", title: "Depart from Hotel Waterloo", summary: "The day begins at the provisional base." },
      { id: "end", kind: "lodging", order: 2, placeId: "hotel", title: "Hotel Waterloo", summary: "Return to the overnight base." }
    ] }]
  } as unknown as TripBlueprint;
  const [assessment] = assessBlueprintDayReasonableness(blueprint);
  assert.equal(assessment?.cause, "CANDIDATE_GAP");
  assert.deepEqual(emptyDestinationDayDates(blueprint), ["2026-12-17"]);
  assert.equal(completionTargetsForBlueprint(blueprint, researchSet([])).length, 1);
});

test("an explicitly requested rest day is not treated as an empty destination day", () => {
  const blueprint = {
    places: [], movements: [],
    days: [{ id: "day", date: "2026-12-17", kind: "rest", city: "Wellington", title: "Rest day", summary: "User requested a full rest day after an overnight flight.", stops: [], candidatePlaceIds: [], blocks: [] }]
  } as unknown as TripBlueprint;
  assert.equal(assessBlueprintDayReasonableness(blueprint)[0]?.classification, "INTENTIONALLY_LIGHT");
  assert.deepEqual(emptyDestinationDayDates(blueprint), []);
});

test("candidate-gap sightseeing day prefers existing same-area research before new research", () => {
  const research = researchSet([
    { id: "tanah-lot", name: "Tanah Lot", area: "Beraban", city: "Tabanan", category: "sea temple", durationMinutes: 90 },
    { id: "kediri-market", name: "Kediri Market", area: "Beraban", city: "Tabanan", category: "market", durationMinutes: 90 }
  ], [{ kind: "same_area", fromPlaceId: "kediri-market", toPlaceId: "tanah-lot", rationale: "Same west-coast area." }]);
  const anchor = research.places.find((place) => place.name === "Tanah Lot")!;
  const candidate = research.places.find((place) => place.name === "Kediri Market")!;
  const blueprint = importSkillItinerary(research, {
    title: "Bali",
    summary: "Coast",
    language: "en",
    destinations: ["Bali"],
    startDate: "2026-10-11",
    endDate: "2026-10-11",
    days: [{
      id: "day-2026-10-11",
      date: "2026-10-11",
      kind: "scheduled",
      city: "Tabanan",
      title: "Tanah Lot Coastal Temple",
      summary: "A one-anchor final sightseeing day.",
      stops: [{ placeId: anchor.id, order: 1 }],
      blocks: [{ id: "tanah", kind: "stop", order: 1, placeId: anchor.id, durationMinutes: 90, evidence: [] }],
      candidatePlaceIds: [candidate.id]
    }],
    movements: []
  }, { blueprintId: "blueprint", blueprintVersion: 1, createdAt: now });
  const [target] = completionTargetsForBlueprint(blueprint, research);
  assert.equal(target!.assessment.cause, "CANDIDATE_GAP");
  assert.deepEqual(target!.existingCandidates.map((place) => place.id), [candidate.id]);
  assert.equal(target!.researchScopeLabel, undefined);
});

function researchSet(
  places: Array<{ id: string; name: string; area: string; city: string; category: string; durationMinutes: number }>,
  relationships: NonNullable<SkillResearchBatchArtifact["relationships"]> = []
) {
  return importSkillResearchBatches([{
    id: "scope-1",
    scopeLabel: "Bali",
    completedAt: now,
    sources: [],
    events: [],
    actionRequirements: [],
    places: places.map((place) => ({
      id: place.id,
      name: place.name,
      locationLabel: `${place.area}, ${place.city}`,
      city: place.city,
      area: place.area,
      category: place.category,
      priority: "preferred" as const,
      coordinates: [-8.6, 115.1] as [number, number],
      durationMinutes: place.durationMinutes,
      whyWorthIt: `${place.name} is relevant to the day.`,
      plan: `Visit ${place.name}.`,
      sourceUrls: []
    })),
    relationships
  }], { researchSetId: "research", generationKey: "generation", proposalRef, skillLineage: lineage, createdAt: now, updatedAt: now });
}
