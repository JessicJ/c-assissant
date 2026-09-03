import { createHash, randomUUID } from "node:crypto";
import type {
  BookingConstraintStrength,
  BookingSegment,
  TravelBooking,
  TravelBookingStatus,
  TravelBookingType
} from "@c-assistant/core";

type BookingScope = { planningSessionId?: string; planId?: string };

export function normalizeAcceptedBooking(input: TravelBooking | undefined, scope: BookingScope & { planVersionCreated?: number }): TravelBooking {
  if (!input) throw new Error("Choose a booking preview to accept.");
  const now = new Date().toISOString();
  const segments = (input.segments.length ? input.segments : [fallbackSegment(input.title)]).map((segment): BookingSegment => {
    const constraintStrength = normalizeConstraintStrength(segment.constraintStrength);
    const needsReviewReasons = [...new Set((segment.needsReviewReasons ?? []).map((reason) => reason.trim()).filter(Boolean))];
    if (constraintStrength === "hard" && !segmentHasStructuralAnchor(segment)) needsReviewReasons.push("Hard constraints need a usable time and location.");
    return {
      id: segment.id || randomUUID(),
      segmentType: normalizeSegmentType(segment.segmentType),
      title: segment.title?.trim().slice(0, 180) || input.title || "Imported booking segment",
      status: normalizeBookingStatus(segment.status),
      ...(segment.startAtLocal?.trim() ? { startAtLocal: segment.startAtLocal.trim().slice(0, 80) } : {}),
      ...(segment.startTimeZone?.trim() ? { startTimeZone: segment.startTimeZone.trim().slice(0, 80) } : {}),
      ...(segment.endAtLocal?.trim() ? { endAtLocal: segment.endAtLocal.trim().slice(0, 80) } : {}),
      ...(segment.endTimeZone?.trim() ? { endTimeZone: segment.endTimeZone.trim().slice(0, 80) } : {}),
      ...(segment.origin?.trim() ? { origin: segment.origin.trim().slice(0, 180) } : {}),
      ...(segment.destination?.trim() ? { destination: segment.destination.trim().slice(0, 180) } : {}),
      ...(segment.location?.trim() ? { location: segment.location.trim().slice(0, 240) } : {}),
      constraintStrength,
      fixedCommitment: constraintStrength === "hard",
      needsReviewReasons
    };
  });
  const status = segments.some((segment) => segment.needsReviewReasons.length) ? "needs_review" : normalizeBookingStatus(input.status);
  return {
    id: input.id || randomUUID(),
    ...scope,
    type: normalizeBookingType(input.type),
    status,
    title: input.title?.trim().slice(0, 180) || bookingTitleFromSegments(segments),
    ...(input.providerName?.trim() ? { providerName: input.providerName.trim().slice(0, 160) } : {}),
    source: input.source === "imported_email" || input.source === "imported_text" || input.source === "user" ? input.source : "imported_text",
    sourceHash: input.sourceHash?.trim() || createHash("sha256").update(JSON.stringify(input)).digest("hex"),
    sourceLabel: input.sourceLabel?.trim().slice(0, 160) || "Accepted booking import",
    importedAt: input.importedAt && Number.isFinite(Date.parse(input.importedAt)) ? input.importedAt : now,
    updatedAt: now,
    constraintStrength: normalizeConstraintStrength(input.constraintStrength),
    segments,
    ...(input.notes?.trim() ? { notes: input.notes.trim().slice(0, 2_000) } : {})
  };
}

function normalizeConstraintStrength(value: unknown): BookingConstraintStrength {
  return value === "hard" || value === "soft" || value === "ignored" ? value : "soft";
}

function normalizeBookingStatus(value: unknown): TravelBookingStatus {
  return value === "pending" || value === "confirmed" || value === "cancelled" || value === "needs_review" ? value : "needs_review";
}

function normalizeBookingType(value: unknown): TravelBookingType {
  return value === "accommodation" || value === "flight" || value === "train" || value === "rental_car" || value === "event" || value === "tour" || value === "ticket" || value === "restaurant" || value === "other" ? value : "other";
}

function normalizeSegmentType(value: unknown): BookingSegment["segmentType"] {
  return value === "flight_leg" || value === "train_leg" || value === "hotel_stay" || value === "rental_pickup" || value === "rental_return" || value === "event_window" || value === "other" ? value : "other";
}

function segmentHasStructuralAnchor(segment: BookingSegment): boolean {
  return Boolean((segment.startAtLocal || segment.endAtLocal) && (segment.location || segment.origin || segment.destination));
}

function fallbackSegment(title: string): BookingSegment {
  return { id: randomUUID(), segmentType: "other", title: title || "Imported booking", status: "needs_review", constraintStrength: "soft", fixedCommitment: false, needsReviewReasons: ["Booking details need review."] };
}

function bookingTitleFromSegments(segments: BookingSegment[]): string {
  return segments[0]?.title || "Imported booking";
}
