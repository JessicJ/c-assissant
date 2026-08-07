import { useEffect, useMemo, useState } from "react";
import "./manual-accommodation.css";
import type { RuntimeCheck } from "@c-assistant/agent-adapters";
import { createAmapDrivingHandoff } from "@c-assistant/connectors";
import type { AmapNearbyPlace, AmapPlace, AmapRoute, ConnectorResult, QWeatherWeatherSnapshot, TelegramBotIdentity, TelegramConfiguration } from "@c-assistant/connectors";
import type { WorkspaceSnapshot } from "@c-assistant/core";
import { recommendPlanTransport } from "@c-assistant/core/transport";

type View = "Today" | "Plans" | "Inbox" | "Profile" | "Settings";
type RouteMode = AmapRoute["mode"];
type RouteComparisons = Partial<Record<RouteMode, ConnectorResult<AmapRoute>>>;

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
  const [routeOrigin, setRouteOrigin] = useState<AmapPlace | null>(null);
  const [routeDestination, setRouteDestination] = useState<AmapPlace | null>(null);
  const [routeMode, setRouteMode] = useState<RouteMode>("driving");
  const [routeResult, setRouteResult] = useState<ConnectorResult<AmapRoute> | null>(null);
  const [routing, setRouting] = useState(false);
  const [routeComparisons, setRouteComparisons] = useState<RouteComparisons | null>(null);
  const [comparingRoutes, setComparingRoutes] = useState(false);
  const [foodCentre, setFoodCentre] = useState<AmapPlace | null>(null);
  const [foodResult, setFoodResult] = useState<ConnectorResult<AmapNearbyPlace[]> | null>(null);
  const [findingFood, setFindingFood] = useState(false);
  const [stayCentre, setStayCentre] = useState<AmapPlace | null>(null);
  const [stayResult, setStayResult] = useState<ConnectorResult<AmapNearbyPlace[]> | null>(null);
  const [findingStay, setFindingStay] = useState(false);
  const [savingAccommodation, setSavingAccommodation] = useState(false);
  const [confirmingAccommodation, setConfirmingAccommodation] = useState(false);
  const [savingTransportPreference, setSavingTransportPreference] = useState(false);
  const [savingTravelContext, setSavingTravelContext] = useState(false);
  const [savingArrival, setSavingArrival] = useState(false);
  const [weatherLocation, setWeatherLocation] = useState("Shanghai");
  const [weatherResult, setWeatherResult] = useState<ConnectorResult<QWeatherWeatherSnapshot> | null>(null);
  const [checkingWeather, setCheckingWeather] = useState(false);
  const [planWeather, setPlanWeather] = useState<{ planId: string; result: ConnectorResult<QWeatherWeatherSnapshot> } | null>(null);
  const [checkingPlanWeather, setCheckingPlanWeather] = useState(false);
  const [codexRuntime, setCodexRuntime] = useState<RuntimeCheck | null>(null);
  const [telegramStatus, setTelegramStatus] = useState<ConnectorResult<TelegramConfiguration> | null>(null);
  const [telegramVerification, setTelegramVerification] = useState<ConnectorResult<TelegramBotIdentity> | null>(null);
  const [verifyingTelegram, setVerifyingTelegram] = useState(false);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    void loadWorkspace();
    void loadCodexRuntime();
    void loadTelegramStatus();
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

  async function loadTelegramStatus() {
    try {
      const response = await fetch("/api/connectors/telegram");
      setTelegramStatus((await response.json()) as ConnectorResult<TelegramConfiguration>);
    } catch {
      setTelegramStatus({ status: "unavailable", provider: "telegram", observedAt: new Date().toISOString(), failure: { code: "network_error", message: "Telegram status could not be reached right now.", retryable: true } });
    }
  }

  async function verifyTelegram() {
    try {
      setVerifyingTelegram(true);
      const response = await fetch("/api/connectors/telegram/verify", { method: "POST" });
      setTelegramVerification((await response.json()) as ConnectorResult<TelegramBotIdentity>);
    } catch {
      setTelegramVerification({ status: "unavailable", provider: "telegram", observedAt: new Date().toISOString(), failure: { code: "network_error", message: "Telegram could not be reached right now.", retryable: true } });
    } finally {
      setVerifyingTelegram(false);
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

  async function fetchAmapRoute(mode: RouteMode, origin: AmapPlace, destination: AmapPlace): Promise<ConnectorResult<AmapRoute>> {
    try {
      const query = new URLSearchParams({
        origin: origin.location,
        destination: destination.location
      });
      const endpoint = `/api/amap/routes/${mode}`;
      if (mode === "transit") {
        if (origin.cityCode) query.set("originCityCode", origin.cityCode);
        if (destination.cityCode) query.set("destinationCityCode", destination.cityCode);
      } else {
        if (origin.id) query.set("originId", origin.id);
        if (destination.id) query.set("destinationId", destination.id);
      }
      const response = await fetch(`${endpoint}?${query}`);
      return (await response.json()) as ConnectorResult<AmapRoute>;
    } catch {
      return { status: "unavailable", provider: "amap", observedAt: new Date().toISOString(), failure: { code: "network_error", message: "Amap could not be reached right now.", retryable: true } };
    }
  }

  async function planAmapRoute() {
    if (!routeOrigin || !routeDestination) return;
    try {
      setRouting(true);
      setRouteResult(await fetchAmapRoute(routeMode, routeOrigin, routeDestination));
    } finally {
      setRouting(false);
    }
  }

  async function compareAmapRoutes() {
    if (!routeOrigin || !routeDestination) return;
    try {
      setComparingRoutes(true);
      const modes: RouteMode[] = ["driving", "transit", "walking"];
      const results = await Promise.all(modes.map(async (mode) => [mode, await fetchAmapRoute(mode, routeOrigin, routeDestination)] as const));
      setRouteComparisons(Object.fromEntries(results) as RouteComparisons);
    } finally {
      setComparingRoutes(false);
    }
  }

  async function findNearbyFood(place: AmapPlace) {
    try {
      setFoodCentre(place);
      setFindingFood(true);
      const query = new URLSearchParams({ location: place.location });
      const response = await fetch(`/api/amap/nearby/restaurants?${query}`);
      setFoodResult((await response.json()) as ConnectorResult<AmapNearbyPlace[]>);
    } catch {
      setFoodResult({ status: "unavailable", provider: "amap", observedAt: new Date().toISOString(), failure: { code: "network_error", message: "Amap could not be reached right now.", retryable: true } });
    } finally {
      setFindingFood(false);
    }
  }

  async function findNearbyAccommodation(place: AmapPlace) {
    try {
      setStayCentre(place);
      setFindingStay(true);
      const query = new URLSearchParams({ location: place.location });
      const response = await fetch(`/api/amap/nearby/accommodation?${query}`);
      setStayResult((await response.json()) as ConnectorResult<AmapNearbyPlace[]>);
    } catch {
      setStayResult({ status: "unavailable", provider: "amap", observedAt: new Date().toISOString(), failure: { code: "network_error", message: "Amap could not be reached right now.", retryable: true } });
    } finally {
      setFindingStay(false);
    }
  }

  async function saveAccommodationCandidate(place: AmapNearbyPlace) {
    if (!workspace) return;
    try {
      setSavingAccommodation(true);
      const response = await fetch(`/api/plans/${workspace.activePlan.id}/accommodation`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "candidate", id: place.id, name: place.name, address: place.address, location: place.location, source: "amap" })
      });
      if (!response.ok) throw new Error((await response.json() as { error?: string }).error ?? "The accommodation candidate could not be saved.");
      setWorkspace((await response.json()) as WorkspaceSnapshot);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The accommodation candidate could not be saved.");
    } finally {
      setSavingAccommodation(false);
    }
  }

  async function saveManualAccommodation(input: { name: string; address: string; status: "candidate" | "confirmed" }) {
    if (!workspace) return;
    try {
      setSavingAccommodation(true);
      const response = await fetch(`/api/plans/${workspace.activePlan.id}/accommodation/manual`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input)
      });
      const payload = await response.json() as WorkspaceSnapshot | { error?: string; failure?: { message?: string } };
      if (!response.ok) throw new Error("error" in payload ? payload.error ?? payload.failure?.message ?? "The accommodation could not be saved." : "The accommodation could not be saved.");
      setWorkspace(payload as WorkspaceSnapshot);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The accommodation could not be saved.");
    } finally {
      setSavingAccommodation(false);
    }
  }

  async function confirmAccommodationBooking() {
    if (!workspace) return;
    const accommodation = workspace.activePlan.configuration.accommodation;
    if (accommodation.status !== "candidate" || !accommodation.name || !accommodation.address || !accommodation.location) return;
    try {
      setConfirmingAccommodation(true);
      const response = await fetch(`/api/plans/${workspace.activePlan.id}/accommodation`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "confirmed", id: accommodation.id, name: accommodation.name, address: accommodation.address, location: accommodation.location, source: accommodation.source ?? "user" })
      });
      if (!response.ok) throw new Error((await response.json() as { error?: string }).error ?? "The accommodation could not be confirmed.");
      setWorkspace((await response.json()) as WorkspaceSnapshot);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The accommodation could not be confirmed.");
    } finally {
      setConfirmingAccommodation(false);
    }
  }

  async function saveTransportPreference(preference: WorkspaceSnapshot["activePlan"]["configuration"]["transport"]["preference"]) {
    if (!workspace) return;
    try {
      setSavingTransportPreference(true);
      const response = await fetch(`/api/plans/${workspace.activePlan.id}/transport-preference`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ preference })
      });
      if (!response.ok) throw new Error((await response.json() as { error?: string }).error ?? "The transport preference could not be saved.");
      setWorkspace((await response.json()) as WorkspaceSnapshot);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The transport preference could not be saved.");
    } finally {
      setSavingTransportPreference(false);
    }
  }

  async function saveTravelContext(context: WorkspaceSnapshot["activePlan"]["configuration"]["travelContext"]) {
    if (!workspace) return;
    try {
      setSavingTravelContext(true);
      const response = await fetch(`/api/plans/${workspace.activePlan.id}/travel-context`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(context)
      });
      if (!response.ok) throw new Error((await response.json() as { error?: string }).error ?? "The travel context could not be saved.");
      setWorkspace((await response.json()) as WorkspaceSnapshot);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The travel context could not be saved.");
    } finally {
      setSavingTravelContext(false);
    }
  }

  async function saveArrival(arrival: WorkspaceSnapshot["activePlan"]["configuration"]["arrival"]) {
    if (!workspace) return;
    try {
      setSavingArrival(true);
      const response = await fetch(`/api/plans/${workspace.activePlan.id}/arrival`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(arrival)
      });
      if (!response.ok) throw new Error((await response.json() as { error?: string }).error ?? "The expected arrival could not be saved.");
      setWorkspace((await response.json()) as WorkspaceSnapshot);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The expected arrival could not be saved.");
    } finally {
      setSavingArrival(false);
    }
  }

  async function checkWeather() {
    if (!weatherLocation.trim()) return;
    try {
      setCheckingWeather(true);
      const response = await fetch(`/api/weather?${new URLSearchParams({ location: weatherLocation, language: "en" })}`);
      setWeatherResult((await response.json()) as ConnectorResult<QWeatherWeatherSnapshot>);
    } catch {
      setWeatherResult({ status: "unavailable", provider: "qweather", observedAt: new Date().toISOString(), failure: { code: "network_error", message: "QWeather could not be reached right now.", retryable: true } });
    } finally {
      setCheckingWeather(false);
    }
  }

  async function checkPlanWeather(planId: string, location: string) {
    try {
      setCheckingPlanWeather(true);
      const response = await fetch(`/api/weather?${new URLSearchParams({ location, language: "en" })}`);
      setPlanWeather({ planId, result: (await response.json()) as ConnectorResult<QWeatherWeatherSnapshot> });
    } catch {
      setPlanWeather({ planId, result: { status: "unavailable", provider: "qweather", observedAt: new Date().toISOString(), failure: { code: "network_error", message: "QWeather could not be reached right now.", retryable: true } } });
    } finally {
      setCheckingPlanWeather(false);
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

            {workspace.profile.status === "incomplete" ? <section className="card profile-prompt"><div><p className="eyebrow">First-use basics</p><h2>Make China guidance fit you from the start.</h2><p>Add your name, language, nationality, and—only if you are comfortable—your visa or residence status. You can change these later, and you can still create a Plan now.</p></div><button className="primary-button" onClick={() => setView("Profile")}>Set up my basics</button></section> : null}

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

        {view === "Plans" ? <PlanView plan={plan} onActivate={activatePlan} confirming={confirming} amapQuery={amapQuery} setAmapQuery={setAmapQuery} amapResult={amapResult} searchingAmap={searchingAmap} onSearch={searchAmap} routeOrigin={routeOrigin} routeDestination={routeDestination} routeMode={routeMode} routeResult={routeResult} routing={routing} routeComparisons={routeComparisons} comparingRoutes={comparingRoutes} planWeatherResult={planWeather?.planId === plan.id ? planWeather.result : null} checkingPlanWeather={checkingPlanWeather} foodCentre={foodCentre} foodResult={foodResult} findingFood={findingFood} stayCentre={stayCentre} stayResult={stayResult} findingStay={findingStay} savingAccommodation={savingAccommodation} confirmingAccommodation={confirmingAccommodation} savingTransportPreference={savingTransportPreference} savingTravelContext={savingTravelContext} savingArrival={savingArrival} onChooseRouteOrigin={(place) => { setRouteOrigin(place); setRouteResult(null); setRouteComparisons(null); }} onChooseRouteDestination={(place) => { setRouteDestination(place); setRouteResult(null); setRouteComparisons(null); }} onRouteModeChange={(mode) => { setRouteMode(mode); setRouteResult(null); }} onFindNearbyFood={findNearbyFood} onFindNearbyAccommodation={findNearbyAccommodation} onSaveAccommodationCandidate={saveAccommodationCandidate} onSaveManualAccommodation={saveManualAccommodation} onConfirmAccommodation={confirmAccommodationBooking} onSaveTransportPreference={saveTransportPreference} onSaveTravelContext={saveTravelContext} onSaveArrival={saveArrival} onPlanRoute={planAmapRoute} onCompareRoutes={compareAmapRoutes} onCheckPlanWeather={checkPlanWeather} /> : null}
        {view === "Inbox" ? <InboxView workspace={workspace} /> : null}
        {view === "Profile" ? <ProfileView workspace={workspace} onSave={saveProfile} /> : null}
        {view === "Settings" ? <SettingsView workspace={workspace} codexRuntime={codexRuntime} telegramStatus={telegramStatus} telegramVerification={telegramVerification} verifyingTelegram={verifyingTelegram} onVerifyTelegram={verifyTelegram} weatherLocation={weatherLocation} setWeatherLocation={setWeatherLocation} weatherResult={weatherResult} checkingWeather={checkingWeather} onCheckWeather={checkWeather} /> : null}
      </section>
    </main>
  );
}

