import type { TripBlueprint } from "@c-assistant/core";
import { accommodationMatchesCity } from "./accommodation-location.js";

/** A quality check for multi-day sightseeing plans, separate from schema integrity. */
export function sparseItineraryTimingDates(blueprint: TripBlueprint): string[] {
  const sightseeingDays = blueprint.days.filter((day) => day.kind === "scheduled" && day.stops.length > 0);
  if (sightseeingDays.length < 3) return [];
  const untimed = sightseeingDays.filter((day) => !day.blocks?.some((block) =>
    block.placeId && block.startTime && ["stop", "meal", "event"].includes(block.kind)
  ));
  return untimed.length > sightseeingDays.length / 2 ? untimed.map((day) => day.date) : [];
}

export function unselectedAccommodationDates(blueprint: TripBlueprint): string[] {
  return blueprint.days.flatMap((day, index) => {
    const hasSuppliedStay = blueprint.bookingConstraints?.some((constraint) => constraint.type === "accommodation" && constraint.status !== "cancelled" && constraint.segments.some((segment) =>
      segment.segmentType === "hotel_stay" && (!segment.startAtLocal || !segment.endAtLocal || (segment.startAtLocal.slice(0, 10) <= day.date && segment.endAtLocal.slice(0, 10) > day.date))
    ));
    if (hasSuppliedStay) return [];
    const city = day.city.trim().toLocaleLowerCase();
    const candidateIds = new Set(blueprint.places.filter((place) => place.accommodation?.state === "recommended" && accommodationMatchesCity(place, day.city)).map((place) => place.id));
    if (!candidateIds.size) return [];
    const placeholder = day.blocks?.some((block) => block.kind === "lodging" && !block.placeId && /\b(?:hotel|accommodation|lodging).*(?:not selected|pending)\b/i.test(`${block.title ?? ""} ${block.summary ?? ""}`));
    const firstDayAtBase = blueprint.days[index - 1]?.city.trim().toLocaleLowerCase() !== city;
    const staysOvernight = blueprint.days[index + 1]?.city.trim().toLocaleLowerCase() === city || placeholder;
    const recommendedInPlan = day.blocks?.some((block) => block.kind === "lodging" && block.placeId && candidateIds.has(block.placeId)) || (day.endContext?.status === "recommended_property" && day.endContext.placeId && candidateIds.has(day.endContext.placeId));
    return firstDayAtBase && staysOvernight && !recommendedInPlan ? [day.date] : [];
  });
}
