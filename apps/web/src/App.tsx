import { useEffect, useMemo, useState } from "react";
import "./manual-accommodation.css";
import landiLogoUrl from "../../../assets/branding/landi-round-otter-earth-icon-final.png";
import type { RuntimeCheck } from "@c-assistant/agent-adapters";
import { runTransportPlannerSkill, runWeatherAndPackingSkill, type HousingAreaSkillResult, type TransportPlannerSkillResult } from "@c-assistant/china-country-pack";
import { createAmapDrivingHandoff, createAmapPlaceHandoff } from "@c-assistant/connectors";
import type { AmapNearbyPlace, AmapPlace, AmapRoute, ConnectorResult, OfficialSourceDefinition, QWeatherWeatherSnapshot, TelegramBotIdentity, TelegramConfiguration } from "@c-assistant/connectors";
import type { AgentRun, AgentRuntimeKind, PolicyPreparationAssessment, SourceSnapshotWriteResult, Task, WorkspaceSnapshot } from "@c-assistant/core";
import type { TransportWeatherFact } from "@c-assistant/core/transport";

type View = "Today" | "Plans" | "Inbox" | "Settings";
type RouteMode = AmapRoute["mode"];
type RouteComparisons = Partial<Record<RouteMode, ConnectorResult<AmapRoute>>>;
type AccommodationDiscoveryResult = ConnectorResult<AmapNearbyPlace[]> & { skill?: HousingAreaSkillResult };
type MatchedTransportWeather = TransportWeatherFact & { observedAt: string };
type ChatMode = "new_plan" | "revise_plan";
type ChatMessage = { id: string; role: "user" | "assistant"; text: string };
type LocalConfiguration = {
  amap: { configured: boolean };
  qweather: { configured: boolean; host: string };
  telegram: { configured: boolean };
};
type LocalConfigurationForm = { amapApiKey: string; qweatherApiKey: string; qweatherApiHost: string; telegramBotToken: string };
type TelegramPairingView = {
  state: "not_paired" | "waiting_for_start" | "paired";
  code?: string;
  expiresAt?: string;
  botUsername?: string;
  deepLink?: string;
  foundStart?: boolean;
  confirmationMessageSent?: boolean;
  binding?: { firstName: string; username?: string; pairedAt: string };
};
type ChinaPlanPreparationView =
  | { status: "saved"; message: string; workspace: WorkspaceSnapshot; taskCount: number; reminderCount: number; sources: Array<{ sourceId: string; status: "ready" | "unavailable" }> }
  | { status: "blocked"; stage: "source_preparation" | "compilation"; reasonCode: string; message: string; actionItems: string[]; sources: Array<{ sourceId: string; status: "ready" | "unavailable" }> };
type DatabaseMaintenanceView = { schemaVersion: number; latestSchemaVersion: number; integrity: "ok" | "failed"; migrations: Array<{ version: number; name: string; appliedAt: string }> };
type DatabaseBackupView = { path: string; fileName: string; createdAt: string; schemaVersion: number; integrity: "ok" };

const navigation: View[] = ["Today", "Plans", "Inbox", "Settings"];