function PlanView({ plan, onActivate, confirming, amapQuery, setAmapQuery, amapResult, searchingAmap, onSearch, routeOrigin, routeDestination, routeMode, routeResult, routing, routeComparisons, comparingRoutes, planWeatherResult, checkingPlanWeather, foodCentre, foodResult, findingFood, stayCentre, stayResult, findingStay, savingAccommodation, confirmingAccommodation, savingTransportPreference, savingTravelContext, savingArrival, onChooseRouteOrigin, onChooseRouteDestination, onRouteModeChange, onFindNearbyFood, onFindNearbyAccommodation, onSaveAccommodationCandidate, onSaveManualAccommodation, onConfirmAccommodation, onSaveTransportPreference, onSaveTravelContext, onSaveArrival, onPlanRoute, onCompareRoutes, onCheckPlanWeather }: { plan: WorkspaceSnapshot["activePlan"]; onActivate: () => Promise<void>; confirming: boolean; amapQuery: string; setAmapQuery: (value: string) => void; amapResult: ConnectorResult<AmapPlace[]> | null; searchingAmap: boolean; onSearch: () => Promise<void>; routeOrigin: AmapPlace | null; routeDestination: AmapPlace | null; routeMode: RouteMode; routeResult: ConnectorResult<AmapRoute> | null; routing: boolean; routeComparisons: RouteComparisons | null; comparingRoutes: boolean; planWeatherResult: ConnectorResult<QWeatherWeatherSnapshot> | null; checkingPlanWeather: boolean; foodCentre: AmapPlace | null; foodResult: ConnectorResult<AmapNearbyPlace[]> | null; findingFood: boolean; stayCentre: AmapPlace | null; stayResult: ConnectorResult<AmapNearbyPlace[]> | null; findingStay: boolean; savingAccommodation: boolean; confirmingAccommodation: boolean; savingTransportPreference: boolean; savingTravelContext: boolean; savingArrival: boolean; onChooseRouteOrigin: (place: AmapPlace) => void; onChooseRouteDestination: (place: AmapPlace) => void; onRouteModeChange: (mode: RouteMode) => void; onFindNearbyFood: (place: AmapPlace) => Promise<void>; onFindNearbyAccommodation: (place: AmapPlace) => Promise<void>; onSaveAccommodationCandidate: (place: AmapNearbyPlace) => Promise<void>; onSaveManualAccommodation: (input: { name: string; address: string; status: "candidate" | "confirmed" }) => Promise<void>; onConfirmAccommodation: () => Promise<void>; onSaveTransportPreference: (preference: WorkspaceSnapshot["activePlan"]["configuration"]["transport"]["preference"]) => Promise<void>; onSaveTravelContext: (context: WorkspaceSnapshot["activePlan"]["configuration"]["travelContext"]) => Promise<void>; onSaveArrival: (arrival: WorkspaceSnapshot["activePlan"]["configuration"]["arrival"]) => Promise<void>; onPlanRoute: () => Promise<void>; onCompareRoutes: () => Promise<void>; onCheckPlanWeather: (planId: string, location: string) => Promise<void> }) {
  const savedAccommodation = routePlaceFromAccommodation(plan.configuration.accommodation);
  return <div className="content-stack">
    <section className="card plan-detail-card">
      <div className="split-heading"><div><p className="eyebrow">Plan v{plan.version}</p><h2>{plan.title}</h2></div><span className="plan-state">{plan.status}</span></div>
      <p className="location-copy">{plan.location} · {plan.dates}</p>
      <AccommodationSummary accommodation={plan.configuration.accommodation} confirming={confirmingAccommodation} onConfirm={onConfirmAccommodation} />
      <ManualAccommodation saving={savingAccommodation} onSave={onSaveManualAccommodation} />
      <ArrivalTiming arrival={plan.configuration.arrival} saving={savingArrival} onSave={onSaveArrival} />
      <PlanWeather plan={plan} result={planWeatherResult} checking={checkingPlanWeather} onCheck={onCheckPlanWeather} />
      <TransportPreference preference={plan.configuration.transport.preference} saving={savingTransportPreference} onSave={onSaveTransportPreference} />
      <TravelContext context={plan.configuration.travelContext} saving={savingTravelContext} onSave={onSaveTravelContext} />
      <h3>Assumptions to correct if needed</h3>
      <ul className="compact-list">{plan.assumptions.map((item) => <li key={item}>{item}</li>)}</ul>
      {plan.status === "draft" ? <button className="primary-button" disabled={confirming} onClick={() => void onActivate()}>Confirm complete Plan</button> : null}
    </section>
    <PlaceDecisionPanel amapQuery={amapQuery} setAmapQuery={setAmapQuery} amapResult={amapResult} searchingAmap={searchingAmap} onSearch={onSearch} routeOrigin={routeOrigin} routeDestination={routeDestination} savedAccommodation={savedAccommodation} routeMode={routeMode} routeResult={routeResult} routing={routing} routeComparisons={routeComparisons} comparingRoutes={comparingRoutes} transportPreference={plan.configuration.transport.preference} travelContext={plan.configuration.travelContext} foodCentre={foodCentre} foodResult={foodResult} findingFood={findingFood} stayCentre={stayCentre} stayResult={stayResult} findingStay={findingStay} savingAccommodation={savingAccommodation} onChooseRouteOrigin={onChooseRouteOrigin} onChooseRouteDestination={onChooseRouteDestination} onRouteModeChange={onRouteModeChange} onFindNearbyFood={onFindNearbyFood} onFindNearbyAccommodation={onFindNearbyAccommodation} onSaveAccommodationCandidate={onSaveAccommodationCandidate} onPlanRoute={onPlanRoute} onCompareRoutes={onCompareRoutes} />
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

  return <section className="card profile-view"><p className="eyebrow">Long-term information</p><h2>Save only the basics you confirm</h2><form onSubmit={(event) => void submit(event)} className="profile-form"><label>Name<input value={profile.displayName} onChange={(event) => setProfile({ ...profile, displayName: event.target.value })} /></label><label>Preferred language<input value={profile.preferredLanguage} onChange={(event) => setProfile({ ...profile, preferredLanguage: event.target.value })} /></label><label>Nationality<input value={profile.nationality} onChange={(event) => setProfile({ ...profile, nationality: event.target.value })} /></label><label>Gender<select value={profile.gender} onChange={(event) => setProfile({ ...profile, gender: event.target.value as typeof profile.gender })}><option value="not_specified">Not specified</option><option value="woman">Woman</option><option value="man">Man</option><option value="nonbinary">Nonbinary</option><option value="prefer_not_to_say">Prefer not to say</option></select></label><label>China visa / residence status<select value={profile.immigrationStatus} onChange={(event) => setProfile({ ...profile, immigrationStatus: event.target.value as typeof profile.immigrationStatus })}><option value="unknown">Not sure yet</option><option value="short_term_visitor">Short-term visitor</option><option value="tourist_visa">Tourist visa</option><option value="student_visa">Student visa</option><option value="work_visa">Work visa</option><option value="residence_permit">Residence permit</option><option value="other">Other</option></select></label><p>These details help C-assistant later find the right policy route. Travel dates, companions, accommodation, and precise location remain inside a Plan, not this long-term Profile.</p><button className="primary-button" disabled={saving}>{saving ? "Saving…" : "Save confirmed Profile"}</button></form></section>;
}

