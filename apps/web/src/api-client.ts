import type { RuntimeCheck } from "@c-assistant/agent-adapters";
import type { ConnectorResult, WeatherSnapshot } from "@c-assistant/connectors";
import type {
  AgentRuntimeKind,
  BookingImportPreview,
  DirectBlueprintAssistedReplanningHandoff,
  DirectBlueprintReplanRequirement,
  DirectBlueprintRevision,
  DirectBlueprintRevisionBatchMetadata,
  Plan,
  PlanChangeImpactPreview,
  PlanChangeSet,
  PlanningProposal,
  PlanningSession,
  Profile,
  TravelBooking,
  WorkspaceSnapshot
} from "@c-assistant/core";

export type LocalConfiguration = {
  google?: { configured: boolean };
  uber?: { configured: boolean };
  telegram?: { configured: boolean };
};

export type LocalConfigurationForm = {
  googleMapsApiKey: string;
  uberClientId: string;
  telegramBotToken: string;
};

export type PlanGenerationState = {
  runId: string;
  sessionId: string;
  generationKey?: string;
  stage: "queued" | "research" | "itinerary" | "import" | "compile" | "ready" | "failed" | "cancelled";
  status: "running" | "succeeded" | "failed" | "cancelled";
  startedAt: string;
  updatedAt: string;
  scopeLabel?: string;
  savedPlaceCount?: number;
  failureCode?: string;
  message?: string;
};

export type AgentChatResponse = Partial<WorkspaceSnapshot> & {
  reply?: string;
  workspace?: WorkspaceSnapshot;
  planningSession?: PlanningSession;
  proposal?: PlanningProposal;
  planningStatus?: PlanningSession["status"];
  generated?: boolean;
  accepted?: boolean;
  generation?: PlanGenerationState;
  followUpQuestion?: string;
  readyForReview?: boolean;
  evidenceStatus?: "verified" | "partial";
  error?: string;
};

export type BookingScope = { type: "planning"; sessionId?: string } | { type: "plan"; planId: string };

export type MapSearchResponse = {
  status?: string;
  data?: Array<{ location?: string }>;
};

export type PlanPresentationPatch = {
  expectedVersion: number;
  assignments: Record<string, string>;
  priorities: Record<string, string>;
  orders: Record<string, string[]>;
  replanPrompt?: string;
};

export type PlanPresentationResponse = WorkspaceSnapshot & {
  workspace?: WorkspaceSnapshot;
  error?: string;
};

export type VersionedPlanMutationRequest = {
  expectedVersion: number;
  expectedBlueprintVersion?: number;
};

export type PlanRouteRefreshRequest = VersionedPlanMutationRequest & {
  segmentIds: string[];
};

export type PlanRouteRefreshResponse = {
  workspace: WorkspaceSnapshot;
  routeRefresh: {
    segmentIds: string[];
    refreshedSegmentIds: string[];
    scheduleConflictDayIds: string[];
    failedSegmentIds?: string[];
  };
  error?: string;
};

export type DirectBlueprintRevisionRequest = DirectBlueprintRevision extends infer Revision
  ? Revision extends DirectBlueprintRevision
    ? Omit<Revision, "createdAt"> & VersionedPlanMutationRequest
    : never
  : never;

export type DirectBlueprintRevisionInput = DirectBlueprintRevision extends infer Revision
  ? Revision extends DirectBlueprintRevision
    ? Omit<Revision, "createdAt">
    : never
  : never;

export type DirectBlueprintRevisionBatchRequest = VersionedPlanMutationRequest & {
  revisions: DirectBlueprintRevisionInput[];
};

export type DirectBlueprintAssistedReplanningRequest = VersionedPlanMutationRequest & {
  replanRequirement: DirectBlueprintReplanRequirement;
  revisions: DirectBlueprintRevisionInput[];
};

export type DirectBlueprintRevisionResponse = WorkspaceSnapshot & {
  workspace: WorkspaceSnapshot;
  revision: DirectBlueprintRevisionBatchMetadata;
  error?: string;
};

