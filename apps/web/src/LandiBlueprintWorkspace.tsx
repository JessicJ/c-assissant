import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import L from "leaflet";
import leafletCss from "leaflet/dist/leaflet.css?inline";
import type { Plan, PlanPlacePriority, PlanPresentation } from "@c-assistant/core";
import {
  buildPendingItineraryEditForWorkspace,
  buildPendingItineraryMoveForWorkspace,
  buildPendingItineraryRemoveForWorkspace,
  buildBlueprintWorkspaceDisplay,
  detailDisplayForWorkspacePlace,
  filterGuideCards,
  guideCardsForWorkspace,
  guideFilterLabel,
  itineraryDisplayForWorkspace,
  itineraryCardImageCandidateForRender,
  itineraryCardImageForRender,
  itineraryTimelineNodesForItems,
  compactPendingItineraryEdits,
  mergePendingItineraryEdit,
  pendingItineraryDraftSummary,
  scheduledDayIdForPlace,
  timelineVisualPrimitiveForItem,
  type AlternativeDisplay,
  type BlueprintMapViewportDisplay,
  type BlueprintMapMarkerDisplay,
  type BlueprintMapPointDisplay,
  type BlueprintRouteSegmentDisplay,
  type BlueprintPlaceDisplay,
  type BlueprintWorkspaceArea,
  type BlueprintWorkspaceDisplay,
  type DetailImageDisplay,
  type DetailPlaceDisplay,
  type DayContextDisplay,
  type GuideCardDisplay,
  type GuideCardImageDisplay,
  type GuideFilter,
  type ItineraryCardDisplay,
  type ItineraryRouteRefreshDisplay,
  type PendingItineraryEditDisplay
} from "./landi-blueprint-workspace-display.js";
import { fallbackRouteLineState, routeLineRenderState, routeLinesForMap, type MapRouteLineRenderState } from "./blueprint-map-route-lines.js";
import { automaticRouteRefreshGate } from "./current-plan-route-refresh.js";

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
const MAP_MARKER_ANCHOR = { x: 14, y: 14 } as const;
type BlueprintMapMarkerRole = "start" | "stop" | "end" | "context";