function SettingsView({ workspace, codexRuntime, telegramStatus, telegramVerification, verifyingTelegram, onVerifyTelegram, weatherLocation, setWeatherLocation, weatherResult, checkingWeather, onCheckWeather }: { workspace: WorkspaceSnapshot; codexRuntime: RuntimeCheck | null; telegramStatus: ConnectorResult<TelegramConfiguration> | null; telegramVerification: ConnectorResult<TelegramBotIdentity> | null; verifyingTelegram: boolean; onVerifyTelegram: () => Promise<void>; weatherLocation: string; setWeatherLocation: (value: string) => void; weatherResult: ConnectorResult<QWeatherWeatherSnapshot> | null; checkingWeather: boolean; onCheckWeather: () => Promise<void> }) {
  const telegramConfigured = telegramStatus?.status === "available";
  return <section className="content-stack"><section className="card settings-view"><p className="eyebrow">Connection status</p><h2>Services are separated from the product UI</h2><div className="status-grid">{Object.entries(workspace.system).map(([name, status]) => <div key={name}><span>{name}</span><strong>{status.replaceAll("_", " ")}</strong></div>)}<div><span>Codex</span><strong>{codexRuntime?.installed && codexRuntime.authenticated ? "ready" : codexRuntime?.installed ? "login needed" : "not installed"}</strong></div><div><span>Telegram</span><strong>{telegramConfigured ? "configured" : telegramStatus?.status === "not_configured" ? "token needed" : telegramStatus?.status ?? "checking"}</strong></div></div><p>Codex creates a draft only after you press the explicit generation button. Telegram remains inactive until you configure and explicitly verify your own bot.</p></section><section className="card weather-card"><p className="eyebrow">QWeather facts</p><h2>Check what the destination weather reports.</h2><div className="amap-search"><input value={weatherLocation} onChange={(event) => setWeatherLocation(event.target.value)} aria-label="Check destination weather" placeholder="City or region" /><button className="primary-button" disabled={checkingWeather || !weatherLocation.trim()} onClick={() => void onCheckWeather()}>{checkingWeather ? "Checking…" : "Check weather"}</button></div>{weatherResult ? <WeatherResults result={weatherResult} /> : <p>Weather is a changing fact, not a promise. C-assistant will use it for cautious packing and route suggestions after a Plan is confirmed.</p>}</section><section className="card telegram-card"><p className="eyebrow">Telegram bot</p><h2>Verify the local bot without revealing its token.</h2>{telegramConfigured ? <><p>Verification makes one safe identity request. It does not pair a user, read messages, or send a notification.</p><button className="primary-button" disabled={verifyingTelegram} onClick={() => void onVerifyTelegram()}>{verifyingTelegram ? "Verifying…" : "Verify Telegram bot"}</button></> : <p>Add <code>TELEGRAM_BOT_TOKEN</code> to the local <code>.env</code> file, then restart the local service. The token is not shown in this workspace.</p>}{telegramVerification ? <TelegramVerification result={telegramVerification} /> : null}</section></section>;
}

