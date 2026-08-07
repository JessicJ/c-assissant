import assert from "node:assert/strict";
import test from "node:test";

import { createPlanFromDraft } from "@c-assistant/core";
import { dueTaskReminders, formatTaskReminder } from "./task-reminder.js";

function reminderPlan() {
  const plan = createPlanFromDraft({
    title: "Attend a Shanghai exhibition",
    location: "Shanghai, China",
    dates: "September 1, 2026",
    knownInformation: ["Flight departs at 07:00."],
    assumptions: [],
    nextAction: "Review the preparation Task.",
    stages: [{
      title: "Departure",
      description: "Prepare before leaving.",
      tasks: [{
        title: "Check essential items",
        owner: "user",
        dueLabel: "Two hours before departure",
        reminder: {
          scheduledAtLocal: "2026-09-01T05:00",
          timeZone: "Asia/Shanghai",
          purpose: "Check passport, travel documents, phone, and charger."
        }
      }]
    }]
  });
  return plan;
}

test("Task reminders remain inert while a Plan is still a draft", () => {
  assert.equal(dueTaskReminders(reminderPlan(), new Date("2026-08-31T21:00:00.000Z")).length, 0);
});

test("an active Task reminder is due only inside its short catch-up window", () => {
  const plan = reminderPlan();
  plan.status = "active";
  assert.equal(dueTaskReminders(plan, new Date("2026-08-31T21:10:00.000Z")).length, 1);
  assert.equal(dueTaskReminders(plan, new Date("2026-08-31T21:31:00.000Z")).length, 0);
});

test("terminal and arrival-specific Tasks do not produce generic reminders", () => {
  const plan = reminderPlan();
  plan.status = "active";
  const task = plan.stages[0]!.tasks[0]!;
  task.status = "completed";
  assert.equal(dueTaskReminders(plan, new Date("2026-08-31T21:00:00.000Z")).length, 0);
  task.status = "scheduled";
  task.activationTrigger = "arrival";
  assert.equal(dueTaskReminders(plan, new Date("2026-08-31T21:00:00.000Z")).length, 0);
});

test("Task reminder copy reads the current Task and preserves external-action boundaries", () => {
  const plan = reminderPlan();
  const task = plan.stages[0]!.tasks[0]!;
  const message = formatTaskReminder(plan, task);
  assert.match(message, /Check essential items/);
  assert.match(message, /Check passport, travel documents/);
  assert.match(message, /No booking, payment, ride, or external action has been started/);
});
