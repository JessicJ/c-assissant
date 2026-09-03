import { useEffect, useState, type FormEvent } from "react";
import type { DestinationArrivalEvent, Plan, PlanChangeSet, PlanReplacementAudit, TripBlueprint, WorkspaceSnapshot } from "@c-assistant/core";
import { abandonActivePlan, deletePlan, linkPlanAccommodation, sendAgentChat, undoPlanReplacement } from "./api-client.js";
import { BookingImportPanel } from "./BookingImportPanel.js";
import { PlanMapWorkspace } from "./PlanMapWorkspace.js";
import { PlanChangeNotice, PlanCommandCenter, PlanDecisionBoard, PlanGrounding, PlanReplacementNotice } from "./PlanStatusWidgets.js";
import { PlanRemindersView, PlanSourcesView, WorkspaceEmpty } from "./PlanSupportingViews.js";
import { FeaturedChecklist, FeaturedTimeline, PlanContentSection } from "./PlanTaskSections.js";
import { TravelExternalHandoffs } from "./TravelExternalHandoffs.js";
import { blueprintPresentation } from "./blueprint-presentation.js";
import { planRefinementQuestion } from "./plan-display.js";
import { formatDistance, visibleDocumentPolicySources } from "./plan-external-display.js";
import { groupPackingItems, planPackingItems, readPackingChecks, writePackingChecks, type PackingDisplayItem } from "./plan-packing-list.js";
import { isExplicitPreparationTask } from "./plan-preparation-display.js";
import { displayPlanTitle } from "./trip-title.js";
import type { AgentStatus } from "./ui-types.js";

type PlanWorkspaceView = "plan" | "preparation" | "bookings" | "decisions" | "reminders" | "sources";

