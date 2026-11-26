import assert from "node:assert/strict";
import test from "node:test";
import type { PlanningSession, ResearchSet, TripBlueprint } from "@c-assistant/core";
import { addResearchedGatewayNodes, correctImpossibleFlightMovements, gatewayNodeGaps, matchesGateway, researchedGatewayForGap } from "./gateway-node-completion.js";
import { reviewItineraryForPublication } from "./itinerary-publication-review.js";

const session = { facts: [
  { key: "arrival", value: "Arrive Tokyo Haneda at 10:30 on 2026-11-05", confirmed: true },
  { key: "departure", value: "Depart Osaka Kansai at 17:30 on 2026-11-16", confirmed: true }
] } as PlanningSession;
const haneda = { id: "haneda", name: "Tokyo Haneda Airport", city: "Tokyo", category: "airport", coordinates: [35.55, 139.78], evidence: [] };
const kansai = { id: "kansai", name: "Kansai International Airport", city: "Osaka", category: "airport", coordinates: [34.43, 135.24], evidence: [] };
const hotelTokyo = { id: "tokyo-hotel", name: "Hotel Metropolitan Tokyo Marunouchi", city: "Tokyo", category: "hotel", accommodation: { state: "recommended" } };
const alternateHotel = { id: "alternate-hotel", name: "The Tokyo Station Hotel", city: "Tokyo", category: "hotel", accommodation: { state: "recommended" } };
const hotelKansai = { id: "kansai-hotel", name: "Hotel Nikko Kansai Airport", city: "Osaka", category: "hotel", accommodation: { state: "recommended" } };

function blueprint(): TripBlueprint {
  return { id: "blueprint", version: 1, title: "Japan", summary: "Japan by rail", language: "en", destinations: ["Japan"], startDate: "2026-11-05", endDate: "2026-11-16", places: [hotelTokyo, alternateHotel, hotelKansai], days: [
    { id: "arrival", date: "2026-11-05", kind: "scheduled", city: "Tokyo", title: "Haneda arrival", summary: "Arrive at Haneda", stops: [{ placeId: "alternate-hotel", order: 1 }], candidatePlaceIds: [], blocks: [
      { id: "arrival-transfer", kind: "transfer", order: 1, title: "Haneda to hotel", evidence: [] },
      { id: "arrival-hotel", kind: "lodging", order: 2, placeId: "tokyo-hotel", evidence: [] }
    ] },
    { id: "departure", date: "2026-11-16", kind: "transit", city: "Osaka", title: "Kansai airport departure", summary: "Depart from Kansai", stops: [], candidatePlaceIds: [], blocks: [
      { id: "departure-hotel", kind: "lodging", order: 1, placeId: "kansai-hotel", evidence: [] },
      { id: "departure-transfer", kind: "transfer", order: 2, title: "To terminal", evidence: [] },
      { id: "false-return", kind: "lodging", order: 3, placeId: "kansai-hotel", evidence: [] }
    ] }
  ], movements: [{ id: "false-flight", dayId: "departure", originPlaceId: "tokyo-hotel", destinationPlaceId: "kansai-hotel", mode: "flight", status: "recheck", durationMinutes: 180, evidence: [] }] } as unknown as TripBlueprint;
}

test("dated confirmed airports are required formal route endpoints", () => {
  const before = blueprint();
  assert.deepEqual(gatewayNodeGaps(before, session).map((gap) => `${gap.date}:${gap.direction}`), ["2026-11-05:arrival", "2026-11-16:departure"]);
  const findings = reviewItineraryForPublication(before, session);
  assert.equal(findings.filter((finding) => finding.code === "missing_confirmed_gateway").length, 2);
  assert.ok(findings.some((finding) => finding.code === "invalid_flight_leg"));
});

test("researched airports replace missing endpoints and the false final hotel return", () => {
  const research = { places: [haneda, kansai, hotelTokyo, hotelKansai] } as unknown as ResearchSet;
  const completed = addResearchedGatewayNodes(blueprint(), research, session);
  assert.deepEqual(completed.unresolved, []);
  assert.deepEqual(gatewayNodeGaps(completed.blueprint, session), []);
  assert.equal(completed.blueprint.days[0]!.blocks![0]!.placeId, "haneda");
  assert.equal(completed.blueprint.days[1]!.blocks!.at(-1)!.placeId, "kansai");
  assert.equal(completed.blueprint.days[1]!.blocks!.filter((block) => block.kind === "lodging").length, 1);
  assert.equal(completed.blueprint.days[0]!.stops.some((stop) => stop.placeId === "alternate-hotel"), false);
  const corrected = correctImpossibleFlightMovements(completed.blueprint);
  assert.equal(corrected.movements.some((movement) => movement.id === "false-flight"), false, "An obsolete nonadjacent edge must not survive endpoint completion.");
  assert.equal(correctImpossibleFlightMovements(blueprint()).movements[0]?.mode, "unknown");
  assert.equal(corrected.movements.find((movement) => movement.id === "false-flight")?.durationMinutes, undefined);
  assert.equal(reviewItineraryForPublication(corrected, session).some((finding) => ["missing_confirmed_gateway", "invalid_flight_leg"].includes(finding.code)), false);
});

