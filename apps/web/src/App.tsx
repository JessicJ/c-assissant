import { useEffect, useRef, useState } from "react";
import type { RuntimeCheck } from "@c-assistant/agent-adapters";
import type { Plan, WorkspaceSnapshot } from "@c-assistant/core";
import { InlineComposerWorkspace, type ComposerMode } from "./PlanComposer.js";
import { PlansWorkspace, type PlanTab } from "./PlansWorkspace.js";
import { FirstRunTour, shouldShowFirstRunTour } from "./FirstRunTour.js";
import { SettingsWorkspace } from "./SettingsWorkspace.js";
import { confirmPlan, deleteHistoricalPlan as deleteHistoricalPlanRequest, getSettingsSnapshot, getWorkspace, listPlanHistory, reorderPlanTask as reorderPlanTaskRequest, setPlanTaskChecked, undoPlanChange as undoPlanChangeRequest, type LocalConfiguration } from "./api-client.js";
import { isStarterPlan } from "./plan-display.js";
import type { AgentStatus } from "./ui-types.js";
import "./styles.css";
import "./editorial.css";

type View = "plans" | "settings";
type InitializeWorkspaceOptions = {
  resetAutoRetry?: boolean;
  cancelled?: () => boolean;
};

const WORKSPACE_AUTO_RETRY_DELAYS_MS = [800, 1_600, 3_200];
const ignoreAgentStatus = (_status: AgentStatus) => {};

