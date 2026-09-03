import type { Plan, PlanPlace, PlanRouteSegment, TravelBooking, Task } from "@c-assistant/core";

export function bookingStatusLabel(status: TravelBooking["status"]): string {
  return status === "needs_review" ? "Needs review" : status[0]!.toUpperCase() + status.slice(1);
}

export function googleMapsSearchUrl(query: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query.trim())}`;
}

export function googleMapsRouteUrl(origin: PlanPlace, destination: PlanPlace, mode: PlanRouteSegment["mode"]): string {
  const originQuery = `${origin.name} ${origin.city ?? origin.locationLabel}`;
  const destinationQuery = `${destination.name} ${destination.city ?? destination.locationLabel}`;
  const travelMode = mode === "walking" ? "walking" : mode === "driving" ? "driving" : "transit";
  return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(originQuery)}&destination=${encodeURIComponent(destinationQuery)}&travelmode=${travelMode}`;
}

export function routeModeLabel(mode: PlanRouteSegment["mode"]): string {
  return ({ walking: "Walking route", transit: "Public transport", driving: "Driving route", unknown: "Route", rail: "Rail connection", flight: "Flight connection" } as Record<PlanRouteSegment["mode"], string>)[mode];
}

export function formatDistance(meters: number): string {
  return meters < 1_000 ? `${meters} m` : `${(meters / 1_000).toFixed(meters < 10_000 ? 1 : 0)} km`;
}

export function visibleDocumentPolicySources(plan: Plan): Plan["sources"] {
  const documentPolicyPattern = /\b(?:e-?visa|visa|passport|immigration|entry requirements?|residence permit|travel authori[sz]ation|border control|customs|consular)\b/i;
  return plan.sources.filter((source) => documentPolicyPattern.test(`${source.title} ${source.authority} ${source.url}`));
}

export function appDownloads(task: Task, sources: Plan["sources"]): Array<{ label: string; url: string }> {
  const title = `${task.title} ${task.description ?? ""}`.toLocaleLowerCase();
  const definitions = [
    { pattern: /wechat/, source: /wechat/i, label: "Download WeChat", fallback: "https://www.wechat.com/" },
    { pattern: /alipay/, source: /alipay/i, label: "Download Alipay", fallback: "https://www.alipay.com/" },
    { pattern: /amap/, source: /amap/i, label: "Download Amap", fallback: "https://mobile.amap.com/" },
    { pattern: /china mobile/, source: /china mobile/i, label: "View China Mobile", fallback: "https://www.10086.cn/" }
  ];
  return definitions.filter((item) => item.pattern.test(title)).map((item) => {
    const officialSource = sources.find((source) => item.source.test(`${source.title} ${source.authority}`));
    return { label: item.label, url: officialSource?.url ?? item.fallback };
  });
}
