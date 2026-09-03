import type { ItineraryDay, PlanPlace, PlanPresentation, PlanRouteSegment } from "@c-assistant/core";
import { displayTripTitle } from "./trip-title.js";

export type NativeTrip = {
  slug: string;
  dataRevision: string;
  title: string;
  eyebrow: string;
  summary: string;
  map: { center: [number, number]; zoom: number };
  cities: Record<string, string>;
  categories: Record<string, string>;
  priorities: Record<string, string>;
  partySize?: number | undefined;
  dayTripCount: number;
  pois: NativePoi[];
  days: NativeDay[];
};

export type NativePoi = {
  id: string;
  name: string;
  name_zh: string;
  city: string;
  area: string;
  category: string;
  priority: string;
  coords: [number, number];
  note: string;
  plan: string;
  tip: string;
  imageQuery: string;
  officialUrl?: string;
  mapUrl?: string;
  experienceUrl?: string;
  durationMinutes?: number;
  recurring?: boolean;
};

export type NativeDay = {
  id: string;
  date: string;
  title: string;
  city: string;
  summary: string;
  capacity: number;
  anchors: string[];
  routeStops: Array<{ poiId: string; order: number; time?: string; role?: string }>;
  candidates: string[];
  transitSegments: Array<{ fromPoiId: string; toPoiId: string; mode: string; minutes?: number; label: string; detail?: string }>;
  routeGeometry?: Array<[number, number]>;
  routeGeometryMode?: string;
  routeGeometrySource?: string;
  routeGeometryReviewedAt?: string;
  routeReview?: ItineraryDay["routeReview"];
};

export type NativeStateSnapshot = {
  assignments: Record<string, string>;
  priorities: Record<string, string>;
  orders: Record<string, string[]>;
  replanPrompt?: string;
};

const categoryLabels: Record<string, string> = {
  hotel: "Accommodation", art: "Art", sight: "Sights", museum: "Museums", food: "Food", bar: "Bars",
  coffee: "Coffee", dessert: "Desserts", market: "Markets", shopping: "Shopping", transport: "Transport",
  nature: "Nature", winery: "Wineries", night: "Nightlife", backup: "Backup", "local-life": "Local life"
};

const priorityLabels = {
  must: "Must visit", preferred: "Preferred", nearby: "If nearby", archive: "Archived",
  pending: "Needs review", booked: "Booked"
};

export function toNativeTrip(planId: string, planVersion: number, presentation: PlanPresentation, partySize?: number): NativeTrip {
  const scheduledDayCount = new Map<string, number>();
  for (const day of presentation.days) {
    for (const placeId of new Set(day.placeIds)) scheduledDayCount.set(placeId, (scheduledDayCount.get(placeId) ?? 0) + 1);
  }
  const pois = presentation.places
    .filter((place) => validCoords(place.coordinates))
    .map((place) => toNativePoi(place, (scheduledDayCount.get(place.id) ?? 0) > 1));
  const validIds = new Set(pois.map((poi) => poi.id));
  const poiById = new Map(pois.map((poi) => [poi.id, poi]));
  const cities = Object.fromEntries([...new Set(pois.map((poi) => poi.city))].map((city) => [city, localizeCity(city)]));
  const categories = Object.fromEntries([...new Set(pois.map((poi) => poi.category))].map((category) => [category, categoryLabels[category] ?? category]));
  const points = pois.map((poi) => poi.coords);
  return {
    slug: `landi:${planId}`,
    dataRevision: String(planVersion),
    title: displayTripTitle(presentation),
    eyebrow: "LANDI · A trip plan that stays up to date",
    summary: dateSummary(presentation),
    map: { center: mapCenter(points), zoom: points.length > 1 ? 11 : 13 },
    cities,
    categories,
    priorities: priorityLabels,
    ...(partySize ? { partySize } : {}),
    dayTripCount: countDayTrips(presentation.days),
    pois,
    days: presentation.days.map((day) => toNativeDay(day, presentation.routeSegments, validIds, poiById))
  };
}

