import type { BlueprintPlace, TripBlueprint } from "@c-assistant/core";
import { isProvisionalDepartureTransfer } from "./departure-endpoint-completion.js";
import { accommodationMatchesCity } from "./accommodation-location.js";

const unselectedStay = /\b(?:hotel|accommodation|lodging).*(?:not selected|pending)\b/i;

export function materializeRecommendedAccommodationAnchors(blueprint: TripBlueprint): { blueprint: TripBlueprint; assignments: Array<{ date: string; hotel: string; placeId: string }> } {
  const next = structuredClone(blueprint);
  const assignments: Array<{ date: string; hotel: string; placeId: string }> = [];
  for (const day of next.days) {
    const assignedPlaceIds = new Set<string>();
    const candidates = next.places.filter((place) => place.accommodation?.state === "recommended"
      && accommodationMatchesCity(place, day.city));
    const hotel = [...candidates].sort((left, right) => accommodationScore(right) - accommodationScore(left) || left.name.localeCompare(right.name))[0];
    if (!hotel || !day.blocks?.length) continue;
    const hasUserStay = next.bookingConstraints?.some((constraint) => constraint.type === "accommodation" && constraint.status !== "cancelled" && constraint.segments.some((segment) =>
      segment.segmentType === "hotel_stay" && (!segment.startAtLocal || !segment.endAtLocal || (segment.startAtLocal.slice(0, 10) <= day.date && segment.endAtLocal.slice(0, 10) > day.date))
    ));
    if (hasUserStay) continue;
    for (const block of day.blocks) {
      if (block.kind !== "lodging" || block.placeId || !unselectedStay.test(`${block.title ?? ""} ${block.summary ?? ""}`)) continue;
      block.placeId = hotel.id;
      block.title = `Recommended stay: ${hotel.name}`;
      block.summary = "Suggested accommodation base; not booked. Confirm availability, price, and suitability before reserving.";
      assignments.push({ date: day.date, hotel: hotel.name, placeId: hotel.id });
      assignedPlaceIds.add(hotel.id);
    }
    if (!assignedPlaceIds.size) continue;
    const anchors = [...day.blocks]
      .sort((left, right) => left.order - right.order)
      .filter((block) => block.placeId && block.planRole !== "optional" && block.planRole !== "replacement" && block.kind !== "transfer" && block.kind !== "flexible")
      .map((block) => block.placeId!)
      .filter((placeId, index, all) => index === 0 || all[index - 1] !== placeId);
    for (let index = 0; index < anchors.length - 1; index += 1) {
      const originPlaceId = anchors[index]!;
      const destinationPlaceId = anchors[index + 1]!;
      if (!assignedPlaceIds.has(originPlaceId) && !assignedPlaceIds.has(destinationPlaceId)) continue;
      if (next.movements.some((movement) => movement.dayId === day.id && movement.originPlaceId === originPlaceId && movement.destinationPlaceId === destinationPlaceId)) continue;
      let id = `movement-${day.id}-recommended-stay-${index + 1}`;
      for (let suffix = 2; next.movements.some((movement) => movement.id === id); suffix += 1) id = `movement-${day.id}-recommended-stay-${index + 1}-${suffix}`;
      next.movements.push({ id, dayId: day.id, originPlaceId, destinationPlaceId, mode: "unknown", status: "recheck", detail: "Confirm route and travel time after choosing accommodation.", evidence: [] });
    }
  }
  materializeDailyAccommodationRoute(next);
  return { blueprint: next, assignments };
}

