import type { ConnectorResult, GeocodedPlaceFact, NearbyPlaceFact, ReverseGeocodedPlaceFact, RouteFact, WeatherSnapshot } from "@c-assistant/connectors";
import { JAPAN_TIME_ZONE } from "@c-assistant/japan-country-pack";
import { createJapanReferenceCatalog } from "@c-assistant/japan-country-pack/reference-catalog";
import type { Plan, SourceSnapshot } from "@c-assistant/core";
import type { JapanArrivalCollectedFacts, JapanFactCollector } from "./japan-plan-compilation.js";

export interface JapanMapsReader {
  geocodeAddress(input: { address: string; city?: string }): Promise<ConnectorResult<GeocodedPlaceFact>>;
  nearbyAccommodation(input: { location: string; limit?: number }): Promise<ConnectorResult<NearbyPlaceFact[]>>;
  drivingRoute(input: { origin: string; destination: string }): Promise<ConnectorResult<RouteFact>>;
  walkingRoute(input: { origin: string; destination: string }): Promise<ConnectorResult<RouteFact>>;
  reverseGeocode(input: { location: string }): Promise<ConnectorResult<ReverseGeocodedPlaceFact>>;
  transitRoute(input: { origin: string; destination: string; originCityCode?: string; destinationCityCode?: string }): Promise<ConnectorResult<RouteFact>>;
}
export interface JapanWeatherReader { weather(input: { coordinates: string; locationName: string; country?: string; language?: "en" | "zh" }): Promise<ConnectorResult<WeatherSnapshot>> }

export function createJapanArrivalFactCollector(input: { maps: JapanMapsReader; weather: JapanWeatherReader; sourceSnapshots: () => SourceSnapshot[] }): JapanFactCollector {
  return { async collect(context): Promise<JapanArrivalCollectedFacts> {
    const destinationResult = await input.maps.geocodeAddress({ address: context.plan.location });
    if (destinationResult.status !== "available" || !destinationResult.data) throw new Error("destination_unavailable");
    const destination = destinationResult.data;
    if (!/^(?:japan|jp)$/i.test(destination.country?.trim() ?? "")) throw new Error("destination_country_not_japan");
    const [weatherResult, housingResult] = await Promise.all([
      input.weather.weather({ coordinates: destination.location, locationName: destination.city || context.plan.location, country: "Japan", language: "en" }),
      input.maps.nearbyAccommodation({ location: destination.location, limit: 5 })
    ]);
    const housing = housingResult.status === "available" && housingResult.data ? housingResult.data : [];
    const routeFacts = await collectRoutes(input.maps, context.plan, destination);
    const dates = planDates(context.plan.dates);
    const snapshots = input.sourceSnapshots();
    const linked = linkedSnapshots(context.plan, snapshots);
    const catalog = createJapanReferenceCatalog({ snapshots: linked, locationName: context.plan.location });
    const weather = weatherResult.status === "available" && weatherResult.data ? weatherResult.data : undefined;
    const travelPurpose = explicitValue(context.plan, "purpose");
    const passportConfirmed = explicitBoolean(context.plan, "passport confirmed");
    return {
      policy: {
        ...(travelPurpose ? { travelPurpose } : {}),
        ...(dates ? { stayDays: Math.max(1, Math.round((Date.parse(`${dates.returnDate}T00:00:00Z`) - Date.parse(`${dates.arrivalDate}T00:00:00Z`)) / 86_400_000)), departureDate: dates.departureDate, arrivalDate: dates.arrivalDate } : {}),
        ...(passportConfirmed !== undefined ? { passportConfirmed } : {}),
        evidence: linked.map(evidence)
      },
      weather: weather ? {
        availability: "available",
        locationName: weather.location.name || context.plan.location,
        retrievedAt: weather.retrievedAt,
        ...(dates?.arrivalDate ? { targetDate: dates.arrivalDate } : {}),
        provider: "google_weather",
        daily: weather.daily.map((day) => ({ date: day.date, conditionDay: day.conditionDay, conditionNight: day.conditionNight, highC: day.highC, lowC: day.lowC, precipitationMm: day.precipitationMm, uvIndex: day.uvIndex }))
      } : { availability: weatherResult.status === "unsupported" ? "not_supported" : "unavailable", locationName: destination.city || context.plan.location, retrievedAt: weatherResult.observedAt, provider: "google_weather" },
      housing: { centreName: context.plan.location, candidates: housing.map((item) => ({ id: item.id, name: item.name, address: item.address, distanceMeters: item.distanceMeters })), observedAt: housingResult.observedAt },
      transport: { routeFacts: routeFacts.facts.map((item) => ({ mode: item.mode, distanceMeters: item.distanceMeters, ...(item.durationSeconds !== undefined ? { durationSeconds: item.durationSeconds } : {}) })), observedAt: routeFacts.observedAt, preference: context.plan.configuration.transport.preference },
      catalog,
      schedule: dates ? { departureAt: tokyoInstant(dates.departureDate, "09:00"), arrivalAt: tokyoInstant(dates.arrivalDate, context.plan.configuration.arrival.expectedAtLocal?.slice(11, 16) || "12:00"), returnAt: tokyoInstant(dates.returnDate, "12:00"), timeZone: JAPAN_TIME_ZONE } : { timeZone: JAPAN_TIME_ZONE }
    };
  } };
}

