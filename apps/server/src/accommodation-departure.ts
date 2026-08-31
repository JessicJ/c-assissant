import type { Plan, ItineraryDay, PlanPlace } from "@c-assistant/core";
import type { ConnectorResult, GeocodedPlaceFact, RouteFact } from "@c-assistant/connectors";

export interface AccommodationDepartureMaps {
  geocodeAddress(input: { address: string }): Promise<ConnectorResult<GeocodedPlaceFact>>;
  drivingRoute(input: { origin: string; destination: string }): Promise<ConnectorResult<RouteFact>>;
  walkingRoute(input: { origin: string; destination: string }): Promise<ConnectorResult<RouteFact>>;
  transitRoute(input: { origin: string; destination: string }): Promise<ConnectorResult<RouteFact>>;
}

export async function prepareAccommodationDepartures(input: {
  plan: Plan;
  accommodationName: string;
  accommodationAddress: string;
  accommodationLocation: string;
  maps: AccommodationDepartureMaps;
}): Promise<Array<{ dayId: string; departure: NonNullable<ItineraryDay["accommodationDeparture"]> }>> {
  const presentation = input.plan.presentation;
  if (!presentation || presentation.kind !== "itinerary") return [];
  const placeById = new Map(presentation.places.map((place) => [place.id, place]));
  const mode = departureMode(input.plan);
  const jobs = presentation.days.flatMap((day) => {
    const destinationPlaceId = day.stops?.slice().sort((left, right) => left.order - right.order)[0]?.placeId ?? day.placeIds[0];
    const destination = destinationPlaceId ? placeById.get(destinationPlaceId) : undefined;
    return destination ? [{ dayId: day.id, destination }] : [];
  });
  const results: Array<{ dayId: string; departure: NonNullable<ItineraryDay["accommodationDeparture"]> }> = [];
  const queue = [...jobs];
  await Promise.all(Array.from({ length: Math.min(3, queue.length) }, async () => {
    while (queue.length) {
      const job = queue.shift();
      if (!job) return;
      results.push({
        dayId: job.dayId,
        departure: await departureForPlace({
          accommodationName: input.accommodationName,
          accommodationAddress: input.accommodationAddress,
          accommodationLocation: input.accommodationLocation,
          destination: job.destination,
          mode,
          maps: input.maps
        })
      });
    }
  }));
  return results;
}

async function departureForPlace(input: {
  accommodationName: string;
  accommodationAddress: string;
  accommodationLocation: string;
  destination: PlanPlace;
  mode: "walking" | "transit" | "driving";
  maps: AccommodationDepartureMaps;
}): Promise<NonNullable<ItineraryDay["accommodationDeparture"]>> {
  const base = {
    accommodationName: input.accommodationName,
    accommodationAddress: input.accommodationAddress,
    destinationPlaceId: input.destination.id,
    mode: input.mode
  };
  const destinationLocation = input.destination.coordinates
    ? `${input.destination.coordinates[1]},${input.destination.coordinates[0]}`
    : await geocodePlace(input.destination, input.maps);
  if (!destinationLocation) return { ...base, verification: "needs_verification" };
  const routeMethod = input.mode === "walking" ? input.maps.walkingRoute.bind(input.maps) : input.mode === "transit" ? input.maps.transitRoute.bind(input.maps) : input.maps.drivingRoute.bind(input.maps);
  const route = await routeMethod({ origin: input.accommodationLocation, destination: destinationLocation });
  if (route.status !== "available" || !route.data) return { ...base, verification: "needs_verification" };
  return {
    ...base,
    verification: "verified",
    ...(route.data.durationSeconds === undefined ? {} : { durationMinutes: Math.max(1, Math.round(route.data.durationSeconds / 60)) }),
    distanceMeters: route.data.distanceMeters,
    checkedAt: route.observedAt
  };
}

async function geocodePlace(place: PlanPlace, maps: AccommodationDepartureMaps): Promise<string | undefined> {
  const result = await maps.geocodeAddress({ address: `${place.name}, ${place.locationLabel}`.slice(0, 300) });
  return result.status === "available" ? result.data?.location : undefined;
}

function departureMode(plan: Plan): "walking" | "transit" | "driving" {
  const preference = plan.configuration.transport.preference;
  if (preference === "walking") return "walking";
  if (preference === "public_transit") return "transit";
  return "driving";
}
