import type { AmapGeocodedPlace, ConnectorResult, ConnectorStatus } from "@c-assistant/connectors";
import { runWeatherAndPackingSkill } from "@c-assistant/china-country-pack";
import { isAmapBasicWeather, type UserWeatherSnapshot } from "./user-weather.js";

interface TelegramWeatherDependencies {
  geocodeAddress(input: { address: string }): Promise<ConnectorResult<AmapGeocodedPlace>>;
  weather(input: { coordinates: string; locationName: string; adcode?: string; adminArea?: string; country?: string; language?: "en" | "zh" }): Promise<ConnectorResult<UserWeatherSnapshot>>;
}

export type TelegramPlanWeatherResult =
  | { status: "available"; data: UserWeatherSnapshot }
  | { status: "unavailable"; stage: "plan" | "amap" | "weather"; connectorStatus?: Exclude<ConnectorStatus, "available">; code: string; message: string };

export async function fetchTelegramPlanWeather(input: { location: string; language?: "en" | "zh"; dependencies: TelegramWeatherDependencies }): Promise<TelegramPlanWeatherResult> {
  const location = input.location.trim();
  if (!location || /to be confirmed|unknown location/i.test(location)) return { status: "unavailable", stage: "plan", code: "location_missing", message: "Confirm the current Plan location before checking weather." };
  const placeResult = await input.dependencies.geocodeAddress({ address: location });
  if (placeResult.status !== "available" || !placeResult.data) return unavailable("amap", placeResult, "Amap could not resolve the current Plan location.");
  const place = placeResult.data;
  const weatherResult = await input.dependencies.weather({
    coordinates: place.location,
    locationName: place.formattedAddress,
    ...(place.adcode ? { adcode: place.adcode } : {}),
    adminArea: place.district || place.city || place.province,
    country: "China",
    language: input.language ?? "en"
  });
  if (weatherResult.status !== "available" || !weatherResult.data) return unavailable("weather", weatherResult, "Neither QWeather nor Amap could provide current facts for this Plan location.");
  return { status: "available", data: weatherResult.data };
}

export function formatTelegramWeather(snapshot: UserWeatherSnapshot): string {
  if (isAmapBasicWeather(snapshot)) {
    const forecasts = snapshot.daily.map((day) => `${day.date}: ${day.conditionDay} / ${day.conditionNight}, ${day.lowC}–${day.highC}°C`).join("\n");
    const current = snapshot.current;
    return `Basic weather for ${snapshot.location.name}\nCurrent observation: ${current.condition}, ${current.temperatureC}°C\nHumidity: ${current.humidityPercent}%${current.windDirection ? ` · wind: ${current.windDirection}${current.windScale ? ` scale ${current.windScale}` : ""}` : ""}\nObserved: ${current.observedAt}\n\nBasic forecast\n${forecasts}\n\nSource: Amap — ${snapshot.attributionUrl}\nLimit: ${snapshot.limitations.join(" ")}\n\nWeather changes. This fallback does not create a reminder, alter your Plan, or produce packing and transport advice.`;
  }
  const current = snapshot.current;
  const forecasts = snapshot.daily.map((day) => `${day.date}: ${day.conditionDay} / ${day.conditionNight}, ${day.lowC}–${day.highC}°C, precipitation ${day.precipitationMm} mm, UV ${day.uvIndex}`).join("\n");
  const skill = runWeatherAndPackingSkill({ locationName: snapshot.location.name, current, daily: snapshot.daily, retrievedAt: snapshot.retrievedAt, ...(snapshot.attributionUrl ? { attributionUrl: snapshot.attributionUrl } : {}) });
  const advice = skill.status === "failed" ? "No packing prompt was produced because the weather facts failed validation." : skill.recommendations.length ? skill.recommendations.map((item) => item.text).join(" ") : "No rain, cold, heat, or high-UV packing prompt is indicated by these returned facts.";
  const attribution = skill.sources[0]?.url;
  return `Weather for ${snapshot.location.name}\nCurrent observation: ${current.condition}, ${current.temperatureC}°C (feels like ${current.feelsLikeC}°C)\nHumidity: ${current.humidityPercent}% · precipitation: ${current.precipitationMm} mm${current.windDirection ? ` · wind: ${current.windDirection}${current.windScale ? ` scale ${current.windScale}` : ""}` : ""}\nObserved: ${current.observedAt}\n\n3-day forecast\n${forecasts}\n\nPractical check: ${advice}\nRetrieved: ${snapshot.retrievedAt}\nSource: QWeather${attribution ? ` — ${attribution}` : ""}\n\nWeather changes. This check does not create a reminder or alter your Plan.`;
}

function unavailable(stage: "amap" | "weather", result: ConnectorResult<unknown>, fallback: string): TelegramPlanWeatherResult {
  return { status: "unavailable", stage, ...(result.status === "available" ? {} : { connectorStatus: result.status }), code: result.failure?.code ?? `${stage}_unavailable`, message: result.failure?.message ?? fallback };
}