function App() {
  const [workspace, setWorkspace] = useState<WorkspaceSnapshot | null>(null);
  const [view, setView] = useState<View>("Today");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [requestText, setRequestText] = useState("");
  const [creating, setCreating] = useState(false);
  const [agentInput, setAgentInput] = useState("");
  const [agentMode, setAgentMode] = useState<ChatMode>("new_plan");
  const [agentBusy, setAgentBusy] = useState(false);
  const [agentMessages, setAgentMessages] = useState<ChatMessage[]>([
    { id: "agent-welcome", role: "assistant", text: "Hi — tell me what you need for China. I can turn it into a complete Plan, or revise the current draft when you want to correct something." }
  ]);
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
  const [stayResult, setStayResult] = useState<AccommodationDiscoveryResult | null>(null);
  const [findingStay, setFindingStay] = useState(false);
  const [savingAccommodation, setSavingAccommodation] = useState(false);
  const [confirmingAccommodation, setConfirmingAccommodation] = useState(false);
  const [savingTransportPreference, setSavingTransportPreference] = useState(false);
  const [savingTravelContext, setSavingTravelContext] = useState(false);
  const [savingArrival, setSavingArrival] = useState(false);
  const [cancellingReminderTaskId, setCancellingReminderTaskId] = useState<string | null>(null);
  const [weatherLocation, setWeatherLocation] = useState("Shanghai");
  const [weatherResult, setWeatherResult] = useState<ConnectorResult<QWeatherWeatherSnapshot> | null>(null);
  const [checkingWeather, setCheckingWeather] = useState(false);
  const [planWeather, setPlanWeather] = useState<{ planId: string; result: ConnectorResult<QWeatherWeatherSnapshot> } | null>(null);
  const [checkingPlanWeather, setCheckingPlanWeather] = useState(false);
  const [runtimeChecks, setRuntimeChecks] = useState<RuntimeCheck[]>([]);
  const [configuration, setConfiguration] = useState<LocalConfiguration | null>(null);
  const [configurationForm, setConfigurationForm] = useState<LocalConfigurationForm>({ amapApiKey: "", qweatherApiKey: "", qweatherApiHost: "", telegramBotToken: "" });
  const [savingConfiguration, setSavingConfiguration] = useState(false);
  const [refreshingRuntimes, setRefreshingRuntimes] = useState(false);
  const [agentRuns, setAgentRuns] = useState<AgentRun[]>([]);
  const [savingRuntime, setSavingRuntime] = useState(false);
  const [officialSources, setOfficialSources] = useState<OfficialSourceDefinition[]>([]);
  const [refreshingSourceId, setRefreshingSourceId] = useState<string | null>(null);
  const [linkingSourceSnapshotId, setLinkingSourceSnapshotId] = useState<string | null>(null);
  const [policyPreparation, setPolicyPreparation] = useState<PolicyPreparationAssessment | null>(null);
  const [telegramStatus, setTelegramStatus] = useState<ConnectorResult<TelegramConfiguration> | null>(null);
  const [telegramVerification, setTelegramVerification] = useState<ConnectorResult<TelegramBotIdentity> | null>(null);
  const [verifyingTelegram, setVerifyingTelegram] = useState(false);
  const [telegramPairing, setTelegramPairing] = useState<TelegramPairingView | null>(null);
  const [pairingTelegram, setPairingTelegram] = useState(false);
  const [disconnectingTelegram, setDisconnectingTelegram] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [preparingChinaPlan, setPreparingChinaPlan] = useState(false);
  const [chinaPlanPreparation, setChinaPlanPreparation] = useState<ChinaPlanPreparationView | null>(null);

  useEffect(() => {
    void loadWorkspace();
    void loadRuntimeChecks();
    void loadConfiguration();
    void loadAgentRuns();
    void loadOfficialSources();
    void loadPolicyPreparation();
    void loadTelegramStatus();
    void loadTelegramPairing();
  }, []);

  useEffect(() => setChinaPlanPreparation(null), [workspace?.activePlan.id]);

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

  async function loadRuntimeChecks() {
    try {
      const response = await fetch("/api/runtimes");
      if (response.ok) setRuntimeChecks((await response.json()) as RuntimeCheck[]);
    } catch {
      setRuntimeChecks([]);
    }
  }

  async function loadConfiguration() {
    try {
      const response = await fetch("/api/configuration");
      if (response.ok) setConfiguration((await response.json()) as LocalConfiguration);
    } catch {
      setConfiguration(null);
    }
  }

  async function refreshRuntimes() {
    try {
      setRefreshingRuntimes(true);
      await loadRuntimeChecks();
    } finally {
      setRefreshingRuntimes(false);
    }
  }

  async function saveConfiguration() {
    try {
      setSavingConfiguration(true);
      const response = await fetch("/api/configuration", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(configurationForm)
      });
      if (!response.ok) throw new Error((await response.json() as { error?: string }).error ?? "Local configuration could not be saved.");
      setConfiguration((await response.json()) as LocalConfiguration);
      setConfigurationForm({ amapApiKey: "", qweatherApiKey: "", qweatherApiHost: "", telegramBotToken: "" });
      await loadTelegramStatus();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Local configuration could not be saved.");
    } finally {
      setSavingConfiguration(false);
    }
  }

  async function loadAgentRuns() {
    try {
      const response = await fetch("/api/runs");
      if (response.ok) setAgentRuns((await response.json()) as AgentRun[]);
    } catch {
      setAgentRuns([]);
    }
  }

  async function loadOfficialSources() {
    try {
      const response = await fetch("/api/official-sources");
      const result = (await response.json()) as ConnectorResult<OfficialSourceDefinition[]>;
      setOfficialSources(result.status === "available" && result.data ? result.data : []);
    } catch {
      setOfficialSources([]);
    }
  }

  async function loadPolicyPreparation() {
    try {
      const response = await fetch("/api/policy-applicability");
      if (response.ok) setPolicyPreparation((await response.json()) as PolicyPreparationAssessment);
    } catch {
      setPolicyPreparation(null);
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

  async function loadTelegramPairing() {
    try {
      const response = await fetch("/api/connectors/telegram/pairing");
      if (response.ok) setTelegramPairing((await response.json()) as TelegramPairingView);
    } catch {
      setTelegramPairing(null);
    }
  }

  async function startTelegramPairing() {
    try {
      setPairingTelegram(true);
      const response = await fetch("/api/connectors/telegram/pairing/start", { method: "POST" });
      if (!response.ok) throw new Error((await response.json() as { error?: string }).error ?? "Telegram pairing could not start.");
      setTelegramPairing((await response.json()) as TelegramPairingView);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Telegram pairing could not start.");
    } finally {
      setPairingTelegram(false);
    }
  }

  async function completeTelegramPairing() {
    if (!telegramPairing?.code) return;
    try {
      setPairingTelegram(true);
      const response = await fetch("/api/connectors/telegram/pairing/complete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: telegramPairing.code })
      });
      if (!response.ok) throw new Error((await response.json() as { error?: string }).error ?? "Telegram pairing could not be completed.");
      setTelegramPairing((await response.json()) as TelegramPairingView);
      await loadWorkspace();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Telegram pairing could not be completed.");
    } finally {
      setPairingTelegram(false);
    }
  }

  async function disconnectTelegramPairing() {
    if (telegramPairing?.state !== "paired") return;
    if (!window.confirm("Disconnect this Telegram account? You can pair an account again later. Your Plans and Profile will stay on this device.")) return;
    try {
      setDisconnectingTelegram(true);
      const response = await fetch("/api/connectors/telegram/pairing", { method: "DELETE" });
      if (!response.ok) throw new Error((await response.json() as { error?: string }).error ?? "Telegram could not be disconnected.");
      setTelegramPairing((await response.json()) as TelegramPairingView);
      await loadWorkspace();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Telegram could not be disconnected.");
    } finally {
      setDisconnectingTelegram(false);
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

  async function prepareChinaPlan() {
    if (!workspace || workspace.activePlan.status !== "draft") return;
    try {
      setPreparingChinaPlan(true);
      setError(null);
      const response = await fetch(`/api/plans/${workspace.activePlan.id}/china/prepare`, { method: "POST" });
      const payload = await response.json() as ChinaPlanPreparationView | { error?: string };
      if (!("status" in payload)) throw new Error(payload.error ?? "The China Pack could not prepare this Plan.");
      setChinaPlanPreparation(payload);
      if (payload.status === "saved") {
        setWorkspace(payload.workspace);
        await loadPolicyPreparation();
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The China Pack could not prepare this Plan.");
    } finally {
      setPreparingChinaPlan(false);
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
      await loadPolicyPreparation();
      await loadAgentRuns();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The Plan could not be saved.");
    } finally {
      setCreating(false);
    }
  }

  async function generatePlanWithSelectedRuntime() {
    if (!requestText.trim()) return;
    try {
      setGenerating(true);
      const response = await fetch("/api/plans/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ request: requestText })
      });
      if (!response.ok) throw new Error((await response.json() as { error?: string }).error ?? "The selected runtime could not generate a Plan.");
      setWorkspace((await response.json()) as WorkspaceSnapshot);
      setRequestText("");
      setView("Plans");
      await loadPolicyPreparation();
      await loadAgentRuns();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The selected runtime could not generate a Plan.");
    } finally {
      setGenerating(false);
    }
  }

  async function sendAgentMessage() {
    const message = agentInput.trim();
    if (!message || agentBusy) return;
    setAgentInput("");
    setAgentMessages((current) => [...current, { id: crypto.randomUUID(), role: "user", text: message }]);
    try {
      setAgentBusy(true);
      const response = await fetch("/api/agent/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message, mode: agentMode })
      });
      const payload = await response.json() as { reply?: string; workspace?: WorkspaceSnapshot; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "The Agent could not respond right now.");
      if (payload.workspace) {
        setWorkspace(payload.workspace);
        setView("Plans");
        await loadPolicyPreparation();
        await loadAgentRuns();
      }
      setAgentMessages((current) => [...current, { id: crypto.randomUUID(), role: "assistant", text: payload.reply ?? "The Agent prepared an updated Plan for you." }]);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "The Agent could not respond right now.";
      setAgentMessages((current) => [...current, { id: crypto.randomUUID(), role: "assistant", text: message }]);
    } finally {
      setAgentBusy(false);
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
      await loadPolicyPreparation();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The Profile could not be saved.");
    }
  }

  async function saveRuntime(kind: AgentRuntimeKind) {
    try {
      setSavingRuntime(true);
      const response = await fetch("/api/runtime", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind })
      });
      if (!response.ok) throw new Error((await response.json() as { error?: string }).error ?? "The Plan runtime could not be selected.");
      setWorkspace((await response.json()) as WorkspaceSnapshot);
      await loadRuntimeChecks();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The Plan runtime could not be selected.");
    } finally {
      setSavingRuntime(false);
    }
  }

  async function refreshOfficialSource(sourceId: string) {
    try {
      setRefreshingSourceId(sourceId);
      const response = await fetch(`/api/official-sources/${encodeURIComponent(sourceId)}/refresh`, { method: "POST" });
      const result = (await response.json()) as ConnectorResult<SourceSnapshotWriteResult>;
      if (!response.ok || result.status !== "available") throw new Error(result.failure?.message ?? "This official source could not be refreshed.");
      await loadWorkspace();
      await loadPolicyPreparation();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "This official source could not be refreshed.");
    } finally {
      setRefreshingSourceId(null);
    }
  }

  async function linkSourceSnapshotToPlan(snapshotId: string) {
    if (!workspace) return;
    try {
      setLinkingSourceSnapshotId(snapshotId);
      const response = await fetch(`/api/plans/${encodeURIComponent(workspace.activePlan.id)}/sources/${encodeURIComponent(snapshotId)}`, { method: "POST" });
      if (!response.ok) throw new Error((await response.json() as { error?: string }).error ?? "This official evidence could not be linked to the current Plan.");
      setWorkspace((await response.json()) as WorkspaceSnapshot);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "This official evidence could not be linked to the current Plan.");
    } finally {
      setLinkingSourceSnapshotId(null);
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
      const query = new URLSearchParams({ location: place.location, name: place.name });
      const response = await fetch(`/api/amap/nearby/accommodation?${query}`);
      setStayResult((await response.json()) as AccommodationDiscoveryResult);
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

  async function cancelTaskReminder(taskId: string) {
    if (!workspace) return;
    try {
      setCancellingReminderTaskId(taskId);
      const response = await fetch(`/api/plans/${workspace.activePlan.id}/tasks/${taskId}/reminder/cancel`, { method: "POST" });
      if (!response.ok) throw new Error((await response.json() as { error?: string }).error ?? "The reminder could not be cancelled.");
      setWorkspace((await response.json()) as WorkspaceSnapshot);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The reminder could not be cancelled.");
    } finally {
      setCancellingReminderTaskId(null);
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
          <img className="brand-mark" src={landiLogoUrl} alt="Landi" />
          <span>Landi</span>
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
          <button className="profile-chip" onClick={() => setView("Settings")}>{workspace.profile.displayName}</button>
        </header>

        {error ? <p className="inline-error">{error}</p> : null}

        {view === "Today" ? <AgentPanel messages={agentMessages} input={agentInput} mode={agentMode} canRevise={workspace.activePlan.status === "draft"} busy={agentBusy} onInput={setAgentInput} onMode={setAgentMode} onSend={sendAgentMessage} /> : null}

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

            {workspace.profile.status === "incomplete" ? <section className="card profile-prompt"><div><p className="eyebrow">First-use basics</p><h2>Make China guidance fit you from the start.</h2><p>Add your name, language, nationality, and—only if you are comfortable—your visa or residence status. You can change these later, and you can still create a Plan now.</p></div><button className="primary-button" onClick={() => setView("Settings")}>Set up my basics</button></section> : null}

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
                <p>The Agent panel above is the main way to start. This quick form is still available when you want a local draft with transparent assumptions.</p>
              </div>
              <label className="request-field">
                <span className="sr-only">Describe your plan</span>
                <textarea value={requestText} onChange={(event) => setRequestText(event.target.value)} placeholder="For example: I will study in Hangzhou from September 2026." rows={3} />
              </label>
              <div className="plan-actions"><button className="secondary-button" disabled={creating || generating || !requestText.trim()} onClick={() => void createPlan()}>{creating ? "Saving…" : "Create local template"}</button><button className="primary-button" disabled={creating || generating || !requestText.trim()} onClick={() => void generatePlanWithSelectedRuntime()}>{generating ? "Creating Plan draft…" : `Draft complete Plan with ${workspace.runtime.selectedKind === "claude-code" ? "Claude Code" : "Codex"}`}</button></div>
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
                        <PlanTaskRow task={task} key={task.id} />
                      ))}
                    </div>
                  </div>
                </article>
              ))}
            </section>
          </>
        ) : null}

        {view === "Plans" ? <ChinaPlanPreparationCard plan={plan} result={chinaPlanPreparation} preparing={preparingChinaPlan} onPrepare={prepareChinaPlan} /> : null}
        {view === "Plans" ? <PlanView plan={plan} policyPreparation={policyPreparation} onActivate={activatePlan} confirming={confirming} amapQuery={amapQuery} setAmapQuery={setAmapQuery} amapResult={amapResult} searchingAmap={searchingAmap} onSearch={searchAmap} routeOrigin={routeOrigin} routeDestination={routeDestination} routeMode={routeMode} routeResult={routeResult} routing={routing} routeComparisons={routeComparisons} comparingRoutes={comparingRoutes} planWeatherResult={planWeather?.planId === plan.id ? planWeather.result : null} checkingPlanWeather={checkingPlanWeather} foodCentre={foodCentre} foodResult={foodResult} findingFood={findingFood} stayCentre={stayCentre} stayResult={stayResult} findingStay={findingStay} savingAccommodation={savingAccommodation} confirmingAccommodation={confirmingAccommodation} savingTransportPreference={savingTransportPreference} savingTravelContext={savingTravelContext} savingArrival={savingArrival} cancellingReminderTaskId={cancellingReminderTaskId} onChooseRouteOrigin={(place) => { setRouteOrigin(place); setRouteResult(null); setRouteComparisons(null); }} onChooseRouteDestination={(place) => { setRouteDestination(place); setRouteResult(null); setRouteComparisons(null); }} onRouteModeChange={(mode) => { setRouteMode(mode); setRouteResult(null); }} onFindNearbyFood={findNearbyFood} onFindNearbyAccommodation={findNearbyAccommodation} onSaveAccommodationCandidate={saveAccommodationCandidate} onSaveManualAccommodation={saveManualAccommodation} onConfirmAccommodation={confirmAccommodationBooking} onSaveTransportPreference={saveTransportPreference} onSaveTravelContext={saveTravelContext} onSaveArrival={saveArrival} onCancelReminder={cancelTaskReminder} onPlanRoute={planAmapRoute} onCompareRoutes={compareAmapRoutes} onCheckPlanWeather={checkPlanWeather} /> : null}
        {view === "Inbox" ? <InboxView workspace={workspace} /> : null}
        {view === "Settings" ? <SettingsView workspace={workspace} onSaveProfile={saveProfile} configuration={configuration} configurationForm={configurationForm} savingConfiguration={savingConfiguration} onConfigurationFormChange={(next) => setConfigurationForm((current) => ({ ...current, ...next }))} onSaveConfiguration={saveConfiguration} runtimeChecks={runtimeChecks} refreshingRuntimes={refreshingRuntimes} onRefreshRuntimes={refreshRuntimes} agentRuns={agentRuns} savingRuntime={savingRuntime} onSaveRuntime={saveRuntime} officialSources={officialSources} refreshingSourceId={refreshingSourceId} linkingSourceSnapshotId={linkingSourceSnapshotId} onRefreshOfficialSource={refreshOfficialSource} onLinkSourceSnapshotToPlan={linkSourceSnapshotToPlan} telegramStatus={telegramStatus} telegramVerification={telegramVerification} verifyingTelegram={verifyingTelegram} telegramPairing={telegramPairing} pairingTelegram={pairingTelegram} disconnectingTelegram={disconnectingTelegram} onVerifyTelegram={verifyTelegram} onStartTelegramPairing={startTelegramPairing} onCompleteTelegramPairing={completeTelegramPairing} onDisconnectTelegram={disconnectTelegramPairing} weatherLocation={weatherLocation} setWeatherLocation={setWeatherLocation} weatherResult={weatherResult} checkingWeather={checkingWeather} onCheckWeather={checkWeather} /> : null}
      </section>
    </main>
  );
}

