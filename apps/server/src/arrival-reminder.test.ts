import assert from "node:assert/strict";
import test from "node:test";

import { createPlanFromRequest } from "@c-assistant/core";
import { arrivalInstant, formatArrivalReminder, isArrivalReminderDue } from "./arrival-reminder.js";

test("an Asia/Shanghai arrival is converted to the correct UTC instant", () => {
  const due = arrivalInstant("2026-09-01T07:00", "Asia/Shanghai");
  assert.equal(due?.toISOString(), "2026-08-31T23:00:00.000Z");
});

test("arrival reminders are sent only within a short catch-up window", () => {
  const due = new Date("2026-09-01T00:00:00.000Z");
  assert.equal(isArrivalReminderDue(due, new Date("2026-09-01T00:15:00.000Z")), true);
  assert.equal(isArrivalReminderDue(due, new Date("2026-09-01T00:31:00.000Z")), false);
});

test("arrival reminder copy never claims that an external action started", () => {
  const message = formatArrivalReminder(createPlanFromRequest({ request: "I will arrive in Shanghai." }));
  assert.match(message, /No ride, booking, payment, or location request has been started/i);
});