export type DirectBlueprintAssistedReplanningResponse = {
  workspace: WorkspaceSnapshot;
  handoff: DirectBlueprintAssistedReplanningHandoff;
  error?: string;
};

export type DirectBlueprintRevisionErrorResponse = {
  error?: string;
  code?: string;
  replanRequirement?: DirectBlueprintReplanRequirement;
};

export type ConnectorTestKind = "google" | "uber" | "telegram";

export type ConnectorTestResponse = {
  status?: string;
  maps?: { status?: string; failure?: { message?: string } };
  failure?: { message?: string };
  error?: string;
};

export type RuntimeTestResponse = { ok?: boolean; message?: string; error?: string };

function payloadErrorMessage(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const candidate = payload as { error?: unknown; message?: unknown };
  if (typeof candidate.error === "string" && candidate.error.trim()) return candidate.error;
  if (typeof candidate.message === "string" && candidate.message.trim()) return candidate.message;
  return undefined;
}

async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text.trim()) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    if (!response.ok) return { error: text.trim() || `HTTP ${response.status}` } as T;
    throw new Error("The core service returned a response that was not valid JSON.");
  }
}

export class ApiRequestError extends Error {
  readonly status: number;
  readonly payload: unknown;

  constructor(message: string, status: number, payload: unknown) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.payload = payload;
  }
}

function requestNetworkFailureMessage(path: string, defaultError: string): string {
  if (path === "/api/workspace") return "Landi could not reach the core service. Start or restart the backend, then try again.";
  return defaultError;
}

async function requestJson<T>(path: string, init: RequestInit | undefined, defaultError: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new Error(requestNetworkFailureMessage(path, defaultError));
  }
  const payload = await readJson<T & { error?: string; message?: string }>(response);
  if (!response.ok) throw new ApiRequestError(payloadErrorMessage(payload) ?? defaultError, response.status, payload);
  return payload;
}

async function optionalJson<T>(path: string, init?: RequestInit): Promise<T | undefined> {
  try {
    const response = await fetch(path, init);
    if (!response.ok) return undefined;
    return await readJson<T>(response);
  } catch {
    return undefined;
  }
}

function jsonRequest(method: "POST" | "PUT" | "PATCH", body?: unknown): RequestInit {
  return {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  };
}

function bookingBasePath(scope: BookingScope): string {
  if (scope.type === "plan") return `/api/plans/${encodeURIComponent(scope.planId)}/bookings`;
  if (scope.sessionId) return `/api/planning-sessions/${encodeURIComponent(scope.sessionId)}/bookings`;
  return "/api/planning-sessions/bookings";
}

export async function getWorkspace(init?: RequestInit): Promise<WorkspaceSnapshot> {
  const workspace = await requestJson<WorkspaceSnapshot>("/api/workspace", init, "Landi could not load the workspace from the core service.");
  if (!workspace || typeof workspace !== "object" || !("profile" in workspace) || !("runtime" in workspace) || !("activePlan" in workspace)) {
    throw new Error("The core service responded, but the workspace data was incomplete.");
  }
  return workspace;
}

export async function listPlanHistory(): Promise<Plan[] | undefined> {
  return await optionalJson<Plan[]>("/api/plans/history");
}

export async function getSettingsSnapshot(): Promise<{ configuration?: LocalConfiguration; runtimeChecks?: RuntimeCheck[] }> {
  const [configuration, runtimeChecks] = await Promise.all([
    optionalJson<LocalConfiguration>("/api/configuration"),
    optionalJson<RuntimeCheck[]>("/api/runtimes")
  ]);
  return {
    ...(configuration ? { configuration } : {}),
    ...(runtimeChecks ? { runtimeChecks } : {})
  };
}

export async function deleteHistoricalPlan(planId: string): Promise<void> {
  await requestJson<unknown>(`/api/plans/${encodeURIComponent(planId)}/history`, { method: "DELETE" }, "Unable to delete the archived plan.");
}

