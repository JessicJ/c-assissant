import type { ItineraryDay, Plan, PlanPlace } from "@c-assistant/core";

export type NextPlannedStopResult =
  | { status: "selected"; planId: string; planVersion: number; day: ItineraryDay; place: PlanPlace; scheduledTime?: string; timing: "future" | "past_within_60" | "untimed"; degradedReasons: string[] }
  | { status: "stale_confirmation_required"; planId: string; planVersion: number; day: ItineraryDay; place: PlanPlace; scheduledTime: string; minutesStale: number; recoveryMessage: string }
  | { status: "blocked"; blockingReasons: string[]; recoveryMessage: string };

export function selectNextPlannedStop(plan: Plan, input: { now?: Date; localDate?: string; localTime?: string; timeZone?: string }): NextPlannedStopResult {
  if (plan.status !== "active") return blocked("no_execution_plan", "Send /go after you activate a Plan. Movement guidance only runs from the current Execution Plan.");
  if (!plan.presentation || plan.presentation.kind !== "itinerary") return blocked("missing_itinerary", "This Execution Plan does not have a structured itinerary, so Landi cannot choose a next planned stop.");
  const local = input.localDate && input.localTime ? { date: input.localDate, time: input.localTime } : localDateTime(input.now ?? new Date(), input.timeZone);
  const day = plan.presentation.days.find((candidate) => candidate.date === local.date) ?? (plan.presentation.days.length === 1 && !plan.presentation.days[0]!.date ? plan.presentation.days[0] : undefined);
  if (!day) return blocked("no_itinerary_day_for_today", "Landi could not match today to an itinerary day in the current Execution Plan. Open the Plan and confirm the travel date before using /go.");
  const placeById = new Map(plan.presentation.places.map((place) => [place.id, place] as const));
  const orderedStops = orderedDayStops(day);
  if (!orderedStops.length) return blocked("no_stops_today", "The current itinerary day has no scheduled stops for Landi to route toward.");
  const hasTimedStop = orderedStops.some((stop) => stop.time);
  if (!hasTimedStop) {
    if (orderedStops.length !== 1) return blocked("ambiguous_untimed_stops", "Today has multiple untimed stops, so Landi will not guess which one is next. Open the Plan and choose the stop you still intend to visit.");
    const place = placeById.get(orderedStops[0]!.placeId);
    if (!place) return blocked("missing_stop_place", "The next itinerary stop is missing its place details, so Landi cannot prepare movement guidance.");
    return { status: "selected", planId: plan.id, planVersion: plan.version, day, place, timing: "untimed", degradedReasons: ["untimed_stop_selected_by_clear_itinerary_order"] };
  }
  for (const stop of orderedStops) {
    if (!stop.time) return blocked("ambiguous_mixed_timing", "Today mixes timed and untimed stops before Landi can safely decide what comes next. Open the Plan and review the itinerary order.");
    const place = placeById.get(stop.placeId);
    if (!place) return blocked("missing_stop_place", "The next itinerary stop is missing its place details, so Landi cannot prepare movement guidance.");
    const diff = minutesOfDay(stop.time) - minutesOfDay(local.time);
    if (diff >= 0) return { status: "selected", planId: plan.id, planVersion: plan.version, day, place, scheduledTime: stop.time, timing: "future", degradedReasons: [] };
    if (diff >= -60) return { status: "selected", planId: plan.id, planVersion: plan.version, day, place, scheduledTime: stop.time, timing: "past_within_60", degradedReasons: ["planned_time_within_past_60_minutes"] };
    return { status: "stale_confirmation_required", planId: plan.id, planVersion: plan.version, day, place, scheduledTime: stop.time, minutesStale: Math.abs(diff), recoveryMessage: `The next planned stop, ${place.name}, was scheduled for ${stop.time}. Confirm you still want to go there before Landi asks for your current location.` };
  }
  return blocked("no_remaining_stop", "Landi could not find a remaining planned stop for today. Open the Plan to review what should happen next.");
}

function orderedDayStops(day: ItineraryDay): Array<{ placeId: string; time?: string }> {
  if (day.stops?.length) return [...day.stops].sort((left, right) => left.order - right.order).map((stop) => ({ placeId: stop.placeId, ...(stop.time ? { time: stop.time } : {}) }));
  return day.placeIds.map((placeId) => ({ placeId }));
}

function blocked(reason: string, recoveryMessage: string): NextPlannedStopResult {
  return { status: "blocked", blockingReasons: [reason], recoveryMessage };
}

function minutesOfDay(time: string): number {
  const match = time.match(/^(\d{2}):(\d{2})$/);
  if (!match) return 0;
  return Number(match[1]) * 60 + Number(match[2]);
}

function localDateTime(now: Date, timeZone?: string): { date: string; time: string } {
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: timeZone || "UTC", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
  const parts = new Map(formatter.formatToParts(now).map((part) => [part.type, part.value] as const));
  return { date: `${parts.get("year")}-${parts.get("month")}-${parts.get("day")}`, time: `${parts.get("hour")}:${parts.get("minute")}` };
}
