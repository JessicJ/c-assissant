import type { PlanningSession, TripBlueprint } from "@c-assistant/core";

const materializedDepartureNote = /(?:^|\s)Proposed departure from the overnight base at \d{2}:\d{2}; confirm the actual service and route before travel\.$/u;

export function missingProposedHotelDepartureDates(blueprint: TripBlueprint): string[] {
  return blueprint.days.flatMap((day) => {
    const blocks = [...(day.blocks ?? [])].sort((left, right) => left.order - right.order);
    if (blocks[0]?.kind !== "lodging" || !blocks[0].placeId) return [];
    const transfer = blocks.find((block, index) => index > 0 && block.kind === "transfer" && block.planRole !== "optional" && block.planRole !== "replacement");
    return transfer && !transfer.startTime ? [day.date] : [];
  });
}

/** Give every hotel-origin day a usable proposed leave time without claiming a service booking. */
export function materializeProposedHotelDepartures(blueprint: TripBlueprint, session: Pick<PlanningSession, "facts">): TripBlueprint {
  const next = structuredClone(blueprint);
  for (const day of next.days) {
    const blocks = [...(day.blocks ?? [])].sort((left, right) => left.order - right.order);
    if (blocks[0]?.kind !== "lodging" || !blocks[0].placeId) continue;
    const transfer = blocks.find((block, index) => index > 0 && block.kind === "transfer" && block.planRole !== "optional" && block.planRole !== "replacement");
    if (!transfer || (transfer.startTime && !materializedDepartureNote.test(transfer.summary ?? ""))) continue;
    const transferIndex = blocks.indexOf(transfer);
    let readyAt: number | undefined;
    for (const earlier of blocks.slice(0, transferIndex).filter((block) => block.planRole !== "optional" && block.planRole !== "replacement")) {
      if (isClock(earlier.endTime)) readyAt = Math.max(readyAt ?? 0, clockToMinutes(earlier.endTime));
      else if (isClock(earlier.startTime)) readyAt = Math.max(readyAt ?? 0, clockToMinutes(earlier.startTime)) + (earlier.durationMinutes ?? 0);
      else if (readyAt !== undefined && earlier.kind !== "lodging") readyAt += earlier.durationMinutes ?? 0;
    }
    const firstActivity = blocks.slice(transferIndex + 1).find((block) => !["transfer", "lodging", "flexible"].includes(block.kind) && block.planRole !== "optional" && block.planRole !== "replacement");
    // A later lunch/dinner cannot anchor departure when an untimed tour lies before it.
    // Its duration and operator departure still need to be chosen.
    const nextClock = isClock(transfer.endTime) ? transfer.endTime : isClock(firstActivity?.startTime) ? firstActivity.startTime : undefined;
    const departureFact = session.facts.find((fact) => fact.key === "departure" && fact.confirmed && fact.value.includes(day.date));
    const flightClock = departureFact?.value.match(/\b(?:[01]\d|2[0-3]):[0-5]\d\b/u)?.[0];
    const activityIndex = firstActivity ? blocks.indexOf(firstActivity) : blocks.length - 1;
    const beforeActivity = blocks.slice(transferIndex, activityIndex + 1);
    const changesBase = beforeActivity.some((block) => block.kind === "lodging" && block.placeId && block.placeId !== blocks[0]!.placeId);
    const endpoints = [blocks[0]!.placeId!, ...beforeActivity.flatMap((block) => block.placeId ? [block.placeId] : [])]
      .filter((id, index, ids) => index === 0 || id !== ids[index - 1]);
    const legs = endpoints.slice(1).map((destination, index) => (next.movements ?? []).find((movement) =>
      movement.dayId === day.id && movement.originPlaceId === endpoints[index] && movement.destinationPlaceId === destination));
    const blockMinutes = beforeActivity.filter((block) => block.kind === "transfer").reduce((sum, block) => sum + (block.durationMinutes ?? 0), 0);
    const movementMinutes = legs.reduce((sum, leg) => sum + (leg?.durationMinutes ?? 0), 0);
    const interveningMinutes = beforeActivity.slice(0, -1).filter((block) => block.kind !== "transfer")
      .reduce((sum, block) => sum + (block.durationMinutes ?? 0), 0);
    const localTransferMinutes = Math.max(45, blockMinutes, movementMinutes) + interveningMinutes;
    // Unknown travel between overnight bases is not a 45-minute local trip.
    // Keep a provisional morning departure until transport timing is researched.
    const unknownBaseTransfer = changesBase && !(transfer.durationMinutes && transfer.durationMinutes > 0)
      && !(legs[0]?.durationMinutes && legs[0].durationMinutes > 0);
    // The flight budget covers the whole remaining route, including an earlier
    // visit or luggage pickup before the airport, not only the first activity.
    const finalStopIndex = blocks.reduce((last, block, index) => block.kind === "stop" && block.planRole !== "optional" && block.planRole !== "replacement" ? index : last, -1);
    const flightRoute = blocks.slice(transferIndex, finalStopIndex >= transferIndex ? finalStopIndex + 1 : blocks.length)
      .filter(block => block.planRole !== "optional" && block.planRole !== "replacement");
    const flightEndpoints = [blocks[0]!.placeId!, ...flightRoute.flatMap(block => block.placeId ? [block.placeId] : [])]
      .filter((id, index, ids) => index === 0 || id !== ids[index - 1]);
    const flightMovementMinutes = flightEndpoints.slice(1).reduce((total, destination, index) => total + ((next.movements ?? []).find(movement =>
      movement.dayId === day.id && movement.originPlaceId === flightEndpoints[index] && movement.destinationPlaceId === destination)?.durationMinutes ?? 0), 0);
    const flightTransferMinutes = flightRoute.filter(block => block.kind === "transfer").reduce((total, block) => total + (block.durationMinutes ?? 0), 0);
    const flightActivityMinutes = flightRoute.slice(0, -1).filter(block => block.kind !== "transfer").reduce((total, block) => total + (block.durationMinutes ?? 0), 0);
    const airportLeadMinutes = Math.max(240, Math.max(flightMovementMinutes, flightTransferMinutes) + flightActivityMinutes + 180);
    const suggested = flightClock && day.date === next.endDate
      ? minutesToClock(Math.max(0, clockToMinutes(flightClock) - airportLeadMinutes))
      : nextClock && !unknownBaseTransfer
        ? minutesToClock(Math.max(6 * 60, clockToMinutes(nextClock) - localTransferMinutes))
        : "09:00";
    // Respect the preceding checkout, meal or other concrete sequence. An
    // automatically suggested time may be recomputed; supplied times stay fixed.
    const proposedMinutes = Math.max(clockToMinutes(suggested), readyAt ?? 0);
    if (proposedMinutes >= 24 * 60) continue;
    const proposed = minutesToClock(proposedMinutes);
    transfer.startTime = proposed;
    const summary = transfer.summary?.replace(materializedDepartureNote, "").trim();
    transfer.summary = `${summary ? `${summary} ` : ""}Proposed departure from the overnight base at ${proposed}; confirm the actual service and route before travel.`;
    day.blocks = blocks;
  }
  return next;
}

function isClock(value: string | undefined): value is string {
  return Boolean(value && /^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(value));
}

function clockToMinutes(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  return hour! * 60 + minute!;
}

function minutesToClock(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}
