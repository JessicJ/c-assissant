import type { Plan, PlanPlace, PlanRouteSegment } from "@c-assistant/core";
import { googleMapsRouteUrl, googleMapsSearchUrl, routeModeLabel } from "./plan-external-display.js";

export function TravelExternalHandoffs({ accommodation, foodPlaces, routeHandoffs, plan }: { accommodation: Plan["configuration"]["accommodation"]; foodPlaces: PlanPlace[]; routeHandoffs: PlanRouteSegment[]; plan: Plan }) {
  const places = new Map((plan.presentation?.places ?? []).map((place) => [place.id, place]));
  const handoffs: Array<{ key: string; eyebrow: string; title: string; detail: string; url: string }> = [];
  if (accommodation.name) {
    handoffs.push({ key: "accommodation", eyebrow: accommodation.status === "confirmed" ? "Accommodation linked" : "Accommodation option", title: accommodation.name, detail: accommodation.address ?? "Check the location on the map. Landi will not book or pay on your behalf.", url: googleMapsSearchUrl(`${accommodation.name} ${accommodation.address ?? accommodation.location ?? plan.location}`) });
  }
  for (const place of foodPlaces) {
    handoffs.push({ key: `food-${place.id}`, eyebrow: "Food stop", title: place.localizedName ?? place.name, detail: "Open the map for location, opening information, and available next steps. Landi has not placed an order or reservation.", url: googleMapsSearchUrl(`${place.name} ${place.city ?? place.locationLabel}`) });
  }
  for (const segment of routeHandoffs) {
    const origin = places.get(segment.originPlaceId);
    const destination = places.get(segment.destinationPlaceId);
    if (!origin || !destination) continue;
    handoffs.push({ key: `route-${segment.id}`, eyebrow: "Route handoff", title: `${origin.localizedName ?? origin.name} → ${destination.localizedName ?? destination.name}`, detail: `${routeModeLabel(segment.mode)}${segment.durationMinutes ? ` · about ${segment.durationMinutes} min` : ""}. Open it to confirm the live route, navigation, or ride.`, url: googleMapsRouteUrl(origin, destination, segment.mode) });
  }
  if (!handoffs.length) return null;
  return <section className="travel-external-handoffs" aria-labelledby="external-handoffs-title"><header><div><span className="section-eyebrow">LANDI HANDOFF</span><strong id="external-handoffs-title">External apps</strong></div><small>Opening a link does not mean the action is complete</small></header><div className="travel-external-handoff-grid">{handoffs.map((handoff) => <article key={handoff.key}><span>{handoff.eyebrow}</span><strong>{handoff.title}</strong><p>{handoff.detail}</p><a href={handoff.url} target="_blank" rel="noreferrer">Open Google Maps ↗</a></article>)}</div></section>;
}
