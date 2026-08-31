import { useEffect, useRef, useState, type FormEvent } from "react";
import type { RuntimeCheck } from "@c-assistant/agent-adapters";
import type { AgentRuntimeKind, BookingConstraintStrength, BookingImportPreview, DestinationArrivalEvent, InboxItem, Plan, PlanChangeImpactPreview, PlanChangeSet, PlanPlace, PlanReplacementAudit, PlanRouteSegment, PlanningProposal, PlanningSession, Profile, ProfileGender, ImmigrationStatus, Task, TravelBooking, TripBlueprint, WorkspaceSnapshot } from "@c-assistant/core";
import landiLogoUrl from "../../../assets/branding/landi-round-otter-earth-icon-final.png";
import { PlanMapWorkspace } from "./PlanMapWorkspace.js";
import { blueprintPresentation } from "./blueprint-presentation.js";
import { displayPlanTitle } from "./trip-title.js";
import "./styles.css";
import "./editorial.css";

type View = "plans" | "settings";
type PlanTab = "current" | "history";
type PlanWorkspaceView = "plan" | "preparation" | "bookings" | "decisions" | "reminders" | "sources";
type ComposerMode = "new_plan" | "revise_plan";
type AgentStatus = { tone: "working" | "success" | "error"; text: string };
type ChatMessage = { id: string; role: "assistant" | "user"; text: string };
type BookingImportSource = { sourceLabel: string; content: string };
type PendingBookingPreview = { id: string; preview: BookingImportPreview; booking: TravelBooking; sourceLabel: string; sourceContent: string };
type PlanGenerationState = { runId: string; sessionId: string; generationKey?: string; stage: "queued" | "research" | "itinerary" | "import" | "compile" | "ready" | "failed" | "cancelled"; status: "running" | "succeeded" | "failed" | "cancelled"; startedAt: string; updatedAt: string; scopeLabel?: string; savedPlaceCount?: number; failureCode?: string; message?: string };
type AgentChatResponse = { reply?: string; workspace?: WorkspaceSnapshot; planningSession?: PlanningSession; proposal?: PlanningProposal; planningStatus?: PlanningSession["status"]; generated?: boolean; accepted?: boolean; generation?: PlanGenerationState; followUpQuestion?: string; readyForReview?: boolean; evidenceStatus?: "verified" | "partial"; error?: string };

function generationStageMessage(stage: PlanGenerationState["stage"]): string {
  if (stage === "queued") return "Starting plan generation…";
  if (stage === "research") return "Researching places by geographic area and saving each batch…";
  if (stage === "itinerary") return "Creating the daily itinerary from the saved place catalog…";
  if (stage === "import") return "Publishing the complete Trip Blueprint…";
  if (stage === "compile") return "Preparing reviewable execution tasks…";
  if (stage === "ready") return "The complete Trip Blueprint and Plan are ready.";
  if (stage === "cancelled") return "Plan generation was cancelled.";
  return "Plan generation did not finish. Your trip details are saved.";
}

function generationProgressMessage(generation: PlanGenerationState): string {
  const base = generationStageMessage(generation.stage);
  const scope = generation.scopeLabel ? ` Current area: ${generation.scopeLabel}.` : "";
  const saved = generation.savedPlaceCount !== undefined ? ` ${generation.savedPlaceCount} places saved.` : "";
  return `${base}${scope}${saved}`;
}
type LocalConfiguration = {
  google?: { configured: boolean };
  uber?: { configured: boolean };
  telegram?: { configured: boolean };
};
type LocalConfigurationForm = { googleMapsApiKey: string; uberClientId: string; telegramBotToken: string };
type TestState = { status: "idle" | "testing" | "success" | "error"; message: string };
type RecognitionResultEvent = { results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> };
type RecognitionErrorEvent = { error: string };
type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: RecognitionResultEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: RecognitionErrorEvent) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};
type SpeechRecognitionWindow = Window & {
  SpeechRecognition?: new () => SpeechRecognitionLike;
  webkitSpeechRecognition?: new () => SpeechRecognitionLike;
};

const idleTest = (): TestState => ({ status: "idle", message: "Not tested" });

export default function App() {
  const [view, setView] = useState<View>("plans");
  const [planTab, setPlanTab] = useState<PlanTab>("current");
  const [workspace, setWorkspace] = useState<WorkspaceSnapshot | null>(null);
  const [history, setHistory] = useState<Plan[]>([]);
  const [configuration, setConfiguration] = useState<LocalConfiguration | null>(null);
  const [runtimeChecks, setRuntimeChecks] = useState<RuntimeCheck[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [composerMode, setComposerMode] = useState<ComposerMode>("new_plan");
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerPrefill, setComposerPrefill] = useState("");
  const [agentStatus, setAgentStatus] = useState<AgentStatus | null>(null);
  const [confirmingPlan, setConfirmingPlan] = useState(false);
  const [planOperationBusy, setPlanOperationBusy] = useState(false);

  async function loadWorkspace() {
    const response = await fetch("/api/workspace");
    if (!response.ok) throw new Error("The core service did not return workspace data.");
    setWorkspace(await response.json() as WorkspaceSnapshot);
  }

  async function loadHistory() {
    const response = await fetch("/api/plans/history");
    if (response.ok) setHistory(await response.json() as Plan[]);
  }

  async function loadSettings() {
    const [configurationResponse, runtimeResponse] = await Promise.all([fetch("/api/configuration"), fetch("/api/runtimes")]);
    if (configurationResponse.ok) setConfiguration(await configurationResponse.json() as LocalConfiguration);
    if (runtimeResponse.ok) setRuntimeChecks(await runtimeResponse.json() as RuntimeCheck[]);
  }

  useEffect(() => {
    void Promise.all([loadWorkspace(), loadHistory(), loadSettings()])
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Unable to load the workspace."))
      .finally(() => setLoading(false));
  }, []);

  const generatingSessionId = workspace?.planningSession?.status === "generating" ? workspace.planningSession.id : undefined;
  useEffect(() => {
    if (!generatingSessionId) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const response = await fetch("/api/workspace", { cache: "no-store" });
        if (!response.ok || cancelled) return;
        const next = await response.json() as WorkspaceSnapshot;
        if (cancelled) return;
        setWorkspace(next);
        if (next.planningSession?.status === "draft_ready" || next.activePlan.id !== workspace?.activePlan.id) await loadHistory();
      } catch { /* Keep the current page stable and try again on the next interval. */ }
    };
    void poll();
    const interval = window.setInterval(() => void poll(), 5_000);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, [generatingSessionId]);

  function openComposer(mode: ComposerMode, prefill = "") {
    if (workspace?.profile.status !== "ready" || planOperationBusy) return;
    setAgentStatus(null);
    setComposerMode(mode);
    setComposerPrefill(prefill);
    setComposerOpen(true);
  }

  async function handlePlanCreated(next: WorkspaceSnapshot) {
    setWorkspace(next);
    await loadHistory();
    setView("plans");
    setPlanTab("current");
  }

  async function deleteHistoricalPlan(plan: Plan) {
    if (!window.confirm(`Delete the archived plan “${plan.title}”? This cannot be undone.`)) return;
    try {
      const response = await fetch(`/api/plans/${encodeURIComponent(plan.id)}/history`, { method: "DELETE" });
      if (!response.ok) throw new Error((await response.json() as { error?: string }).error ?? "Unable to delete the archived plan.");
      setHistory((current) => current.filter((item) => item.id !== plan.id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to delete the archived plan.");
    }
  }

  async function togglePlanTask(planId: string, taskId: string, checked: boolean) {
    try {
      const response = await fetch(`/api/plans/${encodeURIComponent(planId)}/tasks/${encodeURIComponent(taskId)}/check`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ checked }) });
      const payload = await response.json() as WorkspaceSnapshot & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Unable to save the checklist status.");
      setWorkspace(payload);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save the checklist status.");
    }
  }

  async function reorderPlanTask(planId: string, taskId: string, direction: "up" | "down") {
    if (!workspace || workspace.activePlan.id !== planId) return;
    try {
      const response = await fetch(`/api/plans/${encodeURIComponent(planId)}/changes`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "reorder_task", taskId, direction, expectedVersion: workspace.activePlan.version }) });
      const payload = await response.json() as { workspace?: WorkspaceSnapshot; change?: PlanChangeSet; error?: string };
      if (!response.ok || !payload.workspace) throw new Error(payload.error ?? "Unable to reorder the itinerary.");
      setWorkspace(payload.workspace); setAgentStatus({ tone: "success", text: "The new order is saved. Review affected transfer times before confirmation." });
    } catch (caught) { const message = caught instanceof Error ? caught.message : "Unable to reorder the itinerary."; setError(message); setAgentStatus({ tone: "error", text: message }); }
  }

  async function undoPlanChange(planId: string, changeId: string) {
    if (!workspace || workspace.activePlan.id !== planId) return;
    try {
      const response = await fetch(`/api/plans/${encodeURIComponent(planId)}/changes/${encodeURIComponent(changeId)}/undo`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedVersion: workspace.activePlan.version }) });
      const payload = await response.json() as WorkspaceSnapshot & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Unable to undo the change.");
      setWorkspace(payload); setAgentStatus({ tone: "success", text: "The itinerary reorder was undone." });
    } catch (caught) { const message = caught instanceof Error ? caught.message : "Unable to undo the change."; setError(message); setAgentStatus({ tone: "error", text: message }); }
  }

  async function confirmCurrentPlan(planId: string) {
    try {
      setConfirmingPlan(true);
      const response = await fetch(`/api/plans/${encodeURIComponent(planId)}/confirm`, { method: "POST" });
      const payload = await response.json() as WorkspaceSnapshot & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Unable to confirm the plan.");
      setWorkspace(payload);
      await loadHistory();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to confirm the plan.");
    } finally {
      setConfirmingPlan(false);
    }
  }

  if (loading) return <main className="loading-screen"><span />Loading Landi…</main>;
  if (!workspace) return <main className="loading-screen error-screen">{error ?? "The workspace is temporarily unavailable."}</main>;

  const currentPlan = isStarterPlan(workspace.activePlan) ? null : workspace.activePlan;
  const resumablePlanningSession = workspace.planningSession && ["collecting", "proposal_ready", "proposal_confirmed", "generating"].includes(workspace.planningSession.status)
    ? workspace.planningSession
    : undefined;
  const visibleHistory = history.filter((plan) => !isStarterPlan(plan));

  const emptyHome = view === "plans" && planTab === "current" && !currentPlan && !resumablePlanningSession;
  const planningHome = view === "plans" && planTab === "current" && !currentPlan && (Boolean(resumablePlanningSession) || (composerOpen && composerMode === "new_plan"));

  return <main className={`app-shell${emptyHome || planningHome ? " empty-home" : ""}${planningHome ? " planning-home" : ""}`}>
    <section className="main-stage">
      <header className="global-header">
        <button className="top-brand" onClick={() => { setView("plans"); setPlanTab("current"); }} aria-label="Return to current plan"><span><strong>LANDI</strong><small>Managed by MAH</small></span></button>
        <nav className="global-navigation" aria-label="Main navigation">
          <button className={view === "plans" && planTab === "current" ? "active" : ""} onClick={() => { setView("plans"); setPlanTab("current"); }}>Plan</button>
          <button className={view === "plans" && planTab === "history" ? "active" : ""} onClick={() => { setView("plans"); setPlanTab("history"); }}>Plan History</button>
          <button className={view === "settings" ? "active" : ""} onClick={() => setView("settings")}>Settings</button>
        </nav>
        <div className="header-actions">
          <button className="new-plan-button" onClick={() => openComposer("new_plan")} disabled={planOperationBusy}><span>＋</span>{planOperationBusy ? "Creating" : "Create Plan"}</button>
        </div>
      </header>
      {error ? <div className="inline-alert">{error}<button onClick={() => setError(null)}>Close</button></div> : null}
      {view === "plans" ? composerOpen && planTab === "current" && workspace.profile.status === "ready" ? <InlineComposerWorkspace mode={composerMode} currentPlan={currentPlan} planningSession={composerMode === "new_plan" ? resumablePlanningSession : undefined} initialMessage={composerPrefill} onClose={() => { setComposerOpen(false); setComposerPrefill(""); }} onPlanCreated={handlePlanCreated} onStatus={setAgentStatus} onError={setError} /> : <PlansWorkspace currentPlan={currentPlan} activeBlueprint={workspace.activeBlueprint} planningSession={resumablePlanningSession} hidePlanningSession={Boolean(currentPlan)} latestPlanChange={workspace.latestPlanChange} latestPlanReplacement={workspace.latestPlanReplacement} executionPlan={workspace.executionPlan ?? null} destinationArrivals={workspace.destinationArrivals} activity={workspace.inbox} history={visibleHistory} tab={planTab} confirming={confirmingPlan} onTab={setPlanTab} onCreate={() => openComposer("new_plan")} onRevise={(message) => openComposer("revise_plan", message)} onDelete={deleteHistoricalPlan} onTaskToggle={togglePlanTask} onTaskReorder={reorderPlanTask} onUndoChange={undoPlanChange} onConfirm={confirmCurrentPlan} onPlanCreated={handlePlanCreated} onStatus={setAgentStatus} onError={setError} onOperationBusy={setPlanOperationBusy} /> : null}
      {view === "settings" ? <SettingsWorkspace workspace={workspace} configuration={configuration} checks={runtimeChecks} onWorkspace={setWorkspace} onConfiguration={setConfiguration} onChecks={setRuntimeChecks} onError={setError} /> : null}
    </section>
    {workspace.profile.status !== "ready" ? <ProfileOnboardingDialog profile={workspace.profile} onSaved={setWorkspace} onError={setError} /> : null}
    {agentStatus ? <aside className={`agent-status-float ${agentStatus.tone}`} role="status" aria-live="polite"><img src={landiLogoUrl} alt="" /><div><strong>{agentStatus.tone === "error" ? "Needs attention" : agentStatus.tone === "working" ? "Landi is checking" : "Saved"}</strong><span>{agentStatus.text}</span></div><button type="button" onClick={() => setAgentStatus(null)} aria-label="Dismiss status">×</button></aside> : null}
  </main>;
}

