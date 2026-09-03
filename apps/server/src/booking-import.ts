import { createHash } from "node:crypto";
import type {
  BookingImportInput,
  BookingImportPreview,
  TravelBooking
} from "@c-assistant/core";
import { hasLikelyDuplicateBooking } from "./booking-import-duplicates.js";
import { createBookingFromImportedText } from "./booking-import-parser.js";
import { normalizeImportedBookingText } from "./booking-import-text.js";

export { normalizeAcceptedBooking } from "./booking-import-acceptance.js";
export { normalizeImportedBookingText } from "./booking-import-text.js";
export {
  blueprintBookingConstraintsFromTravelBookings,
  planningFactsFromBooking
} from "./booking-plan-sync.js";

type BookingScope = { planningSessionId?: string; planId?: string };

export function previewBookingImport(input: BookingImportInput, scope: BookingScope, dependencies: {
  hasTravelBookingSourceHash: (scope: BookingScope, sourceHash: string) => boolean;
  listExistingBookings: (scope: BookingScope) => TravelBooking[];
}): BookingImportPreview {
  const content = normalizeImportedBookingText(input?.content ?? "");
  if (!content) throw new Error("Paste or upload a booking confirmation before previewing it.");
  if (content.length > 80_000) throw new Error("Booking confirmation text is too large for the MVP importer.");
  const sourceHash = createHash("sha256").update(content).digest("hex");
  const sourceLabel = (input.sourceLabel?.trim() || "Imported booking confirmation").slice(0, 160);
  const duplicate = dependencies.hasTravelBookingSourceHash(scope, sourceHash);
  const booking = createBookingFromImportedText({ content, sourceHash, sourceLabel, scope });
  return { sourceHash, sourceLabel, duplicate, possibleDuplicate: !duplicate && hasLikelyDuplicateBooking(dependencies.listExistingBookings(scope), booking), bookings: [booking] };
}