function TelegramVerification({ result }: { result: ConnectorResult<TelegramBotIdentity> }) {
  if (result.status !== "available" || !result.data) return <p className="connector-message">{result.failure?.message ?? "Telegram is not available."} <code>{result.failure?.code}</code></p>;
  return <p className="success-copy">Verified as {result.data.username ? `@${result.data.username}` : result.data.firstName}. Pairing and reminders are the next step.</p>;
}

function PlanWeather({ plan, result, checking, onCheck }: { plan: WorkspaceSnapshot["activePlan"]; result: ConnectorResult<QWeatherWeatherSnapshot> | null; checking: boolean; onCheck: (planId: string, location: string) => Promise<void> }) {
  return <section className="plan-weather"><div><strong>Weather for this Plan</strong><span>Refresh current and three-day weather facts for {plan.location}. This does not change the Plan or schedule a reminder.</span></div><button className="secondary-button" disabled={checking} onClick={() => void onCheck(plan.id, plan.location)}>{checking ? "Refreshing…" : "Refresh Plan weather"}</button>{result ? <WeatherResults result={result} /> : null}</section>;
}

function WeatherResults({ result }: { result: ConnectorResult<QWeatherWeatherSnapshot> }) {
  if (result.status !== "available" || !result.data) return <p className="connector-message">{result.failure?.message ?? "QWeather is not available."} <code>{result.failure?.code}</code></p>;
  const { current, daily, location } = result.data;
  const rainy = current.precipitationMm > 0 || /rain|storm|shower|snow/i.test(current.condition) || daily.some((day) => day.precipitationMm > 0 || /rain|storm|shower|snow/i.test(day.conditionDay));
  const hot = daily.some((day) => day.highC >= 30 || day.uvIndex >= 7);
  return <div className="weather-results"><div className="weather-now"><strong>{location.name}{location.adminArea ? ` · ${location.adminArea}` : ""}</strong><span>{current.condition} · {current.temperatureC}°C, feels like {current.feelsLikeC}°C · humidity {current.humidityPercent}%</span><small>Observed {current.observedAt}</small></div><div className="weather-days">{daily.map((day) => <div key={day.date}><strong>{day.date}</strong><span>{day.conditionDay}</span><span>{day.lowC}–{day.highC}°C</span><small>{day.precipitationMm > 0 ? `${day.precipitationMm} mm precipitation` : `UV ${day.uvIndex}`}</small></div>)}</div>{rainy || hot ? <div className="weather-note"><strong>For your Plan</strong>{rainy ? <span>Rain is reported or forecast. Consider a compact umbrella and allow extra travel time.</span> : null}{hot ? <span>High temperature or UV is forecast. Consider water and sun protection.</span> : null}</div> : <p className="connector-message">No rain or heat-related packing prompt is derived from this short forecast.</p>}{result.data.attributionUrl ? <a className="source-link weather-source" href={result.data.attributionUrl} target="_blank" rel="noreferrer"><strong>Weather source</strong><span>Open QWeather details</span></a> : null}</div>;
}