function PlansWorkspace({ currentPlan, activeBlueprint, planningSession, hidePlanningSession, latestPlanChange, latestPlanReplacement, executionPlan, destinationArrivals, activity, history, tab, confirming, onTab, onCreate, onRevise, onDelete, onTaskToggle, onTaskReorder, onUndoChange, onConfirm, onPlanCreated, onStatus, onError, onOperationBusy }: { currentPlan: Plan | null; activeBlueprint?: TripBlueprint | undefined; planningSession?: PlanningSession | undefined; hidePlanningSession: boolean; latestPlanChange?: PlanChangeSet | undefined; latestPlanReplacement?: PlanReplacementAudit | undefined; executionPlan: Plan | null; destinationArrivals: DestinationArrivalEvent[]; activity: InboxItem[]; history: Plan[]; tab: PlanTab; confirming: boolean; onTab: (tab: PlanTab) => void; onCreate: () => void; onRevise: (message?: string) => void; onDelete: (plan: Plan) => Promise<void>; onTaskToggle: (planId: string, taskId: string, checked: boolean) => Promise<void>; onTaskReorder: (planId: string, taskId: string, direction: "up" | "down") => Promise<void>; onUndoChange: (planId: string, changeId: string) => Promise<void>; onConfirm: (planId: string) => Promise<void>; onPlanCreated: (workspace: WorkspaceSnapshot) => Promise<void>; onStatus: (status: AgentStatus) => void; onError: (message: string) => void; onOperationBusy: (busy: boolean) => void }) {
  return <div className="page-stack">
    <div className="segmented-tabs" role="tablist" aria-label="Plan type"><button className={tab === "current" ? "active" : ""} onClick={() => onTab("current")}>Current Plan</button><button className={tab === "history" ? "active" : ""} onClick={() => onTab("history")}>Plan History <span>{history.length}</span></button></div>
    {tab === "current" && !currentPlan && planningSession && !["draft_ready", "failed", "abandoned"].includes(planningSession.status) && !hidePlanningSession ? <PlanningSessionPanel session={planningSession} onPlanCreated={onPlanCreated} onStatus={onStatus} onError={onError} /> : null}
    {tab === "current" && executionPlan ? <ExecutionPlanNotice plan={executionPlan} /> : null}
    {tab === "current" ? currentPlan ? <CurrentPlan plan={currentPlan} blueprint={activeBlueprint} destinationArrivals={destinationArrivals} latestPlanChange={latestPlanChange} latestPlanReplacement={latestPlanReplacement} onRevise={onRevise} onTaskToggle={onTaskToggle} onTaskReorder={onTaskReorder} onUndoChange={onUndoChange} onConfirm={onConfirm} onWorkspace={onPlanCreated} onStatus={onStatus} onError={onError} onOperationBusy={onOperationBusy} confirming={confirming} /> : planningSession || hidePlanningSession ? null : <EmptyPlan onCreate={onCreate} onPlanCreated={onPlanCreated} onStatus={onStatus} onError={onError} /> : <HistoricalPlans plans={history} onDelete={onDelete} />}
  </div>;
}

function PlanActivityHistory({ items }: { items: InboxItem[] }) {
  if (!items.length) return null;
  const visibleItems = items.filter((item, index) => items.findIndex((candidate) => candidate.title === item.title && candidate.body === item.body) === index).slice(0, 8);
  return <details className="plan-activity-history"><summary><span>Recent sync activity</span><small>Collapsed by default</small></summary><div>{visibleItems.map((item) => <article key={item.id}><span className={`activity-tone ${item.tone}`} /><div><strong>{item.title}</strong><p>{item.body}</p></div><time>{item.timestamp}</time></article>)}</div></details>;
}

function PlanningSessionPanel({ session, onPlanCreated, onStatus, onError }: { session: PlanningSession; onPlanCreated: (workspace: WorkspaceSnapshot) => Promise<void>; onStatus: (status: AgentStatus) => void; onError: (message: string) => void }) {
  const [abandoning, setAbandoning] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [confirmingAbandon, setConfirmingAbandon] = useState(false);
  async function cancelGeneration() {
    if (cancelling) return;
    setCancelling(true);
    try {
      const response = await fetch(`/api/planning-sessions/${encodeURIComponent(session.id)}/generation/cancel`, { method: "POST" });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Unable to cancel generation.");
      const workspaceResponse = await fetch("/api/workspace", { cache: "no-store" });
      if (!workspaceResponse.ok) throw new Error("Generation was cancelled, but the workspace could not be refreshed.");
      await onPlanCreated(await workspaceResponse.json() as WorkspaceSnapshot);
      onStatus({ tone: "success", text: "Generation cancelled. Saved research can be resumed from this proposal." });
    } catch (caught) { const message = caught instanceof Error ? caught.message : "Unable to cancel generation."; onError(message); }
    finally { setCancelling(false); }
  }
  async function abandon() {
    if (abandoning) return;
    setAbandoning(true);
    try {
      const response = await fetch(`/api/planning-sessions/${encodeURIComponent(session.id)}`, { method: "DELETE" });
      const payload = await response.json() as WorkspaceSnapshot & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Unable to abandon this planning session.");
      await onPlanCreated(payload);
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

function CurrentPlan({ plan, blueprint, destinationArrivals, latestPlanChange, latestPlanReplacement, onRevise, onTaskToggle, onTaskReorder, onUndoChange, onConfirm, onWorkspace, onStatus, onError, onOperationBusy, confirming }: { plan: Plan; blueprint?: TripBlueprint | undefined; destinationArrivals: DestinationArrivalEvent[]; latestPlanChange?: PlanChangeSet | undefined; latestPlanReplacement?: PlanReplacementAudit | undefined; onRevise: (message?: string) => void; onTaskToggle: (planId: string, taskId: string, checked: boolean) => Promise<void>; onTaskReorder: (planId: string, taskId: string, direction: "up" | "down") => Promise<void>; onUndoChange: (planId: string, changeId: string) => Promise<void>; onConfirm: (planId: string) => Promise<void>; onWorkspace: (workspace: WorkspaceSnapshot) => Promise<void>; onStatus: (status: AgentStatus) => void; onError: (message: string) => void; onOperationBusy: (busy: boolean) => void; confirming: boolean }) {
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
      const response = await fetch(`/api/plans/${encodeURIComponent(plan.id)}`, { method: "DELETE" });
      const payload = await response.json() as WorkspaceSnapshot & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Unable to discard this plan draft.");
      await onWorkspace(payload);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Unable to discard this plan draft.";
      onError(message);
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
      const response = await fetch("/api/agent/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "revise_plan", message, expectedPlanId: plan.id, expectedVersion: plan.version, impactConfirmed: true }) });
      const payload = await response.json() as AgentChatResponse;
      if (!response.ok || !payload.workspace) throw new Error(payload.error ?? "The mapped itinerary was not completed.");
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
      const response = await fetch(`/api/plans/${encodeURIComponent(plan.id)}/replacement/undo`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedVersion: plan.version }) });
      const payload = await response.json() as WorkspaceSnapshot & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Unable to undo the latest plan replacement.");
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
      <PlanMapWorkspace planId={plan.id} planVersion={plan.version} presentation={plan.presentation} partySize={plan.configuration.travelContext.partySize} arrivals={destinationArrivals} editable={plan.status === "draft" && !blueprint} onWorkspace={onWorkspace} onStatus={(text) => onStatus({ tone: "success", text })} onError={onError} onRevise={onRevise} />
      <TravelPackingList plan={plan} items={packingItems} onTaskToggle={onTaskToggle} />
      <TravelPlanAdditions plan={plan} editable={plan.status === "draft" && !blueprint} onWorkspace={onWorkspace} onStatus={onStatus} onError={onError} onRevise={onRevise} />
      <footer className="plan-footer actions-only"><div className="plan-footer-actions">{plan.status === "draft" ? discardControl() : null}<button className="secondary-action" onClick={() => onRevise()}>Adjust in conversation</button>{plan.status === "draft" ? <button className="primary-action" disabled={confirming} onClick={() => void onConfirm(plan.id)}>{confirming ? "Confirming…" : "Confirm and activate"}</button> : null}</div></footer>
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
    <footer className="plan-footer"><div><strong>{plan.status === "draft" ? "Confirm the complete plan" : "Need an adjustment?"}</strong><span>{plan.status === "draft" ? refinementQuestion ? "The complete plan is ready. The question above can improve execution accuracy but does not block review or confirmation." : "Confirmation enables only reminders and execution tasks backed by sufficient information." : "Changes first create a replacement draft. The current plan stays active until you confirm it."}</span></div><div className="plan-footer-actions">{plan.status === "draft" ? discardControl() : null}<button className="secondary-action" onClick={() => onRevise()}>{plan.status === "draft" && refinementQuestion ? "Add plan details" : "Modify current plan"}</button>{plan.status === "draft" ? <button className="primary-action" disabled={confirming} onClick={() => void onConfirm(plan.id)}>{confirming ? "Confirming…" : "Confirm and activate"}</button> : null}</div></footer>
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
      const response = await fetch(`/api/plans/${encodeURIComponent(plan.id)}/accommodation/linked`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedVersion: plan.version, name: name.trim(), address: address.trim(), status: confirmed ? "confirmed" : "candidate" }) });
      const payload = await response.json() as { workspace?: WorkspaceSnapshot; impact?: { affectedDays: number; verifiedDays: number; pendingDays: number }; error?: string };
      if (!response.ok || !payload.workspace) throw new Error(payload.error ?? "Unable to link the accommodation to the current plan.");
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

type PackingDisplayItem = { key: string; title: string; detail: string; group: string; task?: Task };

