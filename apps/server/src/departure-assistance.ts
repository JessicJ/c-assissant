import type { Plan } from "@c-assistant/core";
import type { DailyWeatherForecast } from "@c-assistant/connectors";
import type { ConnectorBundle } from "./connector-bundle.js";
import { localDateTimeInstant } from "./arrival-reminder.js";
import type { ExecutionActivity } from "./execution-itinerary.js";

export interface DepartureDetails {
  bookingId?: string;
  bookingUpdatedAt?: string;
  flightAtLocal?: string;
  timeZone?: string;
  airlineTerminal?: string;
  airportLeadMinutes?: number;
  checkInCutoffMinutes?: number;
  pickup?: { address: string; latitude: number; longitude: number };
  pickupCandidate?: { address: string; latitude: number; longitude: number };
  pendingInput?: "flight" | "pickup";
  timing?: { leaveAt: string; airportAt: string; travelMinutes: number; bufferMinutes: number; checkedAt: string };
  routeAttemptAt?: string;
}
export type DepartureConnectors = Partial<Pick<ConnectorBundle, "maps" | "googleWeather">>;

export function departureWindow(details: DepartureDetails, travelMinutes: number) {
  const flight = details.flightAtLocal && details.timeZone ? localDateTimeInstant(details.flightAtLocal, details.timeZone) : undefined;
  if (!flight || !details.airportLeadMinutes || !Number.isFinite(travelMinutes) || travelMinutes <= 0) return undefined;
  const lead = Math.max(details.airportLeadMinutes, (details.checkInCutoffMinutes ?? 0) + 30);
  const bufferMinutes = Math.max(30, Math.ceil(travelMinutes * .3));
  const airportAt = new Date(flight.getTime() - lead * 60_000);
  return { airportAt: airportAt.toISOString(), leaveAt: new Date(airportAt.getTime() - (travelMinutes + bufferMinutes) * 60_000).toISOString(), travelMinutes, bufferMinutes };
}

export function departureClock(instant: string, zone: string) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: zone, month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(instant));
}

export async function refreshDepartureTiming(plan: Plan, flight: ExecutionActivity, details: DepartureDetails, connectors: DepartureConnectors, now: Date): Promise<void> {
  if (!details.pickup || !details.flightAtLocal || !details.timeZone || !connectors.maps) return;
  const airport = plan.presentation?.places.find(place => place.id === flight.placeId);
  if (!airport?.coordinates) return;
  // Refresh traffic close to departure; older route estimates must never silently remain authoritative.
  if (details.routeAttemptAt && now.getTime() - Date.parse(details.routeAttemptAt) < 15 * 60_000) return;
  details.routeAttemptAt = now.toISOString();
  const result = await connectors.maps.drivingRoute({ origin: `${details.pickup.longitude},${details.pickup.latitude}`, destination: `${airport.coordinates[1]},${airport.coordinates[0]}` });
  if (result.status !== "available" || !result.data?.durationSeconds || result.data.durationSeconds <= 0) return;
  const window = departureWindow(details, Math.ceil(result.data.durationSeconds / 60));
  if (window) details.timing = { ...window, checkedAt: now.toISOString() };
}

export async function departurePreparation(plan: Plan, flight: ExecutionActivity, details: DepartureDetails, connectors: DepartureConnectors, now: Date): Promise<string> {
  const airport = plan.presentation?.places.find(place => place.id === flight.placeId);
  const destinationDay = plan.presentation?.days.find(day => day.date && day.date > flight.date && day.city && day.city !== flight.city && day.placeIds.length);
  const destination = destinationDay && plan.presentation?.places.find(place => destinationDay.placeIds.includes(place.id) && place.coordinates);
  const forecasts: DailyWeatherForecast[] = [];
  const weather = await Promise.all([{ place: airport, date: flight.date }, { place: destination, date: destinationDay?.date }].map(async ({ place, date }) => {
    if (!place?.coordinates || !date || !connectors.googleWeather) return undefined;
    // Do not pass today's weather off as a forecast for a future trip.
    if (Date.parse(date) - now.getTime() > 3 * 86_400_000) return undefined;
    try {
      const response = await connectors.googleWeather.weather({ coordinates: `${place.coordinates[1]},${place.coordinates[0]}`, locationName: place.city ?? place.name, language: "en" });
      const forecast = response.status === "available" && response.data?.daily.find(day => day.date === date);
      if (forecast && forecast.conditionDay?.trim() && Number.isFinite(forecast.lowC) && Number.isFinite(forecast.highC)) { forecasts.push(forecast); return `${place.city} (${date}): ${forecast.conditionDay}, ${forecast.lowC}–${forecast.highC}°C.`; }
    } catch { /* The checklist remains useful when a provider is unavailable. */ }
    return undefined;
  }));
  const checklist = ["Passport and entry documents for everyone", "Tickets and boarding passes", "Phone, charger, power bank and travel adapter", "Regular medicines in your hand luggage", "Suitcases and a change of clothes in your carry-on"];
  if (forecasts.some(day => day.precipitationMm > 0)) checklist.push("A rain jacket or umbrella");
  if (forecasts.some(day => day.lowC < 15)) checklist.push("A warm layer for the cooler weather");
  const timing = details.timing && details.timeZone && now.getTime() - Date.parse(details.timing.checkedAt) <= 30 * 60_000 ? `Aim to reach the airport by ${departureClock(details.timing.airportAt, details.timeZone)}. Leave by ${departureClock(details.timing.leaveAt, details.timeZone)}: about ${details.timing.travelMinutes} minutes on the road, plus ${details.timing.bufferMinutes} minutes for traffic and pickup.` : undefined;
  const weatherLines = weather.filter((line): line is string => Boolean(line));
  const airline = details.airlineTerminal && !/still to confirm|pending|unknown|not confirmed|待确认|未知/i.test(details.airlineTerminal) ? details.airlineTerminal : undefined;
  const flightLine = details.flightAtLocal && details.timeZone && localDateTimeInstant(details.flightAtLocal, details.timeZone) ? `Flight: ${details.flightAtLocal.replace("T", " ")} (${details.timeZone})${airline ? `. ${airline}` : ""}.` : undefined;
  return [
    `Your trip is coming up! Let’s get a few things ready for your flight from ${airport?.name ?? flight.city}.`,
    ...(weatherLines.length ? [`Weather\n${weatherLines.join("\n")}`] : []),
    `Bring with you\n${checklist.map(item => `☐ ${item}`).join("\n")}`,
    flightLine,
    details.pickup?.address ? `Pickup: ${details.pickup.address}.` : undefined,
    timing
  ].filter(Boolean).join("\n\n");
}