function AccommodationSummary({ accommodation, confirming, onConfirm }: { accommodation: WorkspaceSnapshot["activePlan"]["configuration"]["accommodation"]; confirming: boolean; onConfirm: () => Promise<void> }) {
  if (accommodation.status === "not_set") return <p className="plan-accommodation"><strong>Accommodation</strong><span>Not saved yet. Compare nearby stays below when you know the area that matters for this Plan.</span></p>;
  if (accommodation.status === "confirmed") return <p className="plan-accommodation"><strong>Accommodation confirmed</strong><span>{accommodation.name} · {accommodation.address}</span><small>You confirmed that this stay is booked. It remains inside this Plan only.</small></p>;
  return <div className="plan-accommodation"><strong>Accommodation candidate</strong><span>{accommodation.name} · {accommodation.address}</span><small>Saved for this Plan only. It is not marked as booked.</small><button className="secondary-button" disabled={confirming} onClick={() => void onConfirm()}>{confirming ? "Confirming…" : "I have booked this stay"}</button></div>;
}

function ManualAccommodation({ saving, onSave }: { saving: boolean; onSave: (input: { name: string; address: string; status: "candidate" | "confirmed" }) => Promise<void> }) {
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [alreadyBooked, setAlreadyBooked] = useState(false);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim() || !address.trim()) return;
    void onSave({ name: name.trim(), address: address.trim(), status: alreadyBooked ? "confirmed" : "candidate" });
  }

  return <form className="plan-accommodation manual-accommodation-form" onSubmit={submit}><strong>Already chose a stay?</strong><span>Enter its name and address. C-assistant will use Amap only to verify a location for this Plan.</span><div><label>Stay name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Hotel, apartment, or residence" /></label><label>Address or area<input value={address} onChange={(event) => setAddress(event.target.value)} placeholder="Street address, district, or city" /></label></div><label className="checkbox-label"><input type="checkbox" checked={alreadyBooked} onChange={(event) => setAlreadyBooked(event.target.checked)} />I have already completed the booking elsewhere</label><button className="secondary-button" disabled={saving || !name.trim() || !address.trim()}>{saving ? "Saving…" : alreadyBooked ? "Save confirmed accommodation" : "Save accommodation candidate"}</button></form>;
}

