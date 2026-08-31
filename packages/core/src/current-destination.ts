import type { ItineraryDay, PlanPresentation } from "./index.js";

export interface DestinationArrivalEvent {
  city: string;
  arrivedAt: string;
  confirmed: boolean;
}

export interface CurrentPlanDestination {
  city: string;
  dayId: string;
  basis: "confirmed_arrival" | "scheduled_stage" | "first_destination";
}

/**
 * Selects the destination whose current conditions should be shown for an
 * itinerary. Confirmed arrivals take precedence over schedule inference. When
 * the itinerary is still in the future (or has no machine-readable year), the
 * first destination remains active.
 */
export function resolveCurrentPlanDestination(
  presentation: PlanPresentation,
  input: { now?: Date; arrivals?: DestinationArrivalEvent[] } = {}
): CurrentPlanDestination | undefined {
  const allCityDays = presentation.days.filter((day): day is ItineraryDay & { city: string } => Boolean(day.city?.trim()));
  const destinationCities = new Set(allCityDays
    .filter((day) => day.placeIds.some((placeId) => {
      const place = presentation.places.find((candidate) => candidate.id === placeId);
      return place && !departureOnlyCategory(place.category);
    }))
    .map((day) => day.city.trim().toLocaleLowerCase()));
  // A departure airport is part of the journey, but not the destination whose
  // current weather should lead the trip. Fall back for transport-only plans.
  const days = destinationCities.size
    ? allCityDays.filter((day) => destinationCities.has(day.city.trim().toLocaleLowerCase()))
    : allCityDays;
  const first = days[0];
  if (!first) return undefined;

  const now = input.now ?? new Date();
  const nowMs = now.getTime();
  const confirmedArrival = (input.arrivals ?? [])
    .filter((arrival) => arrival.confirmed && Number.isFinite(Date.parse(arrival.arrivedAt)) && Date.parse(arrival.arrivedAt) <= nowMs)
    .sort((left, right) => Date.parse(right.arrivedAt) - Date.parse(left.arrivedAt))
    .find((arrival) => days.some((day) => sameCity(day.city, arrival.city)));
  if (confirmedArrival) {
    const reachedDay = [...days].reverse().find((day) => sameCity(day.city, confirmedArrival.city)) ?? first;
    return { city: reachedDay.city.trim(), dayId: reachedDay.id, basis: "confirmed_arrival" };
  }

  const datedDays = days.flatMap((day) => {
    const startsAt = itineraryDayStart(day, presentation.startDate);
    return startsAt === undefined ? [] : [{ day, startsAt }];
  });
  const active = datedDays
    .filter((candidate) => candidate.startsAt <= nowMs)
    .sort((left, right) => right.startsAt - left.startsAt)[0];
  if (active) return { city: active.day.city.trim(), dayId: active.day.id, basis: "scheduled_stage" };
  return { city: first.city.trim(), dayId: first.id, basis: "first_destination" };
}

function itineraryDayStart(day: ItineraryDay, planStartDate?: string): number | undefined {
  const raw = day.date?.trim() || day.shortLabel?.trim() || day.label.trim();
  const iso = raw.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));

  const startYear = planStartDate?.match(/^\s*(\d{4})-/)?.[1];
  if (!startYear) return undefined;
  const monthDay = raw.match(/\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2})\b/i);
  if (!monthDay) return undefined;
  const month = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(monthDay[1]!.slice(0, 3).toLowerCase());
  if (month < 0) return undefined;
  return Date.UTC(Number(startYear), month, Number(monthDay[2]));
}

function sameCity(left: string, right: string): boolean {
  return left.trim().localeCompare(right.trim(), undefined, { sensitivity: "accent" }) === 0;
}

function departureOnlyCategory(category: string): boolean {
  return /(transport|airport|rail|station|flight|transfer)/i.test(category.trim());
}