function AgentPanel({ messages, input, mode, canRevise, busy, onInput, onMode, onSend }: { messages: ChatMessage[]; input: string; mode: ChatMode; canRevise: boolean; busy: boolean; onInput: (value: string) => void; onMode: (value: ChatMode) => void; onSend: () => Promise<void> }) {
  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void onSend();
  }

  return <section className="agent-panel" role="region" aria-labelledby="agent-panel-title" aria-busy={busy}>
      <header className="agent-panel-header"><div><p className="eyebrow">Landi Agent</p><h2 id="agent-panel-title">What can I help you with?</h2><span>Start here. Tell me what you need, and I’ll help shape it into a complete China Plan.</span></div></header>
      <div className="agent-mode-switch" aria-label="Agent mode"><button type="button" className={mode === "new_plan" ? "selected" : ""} onClick={() => onMode("new_plan")}>New Plan</button><button type="button" className={mode === "revise_plan" ? "selected" : ""} disabled={!canRevise} title={canRevise ? "Replace the current draft after a complete revision returns" : "Only a draft Plan can be revised"} onClick={() => onMode("revise_plan")}>Adjust current draft</button></div>
      <div className="agent-messages" aria-live="polite">{messages.map((message) => <div className={`agent-message ${message.role}`} key={message.id}><span>{message.role === "assistant" ? "Agent" : "You"}</span><p>{message.text}</p></div>)}{busy ? <div className="agent-message assistant"><span>Agent</span><p className="agent-thinking"><i /> Thinking through your Plan…</p></div> : null}</div>
      <form className="agent-composer" onSubmit={submit}><textarea value={input} onChange={(event) => onInput(event.target.value)} placeholder={mode === "revise_plan" ? "Tell the Agent what to change in the current draft…" : "For example: I am moving to Shanghai for work in October…"} rows={3} maxLength={1_500} disabled={busy} /><div><small>{mode === "revise_plan" ? "The current draft is replaced only after a complete revision returns. Newer Plan changes are never overwritten." : "The result stays a draft until you review its complete details and confirm it."} · {input.length}/1500</small><button className="primary-button" disabled={busy || !input.trim()}>{busy ? "Working…" : "Send to Agent"}</button></div></form>
    </section>;
}

function PlanView({ plan, policyPreparation, onActivate, confirming, amapQuery, setAmapQuery, amapResult, searchingAmap, onSearch, routeOrigin, routeDestination, routeMode, routeResult, routing, routeComparisons, comparingRoutes, planWeatherResult, checkingPlanWeather, foodCentre, foodResult, findingFood, stayCentre, stayResult, findingStay, savingAccommodation, confirmingAccommodation, savingTransportPreference, savingTravelContext, savingArrival, cancellingReminderTaskId, onChooseRouteOrigin, onChooseRouteDestination, onRouteModeChange, onFindNearbyFood, onFindNearbyAccommodation, onSaveAccommodationCandidate, onSaveManualAccommodation, onConfirmAccommodation, onSaveTransportPreference, onSaveTravelContext, onSaveArrival, onCancelReminder, onPlanRoute, onCompareRoutes, onCheckPlanWeather }: { plan: WorkspaceSnapshot["activePlan"]; policyPreparation: PolicyPreparationAssessment | null; onActivate: () => Promise<void>; confirming: boolean; amapQuery: string; setAmapQuery: (value: string) => void; amapResult: ConnectorResult<AmapPlace[]> | null; searchingAmap: boolean; onSearch: () => Promise<void>; routeOrigin: AmapPlace | null; routeDestination: AmapPlace | null; routeMode: RouteMode; routeResult: ConnectorResult<AmapRoute> | null; routing: boolean; routeComparisons: RouteComparisons | null; comparingRoutes: boolean; planWeatherResult: ConnectorResult<QWeatherWeatherSnapshot> | null; checkingPlanWeather: boolean; foodCentre: AmapPlace | null; foodResult: ConnectorResult<AmapNearbyPlace[]> | null; findingFood: boolean; stayCentre: AmapPlace | null; stayResult: ConnectorResult<AmapNearbyPlace[]> | null; findingStay: boolean; savingAccommodation: boolean; confirmingAccommodation: boolean; savingTransportPreference: boolean; savingTravelContext: boolean; savingArrival: boolean; cancellingReminderTaskId: string | null; onChooseRouteOrigin: (place: AmapPlace) => void; onChooseRouteDestination: (place: AmapPlace) => void; onRouteModeChange: (mode: RouteMode) => void; onFindNearbyFood: (place: AmapPlace) => Promise<void>; onFindNearbyAccommodation: (place: AmapPlace) => Promise<void>; onSaveAccommodationCandidate: (place: AmapNearbyPlace) => Promise<void>; onSaveManualAccommodation: (input: { name: string; address: string; status: "candidate" | "confirmed" }) => Promise<void>; onConfirmAccommodation: () => Promise<void>; onSaveTransportPreference: (preference: WorkspaceSnapshot["activePlan"]["configuration"]["transport"]["preference"]) => Promise<void>; onSaveTravelContext: (context: WorkspaceSnapshot["activePlan"]["configuration"]["travelContext"]) => Promise<void>; onSaveArrival: (arrival: WorkspaceSnapshot["activePlan"]["configuration"]["arrival"]) => Promise<void>; onCancelReminder: (taskId: string) => Promise<void>; onPlanRoute: () => Promise<void>; onCompareRoutes: () => Promise<void>; onCheckPlanWeather: (planId: string, location: string) => Promise<void> }) {
  const savedAccommodation = routePlaceFromAccommodation(plan.configuration.accommodation);
  const arrivalWeather = weatherForExpectedArrival(plan.configuration.arrival, planWeatherResult);
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
      <h3>Stages and tasks</h3>
      <div className="plan-stage-list">{plan.stages.map((stage, index) => <section key={stage.id}><div><span>0{index + 1}</span><strong>{stage.title}</strong></div><p>{stage.description}</p><div className="task-stack">{stage.tasks.map((task) => <PlanTaskRow task={task} key={task.id} cancellingReminder={cancellingReminderTaskId === task.id} onCancelReminder={onCancelReminder} />)}</div></section>)}</div>
      {plan.status === "draft" ? <button className="primary-button" disabled={confirming} onClick={() => void onActivate()}>Confirm complete Plan</button> : null}
    </section>
    <PolicyPreparationCard assessment={policyPreparation} />
    <PlaceDecisionPanel amapQuery={amapQuery} setAmapQuery={setAmapQuery} amapResult={amapResult} searchingAmap={searchingAmap} onSearch={onSearch} routeOrigin={routeOrigin} routeDestination={routeDestination} savedAccommodation={savedAccommodation} routeMode={routeMode} routeResult={routeResult} routing={routing} routeComparisons={routeComparisons} comparingRoutes={comparingRoutes} transportPreference={plan.configuration.transport.preference} travelContext={plan.configuration.travelContext} arrivalWeather={arrivalWeather} foodCentre={foodCentre} foodResult={foodResult} findingFood={findingFood} stayCentre={stayCentre} stayResult={stayResult} findingStay={findingStay} savingAccommodation={savingAccommodation} onChooseRouteOrigin={onChooseRouteOrigin} onChooseRouteDestination={onChooseRouteDestination} onRouteModeChange={onRouteModeChange} onFindNearbyFood={onFindNearbyFood} onFindNearbyAccommodation={onFindNearbyAccommodation} onSaveAccommodationCandidate={onSaveAccommodationCandidate} onPlanRoute={onPlanRoute} onCompareRoutes={onCompareRoutes} />
    <section className="card"><p className="eyebrow">Sources</p>{plan.sources.length ? plan.sources.map((source) => <a className="source-link" href={source.url} key={source.title} target="_blank" rel="noreferrer"><strong>{source.title}</strong><span>{source.authority} · {source.retrievedAt}</span></a>) : <p>No evidence is linked to this Plan yet. The evidence-preparation status above uses only a saved official source snapshot; a separate policy Skill must still review it.</p>}</section>
  </div>;
}

