import type { AmapBasicWeatherSnapshot, ConnectorResult, QWeatherWeatherSnapshot } from "@c-assistant/connectors";

export type UserWeatherSnapshot = QWeatherWeatherSnapshot | AmapBasicWeatherSnapshot;

interface UserWeatherDependencies {
  qweather(input: { coordinates: string; locationName: string; adminArea?: string; country?: string; language?: "en" | "zh" }): Promise<ConnectorResult<QWeatherWeatherSnapshot>>;
  amap(input: { adcode: string; locationName: string }): Promise<ConnectorResult<AmapBasicWeatherSnapshot>>;
}

/** Prefers full QWeather facts and falls back to display-only Amap city weather. */
export async function fetchUserWeather(input: {
  coordinates: string;
  locationName: string;
  adcode?: string;
  adminArea?: string;
  country?: string;
  language?: "en" | "zh";
  dependencies: UserWeatherDependencies;
}): Promise<ConnectorResult<UserWeatherSnapshot>> {
  const preferred = await input.dependencies.qweather({
    coordinates: input.coordinates,
    locationName: input.locationName,
    ...(input.adminArea ? { adminArea: input.adminArea } : {}),
    ...(input.country ? { country: input.country } : {}),
    ...(input.language ? { language: input.language } : {})
  });
  if (preferred.status === "available" && preferred.data) return preferred;
  if (!input.adcode) return preferred;
  return input.dependencies.amap({ adcode: input.adcode, locationName: input.locationName });
}

export function isAmapBasicWeather(snapshot: UserWeatherSnapshot): snapshot is AmapBasicWeatherSnapshot {
  return "source" in snapshot && snapshot.source === "amap";
}
