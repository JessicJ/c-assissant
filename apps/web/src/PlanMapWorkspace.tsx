import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import leafletCss from "leaflet/dist/leaflet.css?inline";
import type { DestinationArrivalEvent, ItineraryDay, PlanPlace, PlanPresentation, PlanRouteSegment, WorkspaceSnapshot } from "@c-assistant/core";
import tripMapCss from "./trip-map/trip-map-public.css?inline";
import tripMapThemeCss from "./trip-map/trip-map-public-theme.css?inline";
import tripMapEditorialCss from "./trip-map/trip-map-editorial.css?inline";
import { CurrentDestinationWeather } from "./CurrentDestinationWeather.js";
import { displayTripTitle } from "./trip-title.js";

type NativeTrip = {
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

type NativePoi = {
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

type NativeDay = {
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

type MapSearchResponse = {
  status?: string;
  data?: Array<{ location?: string }>;
};

type NativeRuntime = {
  TripMapCore?: { mount(input: { root: HTMLElement; trip: NativeTrip; onStateChange: (state: NativeStateSnapshot) => Promise<void>; readOnly: boolean; onEditBlocked: () => void }): unknown };
  L?: typeof L;
};

type NativeStateSnapshot = {
  assignments: Record<string, string>;
  priorities: Record<string, string>;
  orders: Record<string, string[]>;
  replanPrompt?: string;
};

type ReplanResponse = WorkspaceSnapshot & { workspace?: WorkspaceSnapshot; error?: string };
type MapProgress = { tone: "working" | "success" | "error"; step: number; text: string };

const categoryLabels: Record<string, string> = {
  hotel: "Accommodation", art: "Art", sight: "Sights", museum: "Museums", food: "Food", bar: "Bars",
  coffee: "Coffee", dessert: "Desserts", market: "Markets", shopping: "Shopping", transport: "Transport",
  nature: "Nature", winery: "Wineries", night: "Nightlife", backup: "Backup", "local-life": "Local life"
};

const priorityLabels = {
  must: "Must visit", preferred: "Preferred", nearby: "If nearby", archive: "Archived",
  pending: "Needs review", booked: "Booked"
};

export function PlanMapWorkspace({ planId, planVersion, presentation, partySize, arrivals, editable, onWorkspace, onStatus, onRevise, onError }: {
  planId: string;
  planVersion: number;
  presentation: PlanPresentation;
  partySize?: number | undefined;
  arrivals?: DestinationArrivalEvent[];
  editable: boolean;
  onWorkspace: (workspace: WorkspaceSnapshot) => Promise<void>;
  onStatus: (message: string) => void;
  onError: (message: string) => void;
  onRevise: (message?: string) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const callbacksRef = useRef({ onWorkspace, onStatus, onRevise, onError });
  callbacksRef.current = { onWorkspace, onStatus, onRevise, onError };
  const [resolved, setResolved] = useState<PlanPresentation | null>(null);
  const [resolving, setResolving] = useState(false);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState<MapProgress | null>(null);
  const retryRef = useRef<null | (() => Promise<void>)>(null);

  useEffect(() => {
    let cancelled = false;
    setResolved(null);
    setResolving(true);
    void resolveMissingCoordinates(presentation)
      .then((next) => { if (!cancelled) setResolved(next); })
      .catch((caught) => { if (!cancelled) { callbacksRef.current.onError(caught instanceof Error ? caught.message : "Unable to locate places on the map."); setResolved(presentation); } })
      .finally(() => { if (!cancelled) setResolving(false); });
    return () => { cancelled = true; };
  }, [planId, planVersion, presentation]);

  const nativeTrip = useMemo(() => resolved ? toNativeTrip(planId, planVersion, resolved, partySize) : null, [partySize, planId, planVersion, resolved]);

  useEffect(() => {
    if (!hostRef.current || !nativeTrip) return;
    const runtime = globalThis as NativeRuntime;
    runtime.L = L;
    if (!runtime.TripMapCore) {
      callbacksRef.current.onError("The trip map did not finish loading. Please refresh the page.");
      return;
    }
    const shadow = hostRef.current.shadowRoot ?? hostRef.current.attachShadow({ mode: "open" });
    shadow.innerHTML = `<style>${leafletCss}\n${shadowCss(tripMapCss)}\n${shadowCss(tripMapThemeCss)}\n${shadowCss(tripMapEditorialCss)}\n${embedOverrides}</style>${nativeShell}`;
    const appRoot = shadow.querySelector<HTMLElement>("#trip-app");
    if (!appRoot) return;
    runtime.TripMapCore.mount({ root: appRoot, trip: nativeTrip, readOnly: !editable, onEditBlocked: () => callbacksRef.current.onRevise("I want to adjust the current trip. Create a replacement draft based on the active plan without overwriting it."), onStateChange: async (state) => {
      setSaving(true);
      setProgress({ tone: "working", step: 1, text: "Saving map changes…" });
      try {
        const response = await fetch(`/api/plans/${encodeURIComponent(planId)}/presentation`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ expectedVersion: planVersion, ...state })
        });
        const payload = await response.json() as WorkspaceSnapshot & { error?: string };
        if (!response.ok || !payload.activePlan) throw new Error(payload.error ?? "The map changes could not be saved to the plan.");
        await callbacksRef.current.onWorkspace(payload);
        const requestReplan = async () => {
          setSaving(true);
          setProgress({ tone: "working", step: 2, text: "Sent to Landi. Checking routes and opening details…" });
          const progressTimers = [
            window.setTimeout(() => setProgress({ tone: "working", step: 3, text: "Rebuilding the day plan…" }), 18_000),
            window.setTimeout(() => setProgress({ tone: "working", step: 3, text: "Still working on the itinerary. Please wait…" }), 75_000)
          ];
          try {
            const replanResponse = await fetch("/api/agent/chat", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                mode: "revise_plan",
                message: state.replanPrompt || "Please review the places and order I just saved on the map, then rebuild the complete itinerary.",
                expectedPlanId: payload.activePlan.id,
                expectedVersion: payload.activePlan.version,
                impactConfirmed: true
              })
            });
            const replanned = await replanResponse.json() as ReplanResponse;
            const nextWorkspace = replanned.workspace ?? (replanned.activePlan ? replanned : undefined);
            if (!replanResponse.ok || !nextWorkspace?.activePlan) throw new Error(replanned.error ?? "Landi cannot rebuild the itinerary right now.");
            await callbacksRef.current.onWorkspace(nextWorkspace);
            retryRef.current = null;
            setProgress({ tone: "success", step: 4, text: "New itinerary ready" });
            callbacksRef.current.onStatus("Landi rebuilt the itinerary using your map changes.");
            window.setTimeout(() => setProgress((current) => current?.tone === "success" ? null : current), 2600);
          } catch (caught) {
            const message = caught instanceof Error ? caught.message : "Landi cannot rebuild the itinerary right now.";
            setProgress({ tone: "error", step: 2, text: message });
            callbacksRef.current.onError(message);
          } finally {
            progressTimers.forEach((timer) => window.clearTimeout(timer));
            setSaving(false);
          }
        };
        retryRef.current = requestReplan;
        callbacksRef.current.onStatus("Map changes sent to Landi. Rebuilding the itinerary…");
        await requestReplan();
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : "The map changes could not be saved to the plan.";
        setProgress({ tone: "error", step: 1, text: message });
        callbacksRef.current.onError(message);
      } finally {
        setSaving(false);
      }
    } });
  }, [editable, nativeTrip, planId, planVersion]);

  if (presentation.kind !== "itinerary" || !presentation.places.length) return null;
  return <section className={`native-trip-workspace${saving ? " is-map-processing" : ""}`} aria-label="Interactive trip plan" aria-busy={saving}>
    <CurrentDestinationWeather presentation={presentation} arrivals={arrivals ?? []} />
    {resolving ? <div className="trip-map-loading">Locating planned places and creating map markers…</div> : null}
    {progress ? <div className={`map-agent-progress ${progress.tone}`} role="status" aria-live="polite"><span className="map-agent-progress-icon" aria-hidden="true">{progress.tone === "success" ? "✓" : progress.tone === "error" ? "!" : ""}</span><div><strong>{progress.text}</strong><span>{progress.tone === "working" ? `Step ${progress.step} of 4` : progress.tone === "success" ? "Changes synced to the plan" : "Your changes are still saved"}</span><i><b style={{ width: `${progress.tone === "success" ? 100 : progress.step * 25}%` }} /></i></div>{progress.tone === "error" && retryRef.current ? <button type="button" onClick={() => void retryRef.current?.()}>Retry</button> : null}</div> : null}
    <div ref={hostRef} />
  </section>;
}