function PlanTaskRow({ task, cancellingReminder = false, onCancelReminder }: { task: Task; cancellingReminder?: boolean; onCancelReminder?: (taskId: string) => Promise<void> }) {
  const dynamicFacts = task.reminder?.refreshFacts?.includes("weather") ? "Refresh at delivery: destination weather" : "Dynamic facts: none";
  return <div className="task-row"><span className={`task-dot ${task.status}`} /><div className="task-copy"><span>{task.title}</span>{task.reminder ? <><small>Reminder purpose: {task.reminder.purpose}</small><small>{dynamicFacts}</small></> : null}</div><div className="task-timing"><small>{task.dueLabel}</small>{task.reminder ? <><small className="task-reminder">{task.reminder.scheduledAtLocal.replace("T", " ")} · {task.reminder.timeZone}</small>{onCancelReminder ? <button className="text-button" disabled={cancellingReminder} aria-label={`Cancel reminder for ${task.title}`} onClick={() => void onCancelReminder(task.id)}>{cancellingReminder ? "Cancelling…" : "Cancel reminder"}</button> : null}</> : null}</div></div>;
}

function PolicyPreparationCard({ assessment }: { assessment: PolicyPreparationAssessment | null }) {
  if (!assessment) return null;
  const label = assessment.status === "ready_for_review" ? "Ready for review" : assessment.status === "needs_evidence" ? "Refresh official evidence" : "Complete key details";
  return <section className={`card policy-preparation ${assessment.status}`}><div className="split-heading"><div><p className="eyebrow">Policy evidence preparation</p><h2>{label}</h2></div><span className="policy-status">{assessment.status.replaceAll("_", " ")}</span></div><p>{assessment.nextAction}</p>{assessment.knownInformation.length ? <div><strong>Known information</strong><ul className="compact-list">{assessment.knownInformation.map((item) => <li key={item}>{item}</li>)}</ul></div> : null}{assessment.missingInformation.length ? <div><strong>Still needed</strong><ul className="compact-list">{assessment.missingInformation.map((item) => <li key={item.field}><strong>{item.label}:</strong> {item.reason}</li>)}</ul></div> : null}{assessment.evidence.map((snapshot) => <a className="source-link" href={snapshot.url} key={snapshot.id} target="_blank" rel="noreferrer"><strong>{snapshot.titleOriginal}</strong><span>{snapshot.authority} · saved {snapshot.retrievedAt}</span></a>)}<small>{assessment.warning}</small></section>;
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

  return <section className="card profile-view"><p className="eyebrow">Long-term information</p><h2>Save only the basics you confirm</h2><form onSubmit={(event) => void submit(event)} className="profile-form"><label>Name<input value={profile.displayName} onChange={(event) => setProfile({ ...profile, displayName: event.target.value })} /></label><label>Preferred language<input value={profile.preferredLanguage} onChange={(event) => setProfile({ ...profile, preferredLanguage: event.target.value })} /></label><label>Nationality<input value={profile.nationality} onChange={(event) => setProfile({ ...profile, nationality: event.target.value })} /></label><label>Gender<select value={profile.gender} onChange={(event) => setProfile({ ...profile, gender: event.target.value as typeof profile.gender })}><option value="not_specified">Not specified</option><option value="woman">Woman</option><option value="man">Man</option><option value="nonbinary">Nonbinary</option><option value="prefer_not_to_say">Prefer not to say</option></select></label><label>China visa / residence status<select value={profile.immigrationStatus} onChange={(event) => setProfile({ ...profile, immigrationStatus: event.target.value as typeof profile.immigrationStatus })}><option value="unknown">Not sure yet</option><option value="short_term_visitor">Short-term visitor</option><option value="tourist_visa">Tourist visa</option><option value="student_visa">Student visa</option><option value="work_visa">Work visa</option><option value="residence_permit">Residence permit</option><option value="other">Other</option></select></label><p>These details help Landi later find the right policy route. Travel dates, companions, accommodation, and precise location remain inside a Plan, not this long-term Profile.</p><button className="primary-button" disabled={saving}>{saving ? "Saving…" : "Save confirmed Profile"}</button></form></section>;
}

function LocalConfigurationView({ configuration, form, saving, onChange, onSave }: { configuration: LocalConfiguration | null; form: LocalConfigurationForm; saving: boolean; onChange: (next: Partial<LocalConfigurationForm>) => void; onSave: () => Promise<void> }) {
  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void onSave();
  }

  const stateLabel = (configured: boolean | undefined) => configured === undefined ? "Checking" : configured ? "Configured" : "Needs setup";
  return <section className="card connector-config-card">
    <div className="split-heading"><div><p className="eyebrow">Local service connections</p><h2>Bring your own API keys</h2></div><span className={`configuration-state ${configuration ? "ready" : "checking"}`}>{configuration ? "Local only" : "Checking"}</span></div>
    <p>These keys belong to you. Landi saves them only in this local instance’s ignored <code>.env</code> file, sends them only to the matching service, and never returns their values to the Web UI or Agent.</p>
    <form className="connector-config-form" onSubmit={submit}>
      <label><span><strong>Amap API key</strong><em>{stateLabel(configuration?.amap.configured)}</em></span><input type="password" autoComplete="off" value={form.amapApiKey} onChange={(event) => onChange({ amapApiKey: event.target.value })} placeholder={configuration?.amap.configured ? "Already configured · enter a new key to replace it" : "Paste your Amap Web service key"} /><small>Places, routes, nearby food and accommodation verification.</small></label>
      <label><span><strong>QWeather API key</strong><em>{stateLabel(configuration?.qweather.configured)}</em></span><input type="password" autoComplete="off" value={form.qweatherApiKey} onChange={(event) => onChange({ qweatherApiKey: event.target.value })} placeholder={configuration?.qweather.configured ? "Already configured · enter a new key to replace it" : "Paste your QWeather key"} /><small>Current conditions and short forecasts.</small></label>
      <label><span><strong>QWeather API host</strong><em>{configuration?.qweather.host || "Required with the key"}</em></span><input type="url" value={form.qweatherApiHost} onChange={(event) => onChange({ qweatherApiHost: event.target.value })} placeholder={configuration?.qweather.host || "https://devapi.qweather.com"} /><small>Use the host provided by your QWeather account.</small></label>
      <label><span><strong>Telegram Bot token</strong><em>{stateLabel(configuration?.telegram.configured)}</em></span><input type="password" autoComplete="off" value={form.telegramBotToken} onChange={(event) => onChange({ telegramBotToken: event.target.value })} placeholder={configuration?.telegram.configured ? "Already configured · enter a new token to replace it" : "Paste the token from BotFather"} /><small>Required for Telegram identity verification, pairing and reminders.</small></label>
      <div className="connector-config-actions"><small>Save once, then Landi will reload connector configuration immediately.</small><button className="primary-button" disabled={saving}>{saving ? "Saving securely…" : "Save connection settings"}</button></div>
    </form>
  </section>;
}