/** Carry the previous night's base into the next morning and close every stay day at its overnight base. */
function materializeDailyAccommodationRoute(blueprint: TripBlueprint): void {
  const places = new Map(blueprint.places.map((place) => [place.id, place] as const));
  for (const movement of blueprint.movements) {
    const origin = places.get(movement.originPlaceId);
    const destination = places.get(movement.destinationPlaceId);
    if (movement.mode !== "walking" || (movement.distanceMeters ?? 0) < 10_000 ||
      !((origin && isTransportCorridor(origin) && destination?.accommodation) || (destination && isTransportCorridor(destination) && origin?.accommodation))) continue;
    movement.mode = "unknown";
    movement.status = "recheck";
    movement.detail = "Use the confirmed arrival or departure terminal for the local hotel transfer; the whole intercity service is not a walking route.";
    movement.evidence = [];
    delete movement.label;
    delete movement.durationMinutes;
    delete movement.distanceMeters;
    delete movement.display;
  }
  let previousNightPlaceId: string | undefined;
  let previousNightPending = false;
  const orderedDays = [...blueprint.days].sort((left, right) => left.date.localeCompare(right.date));
  for (const [dayIndex, day] of orderedDays.entries()) {
    const blocks = day.blocks;
    if (!blocks?.length) {
      previousNightPlaceId = undefined;
      previousNightPending = false;
      continue;
    }
    blocks.sort((left, right) => left.order - right.order);
    const destinationCity = day.city.split(/\s+(?:and|to)\s+/i).at(-1)?.trim() ?? "";
    const nextDayAtSameBase = orderedDays[dayIndex + 1]?.city.trim().toLocaleLowerCase() === day.city.trim().toLocaleLowerCase();
    const lastStay = blocks.at(-1);
    const returnPlace = lastStay?.placeId ? places.get(lastStay.placeId) : undefined;
    const staleReturn = lastStay?.role === "overnight accommodation return" && returnPlace
      && !accommodationMatchesCity(returnPlace, destinationCity);
    if (nextDayAtSameBase && staleReturn) {
      const hotel = blueprint.places.find((place) => place.accommodation?.state === "recommended" && accommodationMatchesCity(place, destinationCity));
      if (hotel) {
        lastStay.placeId = hotel.id;
        lastStay.title = `Return to ${hotel.name}`;
        lastStay.summary = "This is the provisional overnight base; confirm the property and return route before travel.";
        if (day.endContext?.status === "recommended_property" || day.endContext?.status === "planned_base_pending_property") {
          day.endContext = { label: hotel.name, status: "recommended_property", placeId: hotel.id };
        }
      }
    }
    const last = blocks.at(-1);
    const departure = Boolean(last?.placeId && isDepartureNode(places.get(last.placeId)?.category, `${day.title} ${last.title ?? ""} ${last.role ?? ""}`))
      || Boolean(day.date === blueprint.endDate && last && isProvisionalDepartureTransfer(last));
    const userStay = blueprint.bookingConstraints?.some((constraint) => constraint.type === "accommodation" && constraint.status !== "cancelled" && constraint.segments.some((segment) =>
      segment.segmentType === "hotel_stay" && (!segment.startAtLocal || !segment.endAtLocal || (segment.startAtLocal.slice(0, 10) <= day.date && segment.endAtLocal.slice(0, 10) > day.date))
    ));
    const explicitNight = !departure ? [...blocks].reverse().find((block) => block.kind === "lodging" && block.placeId && places.has(block.placeId))?.placeId : undefined;
    const returningToBase = /\breturn\b.*\bbase\b|\bbase\b.*\breturn\b/i.test(`${last?.title ?? ""} ${last?.summary ?? ""}`);
    const previousBase = previousNightPlaceId ? places.get(previousNightPlaceId) : undefined;
    const remainsAtBase = returningToBase || Boolean(previousBase?.city && day.city.toLocaleLowerCase() === previousBase.city.toLocaleLowerCase());
    const researchedNight = !departure && !explicitNight && !remainsAtBase && !userStay
      ? blueprint.places.find((place) => place.accommodation?.state === "recommended" && accommodationMatchesCity(place, destinationCity ?? ""))?.id
      : undefined;
    const nightPlaceId = departure ? undefined : explicitNight ?? researchedNight ?? (remainsAtBase && !userStay ? previousNightPlaceId : undefined);
    const overnightTransit = day.endContext?.status === "in_transit" || /\b(?:overnight train|overnight bus|night flight|red-eye flight|in transit)\b/i.test(`${day.title} ${day.summary}`);
    const camping = /\b(?:camping|campground|tent)\b|露营|野营/i.test(`${day.title} ${day.summary} ${last?.title ?? ""}`);
    const pendingNight = !nightPlaceId && !userStay && !departure && !overnightTransit && !camping && day.date < blueprint.endDate;

    if (previousNightPlaceId && blocks[0]?.placeId !== previousNightPlaceId) {
      const hotel = places.get(previousNightPlaceId);
      if (hotel) blocks.unshift({
        id: accommodationBlockId(day.id, "departure", blocks), kind: "lodging", order: 0,
        placeId: hotel.id, title: `Depart from ${hotel.name}`,
        summary: "Use this overnight base as the provisional origin for the first transfer; refresh the route if the stay changes.",
        role: "morning accommodation departure", evidence: []
      });
    }
    if (previousNightPlaceId) {
      const hotel = places.get(previousNightPlaceId);
      const firstTransfer = blocks.find((block) => block.kind === "transfer" && block.order <= 2 && !block.placeId);
      if (hotel && firstTransfer && !firstTransfer.title?.includes(hotel.name)) {
        firstTransfer.title = firstTransfer.role === "first departure from base"
          ? `Depart from ${hotel.name}`
          : `Depart from ${hotel.name} · ${firstTransfer.title ?? "First transfer"}`;
      }
    }
    for (const block of blocks) {
      if (block.role === "morning accommodation departure") block.summary = "Use this overnight base as the provisional origin for the first transfer; refresh the route if the stay changes.";
    }
    if (previousNightPending && !previousNightPlaceId && !day.startContext) {
      day.startContext = { label: "Accommodation to select", status: "planned_base_pending_property" };
    }
    if (nightPlaceId && blocks.at(-1)?.placeId !== nightPlaceId) {
      const hotel = places.get(nightPlaceId);
      if (hotel) blocks.push({
        id: accommodationBlockId(day.id, "return", blocks), kind: "lodging", order: blocks.length + 1,
        placeId: hotel.id, title: `Return to ${hotel.name}`,
        summary: "This is the provisional overnight base; confirm the property and return route before travel.",
        role: "overnight accommodation return", evidence: []
      });
    }
    if (pendingNight && !(blocks.at(-1)?.kind === "lodging" && !blocks.at(-1)?.placeId)) {
      blocks.push({
        id: accommodationBlockId(day.id, "night-pending", blocks), kind: "lodging", order: blocks.length + 1,
        title: "Overnight accommodation to select", summary: "Choose an overnight base before this day can have a reliable return route or next-day departure reminder.",
        role: "overnight accommodation decision", evidence: []
      });
    }
    blocks.forEach((block, index) => { block.order = index + 1; });
    if (previousNightPlaceId && !day.startContext) {
      const hotel = places.get(previousNightPlaceId);
      if (hotel) day.startContext = { label: hotel.name, status: accommodationContextStatus(hotel), placeId: hotel.id };
    }
    if (nightPlaceId && !day.endContext) {
      const hotel = places.get(nightPlaceId);
      if (hotel) day.endContext = { label: hotel.name, status: accommodationContextStatus(hotel), placeId: hotel.id };
    }
    if (pendingNight && !day.endContext) day.endContext = { label: "Accommodation to select", status: "planned_base_pending_property" };
    const anchors = blocks
      .filter((block) => block.placeId && block.planRole !== "optional" && block.planRole !== "replacement" && block.kind !== "transfer" && block.kind !== "flexible")
      .map((block) => block.placeId!)
      .filter((placeId, index, all) => index === 0 || all[index - 1] !== placeId);
    for (let index = 0; index < anchors.length - 1; index += 1) {
      const originPlaceId = anchors[index]!;
      const destinationPlaceId = anchors[index + 1]!;
      if (originPlaceId !== previousNightPlaceId && destinationPlaceId !== nightPlaceId) continue;
      if (blueprint.movements.some((movement) => movement.dayId === day.id && movement.originPlaceId === originPlaceId && movement.destinationPlaceId === destinationPlaceId)) continue;
      blueprint.movements.push({
        id: accommodationBlockId(day.id, `route-${index + 1}`, blueprint.movements), dayId: day.id,
        originPlaceId, destinationPlaceId, mode: "unknown", status: "recheck",
        detail: "Confirm this accommodation transfer and travel time before setting a departure reminder.", evidence: []
      });
    }
    previousNightPlaceId = nightPlaceId;
    previousNightPending = pendingNight;
  }
  const validPairsByDay = new Map(blueprint.days.map((day) => {
    const anchors = (day.blocks ?? [])
      .filter((block) => block.placeId && block.planRole !== "optional" && block.planRole !== "replacement" && block.kind !== "transfer" && block.kind !== "flexible")
      .map((block) => block.placeId!)
      .filter((placeId, index, all) => index === 0 || all[index - 1] !== placeId);
    return [day.id, new Set(anchors.slice(0, -1).map((origin, index) => `${origin}\u0000${anchors[index + 1]}`))] as const;
  }));
  blueprint.movements = blueprint.movements.filter((movement) => !movement.id.includes("-accommodation-")
    || validPairsByDay.get(movement.dayId)?.has(`${movement.originPlaceId}\u0000${movement.destinationPlaceId}`));
}