export function LandiBlueprintWorkspace({ plan, presentation, onTaskToggle, onApplyItineraryEdits, onRequestRouteRefresh, onUpdatePlacePriority, itineraryEditBusy = false, routeRefreshBusy = false, priorityUpdateBusyPlaceId = "" }: {
  plan: Plan;
  presentation: PlanPresentation;
  onTaskToggle: (planId: string, taskId: string, checked: boolean) => Promise<void>;
  onApplyItineraryEdits?: (edits: PendingItineraryEditDisplay[]) => Promise<void>;
  onRequestRouteRefresh?: (refresh: ItineraryRouteRefreshDisplay) => void;
  onUpdatePlacePriority?: (placeId: string, priority: PlanPlacePriority) => Promise<void>;
  itineraryEditBusy?: boolean;
  routeRefreshBusy?: boolean;
  priorityUpdateBusyPlaceId?: string;
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
  const [savingPreparationItemId, setSavingPreparationItemId] = useState("");
  const [preparationSaveError, setPreparationSaveError] = useState<{ itemId: string; message: string } | null>(null);
  const timelineListRef = useRef<HTMLDivElement>(null);
  const itineraryDragRef = useRef<{ pointerId: number; placeId: string; activeDropId: string } | null>(null);
  const selectedDay = workspace.days.find((day) => day.id === selectedDayId) ?? workspace.days[0];
  const selectedActualDayId = selectedDay?.dayIds?.length ? selectedDay.defaultDayId ?? selectedDay.dayIds[selectedDay.dayIds.length - 1] : selectedDay?.id;
  const guideCards = guideCardsForWorkspace(workspace, pendingEdits, selectedActualDayId);
  const selectedDetail = detailDisplayForWorkspacePlace(workspace, selectedPlaceId, pendingEdits);
  const itinerary = itineraryDisplayForWorkspace(workspace, selectedDay?.id ?? "", pendingEdits);
  const autoRouteRefreshAttemptedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    setPendingEdits([]);
  }, [plan.id, plan.version]);

  useEffect(() => {
    const request = automaticRouteRefreshGate({
      planId: plan.id,
      planVersion: plan.version,
      dayId: itinerary.dayId,
      routeRefresh: itinerary.routeRefresh,
      pendingEditCount: pendingEdits.length,
      routeRefreshBusy,
      canRequest: Boolean(onRequestRouteRefresh)
    }, autoRouteRefreshAttemptedRef.current);
    if (!request || !onRequestRouteRefresh) return;
    autoRouteRefreshAttemptedRef.current.add(request.key);
    onRequestRouteRefresh(request.refresh);
  }, [itinerary.dayId, itinerary.routeRefresh, onRequestRouteRefresh, pendingEdits.length, plan.id, plan.version, routeRefreshBusy]);

  function selectPlace(placeId: string, mode: BlueprintPanelMode = "detail") {
    setSelectedPlaceId(placeId);
    const dayId = scheduledDayIdForPlace(workspace, placeId);
    if (dayId) setSelectedDayId(tabIdForActualDay(workspace, dayId));
    setPanelMode(mode);
  }

  function openPlacement(placeId: string) {
    setSelectedPlaceId(placeId);
    setPlacementPlaceId(placeId);
    setPanelMode("placement");
  }

  function stageRemoveFromDay(placeId: string) {
    const dayId = scheduledDayIdForPlace(workspace, placeId) ?? selectedActualDayId;
    if (!dayId) return;
    const edit = buildPendingItineraryRemoveForWorkspace(workspace, { dayId, placeId });
    if (!edit) return;
    stagePendingEdit(edit);
  }

  function stagePendingEdit(edit: PendingItineraryEditDisplay) {
    setPendingEdits((current) => mergePendingItineraryEdit(current, edit));
    setSelectedDayId(tabIdForActualDay(workspace, edit.dayId));
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

  function undoPendingEdit(placeId: string) {
    setPendingEdits((current) => current.filter((edit) => edit.placeId !== placeId));
    setSelectedPlaceId(placeId);
  }

  async function togglePreparationItem(itemId: string, taskId: string | undefined, checked: boolean) {
    if (!taskId || savingPreparationItemId) return;
    setSavingPreparationItemId(itemId);
    setPreparationSaveError(null);
    try {
      await onTaskToggle(plan.id, taskId, checked);
    } catch (caught) {
      setPreparationSaveError({ itemId, message: caught instanceof Error ? caught.message : "Checklist status could not be saved." });
    } finally {
      setSavingPreparationItemId("");
    }
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

  const movableItineraryItemCount = itinerary.items.filter((item) => item.kind === "block" && item.routeAnchor && item.reorderable && item.placeId).length;
  const canReorderSelectedDay = !itinerary.sections?.length && movableItineraryItemCount > 1;
  function renderItineraryItems(items: ItineraryCardDisplay[]) {
    return itineraryTimelineNodesForItems(items, routeRefreshBusy).map((node) => {
      if (node.kind === "movement") return <ItineraryRouteReadout item={node.item} label={node.label} state={node.state} key={node.key} />;
      const item = node.item;
      if (item.kind === "pending") return <PendingItineraryCard item={item} selected={selectedPlaceId === item.placeId} onSelect={() => selectPlace(item.placeId)} onUndoDraft={() => undoPendingEdit(item.placeId)} key={item.key} />;
      const displayItem = canReorderSelectedDay ? item : { ...item, reorderable: false };
      return <Fragment key={item.key}>
        {displayItem.reorderable ? <ItineraryDropZone dropId={`before-${displayItem.key}`} active={dragOverDropId === `before-${displayItem.key}`} /> : null}
        {displayItem.timelineRole === "transport"
          ? <TransportConnector item={displayItem} />
          : <ItineraryBlockCard item={displayItem} dragging={Boolean(displayItem.placeId) && draggedPlaceId === displayItem.placeId} selected={Boolean(displayItem.placeId) && selectedPlaceId === displayItem.placeId} onSelect={() => displayItem.placeId ? selectPlace(displayItem.placeId) : undefined} onUndoDraft={() => undoPendingEdit(displayItem.placeId)} onDragStart={(event) => startItineraryCardDrag(event, displayItem)} onDragMove={moveItineraryCardDrag} onDragEnd={endItineraryCardDrag} onDragCancel={cancelItineraryCardDrag} />}
      </Fragment>;
    });
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
            <span>{day.tabLabel ?? day.city ?? day.title ?? "Trip day"}</span>
          </button>)}</div>
        </div>
        <div className="blueprint-timeline-list" ref={timelineListRef}>
          {itinerary.sections?.length ? itinerary.sections.map((section) => <section className="blueprint-itinerary-date-section" aria-label={section.heading} key={section.key}>
            <h4>{section.heading}</h4>
            {section.dayContext ? <DayContextNote context={section.dayContext} /> : null}
            {renderItineraryItems(section.items)}
            {!section.items.length && !section.dayContext ? <p className="blueprint-empty-note">No itinerary blocks are available for this date.</p> : null}
          </section>) : <>
            {itinerary.dayContext ? <DayContextNote context={itinerary.dayContext} /> : null}
            {renderItineraryItems(itinerary.items)}
          </>}
          {canReorderSelectedDay ? <ItineraryDropZone dropId="end" active={dragOverDropId === "end"} /> : null}
          {workspace.planAlternatives.length ? <PlanAlternatives alternatives={workspace.planAlternatives} /> : null}
          {!itinerary.items.length && !itinerary.dayContext ? <p className="blueprint-empty-note">No itinerary blocks are available for this day.</p> : null}
        </div>
      </aside>

      <BlueprintMap routePlaces={itinerary.routePlaces} routeSegments={itinerary.routeSegments} routeRefresh={itinerary.routeRefresh} markers={itinerary.markers} fallbackViewport={workspace.mapFallback} selectedPlaceId={selectedPlaceId} onSelectPlace={selectMapPlace} routeRefreshBusy={routeRefreshBusy} />

      <aside className="blueprint-side-panel" aria-label="Itinerary side panel">
        <div className="blueprint-panel-body">
          <ExplorePanel filters={workspace.guideFilters} cards={guideCards} filter={guideFilter} hidden={panelMode !== "explore"} onFilter={setGuideFilter} onSelect={selectPlace} onAdd={openPlacement} onUndoDraft={undoPendingEdit} />
          {selectedDetail ? <DetailPanel detail={selectedDetail} hidden={panelMode !== "detail"} onBack={() => setPanelMode("explore")} onSelect={selectPlace} onAdd={openPlacement} onRemove={stageRemoveFromDay} onUndoDraft={undoPendingEdit} /> : <p className="blueprint-empty-note" hidden={panelMode !== "detail"}>Select an itinerary block or guide card to open details.</p>}
          {placementPlaceId ? <PlacementPanel key={placementPlaceId} workspace={workspace} place={workspace.places.find((place) => place.id === placementPlaceId)} hidden={panelMode !== "placement"} selectedDayId={selectedActualDayId} onBack={() => setPanelMode("explore")} onPreview={stagePendingEdit} /> : null}
        </div>
      </aside>
    </div> : null}

    {area === "preparation" ? <section className="blueprint-page blueprint-preparation" aria-label="Preparation checklist">
      {workspace.preparationGroups.length ? workspace.preparationGroups.map((group) => <section className="blueprint-check-group" key={group.title}>
        <h4>{group.title}</h4>
        <div>{group.items.map((item) => {
          const saving = savingPreparationItemId === item.id;
          const error = preparationSaveError?.itemId === item.id ? preparationSaveError.message : "";
          return <details className={`blueprint-check-item role-${item.role}${item.checked ? " checked" : ""}${item.checkable ? " checkable" : ""}`} key={`${group.title}-${item.id}`}>
          <summary>
            {item.checkable ? <input type="checkbox" checked={item.checked} disabled={saving} onClick={(event) => event.stopPropagation()} onChange={(event) => void togglePreparationItem(item.id, item.taskId, event.target.checked)} aria-label={`Complete ${item.title}`} /> : <span className="blueprint-check-marker" aria-hidden="true" />}
            <span><strong>{item.title}</strong>{item.description ? <small>{item.description}</small> : null}{saving ? <small>Saving...</small> : null}{error ? <small className="blueprint-check-error">{error}</small> : null}</span>
          </summary>
          {item.completion ? <small>{item.completion}</small> : null}
          {item.context ? <small>{item.context}</small> : null}
        </details>;
        })}</div>
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
      {workspace.sourceGroups.length ? <div className="blueprint-source-groups">{workspace.sourceGroups.map((group) => <section className={`blueprint-source-group group-${group.id}`} key={group.id}>
        <header><h4>{group.title}</h4><p>{group.description}</p></header>
        <div className="blueprint-source-list">{group.sources.map((source) => <SourceCard source={source} key={`${source.url ?? "source"}-${source.summary}`} />)}</div>
      </section>)}</div> : <p className="blueprint-empty-note">No sources are listed for this plan yet.</p>}
      {(workspace.researchGrounding ?? []).length ? <section className="blueprint-research-grounding" aria-label="Supplemental research context">
        <h4>Supplemental research context</h4>
        <p>Unresolved narrative grounding retained separately from structured sources.</p>
        <ul>{(workspace.researchGrounding ?? []).map((item, index) => <li key={`${index}-${item.slice(0, 24)}`}>{item}</li>)}</ul>
      </section> : null}
    </section> : null}
  </section>;
}

function SourceCard({ source }: { source: BlueprintWorkspaceDisplay["sources"][number] }) {
  const primary = source.title?.trim() || source.publisher?.trim() || source.summary;
  const publisher = source.publisher && source.publisher !== primary ? source.publisher : undefined;
  const supports = source.contexts?.filter((context) => /^supports\b/i.test(context)) ?? [];
  const status = sourceStatusLabel(source);
  const statusTone = sourceStatusTone(source);
  const secondary = [publisher, source.retrievedAt ? `Retrieved ${source.retrievedAt}` : undefined, source.url].filter(Boolean);
  const heading = source.url ? <a href={source.url} target="_blank" rel="noreferrer">{primary}</a> : <strong>{primary}</strong>;
  return <article className={`blueprint-source-card${statusTone ? ` status-${statusTone}` : ""}`}>
    <header>
      <div>{heading}{publisher ? <small>{publisher}</small> : null}</div>
      {status ? <span>{status}</span> : null}
    </header>
    {supports.length ? <p>{supports.slice(0, 3).join(" · ")}</p> : null}
    <details>
      <summary>Details</summary>
      <div>
        {secondary.map((item) => <small key={item}>{item}</small>)}
        <small>{source.summary}</small>
        {source.contexts?.filter((context) => !supports.includes(context)).map((context) => <small key={context}>{context}</small>)}
      </div>
    </details>
  </article>;
}

function sourceStatusLabel(source: BlueprintWorkspaceDisplay["sources"][number]): string | undefined {
  if (source.status === "stale") return "Needs recheck";
  if (source.status === "recheck") return "Needs confirmation";
  if (source.contexts?.some((context) => /needs confirmation|recheck|needs check/i.test(context))) return "Needs confirmation";
  if (source.status === "verified") return "Verified";
  return undefined;
}

function sourceStatusTone(source: BlueprintWorkspaceDisplay["sources"][number]): "attention" | "verified" | undefined {
  if (source.status === "stale" || source.status === "recheck" || source.contexts?.some((context) => /needs confirmation|recheck|needs check/i.test(context))) return "attention";
  if (source.status === "verified") return "verified";
  return undefined;
}

function PlanAlternatives({ alternatives }: { alternatives: AlternativeDisplay[] }) {
  return <details className="blueprint-plan-alternatives">
    <summary>Why some ideas are left out</summary>
    <div>{alternatives.map((alternative) => <AlternativeNote alternative={alternative} key={alternative.key} />)}</div>
  </details>;
}

function AlternativeNote({ alternative }: { alternative: AlternativeDisplay }) {
  return <article className={`blueprint-alternative-note kind-${alternative.kind}`}>
    <header>
      <span>{alternative.label}</span>
      <strong>{alternative.title}</strong>
    </header>
    {alternative.replacementFor ? <small>Alternative to {alternative.replacementFor}</small> : null}
    {alternative.condition ? <small>{alternative.condition}</small> : null}
    {alternative.summary ? <p>{alternative.summary}</p> : null}
  </article>;
}

function DayContextNote({ context }: { context: DayContextDisplay }) {
  const start = context.startLabel ?? "Start context pending";
  const end = context.endLabel ?? "End context pending";
  return <section className="blueprint-day-context" aria-label={`Day context: ${start} to ${end}`}>
    <div className="blueprint-day-context-flow">
      <span>{start}</span>
      <b aria-hidden="true">→</b>
      <span>{end}</span>
    </div>
    {context.summary ? <p>{context.summary}</p> : null}
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

function moveItineraryPlaceOrder(placeIds: string[], placeId: string, position: NonNullable<PendingItineraryEditDisplay["position"]>): string[] {
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

function ItineraryRouteReadout({ item, label, state }: { item: ItineraryCardDisplay; label: string; state: "confirmed" | "pending" | "checking" }) {
  return <article className={`blueprint-itinerary-route-readout primitive-movement ${state}`} aria-label={`Next route: ${label}`}>
    <span className="blueprint-itinerary-transport-rail" aria-hidden="true" />
    <span className="blueprint-itinerary-transport-icon" aria-hidden="true">{transportModeIcon(item.routeAfterMode)}</span>
    <TransportConnectorContent title={label} durationLabel={item.routeAfterDurationLabel} detail={item.routeAfterDetail} statusLabel={state === "confirmed" ? undefined : "Needs check"} />
  </article>;
}

function TransportConnector({ item }: { item: ItineraryCardDisplay }) {
  return <article className={`blueprint-itinerary-transport primitive-${timelineVisualPrimitiveForItem(item)}`}>
    {item.timeLabel ? <time className="blueprint-itinerary-time blueprint-itinerary-time-secondary">{item.timeLabel}</time> : <span className="blueprint-itinerary-time blueprint-itinerary-time-empty" aria-hidden="true" />}
    <span className="blueprint-itinerary-transport-rail" aria-hidden="true" />
    <span className="blueprint-itinerary-transport-icon" aria-hidden="true">{transportModeIcon(item.routeAfterMode)}</span>
    <TransportConnectorContent title={item.title} detail={item.meta} statusLabel={item.statusLabel} />
  </article>;
}

function TransportConnectorContent({ title, durationLabel, detail, statusLabel }: { title: string; durationLabel?: string | undefined; detail?: string | undefined; statusLabel?: string | undefined }) {
  return <div className="blueprint-itinerary-transport-content">
    <div className="blueprint-itinerary-transport-copy">
      <strong>{title}</strong>
      {durationLabel || statusLabel ? <span className="blueprint-itinerary-transport-meta">{clockIcon()}{durationLabel ? <span>{durationLabel}</span> : null}{statusLabel ? <em className="blueprint-itinerary-status">{statusLabel}</em> : null}</span> : null}
      {detail ? <p>{detail}</p> : null}
    </div>
  </div>;
}

function ItineraryBlockCard({ item, selected, dragging, onSelect, onUndoDraft, onDragStart, onDragMove, onDragEnd, onDragCancel }: { item: ItineraryCardDisplay; selected: boolean; dragging: boolean; onSelect: () => void; onUndoDraft: () => void; onDragStart: (event: PointerEvent<HTMLElement>) => void; onDragMove: (event: PointerEvent<HTMLElement>) => void; onDragEnd: (event: PointerEvent<HTMLElement>) => void; onDragCancel: (event: PointerEvent<HTMLElement>) => void }) {
  const [failedImageUrls, setFailedImageUrls] = useState<string[]>([]);
  const [loadedImageUrl, setLoadedImageUrl] = useState("");
  const image = itineraryCardImageCandidateForRender(item.imageCandidates ?? (item.image ? [item.image] : []), failedImageUrls);
  const imageClassName = `blueprint-itinerary-thumbnail${image?.url === loadedImageUrl ? " loaded" : " loading"}`;
  const failImage = () => { if (!image) return; setLoadedImageUrl(""); setFailedImageUrls((current) => current.includes(image.url) ? current : [...current, image.url]); };
  const featurePlaceCard = item.featurePlaceCard;
  const className = [
    "blueprint-itinerary-block",
    item.reorderable ? "reorderable" : "static",
    selected ? "selected" : "",
    dragging ? "dragging" : "",
    item.editState === "moved" ? "moved" : "",
    featurePlaceCard ? "feature-place-card" : image ? "featured" : "compact",
    featurePlaceCard ? image ? "with-image" : "text-only" : "",
    item.emphasis ? `emphasis-${item.emphasis}` : "",
    `primitive-${timelineVisualPrimitiveForItem(item)}`,
    `role-${item.timelineRole}`,
    `type-${item.type}`
  ].filter(Boolean).join(" ");
  return <article className={className}>
    {item.timeLabel ? <time className="blueprint-itinerary-time">{item.timeLabel}</time> : <span className="blueprint-itinerary-time blueprint-itinerary-time-empty" aria-hidden="true" />}
    <span className="blueprint-itinerary-rail" aria-hidden="true" />
    <span className="blueprint-itinerary-icon" aria-hidden="true">{itineraryItemIcon(item)}</span>
    {item.reorderable ? <button type="button" className="blueprint-itinerary-drag-handle" aria-label={`Move ${item.title}`} onPointerDown={onDragStart} onPointerMove={onDragMove} onPointerUp={onDragEnd} onPointerCancel={onDragCancel}>⠿</button> : null}
    <button type="button" className="blueprint-itinerary-card-main" onClick={onSelect}>
      {featurePlaceCard ? <>
        {image ? <img className={imageClassName} src={image.url} alt={image.alt} loading="lazy" referrerPolicy="no-referrer" onLoad={() => setLoadedImageUrl(image.url)} onError={failImage} /> : null}
        <div className="blueprint-itinerary-feature-content">
          <strong>{featurePlaceCard.title}</strong>
          <small className="blueprint-itinerary-place-meta">{locationPinIcon()}<span>{[featurePlaceCard.typeLabel, featurePlaceCard.areaLabel].filter(Boolean).join(" · ")}</span></small>
          <span className="blueprint-itinerary-place-purpose">{featurePlaceCard.summary}</span>
          <span className="blueprint-itinerary-place-chips" aria-label="Place tags">
            {featurePlaceCard.chips.map((chip) => <span className={`blueprint-itinerary-place-chip kind-${chip.kind ?? "attribute"}`} key={chip.label}>{chip.label}</span>)}
          </span>
        </div>
      </> : <>
        {image ? <img className={imageClassName} src={image.url} alt={image.alt} loading="lazy" referrerPolicy="no-referrer" onLoad={() => setLoadedImageUrl(image.url)} onError={failImage} /> : null}
        <div className="blueprint-itinerary-card-heading">
          <div className="blueprint-itinerary-card-copy">
            <strong>{item.title}</strong>
            {item.placeMeta ? <small className="blueprint-itinerary-place-meta">{item.placeMeta}</small> : null}
            {item.purpose ? <span className="blueprint-itinerary-place-purpose">{item.purpose}</span> : null}
            {item.meta && !item.placeMeta ? <small>{item.meta}</small> : null}
          </div>
        </div>
        {item.statusLabel ? <em className="blueprint-itinerary-status">{item.statusLabel}</em> : null}
      </>}
    </button>
    {!featurePlaceCard && item.externalAction ? <a className="blueprint-itinerary-external-action" href={item.externalAction.url} target="_blank" rel="noreferrer">{item.externalAction.label}</a> : null}
    {item.draftActionLabel ? <button type="button" className="blueprint-itinerary-draft-action" onClick={onUndoDraft}>{item.draftActionLabel}</button> : null}
  </article>;
}

function locationPinIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s7-5.1 7-11a7 7 0 0 0-14 0c0 5.9 7 11 7 11Z" /><circle cx="12" cy="10" r="2" /></svg>;
}

function PendingItineraryCard({ item, selected, onSelect, onUndoDraft }: { item: ItineraryCardDisplay; selected: boolean; onSelect: () => void; onUndoDraft: () => void }) {
  const [failedImageUrl, setFailedImageUrl] = useState("");
  const image = itineraryCardImageForRender(item.image, failedImageUrl);
  return <article className={`blueprint-itinerary-block blueprint-itinerary-block-pending ${image ? "featured" : "compact"} primitive-${timelineVisualPrimitiveForItem(item)} role-${item.timelineRole} type-${item.type}${selected ? " selected" : ""}`}>
    <time className="blueprint-itinerary-time">{item.timeLabel}</time>
    <span className="blueprint-itinerary-rail" aria-hidden="true" />
    <span className="blueprint-itinerary-icon" aria-hidden="true">{itineraryItemIcon(item)}</span>
    <button type="button" className="blueprint-itinerary-card-main" aria-label={`Pending itinerary edit for ${item.title}`} onClick={onSelect}>
      {image ? <img className="blueprint-itinerary-thumbnail" src={image.url} alt={image.alt} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailedImageUrl(image.url)} /> : null}
      <div className="blueprint-itinerary-card-heading">
        <div className="blueprint-itinerary-card-copy">
          <strong>{item.title}</strong>
          {item.meta ? <small>{item.meta}</small> : null}
        </div>
      </div>
      {item.statusLabel ? <em className="blueprint-itinerary-status">{item.statusLabel}</em> : null}
    </button>
    {item.draftActionLabel ? <button type="button" className="blueprint-itinerary-draft-action" onClick={onUndoDraft}>{item.draftActionLabel}</button> : null}
  </article>;
}

function itineraryItemIcon(item: ItineraryCardDisplay) {
  if (item.timelineRole === "pending_place") return item.type === "stay" ? itineraryTypeIcon("stay") : itineraryTypeIcon(item.type);
  if (item.timelineRole === "rest") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6v6l3 2" /><path d="M4 12a8 8 0 1 0 8-8" /></svg>;
  if (item.timelineRole === "activity") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6v6l4 2" /><path d="M21 12a9 9 0 1 1-9-9" /><path d="M16 3h5v5" /></svg>;
  return itineraryTypeIcon(item.type);
}

function itineraryTypeIcon(type: ItineraryCardDisplay["type"]) {
  if (type === "dining") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3v8M11 3v8M7 7h4M9 11v10M17 3c1.7 1.7 2.5 3.7 2.5 6v3H16v9" /></svg>;
  if (type === "shopping") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 8h12l-1 13H7L6 8Z" /><path d="M9 8a3 3 0 0 1 6 0" /></svg>;
  if (type === "experience") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z" /><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z" /></svg>;
  if (type === "transport") return transportModeIcon("transit");
  if (type === "stay") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11V5" /><path d="M20 19v-7a3 3 0 0 0-3-3H9v10" /><path d="M4 19v-8h5" /><path d="M4 15h16" /></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s7-5.1 7-11a7 7 0 0 0-14 0c0 5.9 7 11 7 11Z" /><path d="M12 10.5h.01" /></svg>;
}

function transportModeIcon(mode: ItineraryCardDisplay["routeAfterMode"] | undefined) {
  if (mode === "walking") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 4.5a1.7 1.7 0 1 1 3.4 0 1.7 1.7 0 0 1-3.4 0Z" /><path d="M12.5 8.5 10 12l3 2 1.5 6" /><path d="M14 9l2.5 3H20" /><path d="M10 12l-2 8" /></svg>;
  if (mode === "driving") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l1.5-4.5h11L19 12" /><path d="M4 12h16v6H4v-6Z" /><path d="M7 18v2M17 18v2" /><path d="M7 15h.01M17 15h.01" /></svg>;
  if (mode === "transit") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" /><path d="M4 10h16M8 18l-2 3M16 18l2 3" /><path d="M8 14h.01M16 14h.01" /></svg>;
  if (mode === "rail") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h10a3 3 0 0 1 3 3v9a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V6a3 3 0 0 1 3-3Z" /><path d="M4 10h16M8 19l-2 3M16 19l2 3" /><path d="M8 15h.01M16 15h.01" /></svg>;
  if (mode === "flight") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11l18-7-7 18-3-8-8-3Z" /><path d="M11 14l10-10" /></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></svg>;
}

function clockIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 7v5l3 2" /><path d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>;
}

