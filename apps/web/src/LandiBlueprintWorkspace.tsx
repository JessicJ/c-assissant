import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import L from "leaflet";
import leafletCss from "leaflet/dist/leaflet.css?inline";
import type { Plan, PlanPresentation } from "@c-assistant/core";
import {
  buildPendingItineraryEditForWorkspace,
  buildPendingItineraryMoveForWorkspace,
  buildBlueprintWorkspaceDisplay,
  detailDisplayForWorkspacePlace,
  filterGuideCards,
  guideFilterLabel,
  itineraryDisplayForWorkspace,
  compactPendingItineraryEdits,
  mergePendingItineraryEdit,
  pendingItineraryDraftSummary,
  scheduledDayIdForPlace,
  type BlueprintMapMarkerDisplay,
  type BlueprintMapPointDisplay,
  type BlueprintPlaceDisplay,
  type BlueprintWorkspaceArea,
  type BlueprintWorkspaceDisplay,
  type DetailPlaceDisplay,
  type GuideCardDisplay,
  type GuideFilter,
  type ItineraryCardDisplay,
  type ItineraryRouteRefreshDisplay,
  type PendingItineraryEditDisplay
} from "./landi-blueprint-workspace-display.js";

type BlueprintPanelMode = "explore" | "detail" | "placement";
type GoogleMapInstance = {
  fitBounds: (bounds: GoogleLatLngBounds, padding?: number) => void;
  getZoom: () => number | undefined;
  panTo: (latLng: GoogleLatLngLiteral) => void;
  setCenter: (latLng: GoogleLatLngLiteral) => void;
  setZoom: (zoom: number) => void;
};
type GoogleLatLngLiteral = { lat: number; lng: number };
type GoogleLatLngBounds = { extend: (latLng: GoogleLatLngLiteral) => void };
type GoogleMapLayer = { setMap: (map: GoogleMapInstance | null) => void };
type GoogleMapsNamespace = {
  Map: new (element: HTMLElement, options: Record<string, unknown>) => GoogleMapInstance;
  LatLngBounds: new () => GoogleLatLngBounds;
  LatLng: new (lat: number, lng: number) => object;
  OverlayView: new () => {
    getPanes: () => { overlayMouseTarget: HTMLElement };
    getProjection: () => { fromLatLngToDivPixel: (latLng: object) => { x: number; y: number } | null };
    setMap: (map: GoogleMapInstance | null) => void;
  };
  Polyline: new (options: Record<string, unknown>) => GoogleMapLayer;
  event: { clearInstanceListeners: (instance: object) => void };
};

declare const __LANDI_GOOGLE_MAPS_API_KEY__: string;

let leafletStylesMounted = false;
let googleMapsLoader: Promise<GoogleMapsNamespace> | null = null;
const MAP_MARKER_ANCHOR = { x: 16, y: 38 } as const;

