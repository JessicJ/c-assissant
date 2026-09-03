import { useState } from "react";
import type { DestinationArrivalEvent, Plan, PlanChangeSet, PlanReplacementAudit, PlanningSession, TripBlueprint, WorkspaceSnapshot } from "@c-assistant/core";
import { cancelPlanningGeneration, deletePlanningSession, getWorkspace } from "./api-client.js";
import { BookingImportPanel } from "./BookingImportPanel.js";
import { CurrentPlan } from "./CurrentPlanWorkspace.js";
import { PlanComposer } from "./PlanComposer.js";
import { HistoricalPlans } from "./PlanSupportingViews.js";
import type { AgentStatus } from "./ui-types.js";

export type PlanTab = "current" | "history";

export function PlansWorkspace({ currentPlan, activeBlueprint, planningSession, hidePlanningSession, latestPlanChange, latestPlanReplacement, executionPlan, destinationArrivals, history, tab, confirming, onTab, onCreate, onRevise, onDelete, onTaskToggle, onTaskReorder, onUndoChange, onConfirm, onPlanCreated, onStatus, onError, onOperationBusy }: { currentPlan: Plan | null; activeBlueprint?: TripBlueprint | undefined; planningSession?: PlanningSession | undefined; hidePlanningSession: boolean; latestPlanChange?: PlanChangeSet | undefined; latestPlanReplacement?: PlanReplacementAudit | undefined; executionPlan: Plan | null; destinationArrivals: DestinationArrivalEvent[]; history: Plan[]; tab: PlanTab; confirming: boolean; onTab: (tab: PlanTab) => void; onCreate: () => void; onRevise: (message?: string) => void; onDelete: (plan: Plan) => Promise<void>; onTaskToggle: (planId: string, taskId: string, checked: boolean) => Promise<void>; onTaskReorder: (planId: string, taskId: string, direction: "up" | "down") => Promise<void>; onUndoChange: (planId: string, changeId: string) => Promise<void>; onConfirm: (planId: string) => Promise<void>; onPlanCreated: (workspace: WorkspaceSnapshot) => Promise<void>; onStatus: (status: AgentStatus) => void; onError: (message: string) => void; onOperationBusy: (busy: boolean) => void }) {
  return <div className="page-stack">
    <div className="segmented-tabs" role="tablist" aria-label="Plan type"><button className={tab === "current" ? "active" : ""} onClick={() => onTab("current")}>Current Plan</button><button className={tab === "history" ? "active" : ""} onClick={() => onTab("history")}>Plan History <span>{history.length}</span></button></div>
    {tab === "current" && !currentPlan && planningSession && !["draft_ready", "failed", "abandoned"].includes(planningSession.status) && !hidePlanningSession ? <PlanningSessionPanel session={planningSession} onPlanCreated={onPlanCreated} onStatus={onStatus} onError={onError} /> : null}
    {tab === "current" && executionPlan ? <ExecutionPlanNotice plan={executionPlan} /> : null}
    {tab === "current" ? currentPlan ? <CurrentPlan plan={currentPlan} blueprint={activeBlueprint} destinationArrivals={destinationArrivals} latestPlanChange={latestPlanChange} latestPlanReplacement={latestPlanReplacement} onRevise={onRevise} onTaskToggle={onTaskToggle} onTaskReorder={onTaskReorder} onUndoChange={onUndoChange} onConfirm={onConfirm} onWorkspace={onPlanCreated} onStatus={onStatus} onError={onError} onOperationBusy={onOperationBusy} confirming={confirming} /> : planningSession || hidePlanningSession ? null : <EmptyPlan onCreate={onCreate} onPlanCreated={onPlanCreated} onStatus={onStatus} onError={onError} /> : <HistoricalPlans plans={history} onDelete={onDelete} />}
  </div>;
}

function PlanningSessionPanel({ session, onPlanCreated, onStatus, onError }: { session: PlanningSession; onPlanCreated: (workspace: WorkspaceSnapshot) => Promise<void>; onStatus: (status: AgentStatus) => void; onError: (message: string) => void }) {
  const [abandoning, setAbandoning] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [confirmingAbandon, setConfirmingAbandon] = useState(false);
  async function cancelGeneration() {
    if (cancelling) return;
    setCancelling(true);
    try {
      await cancelPlanningGeneration(session.id);
      await onPlanCreated(await getWorkspace({ cache: "no-store" }));
      onStatus({ tone: "success", text: "Generation cancelled. Saved research can be resumed from this proposal." });
    } catch (caught) { const message = caught instanceof Error ? caught.message : "Unable to cancel generation."; onError(message); }
    finally { setCancelling(false); }
  }
  async function abandon() {
    if (abandoning) return;
    setAbandoning(true);
    try {
      await onPlanCreated(await deletePlanningSession(session.id));
    } catch (caught) { const message = caught instanceof Error ? caught.message : "Unable to abandon this planning session."; onError(message); }
    finally { setAbandoning(false); }
  }
  return <section className="planning-session-panel"><header><div><h2>Plan your trip with Landi</h2></div><div className="planning-session-controls">{session.status === "generating" ? <button type="button" onClick={() => void cancelGeneration()} disabled={cancelling}>{cancelling ? "Cancelling…" : "Cancel generation"}</button> : confirmingAbandon ? <><button type="button" onClick={() => setConfirmingAbandon(false)} disabled={abandoning}>Keep planning</button><button type="button" className="danger" onClick={() => void abandon()} disabled={abandoning}>{abandoning ? "Abandoning…" : "Confirm"}</button></> : <button type="button" onClick={() => setConfirmingAbandon(true)} disabled={abandoning}>Abandon session</button>}</div></header><PlanComposer key={session.id} mode="new_plan" currentPlan={null} planningSession={session} onPlanCreated={onPlanCreated} onStatus={onStatus} onComplete={() => undefined} onError={onError} /></section>;
}

function ExecutionPlanNotice({ plan }: { plan: Plan }) {
  return <section className="execution-plan-notice"><div><span>Active plan</span><strong>{plan.title}</strong><p>Reminders and the itinerary timeline still follow this plan. Landi will switch only after you confirm the complete replacement draft below.</p></div><em>Active</em></section>;
}

function EmptyPlan({ onCreate, onPlanCreated, onStatus, onError }: { onCreate: () => void; onPlanCreated: (workspace: WorkspaceSnapshot) => Promise<void>; onStatus: (status: AgentStatus) => void; onError: (message: string) => void }) {
  return <section className="empty-plan">
    <div className="empty-plan-copy"><h2>No trip yet.<br />Start with your next departure.</h2></div>
    <div className="empty-plan-composer"><div><span>Create a new plan</span><strong>Tell Landi where you want to go</strong></div><button className="primary-action" onClick={onCreate}>Start a conversation <span>→</span></button></div>
    <div className="empty-plan-booking-import"><BookingImportPanel scope={{ type: "planning" }} compact onWorkspace={onPlanCreated} onStatus={onStatus} onError={onError} /></div>
  </section>;
}
