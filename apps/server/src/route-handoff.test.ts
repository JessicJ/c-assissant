import assert from "node:assert/strict";
import test from "node:test";

import { createPlanFromRequest } from "@c-assistant/core";
import { expectedArrivalAt, expectedHandoffState, formatExpectedArrivalGuidance } from "./route-handoff.js";

test("a handoff estimate adds waiting, route duration, and safety margin", () => {
  assert.equal(expectedArrivalAt({ basisAt: "2026-08-10T06:00:00.000Z", routeDurationSeconds: 35 * 60 }), "2026-08-10T06:55:00.000Z");
});

test("handoff states remain explicitly inferred", () => {
  const input = { basisAt: "2026-08-10T06:00:00.000Z", expectedArrivalAt: "2026-08-10T06:55:00.000Z", waitBufferSeconds: 600 };
  assert.equal(expectedHandoffState({ ...input, now: "2026-08-10T06:09:00.000Z" }), "expected_waiting");
  assert.equal(expectedHandoffState({ ...input, now: "2026-08-10T06:20:00.000Z" }), "expected_in_transit");
  assert.equal(expectedHandoffState({ ...input, now: "2026-08-10T06:55:00.000Z" }), "expected_arrived");
});

test("expected-arrival guidance discloses that arrival is not confirmed", () => {
  const plan = createPlanFromRequest({ request: "Arrive in Shanghai" });
  plan.configuration.accommodation = { status: "confirmed", name: "Riverside Hotel", address: "上海市静安区一号路 1 号", source: "user" };
  const text = formatExpectedArrivalGuidance(plan);
  assert.match(text, /approaching Riverside Hotel/);
  assert.match(text, /上海市静安区一号路 1 号/);
  assert.match(text, /does not mean Landi has confirmed/i);
});