function TravelPackingList({ plan, items, onTaskToggle }: { plan: Plan; items: PackingDisplayItem[]; onTaskToggle: (planId: string, taskId: string, checked: boolean) => Promise<void> }) {
  const [checkedSuggestions, setCheckedSuggestions] = useState<Set<string>>(() => readPackingChecks(plan.id, plan.version));
  useEffect(() => setCheckedSuggestions(readPackingChecks(plan.id, plan.version)), [plan.id, plan.version]);
  if (!items.length) return null;
  const groups = groupPackingItems(items);
  function toggleSuggested(key: string, checked: boolean) {
    setCheckedSuggestions((current) => {
      const next = new Set(current);
      if (checked) next.add(key);
      else next.delete(key);
      writePackingChecks(plan.id, plan.version, next);
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

function planPackingItems(plan: Plan): PackingDisplayItem[] {
  const taskItems = plan.stages.flatMap((stage) => stage.tasks)
    .filter((task) => task.owner === "user" && task.preparationCategory === "packing_item")
    .map((task) => ({ key: task.id, title: task.title, detail: task.description ?? task.dueLabel, group: packingGroup(task.title, task.description), task }));
  if (taskItems.length) return taskItems;
  if (plan.presentation?.kind !== "itinerary") return [];
  return suggestedPackingItems(plan);
}

function suggestedPackingItems(plan: Plan): PackingDisplayItem[] {
  const presentation = plan.presentation;
  if (presentation?.kind !== "itinerary") return [];
  const text = [
    plan.title,
    plan.location,
    plan.dates,
    presentation.summary,
    ...presentation.days.flatMap((day) => [day.city, day.title, day.summary]),
    ...presentation.places.flatMap((place) => [place.name, place.localizedName, place.category, place.area, place.whyWorthIt, place.plan, place.tip])
  ].filter(Boolean).join(" ").toLocaleLowerCase();
  const months = tripMonths(plan);
  const cities = new Set([plan.location, ...presentation.days.map((day) => day.city), ...presentation.places.map((place) => place.city)].flatMap((value) => value?.split(/\s*(?:\/|,|、|，|&|\band\b)\s*/i).map((city) => city.trim().toLocaleLowerCase()).filter(Boolean) ?? []));
  const items: PackingDisplayItem[] = [
    { key: "suggested-passport-wallet", group: "Essentials", title: "Passport, payment cards, and a small cash wallet", detail: "Keep hotel check-in, rail, reservation, and small cash-only stop essentials in one reachable pouch." },
    { key: "suggested-phone-power", group: "Essentials", title: "Charged phone, cable, and power bank", detail: "This trip leans on maps, booking pages, translation, and live route checks throughout the day." },
    { key: "suggested-walking-shoes-socks", group: "Daily Carry", title: "Broken-in walking shoes and spare socks", detail: "Tokyo and Kyoto days combine stations, neighborhoods, temples, museums, and cafe detours." },
    { key: "suggested-day-bag", group: "Daily Carry", title: "Light day bag", detail: "Carry essentials while larger luggage is stored, forwarded, or left at the accommodation." }
  ];
  if (months.some((month) => month >= 9 && month <= 11)) items.push({ key: "suggested-light-layer", group: "Weather", title: "Light jacket, cardigan, or thin overshirt", detail: "October sightseeing can move from warm afternoons to cooler river, garden, and evening routes." });
  if (months.some((month) => month >= 6 && month <= 10) || /rain|typhoon|river|garden|park|outdoor|walk/.test(text)) items.push({ key: "suggested-rain-gear", group: "Weather", title: "Compact umbrella or packable rain shell", detail: "Useful for station transfers, gardens, and outdoor walks until a date-specific forecast is confirmed." });
  if (/bath|spa|onsen|sento|laqua|hot spring/.test(text)) items.push({ key: "suggested-bath-kit", group: "Activity", title: "Bath kit: small towel, fresh socks, and hair tie if needed", detail: "Spa and public-bath stops are easier when you can reset afterward without relying on rentals." });
  if (/temple|shrine|tatami|shoes off/.test(text)) items.push({ key: "suggested-temple-socks", group: "Activity", title: "Clean socks for shoes-off stops", detail: "Some temples, traditional spaces, and dining rooms may ask you to remove shoes." });
  if (/museum|gallery|restaurant|reservation|ticket|booking|official/.test(text)) items.push({ key: "suggested-reservation-copies", group: "Activity", title: "Offline reservation and ticket screenshots", detail: "Save timed-entry, restaurant, hotel, and transport details before each long day." });
  if (cities.size > 1 || /shinkansen|rail|train|station|luggage|forward/.test(text)) items.push({ key: "suggested-luggage-kit", group: "Transfer", title: "Luggage tag and compact lock", detail: "Helpful if you use luggage forwarding, station storage, or a hotel luggage room between Tokyo and Kyoto." });
  return dedupePackingDisplayItems(items);
}

function groupPackingItems(items: PackingDisplayItem[]): Array<{ title: string; items: PackingDisplayItem[] }> {
  const order = ["Essentials", "Daily Carry", "Weather", "Activity", "Transfer", "Other"];
  const groups = new Map<string, PackingDisplayItem[]>();
  for (const item of items) groups.set(item.group, [...(groups.get(item.group) ?? []), item]);
  return order.filter((title) => groups.has(title)).map((title) => ({ title, items: groups.get(title)! }));
}

function packingGroup(title: string, detail = ""): string {
  const text = `${title} ${detail}`.toLocaleLowerCase();
  if (/passport|payment|cash|wallet|card|reservation|ticket|id/.test(text)) return "Essentials";
  if (/shoe|sock|day bag|bottle|charger|power|phone|cable/.test(text)) return "Daily Carry";
  if (/jacket|layer|umbrella|rain|shell|weather|sun|sunscreen/.test(text)) return "Weather";
  if (/bath|towel|spa|onsen|sento|temple|shrine|museum|gallery/.test(text)) return "Activity";
  if (/luggage|lock|tag|train|rail|transfer|storage|forward/.test(text)) return "Transfer";
  return "Other";
}

function tripMonths(plan: Plan): number[] {
  const presentation = plan.presentation?.kind === "itinerary" ? plan.presentation : undefined;
  const values = [presentation?.startDate, presentation?.endDate, ...((presentation?.days ?? []).map((day) => day.date)), ...plan.dates.split(/\s+/)];
  return values.flatMap((value) => {
    const match = /^\d{4}-(\d{2})-\d{2}$/.exec(value ?? "");
    return match ? [Number(match[1])] : [];
  });
}

function dedupePackingDisplayItems(items: PackingDisplayItem[]): PackingDisplayItem[] {
  const seen = new Set<string>();
  return items.filter((item) => !seen.has(item.title.toLocaleLowerCase()) && Boolean(seen.add(item.title.toLocaleLowerCase())));
}

function packingChecksKey(planId: string, planVersion: number): string {
  return `landi:packing-checks:${planId}:v${planVersion}`;
}

function readPackingChecks(planId: string, planVersion: number): Set<string> {
  try {
    const value = JSON.parse(localStorage.getItem(packingChecksKey(planId, planVersion)) ?? "[]") as unknown;
    return new Set(Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);
  } catch {
    return new Set();
  }
}

function writePackingChecks(planId: string, planVersion: number, checks: Set<string>): void {
  try { localStorage.setItem(packingChecksKey(planId, planVersion), JSON.stringify([...checks])); }
  catch { /* Suggested packing remains usable without local persistence. */ }
}

function BookingImportPanel({ scope, expectedVersion, compact = false, onWorkspace, onPlanningSession, onStatus, onError }: { scope: { type: "planning"; sessionId?: string } | { type: "plan"; planId: string }; expectedVersion?: number; compact?: boolean; onWorkspace: (workspace: WorkspaceSnapshot) => Promise<void>; onPlanningSession?: (session: PlanningSession) => void; onStatus: (status: AgentStatus) => void; onError: (message: string) => void }) {
  const [open, setOpen] = useState(false);
  const [sourceLabel, setSourceLabel] = useState("");
  const [content, setContent] = useState("");
  const [queuedSources, setQueuedSources] = useState<BookingImportSource[]>([]);
  const [previewItems, setPreviewItems] = useState<PendingBookingPreview[]>([]);
  const [existing, setExisting] = useState<TravelBooking[]>([]);
  const [busy, setBusy] = useState(false);
  const scopeKey = scope.type === "planning" ? `planning:${scope.sessionId ?? "new"}` : `plan:${scope.planId}`;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (scope.type === "planning" && !scope.sessionId) { setExisting([]); return; }
      try {
        const url = scope.type === "planning" ? `/api/planning-sessions/${encodeURIComponent(scope.sessionId!)}/bookings` : `/api/plans/${encodeURIComponent(scope.planId)}/bookings`;
        const response = await fetch(url, { cache: "no-store" });
        if (!response.ok || cancelled) return;
        const payload = await response.json() as { bookings?: TravelBooking[] };
        setExisting(payload.bookings ?? []);
      } catch { /* Existing bookings are supplementary. */ }
    }
    void load();
    return () => { cancelled = true; };
  }, [scopeKey]);

  function previewUrl() {
    return scope.type === "planning"
      ? scope.sessionId ? `/api/planning-sessions/${encodeURIComponent(scope.sessionId)}/bookings/import-preview` : "/api/planning-sessions/bookings/import-preview"
      : `/api/plans/${encodeURIComponent(scope.planId)}/bookings/import-preview`;
  }

  function confirmUrl() {
    return scope.type === "planning"
      ? scope.sessionId ? `/api/planning-sessions/${encodeURIComponent(scope.sessionId)}/bookings/import-confirm` : "/api/planning-sessions/bookings/import-confirm"
      : `/api/plans/${encodeURIComponent(scope.planId)}/bookings/import-confirm`;
  }

  async function readFiles(files: FileList | null) {
    const selected = Array.from(files ?? []);
    if (!selected.length) return;
    const sources = await Promise.all(selected.slice(0, 5).map(async (file) => ({ sourceLabel: file.name, content: await file.text() })));
    setQueuedSources(sources);
    setSourceLabel(sources.length === 1 ? sources[0]!.sourceLabel : `${sources.length} booking files selected`);
    setContent(sources.length === 1 ? sources[0]!.content : "");
    setPreviewItems([]);
  }

  async function previewImport() {
    const sources = queuedSources.length ? queuedSources : content.trim() ? [{ sourceLabel: sourceLabel || "Pasted booking confirmation", content: content.trim() }] : [];
    if (!sources.length || busy) return;
    setBusy(true);
    onError("");
    try {
      const items: PendingBookingPreview[] = [];
      for (const source of sources) {
        const response = await fetch(previewUrl(), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sourceLabel: source.sourceLabel, content: source.content }) });
        const payload = await response.json() as BookingImportPreview & { error?: string };
        if (!response.ok) throw new Error(payload.error ?? `Unable to preview ${source.sourceLabel}.`);
        for (const booking of payload.bookings) items.push({ id: crypto.randomUUID(), preview: payload, booking, sourceLabel: source.sourceLabel, sourceContent: source.content });
      }
      setPreviewItems(items);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Unable to preview this booking.";
      onError(message); onStatus({ tone: "error", text: message });
    } finally { setBusy(false); }
  }

  async function acceptImport(itemId: string) {
    const item = previewItems.find((candidate) => candidate.id === itemId);
    if (!item || busy) return;
    setBusy(true);
    onError("");
    try {
      const response = await fetch(confirmUrl(), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ booking: item.booking, sourceContent: item.sourceContent, ...(expectedVersion !== undefined ? { expectedVersion } : {}) }) });
      const payload = await response.json() as { workspace?: WorkspaceSnapshot; planningSession?: PlanningSession; booking?: TravelBooking; requiresBlueprintRevision?: boolean; error?: string };
      if (!response.ok || !payload.workspace) throw new Error(payload.error ?? "Unable to save this booking.");
      if (payload.planningSession) onPlanningSession?.(payload.planningSession);
      await onWorkspace(payload.workspace);
      if (payload.booking) setExisting((items) => [payload.booking!, ...items.filter((item) => item.id !== payload.booking!.id)]);
      setPreviewItems((items) => {
        const remaining = items.filter((candidate) => candidate.id !== itemId);
        if (!remaining.length) { setContent(""); setSourceLabel(""); setQueuedSources([]); setOpen(false); }
        return remaining;
      });
      onStatus({ tone: payload.requiresBlueprintRevision ? "working" : "success", text: payload.requiresBlueprintRevision ? "Booking saved. Structural timing may need a replacement draft before it changes the active itinerary." : "Booking saved for this trip." });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Unable to save this booking.";
      onError(message); onStatus({ tone: "error", text: message });
    } finally { setBusy(false); }
  }

  async function acceptAllImports() {
    for (const item of [...previewItems]) await acceptImport(item.id);
  }

  function discardImport(itemId: string) {
    setPreviewItems((items) => items.filter((item) => item.id !== itemId));
  }

  function updateBooking(itemId: string, patch: Partial<TravelBooking>) {
    setPreviewItems((items) => items.map((item) => item.id === itemId ? { ...item, booking: { ...item.booking, ...patch } } : item));
  }

  function updateSegment(itemId: string, segmentId: string, patch: Partial<TravelBooking["segments"][number]>) {
    setPreviewItems((items) => items.map((item) => item.id === itemId ? { ...item, booking: { ...item.booking, segments: item.booking.segments.map((segment) => segment.id === segmentId ? { ...segment, ...patch, fixedCommitment: patch.constraintStrength ? patch.constraintStrength === "hard" : segment.fixedCommitment } : segment) } } : item));
  }

  return <section className={compact ? "booking-import-panel compact" : "booking-import-panel"}>
    <header><div><span className="section-eyebrow">{scope.type === "planning" ? "TRIP INPUTS" : "TRIP LOGISTICS"}</span><strong>{scope.type === "planning" ? "Import booking confirmations" : "Add booking details"}</strong></div><button type="button" onClick={() => setOpen((value) => !value)}>{open ? "Close" : "Import"}</button></header>
    {existing.length ? <div className="booking-import-existing">{existing.slice(0, 4).map((item) => <article key={item.id}><span>{bookingStatusLabel(item.status)}</span><strong>{item.title}</strong><small>{item.segments.map((segment) => segment.startAtLocal || segment.location || segment.origin || segment.destination).filter(Boolean).slice(0, 2).join(" · ") || item.sourceLabel}</small></article>)}</div> : compact ? null : <p className="booking-import-empty">Imported flights, hotels, rental cars, and train bookings will appear here after review.</p>}
    {open ? <div className="booking-import-body">
      <div className="booking-import-inputs"><label>Source label<input value={sourceLabel} onChange={(event) => setSourceLabel(event.target.value)} placeholder="For example: United confirmation email" /></label><label className="file-input">Upload .eml, .html, or .txt<input type="file" multiple accept=".eml,.html,.txt,text/html,text/plain,message/rfc822" onChange={(event) => void readFiles(event.target.files)} /></label><label className="wide">Paste confirmation text<textarea value={content} onChange={(event) => { setContent(event.target.value); setQueuedSources([]); setPreviewItems([]); }} rows={compact ? 4 : 6} placeholder="Paste an English booking confirmation email or upload up to 5 files." /></label><button type="button" onClick={() => void previewImport()} disabled={busy || (!content.trim() && !queuedSources.length)}>{busy ? "Reading…" : previewItems.length ? "Preview again" : "Preview import"}</button></div>
      {previewItems.length ? <div className="booking-preview">
        {previewItems.length > 1 ? <div className="booking-preview-header"><strong>{previewItems.length} bookings ready for review</strong><button type="button" onClick={() => void acceptAllImports()} disabled={busy}>{busy ? "Saving…" : "Accept all"}</button></div> : null}
        {previewItems.map((item) => <article className="booking-preview-item" key={item.id}>
          <header><div><strong>{item.sourceLabel}</strong><small>{item.preview.duplicate ? "Exact duplicate" : item.preview.possibleDuplicate ? "Possible duplicate" : "Ready to import"}</small></div><button type="button" onClick={() => discardImport(item.id)}>Discard</button></header>
          {item.preview.duplicate ? <p className="booking-warning">This exact source was already imported.</p> : null}
          {!item.preview.duplicate && item.preview.possibleDuplicate ? <p className="booking-warning">This looks similar to an existing booking. Review before accepting.</p> : null}
          <div className="booking-preview-card"><label>Booking title<input value={item.booking.title} onChange={(event) => updateBooking(item.id, { title: event.target.value })} /></label><label>Type<select value={item.booking.type} onChange={(event) => updateBooking(item.id, { type: event.target.value as TravelBooking["type"] })}><option value="accommodation">Accommodation</option><option value="flight">Flight</option><option value="train">Train</option><option value="rental_car">Rental car</option><option value="ticket">Ticket</option><option value="restaurant">Restaurant</option><option value="other">Other</option></select></label><label>Status<select value={item.booking.status} onChange={(event) => updateBooking(item.id, { status: event.target.value as TravelBooking["status"] })}><option value="confirmed">Confirmed</option><option value="pending">Pending</option><option value="needs_review">Needs review</option><option value="cancelled">Cancelled</option></select></label></div>
          <div className="booking-segment-list">{item.booking.segments.map((segment) => <article key={segment.id}><header><strong>{segment.title}</strong><select value={segment.constraintStrength} onChange={(event) => updateSegment(item.id, segment.id, { constraintStrength: event.target.value as BookingConstraintStrength })}><option value="hard">Hard</option><option value="soft">Soft</option><option value="ignored">Ignored</option></select></header><div><label>Start<input value={segment.startAtLocal ?? ""} onChange={(event) => updateSegment(item.id, segment.id, { startAtLocal: event.target.value })} placeholder="Local date/time" /></label><label>End<input value={segment.endAtLocal ?? ""} onChange={(event) => updateSegment(item.id, segment.id, { endAtLocal: event.target.value })} placeholder="Local date/time" /></label><label>Origin<input value={segment.origin ?? ""} onChange={(event) => updateSegment(item.id, segment.id, { origin: event.target.value })} /></label><label>Destination<input value={segment.destination ?? ""} onChange={(event) => updateSegment(item.id, segment.id, { destination: event.target.value })} /></label><label className="wide">Location<input value={segment.location ?? ""} onChange={(event) => updateSegment(item.id, segment.id, { location: event.target.value })} /></label></div>{segment.needsReviewReasons.length ? <p>{segment.needsReviewReasons.join(" ")}</p> : null}</article>)}</div>
          <div className="booking-preview-actions"><button type="button" onClick={() => discardImport(item.id)}>Discard preview</button><button type="button" onClick={() => void acceptImport(item.id)} disabled={busy}>{busy ? "Saving…" : "Accept booking"}</button></div>
        </article>)}
      </div> : null}
    </div> : null}
  </section>;
}

