import type { Plan, TravelBooking } from "@c-assistant/core";
import type { ExecutionActivity } from "./execution-itinerary.js";
import type { DepartureDetails } from "./departure-assistance.js";
import { localDateTimeInstant } from "./arrival-reminder.js";

export function isAirportDepartureTransfer(plan: Plan, activity: ExecutionActivity): boolean {
  const place = plan.presentation?.places.find(place => place.id === activity.placeId);
  return Boolean(activity.isTransfer && place && /airport|机场/i.test(`${place.category} ${place.name}`)
    && !/flight|航班|飞机/i.test(`${activity.title} ${activity.role ?? ""}`));
}

/** Only a unique confirmed ticket can supply a departure time. Airport visit
 * times and their planned end times are never treated as ticket times. */
export function bookedAirportDeparture(plan: Plan, activity: ExecutionActivity, bookings: TravelBooking[]): DepartureDetails | undefined {
  const airport = plan.presentation?.places.find(place => place.id === activity.placeId);
  if (!airport) return;
  const aliases: Record<string, string> = { akl: "auckland", zqn: "queenstown", lax: "los angeles" };
  const normalized = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const airportName = normalized(airport.name), city = normalized(airport.city ?? activity.city);
  const matches = bookings.filter(booking => booking.status === "confirmed" && booking.type === "flight").flatMap(booking => booking.segments.map(segment => ({ booking, segment })))
    .filter(({segment}) => {
      const origin = normalized(segment.origin ?? "");
      return segment.segmentType === "flight_leg" && segment.status === "confirmed" && !segment.needsReviewReasons.length
        && segment.startAtLocal?.slice(0, 10) === activity.date && segment.startTimeZone
        && (origin === airportName || origin === city || aliases[origin] === city || origin.includes(airportName));
    });
  if (matches.length !== 1) return;
  const {segment: leg, booking} = matches[0]!;
  if (!localDateTimeInstant(leg.startAtLocal!, leg.startTimeZone!)) return;
  // Conservative planning allowance; the airline's own deadline takes priority.
  return { bookingId: booking.id, bookingUpdatedAt: booking.updatedAt, flightAtLocal: leg.startAtLocal!, timeZone: leg.startTimeZone!, airportLeadMinutes: 180, airlineTerminal: leg.title };
}