export function LandiBlueprintWorkspace({ plan, presentation, onTaskToggle, onApplyItineraryEdits, onRequestRouteRefresh, itineraryEditBusy = false, routeRefreshBusy = false }: {
  plan: Plan;
  presentation: PlanPresentation;
  onTaskToggle: (planId: string, taskId: string, checked: boolean) => Promise<void>;
  onApplyItineraryEdits?: (edits: PendingItineraryEditDisplay[]) => Promise<void>;
  onRequestRouteRefresh?: (refresh: ItineraryRouteRefreshDisplay) => void;
  itineraryEditBusy?: boolean;
  routeRefreshBusy?: boolean;
}) {
  const workspace = useMemo(() => buildBlueprintWorkspaceDisplay(plan, presentation), [plan, presentation]);
  const [area, setArea] = useState<BlueprintWorkspaceArea>("itinerary");
  const dayStripRef = useRef<HTMLDivElement>(null);
  const dayDragRef = useRef<{ pointerId: number; startX: number; scrollLeft: number; dragged: boolean } | null>(null);
  const lastDayDragEndAtRef = useRef(0);
  const [selectedDayId, setSelectedDayId] = useState(workspace.initialDayId);
  const [selectedPlaceId, setSelectedPlaceId] = useState(workspace.initialPlaceId);
  const [panelMode, setPanelMode] = useState<BlueprintPanelMode>("explore");
  const [guideFilter, setGuideFilter] = useState<GuideFilter>("all");
  const [placementPlaceId, setPlacementPlaceId] = useState("");
  const [pendingEdits, setPendingEdits] = useState<PendingItineraryEditDisplay[]>([]);
  const [draggedPlaceId, setDraggedPlaceId] = useState("");
  const [dragOverDropId, setDragOverDropId] = useState("");
  const timelineListRef = useRef<HTMLDivElement>(null);
  const itineraryDragRef = useRef<{ pointerId: number; placeId: string; activeDropId: string } | null>(null);
  const selectedDay = workspace.days.find((day) => day.id === selectedDayId) ?? workspace.days[0];
  const selectedDetail = detailDisplayForWorkspacePlace(workspace, selectedPlaceId);
  const itinerary = itineraryDisplayForWorkspace(workspace, selectedDay?.id ?? "", pendingEdits);

  useEffect(() => {
    setPendingEdits([]);
  }, [plan.id, plan.version]);

  function selectPlace(placeId: string, mode: BlueprintPanelMode = "detail") {
    setSelectedPlaceId(placeId);
    const dayId = scheduledDayIdForPlace(workspace, placeId);
    if (dayId) setSelectedDayId(dayId);
    setPanelMode(mode);
  }

  function openPlacement(placeId: string) {
    setSelectedPlaceId(placeId);
    setPlacementPlaceId(placeId);
    setPanelMode("placement");
  }

  function stagePendingEdit(edit: PendingItineraryEditDisplay) {
    setPendingEdits((current) => mergePendingItineraryEdit(current, edit));
    setSelectedDayId(edit.dayId);
    setSelectedPlaceId(edit.placeId);
    setPanelMode("explore");
  }

  function clearPendingMovesForDay(dayId: string) {
    setPendingEdits((current) => current.filter((edit) => edit.kind !== "move_place_within_day" || edit.dayId !== dayId));
    setSelectedDayId(dayId);
    setPanelMode("explore");
  }

  function clearItineraryCardDrag() {
    itineraryDragRef.current = null;
    setDraggedPlaceId("");
    setDragOverDropId("");
  }

  function startItineraryCardDrag(event: PointerEvent<HTMLElement>, item: ItineraryCardDisplay) {
    if (!item.reorderable || !item.placeId || !selectedDay) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    itineraryDragRef.current = { pointerId: event.pointerId, placeId: item.placeId, activeDropId: "" };
    setDraggedPlaceId(item.placeId);
    setDragOverDropId("");
  }

  function moveItineraryCardDrag(event: PointerEvent<HTMLElement>) {
    const drag = itineraryDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    const dropId = nearestItineraryDropId(event.clientX, event.clientY);
    drag.activeDropId = dropId;
    setDragOverDropId(dropId);
  }

  function endItineraryCardDrag(event: PointerEvent<HTMLElement>) {
    const drag = itineraryDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    const dropId = nearestItineraryDropId(event.clientX, event.clientY) || drag.activeDropId;
    const placeId = drag.placeId;
    const position = dropPositionForId(dropId, placeId);
    itineraryDragRef.current = null;
    setDraggedPlaceId("");
    setDragOverDropId("");
    if (!selectedDay || !position) return;
    const nextPreviewOrder = moveItineraryPlaceOrder(scheduledBlockOrder(itinerary.items), placeId, position);
    if (sameItineraryPlaceOrder(nextPreviewOrder, savedBlockOrder(selectedDay.id))) {
      clearPendingMovesForDay(selectedDay.id);
      setSelectedPlaceId(placeId);
      return;
    }
    const edit = buildPendingItineraryMoveForWorkspace(workspace, { dayId: selectedDay.id, placeId, position });
    if (edit) stagePendingEdit(edit);
  }

  function cancelItineraryCardDrag(event: PointerEvent<HTMLElement>) {
    const drag = itineraryDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    clearItineraryCardDrag();
  }

  function nearestItineraryDropId(clientX: number, clientY: number): string {
    const list = timelineListRef.current;
    if (!list) return "";
    const listBox = list.getBoundingClientRect();
    if (clientX < listBox.left - 32 || clientX > listBox.right + 32 || clientY < listBox.top - 32 || clientY > listBox.bottom + 32) return "";
    const zones = [...list.querySelectorAll<HTMLElement>(".blueprint-itinerary-drop-zone")];
    let nearest = "";
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const zone of zones) {
      const box = zone.getBoundingClientRect();
      const centerY = box.top + box.height / 2;
      const distance = Math.abs(centerY - clientY);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = zone.dataset.dropId ?? "";
      }
    }
    return nearest;
  }

  function dropPositionForId(dropId: string, movingPlaceId: string): PendingItineraryEditDisplay["position"] | undefined {
    if (dropId === "end") return { kind: "end" };
    if (dropId.startsWith("before-")) return dropPositionBefore(dropId.slice("before-".length), movingPlaceId);
    return undefined;
  }

  function dropPositionBefore(targetKey: string, movingPlaceId: string): PendingItineraryEditDisplay["position"] {
    const withoutDragged = itinerary.items.filter((item) => item.placeId !== movingPlaceId);
    const targetIndex = withoutDragged.findIndex((item) => item.key === targetKey);
    const priorPlace = withoutDragged.slice(0, Math.max(0, targetIndex)).reverse().find((item) => item.placeId && item.routeAnchor);
    return priorPlace?.placeId ? { kind: "after", afterPlaceId: priorPlace.placeId } : { kind: "start" };
  }

  function savedBlockOrder(dayId: string): string[] {
    return scheduledBlockOrder(workspace.itineraries.find((candidate) => candidate.dayId === dayId)?.items ?? []);
  }

  function discardPendingEdits() {
    const savedItinerary = itineraryDisplayForWorkspace(workspace, selectedDay?.id ?? "", null);
    const savedPlaceIds = savedItinerary.items.flatMap((item) => item.kind === "block" && item.routeAnchor && item.placeId ? [item.placeId] : []);
    setPendingEdits([]);
    if (selectedPlaceId && !savedPlaceIds.includes(selectedPlaceId)) {
      setSelectedPlaceId(savedPlaceIds[0] ?? workspace.initialPlaceId);
    }
    setPanelMode("explore");
  }

  async function confirmPendingEdits() {
    if (!pendingEdits.length || itineraryEditBusy || !onApplyItineraryEdits) return;
    try {
      await onApplyItineraryEdits(compactPendingItineraryEdits(pendingEdits));
      setPendingEdits([]);
      setPanelMode("explore");
    } catch {
      // The parent surfaces the error and leaves the staged edits available.
    }
  }

  function selectMapPlace(placeId: string) {
    selectPlace(placeId);
  }

  function startDayTabDrag(event: PointerEvent<HTMLDivElement>) {
    dayDragRef.current = { pointerId: event.pointerId, startX: event.clientX, scrollLeft: event.currentTarget.scrollLeft, dragged: false };
    event.currentTarget.classList.add("dragging");
  }

  function moveDayTabDrag(event: PointerEvent<HTMLDivElement>) {
    const drag = dayDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const delta = event.clientX - drag.startX;
    if (Math.abs(delta) > 4) {
      drag.dragged = true;
    }
    event.currentTarget.scrollLeft = drag.scrollLeft - delta;
  }

  function endDayTabDrag(event: PointerEvent<HTMLDivElement>) {
    const drag = dayDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (drag.dragged) lastDayDragEndAtRef.current = performance.now();
    dayDragRef.current = null;
    event.currentTarget.classList.remove("dragging");
  }

  function selectDayTab(dayId: string) {
    setSelectedDayId(dayId);
    const firstPlaceId = itineraryDisplayForWorkspace(workspace, dayId, pendingEdits).items[0]?.placeId;
    if (firstPlaceId) setSelectedPlaceId(firstPlaceId);
  }

  function handleDayTabClick(event: MouseEvent<HTMLButtonElement>, dayId: string) {
    if (performance.now() - lastDayDragEndAtRef.current < 180) {
      event.preventDefault();
      return;
    }
    selectDayTab(dayId);
  }

  return <section className="blueprint-workspace" aria-label="Landi Blueprint workspace">
    <header className="blueprint-topbar">
      <div>
        <h2>{workspace.title}</h2>
        <p>{workspace.dateLabel}</p>
      </div>
      <nav aria-label="Plan workspace areas">{workspace.areas.map((item) => <button type="button" className={area === item ? "active" : ""} aria-current={area === item ? "page" : undefined} key={item} onClick={() => setArea(item)}>{areaLabel(item)}</button>)}</nav>
      {area === "itinerary" && pendingEdits.length ? <ItineraryEditBar edits={pendingEdits} onConfirm={confirmPendingEdits} onDiscard={discardPendingEdits} canConfirm={Boolean(onApplyItineraryEdits)} busy={itineraryEditBusy} /> : null}
    </header>

    {area === "itinerary" ? <div className="blueprint-itinerary-grid">
      <aside className="blueprint-timeline" aria-label="Daily itinerary cards">
        <div className="blueprint-day-tabs">
          <div className="blueprint-day-strip" aria-label="Itinerary days" ref={dayStripRef} onPointerDown={startDayTabDrag} onPointerMove={moveDayTabDrag} onPointerUp={endDayTabDrag} onPointerCancel={endDayTabDrag} onPointerLeave={endDayTabDrag}>{workspace.days.map((day) => <button type="button" className={day.id === selectedDay?.id ? "active" : ""} key={day.id} onClick={(event) => handleDayTabClick(event, day.id)}>
            <strong>{day.shortLabel ?? day.date ?? day.label}</strong>
            <span>{day.city ?? day.title ?? "Trip day"}</span>
          </button>)}</div>
        </div>
        <div className="blueprint-timeline-list" ref={timelineListRef}>
          {itinerary.items.map((item) => item.kind === "pending"
            ? <PendingItineraryCard item={item} selected={selectedPlaceId === item.placeId} onSelect={() => selectPlace(item.placeId)} key={item.key} />
            : <Fragment key={item.key}>
              {item.reorderable ? <ItineraryDropZone dropId={`before-${item.key}`} active={dragOverDropId === `before-${item.key}`} /> : null}
              <ItineraryBlockCard item={item} dragging={Boolean(item.placeId) && draggedPlaceId === item.placeId} selected={Boolean(item.placeId) && selectedPlaceId === item.placeId} onSelect={() => item.placeId ? selectPlace(item.placeId) : undefined} onDragStart={(event) => startItineraryCardDrag(event, item)} onDragMove={moveItineraryCardDrag} onDragEnd={endItineraryCardDrag} onDragCancel={cancelItineraryCardDrag} />
            </Fragment>)}
          {itinerary.items.some((item) => item.reorderable) ? <ItineraryDropZone dropId="end" active={dragOverDropId === "end"} /> : null}
          {!itinerary.items.length ? <p className="blueprint-empty-note">No itinerary blocks are available for this day.</p> : null}
        </div>
      </aside>

      <BlueprintMap routePlaces={itinerary.routePlaces} routeRefresh={itinerary.routeRefresh} markers={itinerary.markers} selectedPlaceId={selectedPlaceId} onSelectPlace={selectMapPlace} onRequestRouteRefresh={onRequestRouteRefresh} routeRefreshBusy={routeRefreshBusy} />

      <aside className="blueprint-side-panel" aria-label="Itinerary side panel">
        <div className="blueprint-panel-body">
          <ExplorePanel filters={workspace.guideFilters} cards={workspace.guideCards} filter={guideFilter} hidden={panelMode !== "explore"} onFilter={setGuideFilter} onSelect={selectPlace} onAdd={openPlacement} />
          {selectedDetail ? <DetailPanel detail={selectedDetail} hidden={panelMode !== "detail"} onBack={() => setPanelMode("explore")} onSelect={selectPlace} onAdd={openPlacement} /> : <p className="blueprint-empty-note" hidden={panelMode !== "detail"}>Select an itinerary block or guide card to open details.</p>}
          {placementPlaceId ? <PlacementPanel key={placementPlaceId} workspace={workspace} place={workspace.places.find((place) => place.id === placementPlaceId)} hidden={panelMode !== "placement"} selectedDayId={selectedDay?.id} onBack={() => setPanelMode("explore")} onPreview={stagePendingEdit} /> : null}
        </div>
      </aside>
    </div> : null}

    {area === "preparation" ? <section className="blueprint-page blueprint-preparation" aria-label="Preparation checklist">
      {workspace.preparationGroups.length ? workspace.preparationGroups.map((group) => <section className="blueprint-check-group" key={group.title}>
        <h4>{group.title}</h4>
        <div>{group.items.map((item) => <details className={item.checked ? "blueprint-check-item checked" : "blueprint-check-item"} key={item.id}>
          <summary>
            <input aria-label={item.title} type="checkbox" checked={item.checked} onClick={(event) => event.stopPropagation()} onChange={(event) => void onTaskToggle(plan.id, item.id, event.target.checked)} />
            <span><strong>{item.title}</strong></span>
          </summary>
          {item.description ? <p>{item.description}</p> : null}
        </details>)}</div>
      </section>) : <p className="blueprint-empty-note">No explicit travel preparation checklist is available for this plan.</p>}
    </section> : null}

    {area === "tips" ? <section className="blueprint-page blueprint-tips" aria-label="Destination tips">
      {workspace.tipGroups.length ? <div className="blueprint-tip-groups">{workspace.tipGroups.map((group) => <section className="blueprint-tip-group" key={group.theme}>
        <h4>{group.theme}</h4>
        <div className="blueprint-tip-grid">{group.tips.map((tip) => <article key={tip.id}>
          <p>{tip.body}</p>
          <small>{tip.context}</small>
        </article>)}</div>
      </section>)}</div> : <p className="blueprint-empty-note">No destination-specific tips were provided in this plan.</p>}
    </section> : null}

    {area === "sources" ? <section className="blueprint-page blueprint-sources" aria-label="Sources">
      {workspace.sources.length ? <div className="blueprint-source-list">{workspace.sources.map((source) => source.url ? <a href={source.url} target="_blank" rel="noreferrer" key={`${source.url}-${source.summary}`}>{source.summary}</a> : <p key={source.summary}>{source.summary}</p>)}</div> : <p className="blueprint-empty-note">No sources are listed for this plan yet.</p>}
    </section> : null}
  </section>;
}

