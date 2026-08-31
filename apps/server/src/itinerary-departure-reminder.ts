import type { Plan, PlanPlace, PlanRouteSegment } from "@c-assistant/core";
import { localDateTimeInstant } from "./arrival-reminder.js";

const CATCH_UP_MS = 20 * 60_000;
const DEPARTURE_BUFFER_MINUTES = 10;
const KEY_STOP_ROLE = /(?:anchor|fixed|reservation|booked|arrival|departure|transport|flight|rail)/i;

export interface DueItineraryDepartureReminder {
  dayId: string;
  city: string;
  timeZone: string;
  place: PlanPlace;
  origin?: PlanPlace;
  route?: PlanRouteSegment;
  scheduledAt: Date;
  leaveAt: Date;
  scheduledTime: string;
  travelMinutes: number;
  reminderKey: string;
}

/**
 * Turns a formal itinerary into restrained mobile assistance. Only fixed or
 * reservation-sensitive stops are eligible; ordinary sightseeing stops do not
 * become notifications simply because they appear on the timeline.
 */
export function dueItineraryDepartureReminders(
  plan: Plan,
  timeZonesByCity: ReadonlyMap<string, string>,
  now = new Date()
): DueItineraryDepartureReminder[] {
  if (plan.status !== "active" || plan.presentation?.kind !== "itinerary") return [];
  const presentation = plan.presentation;
  const places = new Map(presentation.places.map((place) => [place.id, place] as const));
  const routes = new Map(presentation.routeSegments.filter((route) => route.dayId).map((route) => [
    `${route.dayId}\0${route.destinationPlaceId}`,
    route
  ] as const));

  return presentation.days.flatMap((day) => {
    const city = day.city?.trim();
    const timeZone = city ? timeZonesByCity.get(normalizeCity(city)) : undefined;
    if (!city || !timeZone || !/^\d{4}-\d{2}-\d{2}$/.test(day.date ?? "")) return [];

    return (day.stops ?? []).flatMap((stop, index) => {
      if (!/^\d{2}:\d{2}$/.test(stop.time ?? "")) return [];
      const place = places.get(stop.placeId);
      if (!place || !isKeyStop(place, stop.role)) return [];
      const route = routes.get(`${day.id}\0${stop.placeId}`);
      const firstStopTravel = index === 0 ? day.accommodationDeparture?.durationMinutes : undefined;
      const travelMinutes = route?.durationMinutes ?? firstStopTravel;
      if (!travelMinutes || travelMinutes < 1) return [];

      const scheduledAt = localDateTimeInstant(`${day.date}T${stop.time}`, timeZone);
      if (!scheduledAt) return [];
      const leaveAt = new Date(scheduledAt.getTime() - (travelMinutes + DEPARTURE_BUFFER_MINUTES) * 60_000);
      const elapsed = now.getTime() - leaveAt.getTime();
      if (elapsed < 0 || elapsed > CATCH_UP_MS) return [];
      const originId = route?.originPlaceId;
      const origin = originId ? places.get(originId) : undefined;
      return [{
        dayId: day.id,
        city,
        timeZone,
        place,
        ...(origin ? { origin } : {}),
        ...(route ? { route } : {}),
        scheduledAt,
        leaveAt,
        scheduledTime: stop.time!,
        travelMinutes,
        reminderKey: `itinerary-departure:${day.id}:${stop.placeId}:${scheduledAt.toISOString()}`
      }];
    });
  });
}

export function formatItineraryDepartureReminder(plan: Plan, item: DueItineraryDepartureReminder): string {
  const movement = item.route?.label?.trim() || `${modeLabel(item.route?.mode)} · about ${item.travelMinutes} min`;
  const origin = item.origin ? `From: ${item.origin.name}\n` : "";
  return `Landi itinerary reminder\n${plan.title}\n\nLeave by ${localClock(item.leaveAt, item.timeZone)}\nNext: ${item.place.name} at ${item.scheduledTime}\n${origin}Planned journey: ${movement}\n\nThis reminder is limited to a fixed or reservation-sensitive stop. No booking, ride, payment, or external action has been started.`;
}

export function itineraryPlaceMapUrl(place: PlanPlace): string | undefined {
  if (place.mapUrl?.startsWith("https://")) return place.mapUrl;
  const query = place.coordinates ? `${place.coordinates[0]},${place.coordinates[1]}` : `${place.name}, ${place.locationLabel}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

export function itineraryReminderCandidateCities(plan: Plan, now = new Date()): string[] {
  if (plan.status !== "active" || plan.presentation?.kind !== "itinerary") return [];
  const nearbyUtcDates = new Set([-1, 0, 1].map((offset) => new Date(now.getTime() + offset * 86_400_000).toISOString().slice(0, 10)));
  return [...new Set(plan.presentation.days
    .filter((day) => day.date && nearbyUtcDates.has(day.date) && day.city?.trim())
    .map((day) => day.city!.trim()))];
}

export function normalizeCity(city: string): string {
  return city.trim().toLocaleLowerCase("en-US");
}

function isKeyStop(place: PlanPlace, role?: string): boolean {
  return place.priority === "booked"
    || place.reservation?.requirement === "required"
    || place.reservation?.requirement === "recommended"
    || KEY_STOP_ROLE.test(role ?? "")
    || KEY_STOP_ROLE.test(place.visitRole ?? "");
}

function localClock(value: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(value);
}

function modeLabel(mode?: PlanRouteSegment["mode"]): string {
  if (mode === "walking") return "Walk";
  if (mode === "transit") return "Public transit";
  if (mode === "driving") return "Drive / taxi";
  if (mode === "rail") return "Rail";
  if (mode === "flight") return "Flight";
  return "Planned transfer";
}
