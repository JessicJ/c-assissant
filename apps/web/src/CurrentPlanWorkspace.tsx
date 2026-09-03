import { useState } from "react";
import type { DestinationArrivalEvent, Plan, PlanChangeSet, PlanReplacementAudit, TripBlueprint, WorkspaceSnapshot } from "@c-assistant/core";
import { abandonActivePlan, deletePlan, sendAgentChat, undoPlanReplacement } from "./api-client.js";
import { BookingImportPanel } from "./BookingImportPanel.js";
import { LandiBlueprintWorkspace } from "./LandiBlueprintWorkspace.js";
import { PlanMapWorkspace } from "./PlanMapWorkspace.js";
import { PlanChangeNotice, PlanCommandCenter, PlanDecisionBoard, PlanGrounding, PlanReplacementNotice } from "./PlanStatusWidgets.js";
import { PlanRemindersView, PlanSourcesView, WorkspaceEmpty } from "./PlanSupportingViews.js";
import { FeaturedChecklist, FeaturedTimeline, PlanContentSection } from "./PlanTaskSections.js";
import { blueprintPresentation } from "./blueprint-presentation.js";
import { planRefinementQuestion } from "./plan-display.js";
import { visibleDocumentPolicySources } from "./plan-external-display.js";
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
    return <article className="current-plan-card native-trip-plan">
      {latestPlanReplacement ? <PlanReplacementNotice audit={latestPlanReplacement} active={plan.status === "active"} onUndo={undoReplacement} /> : null}
      <LandiBlueprintWorkspace plan={plan} presentation={plan.presentation} onRevise={onRevise} onTaskToggle={onTaskToggle} />
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
