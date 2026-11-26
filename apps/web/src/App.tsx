import { useEffect, useRef, useState } from "react";
import type { Plan, WorkspaceSnapshot } from "@c-assistant/core";
import { InlineComposerWorkspace, type ComposerMode } from "./PlanComposer.js";
import { PlansWorkspace, type PlanTab } from "./PlansWorkspace.js";
import { FirstRunTour, shouldShowFirstRunTour } from "./FirstRunTour.js";
import { SettingsWorkspace } from "./SettingsWorkspace.js";
import { safePlanError, declarePreDeparture, getPlanConfirmationReview, type ExactPlanConfirmation, confirmPlan, deleteHistoricalPlan as deleteHistoricalPlanRequest, getSettingsSnapshot, getWorkspace, listPlanHistory, reorderPlanTask as reorderPlanTaskRequest, setPlanTaskChecked, undoPlanChange as undoPlanChangeRequest, type LocalConfiguration } from "./api-client.js";
import { isStarterPlan } from "./plan-display.js";
import type { AgentStatus } from "./ui-types.js";
import { confirmWithReadback, PlanConfirmationReadbackError, reviewedPlanConfirmation, type ReviewedPlanConfirmation } from "./plan-confirmation-recovery.js";
import { reconcilePlanMutationFailure } from "./plan-mutation-recovery.js";
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [workspaceLoadRetry, setWorkspaceLoadRetry] = useState(0);
  const [composerMode, setComposerMode] = useState<ComposerMode>("new_plan");
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerPrefill, setComposerPrefill] = useState("");
  const [firstRunTourOpen, setFirstRunTourOpen] = useState(false);
  const [confirmingPlan, setConfirmingPlan] = useState(false);
  const [planOperationBusy, setPlanOperationBusy] = useState(false);
  const [photoRefreshPlanId, setPhotoRefreshPlanId] = useState<string | null>(null);
  const workspaceRef = useRef<WorkspaceSnapshot | null>(null);
  const viewRef = useRef<View>("plans");
  const planTabRef = useRef<PlanTab>("current");
  const composerOpenRef = useRef(false);
  const handledGenerationOpenRef = useRef<Set<string>>(new Set());
  const pendingConfirmationRef = useRef<ReviewedPlanConfirmation | null>(null);
  const [exactReview,setExactReview]=useState<{planId:string;version:number;binding:ExactPlanConfirmation;observations:import("./api-client.js").ReviewObservation[];arrangements:import("./api-client.js").PlanConfirmationReview["arrangements"]}|null>(null);
  const confirmationInFlightRef = useRef(false);

  useEffect(() => { workspaceRef.current = workspace; }, [workspace]);
  useEffect(()=>{
    setExactReview(null);
    if(!workspace || workspace.activePlan.status!=="draft" || !workspace.executionPlan)return;
    let cancelled=false;
    void getPlanConfirmationReview(workspace.activePlan.id).then(result=>{
      if(cancelled)return;
      if(JSON.stringify(result.workspace.activePlan)!==JSON.stringify(workspace.activePlan) || JSON.stringify(result.workspace.activeBlueprint)!==JSON.stringify(workspace.activeBlueprint) || JSON.stringify(result.workspace.executionPlan)!==JSON.stringify(workspace.executionPlan))return;
      setExactReview({planId:workspace.activePlan.id,version:workspace.activePlan.version,binding:result.exactConfirmation,observations:result.observations,arrangements:result.arrangements});
    }).catch(()=>{});
    return ()=>{cancelled=true;};
  },[workspace]);

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
      if (historyResult.status === "fulfilled") setHistory(historyResult.value);
      if (settingsResult.status === "fulfilled") {
        if (settingsResult.value.configuration) setConfiguration(settingsResult.value.configuration);
      }
      if (historyResult.status === "rejected") {
        setError(safePlanError(historyResult.reason));
      } else if (settingsResult.status === "rejected") {
        setError("Landi loaded the current plan, but some workspace details could not be refreshed.");
      }
      setWorkspaceLoadRetry(WORKSPACE_AUTO_RETRY_DELAYS_MS.length);
    } catch (caught) {
      if (!cancelled()) setError(safePlanError(caught));
    } finally {
      if (!cancelled()) setLoading(false);
    }
  }

  async function loadHistory() {
    try {
      setHistory(await listPlanHistory());
    } catch (caught) {
      // A secondary history refresh must not turn an acknowledged save into a failure.
      setError(safePlanError(caught));
    }
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
        if (outputPlanId && next.activePlan.id === outputPlanId) setPhotoRefreshPlanId(outputPlanId);
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

  useEffect(() => {
    if (!photoRefreshPlanId) return;
    let cancelled = false;
    const poll = async () => {
      if (workspaceRef.current?.activePlan.id !== photoRefreshPlanId) return;
      try {
        const next = await getWorkspace({ cache: "no-store" });
        const current = workspaceRef.current;
        if (cancelled || current?.activePlan.id !== photoRefreshPlanId || next.activePlan.id !== photoRefreshPlanId || next.activePlan.version < current.activePlan.version) return;
        setWorkspace(next);
        workspaceRef.current = next;
      } catch { /* Photos can refresh later without interrupting the visible plan. */ }
    };
    const interval = window.setInterval(() => void poll(), 15_000);
    const timeout = window.setTimeout(() => { cancelled = true; window.clearInterval(interval); }, 210_000);
    return () => { cancelled = true; window.clearInterval(interval); window.clearTimeout(timeout); };
  }, [photoRefreshPlanId]);

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
      setError(safePlanError(caught));
    }
  }

  async function togglePlanTask(planId: string, taskId: string, checked: boolean) {
    if (planOperationBusy) { setError("Check the previous operation result before changing the current plan."); return; }
    try {
      setWorkspace(await setPlanTaskChecked(planId, taskId, checked));
    } catch (caught) {
      setError(safePlanError(caught));
      throw caught;
    }
  }

  async function reorderPlanTask(planId: string, taskId: string, direction: "up" | "down") {
    if (planOperationBusy) { setError("Check the previous operation result before changing the current plan."); return; }
    if (!workspace || workspace.activePlan.id !== planId) return;
    try {
      const payload = await reorderPlanTaskRequest(planId, taskId, direction, workspace.activePlan.version);
      setWorkspace(payload.workspace);
    } catch (caught) {
      setError(await reconcilePlanMutationFailure(caught, { read: () => getWorkspace({ cache: "no-store" }), publish: setWorkspace }));
    }
  }

  async function undoPlanChange(planId: string, changeId: string) {
    if (planOperationBusy) { setError("Check the previous operation result before changing the current plan."); return; }
    if (!workspace || workspace.activePlan.id !== planId) return;
    try {
      const payload = await undoPlanChangeRequest(planId, changeId, workspace.activePlan.version);
      setWorkspace(payload);
    } catch (caught) {
      setError(await reconcilePlanMutationFailure(caught, { read: () => getWorkspace({ cache: "no-store" }), publish: setWorkspace }));
    }
  }

  async function confirmCurrentPlan(planId: string) {
    if (planOperationBusy) { setError("Check the previous operation result before changing the current plan."); return; }
    if (confirmationInFlightRef.current) return;
    confirmationInFlightRef.current = true;
    try {
      setConfirmingPlan(true);
      if (!workspace || workspace.activePlan.id !== planId) throw new Error("Review the current itinerary before confirming.");
      const pending = pendingConfirmationRef.current;
      const retry = pending?.planId === planId;
      const review = retry ? pending : reviewedPlanConfirmation(workspace);
      if(!retry && workspace.executionPlan){
        if(!exactReview || exactReview.planId!==planId || exactReview.version!==workspace.activePlan.version)throw new Error("The confirmation information is not ready. Refresh and review the complete itinerary again.");
        review.exactConfirmation=exactReview.binding;
      }
      pendingConfirmationRef.current = review;
      const confirmed = await confirmWithReadback(review, {
        submit: () => confirmPlan(review.planId, review.version, review.blueprint?.version, review.base, review.exactConfirmation),
        read: () => getWorkspace({ cache: "no-store" })
      }, retry);
      pendingConfirmationRef.current = null;
      setWorkspace(confirmed);
      setError(null);
      await loadHistory();
    } catch (caught) {
      if (caught instanceof PlanConfirmationReadbackError) {
        if (caught.workspace) setWorkspace(caught.workspace);
        if (!caught.uncertain) { pendingConfirmationRef.current = null; setExactReview(null); }
      }
      setError(caught instanceof PlanConfirmationReadbackError ? caught.message : safePlanError(caught));
    } finally {
      confirmationInFlightRef.current = false;
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
        <button className="top-brand" onClick={() => { setView("plans"); setPlanTab("current"); }} aria-label="Return to current plan"><span><strong>LANDI</strong><small>Personal travel assistant</small></span></button>
        <nav className="global-navigation" aria-label="Main navigation">
          <button className={view === "plans" && planTab === "current" ? "active" : ""} onClick={() => { setView("plans"); setPlanTab("current"); }}>Plan</button>
          <button className={view === "plans" && planTab === "history" ? "active" : ""} onClick={() => { setView("plans"); setPlanTab("history"); }}>Plan History</button>
          <button className={view === "settings" ? "active" : ""} onClick={() => setView("settings")}>Settings</button>
        </nav>
        <div className="header-actions">
          <button className="new-plan-button" onClick={() => openComposer("new_plan")} disabled={planOperationBusy}><span>＋</span>{"Create Plan"}</button>
        </div>
      </header> : null}
      {emptyHome && !interactionPage ? <button type="button" className="empty-home-settings" onClick={() => setView("settings")}>Settings</button> : null}
      {error ? <div className="inline-alert">{error}<button onClick={() => setError(null)}>Close</button></div> : null}
      {view === "plans" ? composerOpen && planTab === "current" && workspace.profile.status === "ready" ? <InlineComposerWorkspace profile={workspace.profile} mode={composerMode} currentPlan={currentPlan} planningSession={composerMode === "new_plan" ? resumablePlanningSession : undefined} initialMessage={composerPrefill} onClose={() => { setComposerOpen(false); setComposerPrefill(""); }} onPlanCreated={handlePlanCreated} onStatus={ignoreAgentStatus} onError={setError} /> : <PlansWorkspace onDeclarePreDeparture={async()=>{if(!exactReview)return;try{await declarePreDeparture(exactReview.binding.context);setWorkspace(await getWorkspace({cache:"no-store"}));}catch(caught){setError(safePlanError(caught));}}} reviewPhase={exactReview?.binding.context.phase.value} reviewEvidence={exactReview?.observations} reviewArrangements={exactReview?.arrangements} latestDirectBlueprintRevision={workspace.latestDirectBlueprintRevision} currentPlan={currentPlan} activeBlueprint={workspace.activeBlueprint} planningSession={resumablePlanningSession} hidePlanningSession={Boolean(currentPlan)} latestPlanChange={workspace.latestPlanChange} latestPlanReplacement={workspace.latestPlanReplacement} executionPlan={workspace.executionPlan ?? null} destinationArrivals={workspace.destinationArrivals} history={visibleHistory} tab={planTab} confirming={confirmingPlan} onTab={setPlanTab} onCreate={(prefill) => openComposer("new_plan", prefill)} onRevise={(message) => openComposer("revise_plan", message)} onDelete={deleteHistoricalPlan} onTaskToggle={togglePlanTask} onTaskReorder={reorderPlanTask} onUndoChange={undoPlanChange} onConfirm={confirmCurrentPlan} onPlanCreated={handlePlanCreated} onStatus={ignoreAgentStatus} onError={setError} onOperationBusy={setPlanOperationBusy} /> : null}
      {view === "settings" ? <SettingsWorkspace workspace={workspace} configuration={configuration} onWorkspace={setWorkspace} onConfiguration={setConfiguration} onError={setError} /> : null}
    </section>
    {firstRunTourOpen || workspace.profile.status !== "ready"
      ? <FirstRunTour profile={workspace.profile} onProfileSaved={setWorkspace} onComplete={completeFirstRunTour} onError={setError} />
      : null}
  </main>;
}
