import type {
  BlueprintBookingConstraint,
  BookingSegment,
  PlanningFact,
  TravelBooking
} from "@c-assistant/core";

export function blueprintBookingConstraintsFromTravelBookings(bookings: TravelBooking[]): BlueprintBookingConstraint[] {
  return bookings
    .filter((booking) => booking.status !== "cancelled")
    .map((booking): BlueprintBookingConstraint => ({
      id: `booking-${booking.id}`,
      type: booking.type,
      title: booking.title,
      status: booking.status,
      sourceLabel: booking.sourceLabel,
      importedAt: booking.importedAt,
      constraintStrength: booking.constraintStrength,
      segments: booking.segments.map((segment) => ({
        id: `segment-${segment.id}`,
        segmentType: segment.segmentType,
        title: segment.title,
        ...(segment.startAtLocal ? { startAtLocal: segment.startAtLocal } : {}),
        ...(segment.startTimeZone ? { startTimeZone: segment.startTimeZone } : {}),
        ...(segment.endAtLocal ? { endAtLocal: segment.endAtLocal } : {}),
        ...(segment.endTimeZone ? { endTimeZone: segment.endTimeZone } : {}),
        ...(segment.origin ? { origin: segment.origin } : {}),
        ...(segment.destination ? { destination: segment.destination } : {}),
        ...(segment.location ? { location: segment.location } : {}),
        constraintStrength: segment.constraintStrength,
        fixedCommitment: segment.fixedCommitment,
        needsReviewReasons: [...segment.needsReviewReasons]
      }))
    }));
}

export function planningFactsFromBooking(booking: TravelBooking): PlanningFact[] {
  if (booking.status === "cancelled") return [];
  const timestamp = new Date().toISOString();
  const facts: PlanningFact[] = [];
  const usefulSegments = booking.segments.filter((segment) => segment.constraintStrength !== "ignored" && segment.status !== "cancelled");
  const dateValues = usefulSegments.flatMap((segment) => [dateOnly(segment.startAtLocal), dateOnly(segment.endAtLocal)]).filter((value): value is string => Boolean(value)).sort();
  if (dateValues.length) facts.push(planningFact("travel_dates", `${dateValues[0]} to ${dateValues[dateValues.length - 1]}`, timestamp));
  const accommodation = usefulSegments.find((segment) => segment.segmentType === "hotel_stay" && (segment.location || segment.destination));
  if (accommodation) {
    const location = accommodation.location ?? accommodation.destination!;
    facts.push(planningFact("accommodation", `${booking.title} at ${location}`, timestamp));
    facts.push(planningFact("destination", location, timestamp));
  }
  const transportSegments = usefulSegments.filter((segment) => segment.segmentType === "flight_leg" || segment.segmentType === "train_leg")
    .sort((left, right) => (left.startAtLocal ?? left.endAtLocal ?? "").localeCompare(right.startAtLocal ?? right.endAtLocal ?? ""));
  const firstTransport = transportSegments[0];
  if (firstTransport && (firstTransport.origin || firstTransport.destination || firstTransport.endAtLocal || firstTransport.startAtLocal)) {
    facts.push(planningFact("arrival", bookingSegmentTravelFact(firstTransport), timestamp));
    if (firstTransport.destination) facts.push(planningFact("destination", firstTransport.destination, timestamp));
  }
  const lastTransport = transportSegments.length > 1 ? transportSegments[transportSegments.length - 1] : undefined;
  if (lastTransport) facts.push(planningFact("departure", bookingSegmentTravelFact(lastTransport), timestamp));
  return facts;
}

function bookingSegmentTravelFact(segment: BookingSegment): string {
  return [
    segment.origin ? `Depart from ${segment.origin}` : "",
    segment.destination ? `arrive at ${segment.destination}` : "",
    segment.startAtLocal ? `start ${segment.startAtLocal}` : "",
    segment.endAtLocal ? `end ${segment.endAtLocal}` : ""
  ].filter(Boolean).join(", ");
}

function planningFact(key: string, value: string, updatedAt: string): PlanningFact {
  return { key, value, source: "inferred", confirmed: true, updatedAt };
}

function dateOnly(value: string | undefined): string | undefined {
  const iso = value?.match(/\b(20\d{2}-\d{2}-\d{2})\b/)?.[1];
  if (iso) return iso;
  const slash = value?.match(/\b(20\d{2})[\/.](\d{1,2})[\/.](\d{1,2})\b/) ?? value?.match(/\b(\d{1,2})[\/.](\d{1,2})[\/.](20\d{2})\b/);
  if (!slash) return undefined;
  if (slash[1]?.length === 4) return `${slash[1]}-${slash[2]!.padStart(2, "0")}-${slash[3]!.padStart(2, "0")}`;
  return `${slash[3]}-${slash[1]!.padStart(2, "0")}-${slash[2]!.padStart(2, "0")}`;
}
