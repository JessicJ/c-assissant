import type { BlueprintPlace, PlanningSession, ResearchSet, TripBlueprint } from "@c-assistant/core";

/** Adapt explicit origin facts and an existing empty departure day; never infer a booked flight. */
export function materializeOutboundDeparture(blueprint: TripBlueprint, session: Pick<PlanningSession, "facts">, research: Pick<ResearchSet, "places">): TripBlueprint {
  const origin = session.facts.find(fact => fact.key === "arrival_origin" && fact.confirmed)?.value;
  const day = blueprint.days[0];
  if (!origin || !day || day.kind !== "transit" || day.blocks?.length || day.stops.length || !/depart|出发/iu.test(day.title)) return blueprint;
  const candidates = research.places.filter(place => /airport|机场/iu.test(place.category + " " + place.name) && matchesOrigin(origin, place));
  if (candidates.length !== 1 || !candidates[0]?.city) return blueprint;
  const airport = candidates[0];
  const next = structuredClone(blueprint);
  if (!next.places.some(place => place.id === airport.id)) next.places.push(structuredClone(airport));
  const departure = next.days[0]!;
  const preparationEventId = `${day.id}-outbound-preparation-event`;
  next.events.push({ id: preparationEventId, title: "Get ready for departure", startDate: day.date, description: "Departure preparation checklist; no booking or fixed appointment time.", evidence: [] });
  // Legacy prose times are estimates even if the prose calls the flight confirmed.
  const time = day.summary.match(/(?:approximately|about|around|约)\s*(\d{1,2}:\d{2})/iu)?.[1];
  const validTime = time && /^([01]?\d|2[0-3]):[0-5]\d$/.test(time) ? time.padStart(5, "0") : undefined;
  departure.city = airport.city!;
  departure.summary = `Prepare for your flight from ${airport.name}. Confirm your flight time, airline and terminal; your pickup location is still needed to work out when to leave.`;
  departure.blocks = [
    { id: `${day.id}-outbound-prepare`, kind: "event", eventId: preparationEventId, order: 1, title: "Get ready for departure", summary: "Keep passports, tickets, phone and luggage together. Check each traveler's entry documents, flight details and baggage allowance.", role: "outbound preparation", display: { timingStatus: "unknown", timeLabel: "Before leaving", reorderable: false }, evidence: [] },
    { id: `${day.id}-outbound-airport-transfer`, kind: "transfer", order: 2, placeId: airport.id, title: `Travel to ${airport.name}`, summary: "Choose your pickup location and check the driving time. Confirm the airline's check-in deadline before deciding when to leave.", role: "outbound airport transfer", display: { timingStatus: "unknown", timeLabel: "Time to confirm", reorderable: false }, evidence: [] },
    { id: `${day.id}-outbound-checkin`, kind: "event", order: 3, placeId: airport.id, title: "Check in and go through security", summary: "Check your airline, terminal, bag-drop deadline and boarding gate. Keep your passport and boarding pass handy.", role: "outbound check-in", display: { timingStatus: "unknown", timeLabel: "Before boarding", reorderable: false }, evidence: [] },
    { id: `${day.id}-outbound-flight`, kind: "event", order: 4, placeId: airport.id, title: `Depart from ${airport.name}`, summary: validTime ? `Your Plan suggests around ${validTime} local time. Check this against your ticket; airline, terminal and boarding time still need confirmation.` : "Confirm the departure and boarding times on your ticket.", role: "outbound departure", ...(validTime ? { startTime: validTime } : {}), display: { timingStatus: "recheck", timeLabel: validTime ? `Around ${validTime} · check ticket` : "Check ticket", reorderable: false }, evidence: [] }
  ];
  departure.stops = [{ placeId: airport.id, order: 1, role: "Outbound departure airport" }];
  const transit = next.days[1];
  if (transit?.kind === "transit" && !transit.blocks?.length && !transit.stops.length && /flight|date.?line|飞行|在途/iu.test(transit.title + " " + transit.summary)) {
    const flightEventId = `${transit.id}-outbound-flight-event`;
    next.events.push({ id: flightEventId, title: "In flight to your destination", startDate: transit.date, description: "In-flight day from the existing itinerary; no flight number or ticket is inferred.", evidence: [] });
    transit.blocks = [{ id: `${transit.id}-outbound-inflight`, eventId: flightEventId, kind: "event", order: 1, title: "In flight to your destination", summary: "This day is spent travelling across the date line. Keep travel documents handy and rest when you can. Follow your ticket for connections and arrival times.", role: "in-flight travel", display: { timingStatus: "unknown", timeLabel: "In flight", reorderable: false }, evidence: [] }];
    transit.city = airport.city!; // Reminder clock stays at the origin until the arrival day.
  }
  return next;
}

function matchesOrigin(value: string, place: BlueprintPlace): boolean {
  const code = value.match(/\(([A-Z]{3})\)/)?.[1];
  if (code) return new RegExp(`\\b${code}\\b`, "u").test(place.name);
  return place.name.trim().toLocaleLowerCase() === value.trim().toLocaleLowerCase();
}
