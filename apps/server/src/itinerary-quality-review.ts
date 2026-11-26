import type { BlueprintItineraryDay, BlueprintPlace, PlanningSession, TripBlueprint } from "@c-assistant/core";
import { accommodationMatchesCity } from "./accommodation-location.js";
import { assessBlueprintDayReasonableness } from "./day-completion.js";
import { explicitInternationalFlightBudgetScope } from "./planning-session-facts.js";
import { planningCountryGatewayContext, planningExplicitGatewayOnly } from "./planning-session-generation.js";

export type ItineraryQualityFinding = {
  code: "unsupported_budget_scope" | "overplanned_day" | "unverified_booked_time" | "missing_flight_origin" | "time_sequence_conflict" | "missing_overnight_base" | "destination_scope_collapse" | "overextended_base";
  date?: string;
  blocking: boolean;
  explanation: string;
  repairInstruction: string;
};

/** A final factual review, separate from Blueprint schema integrity. */
export function reviewItineraryQuality(blueprint: TripBlueprint, session: Pick<PlanningSession, "facts">): ItineraryQualityFinding[] {
  const findings: ItineraryQualityFinding[] = [];
  const gateway = planningCountryGatewayContext(session);
  if (gateway && !planningExplicitGatewayOnly(session, gateway.city) && blueprint.days.length >= 8) {
    const gatewayName = gateway.city.toLocaleLowerCase();
    const placeById = new Map(blueprint.places.map((place) => [place.id, place] as const));
    const visitedPlaces = blueprint.days.filter((day) => day.kind === "scheduled").map((day) => day.stops
      .map((stop) => placeById.get(stop.placeId))
      .filter((place): place is BlueprintPlace => place !== undefined && !/\b(?:airport|station|terminal|hotel|hostel|motel|lodge)\b/iu.test(place.category)));
    const sightseeingDays = visitedPlaces.filter((places) => places.length > 0);
    const regionalDayCount = visitedPlaces.filter((places) => places.some((place) => Boolean(place.city?.trim() && place.city.trim().toLocaleLowerCase() !== gatewayName))).length;
    if (sightseeingDays.length >= 5 && regionalDayCount < 2) {
      findings.push({
        code: "destination_scope_collapse", blocking: true,
        explanation: `The traveler requested ${gateway.country} with ${gateway.city} as the entry and exit city, but only ${regionalDayCount} of ${sightseeingDays.length} sightseeing days leave ${gateway.city}. The gateway was treated as nearly the whole destination without a supported route comparison.`,
        repairInstruction: `Reconsider the regional route for ${gateway.country} before assigning days. Use the researched signature regions beyond ${gateway.city}, compare practical intercity transfers and complete party-level costs, and retain ${gateway.city} as the entry/exit constraint. Do not declare a single-city route necessary on an unpriced budget assumption.`
      });
    }
  }
  const budgetScope = session.facts.find((fact) => fact.key === "budget_scope" && fact.confirmed)?.value
    ?? session.facts.filter((fact) => fact.confirmed).map((fact) => explicitInternationalFlightBudgetScope(fact.value)).find(Boolean);
  const summary = blueprint.summary;
  const excludesFlights = /(?:budget|预算)[^.。;；]{0,100}(?:assum\w*|假设)[^.。;；]{0,35}(?:exclud\w*|不含|不包括)[^.。;；]{0,35}(?:international|国际|flight|机票)/iu.test(summary);
  const includesFlights = /(?:budget|预算)[^.。;；]{0,100}(?:assum\w*|假设)[^.。;；]{0,35}(?:includ\w*|包含|包括)[^.。;；]{0,35}(?:international|国际|flight|机票)/iu.test(summary);
  if ((excludesFlights && budgetScope !== "excludes international flights") || (includesFlights && budgetScope !== "includes international flights")) {
    findings.push({ code: "unsupported_budget_scope", blocking: true, explanation: "The itinerary assumes what the traveler's budget includes without a confirmed answer.", repairInstruction: "Remove the unsupported budget-coverage claim. Preserve the user's stated amount and make cost feasibility conditional on the confirmed budget scope; never silently assume whether international flights are included." });
  }

  for (const assessment of assessBlueprintDayReasonableness(blueprint)) {
    if (assessment.classification !== "OVER_PLANNED") continue;
    findings.push({ code: "overplanned_day", date: assessment.date, blocking: true, explanation: `${assessment.date} has ${assessment.visitMinutes} scheduled visit minutes plus transport, check-in, and an internal buffer; the day exceeds a comfortable window.`, repairInstruction: `Rework ${assessment.date} so selected on-site time, both travel directions, and a practical buffer fit. Preserve confirmed commitments and selected lodging. An unbooked optional ferry, excursion, or other flexible stop may move to a feasible day or return to the candidate pool; do not keep it scheduled solely to preserve its place ID. Keep the core experience when feasible, but do not shorten an operator's actual package duration or hide travel time to make the totals pass.` });
  }

  if (blueprint.days.length >= 8) {
    const dayById = new Map(blueprint.days.map((day) => [day.id, day] as const));
    const underplannedByCity = new Map<string, string[]>();
    const daysByCity = new Map<string, number>();
    for (const day of blueprint.days) {
      const city = day.city.trim();
      daysByCity.set(city, (daysByCity.get(city) ?? 0) + 1);
    }
    for (const assessment of assessBlueprintDayReasonableness(blueprint)) {
      if (assessment.classification !== "UNDER_PLANNED" || assessment.cause !== "CANDIDATE_GAP") continue;
      const city = dayById.get(assessment.dayId)?.city.trim();
      if (!city) continue;
      underplannedByCity.set(city, [...(underplannedByCity.get(city) ?? []), assessment.date]);
    }
    for (const [city, dates] of underplannedByCity) {
      if (dates.length < 3 && !(dates.length >= 2 && (daysByCity.get(city) ?? 0) >= 4)) continue;
      findings.push({
        code: "overextended_base", blocking: true,
        explanation: `${city} has ${dates.length} sightseeing days with substantial unused time (${dates.join(", ")}); the regional stay is longer than the researched activities justify.`,
        repairInstruction: "Reallocate the flexible days and overnight bases across credible researched regions. Preserve traveler-confirmed transport and stays. Do not fill the gap with repeated meals, tiny walks, unsafe hikes, or unverified bookable tours."
      });
    }
  }

  const places = new Map(blueprint.places.map((place) => [place.id, place] as const));
  for (const day of blueprint.days) {
    const conflict = firstTimeSequenceConflict(day, places);
    if (conflict) findings.push({ code: "time_sequence_conflict", date: day.date, blocking: true, explanation: `${day.date} has an impossible time sequence: ${conflict}.`, repairInstruction: `Adjust the ordered blocks on ${day.date} so every stated start, end, and visit duration can fit chronologically. Keep user-confirmed and verified service times fixed; move flexible visits or make unsupported times provisional.` });
    if (unresolvedOvernightBase(day, blueprint)) {
      const overnightCity = day.city.split(/\s+(?:and|to)\s+/iu).at(-1)?.trim().toLocaleLowerCase();
      const candidateAvailable = blueprint.places.some((place) => place.accommodation?.state === "recommended" && accommodationMatchesCity(place, overnightCity ?? ""));
      findings.push({ code: "missing_overnight_base", date: day.date, blocking: candidateAvailable, explanation: candidateAvailable
        ? `${day.date} ends at an unspecified accommodation even though a researched hotel is available.`
        : `${day.date} has no researched hotel available for its overnight base; accommodation remains to be selected.`, repairInstruction: `Select a researched lodging place for the overnight base on ${day.date} and connect the route to it. Label an unbooked property as recommended, never confirmed. Preserve any actual user-booked stay.` });
    }
    for (const block of day.blocks ?? []) {
      if (!block.placeId || !block.startTime || !["stop", "event"].includes(block.kind)) continue;
      const place = places.get(block.placeId);
      if (!place || place.operationalFacts?.entry?.booking?.requirement !== "required") continue;
      if (!/\b(?:tour|cruise|boat|watch|performance|show|workshop|guided|ferry|train)\b/iu.test(`${place.category} ${place.visitRole ?? ""}`)) continue;
      if (verifiedSessionAt(place, day.date, block.startTime) || confirmedTravelerBookingAt(blueprint, place, day.date, block.startTime)) continue;
      findings.push({ code: "unverified_booked_time", date: day.date, blocking: true, explanation: `${place.name} has an exact ${block.startTime} start, but the Research Set contains no verified matching operator session for that date.`, repairInstruction: `For ${day.date}, use a verified applicable operator session for ${place.name} if research supports it. Otherwise keep the activity in the itinerary but remove the exact startTime and matching stop.time; describe a tentative morning/afternoon window and say that the booked departure determines the final clock time. Preserve the rest of the day.` });
    }
    const flightBlockIndex = day.blocks?.findIndex((block) => block.kind === "transfer" && /\bflight\b|航班|飞机/iu.test(`${block.title ?? ""} ${block.role ?? ""}`)) ?? -1;
    if (flightBlockIndex >= 0 && missingFlightOrigin(day, flightBlockIndex, places)) {
      findings.push({ code: "missing_flight_origin", date: day.date, blocking: false, explanation: `${day.date} has a flight transfer but no departure airport before the flight in the formal route.`, repairInstruction: `Research and add the actual departure airport as a route node before the flight, then connect the hotel to that airport and the flight to the arrival airport. Do not present the hotel-to-arrival-airport span as a local ground transfer.` });
    }
  }
  return findings;
}

