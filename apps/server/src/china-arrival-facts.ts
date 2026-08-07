import type {
  AmapGeocodedPlace,
  AmapNearbyPlace,
  AmapReverseGeocodedPlace,
  AmapRoute,
  ConnectorResult,
  QWeatherWeatherSnapshot
} from "@c-assistant/connectors";
import type { Plan, Profile, SourceSnapshot } from "@c-assistant/core";

import { localDateTimeInstant } from "./arrival-reminder.js";
import type { ChinaArrivalCollectedFacts, ChinaArrivalFactCollector } from "./china-plan-compilation.js";

export interface ChinaArrivalAmapReader {
  geocodeAddress(input: { address: string; city?: string }): Promise<ConnectorResult<AmapGeocodedPlace>>;
  nearbyAccommodation(input: { location: string; limit?: number }): Promise<ConnectorResult<AmapNearbyPlace[]>>;
  drivingRoute(input: { origin: string; destination: string; originId?: string; destinationId?: string }): Promise<ConnectorResult<AmapRoute>>;
  walkingRoute(input: { origin: string; destination: string; originId?: string; destinationId?: string }): Promise<ConnectorResult<AmapRoute>>;
  reverseGeocode(input: { location: string }): Promise<ConnectorResult<AmapReverseGeocodedPlace>>;
  transitRoute(input: { origin: string; destination: string; originCityCode?: string; destinationCityCode?: string }): Promise<ConnectorResult<AmapRoute>>;
}

export interface ChinaArrivalWeatherReader {
  weather(input: { coordinates: string; locationName: string; adminArea?: string; country?: string; language?: "en" | "zh" }): Promise<ConnectorResult<QWeatherWeatherSnapshot>>;
}

export interface ChinaArrivalReferenceCatalog {
  localFood: ChinaArrivalCollectedFacts["localFood"];
  digitalLife: ChinaArrivalCollectedFacts["digitalLife"];
}

export class ChinaArrivalFactCollectionError extends Error {
  constructor(readonly stage: "destination" | "weather" | "housing" | "transport", readonly reasonCode: string) {
    super(`China arrival fact collection failed at ${stage}.`);
    this.name = "ChinaArrivalFactCollectionError";
  }
}

/** Builds normalized, credential-free Skill inputs from current provider facts and Plan-scoped state. */
export function createChinaArrivalFactCollector(input: {
  amap: ChinaArrivalAmapReader;
  qweather: ChinaArrivalWeatherReader;
  sourceSnapshots: () => SourceSnapshot[];
  referenceCatalog: () => ChinaArrivalReferenceCatalog;
}): ChinaArrivalFactCollector {
  return {
    async collect(context): Promise<ChinaArrivalCollectedFacts> {
      const destinationResult = await input.amap.geocodeAddress({ address: context.plan.location });
      const destination = requireAvailable(destinationResult, "destination");
      const [weatherResult, housingResult] = await Promise.all([
        input.qweather.weather({
          coordinates: destination.location,
          locationName: destination.city || context.plan.location,
          ...(destination.province ? { adminArea: destination.province } : {}),
          country: "China",
          language: preferredWeatherLanguage(context.profile)
        }),
        input.amap.nearbyAccommodation({ location: destination.location, limit: 5 })
      ]);
      const weather = requireAvailable(weatherResult, "weather");
      const accommodationCandidates = requireAvailable(housingResult, "housing");
      const routes = await collectPlanRoutes(input.amap, context.plan, destination);
      const targetDate = context.plan.configuration.arrival.expectedAtLocal?.slice(0, 10);
      const matchedForecast = targetDate ? weather.daily.find((day) => day.date === targetDate) : undefined;
      const catalog = structuredClone(input.referenceCatalog());

      return {
        policyEvidence: linkedPolicyEvidence(context.plan, input.sourceSnapshots()),
        weather: {
          locationName: weather.location.name || context.plan.location,
          current: {
            condition: weather.current.condition,
            temperatureC: weather.current.temperatureC,
            feelsLikeC: weather.current.feelsLikeC,
            precipitationMm: weather.current.precipitationMm,
            observedAt: weather.current.observedAt
          },
          daily: weather.daily.map((day) => ({
            date: day.date,
            conditionDay: day.conditionDay,
            conditionNight: day.conditionNight,
            highC: day.highC,
            lowC: day.lowC,
            precipitationMm: day.precipitationMm,
            uvIndex: day.uvIndex
          })),
          retrievedAt: weather.retrievedAt,
          ...(targetDate ? { targetDate } : {}),
          ...(weather.attributionUrl ? { attributionUrl: weather.attributionUrl } : {})
        },
        housing: {
          centreName: context.plan.location,
          candidates: accommodationCandidates,
          observedAt: housingResult.observedAt
        },
        transport: {
          preference: context.plan.configuration.transport.preference,
          ...(context.plan.configuration.travelContext.partySize !== undefined ? { partySize: context.plan.configuration.travelContext.partySize } : {}),
          luggage: context.plan.configuration.travelContext.luggage,
          routeFacts: routes.facts.map((route) => ({
            mode: route.mode,
            distanceMeters: route.distanceMeters,
            ...(route.durationSeconds !== undefined ? { durationSeconds: route.durationSeconds } : {})
          })),
          routeObservedAt: routes.observedAt,
          ...(matchedForecast ? {
            weather: { condition: `${matchedForecast.conditionDay} / ${matchedForecast.conditionNight}`, precipitationMm: matchedForecast.precipitationMm },
            weatherObservedAt: weather.retrievedAt
          } : {})
        },
        localFood: catalog.localFood,
        digitalLife: catalog.digitalLife,
        schedule: scheduleFromPlan(context.plan, weather.location.timezone)
      };
    }
  };
}