function ItineraryEditBar({ edits, onConfirm, onDiscard, canConfirm, busy }: { edits: PendingItineraryEditDisplay[]; onConfirm: () => void; onDiscard: () => void; canConfirm: boolean; busy: boolean }) {
  const summary = pendingItineraryDraftSummary(edits);
  return <div className="blueprint-itinerary-edit-bar" role="toolbar" aria-label="Unsaved itinerary edits" aria-live="polite" aria-busy={busy || undefined}>
    <span><strong>{summary.changeLabel}</strong><small>{summary.affectedDayLabel}</small></span>
    <button type="button" onClick={onDiscard} disabled={busy}>Cancel</button>
    <button type="button" className="primary" onClick={() => void onConfirm()} disabled={!canConfirm || busy}>{busy ? "Applying..." : "Apply"}</button>
  </div>;
}

function scheduledBlockOrder(items: ItineraryCardDisplay[]): string[] {
  return items.filter((item) => item.kind === "block" && item.placeId && item.routeAnchor).map((item) => item.placeId);
}

function moveItineraryPlaceOrder(placeIds: string[], placeId: string, position: PendingItineraryEditDisplay["position"]): string[] {
  const next = placeIds.filter((candidate) => candidate !== placeId);
  let insertionIndex = 0;
  if (position.kind === "end") insertionIndex = next.length;
  if (position.kind === "after") {
    const afterIndex = next.indexOf(position.afterPlaceId);
    insertionIndex = afterIndex === -1 ? next.length : afterIndex + 1;
  }
  return [...next.slice(0, insertionIndex), placeId, ...next.slice(insertionIndex)];
}