function bookingStatusLabel(status: TravelBooking["status"]): string {
  return status === "needs_review" ? "Needs review" : status[0]!.toUpperCase() + status.slice(1);
}

function TravelExternalHandoffs({ accommodation, foodPlaces, routeHandoffs, plan }: { accommodation: Plan["configuration"]["accommodation"]; foodPlaces: PlanPlace[]; routeHandoffs: PlanRouteSegment[]; plan: Plan }) {
  const places = new Map((plan.presentation?.places ?? []).map((place) => [place.id, place]));
  const handoffs: Array<{ key: string; eyebrow: string; title: string; detail: string; url: string }> = [];
  if (accommodation.name) {
    handoffs.push({ key: "accommodation", eyebrow: accommodation.status === "confirmed" ? "Accommodation linked" : "Accommodation option", title: accommodation.name, detail: accommodation.address ?? "Check the location on the map. Landi will not book or pay on your behalf.", url: googleMapsSearchUrl(`${accommodation.name} ${accommodation.address ?? accommodation.location ?? plan.location}`) });
  }
  for (const place of foodPlaces) {
    handoffs.push({ key: `food-${place.id}`, eyebrow: "Food stop", title: place.localizedName ?? place.name, detail: "Open the map for location, opening information, and available next steps. Landi has not placed an order or reservation.", url: googleMapsSearchUrl(`${place.name} ${place.city ?? place.locationLabel}`) });
  }
  for (const segment of routeHandoffs) {
    const origin = places.get(segment.originPlaceId);
    const destination = places.get(segment.destinationPlaceId);
    if (!origin || !destination) continue;
    handoffs.push({ key: `route-${segment.id}`, eyebrow: "Route handoff", title: `${origin.localizedName ?? origin.name} → ${destination.localizedName ?? destination.name}`, detail: `${routeModeLabel(segment.mode)}${segment.durationMinutes ? ` · about ${segment.durationMinutes} min` : ""}. Open it to confirm the live route, navigation, or ride.`, url: googleMapsRouteUrl(origin, destination, segment.mode) });
  }
  if (!handoffs.length) return null;
  return <section className="travel-external-handoffs" aria-labelledby="external-handoffs-title"><header><div><span className="section-eyebrow">LANDI HANDOFF</span><strong id="external-handoffs-title">External apps</strong></div><small>Opening a link does not mean the action is complete</small></header><div className="travel-external-handoff-grid">{handoffs.map((handoff) => <article key={handoff.key}><span>{handoff.eyebrow}</span><strong>{handoff.title}</strong><p>{handoff.detail}</p><a href={handoff.url} target="_blank" rel="noreferrer">Open Google Maps ↗</a></article>)}</div></section>;
}

function googleMapsSearchUrl(query: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query.trim())}`;
}

function googleMapsRouteUrl(origin: PlanPlace, destination: PlanPlace, mode: PlanRouteSegment["mode"]): string {
  const originQuery = `${origin.name} ${origin.city ?? origin.locationLabel}`;
  const destinationQuery = `${destination.name} ${destination.city ?? destination.locationLabel}`;
  const travelMode = mode === "walking" ? "walking" : mode === "driving" ? "driving" : "transit";
  return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(originQuery)}&destination=${encodeURIComponent(destinationQuery)}&travelmode=${travelMode}`;
}

function routeModeLabel(mode: PlanRouteSegment["mode"]): string {
  return ({ walking: "Walking route", transit: "Public transport", driving: "Driving route", unknown: "Route", rail: "Rail connection", flight: "Flight connection" } as Record<PlanRouteSegment["mode"], string>)[mode];
}

function formatDistance(meters: number): string {
  return meters < 1_000 ? `${meters} m` : `${(meters / 1_000).toFixed(meters < 10_000 ? 1 : 0)} km`;
}

function WorkspaceEmpty({ title, detail }: { title: string; detail: string }) {
  return <section className="workspace-empty"><span>✓</span><strong>{title}</strong><p>{detail}</p></section>;
}

function PlanRemindersView({ items, active }: { items: Array<{ task: Task; stageTitle: string }>; active: boolean }) {
  if (!items.length) return <WorkspaceEmpty title="No plan reminders" detail="Only reminders with a clear local date, time, and time zone appear here." />;
  return <section className="plan-reminders"><header><div><span className="section-eyebrow">REMINDERS</span><h3>{active ? "Active reminders" : "Enabled after confirmation"}</h3></div><small>{items.length} items</small></header><div className="reminder-list">{items.map(({ task, stageTitle }) => <article key={task.id}><span className={active ? "active" : "proposed"}>{active ? "Enabled" : "Pending"}</span><div><strong>{task.title}</strong><p>{task.reminder!.purpose}</p><small>{task.reminder!.scheduledAtLocal} · {task.reminder!.timeZone} · {stageTitle}</small></div></article>)}</div></section>;
}

function visibleDocumentPolicySources(plan: Plan): Plan["sources"] {
  const documentPolicyPattern = /\b(?:e-?visa|visa|passport|immigration|entry requirements?|residence permit|travel authori[sz]ation|border control|customs|consular)\b/i;
  return plan.sources.filter((source) => documentPolicyPattern.test(`${source.title} ${source.authority} ${source.url}`));
}

function PlanSourcesView({ sources }: { sources: Plan["sources"] }) {
  return <section className="plan-evidence"><div className="section-title"><p>Document and policy sources</p><span>Official information affecting visas, entry, residence, or document preparation</span></div><div className="evidence-list">{sources.map((source) => <a href={source.url} target="_blank" rel="noreferrer" key={`${source.url}-${source.retrievedAt}`}><div><strong>{source.title}</strong><small>{source.authority} · {source.retrievedAt}</small></div><b>↗</b></a>)}</div></section>;
}

function PlanChangeNotice({ change, onUndo }: { change: PlanChangeSet; onUndo: () => Promise<void> }) {
  const [undoing, setUndoing] = useState(false);
  async function undo() { if (undoing) return; setUndoing(true); try { await onUndo(); } finally { setUndoing(false); } }
  return <aside className="plan-change-notice"><div><span>Order changed</span><strong>Affected transfer times need review</strong><small>This low-impact change is linked to Plan v{change.appliedVersion} and saved locally.</small></div><button type="button" onClick={() => void undo()} disabled={undoing}>{undoing ? "Undoing…" : "Undo change"}</button></aside>;
}

function PlanReplacementNotice({ audit, active, onUndo }: { audit: PlanReplacementAudit; active: boolean; onUndo: () => Promise<void> }) {
  const [undoing, setUndoing] = useState(false);
  const scopeLabels: Record<PlanReplacementAudit["revalidationScopes"][number], string> = {
    route_facts: "Route facts",
    time_estimates: "Timing and buffers",
    official_sources: "Official source applicability",
    reminders: "Reminder times",
    accommodation_options: "Accommodation options"
  };
  async function undo() { if (undoing) return; setUndoing(true); try { await onUndo(); } finally { setUndoing(false); } }
  return <aside className={`plan-replacement-notice ${audit.impact}`}>
    <div><span>{active ? "Latest plan replacement" : audit.impact === "high" ? "High-impact replacement draft" : "Replacement draft"}</span><strong>{active ? "This replacement plan is active" : "Review affected content before confirmation"}</strong><small>Created from Plan v{audit.sourcePlanVersion}; current Plan v{audit.replacementPlanVersion}.</small>{active ? <button type="button" onClick={() => void undo()} disabled={undoing}>{undoing ? "Undoing…" : "Undo replacement"}</button> : null}</div>
    <div className="replacement-audit-groups"><p><b>Needs revalidation</b>{audit.revalidationScopes.map((scope) => <em key={scope}>{scopeLabels[scope]}</em>)}</p><p><b>Preserved completion status</b><span>{audit.preservedCompletedTasks.length ? `${audit.preservedCompletedTasks.length} items` : "None"}</span></p></div>
  </aside>;
}

