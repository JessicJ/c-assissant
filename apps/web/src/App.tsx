import { useEffect, useMemo, useState } from "react";
import type { RuntimeCheck } from "@c-assistant/agent-adapters";
import type { AmapPlace, ConnectorResult } from "@c-assistant/connectors";
import type { WorkspaceSnapshot } from "@c-assistant/core";

type View = "Today" | "Plans" | "Inbox" | "Profile" | "Settings";

const navigation: View[] = ["Today", "Plans", "Inbox", "Profile", "Settings"];

function App() {
  const [workspace, setWorkspace] = useState<WorkspaceSnapshot | null>(null);
  const [view, setView] = useState<View>("Today");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [requestText, setRequestText] = useState("");
  const [creating, setCreating] = useState(false);
  const [amapQuery, setAmapQuery] = useState("Shanghai Railway Station");
  const [amapResult, setAmapResult] = useState<ConnectorResult<AmapPlace[]> | null>(null);
  const [searchingAmap, setSearchingAmap] = useState(false);
  const [codexRuntime, setCodexRuntime] = useState<RuntimeCheck | null>(null);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    void loadWorkspace();
    void loadCodexRuntime();
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

  async function loadCodexRuntime() {
    try {
      const response = await fetch("/api/runtimes/codex");
      if (response.ok) setCodexRuntime((await response.json()) as RuntimeCheck);
    } catch {
      setCodexRuntime(null);
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

  async function createPlan() {
    if (!requestText.trim()) return;
    try {
      setCreating(true);
      const response = await fetch("/api/plans", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ request: requestText })
      });
      if (!response.ok) throw new Error((await response.json() as { error?: string }).error ?? "The Plan could not be saved.");
      setWorkspace((await response.json()) as WorkspaceSnapshot);
      setRequestText("");
      setView("Plans");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The Plan could not be saved.");
    } finally {
      setCreating(false);
    }
  }

  async function generatePlanWithCodex() {
    if (!requestText.trim()) return;
    try {
      setGenerating(true);
      const response = await fetch("/api/plans/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ request: requestText })
      });
      if (!response.ok) throw new Error((await response.json() as { error?: string }).error ?? "Codex could not generate a Plan.");
      setWorkspace((await response.json()) as WorkspaceSnapshot);
      setRequestText("");
      setView("Plans");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Codex could not generate a Plan.");
    } finally {
      setGenerating(false);
    }
  }

  async function saveProfile(profile: WorkspaceSnapshot["profile"]) {
    try {
      const response = await fetch("/api/profile", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(profile)
      });
      if (!response.ok) throw new Error((await response.json() as { error?: string }).error ?? "The Profile could not be saved.");
      setWorkspace((await response.json()) as WorkspaceSnapshot);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The Profile could not be saved.");
    }
  }

  async function searchAmap() {
    if (!amapQuery.trim()) return;
    try {
      setSearchingAmap(true);
      const response = await fetch(`/api/amap/places?${new URLSearchParams({ query: amapQuery, region: "上海市" })}`);
      setAmapResult((await response.json()) as ConnectorResult<AmapPlace[]>);
    } catch {
      setAmapResult({ status: "unavailable", provider: "amap", observedAt: new Date().toISOString(), failure: { code: "network_error", message: "Amap could not be reached right now.", retryable: true } });
    } finally {
      setSearchingAmap(false);
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

            <section className="card create-plan-card">
              <div>
                <p className="eyebrow">Create another Plan</p>
                <h2>Describe what you need in China.</h2>
                <p>This saves a local draft with transparent assumptions. Agent-generated detail comes in the next phase.</p>
              </div>
              <label className="request-field">
                <span className="sr-only">Describe your plan</span>
                <textarea value={requestText} onChange={(event) => setRequestText(event.target.value)} placeholder="For example: I will study in Hangzhou from September 2026." rows={3} />
              </label>
              <div className="plan-actions"><button className="secondary-button" disabled={creating || generating || !requestText.trim()} onClick={() => void createPlan()}>{creating ? "Saving…" : "Create local template"}</button><button className="primary-button" disabled={creating || generating || !requestText.trim()} onClick={() => void generatePlanWithCodex()}>{generating ? "Codex is drafting…" : "Draft complete Plan with Codex"}</button></div>
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
        {view === "Profile" ? <ProfileView workspace={workspace} onSave={saveProfile} /> : null}
        {view === "Settings" ? <SettingsView workspace={workspace} codexRuntime={codexRuntime} amapQuery={amapQuery} setAmapQuery={setAmapQuery} amapResult={amapResult} searchingAmap={searchingAmap} onSearch={searchAmap} /> : null}
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
    <section className="card"><p className="eyebrow">Sources</p>{plan.sources.length ? plan.sources.map((source) => <a className="source-link" href={source.url} key={source.title} target="_blank" rel="noreferrer"><strong>{source.title}</strong><span>{source.authority} · {source.retrievedAt}</span></a>) : <p>No source snapshots yet. Official sources are added when the policy connector is implemented.</p>}</section>
  </div>;
}

function InboxView({ workspace }: { workspace: WorkspaceSnapshot }) {
  return <section className="content-stack">{workspace.inbox.map((item) => <article className={`inbox-item ${item.tone}`} key={item.id}><span className="inbox-time">{item.timestamp}</span><h2>{item.title}</h2><p>{item.body}</p></article>)}</section>;
}

function ProfileView({ workspace, onSave }: { workspace: WorkspaceSnapshot; onSave: (profile: WorkspaceSnapshot["profile"]) => Promise<void> }) {
  const [profile, setProfile] = useState(workspace.profile);
  const [saving, setSaving] = useState(false);

  useEffect(() => setProfile(workspace.profile), [workspace.profile]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    await onSave(profile);
    setSaving(false);
  }

  return <section className="card profile-view"><p className="eyebrow">Long-term information</p><h2>Save only the basics you confirm</h2><form onSubmit={(event) => void submit(event)} className="profile-form"><label>Name<input value={profile.displayName} onChange={(event) => setProfile({ ...profile, displayName: event.target.value })} /></label><label>Preferred language<input value={profile.preferredLanguage} onChange={(event) => setProfile({ ...profile, preferredLanguage: event.target.value })} /></label><label>Nationality<input value={profile.nationality} onChange={(event) => setProfile({ ...profile, nationality: event.target.value })} /></label><p>Travel dates, companions, accommodation, and precise location remain inside a Plan, not this long-term Profile.</p><button className="primary-button" disabled={saving}>{saving ? "Saving…" : "Save confirmed Profile"}</button></form></section>;
}

function SettingsView({ workspace, codexRuntime, amapQuery, setAmapQuery, amapResult, searchingAmap, onSearch }: { workspace: WorkspaceSnapshot; codexRuntime: RuntimeCheck | null; amapQuery: string; setAmapQuery: (value: string) => void; amapResult: ConnectorResult<AmapPlace[]> | null; searchingAmap: boolean; onSearch: () => Promise<void> }) {
  return <section className="content-stack"><section className="card settings-view"><p className="eyebrow">Connection status</p><h2>Services are separated from the product UI</h2><div className="status-grid">{Object.entries(workspace.system).map(([name, status]) => <div key={name}><span>{name}</span><strong>{status.replaceAll("_", " ")}</strong></div>)}<div><span>Codex</span><strong>{codexRuntime?.installed && codexRuntime.authenticated ? "ready" : codexRuntime?.installed ? "login needed" : "not installed"}</strong></div></div><p>Codex creates a draft only after you press the explicit generation button. Telegram pairing, official sources, and action handoff remain deliberately disconnected.</p></section><section className="card amap-card"><p className="eyebrow">Amap fact check</p><h2>Search a place without exposing the Key.</h2><div className="amap-search"><input value={amapQuery} onChange={(event) => setAmapQuery(event.target.value)} aria-label="Search places with Amap" /><button className="primary-button" disabled={searchingAmap || !amapQuery.trim()} onClick={() => void onSearch()}>{searchingAmap ? "Checking…" : "Search Amap"}</button></div>{amapResult ? <AmapResults result={amapResult} /> : <p>Use this only to validate your Web Service API key and inspect location facts. It does not order, book, or navigate.</p>}</section></section>;
}

function AmapResults({ result }: { result: ConnectorResult<AmapPlace[]> }) {
  if (result.status !== "available") return <p className="connector-message">{result.failure?.message ?? "Amap is not available."} <code>{result.failure?.code}</code></p>;
  if (!result.data?.length) return <p className="connector-message">Amap is connected but returned no matching places.</p>;
  return <div className="place-results">{result.data.map((place) => <div key={place.id}><strong>{place.name}</strong><span>{place.address} · {place.location}</span></div>)}</div>;
}

export default App;