function SettingsView({ workspace, onSaveProfile, configuration, configurationForm, savingConfiguration, onConfigurationFormChange, onSaveConfiguration, runtimeChecks, refreshingRuntimes, onRefreshRuntimes, agentRuns, savingRuntime, onSaveRuntime, officialSources, refreshingSourceId, linkingSourceSnapshotId, onRefreshOfficialSource, onLinkSourceSnapshotToPlan, telegramStatus, telegramVerification, verifyingTelegram, telegramPairing, pairingTelegram, disconnectingTelegram, onVerifyTelegram, onStartTelegramPairing, onCompleteTelegramPairing, onDisconnectTelegram, weatherLocation, setWeatherLocation, weatherResult, checkingWeather, onCheckWeather }: { workspace: WorkspaceSnapshot; onSaveProfile: (profile: WorkspaceSnapshot["profile"]) => Promise<void>; configuration: LocalConfiguration | null; configurationForm: LocalConfigurationForm; savingConfiguration: boolean; onConfigurationFormChange: (next: Partial<LocalConfigurationForm>) => void; onSaveConfiguration: () => Promise<void>; runtimeChecks: RuntimeCheck[]; refreshingRuntimes: boolean; onRefreshRuntimes: () => Promise<void>; agentRuns: AgentRun[]; savingRuntime: boolean; onSaveRuntime: (kind: AgentRuntimeKind) => Promise<void>; officialSources: OfficialSourceDefinition[]; refreshingSourceId: string | null; linkingSourceSnapshotId: string | null; onRefreshOfficialSource: (sourceId: string) => Promise<void>; onLinkSourceSnapshotToPlan: (snapshotId: string) => Promise<void>; telegramStatus: ConnectorResult<TelegramConfiguration> | null; telegramVerification: ConnectorResult<TelegramBotIdentity> | null; verifyingTelegram: boolean; telegramPairing: TelegramPairingView | null; pairingTelegram: boolean; disconnectingTelegram: boolean; onVerifyTelegram: () => Promise<void>; onStartTelegramPairing: () => Promise<void>; onCompleteTelegramPairing: () => Promise<void>; onDisconnectTelegram: () => Promise<void>; weatherLocation: string; setWeatherLocation: (value: string) => void; weatherResult: ConnectorResult<QWeatherWeatherSnapshot> | null; checkingWeather: boolean; onCheckWeather: () => Promise<void> }) {
  const telegramConfigured = telegramStatus?.status === "available";
  const statusFor = (kind: AgentRuntimeKind) => runtimeChecks.find((runtime) => runtime.kind === kind);
  const runtimeLabel = (kind: AgentRuntimeKind) => kind === "claude-code" ? "Claude Code" : "Codex";
  const snapshotsFor = (sourceId: string) => workspace.sourceSnapshots.filter((snapshot) => snapshot.sourceId === sourceId);
  const isLinkedToActivePlan = (snapshot: WorkspaceSnapshot["sourceSnapshots"][number]) => workspace.activePlan.sources.some((source) => source.url === snapshot.url && source.authority === snapshot.authority && source.retrievedAt === snapshot.retrievedAt);
  return <section className="content-stack">
    <ProfileView workspace={workspace} onSave={onSaveProfile} />
    <LocalConfigurationView configuration={configuration} form={configurationForm} saving={savingConfiguration} onChange={onConfigurationFormChange} onSave={onSaveConfiguration} />
    <DataMaintenanceCard />
    <section className="card settings-view">
      <p className="eyebrow">Plan runtime</p>
      <h2>Choose the account that creates Plan drafts</h2>
      <p>This instance uses one local runtime at a time. Landi checks its availability but never asks for, reads, or stores its login credentials.</p>
      <div className="runtime-options">
        {(["codex", "claude-code"] as AgentRuntimeKind[]).map((kind) => {
          const runtime = statusFor(kind);
          const selected = workspace.runtime.selectedKind === kind;
          const state = runtime?.installed && runtime.authenticated ? "ready" : runtime?.installed ? "login needed" : "not installed";
          return <label className={`runtime-option ${selected ? "selected" : ""}`} key={kind}><input type="radio" name="plan-runtime" value={kind} checked={selected} disabled={savingRuntime} onChange={() => void onSaveRuntime(kind)} /><span><strong>{runtimeLabel(kind)}</strong><small>{state}{runtime?.version ? ` · ${runtime.version}` : ""}</small></span></label>;
        })}
      </div>
      <div className="runtime-footer"><p>Future Web and Telegram Plan drafts use this choice. When the selected runtime shows <strong>ready</strong>, the Agent can be used directly from the Today conversation.</p><button className="secondary-button" disabled={refreshingRuntimes} onClick={() => void onRefreshRuntimes()}>{refreshingRuntimes ? "Checking…" : "Refresh runtime status"}</button></div>
    </section>
    <section className="card run-history-card"><p className="eyebrow">Plan generation history</p><h2>See what happened, without saving your private content</h2><p>Only the runtime, entry point, time, outcome, and generated Plan reference are retained. Your request, raw model output, and account credentials are never included in this history.</p>{agentRuns.length ? <div className="run-history-list">{agentRuns.map((run) => <article key={run.id}><strong>{run.runtimeKind === "claude-code" ? "Claude Code" : "Codex"} · {run.status.replaceAll("_", " ")}</strong><span>{run.trigger === "telegram" ? "Telegram" : "Web"} · started {run.startedAt}{run.failureCode ? ` · ${run.failureCode.replaceAll("_", " ")}` : ""}</span></article>)}</div> : <p className="connector-message">No Plan generation runs have been recorded yet.</p>}</section>
    <section className="card official-sources-card">
      <p className="eyebrow">Official source evidence</p>
      <h2>Refresh approved sources when you need current facts</h2>
      <p>Refreshing saves a limited evidence snapshot from the original official page. It does not decide whether a policy applies to you.</p>
      {officialSources.length ? <div className="official-source-list">{officialSources.map((source) => {
        const snapshots = snapshotsFor(source.id);
        const latest = snapshots[0];
        const changed = new Set(snapshots.map((snapshot) => snapshot.contentHash)).size > 1;
        return <article key={source.id}><div><strong>{latest?.titleOriginal ?? source.title}</strong><span>{source.authority}</span><small>{latest ? `Last checked ${latest.retrievedAt}${changed ? " · content changed across saved snapshots" : ""}` : "Not refreshed yet"}</small></div><div className="official-source-actions"><a className="text-button" href={latest?.url ?? source.url} target="_blank" rel="noreferrer">Open original source</a>{latest ? <button className="secondary-button" disabled={linkingSourceSnapshotId !== null || isLinkedToActivePlan(latest)} onClick={() => void onLinkSourceSnapshotToPlan(latest.id)}>{isLinkedToActivePlan(latest) ? "Linked to current Plan" : linkingSourceSnapshotId === latest.id ? "Linking…" : "Link to current Plan"}</button> : null}<button className="secondary-button" disabled={refreshingSourceId !== null} onClick={() => void onRefreshOfficialSource(source.id)}>{refreshingSourceId === source.id ? "Refreshing…" : "Refresh evidence"}</button></div></article>;
      })}</div> : <p className="connector-message">Approved source registry is not available right now.</p>}
      <p className="connector-message">A changed page needs review. It is not, by itself, a policy change or a personal eligibility result.</p>
    </section>
    <section className="card settings-view"><p className="eyebrow">Connection status</p><h2>Services are separated from the product UI</h2><div className="status-grid">{Object.entries(workspace.system).map(([name, status]) => <div key={name}><span>{name}</span><strong>{status.replaceAll("_", " ")}</strong></div>)}<div><span>Telegram</span><strong>{telegramPairing?.state === "paired" ? "paired" : telegramConfigured ? "configured" : telegramStatus?.status === "not_configured" ? "token needed" : telegramStatus?.status ?? "checking"}</strong></div></div><p>Plan drafting starts only after you press its explicit button. Telegram starts with a private, user-owned pairing step.</p></section>
    <section className="card weather-card"><p className="eyebrow">QWeather facts</p><h2>Check what the destination weather reports.</h2><div className="amap-search"><input value={weatherLocation} onChange={(event) => setWeatherLocation(event.target.value)} aria-label="Check destination weather" placeholder="City or region" /><button className="primary-button" disabled={checkingWeather || !weatherLocation.trim()} onClick={() => void onCheckWeather()}>{checkingWeather ? "Checking…" : "Check weather"}</button></div>{weatherResult ? <WeatherResults result={weatherResult} /> : <p>Weather is a changing fact, not a promise. Landi will use it for cautious packing and route suggestions after a Plan is confirmed.</p>}</section>
    <section className="card telegram-card"><p className="eyebrow">Telegram bot</p><h2>Connect your private Telegram account</h2>{telegramConfigured ? <><p>Verification makes one safe identity request. It does not read messages or send a notification.</p><button className="secondary-button" disabled={verifyingTelegram} onClick={() => void onVerifyTelegram()}>{verifyingTelegram ? "Verifying…" : "Verify Telegram bot"}</button><TelegramPairing pairing={telegramPairing} busy={pairingTelegram} disconnecting={disconnectingTelegram} onStart={onStartTelegramPairing} onComplete={onCompleteTelegramPairing} onDisconnect={onDisconnectTelegram} /></> : <p>Add <code>TELEGRAM_BOT_TOKEN</code> to the local <code>.env</code> file, then restart the local service. The token is not shown in this workspace.</p>}{telegramVerification ? <TelegramVerification result={telegramVerification} /> : null}</section>
  </section>;
}