function sameItineraryPlaceOrder(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function ItineraryDropZone({ dropId, active }: { dropId: string; active: boolean }) {
  return <div className={active ? "blueprint-itinerary-drop-zone active" : "blueprint-itinerary-drop-zone"} data-drop-id={dropId} />;
}

function ItineraryBlockCard({ item, selected, dragging, onSelect, onDragStart, onDragMove, onDragEnd, onDragCancel }: { item: ItineraryCardDisplay; selected: boolean; dragging: boolean; onSelect: () => void; onDragStart: (event: PointerEvent<HTMLElement>) => void; onDragMove: (event: PointerEvent<HTMLElement>) => void; onDragEnd: (event: PointerEvent<HTMLElement>) => void; onDragCancel: (event: PointerEvent<HTMLElement>) => void }) {
  const className = [
    "blueprint-itinerary-block",
    selected ? "selected" : "",
    dragging ? "dragging" : "",
    item.editState === "moved" ? "moved" : ""
  ].filter(Boolean).join(" ");
  return <article className={className}>
    <button type="button" className="blueprint-itinerary-drag-handle" aria-label={`Move ${item.title}`} disabled={!item.reorderable} onPointerDown={onDragStart} onPointerMove={onDragMove} onPointerUp={onDragEnd} onPointerCancel={onDragCancel}>↕</button>
    <button type="button" className="blueprint-itinerary-card-main" onClick={onSelect}>
      <span>{item.timeLabel}</span>
      <div>
        <strong>{item.title}</strong>
        {item.meta ? <small>{item.meta}</small> : null}
        {item.statusLabel ? <em>{item.statusLabel}</em> : null}
        {item.routeStatusLabel ? <em className="route-refresh">{item.routeStatusLabel}</em> : null}
      </div>
    </button>
  </article>;
}

function PendingItineraryCard({ item, selected, onSelect }: { item: ItineraryCardDisplay; selected: boolean; onSelect: () => void }) {
  return <button type="button" className={`blueprint-itinerary-block blueprint-itinerary-block-pending${selected ? " selected" : ""}`} aria-label={`Pending itinerary edit for ${item.title}`} onClick={onSelect}>
    <span>{item.timeLabel}</span>
    <div>
      <strong>{item.title}</strong>
      {item.meta ? <small>{item.meta}</small> : null}
      {item.statusLabel ? <em>{item.statusLabel}</em> : null}
    </div>
  </button>;
}

function BlueprintMap(props: { routePlaces: BlueprintMapPointDisplay[]; routeRefresh?: ItineraryRouteRefreshDisplay | undefined; markers: BlueprintMapMarkerDisplay[]; selectedPlaceId: string; onSelectPlace: (placeId: string) => void; onRequestRouteRefresh?: ((refresh: ItineraryRouteRefreshDisplay) => void) | undefined; routeRefreshBusy?: boolean }) {
  const [googleUnavailable, setGoogleUnavailable] = useState(false);
  const handleGoogleUnavailable = useCallback(() => setGoogleUnavailable(true), []);
  const apiKey = __LANDI_GOOGLE_MAPS_API_KEY__;
  if (apiKey && !googleUnavailable) return <GoogleBlueprintMap {...props} apiKey={apiKey} onUnavailable={handleGoogleUnavailable} />;
  return <LeafletBlueprintMap {...props} />;
}

function GoogleBlueprintMap({ routePlaces, routeRefresh, markers, selectedPlaceId, onSelectPlace, onRequestRouteRefresh, routeRefreshBusy, apiKey, onUnavailable }: { routePlaces: BlueprintMapPointDisplay[]; routeRefresh?: ItineraryRouteRefreshDisplay | undefined; markers: BlueprintMapMarkerDisplay[]; selectedPlaceId: string; onSelectPlace: (placeId: string) => void; onRequestRouteRefresh?: ((refresh: ItineraryRouteRefreshDisplay) => void) | undefined; routeRefreshBusy?: boolean; apiKey: string; onUnavailable: () => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<GoogleMapInstance | null>(null);
  const mapsRef = useRef<GoogleMapsNamespace | null>(null);
  const layersRef = useRef<GoogleMapLayer[]>([]);
  const lastFitKeyRef = useRef("");
  const [mapReady, setMapReady] = useState(false);
  const points = markers.filter((marker) => validCoordinates(marker.coordinates));
  const routeLatLngs = routePlaces.filter((place) => validCoordinates(place.coordinates)).map((place) => googleLatLngForCoordinates(place.coordinates!));
  const fitLatLngs = routeLatLngs.length ? routeLatLngs : points.map((marker) => googleLatLngForCoordinates(marker.coordinates!));
  const fitKey = [
    routePlaces.filter((place) => validCoordinates(place.coordinates)).map((place) => `route:${place.placeId}:${place.coordinates!.join(",")}`).join("|"),
    points.map((marker) => `marker:${marker.placeId}:${marker.coordinates!.join(",")}:${marker.markerState}:${marker.type}`).join("|")
  ].join("::");

  useEffect(() => {
    if (!hostRef.current || mapRef.current) return;
    let cancelled = false;
    const fallbackTimer = window.setTimeout(() => {
      if (!mapRef.current) onUnavailable();
    }, 10000);
    loadGoogleMaps(apiKey).then((maps) => {
      if (cancelled || !hostRef.current) return;
      window.clearTimeout(fallbackTimer);
      const map = new maps.Map(hostRef.current, {
        center: fitLatLngs[0] ?? { lat: 35.6812, lng: 139.7671 },
        clickableIcons: false,
        disableDefaultUI: true,
        gestureHandling: "greedy",
        mapTypeId: "roadmap",
        styles: LANDI_GOOGLE_MAP_STYLES,
        zoom: 12,
        zoomControl: true
      });
      mapsRef.current = maps;
      mapRef.current = map;
      setMapReady(true);
    }).catch(() => {
      window.clearTimeout(fallbackTimer);
      if (!cancelled) onUnavailable();
    });
    return () => {
      cancelled = true;
      window.clearTimeout(fallbackTimer);
      clearGoogleMapLayers(layersRef.current);
      layersRef.current = [];
      if (mapRef.current && mapsRef.current) mapsRef.current.event.clearInstanceListeners(mapRef.current);
      mapRef.current = null;
      mapsRef.current = null;
      lastFitKeyRef.current = "";
      setMapReady(false);
    };
  }, [apiKey, onUnavailable]);

  useEffect(() => {
    const maps = mapsRef.current;
    const map = mapRef.current;
    if (!mapReady || !maps || !map) return;
    clearGoogleMapLayers(layersRef.current);
    const nextLayers: GoogleMapLayer[] = [];

    if (routeLatLngs.length > 1) {
      nextLayers.push(new maps.Polyline({
        geodesic: true,
        map,
        path: routeLatLngs,
        strokeColor: routeRefresh ? "#6f97a8" : "#276758",
        strokeOpacity: routeRefresh ? 0.38 : 0.72,
        strokeWeight: 3
      }));
    }

    for (const marker of points) {
      nextLayers.push(createGoogleMapMarkerOverlay(maps, map, marker, marker.placeId === selectedPlaceId, onSelectPlace));
    }
    layersRef.current = nextLayers;

    const selectedMarker = points.find((marker) => marker.placeId === selectedPlaceId);
    if (fitKey && fitKey !== lastFitKeyRef.current) {
      if (fitLatLngs.length === 1) {
        map.setCenter(fitLatLngs[0]!);
        map.setZoom(12);
      } else if (fitLatLngs.length > 1) {
        const bounds = new maps.LatLngBounds();
        fitLatLngs.forEach((point) => bounds.extend(point));
        map.fitBounds(bounds, 48);
        window.setTimeout(() => {
          const zoom = map.getZoom();
          if (typeof zoom === "number" && zoom > 14) map.setZoom(14);
        }, 0);
      }
    } else if (selectedMarker) {
      const currentZoom = map.getZoom();
      map.panTo(googleLatLngForCoordinates(selectedMarker.coordinates!));
      map.setZoom(typeof currentZoom === "number" ? Math.max(currentZoom, 12) : 12);
    } else if (!fitKey) {
      map.setCenter({ lat: 35.6812, lng: 139.7671 });
      map.setZoom(11);
    }
    lastFitKeyRef.current = fitKey;
  }, [fitKey, fitLatLngs, mapReady, onSelectPlace, points, routeLatLngs, routeRefresh, selectedPlaceId]);

  return <section className={routeRefresh ? "blueprint-map needs-refresh" : "blueprint-map"} aria-label="Itinerary map context">
    <MapRouteRefreshHeader routeRefresh={routeRefresh} onRequestRouteRefresh={onRequestRouteRefresh} routeRefreshBusy={Boolean(routeRefreshBusy)} />
    <div className="blueprint-map-stage blueprint-google-map" ref={hostRef} />
  </section>;
}

function LeafletBlueprintMap({ routePlaces, routeRefresh, markers, selectedPlaceId, onSelectPlace, onRequestRouteRefresh, routeRefreshBusy }: { routePlaces: BlueprintMapPointDisplay[]; routeRefresh?: ItineraryRouteRefreshDisplay | undefined; markers: BlueprintMapMarkerDisplay[]; selectedPlaceId: string; onSelectPlace: (placeId: string) => void; onRequestRouteRefresh?: ((refresh: ItineraryRouteRefreshDisplay) => void) | undefined; routeRefreshBusy?: boolean }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layersRef = useRef<L.LayerGroup | null>(null);
  const lastFitKeyRef = useRef("");
  const points = markers.filter((marker) => validCoordinates(marker.coordinates));
  const routeLatLngs = routePlaces.filter((place) => validCoordinates(place.coordinates)).map((place) => latLngForCoordinates(place.coordinates!));
  const fitLatLngs = routeLatLngs.length ? routeLatLngs : points.map((marker) => latLngForCoordinates(marker.coordinates!));
  const fitKey = [
    routePlaces.filter((place) => validCoordinates(place.coordinates)).map((place) => `route:${place.placeId}:${place.coordinates!.join(",")}`).join("|"),
    points.map((marker) => `marker:${marker.placeId}:${marker.coordinates!.join(",")}:${marker.markerState}:${marker.type}`).join("|")
  ].join("::");

  useEffect(() => {
    mountLeafletStyles();
  }, []);

  useEffect(() => {
    if (!hostRef.current || mapRef.current) return;
    const map = L.map(hostRef.current, { attributionControl: true, zoomControl: false, preferCanvas: true });
    L.control.zoom({ position: "bottomright" }).addTo(map);
    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}", {
      attribution: "Tiles &copy; Esri",
      maxZoom: 16
    }).addTo(map);
    createLandiMapFeatureLayer().addTo(map);
    layersRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      layersRef.current = null;
      lastFitKeyRef.current = "";
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layers = layersRef.current;
    if (!map || !layers) return;
    layers.clearLayers();

    if (routeLatLngs.length > 1) {
      L.polyline(routeLatLngs, {
        color: routeRefresh ? "#6f97a8" : "#276758",
        opacity: routeRefresh ? 0.42 : 0.72,
        weight: 3,
        ...(routeRefresh ? { dashArray: "6 8" } : {}),
        lineCap: "round",
        lineJoin: "round"
      }).addTo(layers);
    }

    for (const marker of points) {
      const selected = marker.placeId === selectedPlaceId;
      L.marker(latLngForCoordinates(marker.coordinates!), {
        icon: L.divIcon({
          className: "blueprint-leaflet-icon",
          html: mapMarkerHtml(marker, selected),
          iconAnchor: [MAP_MARKER_ANCHOR.x, MAP_MARKER_ANCHOR.y]
        }),
        title: marker.title,
        zIndexOffset: selected ? 400 : 0
      }).addTo(layers).on("click", () => onSelectPlace(marker.placeId));
    }

    const selectedMarker = points.find((marker) => marker.placeId === selectedPlaceId);
    if (fitKey && fitKey !== lastFitKeyRef.current) {
      if (fitLatLngs.length === 1) {
        map.setView(fitLatLngs[0]!, 13, { animate: false });
      } else if (fitLatLngs.length > 1) {
        map.fitBounds(L.latLngBounds(fitLatLngs).pad(0.18), { maxZoom: 14, animate: false });
      }
    } else if (selectedMarker) {
      const currentZoom = map.getZoom();
      map.setView(latLngForCoordinates(selectedMarker.coordinates!), Number.isFinite(currentZoom) ? Math.max(currentZoom, 13) : 13, { animate: true });
    } else if (!fitKey) {
      map.setView([35.6812, 139.7671], 11);
    }
    lastFitKeyRef.current = fitKey;
  }, [fitKey, fitLatLngs, onSelectPlace, points, routeLatLngs, routeRefresh, selectedPlaceId]);

  return <section className={routeRefresh ? "blueprint-map needs-refresh" : "blueprint-map"} aria-label="Itinerary map context">
    <MapRouteRefreshHeader routeRefresh={routeRefresh} onRequestRouteRefresh={onRequestRouteRefresh} routeRefreshBusy={Boolean(routeRefreshBusy)} />
    <div className="blueprint-map-stage" ref={hostRef} />
  </section>;
}

