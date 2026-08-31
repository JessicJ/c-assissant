import { createGoogleMapsNavigationHandoff, type ConnectorResult, type PlaceFact, type RouteFact, type WeatherSnapshot } from "@c-assistant/connectors";
import type { Plan, PlanPlace } from "@c-assistant/core";
import type { DestinationExecutionContext } from "./execution-service-catalog.js";
import { resolveServiceCapabilities } from "./execution-service-catalog.js";
import type { ExecutionHandoff, MovementActionCard, RecommendedMovementAction } from "./execution-action-card.js";
import { recommendLocalTransport } from "./local-transport-recommendation.js";
import { selectNextPlannedStop } from "./next-planned-stop.js";

interface ConvertedLocationFact {
  location: string;
  formattedAddress?: string;
  city?: string;
  country?: string;
  district?: string;
}

export interface MovementActionCardMaps {
  convertGpsCoordinate(input: { location: string }): Promise<ConnectorResult<ConvertedLocationFact>>;
  drivingRoute(input: { origin: string; destination: string; originId?: string; destinationId?: string }): Promise<ConnectorResult<RouteFact>>;
  walkingRoute(input: { origin: string; destination: string; originId?: string; destinationId?: string }): Promise<ConnectorResult<RouteFact>>;
  transitRoute(input: { origin: string; destination: string; originCityCode?: string; destinationCityCode?: string }): Promise<ConnectorResult<RouteFact>>;
  reverseGeocode(input: { location: string }): Promise<ConnectorResult<{ cityCode: string; city: string; district: string; formattedAddress: string }>>;
}

export interface MovementActionCardWeather {
  weather(input: { coordinates: string; locationName: string; adminArea?: string; country?: string; language?: "en" | "zh" }): Promise<ConnectorResult<WeatherSnapshot>>;
}

export async function createMovementActionCard(input: { plan: Plan; currentLocation: { latitude: number; longitude: number }; maps: MovementActionCardMaps; weather?: MovementActionCardWeather; now?: Date; confirmedStaleStopId?: string }): Promise<MovementActionCard> {
  const selection = selectNextPlannedStop(input.plan, { ...(input.now ? { now: input.now } : {}), ...(input.plan.configuration.arrival.timeZone ? { timeZone: input.plan.configuration.arrival.timeZone } : {}) });
  if (selection.status === "blocked") return blockedCard(input.plan, selection.blockingReasons, selection.recoveryMessage);
  if (selection.status === "stale_confirmation_required" && selection.place.id !== input.confirmedStaleStopId) return blockedCard(input.plan, ["stale_stop_requires_confirmation"], selection.recoveryMessage);
  const selected = selection.status === "stale_confirmation_required"
    ? { status: "selected" as const, planId: selection.planId, planVersion: selection.planVersion, day: selection.day, place: selection.place, scheduledTime: selection.scheduledTime, timing: "past_within_60" as const, degradedReasons: ["stale_stop_confirmed_for_current_interaction"] }
    : selection;
  const destination = destinationPlaceFact(selected.place);
  if (!destination) return blockedCard(input.plan, ["destination_coordinates_unavailable"], "The next planned stop is missing usable coordinates, so Landi cannot prepare a current movement card.");
  const converted = await input.maps.convertGpsCoordinate({ location: `${input.currentLocation.longitude},${input.currentLocation.latitude}` });
  if (converted.status !== "available" || !converted.data) return blockedCard(input.plan, ["origin_location_unavailable"], "Location was received, but Google Maps could not use it for route planning right now. The shared coordinates were not saved.");
  const origin: PlaceFact = { provider: "google_maps", id: "", name: "Shared current location", address: converted.data.formattedAddress ?? "", location: converted.data.location, type: "Temporary location", city: converted.data.city ?? "", ...(converted.data.country ? { country: converted.data.country } : {}), district: converted.data.district ?? "" };
  const routeFacts = await movementRouteFacts(origin, destination, input.maps);
  const weather = input.weather ? await movementWeather(destination, input.weather) : undefined;
  const degradedReasons = [...selected.degradedReasons];
  if (routeFacts.length === 0) degradedReasons.push("route_facts_unavailable");
  if (weather?.status !== "available") degradedReasons.push("weather_unavailable");
  const localTime = localTimeForPlan(input.now ?? new Date(), input.plan.configuration.arrival.timeZone);
  const recommendation = recommendLocalTransport({
    routeFacts,
    preference: input.plan.configuration.transport.preference,
    localTime,
    luggage: input.plan.configuration.travelContext.luggage,
    ...(input.plan.configuration.travelContext.partySize !== undefined ? { partySize: input.plan.configuration.travelContext.partySize } : {}),
    ...(weather?.data ? { weather: weather.data } : {})
  });
  const destinationContext = destinationContextForPlan(input.plan, selected.place);
  const primaryRecommendation = attachHandoffs(recommendation.primary, origin, destination, destinationContext);
  const alternatives = recommendation.alternatives.map((action) => attachHandoffs(action, origin, destination, destinationContext));
  return {
    kind: "movement",
    status: degradedReasons.length || recommendation.degradedReasons.length ? "degraded" : "ready",
    planId: input.plan.id,
    planVersion: input.plan.version,
    stopId: selected.place.id,
    stopName: selected.place.name,
    originName: origin.name,
    destinationName: selected.place.name,
    destinationAddress: selected.place.locationLabel,
    primaryRecommendation,
    alternatives,
    recommendationContext: recommendation.context,
    degradedReasons: [...new Set([...degradedReasons, ...recommendation.degradedReasons])],
    blockingReasons: []
  };
}

