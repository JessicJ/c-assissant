import { createHash } from "node:crypto";
import type { Plan } from "@c-assistant/core";
import { localDateTimeInstant } from "./arrival-reminder.js";

export interface ExecutionActivity {
  id: string;
  dayId: string;
  date: string;
  city: string;
  title: string;
  placeId?: string;
  time?: string;
  durationMinutes?: number;
  travelMinutes?: number;
  needsMovement: boolean;
  role?: string;
  isTransfer?: boolean;
  preparation: string[];
  timeStatus?: "confirmed" | "planned" | "estimated" | "unknown" | "recheck";
}
export interface CompiledExecutionItinerary {
  planId: string;
  version: number;
  token: string;
  activities: ExecutionActivity[];
  gaps: string[];
}
export const executionToken = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 12);

/** Source-neutral execution adapter: generated and imported Plans share this contract. */
export function compileExecutionItinerary(plan: Plan): CompiledExecutionItinerary {
  const places = new Map(plan.presentation?.places.map(place => [place.id, place]));
  const gaps: string[] = [];
  const activities = (plan.presentation?.days ?? []).flatMap(day => {
    if (!day.date || !/^\d{4}-\d{2}-\d{2}$/.test(day.date) || !Number.isFinite(Date.parse(day.date)) || new Date(day.date).toISOString().slice(0, 10) !== day.date || !day.city?.trim()) { gaps.push(`${day.id}: date or city missing or invalid`); return []; }
    const blocks = day.blocks?.length ? [...day.blocks].sort((a, b) => a.order - b.order)
      .filter(block => !["optional", "replacement", "excluded"].includes(block.planRole ?? ""))
      : [...(day.stops?.length ? day.stops : day.placeIds.map((placeId, order) => ({ placeId, order })))].sort((a, b) => a.order - b.order)
        .map(stop => ({ id: `stop:${stop.order}:${stop.placeId}`, placeId: stop.placeId, startTime: "time" in stop ? stop.time as string | undefined : undefined, kind: "stop", title: undefined, durationMinutes: undefined, placeName: undefined }));
    let previous = day.startContext?.placeId;
    return blocks.flatMap(block => {
      const place = block.placeId ? places.get(block.placeId) : undefined;
      if (block.placeId && !place) gaps.push(`${day.id}:${block.id}: destination missing`);
      if (block.startTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(block.startTime)) gaps.push(`${day.id}:${block.id}: start time invalid`);
      // A morning base is a location anchor, not an action to reconfirm after overnight arrival.
      if ("role" in block && typeof block.role === "string" && /^morning base$/i.test(block.role)) {
        if (block.placeId) previous = block.placeId;
        return [];
      }
      const title = block.title ?? place?.name ?? block.placeName;
      if (!title) { gaps.push(`${day.id}:${block.id}: activity title missing`); return []; }
      const route = block.placeId ? plan.presentation?.routeSegments.find(route => route.dayId === day.id && route.destinationPlaceId === block.placeId && (!previous || route.originPlaceId === previous)) : undefined;
      const travelMinutes = route?.verification === "verified" ? route.durationMinutes : undefined;
      const isInternationalArrival = "role" in block && typeof block.role === "string" && block.role.toLowerCase() === "international arrival";
      const needsMovement = !isInternationalArrival && Boolean(block.placeId && block.placeId !== previous);
      const text = `${title} ${place?.category ?? ""} ${block.kind}`;
      const durationMinutes = block.durationMinutes ?? place?.durationMinutes;
      const preparation = /airport|flight|机场|航班/i.test(text) ? ["Check your passport, tickets, phone and luggage."]
        : /hotel|lodging|酒店|住宿/i.test(text) ? ["Check your luggage and belongings before changing accommodation."]
        : /walk|hike|track|outdoor|步道|徒步/i.test(text) ? ["Bring water and suitable footwear; check current weather."]
        : needsMovement ? ["Check your phone and personal belongings before leaving."] : [];
      if (block.placeId) previous = block.placeId;
      const activity: ExecutionActivity = { id: executionToken(`${day.id}:${block.id}`), dayId: day.id, date: day.date!, city: place?.city?.trim() || day.city!, title,
        ...(block.placeId ? { placeId: block.placeId } : {}), ...(block.startTime ? { time: block.startTime } : {}),
        ...(durationMinutes ? { durationMinutes } : {}),
        ...(travelMinutes ? { travelMinutes } : {}), needsMovement, preparation };
      if ("display" in block && block.display?.timingStatus) activity.timeStatus = block.display.timingStatus;
      if ("role" in block && typeof block.role === "string") activity.role = block.role;
      if (block.kind === "transfer") activity.isTransfer = true;
      if (!("role" in block) || block.role !== "outbound departure") return [activity];
      const previousDate = new Date(`${day.date}T12:00:00Z`);
      previousDate.setUTCDate(previousDate.getUTCDate() - 1);
      return [{ id: executionToken(`${day.id}:${block.id}:day-before`), dayId: `${day.id}-day-before`, date: previousDate.toISOString().slice(0, 10), city: day.city!, title: "Get ready for tomorrow's departure", role: "outbound day-before", needsMovement: false,
        preparation: ["Keep passports, tickets, phone and luggage together.", "Check your flight time, airline, terminal and baggage allowance.", "Choose your pickup location so I can help plan the airport journey."] }, activity];
    });
  });
  activities.sort((a, b) => a.date.localeCompare(b.date));
  return { planId: plan.id, version: plan.version, token: executionToken(`${plan.id}:${plan.version}`), activities, gaps };
}

export function activityDueAt(activity: ExecutionActivity, timeZone: string): Date | undefined {
  const start = localDateTimeInstant(`${activity.date}T${activity.time ?? "09:00"}`, timeZone);
  if (!start) return undefined;
  // Untimed activities use an explicitly estimated morning prompt, never an invented appointment.
  return new Date(start.getTime() - (activity.time ? (activity.travelMinutes ? activity.travelMinutes + 10 : 30) * 60_000 : 0));
}
