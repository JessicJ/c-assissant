import type { Plan, Task, TaskReminder } from "@c-assistant/core";
import { localDateTimeInstant } from "./arrival-reminder.js";

const REMINDER_CATCH_UP_MS = 30 * 60_000;
const TERMINAL_TASK_STATUSES = new Set<Task["status"]>(["completed", "skipped", "failed", "cancelled"]);

export interface DueTaskReminder {
  task: Task;
  reminder: TaskReminder;
  dueAt: Date;
  reminderKey: string;
}

/** Returns only confirmed-Plan reminders that are safe to attempt now. */
export function dueTaskReminders(plan: Plan, now = new Date()): DueTaskReminder[] {
  if (plan.status !== "active") return [];
  return plan.stages.flatMap((stage) => stage.tasks).flatMap((task) => {
    if (!task.reminder || task.activationTrigger === "arrival" || TERMINAL_TASK_STATUSES.has(task.status)) return [];
    const dueAt = localDateTimeInstant(task.reminder.scheduledAtLocal, task.reminder.timeZone);
    if (!dueAt) return [];
    const elapsed = now.getTime() - dueAt.getTime();
    if (elapsed < 0 || elapsed > REMINDER_CATCH_UP_MS) return [];
    return [{ task, reminder: task.reminder, dueAt, reminderKey: `task-reminder:${task.id}:${dueAt.toISOString()}` }];
  });
}

/** Builds current delivery copy from the confirmed Plan and Task, not a frozen draft message. */
export function formatTaskReminder(plan: Plan, task: Task): string {
  if (!task.reminder) throw new Error("A Task reminder is required.");
  return `Plan reminder\n${plan.title}\n\nTask: ${task.title}\nWhy now: ${task.reminder.purpose}\nCurrent status: ${task.status.replaceAll("_", " ")}\n\nOpen the current Plan or send /plan to review the full context. No booking, payment, ride, or external action has been started.`;
}
