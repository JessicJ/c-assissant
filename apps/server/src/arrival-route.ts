import { createGoogleMapsNavigationHandoff, createUberRideHandoff, type PlaceFact, type RouteFact } from "@c-assistant/connectors";
import { runTransportPlannerSkill } from "@c-assistant/china-country-pack";
import type { TransportMode, TransportPreference } from "@c-assistant/core";
import type { Plan } from "@c-assistant/core";

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

export function formatArrivalRoute(input: { origin: PlaceFact; destination: PlaceFact; transport: TransportMode; route?: RouteFact; taxiRequested?: boolean; uberPickup?: { latitude: number; longitude: number }; uberClientId?: string | undefined }): { text: string; handoffUrl: string; handoffLabel: string } {
  const useUber = input.taxiRequested && input.uberPickup !== undefined;
  const handoff = useUber
    ? createUberRideHandoff({ pickup: input.uberPickup!, destination: input.destination, ...(input.uberClientId ? { clientId: input.uberClientId } : {}) })
    : createGoogleMapsNavigationHandoff({ origin: input.origin, destination: input.destination, transport: input.transport });
  const transportLabel = input.taxiRequested ? "Taxi estimate (using Google Maps driving facts)" : input.transport === "driving" ? "Driving" : input.transport === "walking" ? "Walking" : "Public transit";
  const routeFact = input.route ? `\nRoute fact: ${formatDistance(input.route.distanceMeters)}${input.route.durationSeconds === undefined ? "" : ` · about ${formatDuration(input.route.durationSeconds)}`}${input.route.transitCostYuan === undefined ? "" : ` · estimated transit fare ¥${input.route.transitCostYuan}`}.` : "\nOpen Google Maps to get the current live route.";
  const taxiBoundary = input.taxiRequested ? "\n\nContinue in Uber:\n1. Tap Open Uber below.\n2. Check the pickup point and destination; correct either one if Uber could not resolve it accurately.\n3. Review availability, vehicle type, live fare, and payment method in Uber.\n4. Confirm the ride in Uber only when you are ready." : "";
  const automaticFollowUp = input.route?.durationSeconds === undefined ? "" : "\n\nAfter this handoff, Landi will use conservative route timing to send the next arrival guidance automatically. You do not need to confirm boarding or arrival. If you are delayed, tap I haven't arrived on that next message.";
  return {
    text: `Arrival route ready\nTo: ${input.destination.name}\nChosen route mode: ${transportLabel}.${routeFact}${taxiBoundary}${automaticFollowUp}\n\nLandi has not hailed a ride, made a booking, or started payment.`,
    handoffUrl: handoff.url,
    handoffLabel: input.taxiRequested ? "Open Uber" : "Open route in Google Maps"
  };
}

function formatDistance(distanceMeters: number): string {
  return distanceMeters >= 1_000 ? `${(distanceMeters / 1_000).toFixed(1)} km` : `${distanceMeters} m`;
}

function formatDuration(durationSeconds: number): string {
  return `${Math.max(1, Math.round(durationSeconds / 60))} min`;
}
