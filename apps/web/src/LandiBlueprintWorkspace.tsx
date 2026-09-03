import { useMemo, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import type { Plan, PlanPlace, PlanPresentation } from "@c-assistant/core";
import {
  comparisonRowsForPlace,
  displayPlaceName,
  filterGuideCards,
  groupTipsByTheme,
  guideCardsForPresentation,
  guideFilterLabel,
  guideTypeForPlace,
  localTipsForPlan,
  preparationItemsForPlan,
  sourceMarkersForPlan,
  sourceSummariesForPlace,
  timelineBlocksForDay,
  type BlueprintWorkspaceArea,
  type GuideCardDisplay,
  type GuideFilter,
  type TimelineBlock
} from "./landi-blueprint-workspace-display.js";
import { groupPreparationItems } from "./plan-preparation-display.js";
import { displayTripTitle } from "./trip-title.js";

const guideFilters: Exclude<GuideFilter, "all">[] = ["attraction", "dining", "shopping", "experience"];
const workspaceAreas: BlueprintWorkspaceArea[] = ["itinerary", "preparation", "tips", "sources"];

export function LandiBlueprintWorkspace({ plan, presentation, onRevise, onTaskToggle }: {
  plan: Plan;
  presentation: PlanPresentation;
  onRevise: (message?: string) => void;
  onTaskToggle: (planId: string, taskId: string, checked: boolean) => Promise<void>;
}) {
  const [area, setArea] = useState<BlueprintWorkspaceArea>("itinerary");
  const dayStripRef = useRef<HTMLDivElement>(null);
  const dayDragRef = useRef<{ pointerId: number; startX: number; scrollLeft: number; dragged: boolean } | null>(null);
  const lastDayDragEndAtRef = useRef(0);
  const [selectedDayId, setSelectedDayId] = useState(presentation.days[0]?.id ?? "");
  const [selectedPlaceId, setSelectedPlaceId] = useState(presentation.days[0]?.placeIds[0] ?? presentation.places[0]?.id ?? "");
  const [panelMode, setPanelMode] = useState<"explore" | "detail">("explore");
  const [guideFilter, setGuideFilter] = useState<GuideFilter>("all");
  const selectedDay = presentation.days.find((day) => day.id === selectedDayId) ?? presentation.days[0];
  const selectedPlace = presentation.places.find((place) => place.id === selectedPlaceId) ?? presentation.places[0];
  const guideCards = useMemo(() => guideCardsForPresentation(presentation, plan.sources), [presentation, plan.sources]);
  const tips = useMemo(() => localTipsForPlan(plan), [plan]);
  const tipGroups = useMemo(() => groupTipsByTheme(tips), [tips]);
  const sources = useMemo(() => sourceMarkersForPlan(plan), [plan]);
  const preparationGroups = useMemo(() => groupPreparationItems(preparationItemsForPlan(plan)), [plan]);
  const activeBlocks = selectedDay ? timelineBlocksForDay(presentation, selectedDay) : [];

  function selectPlace(placeId: string, mode: "explore" | "detail" = "detail") {
    setSelectedPlaceId(placeId);
    const day = presentation.days.find((candidate) => candidate.placeIds.includes(placeId));
    if (day) setSelectedDayId(day.id);
    setPanelMode(mode);
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
        <h2>{displayTripTitle(presentation, plan.title)}</h2>
        <p>{presentation.startDate && presentation.endDate ? `${presentation.startDate} - ${presentation.endDate}` : plan.dates}</p>
      </div>
      <nav aria-label="Plan workspace areas">{workspaceAreas.map((item) => <button type="button" className={area === item ? "active" : ""} aria-current={area === item ? "page" : undefined} key={item} onClick={() => setArea(item)}>{areaLabel(item)}</button>)}</nav>
    </header>

    {area === "itinerary" ? <div className="blueprint-itinerary-grid">
      <aside className="blueprint-timeline" aria-label="Daily itinerary cards">
        <div className="blueprint-day-tabs">
          <div className="blueprint-day-strip" aria-label="Itinerary days" ref={dayStripRef} onPointerDown={startDayTabDrag} onPointerMove={moveDayTabDrag} onPointerUp={endDayTabDrag} onPointerCancel={endDayTabDrag} onPointerLeave={endDayTabDrag}>{presentation.days.map((day) => <button type="button" className={day.id === selectedDay?.id ? "active" : ""} key={day.id} onClick={(event) => handleDayTabClick(event, day.id)}>
            <strong>{day.shortLabel ?? day.date ?? day.label}</strong>
            <span>{day.city ?? day.title ?? "Trip day"}</span>
          </button>)}</div>
        </div>
        <div className="blueprint-timeline-list">
          {activeBlocks.map((block) => <ItineraryBlockCard block={block} selected={selectedPlace?.id === block.place.id} onSelect={() => selectPlace(block.place.id)} key={`${block.day.id}-${block.place.id}-${block.order}`} />)}
          {!activeBlocks.length ? <p className="blueprint-empty-note">No itinerary blocks are available for this day.</p> : null}
        </div>
      </aside>

      <BlueprintMap presentation={presentation} blocks={activeBlocks} selectedPlace={selectedPlace} onSelectPlace={selectPlace} />

      <aside className="blueprint-side-panel" aria-label="Itinerary side panel">
        <div className="blueprint-panel-body">
          <ExplorePanel cards={guideCards} filter={guideFilter} hidden={panelMode !== "explore"} onFilter={setGuideFilter} onSelect={selectPlace} onRevise={onRevise} />
          {selectedPlace ? <DetailPanel presentation={presentation} planSources={plan.sources} place={selectedPlace} hidden={panelMode !== "detail"} onBack={() => setPanelMode("explore")} onSelect={selectPlace} onRevise={onRevise} /> : <p className="blueprint-empty-note" hidden={panelMode !== "detail"}>Select a timeline block or guide card to open details.</p>}
        </div>
      </aside>
    </div> : null}

    {area === "preparation" ? <section className="blueprint-page blueprint-preparation" aria-label="Preparation checklist">
      {preparationGroups.length ? preparationGroups.map((group) => <section className="blueprint-check-group" key={group.title}>
        <h4>{group.title}</h4>
        <div>{group.items.map(({ task }) => <details className={task.status === "completed" ? "blueprint-check-item checked" : "blueprint-check-item"} key={task.id}>
          <summary>
            <input aria-label={task.title} type="checkbox" checked={task.status === "completed"} onClick={(event) => event.stopPropagation()} onChange={(event) => void onTaskToggle(plan.id, task.id, event.target.checked)} />
            <span><strong>{task.title}</strong></span>
          </summary>
          {task.description ? <p>{task.description}</p> : null}
        </details>)}</div>
      </section>) : <p className="blueprint-empty-note">No explicit travel preparation checklist is available for this plan.</p>}
    </section> : null}

    {area === "tips" ? <section className="blueprint-page blueprint-tips" aria-label="Destination tips">
      {tipGroups.length ? <div className="blueprint-tip-groups">{tipGroups.map((group) => <section className="blueprint-tip-group" key={group.theme}>
        <h4>{group.theme}</h4>
        <div className="blueprint-tip-grid">{group.tips.map((tip) => <article key={tip.id}>
          <p>{tip.body}</p>
          <small>{tip.context}</small>
        </article>)}</div>
      </section>)}</div> : <p className="blueprint-empty-note">No destination-specific tips were provided in this plan.</p>}
    </section> : null}

    {area === "sources" ? <section className="blueprint-page blueprint-sources" aria-label="Sources">
      {sources.length ? <div className="blueprint-source-list">{sources.map((source) => source.url ? <a href={source.url} target="_blank" rel="noreferrer" key={`${source.url}-${source.summary}`}>{source.summary}</a> : <p key={source.summary}>{source.summary}</p>)}</div> : <p className="blueprint-empty-note">No sources are attached to this plan yet.</p>}
    </section> : null}
  </section>;
}

function ItineraryBlockCard({ block, selected, onSelect }: { block: TimelineBlock; selected: boolean; onSelect: () => void }) {
  return <button type="button" className={selected ? "blueprint-itinerary-block selected" : "blueprint-itinerary-block"} onClick={onSelect}>
    <span>{block.timeLabel}</span>
    <div>
      <strong>{displayPlaceName(block.place)}</strong>
      <small>{guideFilterLabel(block.type)} · {block.place.area ?? block.place.locationLabel}</small>
      {block.status ? <em>{block.status}</em> : null}
    </div>
  </button>;
}

function BlueprintMap({ presentation, blocks, selectedPlace, onSelectPlace }: { presentation: PlanPresentation; blocks: TimelineBlock[]; selectedPlace?: PlanPlace | undefined; onSelectPlace: (placeId: string) => void }) {
  const points = presentation.places.filter((place) => validCoordinates(place.coordinates));
  const bounds = mapBounds(points);
  const routePoints = blocks.map((block) => block.place).filter((place) => validCoordinates(place.coordinates)).map((place) => mapPosition(place.coordinates!, bounds));
  return <section className="blueprint-map" aria-label="Itinerary map context">
    <div className="blueprint-map-stage">
      <svg aria-hidden="true" viewBox="0 0 100 100" preserveAspectRatio="none">
        {routePoints.length > 1 ? <polyline points={routePoints.map((point) => `${point.x},${point.y}`).join(" ")} /> : null}
      </svg>
      {points.map((place) => {
        const point = mapPosition(place.coordinates!, bounds);
        const scheduledToday = blocks.some((block) => block.place.id === place.id);
        return <button type="button" className={`${selectedPlace?.id === place.id ? "selected " : ""}${scheduledToday ? "on-day" : ""}`} style={{ left: `${point.x}%`, top: `${point.y}%` }} title={displayPlaceName(place)} key={place.id} onClick={() => onSelectPlace(place.id)}>
          <span>{scheduledToday ? blocks.find((block) => block.place.id === place.id)?.order : ""}</span>
        </button>;
      })}
    </div>
    <footer>{blocks.slice(0, -1).map((block) => block.routeAfter ? <span className={block.routeAfter.verification} key={block.routeAfter.id}>{block.routeAfter.label ?? "Movement"}{block.routeAfter.durationMinutes ? ` · ${block.routeAfter.durationMinutes} min` : ""}</span> : null)}</footer>
  </section>;
}

function ExplorePanel({ cards, filter, hidden, onFilter, onSelect, onRevise }: { cards: GuideCardDisplay[]; filter: GuideFilter; hidden: boolean; onFilter: (filter: GuideFilter) => void; onSelect: (placeId: string) => void; onRevise: (message?: string) => void }) {
  const visibleCards = filterGuideCards(cards, { type: filter });
  return <div className="blueprint-explore-panel blueprint-panel-view" hidden={hidden}>
    <header><h3>Itinerary Explore</h3></header>
    <div className="blueprint-guide-filters">{guideFilters.map((item) => <button type="button" className={filter === item ? "active" : ""} onClick={() => onFilter(filter === item ? "all" : item)} key={item}>{guideFilterLabel(item)}</button>)}</div>
    <div className="blueprint-guide-list">
      {visibleCards.map((card) => <article className="blueprint-guide-card" key={card.place.id}>
        <button type="button" className="blueprint-guide-card-main" onClick={() => onSelect(card.place.id)}>
          <header><div><strong>{displayPlaceName(card.place)}</strong></div></header>
          <p>{card.summary}</p>
          <div className="blueprint-guide-tags">{card.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
        </button>
        <footer>{card.state !== "unscheduled" ? <span>{card.state === "scheduled" ? `In itinerary${card.timeline ? ` · ${card.timeline.label} ${card.timeline.timeLabel}` : ""}` : "Informational"}</span> : <span />}{card.state === "unscheduled" ? <button type="button" onClick={() => onRevise(`I want to add ${displayPlaceName(card.place)} to the itinerary. Show the placement options and impact before saving.`)}>Add</button> : null}</footer>
      </article>)}
      {!visibleCards.length ? <p className="blueprint-empty-note">No guide cards match these filters.</p> : null}
    </div>
  </div>;
}

function DetailPanel({ presentation, planSources, place, hidden, onBack, onSelect, onRevise }: { presentation: PlanPresentation; planSources: Plan["sources"]; place: PlanPlace; hidden: boolean; onBack: () => void; onSelect: (placeId: string) => void; onRevise: (message?: string) => void }) {
  const type = guideTypeForPlace(place);
  const rows = comparisonRowsForPlace(presentation, place);
  const scheduled = presentation.days.find((day) => day.placeIds.includes(place.id));
  const detailSources = sourceSummariesForPlace(place, planSources);
  return <div className="blueprint-detail-panel blueprint-panel-view" hidden={hidden}>
    <header>
      <button type="button" className="blueprint-detail-back" aria-label="Back to explore" onClick={onBack}><span aria-hidden="true" /></button>
      <div><span>{guideFilterLabel(type)}</span><h3>{displayPlaceName(place)}</h3><p>{place.area ?? place.locationLabel}{scheduled ? ` · ${scheduled.shortLabel ?? scheduled.date ?? scheduled.label}` : ""}</p></div>
    </header>
    <section><h4>{detailLeadTitle(type)}</h4><p>{place.whyWorthIt || place.plan}</p></section>
    {place.plan ? <section><h4>{detailPlanTitle(type)}</h4><p>{place.plan}</p></section> : null}
    {place.detailSections.map((section) => <section key={section.title}><h4>{section.title}</h4>{section.body ? <p>{section.body}</p> : null}{section.items?.length ? <ul>{section.items.map((item) => <li key={item}>{item}</li>)}</ul> : null}</section>)}
    {detailSources.length ? <section className="blueprint-detail-sources"><h4>Sources</h4><div>{detailSources.map((source) => source.url ? <a href={source.url} target="_blank" rel="noreferrer" key={`${source.url}-${source.summary}`}>{source.summary}</a> : <span key={source.summary}>{source.summary}</span>)}</div></section> : null}
    {rows.length && type !== "attraction" ? <section className="blueprint-comparison"><h4>{comparisonTitle(type)}</h4><div role="table" aria-label={comparisonTitle(type)}>
      <div role="row"><span>Name</span><span>Area</span><span>Route fit</span><span>Timing</span><span>Effort</span><span>Source</span><span /></div>
      {rows.map((row) => <div role="row" key={row.id}><strong>{row.name}</strong><span>{row.area}</span><span>{row.routeFit}</span><span>{row.timing}</span><span>{row.effort}</span><span>{row.sourceState}</span><button type="button" onClick={() => onSelect(row.id)}>Review</button></div>)}
    </div></section> : null}
    <section className="blueprint-detail-actions"><button type="button" onClick={() => scheduled ? onSelect(place.id) : onRevise(`I want to add ${displayPlaceName(place)} to the itinerary. Show the placement options and impact before saving.`)}>{scheduled ? "Locate in timeline" : "Add in conversation"}</button>{place.officialUrl ? <a href={place.officialUrl} target="_blank" rel="noreferrer">Official site</a> : null}{place.mapUrl ? <a href={place.mapUrl} target="_blank" rel="noreferrer">Map link</a> : null}{place.bookingUrl ? <a href={place.bookingUrl} target="_blank" rel="noreferrer">Booking link</a> : null}</section>
  </div>;
}

function areaLabel(area: BlueprintWorkspaceArea): string {
  return area === "itinerary" ? "Itinerary" : area === "preparation" ? "Preparation" : area === "tips" ? "Tips" : "Sources";
}

function detailLeadTitle(type: GuideFilter): string {
  return type === "dining" ? "What to eat" : type === "shopping" ? "What to buy" : type === "experience" ? "Experience fit" : "Why it matters";
}

function detailPlanTitle(type: GuideFilter): string {
  return type === "dining" ? "Meal context" : type === "shopping" ? "Purchase context" : type === "experience" ? "How it works" : "Visit style";
}

function comparisonTitle(type: GuideFilter): string {
  return type === "dining" ? "Dining place comparison" : type === "shopping" ? "Purchase place comparison" : "Experience offering comparison";
}

function validCoordinates(value: PlanPlace["coordinates"]): value is [number, number] {
  return Array.isArray(value) && value.length === 2 && value.every(Number.isFinite);
}

function mapBounds(places: PlanPlace[]): { minLat: number; maxLat: number; minLng: number; maxLng: number } {
  if (!places.length) return { minLat: 0, maxLat: 1, minLng: 0, maxLng: 1 };
  const lats = places.map((place) => place.coordinates![0]);
  const lngs = places.map((place) => place.coordinates![1]);
  return { minLat: Math.min(...lats), maxLat: Math.max(...lats), minLng: Math.min(...lngs), maxLng: Math.max(...lngs) };
}

function mapPosition(coordinates: [number, number], bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number }): { x: number; y: number } {
  const lngSpan = bounds.maxLng - bounds.minLng || 1;
  const latSpan = bounds.maxLat - bounds.minLat || 1;
  return {
    x: 8 + ((coordinates[1] - bounds.minLng) / lngSpan) * 84,
    y: 92 - ((coordinates[0] - bounds.minLat) / latSpan) * 84
  };
}