function BlueprintMap(props: { routePlaces: BlueprintMapPointDisplay[]; routeSegments: BlueprintRouteSegmentDisplay[]; routeRefresh?: ItineraryRouteRefreshDisplay | undefined; markers: BlueprintMapMarkerDisplay[]; fallbackViewport: BlueprintMapViewportDisplay; selectedPlaceId: string; onSelectPlace: (placeId: string) => void; routeRefreshBusy?: boolean }) {
  const [googleUnavailable, setGoogleUnavailable] = useState(false);
  const handleGoogleUnavailable = useCallback(() => setGoogleUnavailable(true), []);
  const apiKey = __LANDI_GOOGLE_MAPS_API_KEY__;
  if (apiKey && !googleUnavailable) return <GoogleBlueprintMap {...props} apiKey={apiKey} onUnavailable={handleGoogleUnavailable} />;
  return <LeafletBlueprintMap {...props} />;
}

function GoogleBlueprintMap({ routePlaces, routeSegments, routeRefresh, markers, fallbackViewport, selectedPlaceId, onSelectPlace, routeRefreshBusy, apiKey, onUnavailable }: { routePlaces: BlueprintMapPointDisplay[]; routeSegments: BlueprintRouteSegmentDisplay[]; routeRefresh?: ItineraryRouteRefreshDisplay | undefined; markers: BlueprintMapMarkerDisplay[]; fallbackViewport: BlueprintMapViewportDisplay; selectedPlaceId: string; onSelectPlace: (placeId: string) => void; routeRefreshBusy?: boolean; apiKey: string; onUnavailable: () => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<GoogleMapInstance | null>(null);
  const mapsRef = useRef<GoogleMapsNamespace | null>(null);
  const layersRef = useRef<GoogleMapLayer[]>([]);
  const lastFitKeyRef = useRef("");
  const [mapReady, setMapReady] = useState(false);
  const points = markers.filter((marker) => validCoordinates(marker.coordinates));
  const routeLines = routeLinesForMap(routePlaces, routeSegments);
  const fallbackLineState = fallbackRouteLineState(routeSegments, routeRefresh);
  const routeLatLngs = routePlaces.filter((place) => validCoordinates(place.coordinates)).map((place) => googleLatLngForCoordinates(place.coordinates!));
  const fitLatLngs = routeLatLngs.length ? routeLatLngs : points.map((marker) => googleLatLngForCoordinates(marker.coordinates!));
  const fallbackLatLng = googleLatLngForCoordinates(fallbackViewport.center);
  const markerRoles = useMemo(() => mapMarkerRoles(routePlaces), [routePlaces]);
  const hasFitTargets = fitLatLngs.length > 0;
  const fitKey = [
    routePlaces.filter((place) => validCoordinates(place.coordinates)).map((place) => `route:${place.placeId}:${place.coordinates!.join(",")}`).join("|"),
    routeLines.map((line) => `line:${line.id}:${line.mapLineState}`).join("|"),
    `fallback:${fallbackLineState ?? ""}`,
    points.map((marker) => `marker:${marker.placeId}:${marker.coordinates!.join(",")}:${marker.markerState}:${marker.type}`).join("|"),
    `viewport:${fallbackViewport.center.join(",")}:${fallbackViewport.zoom}`
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
        center: fitLatLngs[0] ?? fallbackLatLng,
        clickableIcons: false,
        disableDefaultUI: true,
        gestureHandling: "greedy",
        mapTypeId: "roadmap",
        styles: LANDI_GOOGLE_MAP_STYLES,
        zoom: fitLatLngs[0] ? 12 : fallbackViewport.zoom,
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

    if (routeLines.length) {
      for (const line of routeLines) {
        nextLayers.push(new maps.Polyline({
          geodesic: true,
          map,
          path: line.points.map((point) => googleLatLngForCoordinates(point.coordinates!)),
          ...googleRouteLineStyle(routeLineRenderState(line.mapLineState, Boolean(routeRefreshBusy)))
        }));
      }
    } else if (fallbackLineState && routeLatLngs.length > 1) {
      nextLayers.push(new maps.Polyline({
        geodesic: true,
        map,
        path: routeLatLngs,
        ...googleRouteLineStyle(fallbackLineState)
      }));
    }

    for (const marker of points) {
      nextLayers.push(createGoogleMapMarkerOverlay(maps, map, marker, markerRoles.get(marker.placeId) ?? "context", marker.placeId === selectedPlaceId, onSelectPlace));
    }
    layersRef.current = nextLayers;

    const selectedMarker = points.find((marker) => marker.placeId === selectedPlaceId);
    if (hasFitTargets && fitKey !== lastFitKeyRef.current) {
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
    } else if (!hasFitTargets) {
      map.setCenter(fallbackLatLng);
      map.setZoom(fallbackViewport.zoom);
    }
    lastFitKeyRef.current = fitKey;
  }, [fallbackLatLng, fallbackLineState, fallbackViewport.zoom, fitKey, fitLatLngs, hasFitTargets, mapReady, markerRoles, onSelectPlace, points, routeLatLngs, routeLines, routeRefreshBusy, selectedPlaceId]);

  return <section className="blueprint-map" aria-label="Itinerary map context">
    <div className="blueprint-map-stage blueprint-google-map" ref={hostRef} />
  </section>;
}