export function CurrentPlan({ plan, blueprint, destinationArrivals, latestPlanChange, latestPlanReplacement, onRevise, onTaskToggle, onTaskReorder, onUndoChange, onConfirm, onWorkspace, onStatus, onError, onOperationBusy, confirming }: { plan: Plan; blueprint?: TripBlueprint | undefined; destinationArrivals: DestinationArrivalEvent[]; latestPlanChange?: PlanChangeSet | undefined; latestPlanReplacement?: PlanReplacementAudit | undefined; onRevise: (message?: string) => void; onTaskToggle: (planId: string, taskId: string, checked: boolean) => Promise<void>; onTaskReorder: (planId: string, taskId: string, direction: "up" | "down") => Promise<void>; onUndoChange: (planId: string, changeId: string) => Promise<void>; onConfirm: (planId: string) => Promise<void>; onWorkspace: (workspace: WorkspaceSnapshot) => Promise<void>; onStatus: (status: AgentStatus) => void; onError: (message: string) => void; onOperationBusy: (busy: boolean) => void; confirming: boolean }) {
  if (blueprint && !plan.presentation) plan = { ...plan, presentation: blueprintPresentation(blueprint) };
  const [workspaceView, setWorkspaceView] = useState<PlanWorkspaceView>("plan");
  const [discarding, setDiscarding] = useState(false);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [regenerationStatus, setRegenerationStatus] = useState<string | null>(null);
  async function discardDraft() {
    if (discarding || plan.status !== "draft") return;
    setDiscarding(true);
    onOperationBusy(true);
    try {
      await onWorkspace(await deletePlan(plan.id));
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Unable to discard this plan draft.";
      onError(message);
    } finally { setDiscarding(false); onOperationBusy(false); }
  }
  async function abandonActive() {
    if (discarding || plan.status !== "active") return;
    setDiscarding(true);
    onOperationBusy(true);
    try {
      await onWorkspace(await abandonActivePlan(plan.id));
      onStatus({ tone: "success", text: "The active Plan was abandoned. Reminders and execution guidance for it no longer run." });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Unable to abandon the active plan.";
      onError(message); onStatus({ tone: "error", text: message });
    } finally { setDiscarding(false); onOperationBusy(false); }
  }
  async function regenerateItinerary() {
    if (regenerating || plan.status !== "draft") return;
    setRegenerating(true);
    onOperationBusy(true);
    onError("");
    setRegenerationStatus("Reviewing the destination and confirmed trip details…");
    const timers = [
      window.setTimeout(() => setRegenerationStatus("Finding places, reservation requirements, and map coordinates…"), 20_000),
      window.setTimeout(() => setRegenerationStatus("Building the daily timeline and connecting routes…"), 120_000)
    ];
    try {
      const message = "Keep all confirmed trip details, research the destination again, and create a complete mapped itinerary. Include a continuous day-by-day timeline, specific places, map markers, and routes between adjacent stops. Do not return a generic plan without places.";
      const payload = await sendAgentChat({ mode: "revise_plan", message, expectedPlanId: plan.id, expectedVersion: plan.version, impactConfirmed: true });
      if (!payload.workspace) throw new Error(payload.error ?? "The mapped itinerary was not completed.");
      setRegenerationStatus("Mapped itinerary ready.");
      await onWorkspace(payload.workspace);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "The mapped itinerary was not completed.";
      setRegenerationStatus(message);
    } finally {
      timers.forEach((timer) => window.clearTimeout(timer));
      setRegenerating(false);
      onOperationBusy(false);
    }
  }
  async function undoReplacement() {
    try {
      const payload = await undoPlanReplacement(plan.id, plan.version);
      await onWorkspace(payload);
      onStatus({ tone: "success", text: "The latest replacement was undone and the previous plan is active again." });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Unable to undo the latest plan replacement.";
      onError(message); onStatus({ tone: "error", text: message });
    }
  }
  const documentPolicySources = visibleDocumentPolicySources(plan);
  const visibleWorkspaceView = workspaceView === "sources" && !documentPolicySources.length ? "plan" : workspaceView;
  const refinementQuestion = planRefinementQuestion(plan);
  const checklistItems = plan.stages.flatMap((stage) => stage.tasks
    .filter(isExplicitPreparationTask)
    .map((task) => ({ task, stageTitle: stage.title })));
  const packingItems = planPackingItems(plan);
  const checklistTaskIds = new Set(checklistItems.map((item) => item.task.id));
  const timelineItems = plan.stages.flatMap((stage) => {
    const visibleTasks = stage.presentationKind === "itinerary"
      ? stage.tasks.filter((task) => !checklistTaskIds.has(task.id))
      : [];
    const visibleIds = new Set(visibleTasks.map((task) => task.id));
    return visibleTasks.map((task) => {
      const stageIndex = stage.tasks.findIndex((candidate) => candidate.id === task.id);
      return {
        task,
        canMoveUp: stageIndex > 0 && visibleIds.has(stage.tasks[stageIndex - 1]!.id),
        canMoveDown: stageIndex >= 0 && stageIndex < stage.tasks.length - 1 && visibleIds.has(stage.tasks[stageIndex + 1]!.id)
      };
    });
  });
  const timelineTasks = timelineItems.map((item) => item.task);
  const featuredTaskIds = new Set([...checklistItems.map((item) => item.task.id), ...timelineTasks.map((task) => task.id)]);
  const remainingStages = plan.stages
    .map((stage) => ({ ...stage, tasks: stage.tasks.filter((task) => !featuredTaskIds.has(task.id)) }))
    .filter((stage) => stage.tasks.length > 0);
  const leadSectionCount = Number(timelineTasks.length > 0);
  const reminderTasks = plan.stages.flatMap((stage) => stage.tasks.filter((task) => task.reminder).map((task) => ({ task, stageTitle: stage.title })));
  const workspaceViews: Array<{ id: PlanWorkspaceView; label: string; count?: number }> = [
    { id: "plan", label: "Plan" },
    { id: "preparation", label: "Preparation", count: checklistItems.length },
    { id: "bookings", label: "Bookings" },
    { id: "decisions", label: "Decisions", count: plan.assumptions.length },
    { id: "reminders", label: "Reminders", count: reminderTasks.length },
    ...(documentPolicySources.length ? [{ id: "sources" as const, label: "Document sources", count: documentPolicySources.length }] : [])
  ];
  const isTravelPlan = plan.stages.some((stage) => stage.presentationKind === "itinerary");
  const discardControl = (disabled = false) => confirmingDiscard
    ? <><button className="secondary-action" disabled={discarding} onClick={() => setConfirmingDiscard(false)}>Keep plan</button><button className="discard-plan-button confirm" disabled={discarding || disabled} onClick={() => void discardDraft()}>{discarding ? "Discarding…" : "Confirm discard"}</button></>
    : <button className="discard-plan-button" disabled={discarding || disabled} onClick={() => setConfirmingDiscard(true)}>Discard this plan</button>;
  const abandonControl = (disabled = false) => confirmingDiscard
    ? <><button className="secondary-action" disabled={discarding} onClick={() => setConfirmingDiscard(false)}>Keep plan</button><button className="discard-plan-button confirm" disabled={discarding || disabled} onClick={() => void abandonActive()}>{discarding ? "Abandoning…" : "Confirm abandon"}</button></>
    : <button className="discard-plan-button" disabled={discarding || disabled} onClick={() => setConfirmingDiscard(true)}>Abandon plan</button>;
  if (isTravelPlan && (plan.presentation?.kind !== "itinerary" || !plan.presentation.places.length)) {
    return <article className="current-plan-card native-trip-plan itinerary-generation-gap">
      <header><div><span className="section-eyebrow">TRIP ITINERARY</span><h2>{displayPlanTitle(plan)}</h2><p>{plan.location} · {plan.dates}</p></div><span className="plan-status draft">Mapped itinerary pending</span></header>
      <section><span>Trip details saved</span><h3>{regenerating ? "Landi is creating the complete itinerary" : "This itinerary is not complete yet"}</h3><p>{regenerating ? "Stay on this page to follow progress. The map and daily timeline will appear here when generation finishes." : "Regeneration will reuse confirmed dates, flights, party size, transport preferences, and trip goals. You will not need to answer the same questions again."}</p>{regenerationStatus ? <div className={regenerating ? "generation-progress working" : "generation-progress"} role="status"><i />{regenerationStatus}</div> : null}<button className="primary-action" disabled={regenerating || discarding} onClick={() => void regenerateItinerary()}>{regenerating ? "Creating itinerary…" : regenerationStatus ? "Generate again" : "Create mapped itinerary"}</button></section>
      <footer className="plan-footer"><div><strong>Create the itinerary or discard this plan</strong><span>Discarding returns to the previous plan, or to an empty workspace if none exists.</span></div><div className="plan-footer-actions">{discardControl(regenerating)}</div></footer>
    </article>;
  }
  if (plan.presentation?.kind === "itinerary" && plan.presentation.places.length) {
    const journalDates = plan.presentation.startDate && plan.presentation.endDate ? `${plan.presentation.startDate} — ${plan.presentation.endDate}` : plan.dates;
    const bookingsOpen = visibleWorkspaceView === "bookings";
    return <article className="current-plan-card native-trip-plan">
      {latestPlanReplacement ? <PlanReplacementNotice audit={latestPlanReplacement} active={plan.status === "active"} onUndo={undoReplacement} /> : null}
      <header className="editorial-trip-hero"><div className="editorial-trip-heading"><h1>{displayPlanTitle(plan)}</h1><p>{journalDates}</p></div><button type="button" className={bookingsOpen ? "secondary-action trip-bookings-button active" : "secondary-action trip-bookings-button"} aria-expanded={bookingsOpen} onClick={() => setWorkspaceView(bookingsOpen ? "plan" : "bookings")}>Bookings</button></header>
      {bookingsOpen ? <section className="plan-sections itinerary-bookings-panel"><BookingImportPanel scope={{ type: "plan", planId: plan.id }} expectedVersion={plan.version} onWorkspace={onWorkspace} onStatus={onStatus} onError={onError} /></section> : null}
      <PlanMapWorkspace planId={plan.id} planVersion={plan.version} presentation={plan.presentation} partySize={plan.configuration.travelContext.partySize} arrivals={destinationArrivals} editable={plan.status === "draft" || plan.status === "active"} onWorkspace={onWorkspace} onStatus={(text) => onStatus({ tone: "success", text })} onError={onError} onRevise={onRevise} />
      <TravelPackingList plan={plan} items={packingItems} onTaskToggle={onTaskToggle} />
      <TravelPlanAdditions plan={plan} editable={plan.status === "draft" && !blueprint} onWorkspace={onWorkspace} onStatus={onStatus} onError={onError} onRevise={onRevise} />
      <footer className="plan-footer actions-only"><div className="plan-footer-actions">{plan.status === "draft" ? discardControl() : abandonControl()}<button className="secondary-action" onClick={() => onRevise()}>Adjust in conversation</button>{plan.status === "draft" ? <button className="primary-action" disabled={confirming} onClick={() => void onConfirm(plan.id)}>{confirming ? "Confirming…" : "Confirm and activate"}</button> : null}</div></footer>
    </article>;
  }
  return <article className="current-plan-card">
    <header className="plan-hero"><div><span className={`plan-status ${plan.status}`}>{plan.status === "draft" ? "Draft for review" : "Active"}</span><h2>{plan.title}</h2><div className="plan-meta"><span>⌖ {plan.location}</span><span>◷ {plan.dates}</span></div></div></header>
    <PlanCommandCenter plan={plan} tasks={plan.stages.flatMap((stage) => stage.tasks)} onRevise={onRevise} />
    {latestPlanReplacement ? <PlanReplacementNotice audit={latestPlanReplacement} active={plan.status === "active"} onUndo={undoReplacement} /> : null}
    {latestPlanChange ? <PlanChangeNotice change={latestPlanChange} onUndo={() => onUndoChange(plan.id, latestPlanChange.id)} /> : null}
    <nav className="plan-workspace-tabs" aria-label="Plan workspace views">{workspaceViews.map((item) => <button type="button" className={visibleWorkspaceView === item.id ? "active" : ""} aria-current={visibleWorkspaceView === item.id ? "page" : undefined} onClick={() => setWorkspaceView(item.id)} key={item.id}>{item.label}{item.count !== undefined ? <span>{item.count}</span> : null}</button>)}</nav>
    {visibleWorkspaceView === "plan" ? <><PlanGrounding plan={plan} onContinue={onRevise} />{plan.presentation ? <PlanMapWorkspace planId={plan.id} planVersion={plan.version} presentation={plan.presentation} partySize={plan.configuration.travelContext.partySize} arrivals={destinationArrivals} editable={plan.status === "draft"} onWorkspace={onWorkspace} onStatus={(text) => onStatus({ tone: "success", text })} onError={onError} onRevise={onRevise} /> : null}<section className="plan-sections">{timelineItems.length ? <FeaturedTimeline plan={plan} index={0} items={timelineItems} onTaskReorder={onTaskReorder} /> : null}{remainingStages.map((stage, index) => <PlanContentSection key={stage.id} plan={plan} stage={stage} index={index + leadSectionCount} onTaskToggle={onTaskToggle} onTaskReorder={onTaskReorder} />)}</section></> : null}
    {visibleWorkspaceView === "preparation" ? checklistItems.length ? <section className="plan-sections"><FeaturedChecklist plan={plan} index={0} items={checklistItems} onTaskToggle={onTaskToggle} /></section> : <WorkspaceEmpty title="No pre-departure tasks" detail="Items to pack or complete before departure will appear here." /> : null}
    {visibleWorkspaceView === "bookings" ? <section className="plan-sections"><BookingImportPanel scope={{ type: "plan", planId: plan.id }} expectedVersion={plan.version} onWorkspace={onWorkspace} onStatus={onStatus} onError={onError} /></section> : null}
    {visibleWorkspaceView === "decisions" ? plan.assumptions.length ? <PlanDecisionBoard assumptions={plan.assumptions} onRevise={onRevise} /> : <WorkspaceEmpty title="No pending decisions" detail="The plan currently has no assumptions or tradeoffs that need your decision." /> : null}
    {visibleWorkspaceView === "reminders" ? <PlanRemindersView items={reminderTasks} active={plan.status === "active"} /> : null}
    {visibleWorkspaceView === "sources" ? <PlanSourcesView sources={documentPolicySources} /> : null}
    <footer className="plan-footer"><div><strong>{plan.status === "draft" ? "Confirm the complete plan" : "Need an adjustment?"}</strong><span>{plan.status === "draft" ? refinementQuestion ? "The complete plan is ready. The question above can improve execution accuracy but does not block review or confirmation." : "Confirmation enables only reminders and execution tasks backed by sufficient information." : "Changes first create a replacement draft. The current plan stays active until you confirm it."}</span></div><div className="plan-footer-actions">{plan.status === "draft" ? discardControl() : abandonControl()}<button className="secondary-action" onClick={() => onRevise()}>{plan.status === "draft" && refinementQuestion ? "Add plan details" : "Modify current plan"}</button>{plan.status === "draft" ? <button className="primary-action" disabled={confirming} onClick={() => void onConfirm(plan.id)}>{confirming ? "Confirming…" : "Confirm and activate"}</button> : null}</div></footer>
  </article>;
}