async function collectRoutes(maps: JapanMapsReader, plan: Plan, destination: GeocodedPlaceFact): Promise<{ facts: RouteFact[]; observedAt: string }> {
  const accommodation = plan.configuration.accommodation.location?.trim();
  const arrivalNode = await resolveArrivalNode(maps, plan, destination);
  if (!arrivalNode || !accommodation) return { facts: [], observedAt: new Date(0).toISOString() };
  const [driving, walking, originAdmin, destinationAdmin] = await Promise.all([maps.drivingRoute({ origin: arrivalNode, destination: accommodation }), maps.walkingRoute({ origin: arrivalNode, destination: accommodation }), maps.reverseGeocode({ location: arrivalNode }), maps.reverseGeocode({ location: accommodation })]);
  const transit = originAdmin.status === "available" && destinationAdmin.status === "available" ? await maps.transitRoute({ origin: arrivalNode, destination: accommodation, ...(originAdmin.data?.cityCode ? { originCityCode: originAdmin.data.cityCode } : {}), ...(destinationAdmin.data?.cityCode ? { destinationCityCode: destinationAdmin.data.cityCode } : {}) }) : undefined;
  const results = [driving, walking, transit].filter((item): item is ConnectorResult<RouteFact> => item !== undefined);
  const facts = results.flatMap((item) => item.status === "available" && item.data ? [item.data] : []);
  return { facts, observedAt: results.map((item) => item.observedAt).filter((item) => Number.isFinite(Date.parse(item))).sort().at(-1) ?? new Date(0).toISOString() };
}
async function resolveArrivalNode(maps: JapanMapsReader, plan: Plan, destination: GeocodedPlaceFact): Promise<string | undefined> {
  const savedPlace = plan.presentation?.places.find((place) => Array.isArray(place.coordinates) && /airport|station|terminal|transport|机场|车站|航站楼/i.test(`${place.category} ${place.name}`));
  if (savedPlace?.coordinates) return `${savedPlace.coordinates[1]},${savedPlace.coordinates[0]}`;
  const label = ["arrival airport", "arrival station", "arrival point"].map((item) => explicitValue(plan, item)).find(Boolean);
  if (!label) return undefined;
  const result = await maps.geocodeAddress({ address: label, ...(destination.city ? { city: destination.city } : {}) });
  return result.status === "available" && result.data && /^(?:japan|jp)$/i.test(result.data.country?.trim() ?? "") ? result.data.location : undefined;
}
function linkedSnapshots(plan: Plan, snapshots: SourceSnapshot[]): SourceSnapshot[] { const byId = new Map(snapshots.map((item) => [item.id, item])); return plan.sources.flatMap((ref) => { const item = ref.sourceSnapshotId ? byId.get(ref.sourceSnapshotId) : undefined; return item && item.contentHash === ref.contentHash && item.sourceId.startsWith("jp-") ? [item] : []; }); }
function evidence(item: SourceSnapshot) { return { id: item.id, sourceId: item.sourceId, authority: item.authority, titleOriginal: item.titleOriginal, url: item.url, retrievedAt: item.retrievedAt, contentHash: item.contentHash }; }
function explicitValue(plan: Plan, label: string): string | undefined { const pattern = new RegExp(`^${label}\\s*:\\s*(.+)$`, "i"); for (const item of plan.knownInformation) { const match = pattern.exec(item.trim()); if (match?.[1]?.trim()) return match[1].trim(); } return undefined; }
function explicitBoolean(plan: Plan, label: string): boolean | undefined { const value = explicitValue(plan, label); return value ? /^(?:yes|true|confirmed)$/i.test(value) : undefined; }
function planDates(value: string): { departureDate: string; arrivalDate: string; returnDate: string } | undefined { const dates = value.match(/\d{4}-\d{2}-\d{2}/g); if (!dates?.[0] || !dates[1]) return undefined; return { departureDate: dates[0], arrivalDate: dates[0], returnDate: dates[1] }; }
function tokyoInstant(date: string, time: string): string { return `${date}T${time}:00+09:00`; }