function LeafletBlueprintMap({ routePlaces, routeSegments, routeRefresh, markers, fallbackViewport, selectedPlaceId, onSelectPlace, routeRefreshBusy }: { routePlaces: BlueprintMapPointDisplay[]; routeSegments: BlueprintRouteSegmentDisplay[]; routeRefresh?: ItineraryRouteRefreshDisplay | undefined; markers: BlueprintMapMarkerDisplay[]; fallbackViewport: BlueprintMapViewportDisplay; selectedPlaceId: string; onSelectPlace: (placeId: string) => void; routeRefreshBusy?: boolean }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layersRef = useRef<L.LayerGroup | null>(null);
  const lastFitKeyRef = useRef("");
  const points = markers.filter((marker) => validCoordinates(marker.coordinates));
  const routeLines = routeLinesForMap(routePlaces, routeSegments);
  const fallbackLineState = fallbackRouteLineState(routeSegments, routeRefresh);
  const routeLatLngs = routePlaces.filter((place) => validCoordinates(place.coordinates)).map((place) => latLngForCoordinates(place.coordinates!));
  const fitLatLngs = routeLatLngs.length ? routeLatLngs : points.map((marker) => latLngForCoordinates(marker.coordinates!));
  const fallbackLatLng = latLngForCoordinates(fallbackViewport.center);
  const markerRoles = useMemo(() => mapMarkerRoles(routePlaces), [routePlaces]);
  const hasFitTargets = fitLatLngs.length > 0;
  const fitKey = [
    routePlaces.filter((place) => validCoordinates(place.coordinates)).map((place) => `route:${place.placeId}:${place.coordinates!.join(",")}`).join("|"),
    routeLines.map((line) => `line:${line.id}:${line.mapLineState}`).join("|"),
    `fallback:${fallbackLineState ?? ""}`,
    points.map((marker) => `marker:${marker.placeId}:${marker.coordinates!.join(",")}:${marker.markerState}:${marker.type}`).join("|"),
    `viewport:${fallbackViewport.center.join(",")}:${fallbackViewport.zoom}`
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

    if (routeLines.length) {
      for (const line of routeLines) {
        L.polyline(line.points.map((point) => latLngForCoordinates(point.coordinates!)), {
          ...leafletRouteLineStyle(routeLineRenderState(line.mapLineState, Boolean(routeRefreshBusy))),
          lineCap: "round",
          lineJoin: "round"
        }).addTo(layers);
      }
    } else if (fallbackLineState && routeLatLngs.length > 1) {
      L.polyline(routeLatLngs, {
        ...leafletRouteLineStyle(fallbackLineState),
        lineCap: "round",
        lineJoin: "round"
      }).addTo(layers);
    }

    for (const marker of points) {
      const selected = marker.placeId === selectedPlaceId;
      L.marker(latLngForCoordinates(marker.coordinates!), {
        icon: L.divIcon({
          className: "blueprint-leaflet-icon",
          html: mapMarkerHtml(marker, markerRoles.get(marker.placeId) ?? "context", selected),
          iconSize: [28, 28],
          iconAnchor: [MAP_MARKER_ANCHOR.x, MAP_MARKER_ANCHOR.y]
        }),
        title: marker.title,
        zIndexOffset: selected ? 400 : 0
      }).addTo(layers).on("click", () => onSelectPlace(marker.placeId));
    }

    const selectedMarker = points.find((marker) => marker.placeId === selectedPlaceId);
    if (hasFitTargets && fitKey !== lastFitKeyRef.current) {
      if (fitLatLngs.length === 1) {
        map.setView(fitLatLngs[0]!, 13, { animate: false });
      } else if (fitLatLngs.length > 1) {
        map.fitBounds(L.latLngBounds(fitLatLngs).pad(0.18), { maxZoom: 14, animate: false });
      }
    } else if (selectedMarker) {
      const currentZoom = map.getZoom();
      map.setView(latLngForCoordinates(selectedMarker.coordinates!), Number.isFinite(currentZoom) ? Math.max(currentZoom, 13) : 13, { animate: true });
    } else if (!hasFitTargets) {
      map.setView(fallbackLatLng, fallbackViewport.zoom);
    }
    lastFitKeyRef.current = fitKey;
  }, [fallbackLatLng, fallbackLineState, fallbackViewport.zoom, fitKey, fitLatLngs, hasFitTargets, markerRoles, onSelectPlace, points, routeLatLngs, routeLines, routeRefreshBusy, selectedPlaceId]);

  return <section className="blueprint-map" aria-label="Itinerary map context">
    <div className="blueprint-map-stage" ref={hostRef} />
  </section>;
}