function TravelPlanAdditions({ plan, editable, onWorkspace, onStatus, onError, onRevise }: { plan: Plan; editable: boolean; onWorkspace: (workspace: WorkspaceSnapshot) => Promise<void>; onStatus: (status: AgentStatus) => void; onError: (message: string) => void; onRevise: (message?: string) => void }) {
  const accommodation = plan.configuration.accommodation;
  const bookingPlaces = plan.presentation?.places.filter((place) => place.bookingUrl && (!place.reservation || place.reservation.requirement === "required" || place.reservation.requirement === "recommended")) ?? [];
  const plannedPlaceIds = new Set(plan.presentation?.days.flatMap((day) => day.placeIds) ?? []);
  const plannedPlaces = plan.presentation?.places.filter((place) => plannedPlaceIds.has(place.id)) ?? [];
  const foodPlaces = plannedPlaces.filter((place) => /restaurant|food|bar|dining/i.test(`${place.category} ${place.name}`)).slice(0, 4);
  const routeHandoffs = (plan.presentation?.routeSegments ?? []).filter((segment) => segment.verification === "verified" && segment.mode !== "flight" && segment.mode !== "rail").slice(0, 4);
  const needsAccommodation = accommodation.status !== "confirmed";
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState(accommodation.name ?? "");
  const [address, setAddress] = useState(accommodation.address ?? "");
  const [confirmed, setConfirmed] = useState(accommodation.status === "confirmed");
  const [saving, setSaving] = useState(false);
  const departures = plan.presentation?.days.flatMap((day) => day.accommodationDeparture ? [{ day, departure: day.accommodationDeparture, place: plan.presentation!.places.find((place) => place.id === day.accommodationDeparture!.destinationPlaceId) }] : []) ?? [];
  async function saveAccommodation(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || !address.trim() || saving) return;
    setSaving(true);
    try {
      const payload = await linkPlanAccommodation(plan.id, { expectedVersion: plan.version, name: name.trim(), address: address.trim(), status: confirmed ? "confirmed" : "candidate" });
      await onWorkspace(payload.workspace);
      setFormOpen(false);
      onStatus({ tone: "success", text: `Accommodation saved. Departure routes updated for ${payload.impact?.verifiedDays ?? 0} days${payload.impact?.pendingDays ? `; ${payload.impact.pendingDays} more days need review` : ""}.` });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Unable to link the accommodation to the current plan.";
      onError(message); onStatus({ tone: "error", text: message });
    } finally { setSaving(false); }
  }

  return <section className="travel-plan-additions" aria-labelledby="travel-progress-title">
    <header><div><h2 id="travel-progress-title">Core trip details</h2></div></header>
    <div className="travel-plan-addition-grid">
      <article>
        <span className="travel-action-state">{needsAccommodation ? "Temporary accommodation base" : "Accommodation linked"}</span>
        <strong>{accommodation.name ?? "Accommodation not set"}</strong>
        <p>{accommodation.address ?? "Routes currently use the plan's temporary area base. Saving the actual accommodation recalculates affected daily departure routes."}</p>
        <button type="button" onClick={() => editable ? setFormOpen((open) => !open) : onRevise("Create a replacement draft using the new accommodation details and recalculate affected daily departure routes without overwriting the active plan.")}>{editable ? accommodation.status === "not_set" ? "Add accommodation" : "Change accommodation" : "Adjust in replacement draft"}</button>
        {departures.length ? <details className="accommodation-route-impact"><summary>Departure routes updated for {departures.filter(({ departure }) => departure.verification === "verified").length} of {departures.length} days</summary><div>{departures.map(({ day, departure, place }) => <p key={day.id}><strong>{day.shortLabel ?? day.date ?? day.label}</strong><span>{accommodation.name} → {place?.localizedName ?? place?.name ?? "First stop"}</span><em>{departure.verification === "verified" ? `${departure.durationMinutes ? `${departure.durationMinutes} min · ` : ""}${departure.distanceMeters ? formatDistance(departure.distanceMeters) : "Route verified"}` : "Route needs review"}</em></p>)}</div></details> : null}
      </article>
      {bookingPlaces.map((place) => <article className="booking-link-card" key={place.id}>
        <span className="travel-action-state booking">{place.reservation?.requirement === "required" ? "Reservation required" : place.reservation?.requirement === "recommended" ? "Reservation recommended" : "Official link"}</span>
        <strong>{place.name}</strong>
        {place.localizedName && place.localizedName !== place.name ? <small className="local-place-name">{place.localizedName}</small> : null}
        <p>{place.reservation?.note ?? "Official page saved. Confirm the exact date, time, and payment only if you choose this stop."}</p>
        {place.reservation?.verification === "verified" ? <small className="reservation-verification">Verified by Landi{place.reservation.checkedAt ? ` · ${place.reservation.checkedAt}` : ""}</small> : null}
        <a href={place.bookingUrl} target="_blank" rel="noreferrer">Open official booking ↗</a>
      </article>)}
    </div>
    {accommodation.name || foodPlaces.length || routeHandoffs.length ? <TravelExternalHandoffs accommodation={accommodation} foodPlaces={foodPlaces} routeHandoffs={routeHandoffs} plan={plan} /> : null}
    {formOpen ? <form className="accommodation-link-form" onSubmit={(event) => void saveAccommodation(event)}><label>Accommodation name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Hotel or apartment name" required /></label><label>Full address<input value={address} onChange={(event) => setAddress(event.target.value)} placeholder="Street address, city, and country" required /></label><label className="accommodation-confirmed"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />Accommodation is booked</label><div><button type="button" onClick={() => setFormOpen(false)}>Cancel</button><button type="submit" disabled={saving}>{saving ? "Saving and updating routes…" : "Save and update routes"}</button></div></form> : null}
  </section>;
}