async function resolveMissingCoordinates(presentation: PlanPresentation): Promise<PlanPresentation> {
  const missing = presentation.places.filter((place) => !validCoords(place.coordinates));
  if (!missing.length) return presentation;
  const resolved = new Map<string, [number, number]>();
  const queue = [...missing];
  await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => {
    while (queue.length) {
      const place = queue.shift();
      if (!place) return;
      const query = [place.name, place.localizedName, place.locationLabel, place.city].filter(Boolean).join(" ");
      const cached = readCoordinateCache(query);
      if (cached) { resolved.set(place.id, cached); continue; }
      try {
        const response = await fetch(`/api/maps/places?query=${encodeURIComponent(query)}${place.city ? `&region=${encodeURIComponent(place.city)}` : ""}`);
        if (!response.ok) continue;
        const payload = await response.json() as MapSearchResponse;
        const coordinates = parseProviderLocation(payload.status === "available" ? payload.data?.[0]?.location : undefined);
        if (coordinates) { resolved.set(place.id, coordinates); writeCoordinateCache(query, coordinates); }
      } catch { /* An unresolved place remains visible in the written Plan but is omitted from the map. */ }
    }
  }));
  return {
    ...presentation,
    places: presentation.places.map((place) => resolved.has(place.id) ? { ...place, coordinates: resolved.get(place.id)! } : place)
  };
}

