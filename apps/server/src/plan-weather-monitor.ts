import type { ConnectorResult, GeocodedPlaceFact, WeatherSnapshot } from "@c-assistant/connectors";
import { resolveCurrentPlanDestination, type DestinationArrivalEvent, type Plan } from "@c-assistant/core";

interface PlanWeatherMonitorDependencies {
  geocodeAddress(input: { address: string }): Promise<ConnectorResult<GeocodedPlaceFact>>;
  weather(input: { coordinates: string; locationName: string; adminArea?: string; country?: string; language?: "en" | "zh" }): Promise<ConnectorResult<WeatherSnapshot>>;
}

export type CurrentWeatherAttentionKind = "storm" | "snow_or_ice" | "heavy_rain" | "extreme_heat" | "extreme_cold" | "low_visibility";

export interface CurrentWeatherAttention {
  kind: CurrentWeatherAttentionKind;
  destination: string;
  observedAt: string;
  title: string;
  body: string;
}

/** Returns only weather that can materially change what the traveler should do now. */
export function assessCurrentWeatherAttention(destination: string, snapshot: WeatherSnapshot): CurrentWeatherAttention | undefined {
  const current = snapshot.current;
  const condition = `${current.conditionCode} ${current.condition}`.toLocaleLowerCase();
  const common = { destination, observedAt: current.observedAt || snapshot.retrievedAt };
  if (/thunder|storm|tornado|cyclone|hurricane|typhoon|雷|暴风|台风|龙卷/.test(condition)) return { ...common, kind: "storm", title: `Weather attention for ${destination}`, body: `${current.condition}. Pause exposed viewpoints, boat trips, and long outdoor activities, and use an indoor alternative from the current Plan.` };
  if (/blizzard|freezing rain|ice storm|sleet|heavy snow|暴雪|冻雨|冰雹|雨夹雪/.test(condition)) return { ...common, kind: "snow_or_ice", title: `Snow or ice risk in ${destination}`, body: `${current.condition}. Roads and public transport may be affected, so allow extra time for current journeys.` };
  if (current.precipitationMm >= 10 || /heavy rain|torrential|downpour|暴雨|大暴雨|特大暴雨/.test(condition)) return { ...common, kind: "heavy_rain", title: `Heavy precipitation in ${destination}`, body: `${current.condition}, with ${current.precipitationMm} mm of current precipitation. Prefer an indoor alternative and check current transport again.` };
  if (current.feelsLikeC >= 38) return { ...common, kind: "extreme_heat", title: `High feels-like temperature in ${destination}`, body: `It is currently ${Math.round(current.temperatureC)}°C and feels like ${Math.round(current.feelsLikeC)}°C. Reduce outdoor time around midday and stay hydrated.` };
  if (current.feelsLikeC <= -5) return { ...common, kind: "extreme_cold", title: `Low feels-like temperature in ${destination}`, body: `It is currently ${Math.round(current.temperatureC)}°C and feels like ${Math.round(current.feelsLikeC)}°C. Shorten outdoor stays and watch for ice.` };
  if (/dense fog|fog|mist|sandstorm|dust storm|浓雾|大雾|沙尘暴/.test(condition)) return { ...common, kind: "low_visibility", title: `Possible low visibility in ${destination}`, body: `${current.condition}. Airports, roads, and viewpoints may be affected, so check current transport status again.` };
  return undefined;
}

/** Resolves the same current destination as the Web workspace and checks it without mutating the Plan. */
export async function checkPlanCurrentWeather(input: { plan: Plan; now?: Date; arrivals?: DestinationArrivalEvent[]; language?: "en" | "zh"; dependencies: PlanWeatherMonitorDependencies }): Promise<{ status: "normal"; destination: string; observedAt: string } | { status: "attention"; attention: CurrentWeatherAttention } | { status: "unavailable"; stage: "plan" | "maps" | "weather"; code: string }> {
  if (!input.plan.presentation || input.plan.presentation.kind !== "itinerary") return { status: "unavailable", stage: "plan", code: "itinerary_unavailable" };
  const destination = resolveCurrentPlanDestination(input.plan.presentation, { ...(input.now ? { now: input.now } : {}), ...(input.arrivals ? { arrivals: input.arrivals } : {}) });
  if (!destination) return { status: "unavailable", stage: "plan", code: "destination_unavailable" };
  const placeResult = await input.dependencies.geocodeAddress({ address: destination.city });
  if (placeResult.status !== "available" || !placeResult.data) return { status: "unavailable", stage: "maps", code: placeResult.failure?.code ?? "location_unavailable" };
  const place = placeResult.data;
  const weatherResult = await input.dependencies.weather({ coordinates: place.location, locationName: place.formattedAddress, adminArea: place.district || place.city || place.province, country: "", language: input.language ?? "en" });
  if (weatherResult.status !== "available" || !weatherResult.data) return { status: "unavailable", stage: "weather", code: weatherResult.failure?.code ?? "weather_unavailable" };
  const attention = assessCurrentWeatherAttention(destination.city, weatherResult.data);
  return attention ? { status: "attention", attention } : { status: "normal", destination: destination.city, observedAt: weatherResult.data.current.observedAt || weatherResult.data.retrievedAt };
}