function MapRouteRefreshHeader({ routeRefresh, onRequestRouteRefresh, routeRefreshBusy = false }: { routeRefresh?: ItineraryRouteRefreshDisplay | undefined; onRequestRouteRefresh?: ((refresh: ItineraryRouteRefreshDisplay) => void) | undefined; routeRefreshBusy?: boolean }) {
  if (!routeRefresh) return null;
  const requestRouteRefresh = onRequestRouteRefresh;
  const canRefresh = routeRefresh.actionable !== false && routeRefresh.segmentIds.length > 0 && Boolean(requestRouteRefresh);
  return <header className="blueprint-map-status">
    <div>
      <h3>Routes need refresh</h3>
      <p>{routeRefresh.summary}</p>
    </div>
    <div className="blueprint-map-status-actions">
      <span>{routeRefresh.actionable === false ? "After Apply" : "Routes need refresh"}</span>
      {canRefresh && requestRouteRefresh ? <button type="button" disabled={routeRefreshBusy} onClick={() => requestRouteRefresh(routeRefresh)}>{routeRefreshBusy ? "Refreshing..." : "Refresh routes"}</button> : null}
    </div>
  </header>;
}

function ExplorePanel({ filters, cards, filter, hidden, onFilter, onSelect, onAdd }: { filters: readonly Exclude<GuideFilter, "all">[]; cards: GuideCardDisplay[]; filter: GuideFilter; hidden: boolean; onFilter: (filter: GuideFilter) => void; onSelect: (placeId: string) => void; onAdd: (placeId: string) => void }) {
  const visibleCards = filterGuideCards(cards, { type: filter });
  return <div className="blueprint-explore-panel blueprint-panel-view" hidden={hidden}>
    <header><h3>Explore</h3></header>
    <div className="blueprint-guide-filters">{filters.map((item) => <button type="button" className={filter === item ? "active" : ""} aria-pressed={filter === item} onClick={() => onFilter(filter === item ? "all" : item)} key={item}>{guideFilterLabel(item)}</button>)}</div>
    <div className="blueprint-guide-list">
      {visibleCards.map((card) => <article className="blueprint-guide-card" key={card.placeId}>
        <button type="button" className="blueprint-guide-card-main" onClick={() => onSelect(card.placeId)}>
          <header><div><strong>{card.title}</strong></div></header>
          <p>{card.summary}</p>
          {card.tags.length ? <div className="blueprint-guide-tags">{card.tags.map((tag) => <span key={tag}>{tag}</span>)}</div> : null}
        </button>
        {(card.footerNote || card.canAdd) ? <footer>{card.footerNote ? <span>{card.footerNote}</span> : <span />}{card.canAdd && card.actionLabel ? <button type="button" onClick={() => onAdd(card.placeId)}>{card.actionLabel}</button> : null}</footer> : null}
      </article>)}
      {!visibleCards.length ? <p className="blueprint-empty-note">No guide cards match these filters.</p> : null}
    </div>
  </div>;
}