export function parseProviderLocation(value?: string): [number, number] | undefined {
  if (!value) return undefined;
  const [longitude, latitude] = value.split(",").map(Number);
  return Number.isFinite(latitude) && Number.isFinite(longitude) ? [latitude!, longitude!] : undefined;
}

export function validCoords(value: unknown): value is [number, number] {
  return Array.isArray(value) && value.length === 2 && value.every(Number.isFinite);
}

function countDayTrips(days: ItineraryDay[]): number {
  const scheduled = days.filter((day) => day.city && day.city.toLowerCase() !== "transit");
  return scheduled.filter((day, index) => {
    const previousCity = scheduled[index - 1]?.city;
    const nextCity = scheduled[index + 1]?.city;
    return Boolean(previousCity && nextCity && previousCity === nextCity && day.city !== previousCity);
  }).length;
}

function toNativePoi(place: PlanPlace, recurring = false): NativePoi {
  return {
    id: place.id,
    name: place.name,
    name_zh: place.localizedName ?? place.name,
    city: place.city ?? place.locationLabel,
    area: place.area ?? place.locationLabel,
    category: normalizeCategory(place.category),
    priority: place.priority === "recheck" ? "pending" : place.priority,
    coords: place.coordinates!,
    note: place.whyWorthIt,
    plan: [place.plan, ...place.detailSections.flatMap((section) => [section.body, ...(section.items ?? [])]).filter(Boolean)].join("\n"),
    tip: place.tip ?? "Recheck opening hours, reservations, and transport status before departure.",
    imageQuery: `${place.name} ${place.city ?? place.locationLabel}`,
    ...(place.durationMinutes ? { durationMinutes: place.durationMinutes } : {}),
    ...(recurring ? { recurring: true } : {}),
    ...(place.officialUrl ? { officialUrl: place.officialUrl } : {}),
    ...(place.mapUrl ? { mapUrl: place.mapUrl } : {}),
    ...(place.experienceUrl ? { experienceUrl: place.experienceUrl } : {})
  };
}

function toNativeDay(day: ItineraryDay, segments: PlanRouteSegment[], validIds: Set<string>, pois: Map<string, NativePoi>): NativeDay {
  const sourceStops: NonNullable<ItineraryDay["stops"]> = day.stops?.length
    ? [...day.stops].sort((a, b) => a.order - b.order)
    : day.placeIds.map((placeId, order) => ({ placeId, order }));
  const routeStops = sourceStops
    .filter((stop) => validIds.has(stop.placeId))
    .map((stop) => ({ poiId: stop.placeId, order: stop.order, ...(stop.time ? { time: stop.time } : {}), ...(stop.role ? { role: stop.role } : {}) }));
  const reviewedGeometry = Boolean(day.routeGeometry?.length && day.routeGeometryReviewedAt && day.routeReview?.routingMethod && day.routeReview.sequenceRationale);
  return {
    id: day.id,
    date: day.date ?? day.shortLabel ?? day.label,
    title: day.title ?? day.label,
    city: day.city ?? "Trip day",
    summary: guideToneDaySummary(day, routeStops, pois),
    capacity: day.capacity ?? Math.max(routeStops.length, 4),
    anchors: (day.anchors ?? day.placeIds.slice(0, 3)).filter((id) => validIds.has(id)),
    routeStops,
    candidates: (day.candidates ?? []).filter((id) => validIds.has(id)),
    transitSegments: segments.filter((segment) => {
      if (segment.dayId !== day.id) return false;
      return validIds.has(segment.originPlaceId) && validIds.has(segment.destinationPlaceId)
        && routeStops.some((stop, index) => stop.poiId === segment.originPlaceId && routeStops[index + 1]?.poiId === segment.destinationPlaceId);
    }).map((segment) => ({
      fromPoiId: segment.originPlaceId,
      toPoiId: segment.destinationPlaceId,
      mode: segment.mode,
      ...(segment.durationMinutes ? { minutes: segment.durationMinutes } : {}),
      label: segment.label ?? segment.detail ?? (segment.verification === "verified" ? "Verified transfer" : "This transfer still needs review"),
      ...(segment.detail ? { detail: segment.detail } : {})
    })),
    ...(day.routeReview ? { routeReview: day.routeReview } : {}),
    ...(reviewedGeometry ? {
      routeGeometry: day.routeGeometry,
      routeGeometryMode: ["walking", "driving", "transit"].includes(day.routeGeometryMode ?? "") ? day.routeGeometryMode : "mixed",
      routeGeometrySource: day.routeReview!.routingMethod,
      routeGeometryReviewedAt: day.routeGeometryReviewedAt
    } : {})
  };
}