function ArrivalTiming({ arrival, saving, onSave }: { arrival: WorkspaceSnapshot["activePlan"]["configuration"]["arrival"]; saving: boolean; onSave: (arrival: WorkspaceSnapshot["activePlan"]["configuration"]["arrival"]) => Promise<void> }) {
  const [expectedAtLocal, setExpectedAtLocal] = useState(arrival.expectedAtLocal ?? "");
  const [timeZone, setTimeZone] = useState(arrival.timeZone ?? "Asia/Shanghai");
  useEffect(() => {
    setExpectedAtLocal(arrival.expectedAtLocal ?? "");
    setTimeZone(arrival.timeZone ?? "Asia/Shanghai");
  }, [arrival]);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void onSave({ ...(expectedAtLocal ? { expectedAtLocal } : {}), ...(timeZone ? { timeZone } : {}) });
  }

  return <form className="plan-accommodation travel-context-form" onSubmit={submit}><strong>Expected first arrival</strong><span>Optional. This is the local time that later supports weather refresh and reminder timing. No reminder is scheduled yet.</span><div><label>Local date and time<input type="datetime-local" value={expectedAtLocal} onChange={(event) => setExpectedAtLocal(event.target.value)} /></label><label>Time zone<select value={timeZone} onChange={(event) => setTimeZone(event.target.value)}><option value="Asia/Shanghai">China Standard Time (Asia/Shanghai)</option></select></label></div><button className="secondary-button" disabled={saving}>{saving ? "Saving…" : expectedAtLocal ? "Save expected arrival" : "Clear expected arrival"}</button></form>;
}

function TransportPreference({ preference, saving, onSave }: { preference: WorkspaceSnapshot["activePlan"]["configuration"]["transport"]["preference"]; saving: boolean; onSave: (preference: WorkspaceSnapshot["activePlan"]["configuration"]["transport"]["preference"]) => Promise<void> }) {
  return <label className="plan-accommodation"><strong>Transport for this Plan</strong><span>Keep the default unless you have a clear preference. It will guide future route decisions, not start a trip.</span><select value={preference} disabled={saving} onChange={(event) => void onSave(event.target.value as typeof preference)}><option value="plan_recommended">Let C-assistant decide from the Plan</option><option value="taxi">Prefer taxi</option><option value="public_transit">Prefer public transit</option><option value="walking">Prefer walking when practical</option></select></label>;
}

function TravelContext({ context, saving, onSave }: { context: WorkspaceSnapshot["activePlan"]["configuration"]["travelContext"]; saving: boolean; onSave: (context: WorkspaceSnapshot["activePlan"]["configuration"]["travelContext"]) => Promise<void> }) {
  const [partySize, setPartySize] = useState(context.partySize?.toString() ?? "");
  const [luggage, setLuggage] = useState(context.luggage);
  useEffect(() => {
    setPartySize(context.partySize?.toString() ?? "");
    setLuggage(context.luggage);
  }, [context]);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsedPartySize = partySize.trim() ? Number(partySize) : undefined;
    void onSave({ ...(parsedPartySize === undefined ? {} : { partySize: parsedPartySize }), luggage });
  }

  return <form className="plan-accommodation travel-context-form" onSubmit={submit}><strong>Who is travelling in this Plan?</strong><span>Optional. Add this only if it should change transport choices.</span><div><label>People<input type="number" min="1" max="20" inputMode="numeric" value={partySize} onChange={(event) => setPartySize(event.target.value)} placeholder="Not specified" /></label><label>Luggage<select value={luggage} onChange={(event) => setLuggage(event.target.value as typeof luggage)}><option value="unknown">Not specified</option><option value="light">Light / carry-on only</option><option value="standard">Standard</option><option value="heavy">Heavy or multiple bags</option></select></label></div><button className="secondary-button" disabled={saving}>{saving ? "Saving…" : "Save travel context"}</button></form>;
}