function isTransportCorridor(place: BlueprintPlace): boolean {
  return /\b(?:ferry|rail|train|flight|coach)\b/i.test(place.category)
    && /\b(?:to|via)\b|[–—]/i.test(place.locationLabel ?? "");
}

function isDepartureNode(category: string | undefined, text: string): boolean {
  return /\b(?:airport|station|terminal|port)\b/i.test(category ?? "") && /\b(?:depart|departure|flight|fly out|leave)\b/i.test(text);
}

function accommodationContextStatus(place: BlueprintPlace): "confirmed_property" | "selected_property" | "recommended_property" {
  if (place.accommodation?.state === "confirmed") return "confirmed_property";
  if (place.accommodation?.state === "selected") return "selected_property";
  return "recommended_property";
}

function accommodationBlockId(dayId: string, suffix: string, items: Array<{ id: string }>): string {
  const base = `${dayId}-accommodation-${suffix}`;
  let id = base;
  for (let index = 2; items.some((item) => item.id === id); index += 1) id = `${base}-${index}`;
  return id;
}

function accommodationScore(place: BlueprintPlace): number {
  const priority = place.priority === "preferred" || place.priority === "must" ? 4 : place.priority === "nearby" ? 3 : place.priority === "pending" ? 1 : 2;
  const property = /\bhotel\b/i.test(place.category) ? 3 : /\b(motel|lodge)\b/i.test(place.category) ? 2 : 1;
  return priority + property;
}