test("an unresearched traveler airport remains unresolved and cannot be silently invented", () => {
  const completed = addResearchedGatewayNodes(blueprint(), { places: [] } as unknown as ResearchSet, session);
  assert.equal(completed.unresolved.length, 2);
});

test("operator-confirmed airport aliases match Chinese facts to English endpoints without false ambiguity from duplicate research", () => {
  const hnd = { ...haneda, name: "Tokyo International Airport (Haneda Airport)" };
  const hndDuplicate = { ...haneda, id: "haneda-duplicate" };
  const kixDuplicate = { ...kansai, id: "kansai-duplicate" };
  const narita = { ...haneda, id: "narita", name: "Narita International Airport" };
  const candidates = [hnd, hndDuplicate, kansai, kixDuplicate, narita] as unknown as ResearchSet["places"];
  assert.equal(matchesGateway(candidates, "2026-11-05 09:00 抵达东京羽田机场", "airport")?.id, "haneda");
  assert.equal(matchesGateway(candidates, "2026-11-16 18:00 从大阪关西国际机场起飞", "airport")?.id, "kansai");
  assert.equal(matchesGateway(candidates, "Depart KIX", "airport")?.id, "kansai");
  assert.equal(matchesGateway(candidates, "Arrive Tokyo Airport", "airport"), undefined);
  assert.equal(matchesGateway(candidates, "Haneda or Kansai Airport", "airport"), undefined);
  assert.equal(matchesGateway([narita] as unknown as ResearchSet["places"], "羽田机场", "airport"), undefined);
  const chinese = { facts: [
    { key: "arrival", value: "2026-11-05 09:00 抵达东京羽田机场", confirmed: true },
    { key: "departure", value: "2026-11-16 18:00 从大阪关西国际机场起飞", confirmed: true }
  ] } as PlanningSession;
  const completed = addResearchedGatewayNodes(blueprint(), { places: candidates } as unknown as ResearchSet, chinese);
  assert.deepEqual(completed.unresolved, []);
  assert.deepEqual(gatewayNodeGaps(completed.blueprint, chinese), []);
});

test("an undated return train ends at the exact station instead of returning to the hotel", () => {
  const hotel = { id: "hotel-hz", name: "Hangzhou Dahua Hotel", city: "Hangzhou", category: "hotel", accommodation: { state: "recommended" } };
  const east = { id: "hangzhou-east", name: "Hangzhou East Railway Station", city: "Hangzhou", category: "railway station", evidence: [] };
  const central = { id: "hangzhou-central", name: "Hangzhou Railway Station", city: "Hangzhou", category: "railway station", evidence: [] };
  const plan = { id: "hangzhou", version: 1, title: "Hangzhou", summary: "Rail trip", language: "en", destinations: ["Hangzhou"], startDate: "2026-10-10", endDate: "2026-10-12", places: [hotel, east, central], days: [
    { id: "last", date: "2026-10-12", kind: "transit", city: "Hangzhou", title: "Return to Shanghai", summary: "Train from Hangzhou East", stops: [{ placeId: "hangzhou-east", order: 1 }], candidatePlaceIds: [], blocks: [
      { id: "morning-hotel", kind: "lodging", order: 1, placeId: "hotel-hz", evidence: [] },
      { id: "east-station", kind: "stop", order: 2, placeId: "hangzhou-east", evidence: [] },
      { id: "false-return", kind: "lodging", order: 3, placeId: "hotel-hz", evidence: [] }
    ], endContext: { label: "Hangzhou Dahua Hotel", status: "overnight_base", placeId: "hotel-hz" } }
  ], movements: [] } as unknown as TripBlueprint;
  const railSession = { facts: [{ key: "departure", value: "Return to Shanghai by train from Hangzhou East Railway Station around 17:00", confirmed: true }] } as PlanningSession;
  assert.deepEqual(gatewayNodeGaps(plan, railSession).map((gap) => [gap.date, gap.nodeKind]), [["2026-10-12", "station"]]);
  const completed = addResearchedGatewayNodes(plan, { places: [hotel, east, central] } as unknown as ResearchSet, railSession);
  assert.deepEqual(completed.unresolved, []);
  const day = completed.blueprint.days[0]!;
  assert.equal(day.blocks?.at(-1)?.placeId, "hangzhou-east");
  assert.equal(day.blocks?.filter((block) => block.kind === "lodging").length, 1);
  assert.equal(day.endContext?.placeId, "hangzhou-east");
  assert.deepEqual(gatewayNodeGaps(completed.blueprint, railSession), []);
  assert.equal(reviewItineraryForPublication(completed.blueprint, railSession).some((finding) => finding.code === "missing_confirmed_gateway"), false);
});