async function collectPlanRoutes(amap: ChinaArrivalAmapReader, plan: Plan, destination: AmapGeocodedPlace): Promise<{ facts: AmapRoute[]; observedAt: string }> {
  const accommodation = plan.configuration.accommodation;
  const origin = accommodation.status === "confirmed" || accommodation.status === "candidate" ? accommodation.location?.trim() : undefined;
  if (!origin) return { facts: [], observedAt: new Date(0).toISOString() };

  const [driving, walking, originAdmin, destinationAdmin] = await Promise.all([
    amap.drivingRoute({ origin, destination: destination.location, ...(accommodation.id ? { originId: accommodation.id } : {}) }),
    amap.walkingRoute({ origin, destination: destination.location, ...(accommodation.id ? { originId: accommodation.id } : {}) }),
    amap.reverseGeocode({ location: origin }),
    amap.reverseGeocode({ location: destination.location })
  ]);
  const transit = originAdmin.status === "available" && originAdmin.data && destinationAdmin.status === "available" && destinationAdmin.data
    ? await amap.transitRoute({ origin, destination: destination.location, originCityCode: originAdmin.data.cityCode, destinationCityCode: destinationAdmin.data.cityCode })
    : undefined;
  const results = [driving, walking, transit].filter((result): result is ConnectorResult<AmapRoute> => result !== undefined);
  const facts = results.flatMap((result) => result.status === "available" && result.data ? [result.data] : []);
  if (!facts.length) throw new ChinaArrivalFactCollectionError("transport", "route_facts_unavailable");
  const observedAt = results.map((result) => result.observedAt).filter((value) => Number.isFinite(Date.parse(value))).sort().at(-1) ?? new Date().toISOString();
  return { facts, observedAt };
}

function linkedPolicyEvidence(plan: Plan, snapshots: SourceSnapshot[]): ChinaArrivalCollectedFacts["policyEvidence"] {
  const snapshotById = new Map(snapshots.map((snapshot) => [snapshot.id, snapshot]));
  return plan.sources.flatMap((reference) => {
    const snapshot = reference.sourceSnapshotId ? snapshotById.get(reference.sourceSnapshotId) : undefined;
    if (!snapshot || snapshot.contentHash !== reference.contentHash) return [];
    return [{
      id: snapshot.id,
      sourceId: snapshot.sourceId,
      authority: snapshot.authority,
      titleOriginal: snapshot.titleOriginal,
      url: snapshot.url,
      retrievedAt: snapshot.retrievedAt,
      contentHash: snapshot.contentHash
    }];
  });
}

function scheduleFromPlan(plan: Plan, providerTimeZone: string): ChinaArrivalCollectedFacts["schedule"] {
  const timeZone = plan.configuration.arrival.timeZone || providerTimeZone || "Asia/Shanghai";
  const expectedAtLocal = plan.configuration.arrival.expectedAtLocal;
  const arrivalAt = expectedAtLocal ? localDateTimeWithOffset(expectedAtLocal, timeZone) : undefined;
  return { timeZone, ...(arrivalAt ? { arrivalAt } : {}) };
}

function localDateTimeWithOffset(value: string, timeZone: string): string | undefined {
  const instant = localDateTimeInstant(value, timeZone);
  if (!instant) return undefined;
  const localAsUtc = Date.parse(`${value}:00Z`);
  const offsetMinutes = Math.round((localAsUtc - instant.getTime()) / 60_000);
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absolute = Math.abs(offsetMinutes);
  return `${value}:00${sign}${String(Math.floor(absolute / 60)).padStart(2, "0")}:${String(absolute % 60).padStart(2, "0")}`;
}

function preferredWeatherLanguage(_profile: Pick<Profile, "nationality" | "immigrationStatus">): "en" {
  return "en";
}

function requireAvailable<T>(result: ConnectorResult<T>, stage: ChinaArrivalFactCollectionError["stage"]): T {
  if (result.status === "available" && result.data !== undefined) return result.data;
  throw new ChinaArrivalFactCollectionError(stage, `${result.provider}_${result.status}`);
}
