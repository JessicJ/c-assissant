import type { PlanningSession, SkillItineraryArtifact, TripBlueprint } from "@c-assistant/core";
import { assessBlueprintDayReasonableness, emptyDestinationDayDates } from "./day-completion.js";
import { flightOriginGaps } from "./flight-origin-completion.js";
import { gatewayNodeGaps } from "./gateway-node-completion.js";
import { reviewItineraryQuality } from "./itinerary-quality-review.js";
import { sparseItineraryTimingDates, unselectedAccommodationDates } from "./itinerary-timing-quality.js";
import { missingProposedHotelDepartureDates } from "./proposed-departure-times.js";
import { departureReturnsToLodging } from "./departure-endpoint-completion.js";
import { planningAccommodationRequired } from "./planning-session-generation.js";
import { reviewItineraryContent } from "./itinerary-content-review.js";

export interface PublicationFinding {
  code: string;
  date?: string;
  explanation: string;
  repairInstruction: string;
}

/** One publication gate for the whole saved itinerary, including later completion passes. */
export function reviewItineraryForPublication(blueprint: TripBlueprint, session: Pick<PlanningSession, "facts">): PublicationFinding[] {
  const findings: PublicationFinding[] = reviewItineraryQuality(blueprint, session)
    .filter((finding) => finding.blocking || finding.code === "missing_flight_origin")
    .map(({ code, date, explanation, repairInstruction }) => ({ code, ...(date ? { date } : {}), explanation, repairInstruction }));
  for (const date of emptyDestinationDayDates(blueprint)) findings.push({
    code: "empty_destination_day", date,
    explanation: `${date} has no usable daytime plan.`,
    repairInstruction: "Choose a concrete baseline activity from the saved Research Set, or preserve an explicit traveler-requested rest day. Keep weather alternatives optional."
  });
  for (const assessment of assessBlueprintDayReasonableness(blueprint)) {
    if (assessment.classification !== "UNDER_PLANNED" || assessment.cause !== "CANDIDATE_GAP") continue;
    if (findings.some((finding) => finding.date === assessment.date && finding.code === "empty_destination_day")) continue;
    findings.push({ code: "underplanned_sightseeing_day", date: assessment.date,
      explanation: `${assessment.date} still has substantial unused daytime capacity after targeted research.`,
      repairInstruction: "Add a compatible researched activity in the same area, or explain and mark a genuine traveler-requested rest day. Keep the pace moderate and do not invent opening hours or transport times."
    });
  }
  for (const date of sparseItineraryTimingDates(blueprint)) findings.push({
    code: "sparse_timing", date,
    explanation: `${date} lacks a useful proposed start for its ordinary sightseeing route.`,
    repairInstruction: "Add a defensible planned start to the first concrete place while keeping uncertain flight or operator times unconfirmed."
  });
  for (const date of missingProposedHotelDepartureDates(blueprint)) findings.push({
    code: "missing_hotel_departure_time", date,
    explanation: `${date} starts at a hotel but gives no proposed time to leave for the first transfer.`,
    repairInstruction: "Set a realistic proposed startTime on the first transfer from the hotel. Treat it as itinerary advice, not a booked train or flight time."
  });
  for (const date of planningAccommodationRequired(session) ? unselectedAccommodationDates(blueprint) : []) findings.push({
    code: "unselected_accommodation", date,
    explanation: `${date} has a researched lodging option but no selected overnight route anchor.`,
    repairInstruction: "Use one exact researched lodging place as a recommended, not-booked overnight base and carry it into the next morning."
  });
  for (const gap of flightOriginGaps(blueprint)) {
    if (findings.some((finding) => finding.code === "missing_flight_origin" && finding.date === gap.date)) continue;
    findings.push({ code: "missing_flight_origin", date: gap.date,
      explanation: `${gap.date} is missing the departure airport before an intercity flight.`,
      repairInstruction: "Add the researched departure airport as a formal route node before the flight, without inventing its arrival time or a ground route to the destination airport."
    });
  }
  for (const gap of gatewayNodeGaps(blueprint, session)) findings.push({
    code: "missing_confirmed_gateway", date: gap.date,
    explanation: `${gap.date} does not use the traveler-confirmed ${gap.direction} ${gap.nodeKind} as its ${gap.direction === "arrival" ? "first" : "last"} route node.`,
    repairInstruction: `Use the researched ${gap.nodeKind} identified by "${gap.description}" as the formal ${gap.direction} node. An arrival proceeds from that node to lodging; a departure ends there and must not return to the hotel.`
  });
  if (departureReturnsToLodging(blueprint, session)) findings.push({
    code: "departure_returns_to_lodging", ...(blueprint.days.at(-1)?.date ? { date: blueprint.days.at(-1)!.date } : {}),
    explanation: "The final day travels to a station or airport but ends by returning to the hotel.",
    repairInstruction: "End at the planned departure station or airport. If the ticket is unbooked, keep the node and time provisional rather than claiming a confirmed service."
  });
  const places = new Map(blueprint.places.map((place) => [place.id, place] as const));
  const departureFact = session.facts.find((fact) => fact.key === "departure" && fact.confirmed);
  const finalDay = blueprint.days.at(-1);
  if (departureFact && finalDay && /\binternational\b|\bLAX\b|Los Angeles/iu.test(`${departureFact.value} ${finalDay.summary}`)) {
    const blocks = [...(finalDay.blocks ?? [])].sort((left, right) => left.order - right.order);
    const airport = [...blocks].reverse().find((block) => block.kind === "stop" && block.placeId && /\bairport\b|机场/iu.test(`${places.get(block.placeId)?.name ?? ""} ${places.get(block.placeId)?.category ?? ""}`));
    const airportIndex = airport ? blocks.indexOf(airport) : -1;
    const departureTransfer = airportIndex > 0 ? blocks.slice(0, airportIndex).find((block) => block.kind === "transfer") : undefined;
    const flightDeparture = airport?.endTime ? clockMinutes(airport.endTime) : undefined;
    const hotelDeparture = departureTransfer?.startTime ? clockMinutes(departureTransfer.startTime) : undefined;
    if (flightDeparture !== undefined && hotelDeparture !== undefined && flightDeparture - hotelDeparture < 240) findings.push({
      code: "insufficient_international_airport_buffer", date: finalDay.date,
      explanation: `${finalDay.date} leaves the hotel less than four hours before the planned international flight, without enough room for ground travel and the usual airport arrival buffer.`,
      repairInstruction: "Move the proposed hotel departure earlier after checking the ground route and airline check-in deadline. Preserve the traveler-confirmed flight time."
    });
  }
  for (const movement of blueprint.movements) {
    if (movement.mode !== "flight") continue;
    const origin = places.get(movement.originPlaceId);
    const destination = places.get(movement.destinationPlaceId);
    if (origin && destination && !origin.accommodation && !destination.accommodation &&
      !/\b(?:hotel|motel|lodge|hostel)\b/iu.test(origin.category) && !/\b(?:hotel|motel|lodge|hostel)\b/iu.test(destination.category) &&
      /\bairport\b|机场/iu.test(`${origin.category} ${origin.name}`) && /\bairport\b|机场/iu.test(`${destination.category} ${destination.name}`)) continue;
    const date = blueprint.days.find((day) => day.id === movement.dayId)?.date;
    findings.push({ code: "invalid_flight_leg", ...(date ? { date } : {}),
      explanation: "A formal flight movement connects places that are not two airports.",
      repairInstruction: "Use an airport-to-airport flight only for an actual flight. Mark a local hotel or sightseeing transfer as ground transport with timing to recheck."
    });
  }
  for (let index = 0; index < blueprint.days.length - 1; index += 1) {
    const day = blueprint.days[index]!;
    const next = blueprint.days[index + 1]!;
    const overnight = [...(day.blocks ?? [])].sort((left, right) => left.order - right.order).at(-1);
    const morning = [...(next.blocks ?? [])].sort((left, right) => left.order - right.order)[0];
    if (overnight?.kind !== "lodging" || !overnight.placeId || morning?.kind !== "lodging" || !morning.placeId) continue;
    if (overnight.placeId === morning.placeId) continue;
    findings.push({ code: "overnight_anchor_mismatch", date: next.date,
      explanation: `${next.date} starts from a different property than the preceding night's hotel.`,
      repairInstruction: `Start ${next.date} at the previous night's exact lodging placeId, then plan the first transfer from that property. A hotel change belongs later in the day.`
    });
  }
  return [...findings, ...reviewItineraryContent(blueprint)];
}

