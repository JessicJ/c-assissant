import type {
  BookingSegment,
  TravelBooking,
  TravelBookingType
} from "@c-assistant/core";

export function hasLikelyDuplicateBooking(existing: TravelBooking[], candidate: TravelBooking): boolean {
  return existing.some((booking) => likelySameBooking(booking, candidate));
}

function likelySameBooking(left: TravelBooking, right: TravelBooking): boolean {
  if (left.type !== right.type) return false;
  return left.segments.some((leftSegment) => right.segments.some((rightSegment) => likelySameBookingSegment(left.type, leftSegment, rightSegment)));
}

function likelySameBookingSegment(type: TravelBookingType, left: BookingSegment, right: BookingSegment): boolean {
  const startMatches = Boolean(left.startAtLocal && right.startAtLocal && canonicalDuplicateText(left.startAtLocal) === canonicalDuplicateText(right.startAtLocal));
  const endMatches = Boolean(left.endAtLocal && right.endAtLocal && canonicalDuplicateText(left.endAtLocal) === canonicalDuplicateText(right.endAtLocal));
  const originMatches = duplicateTextMatches(left.origin, right.origin);
  const destinationMatches = duplicateTextMatches(left.destination, right.destination);
  const locationMatches = duplicateTextMatches(left.location, right.location);
  if (type === "flight" || type === "train") return startMatches && originMatches && destinationMatches;
  if (type === "accommodation") return startMatches && endMatches && locationMatches;
  if (type === "rental_car") return startMatches && (locationMatches || originMatches);
  return startMatches && (locationMatches || destinationMatches);
}

function duplicateTextMatches(left: string | undefined, right: string | undefined): boolean {
  if (!left || !right) return false;
  const a = canonicalDuplicateText(left);
  const b = canonicalDuplicateText(right);
  return a === b || (a.length >= 8 && b.length >= 8 && (a.includes(b) || b.includes(a)));
}

function canonicalDuplicateText(value: string): string {
  return value.toLocaleLowerCase().replace(/[^a-z0-9\u3400-\u9fffぁ-んァ-ヶー一-龠]+/g, "");
}
