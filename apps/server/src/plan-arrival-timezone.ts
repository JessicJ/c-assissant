import type { Plan } from "@c-assistant/core";
import type { ConnectorResult, GeocodedPlaceFact, WeatherSnapshot } from "@c-assistant/connectors";

export interface PlanArrivalTimeZoneProviders {
  geocodeAddress(input: { address: string }): Promise<ConnectorResult<GeocodedPlaceFact>>;
  weather(input: { coordinates: string; locationName: string }): Promise<ConnectorResult<WeatherSnapshot>>;
}

export async function resolvePlanArrivalTimeZone(plan: Plan, providers: PlanArrivalTimeZoneProviders): Promise<string | undefined> {
  const expected = plan.configuration.arrival.expectedAtLocal;
  if (!expected || plan.configuration.arrival.timeZone || plan.presentation?.kind !== "itinerary") return undefined;
  const date = expected.slice(0, 10);
  const arrivalDay = plan.presentation.days.find((day) => day.date === date) ?? plan.presentation.days[0];
  const city = arrivalDay?.city?.trim();
  if (!city) return undefined;
  const geocoded = await providers.geocodeAddress({ address: city });
  if (geocoded.status !== "available" || !geocoded.data) return undefined;
  const weather = await providers.weather({ coordinates: geocoded.data.location, locationName: geocoded.data.formattedAddress });
  const timeZone = weather.status === "available" ? weather.data?.location.timezone.trim() : undefined;
  if (!timeZone || !validTimeZone(timeZone)) return undefined;
  return timeZone;
}

function validTimeZone(value: string): boolean {
  try { new Intl.DateTimeFormat("en", { timeZone: value }).format(new Date()); return true; }
  catch { return false; }
}