export async function setPlanTaskChecked(planId: string, taskId: string, checked: boolean): Promise<WorkspaceSnapshot> {
  return await requestJson<WorkspaceSnapshot>(
    `/api/plans/${encodeURIComponent(planId)}/tasks/${encodeURIComponent(taskId)}/check`,
    jsonRequest("PATCH", { checked }),
    "Unable to save the checklist status."
  );
}

export async function reorderPlanTask(planId: string, taskId: string, direction: "up" | "down", expectedVersion: number): Promise<{ workspace: WorkspaceSnapshot; change?: PlanChangeSet; error?: string }> {
  const response = await fetch(`/api/plans/${encodeURIComponent(planId)}/changes`, jsonRequest("POST", { kind: "reorder_task", taskId, direction, expectedVersion }));
  const payload = await readJson<{ workspace?: WorkspaceSnapshot; change?: PlanChangeSet; error?: string }>(response);
  if (!response.ok || !payload.workspace) throw new Error(payload.error ?? "Unable to reorder the itinerary.");
  return { ...payload, workspace: payload.workspace };
}

export async function undoPlanChange(planId: string, changeId: string, expectedVersion: number): Promise<WorkspaceSnapshot> {
  return await requestJson<WorkspaceSnapshot>(
    `/api/plans/${encodeURIComponent(planId)}/changes/${encodeURIComponent(changeId)}/undo`,
    jsonRequest("POST", { expectedVersion }),
    "Unable to undo the change."
  );
}

export async function applyDirectBlueprintRevision(planId: string, body: DirectBlueprintRevisionRequest): Promise<WorkspaceSnapshot> {
  const payload = await requestJson<DirectBlueprintRevisionResponse>(
    `/api/plans/${encodeURIComponent(planId)}/blueprint-revisions/direct`,
    jsonRequest("POST", body),
    "Unable to update this itinerary directly."
  );
  return payload.workspace;
}

export async function applyDirectBlueprintRevisionBatch(planId: string, body: DirectBlueprintRevisionBatchRequest): Promise<DirectBlueprintRevisionResponse> {
  return await requestJson<DirectBlueprintRevisionResponse>(
    `/api/plans/${encodeURIComponent(planId)}/blueprint-revisions/direct`,
    jsonRequest("POST", body),
    "Unable to update this itinerary directly."
  );
}

export async function prepareDirectBlueprintAssistedReplanning(planId: string, body: DirectBlueprintAssistedReplanningRequest): Promise<DirectBlueprintAssistedReplanningResponse> {
  return await requestJson<DirectBlueprintAssistedReplanningResponse>(
    `/api/plans/${encodeURIComponent(planId)}/blueprint-revisions/assisted-replanning`,
    jsonRequest("POST", body),
    "Unable to prepare assisted replanning for this itinerary edit."
  );
}

export async function refreshPlanRoutes(planId: string, body: PlanRouteRefreshRequest): Promise<PlanRouteRefreshResponse> {
  return await requestJson<PlanRouteRefreshResponse>(
    `/api/plans/${encodeURIComponent(planId)}/presentation/routes/refresh`,
    jsonRequest("POST", body),
    "Unable to refresh the itinerary routes."
  );
}

export async function confirmPlan(planId: string): Promise<WorkspaceSnapshot> {
  return await requestJson<WorkspaceSnapshot>(`/api/plans/${encodeURIComponent(planId)}/confirm`, { method: "POST" }, "Unable to confirm the plan.");
}

export async function cancelPlanningGeneration(sessionId: string): Promise<void> {
  await requestJson<unknown>(`/api/planning-sessions/${encodeURIComponent(sessionId)}/generation/cancel`, { method: "POST" }, "Unable to cancel generation.");
}