test("a Chinese directional station name resolves without inventing a different city station", () => {
  const east = { id: "east", name: "杭州东站", city: "杭州", category: "railway station" };
  const central = { id: "central", name: "杭州站", city: "杭州", category: "railway station" };
  assert.equal(matchesGateway([central, east] as ResearchSet["places"], "乘高铁从杭州东出发", "station")?.id, "east");
  assert.equal(matchesGateway([central, east] as ResearchSet["places"], "从杭州出发", "station"), undefined);
});

test("an undecided return station does not become a false confirmed gateway", () => {
  const undecided = { facts: [{ key: "departure", value: "Train ticket not booked; return station not decided", confirmed: true }] } as PlanningSession;
  assert.deepEqual(gatewayNodeGaps(blueprint(), undecided), []);
});


test("a requested station recommendation accepts the researched local endpoint while an explicit different station remains a gap", () => {
  const station = { id: "east", name: "杭州东站", city: "杭州", category: "railway station" };
  const plan = { startDate: "2026-10-20", endDate: "2026-10-22", places: [station], days: [{ id: "arrival", date: "2026-10-20", city: "杭州", blocks: [{ id: "station", kind: "stop", placeId: "east", order: 1 }] }] } as unknown as TripBlueprint;
  const facts = (value: string) => ({ facts: [{ key: "arrival", value, confirmed: true }] }) as PlanningSession;
  assert.deepEqual(gatewayNodeGaps(plan, facts("2026-10-20 从上海乘高铁前往杭州，车次未订，请推荐合理抵达时间与车站")), []);
  assert.equal(gatewayNodeGaps(plan, facts("2026-10-20 高铁抵达杭州西站")).length, 1);
  assert.deepEqual(gatewayNodeGaps(plan, facts("2026-10-20 高铁抵达杭州东站")), []);
});


test("a generic station request fills a missing arrival node using saved local research", () => {
  const station = { id: "east", name: "杭州东站", city: "杭州", category: "高铁站", evidence: [] };
  const hotel = { id: "hotel", name: "杭州酒店", city: "杭州", category: "hotel", accommodation: { state: "recommended" }, evidence: [] };
  const museum = { id: "museum", name: "博物馆", city: "杭州", category: "museum", evidence: [] };
  const plan = { startDate: "2026-10-20", endDate: "2026-10-22", places: [hotel, museum], movements: [{ id: "retained", dayId: "arrival", originPlaceId: "hotel", destinationPlaceId: "museum", mode: "walking", status: "verified", durationMinutes: 12, evidence: [{ sourceId: "verified-map", status: "verified" }] }],
    days: [{ id: "arrival", date: "2026-10-20", city: "杭州", stops: [{ placeId: "hotel", order: 1 }, { placeId: "museum", order: 2 }], blocks: [{ id: "hotel", kind: "lodging", placeId: "hotel", order: 1 }, { id: "museum", kind: "stop", placeId: "museum", order: 2 }] }] } as unknown as TripBlueprint;
  const request = { facts: [{ key: "arrival", confirmed: true, value: "2026-10-20 从上海高铁到杭州，请推荐抵达车站" }] } as PlanningSession;
  const gap = gatewayNodeGaps(plan, request)[0]!;
  const research = { places: [station, hotel, museum] } as unknown as ResearchSet;
  assert.equal(researchedGatewayForGap(plan, research, gap)?.id, "east");
  const completed = addResearchedGatewayNodes(plan, research, request);
  assert.deepEqual(completed.unresolved, []);
  assert.deepEqual(completed.blueprint.days[0]?.blocks?.map((block) => block.placeId), ["east", "hotel", "museum"]);
  assert.deepEqual(gatewayNodeGaps(completed.blueprint, request), []);
  assert.equal(completed.blueprint.movements.find((movement) => movement.id === "retained")?.durationMinutes, 12);
  assert.equal(completed.blueprint.movements.find((movement) => movement.originPlaceId === "east")?.destinationPlaceId, "hotel");
  assert.equal(completed.blueprint.movements.find((movement) => movement.originPlaceId === "east")?.durationMinutes, undefined);
  assert.equal(plan.days[0]?.blocks?.[0]?.placeId, "hotel");
});

test("station completion follows the already selected local transfer but never guesses between unselected stations", () => {
  const east = { id: "east", name: "杭州东站", city: "杭州", category: "高铁站" };
  const west = { id: "west", name: "杭州西站", city: "杭州", category: "高铁站" };
  const plan = { days: [{ date: "2026-10-20", city: "杭州", stops: [], blocks: [{ kind: "transfer", placeId: "east" }] }] } as unknown as TripBlueprint;
  const research = { places: [east, west] } as ResearchSet;
  const gap = { date: "2026-10-20", direction: "arrival" as const, nodeKind: "station" as const, description: "请推荐抵达车站" };
  assert.equal(researchedGatewayForGap(plan, research, gap)?.id, "east");
  assert.equal(researchedGatewayForGap(plan, research, { ...gap, description: "抵达杭州西站" })?.id, "west");
  plan.days[0]!.blocks = [];
  assert.equal(researchedGatewayForGap(plan, research, gap), undefined);
  assert.equal(researchedGatewayForGap(plan, { places: [east] } as ResearchSet, { ...gap, description: "抵达杭州西站" }), undefined);
});