/** Generated clock times for unbooked tours are provisional until a dated operator session is verified. */
export function normalizeUnverifiedBookedTimes(blueprint: TripBlueprint): TripBlueprint {
  const next = structuredClone(blueprint);
  // Migrate saved checkpoints produced by the old coordinate-based duration fallback.
  for (const movement of next.movements) {
    if (movement.evidence.length || !/^(?:Allow about \d+ minutes\. )?This is a conservative planning estimate; refresh live /u.test(movement.detail ?? "")) continue;
    delete movement.durationMinutes;
    movement.detail = "Travel time requires a live route or applicable operator timetable check.";
    movement.status = "recheck";
  }
  const places = new Map(next.places.map((place) => [place.id, place] as const));
  for (const day of next.days) for (const block of day.blocks ?? []) {
    if (!block.placeId || !block.startTime || !["stop", "event"].includes(block.kind)) continue;
    const place = places.get(block.placeId);
    if (!place || place.operationalFacts?.entry?.booking?.requirement !== "required") continue;
    if (!/\b(?:tour|cruise|boat|watch|performance|show|workshop|guided|ferry|train)\b/iu.test(`${place.category} ${place.visitRole ?? ""}`)) continue;
    if (verifiedSessionAt(place, day.date, block.startTime) || confirmedTravelerBookingAt(next, place, day.date, block.startTime)) continue;
    const unsupportedTime = block.startTime;
    delete block.startTime;
    delete block.endTime;
    block.display = { ...block.display, timeLabel: "Departure time to confirm", timingStatus: "recheck" };
    if (!/departure time.*(?:book|confirm)|time.*(?:book|confirm)/i.test(block.summary ?? "")) {
      block.summary = `${block.summary?.trim() ?? ""} Confirm the departure time when booking.`.trim();
    }
    for (const stop of day.stops) if (stop.placeId === place.id && stop.time === unsupportedTime) delete stop.time;
  }
  return next;
}

