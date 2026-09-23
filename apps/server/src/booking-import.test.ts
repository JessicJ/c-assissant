import assert from "node:assert/strict";
import test from "node:test";
import type { TravelBooking } from "@c-assistant/core";
import {
  blueprintBookingConstraintsFromTravelBookings,
  normalizeImportedBookingText,
  planningFactsFromBooking,
  previewBookingImport
} from "./booking-import.js";

test("booking import text normalization removes unsafe HTML while preserving readable facts", () => {
  const text = normalizeImportedBookingText(`
    <html><head><style>.x{display:none}</style><script>alert("x")</script></head>
    <body><h1>Hotel Example</h1><p>Check-in: 2026-10-05</p><p>Address: Kyoto Station</p></body></html>
  `);

  assert.match(text, /Hotel Example/);
  assert.match(text, /Check-in: 2026-10-05/);
  assert.match(text, /Address: Kyoto Station/);
  assert.doesNotMatch(text, /alert/);
  assert.doesNotMatch(text, /display:none/);
});

test("booking import text normalization reads the best non-attachment MIME part", () => {
  const text = normalizeImportedBookingText([
    "Content-Type: multipart/mixed; boundary=abc",
    "",
    "--abc",
    "Content-Type: text/plain",
    "Content-Transfer-Encoding: quoted-printable",
    "",
    "Hotel & Spa=0ACheck-in: 2026-10-05",
    "--abc",
    "Content-Type: text/plain",
    "Content-Disposition: attachment; filename=secret.txt",
    "",
    "Do not import this attachment",
    "--abc--"
  ].join("\n"));

  assert.match(text, /Hotel & Spa/);
  assert.match(text, /Check-in: 2026-10-05/);
  assert.doesNotMatch(text, /Do not import this attachment/);
});

test("booking preview marks source-hash duplicates without exposing confirmation codes", () => {
  const content = [
    "Subject: Example Hotel Booking",
    "Hotel Example",
    "Check-in: 2026-10-05",
    "Check-out: 2026-10-07",
    "Address: 1 Hotel Road, Kyoto",
    "Confirmation code: ABCD12345"
  ].join("\n");
  const preview = previewBookingImport({ content, sourceLabel: "hotel.eml" }, {}, {
    hasTravelBookingSourceHash: () => true,
    listExistingBookings: () => []
  });

  assert.equal(preview.duplicate, true);
  assert.equal(preview.possibleDuplicate, false);
  assert.equal(preview.bookings[0]?.type, "accommodation");
  assert.equal(preview.bookings[0]?.notes, "Confirmation code detected and kept out of generation context.");
});

test("booking preview extracts flight transport endpoints and dates", () => {
  const preview = previewBookingImport({
    sourceLabel: "flight.txt",
    content: [
      "Flight: UA123",
      "Departure: 2026-10-05 09:30",
      "Arrival: 2026-10-05 13:00",
      "From: SFO",
      "To: HND"
    ].join("\n")
  }, {}, { hasTravelBookingSourceHash: () => false, listExistingBookings: () => [] });

  assert.equal(preview.bookings[0]?.type, "flight");
  assert.equal(preview.bookings[0]?.segments.length, 1);
  assert.equal(preview.bookings[0]?.segments[0]?.startAtLocal, "2026-10-05T09:30");
  assert.equal(preview.bookings[0]?.segments[0]?.origin, "SFO");
  assert.equal(preview.bookings[0]?.segments[0]?.destination, "HND");
});

test("accepted booking normalization downgrades hard constraints without anchors to review", async () => {
  const { normalizeAcceptedBooking } = await import("./booking-import.js");
  const booking = normalizeAcceptedBooking({
    id: "booking-1",
    type: "ticket",
    status: "confirmed",
    title: "Museum ticket",
    source: "imported_text",
    sourceHash: "hash",
    sourceLabel: "ticket.txt",
    importedAt: "2026-08-07T00:00:00.000Z",
    updatedAt: "2026-08-07T00:00:00.000Z",
    constraintStrength: "hard",
    segments: [{
      id: "segment-1",
      segmentType: "event_window",
      title: "Museum slot",
      status: "confirmed",
      constraintStrength: "hard",
      fixedCommitment: true,
      needsReviewReasons: []
    }]
  }, { planId: "plan-1", planVersionCreated: 4 });

  assert.equal(booking.status, "needs_review");
  assert.equal(booking.planId, "plan-1");
  assert.equal(booking.planVersionCreated, 4);
  assert.deepEqual(booking.segments[0]?.needsReviewReasons, ["Hard constraints need a usable time and location."]);
});