function clockMinutes(clock: string): number | undefined {
  if (!/^\d{2}:\d{2}$/u.test(clock)) return undefined;
  const [hour, minute] = clock.split(":").map(Number);
  return hour! < 24 && minute! < 60 ? hour! * 60 + minute! : undefined;
}

export function itineraryArtifactFromBlueprint(blueprint: TripBlueprint): SkillItineraryArtifact {
  return {
    ...(blueprint.bookingRelationshipAssessment?{bookingRelationshipAssessment:structuredClone(blueprint.bookingRelationshipAssessment)}:{}),
    title: blueprint.title,
    summary: blueprint.summary,
    language: blueprint.language,
    destinations: blueprint.destinations,
    startDate: blueprint.startDate,
    endDate: blueprint.endDate,
    ...(blueprint.guideTheme ? { guideTheme: blueprint.guideTheme } : {}),
    ...(blueprint.travelTips ? { travelTips: blueprint.travelTips } : {}),
    ...(blueprint.preparationChecklist ? { preparationChecklist: blueprint.preparationChecklist } : {}),
    ...(blueprint.alternatives ? { alternatives: blueprint.alternatives } : {}),
    ...(blueprint.researchGrounding ? { researchGrounding: blueprint.researchGrounding } : {}),
    actionRequirements: blueprint.actionRequirements,
    days: blueprint.days,
    movements: blueprint.movements
  };
}
