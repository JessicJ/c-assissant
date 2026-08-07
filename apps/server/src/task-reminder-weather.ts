import type { AmapGeocodedPlace, ConnectorResult, QWeatherWeatherSnapshot } from "@c-assistant/connectors";
import type { Plan, TaskReminder } from "@c-assistant/core";

interface ReminderWeatherDependencies {
  geocodeAddress(input: { address: string }): Promise<ConnectorResult<AmapGeocodedPlace>>;
  weather(input: { coordinates: string; locationName: string; adminArea?: string; country?: string; language?: "en" | "zh" }): Promise<ConnectorResult<QWeatherWeatherSnapshot>>;
}

export interface TaskReminderWeatherContext {
  summary: string;
  retrievedAt: string;
  attributionUrl?: string;
}

export type TaskReminderWeatherRefresh =
  | { status: "available"; data: TaskReminderWeatherContext }
  | { status: "unavailable"; stage: "amap" | "qweather"; code: string };

export function taskReminderNeedsWeather(reminder: TaskReminder): boolean {
  return reminder.refreshFacts?.includes("weather") ?? false;
}

/** Refreshes destination weather as optional delivery-time context; it never blocks the reminder itself. */
export async function refreshTaskReminderWeather(input: { plan: Plan; reminder: TaskReminder; language?: "en" | "zh"; dependencies: ReminderWeatherDependencies }): Promise<TaskReminderWeatherRefresh> {
  const placeResult = await input.dependencies.geocodeAddress({ address: input.plan.location });
  if (placeResult.status !== "available" || !placeResult.data) return { status: "unavailable", stage: "amap", code: placeResult.failure?.code ?? "location_unavailable" };
  const place = placeResult.data;
  const weatherResult = await input.dependencies.weather({
    coordinates: place.location,
    locationName: place.formattedAddress,
    adminArea: place.district || place.city || place.province,
    country: "China",
    language: input.language ?? "en"
  });
  if (weatherResult.status !== "available" || !weatherResult.data) return { status: "unavailable", stage: "qweather", code: weatherResult.failure?.code ?? "weather_unavailable" };

  const snapshot = weatherResult.data;
  const reminderDate = input.reminder.scheduledAtLocal.slice(0, 10);
  const forecast = snapshot.daily.find((day) => day.date === reminderDate);
  const summary = forecast
    ? `${snapshot.location.name}: ${forecast.conditionDay}, ${forecast.lowC}–${forecast.highC}°C, forecast precipitation ${forecast.precipitationMm} mm.${weatherAdvice(forecast.conditionDay, forecast.precipitationMm, forecast.lowC, forecast.highC, forecast.uvIndex)} Forecast for ${forecast.date}; conditions may change.`
    : `${snapshot.location.name}: currently ${snapshot.current.condition}, ${snapshot.current.temperatureC}°C (feels like ${snapshot.current.feelsLikeC}°C), precipitation ${snapshot.current.precipitationMm} mm.${weatherAdvice(snapshot.current.condition, snapshot.current.precipitationMm, snapshot.current.temperatureC, snapshot.current.temperatureC, 0)} This is a current observation, not a forecast for the reminder date.`;
  const attributionUrl = approvedQWeatherAttribution(snapshot.attributionUrl);
  return { status: "available", data: { summary, retrievedAt: snapshot.retrievedAt, ...(attributionUrl ? { attributionUrl } : {}) } };
}

function weatherAdvice(condition: string, precipitationMm: number, lowC: number, highC: number, uvIndex: number): string {
  const advice: string[] = [];
  if (precipitationMm > 0 || /rain|storm|shower|snow|雨|雪|雷/i.test(condition)) advice.push(" Consider carrying rain or snow protection.");
  if (lowC <= 8) advice.push(" Consider a warm layer.");
  if (highC >= 30) advice.push(" Consider water and heat protection.");
  if (uvIndex >= 7) advice.push(" Consider sun protection.");
  return advice.join("");
}

function approvedQWeatherAttribution(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || (url.hostname !== "qweather.com" && !url.hostname.endsWith(".qweather.com"))) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}
