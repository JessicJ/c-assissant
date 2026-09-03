import { useEffect, useState } from "react";
import type { RuntimeCheck } from "@c-assistant/agent-adapters";
import type { Plan, WorkspaceSnapshot } from "@c-assistant/core";
import landiLogoUrl from "../../../assets/branding/landi-round-otter-earth-icon-final.png";
import { InlineComposerWorkspace, type ComposerMode } from "./PlanComposer.js";
import { PlansWorkspace, type PlanTab } from "./PlansWorkspace.js";
import { ProfileOnboardingDialog } from "./ProfileOnboardingDialog.js";
import { SettingsWorkspace } from "./SettingsWorkspace.js";
import { confirmPlan, deleteHistoricalPlan as deleteHistoricalPlanRequest, getSettingsSnapshot, getWorkspace, listPlanHistory, reorderPlanTask as reorderPlanTaskRequest, setPlanTaskChecked, undoPlanChange as undoPlanChangeRequest, type LocalConfiguration } from "./api-client.js";
import { isStarterPlan } from "./plan-display.js";
import type { AgentStatus } from "./ui-types.js";
import "./styles.css";
import "./editorial.css";

type View = "plans" | "settings";

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
    setWorkspace(await getWorkspace());
  }

  async function loadHistory() {
    const plans = await listPlanHistory();
    if (plans) setHistory(plans);
  }

  async function loadSettings() {
    const snapshot = await getSettingsSnapshot();
    if (snapshot.configuration) setConfiguration(snapshot.configuration);
    if (snapshot.runtimeChecks) setRuntimeChecks(snapshot.runtimeChecks);
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
        const next = await getWorkspace({ cache: "no-store" });
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
    setView("plans");
    setPlanTab("current");
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
      setWorkspace(payload.workspace); setAgentStatus({ tone: "success", text: "The new order is saved. Review affected transfer times before confirmation." });
    } catch (caught) { const message = caught instanceof Error ? caught.message : "Unable to reorder the itinerary."; setError(message); setAgentStatus({ tone: "error", text: message }); }
  }

  async function undoPlanChange(planId: string, changeId: string) {
    if (!workspace || workspace.activePlan.id !== planId) return;
    try {
      const payload = await undoPlanChangeRequest(planId, changeId, workspace.activePlan.version);
      setWorkspace(payload); setAgentStatus({ tone: "success", text: "The itinerary reorder was undone." });
    } catch (caught) { const message = caught instanceof Error ? caught.message : "Unable to undo the change."; setError(message); setAgentStatus({ tone: "error", text: message }); }
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
      {view === "plans" ? composerOpen && planTab === "current" && workspace.profile.status === "ready" ? <InlineComposerWorkspace mode={composerMode} currentPlan={currentPlan} planningSession={composerMode === "new_plan" ? resumablePlanningSession : undefined} initialMessage={composerPrefill} onClose={() => { setComposerOpen(false); setComposerPrefill(""); }} onPlanCreated={handlePlanCreated} onStatus={setAgentStatus} onError={setError} /> : <PlansWorkspace currentPlan={currentPlan} activeBlueprint={workspace.activeBlueprint} planningSession={resumablePlanningSession} hidePlanningSession={Boolean(currentPlan)} latestPlanChange={workspace.latestPlanChange} latestPlanReplacement={workspace.latestPlanReplacement} executionPlan={workspace.executionPlan ?? null} destinationArrivals={workspace.destinationArrivals} history={visibleHistory} tab={planTab} confirming={confirmingPlan} onTab={setPlanTab} onCreate={() => openComposer("new_plan")} onRevise={(message) => openComposer("revise_plan", message)} onDelete={deleteHistoricalPlan} onTaskToggle={togglePlanTask} onTaskReorder={reorderPlanTask} onUndoChange={undoPlanChange} onConfirm={confirmCurrentPlan} onPlanCreated={handlePlanCreated} onStatus={setAgentStatus} onError={setError} onOperationBusy={setPlanOperationBusy} /> : null}
      {view === "settings" ? <SettingsWorkspace workspace={workspace} configuration={configuration} checks={runtimeChecks} onWorkspace={setWorkspace} onConfiguration={setConfiguration} onChecks={setRuntimeChecks} onError={setError} /> : null}
    </section>
    {workspace.profile.status !== "ready" ? <ProfileOnboardingDialog profile={workspace.profile} onSaved={setWorkspace} onError={setError} /> : null}
    {agentStatus ? <aside className={`agent-status-float ${agentStatus.tone}`} role="status" aria-live="polite"><img src={landiLogoUrl} alt="" /><div><strong>{agentStatus.tone === "error" ? "Needs attention" : agentStatus.tone === "working" ? "Landi is checking" : "Saved"}</strong><span>{agentStatus.text}</span></div><button type="button" onClick={() => setAgentStatus(null)} aria-label="Dismiss status">×</button></aside> : null}
  </main>;
}