async function movementRouteFacts(origin: PlaceFact, destination: PlaceFact, maps: MovementActionCardMaps): Promise<RouteFact[]> {
  const [driving, walking, transit] = await Promise.all([
    maps.drivingRoute({ origin: origin.location, destination: destination.location, ...(destination.id ? { destinationId: destination.id } : {}) }),
    maps.walkingRoute({ origin: origin.location, destination: destination.location, ...(destination.id ? { destinationId: destination.id } : {}) }),
    movementTransitRoute(origin, destination, maps)
  ]);
  return [driving.status === "available" ? driving.data : undefined, walking.status === "available" ? walking.data : undefined, transit].filter((route): route is RouteFact => Boolean(route));
}

async function movementTransitRoute(origin: PlaceFact, destination: PlaceFact, maps: MovementActionCardMaps): Promise<RouteFact | undefined> {
  const [originArea, destinationArea] = await Promise.all([maps.reverseGeocode({ location: origin.location }), maps.reverseGeocode({ location: destination.location })]);
  if (originArea.status !== "available" || !originArea.data || destinationArea.status !== "available" || !destinationArea.data) return undefined;
  const route = await maps.transitRoute({ origin: origin.location, destination: destination.location, originCityCode: originArea.data.cityCode, destinationCityCode: destinationArea.data.cityCode });
  return route.status === "available" && route.data ? route.data : undefined;
}

async function movementWeather(destination: PlaceFact, weather: MovementActionCardWeather): Promise<ConnectorResult<WeatherSnapshot>> {
  return weather.weather({ coordinates: destination.location, locationName: destination.name, adminArea: destination.city || destination.district, ...(destination.country ? { country: destination.country } : {}), language: "en" });
}

function attachHandoffs(action: Omit<RecommendedMovementAction, "handoffs">, origin: PlaceFact, destination: PlaceFact, context: DestinationExecutionContext): RecommendedMovementAction {
  const services = resolveServiceCapabilities({ destination: context, option: action.option });
  const googleMaps = createGoogleMapsNavigationHandoff({ origin, destination, transport: action.routeMode });
  const handoffs: ExecutionHandoff[] = [
    { id: `${action.option}:google_maps`, kind: "map_link", label: "Open in Google Maps", url: googleMaps.url, serviceName: "Google Maps" },
    { id: `${action.option}:copy_pickup`, kind: "copy", label: "Copy pickup", copyText: origin.address || origin.location },
    { id: `${action.option}:copy_destination`, kind: "copy", label: "Copy destination", copyText: `${destination.name}\n${destination.address || destination.location}` },
    ...services.filter((service) => service.serviceId !== "google_maps").map((service): ExecutionHandoff => ({
      id: `${action.option}:${service.serviceId}`,
      kind: service.handoff,
      label: `Open ${service.serviceName}`,
      serviceName: service.serviceName,
      ...(service.url ? { url: service.url } : {}),
      instructions: service.instructions
    }))
  ];
  return { ...action, handoffs, externalActionReminder: "Confirm pickup, price, vehicle, and payment in the app or service before requesting." };
}

function destinationPlaceFact(place: PlanPlace): PlaceFact | undefined {
  if (!place.coordinates) return undefined;
  const [latitude, longitude] = place.coordinates;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return undefined;
  return { provider: "google_maps", id: place.id, name: place.name, address: place.locationLabel, location: `${longitude},${latitude}`, type: place.category, city: place.city ?? "", district: place.area ?? "" };
}

function destinationContextForPlan(plan: Plan, place: PlanPlace): DestinationExecutionContext {
  const label = [plan.location, place.city, place.area, place.locationLabel, place.name].filter(Boolean).join(" ");
  const lower = label.toLocaleLowerCase("en-US");
  return {
    country: lower.includes("indonesia") || lower.includes("bali") ? "Indonesia" : plan.location,
    ...(place.city ? { city: place.city } : {}),
    ...(place.area ?? place.locationLabel ? { area: place.area ?? place.locationLabel } : {}),
    label
  };
}

function localTimeForPlan(now: Date, timeZone?: string): string {
  const parts = new Map(new Intl.DateTimeFormat("en-CA", { timeZone: timeZone || "UTC", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(now).map((part) => [part.type, part.value] as const));
  return `${parts.get("hour")}:${parts.get("minute")}`;
}

function blockedCard(plan: Plan, blockingReasons: string[], recoveryMessage: string): MovementActionCard {
  return { kind: "movement", status: "blocked", planId: plan.id, planVersion: plan.version, alternatives: [], degradedReasons: [], blockingReasons, recoveryMessage };
}