function DetailPanel({ detail, hidden, onBack, onSelect, onAdd }: { detail: DetailPlaceDisplay; hidden: boolean; onBack: () => void; onSelect: (placeId: string) => void; onAdd: (placeId: string) => void }) {
  return <div className="blueprint-detail-panel blueprint-panel-view" hidden={hidden}>
    <header>
      <button type="button" className="blueprint-detail-back" aria-label="Back to explore" onClick={onBack}><span aria-hidden="true" /></button>
      <div><h3>{detail.title}</h3></div>
    </header>
    <section><h4>{detail.leadTitle}</h4><p>{detail.leadBody}</p></section>
    {detail.planTitle && detail.planBody ? <section><h4>{detail.planTitle}</h4><p>{detail.planBody}</p></section> : null}
    {detail.reservationNote ? <section><h4>Reservation</h4><p>{detail.reservationNote}</p></section> : null}
    {detail.detailSections.map((section) => <section key={section.title}><h4>{section.title}</h4>{section.body ? <p>{section.body}</p> : null}{section.items?.length ? <ul>{section.items.map((item) => <li key={item}>{item}</li>)}</ul> : null}</section>)}
    {detail.relatedEvents.length ? <section className="blueprint-detail-events"><h4>Timing notes</h4><div>{detail.relatedEvents.map((event) => <article key={event.id}>
      <strong>{event.title}</strong>
      <p>{event.description}</p>
      {(event.dateLabel || event.locationLabel) ? <small>{[event.dateLabel, event.locationLabel].filter(Boolean).join(" · ")}</small> : null}
      {event.sources.length ? <div>{event.sources.map((source) => source.url ? <a href={source.url} target="_blank" rel="noreferrer" key={`${event.id}-${source.url}`}>{source.summary}</a> : <span key={`${event.id}-${source.summary}`}>{source.summary}</span>)}</div> : null}
    </article>)}</div></section> : null}
    {detail.sources.length ? <section className="blueprint-detail-sources"><h4>{detail.sourceTitle ?? "Sources"}</h4><div>{detail.sources.map((source) => source.url ? <a href={source.url} target="_blank" rel="noreferrer" key={`${source.url}-${source.summary}`}>{source.summary}</a> : <span key={source.summary}>{source.summary}</span>)}</div></section> : null}
    {detail.comparisonTitle ? <section className="blueprint-comparison"><h4>{detail.comparisonTitle}</h4><div role="table" aria-label={detail.comparisonTitle}>
      <div role="row"><span>Place</span><span>Where</span><span>Route</span><span>Timing</span><span>Before going</span><span>Reference</span><span /></div>
      {detail.comparisonRows.map((row) => <div role="row" key={row.id}><strong>{row.name}</strong><span>{row.area}</span><span>{row.routeFit}</span><span>{row.timing}</span><span>{row.effort}</span><span>{row.sourceState}</span><button type="button" onClick={() => onSelect(row.id)}>Open</button></div>)}
    </div></section> : null}
    <section className="blueprint-detail-actions">
      {detail.scheduled || detail.canAdd ? <button type="button" onClick={() => detail.scheduled ? onSelect(detail.placeId) : onAdd(detail.placeId)}>{detail.primaryActionLabel}</button> : <span>{detail.primaryActionLabel}</span>}
      {detail.links.map((link) => <a href={link.url} target="_blank" rel="noreferrer" key={`${link.label}-${link.url}`}>{link.label}</a>)}
    </section>
  </div>;
}