function TravelPackingList({ plan, items, onTaskToggle }: { plan: Plan; items: PackingDisplayItem[]; onTaskToggle: (planId: string, taskId: string, checked: boolean) => Promise<void> }) {
  const [checkedSuggestions, setCheckedSuggestions] = useState<Set<string>>(() => readPackingChecks(localStorage, plan.id, plan.version));
  useEffect(() => setCheckedSuggestions(readPackingChecks(localStorage, plan.id, plan.version)), [plan.id, plan.version]);
  if (!items.length) return null;
  const groups = groupPackingItems(items);
  function toggleSuggested(key: string, checked: boolean) {
    setCheckedSuggestions((current) => {
      const next = new Set(current);
      if (checked) next.add(key);
      else next.delete(key);
      writePackingChecks(localStorage, plan.id, plan.version, next);
      return next;
    });
  }
  return <section className="travel-packing-list" aria-labelledby="travel-packing-title">
    <header><div><h2 id="travel-packing-title">Packing</h2></div><small>{items.length} items</small></header>
    <div className="travel-packing-groups">{groups.map((group) => <section key={group.title}>
      <header><strong>{group.title}</strong><small>{group.items.length} items</small></header>
      <div className="travel-packing-grid">{group.items.map((item) => {
        const checked = item.task ? item.task.status === "completed" : checkedSuggestions.has(item.key);
        return <label className={checked ? "checked" : ""} key={item.key}>
          <input type="checkbox" checked={checked} onChange={(event) => item.task ? void onTaskToggle(plan.id, item.task.id, event.target.checked) : toggleSuggested(item.key, event.target.checked)} />
          <div><strong>{item.title}</strong><small>{item.detail}</small></div>
        </label>;
      })}</div>
    </section>)}</div>
  </section>;
}