function ExplorePanel({ filters, cards, filter, hidden, onFilter, onSelect, onAdd, onUndoDraft }: { filters: readonly Exclude<GuideFilter, "all">[]; cards: GuideCardDisplay[]; filter: GuideFilter; hidden: boolean; onFilter: (filter: GuideFilter) => void; onSelect: (placeId: string) => void; onAdd: (placeId: string) => void; onUndoDraft: (placeId: string) => void }) {
  const visibleCards = filterGuideCards(cards, { type: filter });
  return <div className="blueprint-explore-panel blueprint-panel-view" hidden={hidden}>
    <header><h3>Explore</h3></header>
    <div className="blueprint-guide-filters">{filters.map((item) => <button type="button" className={filter === item ? "active" : ""} aria-pressed={filter === item} onClick={() => onFilter(filter === item ? "all" : item)} key={item}>{guideFilterLabel(item)}</button>)}</div>
    <div className="blueprint-guide-list">
      {visibleCards.map((card) => <article className="blueprint-guide-card" key={card.placeId}>
        <button type="button" className="blueprint-guide-card-main" onClick={() => onSelect(card.placeId)}>
          <header><div><strong>{card.title}</strong><small>{[card.typeLabel, card.locationLabel].filter(Boolean).join(" · ")}</small></div>{card.practicalSignal ? <span className="blueprint-practical-pill">{card.practicalSignal}</span> : <span className="blueprint-priority-pill">{card.priorityLabel}</span>}</header>
          <p>{card.summary}</p>
          <div className="blueprint-guide-fit-row">
            {card.planFitLabel ? <span>{card.planFitLabel}</span> : null}
            {!card.practicalSignal && card.priorityLabel ? <small>{card.priorityLabel}</small> : null}
          </div>
          {card.image ? <SafeGuideImage image={card.image} /> : null}
          {card.tags.length ? <div className="blueprint-guide-tags">{card.tags.map((tag) => <span key={tag}>{tag}</span>)}</div> : null}
        </button>
        {(card.footerNote || card.canAdd || card.draftActionLabel || card.state === "scheduled") ? <footer>{card.footerNote ? <span>{card.footerNote}</span> : card.state === "scheduled" ? <span>Already in plan</span> : <span />}{card.canAdd && card.actionLabel ? <button type="button" onClick={() => onAdd(card.placeId)}>{card.actionLabel}</button> : null}{card.draftActionLabel ? <button type="button" className="secondary" onClick={() => onUndoDraft(card.placeId)}>{card.draftActionLabel}</button> : null}</footer> : null}
      </article>)}
      {!visibleCards.length ? <p className="blueprint-empty-note">No guide cards match these filters.</p> : null}
    </div>
  </div>;
}