function PlacementPanel({ workspace, place, hidden, selectedDayId, onBack, onPreview }: { workspace: BlueprintWorkspaceDisplay; place?: BlueprintPlaceDisplay | undefined; hidden: boolean; selectedDayId?: string | undefined; onBack: () => void; onPreview: (edit: PendingItineraryEditDisplay) => void }) {
  const [dayId, setDayId] = useState(selectedDayId ?? workspace.initialDayId);
  const [position, setPosition] = useState("end");
  const availableDays = place ? workspace.days.filter((candidate) => placementDayAllowed(place, candidate.id)) : workspace.days;
  const day = availableDays.find((candidate) => candidate.id === dayId) ?? availableDays[0];
  const itinerary = workspace.itineraries.find((candidate) => candidate.dayId === day?.id) ?? workspace.itineraries[0];
  if (!place || !day) return <div className="blueprint-placement-panel blueprint-panel-view" hidden={hidden}><p className="blueprint-empty-note">Select a guide card before choosing placement.</p></div>;
  const positionOptions = itinerary?.placementOptions ?? [];
  const selectedPosition = positionOptions.find((option) => option.id === position) ?? positionOptions[positionOptions.length - 1];
  function previewPlacement() {
    onPreview(buildPendingItineraryEditForWorkspace(workspace, place!.id, { dayId: day!.id, positionId: selectedPosition?.id ?? "end" }));
  }
  return <div className="blueprint-placement-panel blueprint-panel-view" hidden={hidden}>
    <header>
      <button type="button" className="blueprint-detail-back" aria-label="Back to explore" onClick={onBack}><span aria-hidden="true" /></button>
      <div><span>Placement</span><h3>{place.title}</h3><p>Choose where this should enter the itinerary before Landi prepares the edit.</p></div>
    </header>
    <section>
      <h4>Day</h4>
      <div className="blueprint-placement-days">{availableDays.map((item) => <button type="button" className={item.id === day.id ? "active" : ""} key={item.id} onClick={() => { setDayId(item.id); setPosition("end"); }}>
        <strong>{item.shortLabel ?? item.date ?? item.label}</strong>
        <span>{item.city ?? item.title ?? "Trip day"}</span>
      </button>)}</div>
    </section>
    <section>
      <h4>Position</h4>
      <div className="blueprint-placement-options">{positionOptions.map((option) => <button type="button" className={option.id === selectedPosition?.id ? "active" : ""} key={option.id} onClick={() => setPosition(option.id)}>{option.label}</button>)}</div>
    </section>
    <section className="blueprint-detail-actions"><button type="button" onClick={previewPlacement}>Add to draft</button></section>
  </div>;
}

function placementDayAllowed(place: BlueprintPlaceDisplay, dayId: string): boolean {
  const eligibility = place.schedulingEligibility;
  if (!eligibility) return true;
  if (eligibility.blockedDayIds?.includes(dayId)) return false;
  return !eligibility.suitableDayIds?.length || eligibility.suitableDayIds.includes(dayId);
}

function areaLabel(area: BlueprintWorkspaceArea): string {
  return area === "itinerary" ? "Itinerary" : area === "preparation" ? "Preparation" : area === "tips" ? "Tips" : "Sources";
}

function validCoordinates(value: BlueprintMapPointDisplay["coordinates"]): value is [number, number] {
  return Array.isArray(value) && value.length === 2 && value.every(Number.isFinite);
}

function latLngForCoordinates(coordinates: [number, number]): L.LatLngExpression {
  return [coordinates[0], coordinates[1]];
}

function googleLatLngForCoordinates(coordinates: [number, number]): GoogleLatLngLiteral {
  return { lat: coordinates[0], lng: coordinates[1] };
}

function mountLeafletStyles() {
  if (leafletStylesMounted || typeof document === "undefined") return;
  const style = document.createElement("style");
  style.dataset.landiLeaflet = "true";
  style.textContent = leafletCss;
  document.head.append(style);
  leafletStylesMounted = true;
}

function loadGoogleMaps(apiKey: string): Promise<GoogleMapsNamespace> {
  const existing = (window as Window & { google?: { maps?: GoogleMapsNamespace } }).google?.maps;
  if (existing) return Promise.resolve(existing);
  if (googleMapsLoader) return googleMapsLoader;
  googleMapsLoader = new Promise((resolve, reject) => {
    const callbackName = "__landiGoogleMapsInit";
    const runtimeWindow = window as Window & { google?: { maps?: GoogleMapsNamespace }; __landiGoogleMapsInit?: () => void };
    const script = document.createElement("script");
    const params = new URLSearchParams({ callback: callbackName, key: apiKey, language: "en", loading: "async", region: "US", v: "weekly" });
    runtimeWindow.__landiGoogleMapsInit = () => {
      const maps = runtimeWindow.google?.maps;
      delete runtimeWindow.__landiGoogleMapsInit;
      if (maps) {
        resolve(maps);
      } else {
        googleMapsLoader = null;
        reject(new Error("Google Maps JavaScript API did not initialize."));
      }
    };
    script.async = true;
    script.defer = true;
    script.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
    script.onerror = () => {
      delete runtimeWindow.__landiGoogleMapsInit;
      googleMapsLoader = null;
      reject(new Error("Google Maps JavaScript API failed to load."));
    };
    document.head.append(script);
  });
  return googleMapsLoader;
}

function clearGoogleMapLayers(layers: GoogleMapLayer[]) {
  for (const layer of layers) layer.setMap(null);
}