function PlaceDecisionPanel({ amapQuery, setAmapQuery, amapResult, searchingAmap, onSearch, routeOrigin, routeDestination, savedAccommodation, routeMode, routeResult, routing, routeComparisons, comparingRoutes, transportPreference, travelContext, foodCentre, foodResult, findingFood, stayCentre, stayResult, findingStay, savingAccommodation, onChooseRouteOrigin, onChooseRouteDestination, onRouteModeChange, onFindNearbyFood, onFindNearbyAccommodation, onSaveAccommodationCandidate, onPlanRoute, onCompareRoutes }: { amapQuery: string; setAmapQuery: (value: string) => void; amapResult: ConnectorResult<AmapPlace[]> | null; searchingAmap: boolean; onSearch: () => Promise<void>; routeOrigin: AmapPlace | null; routeDestination: AmapPlace | null; savedAccommodation: AmapPlace | null; routeMode: RouteMode; routeResult: ConnectorResult<AmapRoute> | null; routing: boolean; routeComparisons: RouteComparisons | null; comparingRoutes: boolean; transportPreference: WorkspaceSnapshot["activePlan"]["configuration"]["transport"]["preference"]; travelContext: WorkspaceSnapshot["activePlan"]["configuration"]["travelContext"]; foodCentre: AmapPlace | null; foodResult: ConnectorResult<AmapNearbyPlace[]> | null; findingFood: boolean; stayCentre: AmapPlace | null; stayResult: ConnectorResult<AmapNearbyPlace[]> | null; findingStay: boolean; savingAccommodation: boolean; onChooseRouteOrigin: (place: AmapPlace) => void; onChooseRouteDestination: (place: AmapPlace) => void; onRouteModeChange: (mode: RouteMode) => void; onFindNearbyFood: (place: AmapPlace) => Promise<void>; onFindNearbyAccommodation: (place: AmapPlace) => Promise<void>; onSaveAccommodationCandidate: (place: AmapNearbyPlace) => Promise<void>; onPlanRoute: () => Promise<void>; onCompareRoutes: () => Promise<void> }) {
  return <section className="card amap-card"><p className="eyebrow">Plan place decisions</p><h2>Compare local facts before you decide where to stay or how to get there.</h2><div className="amap-search"><input value={amapQuery} onChange={(event) => setAmapQuery(event.target.value)} aria-label="Search places with Amap" /><button className="primary-button" disabled={searchingAmap || !amapQuery.trim()} onClick={() => void onSearch()}>{searchingAmap ? "Checking…" : "Search Amap"}</button></div>{amapResult ? <AmapResults result={amapResult} onChooseRouteOrigin={onChooseRouteOrigin} onChooseRouteDestination={onChooseRouteDestination} onFindNearbyFood={onFindNearbyFood} onFindNearbyAccommodation={onFindNearbyAccommodation} /> : <p>Search a venue, school, workplace, or district. Its location can then support accommodation, food, and transport decisions inside this Plan.</p>}<NearbyAccommodation centre={stayCentre} result={stayResult} finding={findingStay} saving={savingAccommodation} onSaveCandidate={onSaveAccommodationCandidate} /><NearbyFood centre={foodCentre} result={foodResult} finding={findingFood} /><RoutePlanner origin={routeOrigin} destination={routeDestination} savedAccommodation={savedAccommodation} mode={routeMode} result={routeResult} routing={routing} comparisons={routeComparisons} comparing={comparingRoutes} transportPreference={transportPreference} travelContext={travelContext} onChooseOrigin={onChooseRouteOrigin} onChooseDestination={onChooseRouteDestination} onModeChange={onRouteModeChange} onPlanRoute={onPlanRoute} onCompareRoutes={onCompareRoutes} /></section>;
}

function AmapResults({ result, onChooseRouteOrigin, onChooseRouteDestination, onFindNearbyFood, onFindNearbyAccommodation }: { result: ConnectorResult<AmapPlace[]>; onChooseRouteOrigin: (place: AmapPlace) => void; onChooseRouteDestination: (place: AmapPlace) => void; onFindNearbyFood: (place: AmapPlace) => Promise<void>; onFindNearbyAccommodation: (place: AmapPlace) => Promise<void> }) {
  if (result.status !== "available") return <p className="connector-message">{result.failure?.message ?? "Amap is not available."} <code>{result.failure?.code}</code></p>;
  if (!result.data?.length) return <p className="connector-message">Amap is connected but returned no matching places.</p>;
  return <div className="place-results">{result.data.map((place) => <div key={place.id}><strong>{place.name}</strong><span>{place.address} · {place.location}</span><div className="place-actions"><button className="text-button" onClick={() => onChooseRouteOrigin(place)}>Set as origin</button><button className="text-button" onClick={() => onChooseRouteDestination(place)}>Set as destination</button><button className="text-button" onClick={() => void onFindNearbyAccommodation(place)}>Find stays nearby</button><button className="text-button" onClick={() => void onFindNearbyFood(place)}>Find food nearby</button></div></div>)}</div>;
}

function NearbyAccommodation({ centre, result, finding, saving, onSaveCandidate }: { centre: AmapPlace | null; result: ConnectorResult<AmapNearbyPlace[]> | null; finding: boolean; saving: boolean; onSaveCandidate: (place: AmapNearbyPlace) => Promise<void> }) {
  if (!centre && !result) return null;
  return <div className="nearby-food"><p><strong>Stay options near {centre?.name ?? "this place"}</strong><span>Accommodation location facts from Amap. Compare the area, then complete any booking in your chosen service.</span></p>{finding ? <p className="connector-message">Checking nearby stays…</p> : null}{result?.status === "available" ? result.data?.length ? <div className="nearby-food-results">{result.data.map((place) => <div key={place.id}><strong>{place.name}</strong><span>{formatDistance(place.distanceMeters)} · {place.address}</span><button className="text-button" disabled={saving} onClick={() => void onSaveCandidate(place)}>{saving ? "Saving…" : "Keep as Plan stay candidate"}</button></div>)}</div> : <p className="connector-message">Amap found no nearby accommodation POIs.</p> : result ? <p className="connector-message">{result.failure?.message ?? "Amap is not available."} <code>{result.failure?.code}</code></p> : null}</div>;
}

function NearbyFood({ centre, result, finding }: { centre: AmapPlace | null; result: ConnectorResult<AmapNearbyPlace[]> | null; finding: boolean }) {
  if (!centre && !result) return null;
  return <div className="nearby-food"><p><strong>Food near {centre?.name ?? "this place"}</strong><span>Distance facts from Amap. These are not ranked recommendations.</span></p>{finding ? <p className="connector-message">Checking nearby food…</p> : null}{result?.status === "available" ? result.data?.length ? <div className="nearby-food-results">{result.data.map((place) => <div key={place.id}><strong>{place.name}</strong><span>{formatDistance(place.distanceMeters)} · {place.address}</span></div>)}</div> : <p className="connector-message">Amap found no nearby restaurant POIs.</p> : result ? <p className="connector-message">{result.failure?.message ?? "Amap is not available."} <code>{result.failure?.code}</code></p> : null}</div>;
}

function formatDistance(distanceMeters: number): string {
  return distanceMeters < 1_000 ? `${Math.round(distanceMeters)} m away` : `${(distanceMeters / 1_000).toFixed(1)} km away`;
}