function SafeGuideImage({ image }: { image: GuideCardImageDisplay }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return <img className="blueprint-guide-card-image" src={image.url} alt={image.alt} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
}

function SafeDetailImageFigure({ image }: { image: DetailImageDisplay }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return <figure className="blueprint-detail-image">
    <img src={image.url} alt={image.alt} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
    <figcaption>
      {image.caption ? <span>{image.caption}</span> : null}
      {image.source.url
        ? <a className="blueprint-detail-image-source" href={image.source.url} target="_blank" rel="noreferrer" aria-label={`Image source: ${image.source.summary}`}><span>Source</span><small role="tooltip">{image.source.summary}</small></a>
        : <span className="blueprint-detail-image-source" tabIndex={0} aria-label={`Image source: ${image.source.summary}`}><span>Source</span><small role="tooltip">{image.source.summary}</small></span>}
    </figcaption>
  </figure>;
}

function DetailPanel({ detail, hidden, onBack, onSelect, onAdd, onRemove, onUndoDraft }: { detail: DetailPlaceDisplay; hidden: boolean; onBack: () => void; onSelect: (placeId: string) => void; onAdd: (placeId: string) => void; onRemove: (placeId: string) => void; onUndoDraft: (placeId: string) => void }) {
  const showPrimaryAction = detail.scheduled || detail.canAdd || detail.primaryActionLabel !== "Background note";
  const showRemoveAction = detail.scheduled
    && (detail.canRemoveFromDay || detail.removeBlockedReason)
    && detail.removeBlockedReason !== "Background note";
  const showActions = showPrimaryAction || showRemoveAction || Boolean(detail.draftActionLabel) || detail.links.length > 0;
  return <div className="blueprint-detail-panel blueprint-panel-view" hidden={hidden}>
    <header>
      <button type="button" className="blueprint-detail-back" aria-label="Back to explore" onClick={onBack}><span aria-hidden="true" /></button>
      <div><h3>{detail.title}</h3>{detail.heroMeta.length ? <p>{detail.heroMeta.join(" · ")}</p> : null}</div>
    </header>
    {detail.itineraryDraftNote ? <p className="blueprint-detail-draft-note">{detail.itineraryDraftNote}</p> : null}
    {detail.image ? <SafeDetailImageFigure image={detail.image} /> : null}
    <section><h4>{detail.leadTitle}</h4><p>{detail.leadBody}</p></section>
    {(detail.visitFacts.length || (detail.planTitle && detail.planBody)) ? <section className="blueprint-detail-visit"><h4>Your visit</h4>{detail.visitFacts.length ? <div className="blueprint-detail-facts">{detail.visitFacts.map((fact) => <span key={fact}>{fact}</span>)}</div> : null}{detail.planTitle && detail.planBody ? <p>{detail.planBody}</p> : null}</section> : null}
    {(detail.reservationNote || detail.visitNotes.length) ? <section><h4>Before you go</h4>{detail.reservationNote ? <p>{detail.reservationNote}</p> : null}{detail.visitNotes.length ? <div className="blueprint-detail-visit-notes">{detail.visitNotes.map((note) => <article key={note.id}>
      <strong>{note.title}</strong>
      <p>{note.body}</p>
      {note.completion ? <small>{note.completion}</small> : null}
    </article>)}</div> : null}</section> : null}
    {detail.itineraryContext ? <section className="blueprint-detail-itinerary-context"><h4>{detail.itineraryContext.title}</h4>{detail.itineraryContext.body ? <p>{detail.itineraryContext.body}</p> : null}{detail.itineraryContext.items?.length ? <ul>{detail.itineraryContext.items.map((item) => <li key={item}>{item}</li>)}</ul> : null}</section> : null}
    {detail.comparisonTitle ? <section className="blueprint-comparison"><h4>Nearby & alternatives</h4><div role="table" aria-label={detail.comparisonTitle}>
      <div role="row"><span>Place</span><span>Where</span><span>Fit</span><span>Timing</span><span>Before going</span><span>Reference</span><span /></div>
      {detail.comparisonRows.map((row) => <div role="row" key={row.id}><strong>{row.name}</strong><span>{row.area}</span><span>{row.routeFit}</span><span>{row.timing}</span><span>{row.effort}</span><span>{row.sourceState}</span><button type="button" onClick={() => onSelect(row.id)}>Open</button></div>)}
    </div></section> : null}
    {(detail.detailSections.length || detail.guideContext.length || detail.relatedEvents.length) ? <section className="blueprint-detail-more"><h4>More about this place</h4>
      {detail.detailSections.map((section) => <article key={section.title}><h5>{section.title}</h5>{section.body ? <p>{section.body}</p> : null}{section.items?.length ? <ul>{section.items.map((item) => <li key={item}>{item}</li>)}</ul> : null}</article>)}
    </section> : null}
    {detail.guideContext.length ? <section className="blueprint-detail-guide-context"><h4>Worth noticing here</h4><div>{detail.guideContext.map((item) => <article key={`${item.kind}-${item.id}`}>
      <span>{item.label}</span>
      <strong>{item.title}</strong>
      {item.context ? <small>{item.context}</small> : null}
      <p>{item.description}</p>
    </article>)}</div></section> : null}
    {detail.relatedEvents.length ? <section className="blueprint-detail-events"><h4>Timing notes</h4><div>{detail.relatedEvents.map((event) => <article key={event.id}>
      <strong>{event.title}</strong>
      <p>{event.description}</p>
      {(event.dateLabel || event.locationLabel) ? <small>{[event.dateLabel, event.locationLabel].filter(Boolean).join(" · ")}</small> : null}
    </article>)}</div></section> : null}
    {detail.sources.length ? <details className="blueprint-detail-sources"><summary>{detail.sourceTitle ?? "Sources & verification"}</summary><div>{detail.sources.map((source) => source.url ? <a href={source.url} target="_blank" rel="noreferrer" key={`${source.url}-${source.summary}`}>{source.summary}</a> : <span key={source.summary}>{source.summary}</span>)}</div></details> : null}
    {showActions ? <section className="blueprint-detail-actions">
      {showPrimaryAction ? detail.scheduled || detail.canAdd ? <button type="button" onClick={() => detail.scheduled ? onSelect(detail.placeId) : onAdd(detail.placeId)}>{detail.primaryActionLabel}</button> : <span>{detail.primaryActionLabel}</span> : null}
      {showRemoveAction ? <button type="button" className="secondary" disabled={!detail.canRemoveFromDay} title={detail.removeBlockedReason} onClick={() => onRemove(detail.placeId)}>{detail.removeActionLabel ?? detail.removeBlockedReason ?? "Remove from day"}</button> : null}
      {detail.draftActionLabel ? <button type="button" className="secondary" onClick={() => onUndoDraft(detail.placeId)}>{detail.draftActionLabel}</button> : null}
      {detail.links.map((link) => <a href={link.url} target="_blank" rel="noreferrer" key={`${link.label}-${link.url}`}>{link.label}</a>)}
    </section> : null}
  </div>;
}

