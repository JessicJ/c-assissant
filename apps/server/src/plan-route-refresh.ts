import type { Plan } from "@c-assistant/core";
import type { ConnectorResult, GeocodedPlaceFact, RouteFact } from "@c-assistant/connectors";

export interface PlanRouteMaps {
  geocodeAddress(input: { address: string }): Promise<ConnectorResult<GeocodedPlaceFact>>;
  drivingRoute(input: { origin: string; destination: string }): Promise<ConnectorResult<RouteFact>>;
  walkingRoute(input: { origin: string; destination: string }): Promise<ConnectorResult<RouteFact>>;
  transitRoute(input: { origin: string; destination: string }): Promise<ConnectorResult<RouteFact>>;
}

export class PlanRouteRefreshError extends Error {
  constructor(readonly code: "missing_presentation" | "missing_segment" | "missing_place" | "unsupported_mode" | "origin_unavailable" | "destination_unavailable" | "route_unavailable", message: string, readonly connectorStatus?: ConnectorResult<unknown>["status"]) {
    super(message);
  }
}

export interface RefreshedPlanRouteFacts {
  segmentId: string;
  observedAt: string;
  distanceMeters: number;
  durationSeconds?: number;
  originCoordinates: [number, number];
  destinationCoordinates: [number, number];
  geometry?: Array<[number, number]>;
}

export async function refreshPlanRouteFacts(plan: Plan, segmentId: string, maps: PlanRouteMaps): Promise<RefreshedPlanRouteFacts> {
  const presentation = plan.presentation;
  if (!presentation || presentation.kind !== "itinerary") throw new PlanRouteRefreshError("missing_presentation", "This Plan does not contain a structured itinerary presentation.");
  const segment = presentation.routeSegments.find((candidate) => candidate.id === segmentId);
  if (!segment) throw new PlanRouteRefreshError("missing_segment", "The Plan route segment was not found.");
  const origin = presentation.places.find((place) => place.id === segment.originPlaceId);
  const destination = presentation.places.find((place) => place.id === segment.destinationPlaceId);
  if (!origin || !destination) throw new PlanRouteRefreshError("missing_place", "The route references a place that is no longer in this Plan.");
  if (segment.mode !== "driving" && segment.mode !== "walking" && segment.mode !== "transit") throw new PlanRouteRefreshError("unsupported_mode", "Automatic refresh currently supports driving, walking, and public-transit segments only.");

  const [originResult, destinationResult] = await Promise.all([
    maps.geocodeAddress({ address: placeQuery(origin.name, origin.locationLabel) }),
    maps.geocodeAddress({ address: placeQuery(destination.name, destination.locationLabel) })
  ]);
  if (originResult.status !== "available" || !originResult.data) throw new PlanRouteRefreshError("origin_unavailable", "Google Maps could not resolve the route origin.", originResult.status);
  if (destinationResult.status !== "available" || !destinationResult.data) throw new PlanRouteRefreshError("destination_unavailable", "Google Maps could not resolve the route destination.", destinationResult.status);

  const routeMethod = segment.mode === "driving" ? maps.drivingRoute.bind(maps) : segment.mode === "walking" ? maps.walkingRoute.bind(maps) : maps.transitRoute.bind(maps);
  const route = await routeMethod({ origin: originResult.data.location, destination: destinationResult.data.location });
  if (route.status !== "available" || !route.data) throw new PlanRouteRefreshError("route_unavailable", "Google Maps did not return usable facts for this route segment.", route.status);
  return {
    segmentId,
    observedAt: route.observedAt,
    distanceMeters: route.data.distanceMeters,
    ...(route.data.durationSeconds !== undefined ? { durationSeconds: route.data.durationSeconds } : {}),
    originCoordinates: parseCoordinates(originResult.data.location),
    destinationCoordinates: parseCoordinates(destinationResult.data.location),
    ...(route.data.geometry?.length ? { geometry: route.data.geometry } : {})
  };
}

export async function refreshGeneratedPlanRoutes(plan: Plan, maps: PlanRouteMaps, concurrency = 3): Promise<{ refreshed: RefreshedPlanRouteFacts[]; failedSegmentIds: string[] }> {
  const segmentIds = (plan.presentation?.kind === "itinerary" ? plan.presentation.routeSegments : [])
    .filter((segment) => segment.mode === "driving" || segment.mode === "walking" || segment.mode === "transit")
    .slice(0, 36)
    .map((segment) => segment.id);
  const refreshed: RefreshedPlanRouteFacts[] = [];
  const failedSegmentIds: string[] = [];
  const geocodeCache = new Map<string, Promise<ConnectorResult<GeocodedPlaceFact>>>();
  const cachedMaps: PlanRouteMaps = {
    ...maps,
    geocodeAddress: (input) => {
      const key = input.address.trim().toLocaleLowerCase();
      const existing = geocodeCache.get(key);
      if (existing) return existing;
      const pending = maps.geocodeAddress(input);
      geocodeCache.set(key, pending);
      return pending;
    }
  };
  let cursor = 0;
  let halted = false;
  const workers = Array.from({ length: Math.min(Math.max(1, concurrency), segmentIds.length) }, async () => {
    while (!halted && cursor < segmentIds.length) {
      const segmentId = segmentIds[cursor++]!;
      try {
        refreshed.push(await refreshPlanRouteFacts(plan, segmentId, cachedMaps));
      } catch (error) {
        failedSegmentIds.push(segmentId);
        if (error instanceof PlanRouteRefreshError && error.connectorStatus && ["not_configured", "unauthorized", "rate_limited", "unavailable"].includes(error.connectorStatus)) halted = true;
      }
    }
  });
  await Promise.all(workers);
  return { refreshed, failedSegmentIds };
}

function placeQuery(name: string, locationLabel: string): string {
  return `${name}, ${locationLabel}`.slice(0, 300);
}

function parseCoordinates(value: string): [number, number] {
  const [longitude, latitude] = value.split(",").map(Number);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) throw new PlanRouteRefreshError("route_unavailable", "Google Maps returned an invalid place location.", "degraded");
  return [longitude!, latitude!];
}
