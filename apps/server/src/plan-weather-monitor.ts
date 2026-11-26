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

/** 阈值仅组织天气候选，不能判断影响、建议或恢复。 */
export function assessCurrentWeatherAttention(destination: string, snapshot: WeatherSnapshot): CurrentWeatherAttention | undefined {
  const current = snapshot.current;
  const condition = `${current.conditionCode} ${current.condition}`.toLocaleLowerCase();
  const common = { destination, observedAt: current.observedAt };
  if (/thunder|storm|tornado|cyclone|hurricane|typhoon|雷|暴风|台风|龙卷/.test(condition)) return { ...common, kind: "storm", title: `Weather attention for ${destination}`, body: "Weather conditions need verification for your travel date. Their impact and travel advice are awaiting review." };
  if (/blizzard|freezing rain|ice storm|sleet|heavy snow|暴雪|冻雨|冰雹|雨夹雪/.test(condition)) return { ...common, kind: "snow_or_ice", title: `Snow or ice risk in ${destination}`, body: "Weather conditions need verification for your travel date. Their impact and travel advice are awaiting review." };
  if (current.precipitationMm >= 10 || /heavy rain|torrential|downpour|暴雨|大暴雨|特大暴雨/.test(condition)) return { ...common, kind: "heavy_rain", title: `Heavy precipitation in ${destination}`, body: "Weather conditions need verification for your travel date. Their impact and travel advice are awaiting review." };
  if (current.feelsLikeC >= 38) return { ...common, kind: "extreme_heat", title: `High feels-like temperature in ${destination}`, body: "Weather conditions need verification for your travel date. Their impact and travel advice are awaiting review." };
  if (current.feelsLikeC <= -5) return { ...common, kind: "extreme_cold", title: `Low feels-like temperature in ${destination}`, body: "Weather conditions need verification for your travel date. Their impact and travel advice are awaiting review." };
  if (/dense fog|fog|mist|sandstorm|dust storm|浓雾|大雾|沙尘暴/.test(condition)) return { ...common, kind: "low_visibility", title: `Possible low visibility in ${destination}`, body: "Weather conditions need verification for your travel date. Their impact and travel advice are awaiting review." };
  return undefined;
}

/** Resolves the same current destination as the Web workspace and checks it without mutating the Plan. */
export async function checkPlanCurrentWeather(input: { plan: Plan; now?: Date; arrivals?: DestinationArrivalEvent[]; language?: "en" | "zh"; dependencies: PlanWeatherMonitorDependencies }): Promise<{ status: "candidate"; destination: string; observedAt: string; attention?: CurrentWeatherAttention } | { status: "unavailable"; stage: "plan" | "maps" | "weather"; code: string }> {
  if (!input.plan.presentation || input.plan.presentation.kind !== "itinerary") return { status: "unavailable", stage: "plan", code: "itinerary_unavailable" };
  const destination = resolveCurrentPlanDestination(input.plan.presentation, { ...(input.now ? { now: input.now } : {}), ...(input.arrivals ? { arrivals: input.arrivals } : {}) });
  if (!destination) return { status: "unavailable", stage: "plan", code: "destination_unavailable" };
  const placeResult = await input.dependencies.geocodeAddress({ address: destination.city });
  if (placeResult.status !== "available" || !placeResult.data) return { status: "unavailable", stage: "maps", code: placeResult.failure?.code ?? "location_unavailable" };
  const place = placeResult.data;
  const weatherResult = await input.dependencies.weather({ coordinates: place.location, locationName: place.formattedAddress, adminArea: place.district || place.city || place.province, country: "", language: input.language ?? "en" });
  if (weatherResult.status !== "available" || !weatherResult.data) return { status: "unavailable", stage: "weather", code: weatherResult.failure?.code ?? "weather_unavailable" };
  const attention = assessCurrentWeatherAttention(destination.city, weatherResult.data);
  return {status:"candidate",destination:destination.city,observedAt:weatherResult.data.current.observedAt,...(attention ? {attention} : {})};
}