function TelegramPairing({ pairing, busy, disconnecting, onStart, onComplete, onDisconnect }: { pairing: TelegramPairingView | null; busy: boolean; disconnecting: boolean; onStart: () => Promise<void>; onComplete: () => Promise<void>; onDisconnect: () => Promise<void> }) {
  if (pairing?.state === "paired") return <div className="telegram-pairing"><p className="success-copy">Connected to {pairing.binding?.username ? `@${pairing.binding.username}` : pairing.binding?.firstName ?? "your Telegram account"}. Active Plan reminders and the dedicated arrival check-in can be delivered here.</p><button className="secondary-button" disabled={disconnecting} onClick={() => void onDisconnect()}>{disconnecting ? "Disconnecting…" : "Disconnect this Telegram account"}</button><small>Disconnecting removes only this chat binding. Your Plans, Profile, and local Bot token stay on this device.</small></div>;
  if (pairing?.state === "waiting_for_start" && pairing.deepLink && pairing.code) return <div className="telegram-pairing"><p>1. Open {pairing.botUsername ? `@${pairing.botUsername}` : "your bot"} and send the secure start message.</p><a className="primary-button" href={pairing.deepLink} target="_blank" rel="noreferrer">Open bot and send /start</a><p>2. Return here and confirm after Telegram opens.</p><button className="secondary-button" disabled={busy} onClick={() => void onComplete()}>{busy ? "Checking…" : "I sent /start"}</button>{pairing.foundStart === false ? <p className="connector-message">The start message is not visible yet. Send it in the bot's private chat, then try again.</p> : null}<small>This one-time instruction expires at {pairing.expiresAt}.</small></div>;
  if (pairing?.state === "waiting_for_start") return <div className="telegram-pairing"><p>A pairing instruction is already waiting. Start a fresh one if this browser no longer has its secure link.</p><button className="secondary-button" disabled={busy} onClick={() => void onStart()}>{busy ? "Preparing…" : "Start a fresh pairing"}</button></div>;
  return <div className="telegram-pairing"><p>Generate a short-lived instruction, then approve the connection from your bot's private chat. This instance accepts one Telegram account only.</p><button className="primary-button" disabled={busy} onClick={() => void onStart()}>{busy ? "Preparing…" : "Pair this Telegram account"}</button></div>;
}

function TelegramVerification({ result }: { result: ConnectorResult<TelegramBotIdentity> }) {
  if (result.status !== "available" || !result.data) return <p className="connector-message">{result.failure?.message ?? "Telegram is not available."} <code>{result.failure?.code}</code></p>;
  return <p className="success-copy">Verified as {result.data.username ? `@${result.data.username}` : result.data.firstName}. Pairing and reminders are the next step.</p>;
}

function PlanWeather({ plan, result, checking, onCheck }: { plan: WorkspaceSnapshot["activePlan"]; result: ConnectorResult<QWeatherWeatherSnapshot> | null; checking: boolean; onCheck: (planId: string, location: string) => Promise<void> }) {
  const hasExpectedArrival = Boolean(plan.configuration.arrival.expectedAtLocal);
  return <section className="plan-weather"><div><strong>Weather for this Plan</strong><span>Refresh current and three-day weather facts for {plan.location}. {hasExpectedArrival ? "A transport choice uses weather only when a forecast date matches the expected arrival date." : "Save an expected arrival first if you want a matching forecast to inform transport."} This does not change the Plan or schedule a reminder.</span></div><button className="secondary-button" disabled={checking} onClick={() => void onCheck(plan.id, plan.location)}>{checking ? "Refreshing…" : "Refresh Plan weather"}</button>{result ? <WeatherResults result={result} /> : null}</section>;
}

function WeatherResults({ result }: { result: ConnectorResult<QWeatherWeatherSnapshot> }) {
  if (result.status !== "available" || !result.data) return <p className="connector-message">{result.failure?.message ?? "QWeather is not available."} <code>{result.failure?.code}</code></p>;
  const { current, daily, location } = result.data;
  const skill = runWeatherAndPackingSkill({ locationName: location.name, current, daily, retrievedAt: result.data.retrievedAt, ...(result.data.attributionUrl ? { attributionUrl: result.data.attributionUrl } : {}) });
  const sourceUrl = skill.sources[0]?.url;
  return <div className="weather-results"><div className="weather-now"><strong>{location.name}{location.adminArea ? ` · ${location.adminArea}` : ""}</strong><span>{current.condition} · {current.temperatureC}°C, feels like {current.feelsLikeC}°C · humidity {current.humidityPercent}%</span><small>Observed {current.observedAt}</small></div><div className="weather-days">{daily.map((day) => <div key={day.date}><strong>{day.date}</strong><span>{day.conditionDay}</span><span>{day.lowC}–{day.highC}°C</span><small>{day.precipitationMm > 0 ? `${day.precipitationMm} mm precipitation` : `UV ${day.uvIndex}`}</small></div>)}</div>{skill.recommendations.length ? <div className="weather-note"><strong>For your Plan</strong>{skill.recommendations.map((item) => <span key={item.kind}>{item.text}</span>)}</div> : <p className="connector-message">{skill.summary}</p>}{sourceUrl ? <a className="source-link weather-source" href={sourceUrl} target="_blank" rel="noreferrer"><strong>Weather source</strong><span>Open QWeather details</span></a> : null}</div>;
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

  return <form className="plan-accommodation manual-accommodation-form" onSubmit={submit}><strong>Already chose a stay?</strong><span>Enter its name and address. Landi will use Amap only to verify a location for this Plan.</span><div><label>Stay name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Hotel, apartment, or residence" /></label><label>Address or area<input value={address} onChange={(event) => setAddress(event.target.value)} placeholder="Street address, district, or city" /></label></div><label className="checkbox-label"><input type="checkbox" checked={alreadyBooked} onChange={(event) => setAlreadyBooked(event.target.checked)} />I have already completed the booking elsewhere</label><button className="secondary-button" disabled={saving || !name.trim() || !address.trim()}>{saving ? "Saving…" : alreadyBooked ? "Save confirmed accommodation" : "Save accommodation candidate"}</button></form>;
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

  return <form className="plan-accommodation travel-context-form" onSubmit={submit}><strong>Expected first arrival</strong><span>Optional. Once this Plan is active and Telegram is paired, Landi sends one arrival check-in at this local time. It never starts a ride, booking, payment, or location request.</span><div><label>Local date and time<input type="datetime-local" value={expectedAtLocal} onChange={(event) => setExpectedAtLocal(event.target.value)} /></label><label>Time zone<select value={timeZone} onChange={(event) => setTimeZone(event.target.value)}><option value="Asia/Shanghai">China Standard Time (Asia/Shanghai)</option></select></label></div><button className="secondary-button" disabled={saving}>{saving ? "Saving…" : expectedAtLocal ? "Save expected arrival" : "Clear expected arrival"}</button></form>;
}

function TransportPreference({ preference, saving, onSave }: { preference: WorkspaceSnapshot["activePlan"]["configuration"]["transport"]["preference"]; saving: boolean; onSave: (preference: WorkspaceSnapshot["activePlan"]["configuration"]["transport"]["preference"]) => Promise<void> }) {
  return <label className="plan-accommodation"><strong>Transport for this Plan</strong><span>Keep the default unless you have a clear preference. It will guide future route decisions, not start a trip.</span><select value={preference} disabled={saving} onChange={(event) => void onSave(event.target.value as typeof preference)}><option value="plan_recommended">Let Landi decide from the Plan</option><option value="taxi">Prefer taxi</option><option value="public_transit">Prefer public transit</option><option value="walking">Prefer walking when practical</option></select></label>;
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

function PlaceDecisionPanel({ amapQuery, setAmapQuery, amapResult, searchingAmap, onSearch, routeOrigin, routeDestination, savedAccommodation, routeMode, routeResult, routing, routeComparisons, comparingRoutes, transportPreference, travelContext, arrivalWeather, foodCentre, foodResult, findingFood, stayCentre, stayResult, findingStay, savingAccommodation, onChooseRouteOrigin, onChooseRouteDestination, onRouteModeChange, onFindNearbyFood, onFindNearbyAccommodation, onSaveAccommodationCandidate, onPlanRoute, onCompareRoutes }: { amapQuery: string; setAmapQuery: (value: string) => void; amapResult: ConnectorResult<AmapPlace[]> | null; searchingAmap: boolean; onSearch: () => Promise<void>; routeOrigin: AmapPlace | null; routeDestination: AmapPlace | null; savedAccommodation: AmapPlace | null; routeMode: RouteMode; routeResult: ConnectorResult<AmapRoute> | null; routing: boolean; routeComparisons: RouteComparisons | null; comparingRoutes: boolean; transportPreference: WorkspaceSnapshot["activePlan"]["configuration"]["transport"]["preference"]; travelContext: WorkspaceSnapshot["activePlan"]["configuration"]["travelContext"]; arrivalWeather: MatchedTransportWeather | null; foodCentre: AmapPlace | null; foodResult: ConnectorResult<AmapNearbyPlace[]> | null; findingFood: boolean; stayCentre: AmapPlace | null; stayResult: ConnectorResult<AmapNearbyPlace[]> | null; findingStay: boolean; savingAccommodation: boolean; onChooseRouteOrigin: (place: AmapPlace) => void; onChooseRouteDestination: (place: AmapPlace) => void; onRouteModeChange: (mode: RouteMode) => void; onFindNearbyFood: (place: AmapPlace) => Promise<void>; onFindNearbyAccommodation: (place: AmapPlace) => Promise<void>; onSaveAccommodationCandidate: (place: AmapNearbyPlace) => Promise<void>; onPlanRoute: () => Promise<void>; onCompareRoutes: () => Promise<void> }) {
  return <section className="card amap-card"><p className="eyebrow">Plan place decisions</p><h2>Compare local facts before you decide where to stay or how to get there.</h2><div className="amap-search"><input value={amapQuery} onChange={(event) => setAmapQuery(event.target.value)} aria-label="Search places with Amap" /><button className="primary-button" disabled={searchingAmap || !amapQuery.trim()} onClick={() => void onSearch()}>{searchingAmap ? "Checking…" : "Search Amap"}</button></div>{amapResult ? <AmapResults result={amapResult} onChooseRouteOrigin={onChooseRouteOrigin} onChooseRouteDestination={onChooseRouteDestination} onFindNearbyFood={onFindNearbyFood} onFindNearbyAccommodation={onFindNearbyAccommodation} /> : <p>Search a venue, school, workplace, or district. Its location can then support accommodation, food, and transport decisions inside this Plan.</p>}<NearbyAccommodation centre={stayCentre} result={stayResult} finding={findingStay} saving={savingAccommodation} onSaveCandidate={onSaveAccommodationCandidate} /><NearbyFood centre={foodCentre} result={foodResult} finding={findingFood} /><RoutePlanner origin={routeOrigin} destination={routeDestination} savedAccommodation={savedAccommodation} mode={routeMode} result={routeResult} routing={routing} comparisons={routeComparisons} comparing={comparingRoutes} transportPreference={transportPreference} travelContext={travelContext} arrivalWeather={arrivalWeather} onChooseOrigin={onChooseRouteOrigin} onChooseDestination={onChooseRouteDestination} onModeChange={onRouteModeChange} onPlanRoute={onPlanRoute} onCompareRoutes={onCompareRoutes} /></section>;
}

function AmapResults({ result, onChooseRouteOrigin, onChooseRouteDestination, onFindNearbyFood, onFindNearbyAccommodation }: { result: ConnectorResult<AmapPlace[]>; onChooseRouteOrigin: (place: AmapPlace) => void; onChooseRouteDestination: (place: AmapPlace) => void; onFindNearbyFood: (place: AmapPlace) => Promise<void>; onFindNearbyAccommodation: (place: AmapPlace) => Promise<void> }) {
  if (result.status !== "available") return <p className="connector-message">{result.failure?.message ?? "Amap is not available."} <code>{result.failure?.code}</code></p>;
  if (!result.data?.length) return <p className="connector-message">Amap is connected but returned no matching places.</p>;
  return <div className="place-results">{result.data.map((place) => <div key={place.id}><strong>{place.name}</strong><span>{place.address} · {place.location}</span><div className="place-actions"><button className="text-button" onClick={() => onChooseRouteOrigin(place)}>Set as origin</button><button className="text-button" onClick={() => onChooseRouteDestination(place)}>Set as destination</button><button className="text-button" onClick={() => void onFindNearbyAccommodation(place)}>Find stays nearby</button><button className="text-button" onClick={() => void onFindNearbyFood(place)}>Find food nearby</button></div></div>)}</div>;
}

function NearbyAccommodation({ centre, result, finding, saving, onSaveCandidate }: { centre: AmapPlace | null; result: ConnectorResult<AmapNearbyPlace[]> | null; finding: boolean; saving: boolean; onSaveCandidate: (place: AmapNearbyPlace) => Promise<void> }) {
  if (!centre && !result) return null;
  const skill = (result as AccommodationDiscoveryResult | null)?.skill;
  return <div className="nearby-food"><p><strong>Stay options near {centre?.name ?? "this place"}</strong><span>Preliminary access reasons from the internal China Pack Skill, based on Amap location facts.</span></p>{finding ? <p className="connector-message">Checking nearby stays…</p> : null}{result?.status === "available" ? result.data?.length ? <><div className="nearby-food-results">{result.data.map((place) => { const recommendation = skill?.recommendations.find((item) => item.candidateId === place.id); return <div key={place.id}><strong>{place.name}</strong><span>{formatDistance(place.distanceMeters)} · {place.address}</span>{recommendation ? <small>{recommendation.reason}</small> : <small>Amap location fact only; no preliminary Skill recommendation.</small>}<div className="place-actions"><a className="text-button" href={createAmapPlaceHandoff({ place }).url}>Open in Amap</a><button className="text-button" disabled={saving} onClick={() => void onSaveCandidate(place)}>{saving ? "Saving…" : "Keep as Plan stay candidate"}</button></div></div>; })}</div>{skill?.warnings.length ? <p className="connector-message">{skill.warnings.join(" ")}</p> : null}</> : <p className="connector-message">Amap found no nearby accommodation POIs.</p> : result ? <p className="connector-message">{result.failure?.message ?? "Amap is not available."} <code>{result.failure?.code}</code></p> : null}</div>;
}

function NearbyFood({ centre, result, finding }: { centre: AmapPlace | null; result: ConnectorResult<AmapNearbyPlace[]> | null; finding: boolean }) {
  if (!centre && !result) return null;
  return <div className="nearby-food"><p><strong>Food near {centre?.name ?? "this place"}</strong><span>Distance facts from Amap. These are not ranked recommendations.</span></p>{finding ? <p className="connector-message">Checking nearby food…</p> : null}{result?.status === "available" ? result.data?.length ? <div className="nearby-food-results">{result.data.map((place) => <div key={place.id}><strong>{place.name}</strong><span>{formatDistance(place.distanceMeters)} · {place.address}</span><div className="place-actions"><a className="text-button" href={createAmapPlaceHandoff({ place }).url}>Open in Amap</a></div></div>)}</div> : <p className="connector-message">Amap found no nearby restaurant POIs.</p> : result ? <p className="connector-message">{result.failure?.message ?? "Amap is not available."} <code>{result.failure?.code}</code></p> : null}</div>;
}

function formatDistance(distanceMeters: number): string {
  return distanceMeters < 1_000 ? `${Math.round(distanceMeters)} m away` : `${(distanceMeters / 1_000).toFixed(1)} km away`;
}

function RoutePlanner({ origin, destination, savedAccommodation, mode, result, routing, comparisons, comparing, transportPreference, travelContext, arrivalWeather, onChooseOrigin, onChooseDestination, onModeChange, onPlanRoute, onCompareRoutes }: { origin: AmapPlace | null; destination: AmapPlace | null; savedAccommodation: AmapPlace | null; mode: RouteMode; result: ConnectorResult<AmapRoute> | null; routing: boolean; comparisons: RouteComparisons | null; comparing: boolean; transportPreference: WorkspaceSnapshot["activePlan"]["configuration"]["transport"]["preference"]; travelContext: WorkspaceSnapshot["activePlan"]["configuration"]["travelContext"]; arrivalWeather: MatchedTransportWeather | null; onChooseOrigin: (place: AmapPlace) => void; onChooseDestination: (place: AmapPlace) => void; onModeChange: (mode: RouteMode) => void; onPlanRoute: () => Promise<void>; onCompareRoutes: () => Promise<void> }) {
  const resultMode = result?.status === "available" ? result.data?.mode : undefined;
  const handoff = resultMode === "driving" && origin && destination ? createAmapDrivingHandoff({ origin, destination }) : null;
  const modeLabel = mode === "driving" ? "driving" : mode === "walking" ? "walking" : "public-transit";
  const resultModeLabel = resultMode === "driving" ? "Driving" : resultMode === "walking" ? "Walking" : "Public transit";
  const availableComparisons = comparisons ? Object.values(comparisons).filter((comparison): comparison is ConnectorResult<AmapRoute> & { status: "available"; data: AmapRoute } => comparison?.status === "available" && comparison.data !== undefined) : [];
  const recommendation = comparisons ? runTransportPlannerSkill({ preference: transportPreference, ...(travelContext.partySize !== undefined ? { partySize: travelContext.partySize } : {}), ...(arrivalWeather ? { weather: { condition: arrivalWeather.condition, precipitationMm: arrivalWeather.precipitationMm }, weatherObservedAt: arrivalWeather.observedAt } : {}), luggage: travelContext.luggage, routeFacts: availableComparisons.map((comparison) => ({ mode: comparison.data.mode, distanceMeters: comparison.data.distanceMeters, ...(comparison.data.durationSeconds !== undefined ? { durationSeconds: comparison.data.durationSeconds } : {}) })), routeObservedAt: availableComparisons[0]?.observedAt ?? new Date().toISOString() }) : null;
  return <div className="route-planner"><p><strong>Origin:</strong> {origin?.name ?? "Choose a place"}</p><p><strong>Destination:</strong> {destination?.name ?? "Choose a place"}</p>{savedAccommodation ? <div className="saved-route-place"><span>Saved Plan stay: <strong>{savedAccommodation.name}</strong></span><div className="place-actions"><button className="text-button" onClick={() => onChooseOrigin(savedAccommodation)}>Use as origin</button><button className="text-button" onClick={() => onChooseDestination(savedAccommodation)}>Use as destination</button></div></div> : null}<label className="route-mode"><span>Compare route type</span><select value={mode} disabled={routing || comparing} onChange={(event) => onModeChange(event.target.value as RouteMode)}><option value="driving">Driving / taxi</option><option value="transit">Public transit</option><option value="walking">Walking</option></select></label><div className="route-actions"><button className="secondary-button" disabled={!origin || !destination || routing || comparing} onClick={() => void onPlanRoute()}>{routing ? "Checking route…" : `Check ${modeLabel} route`}</button><button className="secondary-button" disabled={!origin || !destination || routing || comparing} onClick={() => void onCompareRoutes()}>{comparing ? "Comparing routes…" : "Compare all modes"}</button></div><RouteComparisonsView comparisons={comparisons} /><TransportRecommendationView recommendation={recommendation} />{result?.status === "available" && result.data ? <div className="route-result"><strong>{resultModeLabel} facts from Amap</strong><p>{formatRouteFact(result.data)}</p>{handoff ? <><a className="primary-button route-link" href={handoff.url}>Open driving route in Amap</a><small>Opening Amap is your choice. No ride is requested here.</small></> : <small>This is a route fact for your Plan. No trip, booking, or payment is started.</small>}</div> : result ? <p className="connector-message">{result.failure?.message ?? "Amap is not available."}</p> : null}</div>;
}

function RouteComparisonsView({ comparisons }: { comparisons: RouteComparisons | null }) {
  if (!comparisons) return null;
  const modes: RouteMode[] = ["driving", "transit", "walking"];
  const labels: Record<RouteMode, string> = { driving: "Driving / taxi", transit: "Public transit", walking: "Walking" };
  return <div className="route-comparisons"><strong>Available route facts</strong><span>These are comparisons, not a recommendation or a transaction.</span><div>{modes.map((mode) => { const result = comparisons[mode]; return <article key={mode}><strong>{labels[mode]}</strong>{result?.status === "available" && result.data ? <span>{formatRouteFact(result.data)}</span> : <small>{result?.failure?.message ?? "No route fact returned."}</small>}</article>; })}</div></div>;
}

function TransportRecommendationView({ recommendation }: { recommendation: TransportPlannerSkillResult | null }) {
  if (!recommendation) return null;
  const selected = recommendation.recommendations[0];
  const label = selected?.mode === "driving" ? "Driving / taxi" : selected?.mode === "transit" ? "Public transit" : selected?.mode === "walking" ? "Walking" : "No preliminary choice";
  return <div className="transport-recommendation"><strong>Preliminary Plan choice: {label}</strong><ul>{(selected?.reasons ?? [recommendation.summary]).map((reason) => <li key={reason}>{reason}</li>)}</ul><small>{recommendation.warnings[0]}</small></div>;
}

function formatRouteFact(route: AmapRoute): string {
  return `${(route.distanceMeters / 1000).toFixed(1)} km${route.durationSeconds !== undefined ? ` · about ${Math.ceil(route.durationSeconds / 60)} min` : ""}${route.taxiCostYuan !== undefined ? ` · estimated taxi ¥${route.taxiCostYuan}` : ""}${route.transitCostYuan !== undefined ? ` · transit fare ¥${route.transitCostYuan}` : ""}`;
}

function weatherForExpectedArrival(arrival: WorkspaceSnapshot["activePlan"]["configuration"]["arrival"], result: ConnectorResult<QWeatherWeatherSnapshot> | null): MatchedTransportWeather | null {
  if (!arrival.expectedAtLocal || result?.status !== "available" || !result.data) return null;
  const arrivalDate = arrival.expectedAtLocal.slice(0, 10);
  const forecast = result.data.daily.find((day) => day.date === arrivalDate);
  return forecast ? { condition: forecast.conditionDay, precipitationMm: forecast.precipitationMm, observedAt: result.data.retrievedAt } : null;
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

function ChinaPlanPreparationCard({ plan, result, preparing, onPrepare }: { plan: WorkspaceSnapshot["activePlan"]; result: ChinaPlanPreparationView | null; preparing: boolean; onPrepare: () => Promise<void> }) {
  return <section className="card china-preparation-card">
    <div className="split-heading"><div><p className="eyebrow">China Country Pack</p><h2>Prepare this complete Plan</h2></div><span className={`configuration-state ${result?.status === "saved" ? "ready" : ""}`}>{result?.status ?? "not prepared"}</span></div>
    <p>Refresh approved official sources, collect current Amap and QWeather facts, and let the internal China Skills propose preparation Tasks and Reminders. Nothing is activated or booked.</p>
    {result?.status === "saved" ? <div className="china-preparation-result success"><strong>{result.message}</strong><span>{result.taskCount} Tasks · {result.reminderCount} Reminders · {result.sources.filter((source) => source.status === "ready").length} sources ready</span></div> : null}
    {result?.status === "blocked" ? <div className="china-preparation-result blocked"><strong>{result.message}</strong><ul className="compact-list">{result.actionItems.map((item) => <li key={item}>{item}</li>)}</ul></div> : null}
    {plan.status === "draft" ? <button className="primary-button" disabled={preparing} onClick={() => void onPrepare()}>{preparing ? "Preparing with current sources…" : result?.status === "saved" ? "Prepare this updated draft again" : "Prepare with China Pack"}</button> : <p className="connector-message">This Plan is active. Create or revise a draft before preparing a new Country Pack proposal.</p>}
  </section>;
}

function DataMaintenanceCard() {
  const [status, setStatus] = useState<DatabaseMaintenanceView | null>(null);
  const [backup, setBackup] = useState<DatabaseBackupView | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    void fetch("/api/maintenance").then(async (response) => {
      if (response.ok) setStatus((await response.json()) as DatabaseMaintenanceView);
    }).catch(() => setStatus(null));
  }, []);

  async function createBackup() {
    try {
      setBusy(true);
      setFailure(null);
      const response = await fetch("/api/backups", { method: "POST" });
      const result = await response.json() as DatabaseBackupView | { error?: string };
      if (!response.ok || !("fileName" in result)) throw new Error("error" in result ? result.error ?? "The local backup could not be created." : "The local backup could not be created.");
      setBackup(result);
      const maintenanceResponse = await fetch("/api/maintenance");
      if (maintenanceResponse.ok) setStatus((await maintenanceResponse.json()) as DatabaseMaintenanceView);
    } catch (caught) {
      setFailure(caught instanceof Error ? caught.message : "The local backup could not be created.");
    } finally {
      setBusy(false);
    }
  }

  const ready = status?.integrity === "ok" && status.schemaVersion === status.latestSchemaVersion;
  return <section className="card data-maintenance-card"><div className="split-heading"><div><p className="eyebrow">Local data</p><h2>Keep a verified workspace backup</h2></div><span className={`configuration-state ${ready ? "ready" : ""}`}>{status ? `${status.integrity} · schema ${status.schemaVersion}` : "checking"}</span></div><p>A backup copies your local SQLite workspace into its private backups folder. It does not include Codex, Claude Code, Amap, QWeather, or Telegram credentials.</p><button className="secondary-button" disabled={busy || !ready} onClick={() => void createBackup()}>{busy ? "Creating and verifying…" : "Create local backup"}</button>{backup ? <div className="backup-result"><strong>Backup verified</strong><span>{backup.fileName}</span><small>{backup.path}</small></div> : null}{failure ? <p className="inline-error">{failure}</p> : null}</section>;
}

export default App;