test("booking constraints omit cancelled bookings and preserve segment review state", () => {
  const confirmed = bookingFixture({
    id: "booking-active",
    title: "Kyoto hotel",
    status: "confirmed",
    segments: [{
      id: "stay-1",
      segmentType: "hotel_stay",
      title: "Hotel stay",
      status: "needs_review",
      startAtLocal: "2026-10-05",
      endAtLocal: "2026-10-07",
      location: "Kyoto Station",
      constraintStrength: "soft",
      fixedCommitment: false,
      needsReviewReasons: ["Checkout date needs review."]
    }]
  });
  const constraints = blueprintBookingConstraintsFromTravelBookings([
    confirmed,
    bookingFixture({ id: "booking-cancelled", status: "cancelled" })
  ]);

  assert.equal(constraints.length, 1);
  assert.equal(constraints[0]?.id, "booking-booking-active");
  assert.equal(constraints[0]?.segments[0]?.id, "segment-stay-1");
  assert.deepEqual(constraints[0]?.segments[0]?.needsReviewReasons, ["Checkout date needs review."]);
});

test("planning facts from booking use active transport legs for arrival and departure", () => {
  const booking = bookingFixture({
    type: "flight",
    title: "Japan flights",
    segments: [{
      id: "arrival-leg",
      segmentType: "flight_leg",
      title: "Outbound",
      status: "confirmed",
      startAtLocal: "2026-10-05",
      endAtLocal: "2026-10-05",
      origin: "SFO",
      destination: "HND",
      constraintStrength: "hard",
      fixedCommitment: true,
      needsReviewReasons: []
    }, {
      id: "ignored-leg",
      segmentType: "flight_leg",
      title: "Ignored",
      status: "confirmed",
      startAtLocal: "2026-10-06",
      origin: "HND",
      destination: "ITM",
      constraintStrength: "ignored",
      fixedCommitment: false,
      needsReviewReasons: []
    }, {
      id: "departure-leg",
      segmentType: "flight_leg",
      title: "Return",
      status: "confirmed",
      startAtLocal: "2026-10-12",
      origin: "HND",
      destination: "SFO",
      constraintStrength: "hard",
      fixedCommitment: true,
      needsReviewReasons: []
    }]
  });

  const facts = planningFactsFromBooking(booking);

  assert.equal(facts.find((fact) => fact.key === "travel_dates")?.value, "2026-10-05 to 2026-10-12");
  assert.equal(facts.find((fact) => fact.key === "arrival")?.value, "Depart from SFO, arrive at HND, start 2026-10-05, end 2026-10-05");
  assert.equal(facts.find((fact) => fact.key === "departure")?.value, "Depart from HND, arrive at SFO, start 2026-10-12");
  assert.equal(facts.some((fact) => fact.key === "destination"), false);
});

test("accommodation booking facts preserve the address without promoting it to trip destination", () => {
  const facts = planningFactsFromBooking(bookingFixture({
    title: "Porto hotel",
    segments: [{
      id: "stay",
      segmentType: "hotel_stay",
      title: "Porto stay",
      status: "confirmed",
      startAtLocal: "2026-11-10T15:00",
      endAtLocal: "2026-11-12T11:00",
      location: "Praca da Batalha, Porto, Portugal",
      constraintStrength: "hard",
      fixedCommitment: true,
      needsReviewReasons: []
    }]
  }));

  assert.equal(facts.find((fact) => fact.key === "accommodation_location")?.value, "Praca da Batalha, Porto, Portugal");
  assert.equal(facts.some((fact) => fact.key === "destination"), false);
});

function bookingFixture(overrides: Partial<TravelBooking> = {}): TravelBooking {
  return {
    id: "booking-1",
    type: "accommodation",
    status: "confirmed",
    title: "Booking",
    source: "imported_text",
    sourceHash: "hash",
    sourceLabel: "booking.txt",
    importedAt: "2026-08-07T00:00:00.000Z",
    updatedAt: "2026-08-07T00:00:00.000Z",
    constraintStrength: "hard",
    segments: [],
    ...overrides
  };
}