function toNativeTrip(planId: string, planVersion: number, presentation: PlanPresentation, partySize?: number): NativeTrip {
  const scheduledDayCount = new Map<string, number>();
  for (const day of presentation.days) {
    for (const placeId of new Set(day.placeIds)) scheduledDayCount.set(placeId, (scheduledDayCount.get(placeId) ?? 0) + 1);
  }
  const pois = presentation.places
    .filter((place) => validCoords(place.coordinates))
    .map((place) => toNativePoi(place, (scheduledDayCount.get(place.id) ?? 0) > 1));
  const validIds = new Set(pois.map((poi) => poi.id));
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
    days: presentation.days.map((day) => toNativeDay(day, presentation.routeSegments, validIds))
  };
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

function toNativeDay(day: ItineraryDay, segments: PlanRouteSegment[], validIds: Set<string>): NativeDay {
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
    summary: day.summary ?? "Follow the latest opening, reservation, and transport information for the day.",
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

function parseProviderLocation(value?: string): [number, number] | undefined {
  if (!value) return undefined;
  const [longitude, latitude] = value.split(",").map(Number);
  return Number.isFinite(latitude) && Number.isFinite(longitude) ? [latitude!, longitude!] : undefined;
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

function validCoords(value: unknown): value is [number, number] {
  return Array.isArray(value) && value.length === 2 && value.every(Number.isFinite);
}

function dateSummary(presentation: PlanPresentation): string {
  const dates = presentation.startDate && presentation.endDate ? `${presentation.startDate} — ${presentation.endDate}` : "Exact year and dates still need confirmation";
  return `${dates}. Open a daily route, map marker, or place card for details. You can also adjust assignments, priorities, and same-day order.`;
}

function localizeCity(value?: string): string {
  if (!value) return "";
  return value;
}

function readCoordinateCache(query: string): [number, number] | undefined {
  try {
    const value = JSON.parse(localStorage.getItem(`landi:map-coordinate:${query}`) ?? "null") as { coordinates?: [number, number]; savedAt?: number } | null;
    if (value?.coordinates && validCoords(value.coordinates) && value.savedAt && Date.now() - value.savedAt < 30 * 24 * 60 * 60 * 1000) return value.coordinates;
  } catch { /* Ignore an invalid local cache entry. */ }
  return undefined;
}

function writeCoordinateCache(query: string, coordinates: [number, number]): void {
  try { localStorage.setItem(`landi:map-coordinate:${query}`, JSON.stringify({ coordinates, savedAt: Date.now() })); } catch { /* The map still works without a cache. */ }
}

function shadowCss(value: string): string {
  return value.replaceAll(":root", ":host");
}

const embedOverrides = `
:host { display: block; width: 100%; color: #17212b; font-family: var(--trip-font); }
.is-readonly .place-actions, .is-readonly .priority-controls, .is-readonly .assignment-controls, .is-readonly .change-summary { display: none !important; }
.trip-app { height: min(760px, calc(100vh - 180px)); min-height: 680px; }
@media (max-width: 820px) {
  .trip-app, .trip-app.is-detail-browse { height: calc(100dvh - 150px); min-height: 600px; }
  .leaflet-control-layers { max-height: 44px; overflow: hidden; }
  .leaflet-control-layers-expanded { max-height: 52vh; overflow-y: auto; }
}
`;

const nativeShell = `
<main class="trip-app" id="trip-app">
  <aside class="planner-shell" aria-label="Trip plan">
    <section class="overview-panel" id="trip-overview"><header class="trip-header">
      <div class="trip-eyebrow" id="trip-eyebrow"></div><h1 class="trip-title" id="trip-title"></h1><p class="trip-summary" id="trip-summary"></p>
      <div class="trip-stats" aria-label="Trip overview"><div class="trip-stat"><strong id="trip-day-count">0</strong><span>Trip days</span></div><div class="trip-stat"><strong id="trip-party-count">—</strong><span>Travelers</span></div><div class="trip-stat"><strong id="trip-day-trip-count">0</strong><span>Day trips</span></div><div class="trip-stat"><strong id="trip-place-count">0</strong><span>Planned places</span></div></div>
    </header><div class="trip-quick-controls"><div class="trip-city-tabs" id="trip-city-tabs" aria-label="Jump to a city"></div><label class="candidate-toggle"><input type="checkbox" id="show-candidates-toggle"><span>Show optional places</span></label></div>
    <section class="section-block" aria-labelledby="days-heading"><div class="section-heading-row"><div><div class="section-kicker">Start with the route</div><h2 class="section-title" id="days-heading">Daily routes</h2></div></div><div class="day-list" id="day-list"></div></section>
    <section class="section-block" aria-labelledby="quick-heading"><div class="section-heading-row"><div><div class="section-kicker">Explore every option</div><h2 class="section-title" id="quick-heading">Places</h2></div></div>
      <div class="filter-grid"><input class="filter-control search-control" id="quick-search" type="search" data-filter-field="search" placeholder="Search places, neighborhoods, or notes" aria-label="Search places"><select class="filter-control" id="filter-city" data-filter-field="city" aria-label="Filter by city or area"></select><select class="filter-control" id="filter-category" data-filter-field="category" aria-label="Filter by category"></select><select class="filter-control" id="filter-priority" data-filter-field="priority" aria-label="Filter by priority"></select><select class="filter-control" id="filter-plan" data-filter-field="plan" aria-label="Filter by itinerary assignment"></select></div>
      <div class="quick-list-meta"><span id="quick-count">0 places</span><button class="text-button" id="clear-filters" type="button">Clear filters</button></div><div class="quick-list" id="quick-list"></div>
    </section></section>
    <section class="detail-browse" id="detail-browse" hidden><nav class="day-rail" id="day-rail" aria-label="Switch itinerary by date"></nav><section class="day-list-panel" id="day-place-list" aria-label="Day itinerary"></section><article class="poi-detail" id="poi-detail" aria-live="polite"></article></section>
  <section class="change-summary" id="change-summary" hidden aria-live="polite"><div class="change-heading"><div><h2>Itinerary updated</h2><p id="change-summary-text"></p></div></div><div class="change-actions"><button class="text-button" id="undo-change" type="button">Undo last change</button><span class="muted">Saving will send the update directly to Landi for replanning</span></div></section></aside>
  <section class="map-stage" aria-label="Map"><div id="map" aria-label="Trip map"></div><div class="map-note" id="map-note" aria-live="polite"></div></section>
  <section class="dialog-backdrop" id="impact-dialog" hidden role="dialog" aria-modal="true" aria-labelledby="impact-title"><div class="dialog-panel"><div class="dialog-heading"><div><div class="section-kicker">This change has a larger impact</div><h2 id="impact-title">Confirm before saving</h2></div></div><p>Please review these effects:</p><ul id="impact-reasons"></ul><p class="muted">After saving, the route will remain marked for replanning. No unverified route will be generated automatically.</p><div class="dialog-actions"><button class="text-button" id="cancel-impact" type="button">Cancel</button><button class="text-button primary" id="confirm-impact" type="button">Confirm change</button></div></div></section>
  <section class="dialog-backdrop" id="replan-dialog" hidden role="dialog" aria-modal="true" aria-labelledby="replan-title"><div class="dialog-panel"><div class="dialog-heading"><div><div class="section-kicker">My itinerary changes</div><h2 id="replan-title">Ask Landi to replan</h2></div><button class="icon-button" id="close-replan" type="button" aria-label="Close">×</button></div><p class="muted">The text below includes every change and affected date and will be sent directly to the Landi conversation.</p><textarea id="replan-text" readonly aria-label="Replanning request"></textarea><div class="dialog-actions"><button class="text-button primary" id="copy-replan" type="button">Send to Landi</button></div><div class="copy-feedback" id="copy-feedback" aria-live="polite"></div></div></section>
</main>`;