function PlacementPanel({ workspace, place, hidden, selectedDayId, onBack, onPreview }: { workspace: BlueprintWorkspaceDisplay; place?: BlueprintPlaceDisplay | undefined; hidden: boolean; selectedDayId?: string | undefined; onBack: () => void; onPreview: (edit: PendingItineraryEditDisplay) => void }) {
  const [dayId, setDayId] = useState(selectedDayId ?? workspace.placementDays[0]?.id ?? workspace.initialDayId);
  const [position, setPosition] = useState("end");
  const availableDays = place ? workspace.placementDays.filter((candidate) => placementDayAllowed(place, candidate.id)) : workspace.placementDays;
  const day = availableDays.find((candidate) => candidate.id === dayId) ?? availableDays[0];
  const itinerary = workspace.itineraries.find((candidate) => candidate.dayId === day?.id) ?? workspace.itineraries[0];
  if (!place || !day) return <div className="blueprint-placement-panel blueprint-panel-view" hidden={hidden}><p className="blueprint-empty-note">Select a guide card before choosing placement.</p></div>;
  const positionOptions = itinerary?.placementOptions ?? [];
  const selectedPosition = positionOptions.find((option) => option.id === position) ?? positionOptions[positionOptions.length - 1];
  const pendingPreview = buildPendingItineraryEditForWorkspace(workspace, place.id, { dayId: day.id, positionId: selectedPosition?.id ?? "end" });
  function previewPlacement() {
    onPreview(pendingPreview);
  }
  return <div className="blueprint-placement-panel blueprint-panel-view" hidden={hidden}>
    <header>
      <button type="button" className="blueprint-detail-back" aria-label="Back to explore" onClick={onBack}><span aria-hidden="true" /></button>
      <div><span>Placement</span><h3>{place.title}</h3></div>
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
    {pendingPreview.advisories.length ? <section className="blueprint-placement-advisory-panel">
      <h4>Before adding</h4>
      <ul className="blueprint-placement-advisories">{pendingPreview.advisories.map((advisory) => <li className={advisory.tone} key={advisory.text}>{advisory.text}</li>)}</ul>
    </section> : null}
    <section className="blueprint-detail-actions"><button type="button" onClick={previewPlacement}>Add to draft</button></section>
  </div>;
}

