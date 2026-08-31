import type { ConnectorResult, GeocodedPlaceFact, WeatherSnapshot } from "@c-assistant/connectors";
import { runWeatherAndPackingSkill } from "@c-assistant/china-country-pack";
import type { Plan, TaskReminder } from "@c-assistant/core";

interface ReminderWeatherDependencies {
  geocodeAddress(input: { address: string }): Promise<ConnectorResult<GeocodedPlaceFact>>;
  weather(input: { coordinates: string; locationName: string; adminArea?: string; country?: string; language?: "en" | "zh" }): Promise<ConnectorResult<WeatherSnapshot>>;
}

export interface TaskReminderWeatherContext {
  summary: string;
  retrievedAt: string;
  provider?: WeatherSnapshot["provider"];
  attributionUrl?: string;
}

export type TaskReminderWeatherRefresh =
  | { status: "available"; data: TaskReminderWeatherContext }
  | { status: "unavailable"; stage: "maps" | "weather"; code: string };

export function taskReminderNeedsWeather(reminder: TaskReminder): boolean {
  return reminder.refreshFacts?.includes("weather") ?? false;
}

/** Refreshes destination weather as optional delivery-time context; it never blocks the reminder itself. */
export async function refreshTaskReminderWeather(input: { plan: Plan; reminder: TaskReminder; language?: "en" | "zh"; dependencies: ReminderWeatherDependencies }): Promise<TaskReminderWeatherRefresh> {
  const placeResult = await input.dependencies.geocodeAddress({ address: input.plan.location });
  if (placeResult.status !== "available" || !placeResult.data) return { status: "unavailable", stage: "maps", code: placeResult.failure?.code ?? "location_unavailable" };
  const place = placeResult.data;
  const weatherResult = await input.dependencies.weather({
    coordinates: place.location,
    locationName: place.formattedAddress,
    adminArea: place.district || place.city || place.province,
    country: "",
    language: input.language ?? "en"
  });
  if (weatherResult.status !== "available" || !weatherResult.data) return { status: "unavailable", stage: "weather", code: weatherResult.failure?.code ?? "weather_unavailable" };

  const snapshot = weatherResult.data;
  const reminderDate = input.reminder.scheduledAtLocal.slice(0, 10);
  const skill = runWeatherAndPackingSkill({
    locationName: snapshot.location.name,
    current: snapshot.current,
    daily: snapshot.daily,
    retrievedAt: snapshot.retrievedAt,
    ...(snapshot.provider ? { provider: snapshot.provider } : {}),
    ...(snapshot.attributionUrl ? { attributionUrl: snapshot.attributionUrl } : {}),
    targetDate: reminderDate
  });
  if (skill.status === "failed") return { status: "unavailable", stage: "weather", code: "weather_skill_invalid" };
  const source = skill.sources[0];
  return { status: "available", data: { summary: skill.summary, retrievedAt: source?.observedAt ?? snapshot.retrievedAt, ...(snapshot.provider ? { provider: snapshot.provider } : {}), ...(source?.url ? { attributionUrl: source.url } : {}) } };
}
