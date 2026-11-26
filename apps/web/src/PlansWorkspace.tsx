import { safePlanError } from "./api-client.js";
import { useEffect, useState } from "react";
import type { DestinationArrivalEvent, Plan, PlanChangeSet, PlanReplacementAudit, PlanningSession, TripBlueprint, WorkspaceSnapshot } from "@c-assistant/core";
import { ArrowRight, MapPin } from "lucide-react";
import { cancelPlanningGeneration, deletePlanningSession, getWorkspace } from "./api-client.js";
import { CurrentPlan } from "./CurrentPlanWorkspace.js";
import { PlanComposer } from "./PlanComposer.js";
import { serverPlanningContinuation } from "./planning-continuation.js";
import { HistoricalPlans } from "./PlanSupportingViews.js";
import type { AgentStatus } from "./ui-types.js";

export type PlanTab = "current" | "history";

export function PlansWorkspace({ onDeclarePreDeparture, reviewPhase, reviewEvidence, reviewArrangements, currentPlan, activeBlueprint, planningSession, hidePlanningSession, latestPlanChange, latestPlanReplacement, latestDirectBlueprintRevision, executionPlan, destinationArrivals, history, tab, confirming, onTab, onCreate, onRevise, onDelete, onTaskToggle, onTaskReorder, onUndoChange, onConfirm, onPlanCreated, onStatus, onError, onOperationBusy }: { onDeclarePreDeparture?: (()=>Promise<void>) | undefined; reviewPhase?: import("@c-assistant/core").TravelPhase["value"] | undefined; reviewEvidence?: import("./api-client.js").ReviewObservation[] | undefined; reviewArrangements?: import("./api-client.js").PlanConfirmationReview["arrangements"] | undefined; currentPlan: Plan | null; activeBlueprint?: TripBlueprint | undefined; planningSession?: PlanningSession | undefined; hidePlanningSession: boolean; latestDirectBlueprintRevision?: WorkspaceSnapshot["latestDirectBlueprintRevision"] | undefined; latestPlanChange?: PlanChangeSet | undefined; latestPlanReplacement?: PlanReplacementAudit | undefined; executionPlan: Plan | null; destinationArrivals: DestinationArrivalEvent[]; history: Plan[]; tab: PlanTab; confirming: boolean; onTab: (tab: PlanTab) => void; onCreate: (prefill?: string) => void; onRevise: (message?: string) => void; onDelete: (plan: Plan) => Promise<void>; onTaskToggle: (planId: string, taskId: string, checked: boolean) => Promise<void>; onTaskReorder: (planId: string, taskId: string, direction: "up" | "down") => Promise<void>; onUndoChange: (planId: string, changeId: string) => Promise<void>; onConfirm: (planId: string) => Promise<void>; onPlanCreated: (workspace: WorkspaceSnapshot) => Promise<void>; onStatus: (status: AgentStatus) => void; onError: (message: string) => void; onOperationBusy: (busy: boolean) => void }) {
  return <div className="page-stack">
    <div className="segmented-tabs" role="tablist" aria-label="Plan type"><button className={tab === "current" ? "active" : ""} onClick={() => onTab("current")}>Current Plan</button><button className={tab === "history" ? "active" : ""} onClick={() => onTab("history")}>Plan History <span>{history.length}</span></button></div>
    {tab === "current" && !currentPlan && planningSession && !["draft_ready", "failed", "abandoned"].includes(planningSession.status) && !hidePlanningSession ? <PlanningSessionPanel session={planningSession} onPlanCreated={onPlanCreated} onStatus={onStatus} onError={onError} /> : null}
    {tab === "current" && executionPlan ? <><ExecutionPlanNotice plan={executionPlan} /><section className="execution-plan-notice" aria-label="替代方案审阅"><div><h2>Review the complete arrangements before confirming</h2><p>Viewing or refreshing keeps the executing itinerary unchanged. Confirmation applies to the itinerary and sources you reviewed; review again if they change.</p>{reviewEvidence ? <><h3>Travel phase and reported changes</h3><p>{reviewPhase === "pre_departure" ? "You have confirmed that you have not departed." : reviewPhase === "on_trip" ? "Travel evidence indicates that your trip is underway." : "Your travel phase is unconfirmed."}</p>{reviewPhase!=="pre_departure" ? <button type="button" onClick={()=>void onDeclarePreDeparture?.()}>我确认尚未出发</button> : null}{reviewEvidence.length ? reviewEvidence.map((fact,index)=><SourceReview key={index} fact={fact}/>) : <p>No change evidence is saved yet. Source applicability still needs review.</p>}</> : <p>Loading the confirmation information…</p>}<ArrangementComparison label="原执行安排" arrangement={reviewArrangements?.original}/>{currentPlan ? <ArrangementComparison label="完整替代安排" arrangement={reviewArrangements?.replacement}/> : null}</div></section></> : null}
    {tab === "current" ? currentPlan ? <CurrentPlan latestDirectBlueprintRevision={latestDirectBlueprintRevision} plan={currentPlan} blueprint={activeBlueprint} destinationArrivals={destinationArrivals} latestPlanChange={latestPlanChange} latestPlanReplacement={latestPlanReplacement} onRevise={onRevise} onTaskToggle={onTaskToggle} onTaskReorder={onTaskReorder} onUndoChange={onUndoChange} onConfirm={onConfirm} onWorkspace={onPlanCreated} onStatus={onStatus} onError={onError} onOperationBusy={onOperationBusy} confirming={confirming} /> : planningSession || hidePlanningSession ? null : <EmptyPlan onCreate={onCreate} /> : <HistoricalPlans plans={history} onDelete={onDelete} />}
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
    } catch (caught) { const message = safePlanError(caught, "Unable to cancel generation."); onError(message); }
    finally { setCancelling(false); }
  }
  async function abandon() {
    if (abandoning) return;
    setAbandoning(true);
    try {
      await onPlanCreated(await deletePlanningSession(session.id));
    } catch (caught) { const message = safePlanError(caught, "Unable to abandon this planning session."); onError(message); }
    finally { setAbandoning(false); }
  }
  return <section className="planning-session-panel"><header><div><h2>Plan your trip with Landi</h2></div><div className="planning-session-controls">{session.status === "generating" ? <button type="button" onClick={() => void cancelGeneration()} disabled={cancelling}>{cancelling ? "Cancelling…" : "Cancel generation"}</button> : confirmingAbandon ? <><button type="button" onClick={() => setConfirmingAbandon(false)} disabled={abandoning}>Keep planning</button><button type="button" className="danger" onClick={() => void abandon()} disabled={abandoning}>{abandoning ? "Abandoning…" : "Confirm"}</button></> : <button type="button" onClick={() => setConfirmingAbandon(true)} disabled={abandoning}>Abandon session</button>}</div></header><PlanComposer key={session.id} mode="new_plan" currentPlan={null} planningSession={session} continuation={serverPlanningContinuation} onPlanCreated={onPlanCreated} onStatus={onStatus} onComplete={() => undefined} onError={onError} /></section>;
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
  return <section className="execution-plan-notice"><div><span>Active plan</span><strong>{plan.title}</strong><p>Reminders and the itinerary timeline still follow this plan. Before departure, Landi switches after you confirm the complete replacement draft below. During travel, reliable objective changes may update the itinerary automatically.</p></div><em>Active</em><button type="button" className="execution-plan-notice-close" aria-label="Close active plan notice" onClick={dismiss}><span aria-hidden="true" /></button></section>;
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

