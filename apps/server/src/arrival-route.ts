import { createGoogleMapsNavigationHandoff, createUberRideHandoff, type PlaceFact, type RouteFact } from "@c-assistant/connectors";
import { runTransportPlannerSkill } from "@c-assistant/travel-support";
import type { TransportMode, TransportPreference } from "@c-assistant/core";
import type { Plan } from "@c-assistant/core";
import { resolveServiceCapabilities, type DestinationExecutionContext } from "./execution-service-catalog.js";

export function arrivalRouteDestination(plan: Plan): PlaceFact | undefined {
  const accommodation = plan.configuration.accommodation;
  if (!accommodation.name || !accommodation.address || !accommodation.location) return undefined;
  return { id: accommodation.id ?? "", name: accommodation.name, address: accommodation.address, location: accommodation.location, type: "Plan accommodation", city: "", district: "" };
}

export function selectArrivalTransport(plan: Plan, routeFacts: RouteFact[], preferenceOverride?: Exclude<TransportPreference, "plan_recommended">): TransportMode {
  const preference = preferenceOverride ?? plan.configuration.transport.preference;
  const fallback = preference === "public_transit" ? "transit" : preference === "walking" ? "walking" : "driving";
  const result = runTransportPlannerSkill({
    preference,
    ...(plan.configuration.travelContext.partySize !== undefined ? { partySize: plan.configuration.travelContext.partySize } : {}),
    luggage: plan.configuration.travelContext.luggage,
    mapProvider: "google_maps",
    routeFacts: routeFacts.map((route) => ({ mode: route.mode, distanceMeters: route.distanceMeters, ...(route.durationSeconds !== undefined ? { durationSeconds: route.durationSeconds } : {}) })),
    routeObservedAt: new Date().toISOString()
  });
  return result.recommendations[0]?.mode ?? fallback;
}

export function formatArrivalRoute(input: { origin: PlaceFact; destination: PlaceFact; transport: TransportMode; route?: RouteFact; taxiRequested?: boolean; uberPickup?: { latitude: number; longitude: number }; uberClientId?: string | undefined; destinationContext?: DestinationExecutionContext }): { text: string; handoffUrl: string; handoffLabel: string } {
  const pickupContext: DestinationExecutionContext = { country: input.origin.country ?? "", city: input.origin.city, area: input.origin.district };
  const service = input.taxiRequested ? resolveServiceCapabilities({ destination: pickupContext, option: "ride_hail_car" }).find(service => service.serviceName === "Uber" || service.serviceName === "Grab") : undefined;
  const useUber = service?.serviceId === "uber" && input.taxiRequested && input.uberPickup !== undefined;
  const handoff = useUber
    ? createUberRideHandoff({ pickup: input.uberPickup!, destination: input.destination, ...(input.uberClientId ? { clientId: input.uberClientId } : {}) })
    : createGoogleMapsNavigationHandoff({ origin: input.origin, destination: input.destination, transport: input.transport });
  const transportLabel = input.transport === "driving" ? "go by car" : input.transport === "walking" ? "walk" : "take public transit";
  const routeFact = input.route ? `\n${formatDistance(input.route.distanceMeters)}${input.route.durationSeconds === undefined ? "" : ` · about ${formatDuration(input.route.durationSeconds)}`}${input.route.transitCostYuan === undefined ? "" : ` · estimated transit fare ¥${input.route.transitCostYuan}`}.` : "\nOpen the map below to check the current route.";
  const taxiBoundary = service ? `\n\nOpen ${service.serviceName} below, check your pickup and destination, then review the car size and live fare. Confirm the ride only when you're ready.` : input.taxiRequested ? "\n\nYour hotel can help arrange a local taxi. Confirm the pickup and price before setting off." : "";
  const automaticFollowUp = input.route?.durationSeconds === undefined ? "" : "\n\nI'll check in around your expected arrival. If you're delayed, tap I haven't arrived to give yourself more time.";
  return {
    text: `Let's get you to ${input.destination.name}.\nI'd suggest you ${transportLabel}.${routeFact}${taxiBoundary}${automaticFollowUp}`,
    handoffUrl: service?.serviceName === "Grab" && service.url ? service.url : service?.serviceName === "Uber" && !useUber ? "https://m.uber.com/" : handoff.url,
    handoffLabel: service?.serviceName === "Uber" ? "Open Uber" : service?.serviceName === "Grab" ? "Open Grab" : "Open route in Google Maps"
  };
}

function formatDistance(distanceMeters: number): string {
  return distanceMeters >= 1_000 ? `${(distanceMeters / 1_000).toFixed(1)} km` : `${distanceMeters} m`;
}

function formatDuration(durationSeconds: number): string {
  return `${Math.max(1, Math.round(durationSeconds / 60))} min`;
}
