import { createAmapNavigationHandoff, type AmapPlace, type AmapRoute } from "@c-assistant/connectors";
import { runTransportPlannerSkill } from "@c-assistant/china-country-pack";
import type { TransportMode } from "@c-assistant/core";
import type { Plan } from "@c-assistant/core";

export function arrivalRouteDestination(plan: Plan): AmapPlace | undefined {
  const accommodation = plan.configuration.accommodation;
  if (!accommodation.name || !accommodation.address || !accommodation.location) return undefined;
  return { id: accommodation.id ?? "", name: accommodation.name, address: accommodation.address, location: accommodation.location, type: "Plan accommodation", city: "", district: "" };
}

export function selectArrivalTransport(plan: Plan, routeFacts: AmapRoute[]): TransportMode {
  const fallback = plan.configuration.transport.preference === "public_transit" ? "transit" : plan.configuration.transport.preference === "walking" ? "walking" : "driving";
  const result = runTransportPlannerSkill({
    preference: plan.configuration.transport.preference,
    ...(plan.configuration.travelContext.partySize !== undefined ? { partySize: plan.configuration.travelContext.partySize } : {}),
    luggage: plan.configuration.travelContext.luggage,
    routeFacts: routeFacts.map((route) => ({ mode: route.mode, distanceMeters: route.distanceMeters, ...(route.durationSeconds !== undefined ? { durationSeconds: route.durationSeconds } : {}) })),
    routeObservedAt: new Date().toISOString()
  });
  return result.recommendations[0]?.mode ?? fallback;
}

export function formatArrivalRoute(input: { origin: AmapPlace; destination: AmapPlace; transport: TransportMode; route?: AmapRoute }): { text: string; handoffUrl: string } {
  const handoff = createAmapNavigationHandoff({ origin: input.origin, destination: input.destination, transport: input.transport });
  const transportLabel = input.transport === "driving" ? "Driving / taxi" : input.transport === "walking" ? "Walking" : "Public transit";
  const routeFact = input.route ? `\nRoute fact: ${formatDistance(input.route.distanceMeters)}${input.route.durationSeconds === undefined ? "" : ` · about ${formatDuration(input.route.durationSeconds)}`}${input.route.taxiCostYuan === undefined ? "" : ` · estimated taxi fare ¥${input.route.taxiCostYuan}`}${input.route.transitCostYuan === undefined ? "" : ` · estimated transit fare ¥${input.route.transitCostYuan}`}.` : "\nOpen Amap to get the current live route.";
  return { text: `Arrival route ready\nTo: ${input.destination.name}\nChosen Plan mode: ${transportLabel}.${routeFact}\n\nOpen Amap to review the route and choose the next action. C-assistant has not hailed a ride, made a booking, or started payment.`, handoffUrl: handoff.url };
}

function formatDistance(distanceMeters: number): string {
  return distanceMeters >= 1_000 ? `${(distanceMeters / 1_000).toFixed(1)} km` : `${distanceMeters} m`;
}

function formatDuration(durationSeconds: number): string {
  return `${Math.max(1, Math.round(durationSeconds / 60))} min`;
}