function ArrangementComparison({label,arrangement}:{label:string;arrangement?:import("./api-client.js").ReviewArrangement|null|undefined}) {
  return <details open><summary>{label} · {arrangement?.title??"Loading arrangements…"}</summary>{arrangement?.days.map((day,index)=><div key={index}><h3>{calendarDate(day.date)} · {day.city} · {day.title}</h3><p>{day.summary}</p><ol>{day.lines.map((line,index)=><li key={index}>{line}</li>)}</ol></div>)}{arrangement?.commitments.length ? <><h3>预订与固定承诺</h3><ul>{arrangement.commitments.map((line,index)=><li key={index}>{line}</li>)}</ul></> : <p>No booking constraints have been saved.</p>}</details>;
}
function calendarDate(value:string|null) {return value ? new Date(value+"T12:00:00").toLocaleDateString() : "日期未知";}
function SourceReview({fact}:{fact:import("./api-client.js").ReviewObservation}) {
  const source:Record<string,string>={venue:"场馆资料",weather_current:"当前天气",weather_forecast:"目标日预报",saved_booking:"本地保存预订（非实时供应商）"};
  const status:Record<string,string>={unknown:"Unverified",failed:"Could not retrieve",expired:"Expired",ambiguous:"Ambiguous information",uncovered:"Not covered",changed:"Change confirmed",recovered:"Recovery confirmed",unchanged:"Unchanged",reliable:"Verified"};
  const instant=(value:string|null)=>value ? new Date(value).toLocaleString() : "未知";
  return <div><h4>{fact.activities.length ? fact.activities.map(item=>`${item.title}（${calendarDate(item.date)}）`).join("、") : fact.subject}</h4><p>Applies to: {calendarDate(fact.targetDate)} · {source[fact.sourceKind]??"旅行资料"} · {status[fact.status]??"Unverified"}</p>{fact.safeFacts.length ? <ul>{fact.safeFacts.map((item,index)=><li key={index}>{item.label}：{item.date ? calendarDate(item.date) : item.localDateTime ? new Date(item.localDateTime).toLocaleString() : item.value}</li>)}</ul> : <p>Detailed source facts are not available yet.</p>}<p>{fact.impact}</p><p>Observed: {instant(fact.factObservedAt)} · Retrieved: {instant(fact.retrievedAt)} · Valid until: {instant(fact.validUntil)}</p></div>;
}
