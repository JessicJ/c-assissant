import type { Plan } from "@c-assistant/core";

const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
export const ARRIVAL_LOCATION_FOLLOW_UP_DELAY_MS = 5 * 60_000;

/** Converts a Plan-local arrival time to an instant using its declared IANA zone. */
export function arrivalInstant(expectedAtLocal: string, timeZone: string): Date | undefined {
  const match = expectedAtLocal.match(LOCAL_DATE_TIME);
  if (!match) return undefined;
  const [, year, month, day, hour, minute] = match;
  const targetUtc = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), 0);
  if (!Number.isFinite(targetUtc)) return undefined;
  try {
    let instant = targetUtc - offsetAt(targetUtc, timeZone);
    instant = targetUtc - offsetAt(instant, timeZone);
    const local = localParts(instant, timeZone);
    if (!local || local.year !== Number(year) || local.month !== Number(month) || local.day !== Number(day) || local.hour !== Number(hour) || local.minute !== Number(minute)) return undefined;
    return new Date(instant);
  } catch {
    return undefined;
  }
}

export function isArrivalReminderDue(dueAt: Date, now = new Date()): boolean {
  const elapsed = now.getTime() - dueAt.getTime();
  return elapsed >= 0 && elapsed <= 30 * 60_000;
}

/** A location request is a follow-up, never part of the initial arrival notice. */
export function isArrivalLocationPromptDue(checkInSentAt: string, now = new Date()): boolean {
  const sentAt = Date.parse(checkInSentAt);
  if (!Number.isFinite(sentAt)) return false;
  return now.getTime() - sentAt >= ARRIVAL_LOCATION_FOLLOW_UP_DELAY_MS;
}

export function formatArrivalReminder(plan: Plan): string {
  return `Arrival check-in\n${plan.title}\n${plan.location}\n\nYour scheduled arrival time has begun. Open your current Plan to review the next step:\n${plan.nextAction}\n\nUse /plan for the Plan summary. No ride, booking, payment, or location request has been started.`;
}

function offsetAt(instant: number, timeZone: string): number {
  const local = localParts(instant, timeZone);
  if (!local) throw new Error("The expected arrival time zone is invalid.");
  return Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second) - instant;
}

function localParts(instant: number, timeZone: string): { year: number; month: number; day: number; hour: number; minute: number; second: number } | undefined {
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  const values = Object.fromEntries(formatter.formatToParts(new Date(instant)).filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
  if (![values.year, values.month, values.day, values.hour, values.minute, values.second].every(Number.isFinite)) return undefined;
  return { year: values.year!, month: values.month!, day: values.day!, hour: values.hour!, minute: values.minute!, second: values.second! };
}