function RoutePlanner({ origin, destination, savedAccommodation, mode, result, routing, comparisons, comparing, transportPreference, travelContext, onChooseOrigin, onChooseDestination, onModeChange, onPlanRoute, onCompareRoutes }: { origin: AmapPlace | null; destination: AmapPlace | null; savedAccommodation: AmapPlace | null; mode: RouteMode; result: ConnectorResult<AmapRoute> | null; routing: boolean; comparisons: RouteComparisons | null; comparing: boolean; transportPreference: WorkspaceSnapshot["activePlan"]["configuration"]["transport"]["preference"]; travelContext: WorkspaceSnapshot["activePlan"]["configuration"]["travelContext"]; onChooseOrigin: (place: AmapPlace) => void; onChooseDestination: (place: AmapPlace) => void; onModeChange: (mode: RouteMode) => void; onPlanRoute: () => Promise<void>; onCompareRoutes: () => Promise<void> }) {
  const resultMode = result?.status === "available" ? result.data?.mode : undefined;
  const handoff = resultMode === "driving" && origin && destination ? createAmapDrivingHandoff({ origin, destination }) : null;
  const modeLabel = mode === "driving" ? "driving" : mode === "walking" ? "walking" : "public-transit";
  const resultModeLabel = resultMode === "driving" ? "Driving" : resultMode === "walking" ? "Walking" : "Public transit";
  const recommendation = comparisons ? recommendPlanTransport({ preference: transportPreference, ...(travelContext.partySize !== undefined ? { partySize: travelContext.partySize } : {}), luggage: travelContext.luggage, routeFacts: Object.values(comparisons).flatMap((comparison) => comparison?.status === "available" && comparison.data ? [{ mode: comparison.data.mode, distanceMeters: comparison.data.distanceMeters, ...(comparison.data.durationSeconds !== undefined ? { durationSeconds: comparison.data.durationSeconds } : {}) }] : []) }) : null;
  return <div className="route-planner"><p><strong>Origin:</strong> {origin?.name ?? "Choose a place"}</p><p><strong>Destination:</strong> {destination?.name ?? "Choose a place"}</p>{savedAccommodation ? <div className="saved-route-place"><span>Saved Plan stay: <strong>{savedAccommodation.name}</strong></span><div className="place-actions"><button className="text-button" onClick={() => onChooseOrigin(savedAccommodation)}>Use as origin</button><button className="text-button" onClick={() => onChooseDestination(savedAccommodation)}>Use as destination</button></div></div> : null}<label className="route-mode"><span>Compare route type</span><select value={mode} disabled={routing || comparing} onChange={(event) => onModeChange(event.target.value as RouteMode)}><option value="driving">Driving / taxi</option><option value="transit">Public transit</option><option value="walking">Walking</option></select></label><div className="route-actions"><button className="secondary-button" disabled={!origin || !destination || routing || comparing} onClick={() => void onPlanRoute()}>{routing ? "Checking route…" : `Check ${modeLabel} route`}</button><button className="secondary-button" disabled={!origin || !destination || routing || comparing} onClick={() => void onCompareRoutes()}>{comparing ? "Comparing routes…" : "Compare all modes"}</button></div><RouteComparisonsView comparisons={comparisons} /><TransportRecommendationView recommendation={recommendation} />{result?.status === "available" && result.data ? <div className="route-result"><strong>{resultModeLabel} facts from Amap</strong><p>{formatRouteFact(result.data)}</p>{handoff ? <><a className="primary-button route-link" href={handoff.url}>Open driving route in Amap</a><small>Opening Amap is your choice. No ride is requested here.</small></> : <small>This is a route fact for your Plan. No trip, booking, or payment is started.</small>}</div> : result ? <p className="connector-message">{result.failure?.message ?? "Amap is not available."}</p> : null}</div>;
}

function RouteComparisonsView({ comparisons }: { comparisons: RouteComparisons | null }) {
  if (!comparisons) return null;
  const modes: RouteMode[] = ["driving", "transit", "walking"];
  const labels: Record<RouteMode, string> = { driving: "Driving / taxi", transit: "Public transit", walking: "Walking" };
  return <div className="route-comparisons"><strong>Available route facts</strong><span>These are comparisons, not a recommendation or a transaction.</span><div>{modes.map((mode) => { const result = comparisons[mode]; return <article key={mode}><strong>{labels[mode]}</strong>{result?.status === "available" && result.data ? <span>{formatRouteFact(result.data)}</span> : <small>{result?.failure?.message ?? "No route fact returned."}</small>}</article>; })}</div></div>;
}

function TransportRecommendationView({ recommendation }: { recommendation: ReturnType<typeof recommendPlanTransport> | null }) {
  if (!recommendation) return null;
  const label = recommendation.mode === "driving" ? "Driving / taxi" : recommendation.mode === "transit" ? "Public transit" : recommendation.mode === "walking" ? "Walking" : "No preliminary choice";
  return <div className="transport-recommendation"><strong>Preliminary Plan choice: {label}</strong><ul>{recommendation.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul><small>{recommendation.limitations[0]}</small></div>;
}

function formatRouteFact(route: AmapRoute): string {
  return `${(route.distanceMeters / 1000).toFixed(1)} km${route.durationSeconds !== undefined ? ` · about ${Math.ceil(route.durationSeconds / 60)} min` : ""}${route.taxiCostYuan !== undefined ? ` · estimated taxi ¥${route.taxiCostYuan}` : ""}${route.transitCostYuan !== undefined ? ` · transit fare ¥${route.transitCostYuan}` : ""}`;
}

function routePlaceFromAccommodation(accommodation: WorkspaceSnapshot["activePlan"]["configuration"]["accommodation"]): AmapPlace | null {
  if (accommodation.status === "not_set" || !accommodation.name || !accommodation.address || !accommodation.location) return null;
  return {
    id: accommodation.id ?? "",
    name: accommodation.name,
    address: accommodation.address,
    location: accommodation.location,
    type: "Plan accommodation",
    city: "",
    district: ""
  };
}

export default App;