function createGoogleMapMarkerOverlay(maps: GoogleMapsNamespace, map: GoogleMapInstance, marker: BlueprintMapMarkerDisplay, selected: boolean, onSelectPlace: (placeId: string) => void): GoogleMapLayer {
  const coordinates = marker.coordinates!;
  const position = new maps.LatLng(coordinates[0], coordinates[1]);
  const element = document.createElement("button");
  element.type = "button";
  element.className = selected ? "blueprint-google-marker selected" : "blueprint-google-marker";
  element.title = marker.title;
  element.innerHTML = mapMarkerHtml(marker, selected);
  element.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onSelectPlace(marker.placeId);
  });

  class BlueprintGoogleMarker extends maps.OverlayView {
    onAdd() {
      this.getPanes().overlayMouseTarget.append(element);
    }

    draw() {
      const point = this.getProjection().fromLatLngToDivPixel(position);
      if (!point) return;
      element.style.transform = `translate(${point.x - MAP_MARKER_ANCHOR.x}px, ${point.y - MAP_MARKER_ANCHOR.y}px)`;
    }

    onRemove() {
      element.remove();
    }
  }

  const overlay = new BlueprintGoogleMarker();
  overlay.setMap(map);
  return overlay;
}

const LANDI_GOOGLE_MAP_STYLES = [
  { featureType: "all", elementType: "labels.text.fill", stylers: [{ color: "#111111" }] },
  { featureType: "all", elementType: "labels.text.stroke", stylers: [{ color: "#ffffff" }, { weight: 2 }] },
  { featureType: "all", elementType: "labels.icon", stylers: [{ visibility: "off" }] },
  { featureType: "administrative", elementType: "geometry", stylers: [{ color: "#d9ddda" }] },
  { featureType: "landscape", elementType: "geometry", stylers: [{ color: "#f0f1ef" }] },
  { featureType: "landscape.natural", elementType: "geometry", stylers: [{ color: "#eef0ed" }] },
  { featureType: "poi", elementType: "geometry", stylers: [{ color: "#e8ebe8" }] },
  { featureType: "poi.park", elementType: "geometry", stylers: [{ color: "#cfe8c5" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#ffffff" }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#d8dcda" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#f7f7f5" }] },
  { featureType: "road.highway", elementType: "geometry.stroke", stylers: [{ color: "#cbd1ce" }] },
  { featureType: "transit", elementType: "geometry", stylers: [{ color: "#cfd5d2" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#b2dcec" }] }
] as const;

function createLandiMapFeatureLayer(): L.GridLayer {
  const LandiFeatureLayer = L.GridLayer.extend({
    createTile(coords: L.Coords, done: L.DoneCallback) {
      const tile = document.createElement("canvas");
      const size = this.getTileSize();
      tile.width = size.x;
      tile.height = size.y;
      const context = tile.getContext("2d");
      if (!context) {
        queueMicrotask(() => done(undefined, tile));
        return tile;
      }
      const image = new Image();
      image.crossOrigin = "anonymous";
      image.onload = () => {
        try {
          context.drawImage(image, 0, 0, size.x, size.y);
          recolorMapFeatureTile(context, size.x, size.y);
          done(undefined, tile);
        } catch {
          context.clearRect(0, 0, size.x, size.y);
          done(undefined, tile);
        }
      };
      image.onerror = () => done(undefined, tile);
      const subdomain = ["a", "b", "c"][(coords.x + coords.y) % 3] ?? "a";
      image.src = `https://${subdomain}.tile.openstreetmap.fr/hot/${coords.z}/${coords.x}/${coords.y}.png`;
      return tile;
    }
  });
  const layer = new LandiFeatureLayer() as L.GridLayer;
  L.Util.setOptions(layer, { attribution: "&copy; OpenStreetMap contributors", maxZoom: 19, tileSize: 256 });
  return layer;
}

function recolorMapFeatureTile(context: CanvasRenderingContext2D, width: number, height: number) {
  const imageData = context.getImageData(0, 0, width, height);
  const data = imageData.data;
  for (let index = 0; index < data.length; index += 4) {
    const red = data[index]!;
    const green = data[index + 1]!;
    const blue = data[index + 2]!;
    const alpha = data[index + 3]!;
    if (alpha === 0) continue;
    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    const saturation = max - min;
    const isWater = blue > 145 && green > 120 && blue > red + 18 && blue > green + 4;
    const isGreenSpace = green > 150 && green > red + 8 && green > blue + 5 && saturation > 16 && red < 232 && blue < 228;
    if (!isWater && !isGreenSpace) {
      data[index + 3] = 0;
      continue;
    }
    const target: [number, number, number] = isWater ? [178, 220, 236] : [205, 231, 194];
    data[index] = target[0];
    data[index + 1] = target[1];
    data[index + 2] = target[2];
    data[index + 3] = Math.round(alpha * (isWater ? 0.88 : 0.8));
  }
  context.putImageData(imageData, 0, 0);
}

function mapMarkerHtml(marker: BlueprintMapMarkerDisplay, selected: boolean): string {
  const stateClass = marker.markerState === "pending" ? "pending" : marker.markerState === "on-day" ? "on-day" : "context";
  return `<div class="blueprint-map-bubble marker-${marker.type} ${stateClass}${selected ? " selected" : ""}"><span class="blueprint-map-pin"><svg class="blueprint-map-pin-svg" viewBox="0 0 32 40" aria-hidden="true"><path class="blueprint-map-pin-shell" d="M16 1.8C8.9 1.8 3.2 7.5 3.2 14.6c0 9 10.5 19.8 12.1 21.5.4.4 1 .4 1.4 0 1.6-1.7 12.1-12.5 12.1-21.5C28.8 7.5 23.1 1.8 16 1.8Z"/><circle class="blueprint-map-dot" cx="16" cy="14.8" r="10.4"/><g class="blueprint-map-glyph" transform="translate(8 7) scale(.67)">${mapMarkerIcon(marker.type)}</g></svg></span><strong>${escapeHtml(marker.title)}</strong></div>`;
}

function mapMarkerIcon(type: GuideFilter): string {
  if (type === "dining") return `<path d="M7 3v8"/><path d="M11 3v8"/><path d="M7 7h4"/><path d="M9 11v10"/><path d="M17 3v18"/><path d="M15 3c2 1.8 3 4.2 3 7"/>`;
  if (type === "shopping") return `<path d="M6 8h12l-1 12H7L6 8Z"/><path d="M9 8a3 3 0 0 1 6 0"/>`;
  if (type === "experience") return `<path d="M12 3l2.2 5 5.4.5-4.1 3.6 1.2 5.3L12 14.7l-4.7 2.7 1.2-5.3-4.1-3.6 5.4-.5L12 3Z"/>`;
  return `<path d="M5 8h3l1.4-2h5.2L16 8h3v9H5V8Z"/><circle cx="12" cy="12.5" r="3"/>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[character]!);
}
