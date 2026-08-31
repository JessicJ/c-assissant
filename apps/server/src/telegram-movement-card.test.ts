import assert from "node:assert/strict";
import test from "node:test";

import { formatTelegramMovementStaleConfirmation, parseTelegramMovementGoStaleCallback } from "./telegram-movement-card.js";

test("stale /go callback preserves the exact version-bound stop id", () => {
  const result = formatTelegramMovementStaleConfirmation({
    status: "stale_confirmation_required",
    planId: "plan-00000000-0000-4000-8000-000000000000",
    planVersion: 3,
    day: { id: "day", label: "Day", placeIds: ["stop/with spaces"] },
    place: { id: "stop/with spaces", name: "Temple", locationLabel: "Bali", category: "sight", priority: "must", whyWorthIt: "Visit", plan: "Visit", detailSections: [], sourceRefs: [] },
    scheduledTime: "09:00",
    minutesStale: 80,
    recoveryMessage: "Confirm."
  });
  const inline = "inline_keyboard" in result.replyMarkup ? result.replyMarkup.inline_keyboard : undefined;
  const button = inline?.[0]?.[0];
  const callback = button && "callback_data" in button ? button.callback_data : undefined;
  assert.deepEqual(parseTelegramMovementGoStaleCallback(callback), { planId: "plan-00000000-0000-4000-8000-000000000000", version: 3, stopId: "stop/with spaces" });
});
