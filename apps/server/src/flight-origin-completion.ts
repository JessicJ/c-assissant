import type { BlueprintItineraryDay, BlueprintMovement, BlueprintPlace, ResearchSet, TripBlueprint } from "@c-assistant/core";

export type FlightOriginGap = { date: string; city: string; arrivalAirport: string };

export function flightOriginGaps(blueprint: TripBlueprint): FlightOriginGap[] {
  const places = new Map(blueprint.places.map((place) => [place.id, place] as const));
  return blueprint.days.flatMap((day) => {
    const blocks = day.blocks ?? [];
    const flightIndex = blocks.findIndex((block) => block.kind === "transfer" && /\bflight\b|航班|飞机/iu.test(`${block.title ?? ""} ${block.role ?? ""}`));
    if (flightIndex < 0) return [];
    const before = blocks.slice(0, flightIndex).flatMap((block) => block.placeId && places.get(block.placeId) ? [places.get(block.placeId)!] : []);
    const after = blocks.slice(flightIndex + 1).flatMap((block) => block.placeId && places.get(block.placeId) ? [places.get(block.placeId)!] : []);
    const arrival = after.find((place) => isAirport(place));
    if (!arrival || before.some((place) => isAirport(place))) return [];
    const origin = before.at(-1);
    return origin?.city ? [{ date: day.date, city: origin.city, arrivalAirport: arrival.name }] : [];
  });
}

export function addResearchedFlightOrigins(blueprint: TripBlueprint, research: ResearchSet): { blueprint: TripBlueprint; unresolved: FlightOriginGap[] } {
  const gaps = flightOriginGaps(blueprint);
  if (!gaps.length) return { blueprint, unresolved: [] };
  const places = new Map(blueprint.places.map((place) => [place.id, place] as const));
  const candidates = research.places.filter((place) => isAirport(place) && place.coordinates);
  const unresolved: FlightOriginGap[] = [];
  let days = blueprint.days;
  let movements = blueprint.movements;
  for (const gap of gaps) {
    const matches = candidates.filter((place) => place.city?.trim().toLocaleLowerCase() === gap.city.trim().toLocaleLowerCase());
    if (matches.length !== 1) { unresolved.push(gap); continue; }
    const airport = matches[0]!;
    const day = days.find((item) => item.date === gap.date)!;
    const repaired = insertFlightAirport(day, movements, airport, places);
    if (!repaired) { unresolved.push(gap); continue; }
    days = days.map((item) => item.id === day.id ? repaired.day : item);
    movements = [...movements.filter((item) => item.dayId !== day.id || item.id !== repaired.replacedMovementId), ...repaired.newMovements];
  }
  const knownPlaceIds = new Set(blueprint.places.map((place) => place.id));
  const addedAirports = candidates.filter((place) => !knownPlaceIds.has(place.id) && days.some((day) => day.stops.some((stop) => stop.placeId === place.id)));
  return { blueprint: { ...blueprint, places: [...blueprint.places, ...addedAirports], days, movements }, unresolved };
}

function insertFlightAirport(day: BlueprintItineraryDay, movements: BlueprintMovement[], airport: BlueprintPlace, places: Map<string, BlueprintPlace>): { day: BlueprintItineraryDay; replacedMovementId: string; newMovements: BlueprintMovement[] } | undefined {
  const blocks = day.blocks ?? [];
  const flightIndex = blocks.findIndex((block) => block.kind === "transfer" && /\bflight\b|航班|飞机/iu.test(`${block.title ?? ""} ${block.role ?? ""}`));
  if (flightIndex < 0) return undefined;
  const before = blocks.slice(0, flightIndex).filter((block) => block.placeId).at(-1);
  const after = blocks.slice(flightIndex + 1).find((block) => block.placeId && isAirport(places.get(block.placeId)!));
  if (!before?.placeId || !after?.placeId) return undefined;
  const oldMovement = movements.find((item) => item.dayId === day.id && item.originPlaceId === before.placeId && item.destinationPlaceId === after.placeId);
  if (!oldMovement) return undefined;
  const addedBlocks = [
    { id: `${day.id}-to-departure-airport`, kind: "transfer" as const, order: 0, title: `Travel to ${airport.name}`, summary: `Travel from ${places.get(before.placeId)?.name ?? "the overnight base"} to the departure airport. Confirm the local transfer and flight check-in margin.`, role: "airport transfer", evidence: [] },
    { id: `${day.id}-departure-airport`, kind: "stop" as const, order: 0, placeId: airport.id, title: airport.name, summary: "Check in for the selected flight; exact service and baggage rules require confirmation.", role: "flight departure", evidence: airport.evidence ?? [] }
  ];
  const nextBlocks = [...blocks.slice(0, flightIndex), ...addedBlocks, ...blocks.slice(flightIndex)].map((block, index) => ({ ...block, order: index + 1 }));
  const retainedStops = day.stops.filter((stop) => stop.placeId !== airport.id);
  const arrivalStopIndex = retainedStops.findIndex((stop) => stop.placeId === after.placeId);
  if (arrivalStopIndex < 0) return undefined;
  const orderedStops = [...retainedStops];
  orderedStops.splice(arrivalStopIndex, 0, { placeId: airport.id, order: 0, role: "flight departure" });
  const nextStops = orderedStops.map((stop, index) => ({ ...stop, order: index + 1 }));
  const newMovements: BlueprintMovement[] = [
    { id: `${day.id}-movement-to-departure-airport`, dayId: day.id, originPlaceId: before.placeId, destinationPlaceId: airport.id, mode: "unknown", status: "recheck", label: `Transfer to ${airport.name}`, detail: "Local airport transfer and check-in buffer need a selected flight.", evidence: [] },
    { id: `${day.id}-movement-flight`, dayId: day.id, originPlaceId: airport.id, destinationPlaceId: after.placeId, mode: "flight", status: "recheck", label: `${airport.city ?? "Departure"} to ${places.get(after.placeId)?.city ?? "arrival"} flight`, detail: "Book and confirm the exact flight, baggage allowance, and arrival time.", evidence: oldMovement.evidence }
  ];
  return { day: { ...day, blocks: nextBlocks, stops: nextStops }, replacedMovementId: oldMovement.id, newMovements };
}

function isAirport(place: BlueprintPlace | undefined): boolean {
  return Boolean(place && !place.accommodation && !/\b(?:hotel|motel|lodge|hostel)\b/iu.test(place.category) && /\bairport\b|机场/iu.test(`${place.category} ${place.name}`));
}
