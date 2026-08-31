import type { ConnectorResult, WeatherSnapshot } from "@c-assistant/connectors";

export type UserWeatherSnapshot = WeatherSnapshot;

interface UserWeatherDependencies {
  weather(input: { coordinates: string; locationName: string; adminArea?: string; country?: string; language?: "en" | "zh" }): Promise<ConnectorResult<UserWeatherSnapshot>>;
}

/** Uses the configured global weather provider without regional account fallbacks. */
export async function fetchUserWeather(input: {
  coordinates: string;
  locationName: string;
  adminArea?: string;
  country?: string;
  language?: "en" | "zh";
  dependencies: UserWeatherDependencies;
}): Promise<ConnectorResult<UserWeatherSnapshot>> {
  return input.dependencies.weather({
    coordinates: input.coordinates,
    locationName: input.locationName,
    ...(input.adminArea ? { adminArea: input.adminArea } : {}),
    ...(input.country ? { country: input.country } : {}),
    ...(input.language ? { language: input.language } : {})
  });
}
