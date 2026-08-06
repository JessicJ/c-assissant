import { useEffect, useMemo, useState } from "react";
import type { WorkspaceSnapshot } from "@c-assistant/core";

type View = "Today" | "Plans" | "Inbox" | "Profile" | "Settings";

const navigation: View[] = ["Today", "Plans", "Inbox", "Profile", "Settings"];

function App() {
  const [workspace, setWorkspace] = useState<WorkspaceSnapshot | null>(null);
  const [view, setView] = useState<View>("Today");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    void loadWorkspace();
  }, []);

  async function loadWorkspace() {
    try {
      setLoading(true);
      const response = await fetch("/api/workspace");
      if (!response.ok) throw new Error("The Core service did not return workspace data.");
      setWorkspace((await response.json()) as WorkspaceSnapshot);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to reach the Core service.");
    } finally {
      setLoading(false);
    }
  }

  async function activatePlan() {
    if (!workspace) return;
    try {
      setConfirming(true);
      const response = await fetch(`/api/plans/${workspace.activePlan.id}/confirm`, { method: "POST" });
      if (!response.ok) throw new Error("The Plan could not be activated.");
      setWorkspace((await response.json()) as WorkspaceSnapshot);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The Plan could not be activated.");
    } finally {
      setConfirming(false);
    }
  }

  const readyTasks = useMemo(
    () => workspace?.activePlan.stages.flatMap((stage) => stage.tasks).filter((task) => task.status !== "completed") ?? [],
    [workspace]
  );

  if (loading) return <main className="state-screen">Loading your workspace…</main>;
  if (error && !workspace) return <main className="state-screen error-state">{error}</main>;
  if (!workspace) return null;

  const { activePlan: plan } = workspace;

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">C</span>
          <span>C-assistant</span>
        </div>
        <nav aria-label="Workspace navigation">
          {navigation.map((item) => (
            <button className={view === item ? "nav-item active" : "nav-item"} key={item} onClick={() => setView(item)}>
              {item}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <span className="pulse" />
          Local demo mode
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">{view}</p>
            <h1>{view === "Today" ? "A calm start for your China plan." : view}</h1>
          </div>
          <button className="profile-chip" onClick={() => setView("Profile")}>{workspace.profile.displayName}</button>
        </header>

        {error ? <p className="inline-error">{error}</p> : null}

        {view === "Today" ? (
          <>
            <section className="hero-card">
              <div>
                <p className="eyebrow">Active context</p>
                <h2>{plan.title}</h2>
                <p>{plan.location} · {plan.dates}</p>
              </div>
              <div className={plan.status === "active" ? "plan-state active" : "plan-state"}>
                {plan.status === "active" ? "Plan active" : "Needs confirmation"}
              </div>
            </section>

            <section className="grid-two">
              <article className="card next-card">
                <p className="eyebrow">Next action</p>
                <h3>{plan.nextAction}</h3>
                {plan.status === "draft" ? (
                  <button className="primary-button" disabled={confirming} onClick={() => void activatePlan()}>
                    {confirming ? "Activating…" : "Confirm and activate Plan"}
                  </button>
                ) : <span className="success-copy">Confirmation recorded for Plan v{plan.version}.</span>}
              </article>

              <article className="card">
                <p className="eyebrow">What the system knows</p>
                <ul className="compact-list">
                  {plan.knownInformation.map((item) => <li key={item}>{item}</li>)}
                </ul>
              </article>
            </section>

            <section className="section-heading">
              <div>
                <p className="eyebrow">Timeline</p>
                <h2>What comes next</h2>
              </div>
              <span>{readyTasks.length} open items</span>
            </section>
            <section className="timeline">
              {plan.stages.map((stage, index) => (
                <article className="stage" key={stage.id}>
                  <div className="stage-index">0{index + 1}</div>
                  <div>
                    <h3>{stage.title}</h3>
                    <p>{stage.description}</p>
                    <div className="task-stack">
                      {stage.tasks.map((task) => (
                        <div className="task-row" key={task.id}>
                          <span className={`task-dot ${task.status}`} />
                          <span>{task.title}</span>
                          <small>{task.dueLabel}</small>
                        </div>
                      ))}
                    </div>
                  </div>
                </article>
              ))}
            </section>
          </>
        ) : null}

        {view === "Plans" ? <PlanView plan={plan} onActivate={activatePlan} confirming={confirming} /> : null}
        {view === "Inbox" ? <InboxView workspace={workspace} /> : null}
        {view === "Profile" ? <ProfileView workspace={workspace} /> : null}
        {view === "Settings" ? <SettingsView workspace={workspace} /> : null}
      </section>
    </main>
  );
}

function PlanView({ plan, onActivate, confirming }: { plan: WorkspaceSnapshot["activePlan"]; onActivate: () => Promise<void>; confirming: boolean }) {
  return <div className="content-stack">
    <section className="card plan-detail-card">
      <div className="split-heading"><div><p className="eyebrow">Plan v{plan.version}</p><h2>{plan.title}</h2></div><span className="plan-state">{plan.status}</span></div>
      <p className="location-copy">{plan.location} · {plan.dates}</p>
      <h3>Assumptions to correct if needed</h3>
      <ul className="compact-list">{plan.assumptions.map((item) => <li key={item}>{item}</li>)}</ul>
      {plan.status === "draft" ? <button className="primary-button" disabled={confirming} onClick={() => void onActivate()}>Confirm complete Plan</button> : null}
    </section>
    <section className="card"><p className="eyebrow">Sources</p>{plan.sources.map((source) => <a className="source-link" href={source.url} key={source.title} target="_blank" rel="noreferrer"><strong>{source.title}</strong><span>{source.authority} · {source.retrievedAt}</span></a>)}</section>
  </div>;
}

function InboxView({ workspace }: { workspace: WorkspaceSnapshot }) {
  return <section className="content-stack">{workspace.inbox.map((item) => <article className={`inbox-item ${item.tone}`} key={item.id}><span className="inbox-time">{item.timestamp}</span><h2>{item.title}</h2><p>{item.body}</p></article>)}</section>;
}

function ProfileView({ workspace }: { workspace: WorkspaceSnapshot }) {
  return <section className="card profile-view"><p className="eyebrow">Long-term information</p><h2>Profile is intentionally incomplete</h2><dl><div><dt>Preferred language</dt><dd>{workspace.profile.preferredLanguage}</dd></div><div><dt>Nationality</dt><dd>{workspace.profile.nationality}</dd></div><div><dt>Readiness</dt><dd>{workspace.profile.status}</dd></div></dl><p>Only confirmed long-term facts belong here. This demo does not save edits yet.</p></section>;
}

function SettingsView({ workspace }: { workspace: WorkspaceSnapshot }) {
  return <section className="card settings-view"><p className="eyebrow">Connection status</p><h2>Services are separated from the product UI</h2><div className="status-grid">{Object.entries(workspace.system).map(([name, status]) => <div key={name}><span>{name}</span><strong>{status.replaceAll("_", " ")}</strong></div>)}</div><p>Runtime login, Telegram pairing, Amap configuration, and persistent storage are intentionally not connected in this first local demo.</p></section>;
}

export default App;
