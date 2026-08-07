import assert from "node:assert/strict";
import test from "node:test";

import { createPlanFromRequest } from "@c-assistant/core";
import { ARRIVAL_LOCATION_FOLLOW_UP_DELAY_MS, arrivalInstant, formatArrivalReminder, isArrivalLocationPromptDue, isArrivalReminderDue } from "./arrival-reminder.js";

test("an Asia/Shanghai arrival is converted to the correct UTC instant", () => {
  const due = arrivalInstant("2026-09-01T07:00", "Asia/Shanghai");
  assert.equal(due?.toISOString(), "2026-08-31T23:00:00.000Z");
});

test("arrival reminders are sent only within a short catch-up window", () => {
  const due = new Date("2026-09-01T00:00:00.000Z");
  assert.equal(isArrivalReminderDue(due, new Date("2026-09-01T00:15:00.000Z")), true);
  assert.equal(isArrivalReminderDue(due, new Date("2026-09-01T00:31:00.000Z")), false);
});

test("arrival location sharing is a five-minute follow-up after no response", () => {
  const sentAt = "2026-09-01T00:00:00.000Z";
  assert.equal(isArrivalLocationPromptDue(sentAt, new Date("2026-09-01T00:04:59.999Z")), false);
  assert.equal(ARRIVAL_LOCATION_FOLLOW_UP_DELAY_MS, 5 * 60_000);
  assert.equal(isArrivalLocationPromptDue(sentAt, new Date("2026-09-01T00:05:00.000Z")), true);
});

test("arrival reminder copy never claims that an external action started", () => {
  const message = formatArrivalReminder(createPlanFromRequest({ request: "I will arrive in Shanghai." }));
  assert.match(message, /No ride, booking, payment, or location request has been started/i);
});

test("arrival reminder distinguishes a ready task from a completed task", () => {
  const plan = createPlanFromRequest({ request: "I will arrive in Shanghai." });
  const task = plan.stages[2]?.tasks[0];
  assert.ok(task);
  const message = formatArrivalReminder(plan, { ...task, status: "ready" });
  assert.match(message, /Current step is ready/i);
  assert.match(message, /not marked complete/i);
});