function guideToneDaySummary(day: ItineraryDay, routeStops: NativeDay["routeStops"], pois: Map<string, NativePoi>): string {
  const raw = softenOperationalCopy(day.summary ?? "Follow the latest opening, reservation, and transport information for the day.");
  const firstStop = routeStops.map((stop) => pois.get(stop.poiId)).find((poi) => poi && poi.category !== "hotel");
  const city = day.city?.trim();
  const context = `${day.title ?? ""} ${raw} ${firstStop?.category ?? ""}`.toLocaleLowerCase();
  if (/\b(arriv\w*|airport|terminal|immigration|baggage|luggage)\b/.test(context)) {
    return `${city ? `Ease into ${city} today.` : "Ease into the trip today."} ${raw}`;
  }
  if (/\b(depart|flight|rail|station|transfer)\b/.test(context)) {
    return `Keep this travel day simple. ${raw}`;
  }
  if (city && firstStop) return `Let ${city} unfold from ${firstStop.name}. ${raw}`;
  if (city) return `Let ${city} set the pace today. ${raw}`;
  return `Let the day unfold at an easy travel pace. ${raw}`;
}

function softenOperationalCopy(value: string): string {
  return value.trim()
    .replace(/\ballowing roughly\b/gi, "leave about")
    .replace(/\bUse the first full day for\b/gi, "Spend the first full day with")
    .replace(/\bContinue to\b/gi, "Continue toward")
    .replace(/\bThis protects\b/gi, "This keeps")
    .replace(/\bwhile covering\b/gi, "while still giving you")
    .replace(/\bFollow the latest\b/gi, "Leave room for the latest")
    .replace(/\bTransfer to the eventual ([^.;]+) by the route verified against its entrance\b/gi, "Then transfer to your $1 once the exact entrance route is checked")
    .replace(/\bNo sightseeing obligation is added tonight\.?/gi, "Keep tonight light; there is no sightseeing to chase.");
}

function mapCenter(points: Array<[number, number]>): [number, number] {
  if (!points.length) return [20, 0];
  return [points.reduce((sum, point) => sum + point[0], 0) / points.length, points.reduce((sum, point) => sum + point[1], 0) / points.length];
}

function normalizeCategory(value: string): string {
  const normalized = value.trim().toLocaleLowerCase();
  if (/transport|airport|station|rail|flight|transfer/.test(normalized)) return "transport";
  if (/hotel|hostel|lodg/.test(normalized)) return "hotel";
  if (/museum|gallery|art/.test(normalized)) return "art";
  if (/coffee|cafe/.test(normalized)) return "coffee";
  if (/dessert|sweet|pastr/.test(normalized)) return "dessert";
  if (/restaurant|food|bar|dining/.test(normalized)) return "food";
  if (/market|shopping|neighbou?rhood|district|avenue|canal|local/.test(normalized)) return "local-life";
  return "sight";
}

function dateSummary(presentation: PlanPresentation): string {
  const dates = presentation.startDate && presentation.endDate ? `${presentation.startDate} — ${presentation.endDate}` : "Exact year and dates still need confirmation";
  return `${dates}. Open a daily route, map marker, or place card for details. You can also adjust assignments, priorities, and same-day order.`;
}

function localizeCity(value?: string): string {
  if (!value) return "";
  return value;
}