export async function deletePlanningSession(sessionId: string): Promise<WorkspaceSnapshot> {
  return await requestJson<WorkspaceSnapshot>(`/api/planning-sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" }, "Unable to abandon this planning session.");
}

export async function deletePlan(planId: string): Promise<WorkspaceSnapshot> {
  return await requestJson<WorkspaceSnapshot>(`/api/plans/${encodeURIComponent(planId)}`, { method: "DELETE" }, "Unable to discard this plan draft.");
}

export async function abandonActivePlan(planId: string): Promise<WorkspaceSnapshot> {
  return await requestJson<WorkspaceSnapshot>(`/api/plans/${encodeURIComponent(planId)}/abandon`, { method: "POST" }, "Unable to abandon the active plan.");
}

export async function sendAgentChat(body: {
  mode: "new_plan" | "revise_plan";
  message: string;
  expectedPlanId?: string;
  expectedVersion?: number;
  impactConfirmed?: boolean;
  assistedReplanning?: DirectBlueprintAssistedReplanningHandoff;
}): Promise<AgentChatResponse> {
  return await requestJson<AgentChatResponse>("/api/agent/chat", jsonRequest("POST", body), "Landi is temporarily unavailable.");
}

export async function undoPlanReplacement(planId: string, expectedVersion: number): Promise<WorkspaceSnapshot> {
  return await requestJson<WorkspaceSnapshot>(
    `/api/plans/${encodeURIComponent(planId)}/replacement/undo`,
    jsonRequest("POST", { expectedVersion }),
    "Unable to undo the latest plan replacement."
  );
}

export async function linkPlanAccommodation(planId: string, body: { expectedVersion: number; name: string; address: string; status: "confirmed" | "candidate" }): Promise<{ workspace: WorkspaceSnapshot; impact?: { affectedDays: number; verifiedDays: number; pendingDays: number }; error?: string }> {
  const response = await fetch(`/api/plans/${encodeURIComponent(planId)}/accommodation/linked`, jsonRequest("POST", body));
  const payload = await readJson<{ workspace?: WorkspaceSnapshot; impact?: { affectedDays: number; verifiedDays: number; pendingDays: number }; error?: string }>(response);
  if (!response.ok || !payload.workspace) throw new Error(payload.error ?? "Unable to link the accommodation to the current plan.");
  return { ...payload, workspace: payload.workspace };
}

export async function listBookings(scope: BookingScope): Promise<{ bookings?: TravelBooking[] } | undefined> {
  if (scope.type === "planning" && !scope.sessionId) return { bookings: [] };
  return await optionalJson<{ bookings?: TravelBooking[] }>(bookingBasePath(scope), { cache: "no-store" });
}

export async function previewBookingImport(scope: BookingScope, source: { sourceLabel: string; content: string }): Promise<BookingImportPreview> {
  return await requestJson<BookingImportPreview>(`${bookingBasePath(scope)}/import-preview`, jsonRequest("POST", source), `Unable to preview ${source.sourceLabel}.`);
}

export async function confirmBookingImport(scope: BookingScope, body: { booking: TravelBooking; sourceContent: string; expectedVersion?: number }): Promise<{ workspace: WorkspaceSnapshot; planningSession?: PlanningSession; booking?: TravelBooking; requiresBlueprintRevision?: boolean; error?: string }> {
  const response = await fetch(`${bookingBasePath(scope)}/import-confirm`, jsonRequest("POST", body));
  const payload = await readJson<{ workspace?: WorkspaceSnapshot; planningSession?: PlanningSession; booking?: TravelBooking; requiresBlueprintRevision?: boolean; error?: string }>(response);
  if (!response.ok || !payload.workspace) throw new Error(payload.error ?? "Unable to save this booking.");
  return { ...payload, workspace: payload.workspace };
}

export async function saveProfile(profile: Profile): Promise<WorkspaceSnapshot> {
  return await requestJson<WorkspaceSnapshot>("/api/profile", jsonRequest("PUT", profile), "Unable to save profile details.");
}

export async function saveConfiguration(form: LocalConfigurationForm): Promise<LocalConfiguration> {
  return await requestJson<LocalConfiguration>("/api/configuration", jsonRequest("PUT", form), "Unable to save API configuration.");
}

export async function testConnector(kind: ConnectorTestKind): Promise<ConnectorTestResponse> {
  const path = kind === "google" ? "/api/connectors/google" : kind === "uber" ? "/api/connectors/uber" : "/api/connectors/telegram/verify";
  const response = await fetch(path, kind === "telegram" ? { method: "POST" } : undefined);
  const payload = await readJson<ConnectorTestResponse>(response);
  const status = kind === "google" ? payload.maps?.status : payload.status;
  if (!response.ok || status === "unavailable" || status === "misconfigured") throw new Error(payload.error ?? payload.maps?.failure?.message ?? payload.failure?.message ?? "Connection failed");
  return payload;
}

export async function selectRuntime(kind: AgentRuntimeKind): Promise<WorkspaceSnapshot> {
  return await requestJson<WorkspaceSnapshot>("/api/runtime", jsonRequest("PUT", { kind }), "Unable to switch AI Agent runtime.");
}

export async function listRuntimes(): Promise<RuntimeCheck[] | undefined> {
  return await optionalJson<RuntimeCheck[]>("/api/runtimes");
}

export async function testRuntime(kind: AgentRuntimeKind): Promise<RuntimeTestResponse> {
  const response = await fetch(`/api/runtimes/${kind}/test`, { method: "POST" });
  const payload = await readJson<RuntimeTestResponse>(response);
  if (!response.ok || !payload.ok) throw new Error(payload.error ?? payload.message ?? "Test failed");
  return payload;
}

export async function getPlanningGeneration(sessionId: string): Promise<{ sessionStatus: PlanningSession["status"]; generation: PlanGenerationState | null } | undefined> {
  return await optionalJson<{ sessionStatus: PlanningSession["status"]; generation: PlanGenerationState | null }>(`/api/planning-sessions/${encodeURIComponent(sessionId)}/generation`, { cache: "no-store" });
}

export function planningGenerationEventsUrl(sessionId: string): string {
  return `/api/planning-sessions/${encodeURIComponent(sessionId)}/generation/events`;
}

export async function confirmPlanningProposal(sessionId: string, proposalVersion: number): Promise<AgentChatResponse> {
  return await requestJson<AgentChatResponse>(
    `/api/planning-sessions/${encodeURIComponent(sessionId)}/confirm`,
    jsonRequest("POST", { proposalVersion }),
    "Plan confirmation did not finish."
  );
}

export async function previewPlanChangeImpact(planId: string, message: string, expectedVersion: number): Promise<PlanChangeImpactPreview> {
  return await requestJson<PlanChangeImpactPreview>(
    `/api/plans/${encodeURIComponent(planId)}/change-impact`,
    jsonRequest("POST", { message, expectedVersion }),
    "Unable to assess the impact of this change."
  );
}

export async function patchPlanPresentation(planId: string, patch: PlanPresentationPatch): Promise<PlanPresentationResponse> {
  const response = await fetch(`/api/plans/${encodeURIComponent(planId)}/presentation`, jsonRequest("PATCH", patch));
  const payload = await readJson<PlanPresentationResponse>(response);
  if (!response.ok || !payload.activePlan) throw new Error(payload.error ?? "The map changes could not be saved to the plan.");
  return payload;
}

export async function searchMapPlaces(query: string, region?: string): Promise<MapSearchResponse | undefined> {
  const suffix = region ? `&region=${encodeURIComponent(region)}` : "";
  return await optionalJson<MapSearchResponse>(`/api/maps/places?query=${encodeURIComponent(query)}${suffix}`);
}

export async function getCurrentWeather(location: string, coordinates?: [number, number]): Promise<WeatherSnapshot> {
  const parameters = new URLSearchParams({ location, language: "en" });
  if (coordinates) parameters.set("coordinates", `${coordinates[1]},${coordinates[0]}`);
  const response = await fetch(`/api/weather?${parameters.toString()}`);
  const payload = await readJson<ConnectorResult<WeatherSnapshot> & { error?: string }>(response);
  if (!response.ok || payload.status !== "available" || !payload.data) throw new Error(payload.error ?? payload.failure?.message ?? "Weather is temporarily unavailable");
  return payload.data;
}