function tabIdForActualDay(workspace: BlueprintWorkspaceDisplay, dayId: string): string {
  return workspace.days.find((day) => day.id === dayId || day.dayIds?.includes(dayId))?.id ?? dayId;
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
  return Array.isArray(value)
    && value.length === 2
    && Number.isFinite(value[0])
    && Number.isFinite(value[1])
    && value[0] >= -90
    && value[0] <= 90
    && value[1] >= -180
    && value[1] <= 180;
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

function createGoogleMapMarkerOverlay(maps: GoogleMapsNamespace, map: GoogleMapInstance, marker: BlueprintMapMarkerDisplay, role: BlueprintMapMarkerRole, selected: boolean, onSelectPlace: (placeId: string) => void): GoogleMapLayer {
  const coordinates = marker.coordinates!;
  const position = new maps.LatLng(coordinates[0], coordinates[1]);
  const element = document.createElement("button");
  element.type = "button";
  element.className = selected ? "blueprint-google-marker selected" : "blueprint-google-marker";
  element.title = marker.title;
  element.innerHTML = mapMarkerHtml(marker, role, selected);
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

function googleRouteLineStyle(state: MapRouteLineRenderState): Record<string, unknown> {
  const color = state === "reference" ? "#8498a8" : state === "needs_refresh" ? "#7896a8" : state === "checking" ? "#5d93bd" : "#4f7fa6";
  const opacity = state === "reference" ? 0.3 : state === "needs_refresh" ? 0.4 : state === "checking" ? 0.56 : 0.58;
  const zIndex = state === "reference" ? 1 : state === "needs_refresh" ? 2 : state === "checking" ? 4 : 3;
  return {
    strokeColor: color,
    strokeOpacity: 0,
    strokeWeight: 2,
    icons: [{
      icon: { path: "M 0,-1 0,1", strokeColor: color, strokeOpacity: opacity, strokeWeight: 2, scale: 1 },
      offset: "0",
      repeat: "10px"
    }],
    zIndex
  };
}

function leafletRouteLineStyle(state: MapRouteLineRenderState): L.PolylineOptions {
  if (state === "checking") return { color: "#5d93bd", opacity: 0.56, weight: 2, dashArray: "3 7" };
  if (state === "needs_refresh") return { color: "#7896a8", opacity: 0.4, weight: 2, dashArray: "3 7" };
  if (state === "reference") return { color: "#8498a8", opacity: 0.3, weight: 2, dashArray: "3 7" };
  return { color: "#4f7fa6", opacity: 0.58, weight: 2, dashArray: "3 7" };
}

function mapMarkerRoles(routePlaces: BlueprintMapPointDisplay[]): Map<string, BlueprintMapMarkerRole> {
  const ordered = routePlaces.filter((place) => validCoordinates(place.coordinates));
  const roles = new Map<string, BlueprintMapMarkerRole>();
  ordered.forEach((place, index) => {
    const role = ordered.length === 1 || index === 0 ? "start" : index === ordered.length - 1 ? "end" : "stop";
    roles.set(place.placeId, role);
  });
  return roles;
}

function mapMarkerHtml(marker: BlueprintMapMarkerDisplay, role: BlueprintMapMarkerRole, selected: boolean): string {
  const stateClass = marker.markerState === "pending" ? "pending" : marker.markerState === "on-day" ? "on-day" : "context";
  return `<div class="blueprint-map-bubble role-${role} ${stateClass}${selected ? " selected" : ""}" aria-label="${escapeHtml(marker.title)}"><span class="blueprint-map-dot" aria-hidden="true"></span></div>`;
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