export default function App() {
  const [view, setView] = useState<View>("plans");
  const [planTab, setPlanTab] = useState<PlanTab>("current");
  const [workspace, setWorkspace] = useState<WorkspaceSnapshot | null>(null);
  const [history, setHistory] = useState<Plan[]>([]);
  const [configuration, setConfiguration] = useState<LocalConfiguration | null>(null);
  const [runtimeChecks, setRuntimeChecks] = useState<RuntimeCheck[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [workspaceLoadRetry, setWorkspaceLoadRetry] = useState(0);
  const [composerMode, setComposerMode] = useState<ComposerMode>("new_plan");
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerPrefill, setComposerPrefill] = useState("");
  const [firstRunTourOpen, setFirstRunTourOpen] = useState(false);
  const [confirmingPlan, setConfirmingPlan] = useState(false);
  const [planOperationBusy, setPlanOperationBusy] = useState(false);
  const workspaceRef = useRef<WorkspaceSnapshot | null>(null);
  const viewRef = useRef<View>("plans");
  const planTabRef = useRef<PlanTab>("current");
  const composerOpenRef = useRef(false);
  const handledGenerationOpenRef = useRef<Set<string>>(new Set());

  useEffect(() => { workspaceRef.current = workspace; }, [workspace]);
  useEffect(() => { viewRef.current = view; }, [view]);
  useEffect(() => { planTabRef.current = planTab; }, [planTab]);
  useEffect(() => { composerOpenRef.current = composerOpen; }, [composerOpen]);

  async function initializeWorkspace(options: InitializeWorkspaceOptions = {}) {
    const { resetAutoRetry = true, cancelled = () => false } = options;
    if (resetAutoRetry) setWorkspaceLoadRetry(0);
    setLoading(true);
    setError(null);
    try {
      const workspaceSnapshot = await getWorkspace();
      if (cancelled()) return;
      setWorkspace(workspaceSnapshot);
      const previewFirstRunTour = new URLSearchParams(window.location.search).get("onboarding") === "1";
      setFirstRunTourOpen(shouldShowFirstRunTour(workspaceSnapshot.profile, previewFirstRunTour));
      const [historyResult, settingsResult] = await Promise.allSettled([listPlanHistory(), getSettingsSnapshot()]);
      if (cancelled()) return;
      if (historyResult.status === "fulfilled" && historyResult.value) setHistory(historyResult.value);
      if (settingsResult.status === "fulfilled") {
        if (settingsResult.value.configuration) setConfiguration(settingsResult.value.configuration);
        if (settingsResult.value.runtimeChecks) setRuntimeChecks(settingsResult.value.runtimeChecks);
      }
      if (historyResult.status === "rejected" || settingsResult.status === "rejected") {
        setError("Landi loaded the current plan, but some workspace details could not be refreshed.");
      }
      setWorkspaceLoadRetry(WORKSPACE_AUTO_RETRY_DELAYS_MS.length);
    } catch (caught) {
      if (!cancelled()) setError(caught instanceof Error ? caught.message : "Unable to load the workspace.");
    } finally {
      if (!cancelled()) setLoading(false);
    }
  }

  async function loadHistory() {
    const plans = await listPlanHistory();
    if (plans) setHistory(plans);
  }

  useEffect(() => {
    let cancelled = false;
    void initializeWorkspace({ resetAutoRetry: false, cancelled: () => cancelled });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (workspace || loading || !error) return;
    const delay = WORKSPACE_AUTO_RETRY_DELAYS_MS[workspaceLoadRetry];
    if (delay === undefined) return;
    const timer = window.setTimeout(() => {
      setWorkspaceLoadRetry((current) => current + 1);
      void initializeWorkspace({ resetAutoRetry: false });
    }, delay);
    return () => window.clearTimeout(timer);
  }, [error, loading, workspace, workspaceLoadRetry]);

  const generatingSessionId = workspace?.planningSession?.status === "generating" ? workspace.planningSession.id : undefined;
  useEffect(() => {
    const session = workspace?.planningSession;
    if (view !== "plans" || planTab !== "current" || !composerOpen || composerMode !== "new_plan") return;
    if (session?.status !== "draft_ready" || !session.outputPlanId || workspace?.activePlan.id !== session.outputPlanId) return;
    handledGenerationOpenRef.current.add(`${session.id}:${session.outputPlanId}`);
    setComposerOpen(false);
    setComposerPrefill("");
  }, [workspace, view, planTab, composerOpen, composerMode]);

  useEffect(() => {
    if (!generatingSessionId) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const next = await getWorkspace({ cache: "no-store" });
        if (cancelled) return;
        const previous = workspaceRef.current;
        const outputPlanId = next.planningSession?.id === generatingSessionId && next.planningSession.status === "draft_ready" ? next.planningSession.outputPlanId : undefined;
        const currentWaitStillVisible = viewRef.current === "plans" && planTabRef.current === "current" && (
          composerOpenRef.current || (!previous || (!isStarterPlan(previous.activePlan) ? false : previous.planningSession?.id === generatingSessionId))
        );
        const shouldOpenGeneratedPlan = Boolean(
          outputPlanId
          && next.activePlan.id === outputPlanId
          && currentWaitStillVisible
          && !handledGenerationOpenRef.current.has(`${generatingSessionId}:${outputPlanId}`)
        );
        setWorkspace(next);
        workspaceRef.current = next;
        if (shouldOpenGeneratedPlan && outputPlanId) {
          handledGenerationOpenRef.current.add(`${generatingSessionId}:${outputPlanId}`);
          setView("plans");
          setPlanTab("current");
          setComposerOpen(false);
          setComposerPrefill("");
        }
        if (next.planningSession?.status === "draft_ready" || next.activePlan.id !== previous?.activePlan.id) void loadHistory().catch(() => undefined);
      } catch { /* Keep the current page stable and try again on the next interval. */ }
    };
    void poll();
    const interval = window.setInterval(() => void poll(), 5_000);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, [generatingSessionId]);

  function openComposer(mode: ComposerMode, prefill = "") {
    if (workspace?.profile.status !== "ready" || planOperationBusy) return;
    setView("plans");
    setPlanTab("current");
    setComposerMode(mode);
    setComposerPrefill(prefill);
    setComposerOpen(true);
  }

  function completeFirstRunTour() {
    setFirstRunTourOpen(false);
    setView("plans");
    setPlanTab("current");
    setComposerMode("new_plan");
    setComposerPrefill("");
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
      await deleteHistoricalPlanRequest(plan.id);
      setHistory((current) => current.filter((item) => item.id !== plan.id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to delete the archived plan.");
    }
  }

  async function togglePlanTask(planId: string, taskId: string, checked: boolean) {
    try {
      setWorkspace(await setPlanTaskChecked(planId, taskId, checked));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save the checklist status.");
    }
  }

  async function reorderPlanTask(planId: string, taskId: string, direction: "up" | "down") {
    if (!workspace || workspace.activePlan.id !== planId) return;
    try {
      const payload = await reorderPlanTaskRequest(planId, taskId, direction, workspace.activePlan.version);
      setWorkspace(payload.workspace);
    } catch (caught) { const message = caught instanceof Error ? caught.message : "Unable to reorder the itinerary."; setError(message); }
  }

  async function undoPlanChange(planId: string, changeId: string) {
    if (!workspace || workspace.activePlan.id !== planId) return;
    try {
      const payload = await undoPlanChangeRequest(planId, changeId, workspace.activePlan.version);
      setWorkspace(payload);
    } catch (caught) { const message = caught instanceof Error ? caught.message : "Unable to undo the change."; setError(message); }
  }

  async function confirmCurrentPlan(planId: string) {
    try {
      setConfirmingPlan(true);
      setWorkspace(await confirmPlan(planId));
      await loadHistory();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to confirm the plan.");
    } finally {
      setConfirmingPlan(false);
    }
  }

  const workspaceRetryPending = !workspace && Boolean(error) && WORKSPACE_AUTO_RETRY_DELAYS_MS[workspaceLoadRetry] !== undefined;

  if (loading) return <main className="loading-screen"><span className="loading-spinner" />Loading Landi…</main>;
  if (!workspace) return <main className="loading-screen error-screen">
    <div className="startup-error-copy">
      <strong>{error ?? "The workspace is temporarily unavailable."}</strong>
      <small role={workspaceRetryPending ? "status" : undefined}>{workspaceRetryPending ? "Retrying automatically…" : "Automatic retry paused. Try again when Landi is ready."}</small>
    </div>
    <button type="button" onClick={() => void initializeWorkspace()}>Try again</button>
  </main>;

  const currentPlan = isStarterPlan(workspace.activePlan) ? null : workspace.activePlan;
  const resumablePlanningSession = workspace.planningSession && ["collecting", "proposal_ready", "proposal_confirmed", "generating"].includes(workspace.planningSession.status)
    ? workspace.planningSession
    : undefined;
  const visibleHistory = history.filter((plan) => !isStarterPlan(plan));

  const interactionPage = view === "plans" && planTab === "current" && composerOpen && workspace.profile.status === "ready";
  const emptyHome = view === "plans" && planTab === "current" && !currentPlan && !resumablePlanningSession;
  const planningHome = view === "plans" && planTab === "current" && !currentPlan && (Boolean(resumablePlanningSession) || (composerOpen && composerMode === "new_plan"));

  return <main className={`app-shell${emptyHome || planningHome ? " empty-home" : ""}${planningHome ? " planning-home" : ""}${interactionPage ? " interaction-page" : ""}`}>
    <section className="main-stage">
      {!interactionPage && !emptyHome ? <header className="global-header">
        <button className="top-brand" onClick={() => { setView("plans"); setPlanTab("current"); }} aria-label="Return to current plan"><span><strong>LANDI</strong><small>Managed by MAH</small></span></button>
        <nav className="global-navigation" aria-label="Main navigation">
          <button className={view === "plans" && planTab === "current" ? "active" : ""} onClick={() => { setView("plans"); setPlanTab("current"); }}>Plan</button>
          <button className={view === "plans" && planTab === "history" ? "active" : ""} onClick={() => { setView("plans"); setPlanTab("history"); }}>Plan History</button>
          <button className={view === "settings" ? "active" : ""} onClick={() => setView("settings")}>Settings</button>
        </nav>
        <div className="header-actions">
          <button className="new-plan-button" onClick={() => openComposer("new_plan")} disabled={planOperationBusy}><span>＋</span>{planOperationBusy ? "Creating" : "Create Plan"}</button>
        </div>
      </header> : null}
      {error ? <div className="inline-alert">{error}<button onClick={() => setError(null)}>Close</button></div> : null}
      {view === "plans" ? composerOpen && planTab === "current" && workspace.profile.status === "ready" ? <InlineComposerWorkspace mode={composerMode} currentPlan={currentPlan} planningSession={composerMode === "new_plan" ? resumablePlanningSession : undefined} initialMessage={composerPrefill} onClose={() => { setComposerOpen(false); setComposerPrefill(""); }} onPlanCreated={handlePlanCreated} onStatus={ignoreAgentStatus} onError={setError} /> : <PlansWorkspace currentPlan={currentPlan} activeBlueprint={workspace.activeBlueprint} planningSession={resumablePlanningSession} hidePlanningSession={Boolean(currentPlan)} latestPlanChange={workspace.latestPlanChange} latestPlanReplacement={workspace.latestPlanReplacement} executionPlan={workspace.executionPlan ?? null} destinationArrivals={workspace.destinationArrivals} history={visibleHistory} tab={planTab} confirming={confirmingPlan} onTab={setPlanTab} onCreate={(prefill) => openComposer("new_plan", prefill)} onRevise={(message) => openComposer("revise_plan", message)} onDelete={deleteHistoricalPlan} onTaskToggle={togglePlanTask} onTaskReorder={reorderPlanTask} onUndoChange={undoPlanChange} onConfirm={confirmCurrentPlan} onPlanCreated={handlePlanCreated} onStatus={ignoreAgentStatus} onError={setError} onOperationBusy={setPlanOperationBusy} /> : null}
      {view === "settings" ? <SettingsWorkspace workspace={workspace} configuration={configuration} checks={runtimeChecks} onWorkspace={setWorkspace} onConfiguration={setConfiguration} onChecks={setRuntimeChecks} onError={setError} /> : null}
    </section>
    {firstRunTourOpen || workspace.profile.status !== "ready"
      ? <FirstRunTour profile={workspace.profile} onProfileSaved={setWorkspace} onComplete={completeFirstRunTour} onError={setError} />
      : null}
  </main>;
}