function confirmedTravelerBookingAt(blueprint: TripBlueprint, place: BlueprintPlace, date: string, time: string): boolean {
  const name = place.name.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  if (name.length < 5) return false;
  return Boolean(blueprint.bookingConstraints?.some((constraint) => constraint.status === "confirmed" && ["tour", "ticket", "event"].includes(constraint.type)
    && constraint.segments.some((segment) => segment.startAtLocal?.slice(0, 16) === `${date}T${time}`
      && `${constraint.title} ${segment.title}`.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").includes(name))));
}

function firstTimeSequenceConflict(day: BlueprintItineraryDay, places: Map<string, BlueprintPlace>): string | undefined {
  const blocks = (day.blocks ?? []).filter((block) => block.planRole !== "optional" && block.planRole !== "replacement").sort((a, b) => a.order - b.order);
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index]!;
    const start = clockMinutes(block.startTime);
    const explicitEnd = clockMinutes(block.endTime);
    if (start !== undefined && explicitEnd !== undefined && explicitEnd < start && block.kind !== "transfer") return `${block.title ?? block.id} ends before it starts`;
    const visitDuration = block.durationMinutes ?? (["stop", "meal", "event"].includes(block.kind) && block.placeId ? places.get(block.placeId)?.durationMinutes : undefined);
    const occupiedUntil = explicitEnd ?? (start !== undefined ? start + (visitDuration ?? 0) : undefined);
    if (occupiedUntil === undefined || occupiedUntil > 24 * 60) continue;
    const next = blocks.slice(index + 1).find((candidate) => candidate.startTime || candidate.endTime);
    if (!next) continue;
    const nextTime = clockMinutes(next.startTime) ?? clockMinutes(next.endTime);
    if (nextTime !== undefined && nextTime < occupiedUntil) return `${block.title ?? block.id} runs until ${formatClock(occupiedUntil)}, after ${next.title ?? next.id} is scheduled at ${formatClock(nextTime)}`;
  }
  return undefined;
}

function unresolvedOvernightBase(day: BlueprintItineraryDay, blueprint: TripBlueprint): boolean {
  if (!blueprint.endDate || day.date >= blueprint.endDate || !day.blocks?.length) return false;
  const last = day.blocks.at(-1)!;
  if (last.kind !== "lodging" || last.placeId) return false;
  if (day.endContext?.status === "in_transit" || /\b(?:overnight train|overnight bus|night flight|red-eye|camping|campground|tent)\b|露营|野营/iu.test(`${day.title} ${day.summary}`)) return false;
  const hasUserStay = blueprint.bookingConstraints?.some((constraint) => constraint.type === "accommodation" && constraint.status !== "cancelled" && constraint.segments.some((segment) =>
    segment.segmentType === "hotel_stay" && (!segment.startAtLocal || !segment.endAtLocal || (segment.startAtLocal.slice(0, 10) <= day.date && segment.endAtLocal.slice(0, 10) > day.date))
  ));
  return !hasUserStay;
}

function clockMinutes(value: string | undefined): number | undefined {
  if (!value || !/^\d{2}:\d{2}$/u.test(value)) return undefined;
  const [hour, minute] = value.split(":").map(Number);
  return hour! < 24 && minute! < 60 ? hour! * 60 + minute! : undefined;
}

function formatClock(value: number): string {
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

function verifiedSessionAt(place: BlueprintPlace, date: string, time: string): boolean {
  const weekday = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"][new Date(`${date}T12:00:00Z`).getUTCDay()];
  return Boolean(place.operationalFacts?.sessions?.some((session) => {
    const applies = session.appliesTo;
    return session.status === "verified" && session.startsAt === time && session.evidence.some((evidence) => evidence.status === "verified")
      && (!applies?.date || applies.date === date)
      && (!applies?.startDate || applies.startDate <= date)
      && (!applies?.endDate || applies.endDate >= date)
      && (!applies?.season || Boolean(applies.date || applies.startDate || applies.endDate))
      && (!applies?.weekdays?.length || applies.weekdays.some((day) => day === weekday));
  }));
}

function missingFlightOrigin(day: BlueprintItineraryDay, flightBlockIndex: number, places: Map<string, BlueprintPlace>): boolean {
  const blocks = day.blocks ?? [];
  const before = blocks.slice(0, flightBlockIndex).map((block) => block.placeId && places.get(block.placeId)).filter((place): place is BlueprintPlace => Boolean(place));
  const after = blocks.slice(flightBlockIndex + 1).map((block) => block.placeId && places.get(block.placeId)).filter((place): place is BlueprintPlace => Boolean(place));
  const departureAirport = before.some((place) => /\bairport\b|机场/iu.test(`${place.category} ${place.name}`));
  const arrivalAirport = after.some((place) => /\bairport\b|机场/iu.test(`${place.category} ${place.name}`));
  return arrivalAirport && !departureAirport;
}
