import type {TravelBooking} from "./index.js";
import type {BlueprintBookingConstraint} from "./trip-blueprint.js";

export function blueprintBookingConstraintsFromTravelBookings(bookings: TravelBooking[]): BlueprintBookingConstraint[] {
  return bookings
    .map((booking): BlueprintBookingConstraint => ({
      id: `booking-${booking.id}`,
      sourceBookingId:booking.id,
      type: booking.type,
      title: booking.title,
      status: booking.status,
      sourceLabel: booking.sourceLabel,
      importedAt: booking.importedAt,
      constraintStrength: booking.constraintStrength,
      segments: booking.segments.map((segment) => ({
        id: `segment-${segment.id}`,
        sourceSegmentId:segment.id,
        status:segment.status,
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