function PlanCommandCenter({ plan, tasks, onRevise }: { plan: Plan; tasks: Task[]; onRevise: () => void }) {
  const actionable = tasks.filter((task) => task.owner === "user");
  const completed = actionable.filter((task) => task.status === "completed" || task.status === "skipped").length;
  const progress = actionable.length ? Math.round((completed / actionable.length) * 100) : 0;
  const accommodation = plan.configuration.accommodation;
  const mapQuery = accommodation.address || accommodation.location || plan.location;
  const mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQuery)}`;
  return <section className="plan-command-center"><article><span className="command-label">Goal</span><strong>{plan.knownInformation[0] ?? "Complete this trip around the current destination"}</strong><small>{plan.nextAction}</small></article><article><span className="command-label">Progress</span><strong>{completed} / {actionable.length || 0} completed</strong><div className="progress-track"><span style={{ width: `${progress}%` }} /></div><small>{progress ? `${progress}% of your tasks completed` : "Progress updates as you complete tasks"}</small></article><article><span className="command-label">Location and routes</span><strong>{accommodation.name || accommodation.location || "Accommodation location pending"}</strong><small>{accommodation.address || "Once confirmed, Landi will use the accommodation as the arrival-route anchor."}</small><div className="command-actions"><a href={mapUrl} target="_blank" rel="noreferrer">View in Google Maps ↗</a><button type="button" onClick={onRevise}>Adjust plan</button></div></article></section>;
}

function PlanDecisionBoard({ assumptions, onRevise }: { assumptions: string[]; onRevise: () => void }) {
  const [acknowledged, setAcknowledged] = useState<Set<number>>(() => new Set());
  const decisions = assumptions.slice(0, 4);
  if (!decisions.length) return null;
  function acknowledge(index: number) { setAcknowledged((current) => new Set(current).add(index)); }
  return <section className="plan-decision-board"><header><div><span className="section-eyebrow">DECISIONS</span><h3>Items that still need your decision</h3><p>These assumptions and tradeoffs are not treated as confirmed facts.</p></div><button type="button" onClick={onRevise}>Adjust in conversation</button></header><div className="decision-grid">{decisions.map((decision, index) => <article className={acknowledged.has(index) ? "acknowledged" : ""} key={`${decision}-${index}`}><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{acknowledged.has(index) ? "Saved for confirmation" : "To confirm"}</strong><p>{decision}</p></div><button type="button" onClick={() => acknowledge(index)}>{acknowledged.has(index) ? "Saved" : "Confirm later"}</button></article>)}</div></section>;
}

function PlanGrounding({ plan, onContinue }: { plan: Plan; onContinue: () => void }) {
  const known = plan.knownInformation.slice(0, 4);
  const missing = plan.assumptions.slice(0, 3);
  const question = planRefinementQuestion(plan);
  return <section className="plan-grounding"><div><span>Known details</span>{known.length ? <ul>{known.map((item) => <li key={item}>{item}</li>)}</ul> : <p>The plan's foundational details will appear here.</p>}</div><div className={question ? "needs-input" : "ready"}><span>{question ? "Optional detail" : "Ready for full review"}</span>{question ? <><p>{question}</p><small>{missing.length > 1 ? `${missing.length - 1} non-critical unknowns remain in the plan and do not block full review.` : "Your answer will update the draft, or you can review and confirm it now."}</small><button type="button" onClick={onContinue}>Add this detail</button></> : <p>The foundational details are sufficient. Source checks and non-critical assumptions do not block review.</p>}</div></section>;
}

function FeaturedChecklist({ plan, index, items, onTaskToggle }: { plan: Plan; index: number; items: Array<{ task: Task; stageTitle: string }>; onTaskToggle: (planId: string, taskId: string, checked: boolean) => Promise<void> }) {
  const groups = groupPreparationItems(items);
  return <section className="plan-content-section featured checklist"><header><div><span>{String(index + 1).padStart(2, "0")}</span><h3>Pre-departure preparation</h3></div><small>{items.length} items</small></header><p>Packing lists contain only physical items. Documents, bookings, and digital setup are shown separately. Completion status affects later reminders.</p><div className="preparation-groups">{groups.map((group) => <section className="preparation-group" key={group.title}><header><strong>{group.title}</strong><small>{group.items.length} items</small></header><div className={`preparation-checklist ${group.title === "Packing" ? "packing-items" : ""}`}>{group.items.map(({ task }) => { const downloads = appDownloads(task, plan.sources); const checked = task.status === "completed"; return <div className={checked ? "checked" : ""} key={task.id}><input type="checkbox" checked={checked} onChange={(event) => void onTaskToggle(plan.id, task.id, event.target.checked)} aria-label={`Complete ${task.title}`} /><div><strong>{task.title}</strong>{group.title !== "Packing" && task.description ? <small>{task.description}</small> : null}{group.title !== "Packing" ? <small>{task.dueLabel}</small> : null}</div>{downloads.length ? <div className="download-actions">{downloads.map((download) => <a className="download-action" href={download.url} target="_blank" rel="noreferrer" key={download.label}>{download.label} ↗</a>)}</div> : null}</div>; })}</div></section>)}</div></section>;
}

function groupPreparationItems(items: Array<{ task: Task; stageTitle: string }>): Array<{ title: string; items: Array<{ task: Task; stageTitle: string }> }> {
  const groups = new Map<string, Array<{ task: Task; stageTitle: string }>>();
  const order = ["Packing", "Documents", "Phone and payments", "Bookings and departure", "Other tasks"];
  for (const item of items) {
    const explicitGroup = item.task.preparationCategory === "packing_item" ? "Packing"
      : item.task.preparationCategory === "documents" ? "Documents"
        : item.task.preparationCategory === "digital" ? "Phone and payments"
          : item.task.preparationCategory === "booking" ? "Bookings and departure"
            : item.task.preparationCategory === "other_predeparture" ? "Other tasks" : undefined;
    const titleText = item.task.title.toLocaleLowerCase();
    const title = explicitGroup ?? (/passport|visa|insurance|document|permit|certificate|admission letter/.test(titleText) ? "Documents"
      : /app|sim|esim|phone setup|internet|payment|cash|bank card|network/.test(titleText) ? "Phone and payments"
        : /book|booking|confirm|flight|hotel|accommodation|lodging|reservation|ticket|departure/.test(titleText) ? "Bookings and departure"
          : /sunscreen|sun cream|sunblock|hat|swimsuit|swimwear|umbrella|raincoat|jacket|shirt|trousers|shorts|dress|shoes|sandals|medicine|medication|charger|cable|adapter|power bank|toiletr|glasses|mask|bottle/.test(titleText) ? "Packing" : "Other tasks");
    groups.set(title, [...(groups.get(title) ?? []), item]);
  }
  return order.filter((title) => groups.has(title)).map((title) => ({ title, items: groups.get(title)! }));
}

function FeaturedTimeline({ plan, index, items, onTaskReorder }: { plan: Plan; index: number; items: Array<{ task: Task; canMoveUp: boolean; canMoveDown: boolean }>; onTaskReorder: (planId: string, taskId: string, direction: "up" | "down") => Promise<void> }) {
  const movement = new Map(items.map((item) => [item.task.id, item]));
  return <section className="plan-content-section featured itinerary"><header><div><span>{String(index + 1).padStart(2, "0")}</span><h3>Complete itinerary timeline</h3></div><small>{items.length} milestones</small></header><p>Arrival, transport, check-in, fixed events, and return travel appear on one continuous timeline. Draft plans can reorder items within the same stage.</p><ItineraryView tasks={items.map((item) => item.task)} editable={plan.status === "draft"} canMove={(taskId, direction) => direction === "up" ? movement.get(taskId)?.canMoveUp === true : movement.get(taskId)?.canMoveDown === true} onReorder={(taskId, direction) => onTaskReorder(plan.id, taskId, direction)} /></section>;
}

function PlanContentSection({ plan, stage, index, onTaskToggle, onTaskReorder }: { plan: Plan; stage: Plan["stages"][number]; index: number; onTaskToggle: (planId: string, taskId: string, checked: boolean) => Promise<void>; onTaskReorder: (planId: string, taskId: string, direction: "up" | "down") => Promise<void> }) {
  const kind = stage.presentationKind ?? "details";
  const countLabel = kind === "itinerary" ? `${stage.tasks.length} milestones` : kind === "reservations" ? `${stage.tasks.length} reservations` : kind === "budget" ? `${stage.tasks.length} cost categories` : kind === "transport" ? `${stage.tasks.length} route options` : `${stage.tasks.length} items`;
  return <section className={`plan-content-section ${kind}`}><header><div><span>{String(index + 1).padStart(2, "0")}</span><h3>{stage.title}</h3></div><small>{countLabel}</small></header><p>{stage.description}</p>{kind === "itinerary" ? <ItineraryView tasks={stage.tasks} editable={plan.status === "draft"} onReorder={(taskId, direction) => onTaskReorder(plan.id, taskId, direction)} /> : kind === "reservations" ? <ReservationView tasks={stage.tasks} onToggle={(task, checked) => onTaskToggle(plan.id, task.id, checked)} /> : kind === "budget" ? <BudgetView tasks={stage.tasks} /> : kind === "transport" ? <TransportView tasks={stage.tasks} /> : kind === "overview" ? <OverviewView tasks={stage.tasks} /> : <PlanDetailView tasks={stage.tasks} />}</section>;
}

function OverviewView({ tasks }: { tasks: Task[] }) {
  return <div className="overview-grid">{tasks.map((task) => <article key={task.id}><span>{task.dueLabel}</span><strong>{task.title}</strong>{task.description ? <p>{task.description}</p> : null}</article>)}</div>;
}

function ItineraryView({ tasks, editable = false, canMove, onReorder }: { tasks: Task[]; editable?: boolean; canMove?: (taskId: string, direction: "up" | "down") => boolean; onReorder?: (taskId: string, direction: "up" | "down") => Promise<void> }) {
  const [movingTaskId, setMovingTaskId] = useState<string | null>(null);
  async function move(taskId: string, direction: "up" | "down") { if (!onReorder || movingTaskId) return; setMovingTaskId(taskId); try { await onReorder(taskId, direction); } finally { setMovingTaskId(null); } }
  return <div className="journey-timeline">{tasks.map((task, index) => <article key={task.id}><div className="journey-marker"><span>{index + 1}</span></div><div><time>{task.dueLabel}</time><strong>{task.title}</strong>{task.description ? <p>{task.description}</p> : null}{task.reminder ? <em>Reminder set</em> : null}{editable ? <div className="journey-order-actions"><button type="button" onClick={() => void move(task.id, "up")} disabled={movingTaskId !== null || !(canMove ? canMove(task.id, "up") : index > 0)} aria-label={`Move ${task.title} up`}>↑ Up</button><button type="button" onClick={() => void move(task.id, "down")} disabled={movingTaskId !== null || !(canMove ? canMove(task.id, "down") : index < tasks.length - 1)} aria-label={`Move ${task.title} down`}>↓ Down</button></div> : null}</div></article>)}</div>;
}

function ReservationView({ tasks, onToggle }: { tasks: Task[]; onToggle: (task: Task, checked: boolean) => Promise<void> }) {
  return <div className="reservation-table">{tasks.map((task) => { const checkable = isExplicitPreparationTask(task); return <div key={task.id}>{checkable ? <input type="checkbox" checked={task.status === "completed"} onChange={(event) => void onToggle(task, event.target.checked)} aria-label={`Complete ${task.title}`} /> : <span className={`task-state ${task.status}`} />}<div><strong>{task.title}</strong><small>{task.description ?? "Record the confirmation number, local time, address, and change or cancellation policy"}</small></div><span>{task.dueLabel}</span></div>; })}</div>;
}

function isExplicitPreparationTask(task: Pick<Task, "owner" | "preparationCategory">): boolean {
  return task.owner === "user" && task.preparationCategory !== undefined && task.preparationCategory !== "not_applicable";
}

function BudgetView({ tasks }: { tasks: Task[] }) {
  return <div className="budget-grid">{tasks.map((task) => <article key={task.id}><span>Budget item</span><strong>{task.title}</strong><small>{task.dueLabel}</small></article>)}</div>;
}

function TransportView({ tasks }: { tasks: Task[] }) {
  return <div className="transport-grid">{tasks.map((task) => <article key={task.id}><span>⇢</span><div><strong>{task.title}</strong><small>{task.description ?? task.dueLabel}</small>{task.description ? <em>{task.dueLabel}</em> : null}</div></article>)}</div>;
}

function PlanDetailView({ tasks }: { tasks: Task[] }) {
  return <div className="plan-detail-grid">{tasks.map((task) => <article key={task.id}><span>{task.dueLabel}</span><strong>{task.title}</strong>{task.description ? <p>{task.description}</p> : null}{task.reminder ? <small>Remind me</small> : null}</article>)}</div>;
}

function appDownloads(task: Task, sources: Plan["sources"]): Array<{ label: string; url: string }> {
  const title = `${task.title} ${task.description ?? ""}`.toLocaleLowerCase();
  const definitions = [
    { pattern: /wechat/, source: /wechat/i, label: "Download WeChat", fallback: "https://www.wechat.com/" },
    { pattern: /alipay/, source: /alipay/i, label: "Download Alipay", fallback: "https://www.alipay.com/" },
    { pattern: /amap/, source: /amap/i, label: "Download Amap", fallback: "https://mobile.amap.com/" },
    { pattern: /china mobile/, source: /china mobile/i, label: "View China Mobile", fallback: "https://www.10086.cn/" }
  ];
  return definitions.filter((item) => item.pattern.test(title)).map((item) => {
    const officialSource = sources.find((source) => item.source.test(`${source.title} ${source.authority}`));
    return { label: item.label, url: officialSource?.url ?? item.fallback };
  });
}

function HistoricalPlans({ plans, onDelete }: { plans: Plan[]; onDelete: (plan: Plan) => Promise<void> }) {
  if (!plans.length) return <section className="history-empty"><span>◴</span><h2>No archived plans yet</h2><p>After you confirm a complete replacement draft, the previous active plan will appear here.</p></section>;
  return <section className="history-grid">{plans.map((plan) => <details className="history-card" key={plan.id}><summary><div><h2>{plan.title}</h2><p>{plan.location} · {plan.dates}</p></div><div className="history-card-actions"><time>{formatDate(plan.createdAt)}</time><button type="button" onClick={(event) => { event.preventDefault(); event.stopPropagation(); void onDelete(plan); }}>Delete</button></div></summary><HistoryPlanMarkdown plan={plan} /></details>)}</section>;
}

function HistoryPlanMarkdown({ plan }: { plan: Plan }) {
  const summary = plan.presentation?.summary || plan.knownInformation[0] || `A trip to ${plan.location} on ${plan.dates}.`;
  const placeById = new Map((plan.presentation?.places ?? []).map((place) => [place.id, place]));
  return <article className="history-markdown">
    <section><h2>Trip overview</h2><p>{summary}</p></section>
    {plan.knownInformation.length ? <section><h2>Confirmed details</h2><ul>{plan.knownInformation.map((item) => <li key={item}>{item}</li>)}</ul></section> : null}
    {plan.presentation?.days.length ? <section><h2>Daily itinerary</h2>{plan.presentation.days.map((day) => <div className="history-markdown-day" key={day.id}><h3>{day.label}{day.title ? ` · ${day.title}` : ""}</h3>{day.summary ? <p>{day.summary}</p> : null}{day.placeIds.length ? <ul>{day.placeIds.map((placeId) => { const place = placeById.get(placeId); return <li key={placeId}><strong>{place?.name ?? placeId}</strong>{place?.plan ? ` — ${place.plan}` : ""}</li>; })}</ul> : null}</div>)}</section> : null}
    <section><h2>Complete plan</h2>{plan.stages.map((stage) => <div className="history-markdown-stage" key={stage.id}><h3>{stage.title}</h3>{stage.description ? <p>{stage.description}</p> : null}{stage.tasks.length ? <ul>{stage.tasks.map((task) => <li key={task.id}><strong>{task.title}</strong>{task.description ? ` — ${task.description}` : ""}<small>{task.dueLabel}</small></li>)}</ul> : null}</div>)}</section>
    {plan.assumptions.length ? <section><h2>Items to confirm</h2><ul>{plan.assumptions.map((item) => <li key={item}>{item}</li>)}</ul></section> : null}
    {plan.sources.length ? <section><h2>Sources</h2><ul>{plan.sources.map((source) => <li key={`${source.url}-${source.title}`}><a href={source.url} target="_blank" rel="noreferrer">{source.title}</a><small>{source.authority}</small></li>)}</ul></section> : null}
  </article>;
}

function InlineComposerWorkspace({ mode, currentPlan, planningSession, initialMessage, onClose, onPlanCreated, onStatus, onError }: { mode: ComposerMode; currentPlan: Plan | null; planningSession?: PlanningSession | undefined; initialMessage: string; onClose: () => void; onPlanCreated: (workspace: WorkspaceSnapshot) => Promise<void>; onStatus: (status: AgentStatus) => void; onError: (message: string) => void }) {
  const [busy, setBusy] = useState(false);
  return <section className="inline-composer-workspace" aria-label={mode === "new_plan" ? "Tell Landi your goal" : "Adjust current plan"}><header><div><h1>{mode === "new_plan" ? "Plan your trip with Landi" : "Adjust your plan with Landi"}</h1></div><button type="button" onClick={onClose} disabled={busy}>{busy ? "Working…" : mode === "new_plan" && planningSession ? "Exit for now" : "Back"}</button></header><PlanComposer mode={mode} currentPlan={currentPlan} planningSession={planningSession} initialMessage={initialMessage} onPlanCreated={onPlanCreated} onStatus={onStatus} onComplete={onClose} onError={onError} onBusyChange={setBusy} /></section>;
}

function ProfileOnboardingDialog({ profile: initial, onSaved, onError }: { profile: Profile; onSaved: (workspace: WorkspaceSnapshot) => void; onError: (message: string) => void }) {
  const [profile, setProfile] = useState<Profile>({ ...initial, displayName: initial.displayName === "New explorer" ? "" : initial.displayName, nationality: initial.nationality === "To be confirmed" ? "" : initial.nationality }); const [saving, setSaving] = useState(false);
  const valid = Boolean(profile.displayName.trim() && profile.preferredLanguage.trim() && profile.nationality.trim() && profile.gender !== "not_specified" && profile.immigrationStatus !== "unknown");
  async function save(event: FormEvent) { event.preventDefault(); if (!valid || saving) return; setSaving(true); try { const response = await fetch("/api/profile", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(profile) }); const payload = await response.json() as WorkspaceSnapshot & { error?: string }; if (!response.ok || payload.profile.status !== "ready") throw new Error(payload.error ?? "Complete all required profile details."); onSaved(payload); } catch (caught) { onError(caught instanceof Error ? caught.message : "Unable to save profile details."); } finally { setSaving(false); } }
  return <div className="dialog-backdrop onboarding-backdrop"><section className="composer-dialog onboarding-dialog" role="dialog" aria-modal="true" aria-labelledby="onboarding-title"><header><div><span className="step-label">FIRST-TIME SETUP</span><h2 id="onboarding-title">Help Landi get to know you</h2></div></header><p>These long-term details are reused in future plans. Complete the required fields to enter the workspace; you can change them later in Settings.</p><form className="plan-intake-form" onSubmit={(event) => void save(event)}><fieldset><legend>Profile details</legend><div className="form-grid"><label>What should Landi call you?<span>Required</span><input value={profile.displayName === "New explorer" ? "" : profile.displayName} onChange={(event) => setProfile({ ...profile, displayName: event.target.value })} placeholder="Your name" required /></label><label>Preferred language<span>Required</span><input value={profile.preferredLanguage} onChange={(event) => setProfile({ ...profile, preferredLanguage: event.target.value })} placeholder="For example: English" required /></label><label>Nationality<span>Required</span><input value={profile.nationality === "To be confirmed" ? "" : profile.nationality} onChange={(event) => setProfile({ ...profile, nationality: event.target.value })} placeholder="For example: United States" required /></label><label>Gender<span>You may prefer not to say</span><select value={profile.gender} onChange={(event) => setProfile({ ...profile, gender: event.target.value as ProfileGender })} required><option value="not_specified" disabled>Select</option><option value="woman">Woman</option><option value="man">Man</option><option value="nonbinary">Non-binary</option><option value="prefer_not_to_say">Prefer not to say</option></select></label><label className="wide">Destination visa or residence status<span>Required for matching applicable official information</span><select value={profile.immigrationStatus} onChange={(event) => setProfile({ ...profile, immigrationStatus: event.target.value as ImmigrationStatus })} required><option value="unknown" disabled>Select</option><option value="no_visa">No visa or residence permit yet</option><option value="short_term_visitor">Short-term visitor</option><option value="tourist_visa">Tourist visa</option><option value="student_visa">Student visa</option><option value="work_visa">Work visa</option><option value="residence_permit">Residence permit</option><option value="other">Other</option></select></label></div></fieldset><div className="onboarding-note">Landi stores these details only in this local, single-user profile. They are not a policy eligibility decision.</div><div className="intake-submit"><p>Save to enter the Landi workspace.</p><button className="primary-action" type="submit" disabled={!valid || saving}>{saving ? "Saving…" : "Save and continue"}</button></div></form></section></div>;
}

function loadConversation(key: string, welcome: string): ChatMessage[] {
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? "null") as ChatMessage[] | null;
    if (Array.isArray(saved) && saved.length && saved.every((message) => message && (message.role === "assistant" || message.role === "user") && typeof message.text === "string")) return saved;
  } catch { /* Ignore malformed local conversation data and start clean. */ }
  return [{ id: "welcome", role: "assistant", text: welcome }];
}

function conversationFromPlanningSession(session: PlanningSession | undefined, welcome: string): ChatMessage[] {
  if (session?.messages.length) return session.messages.map((message) => ({ id: message.id, role: message.role, text: message.text }));
  return [{ id: "welcome", role: "assistant", text: welcome }];
}

function conversationStorageKey(mode: ComposerMode, planId?: string): string {
  return `landi.conversation.${mode}.${planId ?? "new"}`;
}

function PlanComposer({ mode, currentPlan, planningSession, initialMessage = "", onPlanCreated, onStatus, onComplete, onError, onBusyChange }: { mode: ComposerMode; currentPlan: Plan | null; planningSession?: PlanningSession | undefined; initialMessage?: string; onPlanCreated: (workspace: WorkspaceSnapshot) => Promise<void>; onStatus: (status: AgentStatus) => void; onComplete: () => void; onError: (message: string) => void; onBusyChange?: (busy: boolean) => void }) {
  const welcome = mode === "new_plan" ? "Tell me where you want to go, when, and what matters most. You can also add flights, accommodation, food, transport, budget, or luggage preferences. I will organize the details and create the complete plan." : refinementIntro(currentPlan);
  const conversationKey = useRef(conversationStorageKey(mode, currentPlan?.id)).current;
  const [input, setInput] = useState(initialMessage);
  const [busy, setBusy] = useState(false);
  const [activeMode, setActiveMode] = useState<ComposerMode>(mode);
  const [readyForReview, setReadyForReview] = useState(false);
  const [proposal, setProposal] = useState<PlanningProposal | undefined>(planningSession?.proposal);
  const [planningSessionId, setPlanningSessionId] = useState<string | undefined>(planningSession?.id);
  const [planningSessionStatus, setPlanningSessionStatus] = useState<PlanningSession["status"] | undefined>(planningSession?.status);
  const [processingStatus, setProcessingStatus] = useState(mode === "new_plan" ? "Waiting for your trip details" : "Waiting for your answer about the current plan");
  const [listening, setListening] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>(() => mode === "new_plan" ? conversationFromPlanningSession(planningSession, welcome) : loadConversation(conversationKey, welcome));
  const [permissionOpen, setPermissionOpen] = useState(false);
  const [permissionBusy, setPermissionBusy] = useState(false);
  const [permissionMessage, setPermissionMessage] = useState("");
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const voiceBaseRef = useRef("");
  const autoConfirmedProposalRef = useRef<string | null>(null);
  const proposalReadyFromTurnRef = useRef<string | null>(null);
  const voiceEnabled = localStorage.getItem("landi.voice") !== "off";
  const planGenerationInProgress = planningSessionStatus === "generating" || (busy && planningSessionStatus === "proposal_ready");
  const composerWorking = busy || planningSessionStatus === "generating";
  const generationCanRetry = mode === "new_plan" && planningSessionStatus === "proposal_ready" && Boolean(proposal && planningSessionId) && !busy;
  useEffect(() => { onBusyChange?.(busy); return () => onBusyChange?.(false); }, [busy, onBusyChange]);
  useEffect(() => {
    if (mode !== "new_plan" || !proposal || !planningSessionId || planningSessionStatus !== "proposal_ready" || busy) return;
    const confirmationKey = `${planningSessionId}:${proposal.version}`;
    if (proposalReadyFromTurnRef.current !== confirmationKey) return;
    if (autoConfirmedProposalRef.current === confirmationKey) return;
    proposalReadyFromTurnRef.current = null;
    autoConfirmedProposalRef.current = confirmationKey;
    void confirmProposal();
  }, [mode, proposal, planningSessionId, planningSessionStatus, busy]);

  function cancelVoice() { const recognition = recognitionRef.current; if (!recognition) return; recognition.onresult = null; recognition.onend = null; recognition.onerror = null; recognition.abort(); recognitionRef.current = null; }
  useEffect(() => { cancelVoice(); setListening(false); setInput(initialMessage); setActiveMode(mode); setReadyForReview(false); setProposal(mode === "new_plan" ? planningSession?.proposal : undefined); setPlanningSessionId(mode === "new_plan" ? planningSession?.id : undefined); setPlanningSessionStatus(mode === "new_plan" ? planningSession?.status : undefined); setProcessingStatus(mode === "new_plan" ? planningSession?.status === "generating" ? "Starting complete plan generation…" : "Waiting for your trip details" : initialMessage ? "Map changes are ready. Send them and Landi will replan" : "Waiting for your answer about the current plan"); setMessages(mode === "new_plan" ? conversationFromPlanningSession(planningSession, welcome) : loadConversation(conversationKey, welcome)); }, [mode, initialMessage]);
  useEffect(() => {
    if (mode !== "new_plan" || !planningSession) return;
    setPlanningSessionId(planningSession.id);
    setPlanningSessionStatus(planningSession.status);
    setProposal(planningSession.proposal);
    if (planningSession.status === "generating") setProcessingStatus("Starting complete plan generation…");
  }, [mode, planningSession?.id, planningSession?.status, planningSession?.proposal?.version]);
  useEffect(() => {
    if (mode !== "new_plan" || !planningSessionId || planningSessionStatus !== "generating") return;
    let cancelled = false;
    const pollGeneration = async () => {
      try {
        const response = await fetch(`/api/planning-sessions/${encodeURIComponent(planningSessionId)}/generation`, { cache: "no-store" });
        if (!response.ok || cancelled) return;
        const payload = await response.json() as { sessionStatus: PlanningSession["status"]; generation: PlanGenerationState | null };
        if (cancelled) return;
        setPlanningSessionStatus(payload.sessionStatus);
        if (payload.generation) setProcessingStatus(generationProgressMessage(payload.generation));
        if (payload.generation?.status === "failed") onError(payload.generation.message ?? "Plan generation did not finish. Your trip details are saved.");
      } catch { /* Workspace polling remains the fallback. */ }
    };
    void pollGeneration();
    const events = new EventSource(`/api/planning-sessions/${encodeURIComponent(planningSessionId)}/generation/events`);
    events.addEventListener("generation", () => void pollGeneration());
    const interval = window.setInterval(() => void pollGeneration(), 5_000);
    return () => { cancelled = true; events.close(); window.clearInterval(interval); };
  }, [mode, planningSessionId, planningSessionStatus, onError]);
  useEffect(() => () => cancelVoice(), []);
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const conversations = document.querySelectorAll<HTMLElement>(".conversation");
      const latest = conversations.item(conversations.length - 1);
      if (latest) latest.scrollTo({ top: latest.scrollHeight, behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [messages, busy]);

  function startVoice() {
    const speechWindow = window as SpeechRecognitionWindow;
    const Recognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!Recognition) { onError("This browser does not support speech-to-text. Please type your message."); return; }
    const recognition = new Recognition();
    recognition.lang = "zh-CN"; recognition.interimResults = true; recognition.continuous = true; voiceBaseRef.current = input;
    recognition.onresult = (event) => { let transcript = ""; for (let index = 0; index < event.results.length; index += 1) transcript += event.results[index]?.[0]?.transcript ?? ""; const base = voiceBaseRef.current; setInput(`${base}${base && transcript && !/[\s\n]$/.test(base) ? " " : ""}${transcript}`.slice(0, 1500)); };
    recognition.onend = () => { if (recognitionRef.current === recognition) recognitionRef.current = null; setListening(false); };
    recognition.onerror = (event) => { if (recognitionRef.current === recognition) recognitionRef.current = null; setListening(false); if (event.error === "aborted") return; if (event.error === "not-allowed" || event.error === "service-not-allowed") { setPermissionMessage(""); setPermissionOpen(true); return; } onError(event.error === "audio-capture" ? "No available microphone was detected." : event.error === "no-speech" ? "No speech was detected. Please try again." : "Speech recognition failed. Try again or type your message."); };
    recognitionRef.current = recognition;
    try { recognition.start(); setListening(true); } catch { recognitionRef.current = null; setPermissionOpen(true); }
  }

  async function toggleVoice() {
    if (listening) { recognitionRef.current?.stop(); setListening(false); return; }
    try { if (navigator.permissions && (await navigator.permissions.query({ name: "microphone" as PermissionName })).state === "denied") { setPermissionOpen(true); return; } } catch { /* Unsupported permission query; recognition will request access. */ }
    startVoice();
  }

  async function requestPermission() {
    setPermissionBusy(true); setPermissionMessage("");
    try { if (!navigator.mediaDevices?.getUserMedia) throw new Error("unsupported"); const stream = await navigator.mediaDevices.getUserMedia({ audio: true }); stream.getTracks().forEach((track) => track.stop()); setPermissionOpen(false); startVoice(); }
    catch { setPermissionMessage("The browser did not grant permission. Open the site permissions beside the address bar, allow microphone access, and try again."); }
    finally { setPermissionBusy(false); }
  }

  async function confirmProposal() {
    if (!planningSessionId || !proposal || busy) return;
    onError(""); setBusy(true); setProcessingStatus("Starting complete plan generation…"); onStatus({ tone: "working", text: "Creating your complete plan…" });
    try {
      const response = await fetch("/api/planning-sessions/" + encodeURIComponent(planningSessionId) + "/confirm", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ proposalVersion: proposal.version }) });
      const payload = await response.json() as AgentChatResponse;
      if (!response.ok || !payload.workspace) throw new Error(payload.error ?? "Plan confirmation did not finish.");
      if (payload.accepted) {
        setPlanningSessionId(payload.planningSession?.id ?? payload.workspace.planningSession?.id);
        setProposal((payload.proposal ?? payload.planningSession?.proposal ?? payload.workspace.planningSession?.proposal) as PlanningProposal);
        setPlanningSessionStatus("generating");
        setProcessingStatus(generationStageMessage(payload.generation?.stage ?? "queued"));
        await onPlanCreated(payload.workspace);
        onStatus({ tone: "working", text: "Generating your complete plan…" });
        return;
      }
      if (!payload.generated) {
        const assistantMessage = { id: crypto.randomUUID(), role: "assistant" as const, text: payload.reply ?? "The plan direction is confirmed. Add the remaining details needed to generate it." };
        setMessages((current) => [...current, assistantMessage]);
        setPlanningSessionId(payload.planningSession?.id ?? payload.workspace.planningSession?.id);
        setProposal((payload.proposal ?? payload.planningSession?.proposal ?? payload.workspace.planningSession?.proposal) as PlanningProposal);
        setPlanningSessionStatus(payload.planningSession?.status ?? payload.workspace.planningSession?.status);
        setProcessingStatus("Plan direction confirmed. Waiting for the remaining details");
        await onPlanCreated(payload.workspace);
        onStatus({ tone: "success", text: "Plan direction confirmed. Please add the remaining key details." });
        return;
      }
      setActiveMode("revise_plan"); setProcessingStatus("Complete plan ready. Return to the workspace to review it."); setReadyForReview(true); onError(""); await onPlanCreated(payload.workspace); onStatus({ tone: "success", text: payload.evidenceStatus === "verified" ? "Complete plan ready with official sources attached." : "Complete plan ready. Some sources still need verification." });
    } catch (caught) {
      const messageText = caught instanceof Error ? caught.message : "Unable to generate the complete plan.";
      setProcessingStatus("Generation did not finish. Adjust the proposal or try again."); onStatus({ tone: "error", text: messageText }); onError(messageText);
    } finally { setBusy(false); }
  }

  async function send() {
    const message = input.trim(); if (!message || busy) return;
    let impactConfirmed = false;
    if (activeMode === "revise_plan") {
      if (!currentPlan) { onError("There is no current plan to modify."); return; }
      try {
        const response = await fetch(`/api/plans/${encodeURIComponent(currentPlan.id)}/change-impact`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message, expectedVersion: currentPlan.version }) });
        const preview = await response.json() as PlanChangeImpactPreview & { error?: string };
        if (!response.ok) throw new Error(preview.error ?? "Unable to assess the impact of this change.");
        if (preview.requiresConfirmation) {
          const details = preview.reasons.map((reason, index) => `${index + 1}. ${reason}`).join("\n");
          impactConfirmed = window.confirm(`${preview.summary}\n\n${details}\n\nAfter confirmation, Landi will create a complete replacement draft. The active plan will not switch immediately. Continue?`);
          if (!impactConfirmed) { setProcessingStatus("The high-impact change was not confirmed. The current plan is unchanged."); onStatus({ tone: "success", text: "High-impact change cancelled. The current plan is unchanged." }); return; }
        }
      } catch (caught) { const messageText = caught instanceof Error ? caught.message : "Unable to assess the impact of this change."; onError(messageText); onStatus({ tone: "error", text: messageText }); return; }
    }
    if (listening) { recognitionRef.current?.stop(); setListening(false); }
    const userMessage = { id: crypto.randomUUID(), role: "user" as const, text: message };
    setMessages((current) => { const next = [...current, userMessage]; localStorage.setItem(conversationKey, JSON.stringify(next)); return next; }); setInput(""); setBusy(true);
    const collecting = activeMode === "new_plan";
    setProcessingStatus(collecting ? "Organizing your goal and essential details…" : "Answer received. Rechecking the destination and applicable sources…"); if (!collecting) onStatus({ tone: "working", text: "Rechecking the destination and applicable sources…" });
    const progressTimers = [
      window.setTimeout(() => { setProcessingStatus(collecting ? "Identifying the next essential detail…" : "Checking which itinerary points and preparations are affected…"); if (!collecting) onStatus({ tone: "working", text: "Reviewing the new details and adjusting the plan…" }); }, 45_000),
      window.setTimeout(() => { setProcessingStatus(collecting ? "Creating the complete plan. Please wait a little longer…" : "Reordering the timeline and reviewing official sources. Please wait…"); if (!collecting) onStatus({ tone: "working", text: "Reordering the timeline and reviewing official sources…" }); }, 150_000)
    ];
    if (collecting) {
      try {
        const response = await fetch("/api/agent/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "new_plan", message }) });
        const payload = await response.json() as AgentChatResponse;
        if (!response.ok || !payload.workspace) throw new Error(payload.error ?? "Landi is temporarily unavailable.");
        const assistantMessage = { id: crypto.randomUUID(), role: "assistant" as const, text: payload.reply ?? "Got it." };
        setMessages((current) => { const next = [...current, assistantMessage]; localStorage.setItem(conversationKey, JSON.stringify(next)); return next; });
        if (payload.generated) {
          setActiveMode("revise_plan"); setReadyForReview(true); setProcessingStatus("Complete plan ready. Return to the workspace to review it.");
          await onPlanCreated(payload.workspace);
          onStatus({ tone: "success", text: payload.evidenceStatus === "verified" ? "Complete plan ready with official sources attached." : "Complete plan ready. Some sources still need verification." });
          return;
        }
        const nextSessionId = payload.planningSession?.id ?? payload.workspace.planningSession?.id;
        const nextProposal = (payload.proposal ?? payload.planningSession?.proposal) as PlanningProposal | undefined;
        const nextStatus = payload.planningStatus ?? payload.planningSession?.status ?? payload.workspace.planningSession?.status;
        if (nextSessionId && nextProposal && nextStatus === "proposal_ready") proposalReadyFromTurnRef.current = `${nextSessionId}:${nextProposal.version}`;
        setPlanningSessionId(nextSessionId);
        setProposal(nextProposal);
        setPlanningSessionStatus(nextStatus);
        const nextSession = payload.planningSession ?? payload.workspace.planningSession;
        setProcessingStatus(payload.accepted ? generationStageMessage(payload.generation?.stage ?? "queued") : nextSession?.unresolved[0]?.question ?? "Details complete. Preparing to generate the plan");
        await onPlanCreated(payload.workspace);
        if (payload.accepted) onStatus({ tone: "working", text: "Generating your complete plan…" });
      } catch (caught) {
        const messageText = caught instanceof Error ? caught.message : "Landi is temporarily unavailable.";
        const assistantMessage = { id: crypto.randomUUID(), role: "assistant" as const, text: messageText };
        setMessages((current) => { const next = [...current, assistantMessage]; localStorage.setItem(conversationKey, JSON.stringify(next)); return next; });
        setProcessingStatus("The update did not finish. Please try again."); onStatus({ tone: "error", text: "The update did not finish. Please try again." }); onError(messageText);
      } finally {
        progressTimers.forEach((timer) => window.clearTimeout(timer)); setBusy(false);
      }
      return;
    }
    try { const response = await fetch("/api/agent/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: activeMode, message, ...(currentPlan ? { expectedPlanId: currentPlan.id, expectedVersion: currentPlan.version } : {}), ...(impactConfirmed ? { impactConfirmed: true } : {}) }) }); const payload = await response.json() as AgentChatResponse; if (!response.ok || !payload.workspace) throw new Error(payload.error ?? "Landi cannot create the plan right now."); const assistantMessage = { id: crypto.randomUUID(), role: "assistant" as const, text: payload.reply ?? "The plan is saved." }; setMessages((current) => { const next = [...current, assistantMessage]; localStorage.setItem(conversationKey, JSON.stringify(next)); localStorage.setItem(conversationStorageKey("revise_plan", payload.workspace!.activePlan.id), JSON.stringify(next)); return next; }); setActiveMode("revise_plan"); setReadyForReview(Boolean(payload.readyForReview)); setProcessingStatus(payload.followUpQuestion ? "Plan updated. Finish now or answer the remaining key question." : "Plan updated and ready for review."); await onPlanCreated(payload.workspace); onStatus({ tone: "success", text: payload.followUpQuestion ? "Plan updated. You can finish refining at any time." : "Plan updated and ready for review." }); }
    catch (caught) { const messageText = caught instanceof Error ? caught.message : "Landi is temporarily unavailable."; const assistantMessage = { id: crypto.randomUUID(), role: "assistant" as const, text: messageText }; setMessages((current) => { const next = [...current, assistantMessage]; localStorage.setItem(conversationKey, JSON.stringify(next)); return next; }); setProcessingStatus("The update did not finish. Please try again."); onStatus({ tone: "error", text: "The update did not finish. Please try again." }); onError(messageText); }
    finally { progressTimers.forEach((timer) => window.clearTimeout(timer)); setBusy(false); }
  }

  return <div className="plan-composer">
    <div className="conversation" aria-live="polite">{messages.map((message) => <div className={`chat-bubble ${message.role}`} key={message.id}>{message.role === "assistant" ? <img className="chat-avatar" src={landiLogoUrl} alt="Landi" /> : null}<p>{message.text}</p></div>)}{composerWorking ? <div className="chat-bubble assistant thinking"><img className="chat-avatar" src={landiLogoUrl} alt="Landi" /><p><span className="thinking-label">{planGenerationInProgress ? "Your details are confirmed. Landi is creating your complete plan…" : "Understanding and organizing your details…"}</span></p></div> : null}</div>
    {composerWorking ? <div className={`composer-status working${planGenerationInProgress ? " generating" : ""}`} aria-live="polite"><b>●</b>{processingStatus}</div> : null}
    {generationCanRetry ? <div className="generation-retry" role="status"><span>Your trip details are saved and ready.</span><button type="button" onClick={() => void confirmProposal()}>Generate plan</button></div> : null}
    {readyForReview && activeMode !== "new_plan" ? <div className="review-ready"><div><strong>Your plan is ready</strong><span>Return to the workspace to review the complete plan, or keep telling Landi what to change.</span></div><button type="button" onClick={onComplete}>View complete plan</button></div> : null}
    {activeMode === "new_plan" ? <BookingImportPanel scope={planningSessionId ? { type: "planning", sessionId: planningSessionId } : { type: "planning" }} compact onWorkspace={onPlanCreated} onPlanningSession={(session) => { setPlanningSessionId(session.id); setPlanningSessionStatus(session.status); setProposal(session.proposal); }} onStatus={onStatus} onError={onError} /> : null}
    <div className={`chat-input ${listening ? "listening" : ""}`}><textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} placeholder={listening ? "Listening…" : activeMode === "new_plan" ? "Chat with Landi" : "Answer the previous question or add another request…"} rows={2} maxLength={1500} disabled={composerWorking} /><div className="composer-actions">{voiceEnabled ? <button className={listening ? "voice-button active" : "voice-button"} onClick={() => void toggleVoice()} type="button" disabled={composerWorking} aria-label={listening ? "Stop voice input" : "Start voice input"} title={listening ? "Stop voice input" : "Voice input"}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z" /><path d="M5.5 11.5v.5a6.5 6.5 0 0 0 13 0v-.5M12 18.5V22M8.5 22h7" /></svg></button> : null}<button className="send-button" onClick={() => void send()} disabled={composerWorking || !input.trim()} aria-label="Send">↑</button></div></div>
    {permissionOpen ? <div className="permission-backdrop"><section className="permission-dialog" role="alertdialog" aria-modal="true" aria-labelledby="permission-title"><span>●</span><h3 id="permission-title">Microphone access is off</h3><p>Enable it to use voice input. The browser will show a microphone permission prompt.</p>{permissionMessage ? <small>{permissionMessage}</small> : null}<div><button className="permission-cancel" onClick={() => setPermissionOpen(false)}>Later</button><button className="permission-primary" onClick={() => void requestPermission()} disabled={permissionBusy}>{permissionBusy ? "Opening…" : "Enable microphone"}</button></div></section></div> : null}
  </div>;
}

function SettingsWorkspace({ workspace, configuration, checks, onWorkspace, onConfiguration, onChecks, onError }: { workspace: WorkspaceSnapshot; configuration: LocalConfiguration | null; checks: RuntimeCheck[]; onWorkspace: (workspace: WorkspaceSnapshot) => void; onConfiguration: (configuration: LocalConfiguration) => void; onChecks: (checks: RuntimeCheck[]) => void; onError: (message: string) => void }) {
  return <div className="settings-page"><div className="settings-stack"><ProfileSettings profile={workspace.profile} onSaved={onWorkspace} onError={onError} /><ApiSettings configuration={configuration} onSaved={onConfiguration} onError={onError} /><RuntimeSettings selected={workspace.runtime.selectedKind} checks={checks} onSaved={onWorkspace} onChecks={onChecks} onError={onError} /></div></div>;
}

function ProfileSettings({ profile: initial, onSaved, onError }: { profile: Profile; onSaved: (workspace: WorkspaceSnapshot) => void; onError: (message: string) => void }) {
  const [profile, setProfile] = useState(initial); const [saving, setSaving] = useState(false);
  async function save() { setSaving(true); try { const response = await fetch("/api/profile", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(profile) }); const payload = await response.json() as WorkspaceSnapshot & { error?: string }; if (!response.ok) throw new Error(payload.error ?? "Unable to save profile details."); onSaved(payload); } catch (caught) { onError(caught instanceof Error ? caught.message : "Unable to save profile details."); } finally { setSaving(false); } }
  return <section className="settings-card"><header><h2>Profile</h2></header><div className="settings-form"><label>Name<input value={profile.displayName} onChange={(event) => setProfile({ ...profile, displayName: event.target.value })} /></label><label>Preferred language<input value={profile.preferredLanguage} onChange={(event) => setProfile({ ...profile, preferredLanguage: event.target.value })} /></label><label>Nationality<input value={profile.nationality} onChange={(event) => setProfile({ ...profile, nationality: event.target.value })} /></label><label>Gender<select value={profile.gender} onChange={(event) => setProfile({ ...profile, gender: event.target.value as ProfileGender })}><option value="not_specified">Not specified</option><option value="woman">Woman</option><option value="man">Man</option><option value="nonbinary">Non-binary</option><option value="prefer_not_to_say">Prefer not to say</option></select></label><label>Destination visa or residence status<select value={profile.immigrationStatus} onChange={(event) => setProfile({ ...profile, immigrationStatus: event.target.value as ImmigrationStatus })}><option value="unknown">Not sure yet</option><option value="no_visa">No visa or residence permit yet</option><option value="short_term_visitor">Short-term visitor</option><option value="tourist_visa">Tourist visa</option><option value="student_visa">Student visa</option><option value="work_visa">Work visa</option><option value="residence_permit">Residence permit</option><option value="other">Other</option></select></label><button className="save-button" onClick={() => void save()} disabled={saving}>{saving ? "Saving…" : "Save profile"}</button></div></section>;
}

function ApiSettings({ configuration, onSaved, onError }: { configuration: LocalConfiguration | null; onSaved: (configuration: LocalConfiguration) => void; onError: (message: string) => void }) {
  const [form, setForm] = useState<LocalConfigurationForm>({ googleMapsApiKey: "", uberClientId: "", telegramBotToken: "" });
  const [saving, setSaving] = useState(false); const [tests, setTests] = useState<Record<"google" | "uber" | "telegram", TestState>>({ google: idleTest(), uber: idleTest(), telegram: idleTest() });
  async function save() { setSaving(true); try { const response = await fetch("/api/configuration", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(form) }); const payload = await response.json() as LocalConfiguration & { error?: string }; if (!response.ok) throw new Error(payload.error ?? "Unable to save API configuration."); onSaved(payload); setForm({ googleMapsApiKey: "", uberClientId: "", telegramBotToken: "" }); } catch (caught) { onError(caught instanceof Error ? caught.message : "Unable to save API configuration."); } finally { setSaving(false); } }
  async function test(kind: "google" | "uber" | "telegram") { setTests((current) => ({ ...current, [kind]: { status: "testing", message: "Connecting…" } })); try { const request = kind === "google" ? fetch("/api/connectors/google") : kind === "uber" ? fetch("/api/connectors/uber") : fetch("/api/connectors/telegram/verify", { method: "POST" }); const response = await request; const payload = await response.json() as { status?: string; maps?: { status?: string; failure?: { message?: string } }; failure?: { message?: string }; error?: string }; const status = kind === "google" ? payload.maps?.status : payload.status; if (!response.ok || status === "unavailable" || status === "misconfigured") throw new Error(payload.error ?? payload.maps?.failure?.message ?? payload.failure?.message ?? "Connection failed"); setTests((current) => ({ ...current, [kind]: { status: "success", message: "Connected and available" } })); } catch (caught) { setTests((current) => ({ ...current, [kind]: { status: "error", message: caught instanceof Error ? caught.message : "Connection failed" } })); } }
  const service = (kind: "google" | "uber" | "telegram", name: string, configured: boolean) => <div className="service-test-row"><div><strong>{name}</strong><span className={`test-result ${tests[kind].status}`}>{configured ? tests[kind].message : "Enter and save the configuration first"}</span></div><button onClick={() => void test(kind)} disabled={!configured || tests[kind].status === "testing"}>Test connection</button></div>;
  return <section className="settings-card"><header><h2>API Configuration</h2></header><p className="settings-description">Credentials are stored in the local environment. Test each service after saving.</p><div className="settings-form"><label><span>Google Maps Platform API Key <em>{configuration?.google?.configured ? "Configured" : "Not configured"}</em></span><input type="password" value={form.googleMapsApiKey} onChange={(event) => setForm({ ...form, googleMapsApiKey: event.target.value })} /></label><label><span>Uber Client ID <em>{configuration?.uber?.configured ? "Configured" : "Not configured"}</em></span><input type="password" value={form.uberClientId} onChange={(event) => setForm({ ...form, uberClientId: event.target.value })} /></label><label><span>Telegram Bot Token <em>{configuration?.telegram?.configured ? "Configured" : "Not configured"}</em></span><input type="password" value={form.telegramBotToken} onChange={(event) => setForm({ ...form, telegramBotToken: event.target.value })} /></label><button className="save-button" onClick={() => void save()} disabled={saving}>{saving ? "Saving…" : "Save API configuration"}</button></div><div className="service-tests">{service("google", "Google Maps Platform", Boolean(configuration?.google?.configured))}{service("uber", "Uber", Boolean(configuration?.uber?.configured))}{service("telegram", "Telegram Bot", Boolean(configuration?.telegram?.configured))}</div></section>;
}

function RuntimeSettings({ selected, checks, onSaved, onChecks, onError }: { selected: AgentRuntimeKind; checks: RuntimeCheck[]; onSaved: (workspace: WorkspaceSnapshot) => void; onChecks: (checks: RuntimeCheck[]) => void; onError: (message: string) => void }) {
  const [tests, setTests] = useState<Record<AgentRuntimeKind, TestState>>({ codex: idleTest(), "claude-code": idleTest() });
  async function select(kind: AgentRuntimeKind) { try { const response = await fetch("/api/runtime", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind }) }); const payload = await response.json() as WorkspaceSnapshot & { error?: string }; if (!response.ok) throw new Error(payload.error ?? "Unable to switch AI Agent runtime."); onSaved(payload); } catch (caught) { onError(caught instanceof Error ? caught.message : "Unable to switch AI Agent runtime."); } }
  async function refresh() { const response = await fetch("/api/runtimes"); if (response.ok) onChecks(await response.json() as RuntimeCheck[]); }
  async function test(kind: AgentRuntimeKind) { setTests((current) => ({ ...current, [kind]: { status: "testing", message: "Running a minimal test…" } })); try { const response = await fetch(`/api/runtimes/${kind}/test`, { method: "POST" }); const payload = await response.json() as { ok?: boolean; message?: string; error?: string }; if (!response.ok || !payload.ok) throw new Error(payload.error ?? payload.message ?? "Test failed"); setTests((current) => ({ ...current, [kind]: { status: "success", message: payload.message ?? "Model call succeeded" } })); } catch (caught) { setTests((current) => ({ ...current, [kind]: { status: "error", message: caught instanceof Error ? caught.message : "Test failed" } })); } }
  return <section className="settings-card"><header><h2>AI Agent</h2></header><div className="runtime-grid">{(["codex", "claude-code"] as AgentRuntimeKind[]).map((kind) => { const check = checks.find((item) => item.kind === kind); return <div className={selected === kind ? "runtime-choice selected" : "runtime-choice"} key={kind}><button className="runtime-select" onClick={() => void select(kind)}><span>{kind === "codex" ? "Codex" : "Claude Code"}<small>{selected === kind ? "Currently selected" : "Select"}</small></span><em className={check?.installed && check.authenticated ? "ready" : ""}>{check?.installed && check.authenticated ? "Ready" : check?.message ?? "Not detected"}</em></button><div className="runtime-test"><span className={`test-result ${tests[kind].status}`}>{tests[kind].message}</span><button onClick={() => void test(kind)} disabled={!check?.installed || !check.authenticated || tests[kind].status === "testing"}>Run test</button></div></div>; })}</div><button className="text-action" onClick={() => void refresh()}>Detect local environment again</button></section>;
}

function isStarterPlan(plan: Plan): boolean { return plan.title === "Attend an exhibition in Shanghai" && plan.version === 1; }
function questionLike(value: string): boolean { return /\?\s*$/.test(value.trim()); }
function refinementIntro(plan: Plan | null): string {
  if (!plan) return "There is no plan to refine yet. Start with the destination, dates, and the goal that matters most.";
  const question = planRefinementQuestion(plan);
  return question
    ? `One key question is recommended: ${question}\nAnswer it or finish refining now. Other unknowns will remain as items to confirm.`
    : "There are no required follow-up questions. Review and confirm the plan, or tell me exactly what to change.";
}
function planRefinementQuestion(plan: Pick<Plan, "title" | "location" | "dates" | "assumptions" | "nextAction"> & Partial<Pick<Plan, "knownInformation" | "sources">>): string | null {
  const sourceResearch = /official|published|academic calendar|registration date|institutional deadline|official deadline|opening hours|policy requirement|tuition fee|weather forecast/i;
  if (questionLike(plan.nextAction) && !/review|confirm/i.test(plan.nextAction) && !sourceResearch.test(plan.nextAction) && !redundantDocumentQuestion(plan.nextAction, plan)) return plan.nextAction.trim();
  const answerable = plan.assumptions.filter((item) => !/official source|official guidance|policy entitlement|provider availability|not been verified|requires source-backed|academic calendar|registration date|institutional deadline|official deadline/i.test(item));
  const joined = answerable.join(" ").toLocaleLowerCase();
  if (!joined) return null;
  if (/travel date|arrival date|departure date|return date|travel day/.test(joined)) return "What date do you expect to arrive, and when will you leave? Approximate dates are fine.";
  if (/fixed event|fixed commitment|appointment|meeting|concert|exhibition/.test(joined)) return "What must you attend at a fixed time? Share its place and date or time, or say there is no fixed event.";
  if (/arrival point|arrival airport|arrival station|origin|flight arrival|train arrival/.test(joined)) return "Where will you depart from, which airport or station will you arrive at, and at about what time?";
  if (/return airport|return station|return flight|return train/.test(joined)) return "Which airport or station will you depart from for the return trip, and at about what time? Say not booked yet if it is undecided.";
  if (/venue|event location|exhibition/.test(joined)) return "Where is the main event, exhibition, or place you need to visit? A name or address is enough.";
  if (/accommodation|hotel|stay/.test(joined)) return "Have you booked accommodation? If yes, send its name or address; if not, I can recommend an area based on access.";
  if (/arrival|airport|station|terminal/.test(joined)) return "Which airport or station will you arrive at, and at about what time?";
  if (/program|degree/.test(joined)) return "Is this an undergraduate, master's, doctoral, language, or exchange program?";
  if (/semester|academic term|intake/.test(joined)) return "Which year and academic term do you plan to start?";
  if (/travell?er|party|people|luggage|baggage/.test(joined)) return "How many people are travelling, and roughly how much luggage will you have?";
  if (/budget|currency|preference|priority/.test(joined)) return "For this Plan, do you care most about budget, convenience, or comfort? You can also share a budget range.";
  return null;
}
function redundantDocumentQuestion(value: string, plan: Pick<Plan, "title" | "location" | "assumptions"> & Partial<Pick<Plan, "knownInformation" | "sources">>): boolean {
  const question = value.toLocaleLowerCase();
  if (!/(?:what|which).*(?:exact|full|official).*(?:institution|university|college|school).*name|(?:institution|university|college|school).*name.*(?:admission|offer|letter|document)/.test(question)) return false;
  const context = [plan.title, plan.location, ...plan.assumptions, ...(plan.knownInformation ?? []), ...(plan.sources ?? []).flatMap((source) => [source.title, source.authority])].join(" ");
  return /\b[A-Z][A-Za-z'’&.-]+(?:\s+[A-Z][A-Za-z'’&.-]+){0,5}\s+(?:University|College|School|Institute)\b/.test(context);
}
function formatDate(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-US", { year: "numeric", month: "long", day: "numeric" }).format(date); }
