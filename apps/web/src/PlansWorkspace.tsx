import { useEffect, useState } from "react";
import type { DestinationArrivalEvent, Plan, PlanChangeSet, PlanReplacementAudit, PlanningSession, TripBlueprint, WorkspaceSnapshot } from "@c-assistant/core";
import { ArrowRight, MapPin } from "lucide-react";
import { cancelPlanningGeneration, deletePlanningSession, getWorkspace } from "./api-client.js";
import { CurrentPlan } from "./CurrentPlanWorkspace.js";
import { PlanComposer } from "./PlanComposer.js";
import { HistoricalPlans } from "./PlanSupportingViews.js";
import type { AgentStatus } from "./ui-types.js";

export type PlanTab = "current" | "history";

export function PlansWorkspace({ currentPlan, activeBlueprint, planningSession, hidePlanningSession, latestPlanChange, latestPlanReplacement, executionPlan, destinationArrivals, history, tab, confirming, onTab, onCreate, onRevise, onDelete, onTaskToggle, onTaskReorder, onUndoChange, onConfirm, onPlanCreated, onStatus, onError, onOperationBusy }: { currentPlan: Plan | null; activeBlueprint?: TripBlueprint | undefined; planningSession?: PlanningSession | undefined; hidePlanningSession: boolean; latestPlanChange?: PlanChangeSet | undefined; latestPlanReplacement?: PlanReplacementAudit | undefined; executionPlan: Plan | null; destinationArrivals: DestinationArrivalEvent[]; history: Plan[]; tab: PlanTab; confirming: boolean; onTab: (tab: PlanTab) => void; onCreate: (prefill?: string) => void; onRevise: (message?: string) => void; onDelete: (plan: Plan) => Promise<void>; onTaskToggle: (planId: string, taskId: string, checked: boolean) => Promise<void>; onTaskReorder: (planId: string, taskId: string, direction: "up" | "down") => Promise<void>; onUndoChange: (planId: string, changeId: string) => Promise<void>; onConfirm: (planId: string) => Promise<void>; onPlanCreated: (workspace: WorkspaceSnapshot) => Promise<void>; onStatus: (status: AgentStatus) => void; onError: (message: string) => void; onOperationBusy: (busy: boolean) => void }) {
  return <div className="page-stack">
    <div className="segmented-tabs" role="tablist" aria-label="Plan type"><button className={tab === "current" ? "active" : ""} onClick={() => onTab("current")}>Current Plan</button><button className={tab === "history" ? "active" : ""} onClick={() => onTab("history")}>Plan History <span>{history.length}</span></button></div>
    {tab === "current" && !currentPlan && planningSession && !["draft_ready", "failed", "abandoned"].includes(planningSession.status) && !hidePlanningSession ? <PlanningSessionPanel session={planningSession} onPlanCreated={onPlanCreated} onStatus={onStatus} onError={onError} /> : null}
    {tab === "current" && executionPlan ? <ExecutionPlanNotice plan={executionPlan} /> : null}
    {tab === "current" ? currentPlan ? <CurrentPlan plan={currentPlan} blueprint={activeBlueprint} destinationArrivals={destinationArrivals} latestPlanChange={latestPlanChange} latestPlanReplacement={latestPlanReplacement} onRevise={onRevise} onTaskToggle={onTaskToggle} onTaskReorder={onTaskReorder} onUndoChange={onUndoChange} onConfirm={onConfirm} onWorkspace={onPlanCreated} onStatus={onStatus} onError={onError} onOperationBusy={onOperationBusy} confirming={confirming} /> : planningSession || hidePlanningSession ? null : <EmptyPlan onCreate={onCreate} /> : <HistoricalPlans plans={history} onDelete={onDelete} />}
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

function executionPlanNoticeKey(plan: Plan): string {
  return `landi:execution-plan-notice:dismissed:${plan.id}:${plan.version}`;
}

function isExecutionPlanNoticeDismissed(key: string): boolean {
  if (typeof localStorage === "undefined") return false;
  try {
    return localStorage.getItem(key) === "true";
  } catch {
    return false;
  }
}

function ExecutionPlanNotice({ plan }: { plan: Plan }) {
  const dismissalKey = executionPlanNoticeKey(plan);
  const [dismissed, setDismissed] = useState(() => isExecutionPlanNoticeDismissed(dismissalKey));

  useEffect(() => {
    setDismissed(isExecutionPlanNoticeDismissed(dismissalKey));
  }, [dismissalKey]);

  function dismiss() {
    try {
      localStorage.setItem(dismissalKey, "true");
    } catch {
      // The notice can still close for this session if storage is unavailable.
    }
    setDismissed(true);
  }

  if (dismissed) return null;
  return <section className="execution-plan-notice"><div><span>Active plan</span><strong>{plan.title}</strong><p>Reminders and the itinerary timeline still follow this plan. Landi will switch only after you confirm the complete replacement draft below.</p></div><em>Active</em><button type="button" className="execution-plan-notice-close" aria-label="Close active plan notice" onClick={dismiss}><span aria-hidden="true" /></button></section>;
}

function EmptyPlan({ onCreate }: { onCreate: (prefill?: string) => void }) {
  const [destination, setDestination] = useState("");

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onCreate(destination.trim());
  }

  return <section className="empty-plan">
    <div className="empty-plan-copy">
      <h1><span>Your next{" "}</span><span>journey starts <em className="hero-emphasis">here.<svg viewBox="0 0 180 24" aria-hidden="true" focusable="false"><path d="M5 19 C 46 3 118 1 175 12" /></svg></em></span></h1>
    </div>
    <form className="empty-plan-composer" onSubmit={submit}>
      <MapPin className="destination-icon" aria-hidden="true" strokeWidth={1.65} />
      <label className="visually-hidden" htmlFor="hero-destination">Where would you like to go?</label>
      <input id="hero-destination" value={destination} onChange={(event) => setDestination(event.target.value)} placeholder="Where would you like to go?" autoComplete="off" maxLength={500} />
      <button type="submit" aria-label="Start planning"><ArrowRight aria-hidden="true" strokeWidth={1.8} /></button>
    </form>
  </section>;
}
