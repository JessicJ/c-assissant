import { workspaceMutationMessages } from "@c-assistant/core/workspace-mutation-error";
import { checkedBookingReviewContext, type BookingRelationshipReviewContext } from "./booking-relationship-review.js";
import { checkedBookingImportReceipt } from "./booking-import-recovery.js";
import type { ConnectorResult, WeatherSnapshot } from "@c-assistant/connectors";
import { checkedPlanningSaveReceipt, savedProcessingUnverified, type PlanningSaveReceipt } from './planning-work-display.js';
import type {
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
  TripBlueprint,
  WorkspaceSnapshot
} from "@c-assistant/core";

export type LocalConfiguration = {
  google?: { configured: boolean };
  uber?: { configured: boolean };
};

export type LocalConfigurationForm = {
  googleMapsApiKey: string;
  uberClientId: string;
};

export type PlanGenerationState = {
  runId: string;
  sessionId: string;
  generationKey?: string;
  outputPlanId?: string;
  stage: "queued" | "research" | "itinerary" | "import" | "compile" | "ready" | "failed" | "cancelled";
  status: "running" | "succeeded" | "failed" | "cancelled";
  startedAt: string;
  updatedAt: string;
  scopeLabel?: string;
  savedPlaceCount?: number;
  failureCode?: string;
  message?: string;
};

export type PlanningGenerationResponse = {
  sessionStatus: PlanningSession["status"];
  outputPlanId?: string;
  generation: PlanGenerationState | null;
  snapshot?: {
    generationKey: string;
    proposalRef: { sessionId: string; proposalVersion: number };
    status: string;
    failure?: { resumable: boolean };
  } | null;
};

export type AgentChatResponse = Partial<WorkspaceSnapshot> & {
  reply?: string;
  workspace?: WorkspaceSnapshot;
  planningSession?: PlanningSession;
  proposal?: PlanningProposal;
  planningStatus?: PlanningSession["status"];
  planningRevision?: number;
  savedRevision?: number;
  requirementsSaved?: boolean;
  saveReceipt?: PlanningSaveReceipt;
  blocked?: boolean;
  processingPending?: boolean;
  processingCode?: string;
  mahTask?: { taskId: string; received: boolean; status: string };
  generated?: boolean;
  accepted?: boolean;
  generation?: PlanGenerationState;
  followUpQuestion?: string;
  readyForReview?: boolean;
  evidenceStatus?: "verified" | "partial";
  error?: string;
};

export type BookingScope = { type: "planning"; sessionId?: string } | { type: "plan"; planId: string };

export async function getBookingRelationshipReview(plan: { id: string; version: number }, blueprint: TripBlueprint): Promise<BookingRelationshipReviewContext> {
  const value = await requestJson<unknown>(`/api/plans/${encodeURIComponent(plan.id)}/booking-relationship-review`, { cache: "no-store" }, "Booking links could not be loaded. Keep your draft and try again.");
  const context = checkedBookingReviewContext(value, plan, blueprint);
  if (!context) throw new ApiRequestError("The booking links have changed. Refresh and review them again.", 200, undefined);
  return context;
}

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

export type DirectBlueprintRevisionInput = DirectBlueprintRevision extends infer Revision
  ? Revision extends DirectBlueprintRevision
    ? Omit<Revision, "createdAt">
    : never
  : never;

export type DirectBlueprintRevisionBatchRequest = VersionedPlanMutationRequest & {
  requestId?: string;
  highImpactConfirmation?: string;
  recoveryBinding?: import("./direct-blueprint-recovery.js").RecoveryBinding;
  revisions: DirectBlueprintRevisionInput[];
};

export type DirectBlueprintAssistedReplanningRequest = VersionedPlanMutationRequest & {
  replanRequirement: DirectBlueprintReplanRequirement;
  revisions: DirectBlueprintRevisionInput[];
};

export type DirectBlueprintRevisionResponse = WorkspaceSnapshot & {
  beforeIdentity?: Readonly<{planId:string;planVersion:number;blueprintId:string;blueprintVersion:number}>;
  workspace: WorkspaceSnapshot;
  revision: DirectBlueprintRevisionBatchMetadata;
  originalResult?: BlueprintOriginalResult;
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

export type ConnectorTestKind = "google" | "uber";

export type ConnectorTestResponse = {
  status?: string;
  maps?: { status?: string; failure?: { message?: string } };
  failure?: { message?: string };
  error?: string;
};


const publicErrorMessages: Record<string, string> = {
  ...workspaceMutationMessages,
  blueprint_required: "This older itinerary needs a new travel blueprint before it can be reviewed. Keep your original information until replanning is available.",
  assisted_replanning_required: "This change affects protected arrangements. Review the impact and ask Landi to help adjust them.",
  high_impact_confirmation_required: "This change affects important arrangements. Review the impact before confirming.",
  missing_presentation: "This plan has no itinerary to update. Refresh the workspace.",
  missing_segment: "This route is no longer available. Check the latest itinerary.",
  missing_place: "The places linked to this route have changed. Check the latest itinerary.",
  unsupported_mode: "Automatic route updates are not available for this transport mode."
};
export function safePlanError(caught: unknown, fallback = "The operation could not be completed. Keep your draft and check the result before trying again.") : string {
  const code = caught instanceof ApiRequestError ? caught.code : undefined;
  return code && Object.hasOwn(publicErrorMessages, code) ? publicErrorMessages[code]! : fallback;
}
export function isDefiniteMutationRejection(caught: unknown): boolean {
  return caught instanceof ApiRequestError && caught.status >= 400 && caught.status < 500 && Boolean(caught.code && caught.code !== "internal_error" && Object.hasOwn(publicErrorMessages, caught.code));
}
async function readJson<T>(response: Response, allowEmptySuccess = false): Promise<T> {
  try {
    const raw = await response.text();
    if (response.ok && allowEmptySuccess && !raw.trim()) return {} as T;
    const value: unknown = JSON.parse(raw);
    if (value === null || typeof value !== "object") throw new Error();
    // error和message均不是可信的产品文案来源。
    if (!Array.isArray(value)) {
      const record = value as Record<string, unknown>;
      if ("error" in record) record.error = "The operation could not be completed. Please check the result later.";
      if ("message" in record) record.message = "The operation could not be completed. Please check the result later.";
    }
    return value as T;
  } catch { throw new ApiRequestError("The operation result could not be verified. Keep your draft and check again later.", response.status, undefined); }
}
export class ApiRequestError extends Error {
  readonly code: string | undefined;
  constructor(message: string, readonly status: number, readonly payload: unknown) {
    super(message);
    this.name = "ApiRequestError";
    this.code = payload && typeof payload === "object" && "code" in payload && typeof payload.code === "string" ? payload.code : undefined;
  }
}
async function requestJson<T>(path: string, init: RequestInit | undefined, defaultError: string, allowEmptySuccess = false): Promise<T> {
  let response: Response;
  try { response = await fetch(path, init); }
  catch { throw new ApiRequestError("Landi could not be reached. Keep your draft and check the result later.", 0, undefined); }
  const payload = await readJson<T>(response, allowEmptySuccess);
  if (!response.ok) {
    const failure = new ApiRequestError(defaultError, response.status, payload);
    throw new ApiRequestError(safePlanError(failure), response.status, payload);
  }
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

export async function listPlanHistory(): Promise<Plan[]> {
  const plans = await requestJson<Plan[]>("/api/plans/history", { cache: "no-store" }, "Landi could not load plan history. Previously loaded plans have been kept.");
  if (!Array.isArray(plans)) throw new Error("The core service returned incomplete plan history. Previously loaded plans have been kept.");
  return plans;
}

export async function getSettingsSnapshot(): Promise<{ configuration?: LocalConfiguration }> {
  const configuration = await optionalJson<LocalConfiguration>("/api/configuration");
  return configuration ? { configuration } : {};
}

export async function deleteHistoricalPlan(planId: string): Promise<void> {
  await requestJson<unknown>(`/api/plans/${encodeURIComponent(planId)}/history`, { method: "DELETE" }, "Unable to delete the archived plan.", true);
}

export async function setPlanTaskChecked(planId: string, taskId: string, checked: boolean): Promise<WorkspaceSnapshot> {
  return await requestWorkspaceJson(
    `/api/plans/${encodeURIComponent(planId)}/tasks/${encodeURIComponent(taskId)}/check`,
    jsonRequest("PATCH", { checked }),
    "Unable to save the checklist status."
  );
}

export async function reorderPlanTask(planId: string, taskId: string, direction: "up" | "down", expectedVersion: number): Promise<{ workspace: WorkspaceSnapshot; change?: PlanChangeSet; error?: string }> {
  const payload = await requestJson<{ workspace: WorkspaceSnapshot; change?: PlanChangeSet }>(`/api/plans/${encodeURIComponent(planId)}/changes`, jsonRequest("POST", { kind: "reorder_task", taskId, direction, expectedVersion }), "The itinerary order could not be updated. Please check the result later.");
  if (!isMutationWorkspace(payload.workspace)) throw new ApiRequestError("The operation result could not be verified.", 200, undefined);
  return payload;
}

export async function undoPlanChange(planId: string, changeId: string, expectedVersion: number): Promise<WorkspaceSnapshot> {
  return await requestWorkspaceJson(
    `/api/plans/${encodeURIComponent(planId)}/changes/${encodeURIComponent(changeId)}/undo`,
    jsonRequest("POST", { expectedVersion }),
    "Unable to undo the change."
  );
}

export function isMutationWorkspace(value: unknown): value is WorkspaceSnapshot {
  if (!value || typeof value !== "object") return false;
  const workspace = value as Partial<WorkspaceSnapshot>, plan = workspace.activePlan;
  return Boolean(workspace.profile && typeof workspace.profile === "object" && workspace.runtime && typeof workspace.runtime === "object"
    && Array.isArray(workspace.destinationArrivals) && Array.isArray(workspace.inbox) && Array.isArray(workspace.sourceSnapshots)
    && workspace.system && typeof workspace.system === "object" && plan && typeof plan.id === "string" && plan.id
    && Number.isSafeInteger(plan.version) && plan.version > 0 && ["draft", "active", "completed", "cancelled"].includes(plan.status)
    && Array.isArray(plan.stages) && Array.isArray(plan.knownInformation) && Array.isArray(plan.assumptions) && Array.isArray(plan.sources)
    && plan.configuration && typeof plan.configuration === "object");
}
async function requestWorkspaceJson(path: string, init: RequestInit | undefined, defaultError: string): Promise<WorkspaceSnapshot> {
  const result = await requestJson<WorkspaceSnapshot>(path, init, defaultError);
  if (!isMutationWorkspace(result)) throw new ApiRequestError("The operation result could not be verified.", 200, undefined);
  return result;
}
function isRevisionReceipt(value: unknown): value is DirectBlueprintRevisionBatchMetadata {
  if (!value || typeof value !== "object") return false;
  const revision = value as Partial<DirectBlueprintRevisionBatchMetadata>;
  return typeof revision.id === "string" && Boolean(revision.id) && Number.isSafeInteger(revision.baseBlueprintVersion)
    && Number.isSafeInteger(revision.appliedBlueprintVersion) && Number.isSafeInteger(revision.revisionCount)
    && Array.isArray(revision.kinds) && Array.isArray(revision.affectedDayIds) && Array.isArray(revision.affectedPlaceIds)
    && Array.isArray(revision.revisions) && Boolean(revision.routeRefresh && Array.isArray(revision.routeRefresh.dayIds) && Array.isArray(revision.routeRefresh.movementIds))
    && Boolean(revision.undo && Array.isArray(revision.undo.previousDays) && Array.isArray(revision.undo.previousMovements) && Array.isArray(revision.undo.previousPlaces));
}
export async function applyDirectBlueprintRevisionBatch(planId: string, body: DirectBlueprintRevisionBatchRequest): Promise<DirectBlueprintRevisionResponse> {
  const result = await requestJson<DirectBlueprintRevisionResponse>(`/api/plans/${encodeURIComponent(planId)}/blueprint-revisions/direct`, jsonRequest("POST", body), "The change could not be saved. Keep your draft and check the result.");
  if (!isMutationWorkspace(result.workspace) || !isRevisionReceipt(result.revision)) throw new ApiRequestError("The save result could not be verified.", 200, undefined);
  return result;
}
export type DirectBlueprintReceiptIdentity = {
  operation: "save" | "undo"; requestId: string; requestDigest: string; expectedPlanId: string;
  expectedVersion: number; expectedBlueprintVersion: number; revisionId?: string;
};
export type BlueprintOriginalResult = { planId: string; planVersion: number; blueprintId: string; blueprintVersion: number; sourceSetDigest: string; targetDigests: Record<string, string>; revisionKinds: string[]; recoveryBinding?: import("./direct-blueprint-recovery.js").RecoveryBinding };
export type DirectBlueprintReceipt = DirectBlueprintReceiptIdentity & ({ status: "not_found" } | { status: "committed"; workspace: WorkspaceSnapshot; revision?: DirectBlueprintRevisionBatchMetadata; originalResult?: BlueprintOriginalResult });
export async function getDirectBlueprintReceipt(identity: DirectBlueprintReceiptIdentity): Promise<DirectBlueprintReceipt> {
  const query = new URLSearchParams({ operation: identity.operation, expectedVersion: String(identity.expectedVersion), expectedBlueprintVersion: String(identity.expectedBlueprintVersion), requestDigest: identity.requestDigest });
  if (identity.revisionId) query.set("revisionId", identity.revisionId);
  const result = await requestJson<DirectBlueprintReceipt>(`/api/plans/${encodeURIComponent(identity.expectedPlanId)}/blueprint-revisions/receipts/${encodeURIComponent(identity.requestId)}?${query}`, { cache: "no-store" }, "The save result could not be checked. Please try checking again later.");
  if (!result || !Object.entries(identity).every(([key, value]) => result[key as keyof DirectBlueprintReceiptIdentity] === value) || (result.status !== "committed" && result.status !== "not_found") || (result.status === "committed" && (!isMutationWorkspace(result.workspace) || (identity.operation === "save" && !isRevisionReceipt(result.revision))))) throw new ApiRequestError("The acknowledgement could not be matched to the original operation.", 200, undefined);
  return result;
}

export async function prepareDirectBlueprintAssistedReplanning(planId: string, body: DirectBlueprintAssistedReplanningRequest): Promise<DirectBlueprintAssistedReplanningResponse> {
  const result = await requestJson<DirectBlueprintAssistedReplanningResponse>(
    `/api/plans/${encodeURIComponent(planId)}/blueprint-revisions/assisted-replanning`,
    jsonRequest("POST", body),
    "Unable to prepare assisted replanning for this itinerary edit."
  );
  if (!isMutationWorkspace(result.workspace) || result.handoff?.status !== "ready_for_assisted_replanning" || typeof result.handoff.request !== "string" || !Array.isArray(result.handoff.revisions) || !Array.isArray(result.handoff.affectedDayIds) || !Array.isArray(result.handoff.affectedPlaceIds)) throw new ApiRequestError("The replanning suggestion could not be verified.", 200, undefined);
  return result;
}

export async function refreshPlanRoutes(planId: string, body: PlanRouteRefreshRequest): Promise<PlanRouteRefreshResponse> {
  const result = await requestJson<PlanRouteRefreshResponse>(
    `/api/plans/${encodeURIComponent(planId)}/presentation/routes/refresh`,
    jsonRequest("POST", body),
    "Unable to refresh the itinerary routes."
  );
  const route = result.routeRefresh;
  if (!isMutationWorkspace(result.workspace) || !route || ![route.segmentIds, route.refreshedSegmentIds, route.scheduleConflictDayIds, route.failedSegmentIds ?? []].every((values) => Array.isArray(values) && values.every((value) => typeof value === "string"))) throw new ApiRequestError("The route update result could not be verified.", 200, undefined);
  return result;
}

export type ExactPlanConfirmation = { proposalDigest: string; context: import("@c-assistant/core").TravelAdjustmentContext };
export async function declarePreDeparture(context:import("@c-assistant/core").TravelAdjustmentContext):Promise<unknown> {
  return requestJson("/api/travel-adjustments/phase",jsonRequest("POST",{context,value:"pre_departure",declaration:true}),"Your travel phase has changed. Refresh before trying again.",true);
}
export type ReviewArrangement={title:string;days:{date:string;city:string;title:string;summary:string;lines:string[]}[];commitments:string[]};
export type ReviewSourceFact={label:string;value?:string;date?:string;localDateTime?:string};
export type ReviewObservation={safeFacts:ReviewSourceFact[];impact:string;activities:{title:string;date:string}[];subject:string|null;targetDate:string|null;sourceKind:string;status:string;factObservedAt:string|null;retrievedAt:string;validUntil:string|null};
export type PlanConfirmationReview={workspace:WorkspaceSnapshot;exactConfirmation:ExactPlanConfirmation;observations:ReviewObservation[];arrangements:{original:ReviewArrangement|null;replacement:ReviewArrangement|null}};
export async function getPlanConfirmationReview(planId: string): Promise<PlanConfirmationReview> {
  return requestJson(`/api/plans/${encodeURIComponent(planId)}/confirmation-review`,{cache:"no-store"},"Reload the itinerary awaiting confirmation.",true);
}

export async function confirmPlan(planId: string, expectedVersion: number, expectedBlueprintVersion?:number, expectedBase?:{id:string;version:number}, exactConfirmation?:ExactPlanConfirmation): Promise<WorkspaceSnapshot> {
  return await requestWorkspaceJson(`/api/plans/${encodeURIComponent(planId)}/confirm`, jsonRequest("POST", { expectedVersion,...(exactConfirmation?{exactConfirmation}:{}),...(expectedBlueprintVersion!==undefined?{expectedBlueprintVersion}:{}),...(expectedBase?{expectedBasePlanId:expectedBase.id,expectedBaseVersion:expectedBase.version}:{}) }), "Unable to confirm the plan.");
}

export async function cancelPlanningGeneration(sessionId: string): Promise<void> {
  await requestJson<unknown>(`/api/planning-sessions/${encodeURIComponent(sessionId)}/generation/cancel`, { method: "POST" }, "Unable to cancel generation.", true);
}

export async function deletePlanningSession(sessionId: string): Promise<WorkspaceSnapshot> {
  return await requestWorkspaceJson(`/api/planning-sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" }, "Unable to abandon this planning session.");
}

export async function deletePlan(planId: string): Promise<WorkspaceSnapshot> {
  return await requestWorkspaceJson(`/api/plans/${encodeURIComponent(planId)}`, { method: "DELETE" }, "Unable to discard this plan draft.");
}

export async function abandonActivePlan(planId: string): Promise<WorkspaceSnapshot> {
  return await requestWorkspaceJson(`/api/plans/${encodeURIComponent(planId)}/abandon`, { method: "POST" }, "Unable to abandon the active plan.");
}

export interface PlanningReturnBaseline { sessionId?: string; revision?: number; proposalVersion?: number | null }

export async function getPlanningReturnCheck(baseline: PlanningReturnBaseline): Promise<unknown> {
  if (!baseline.sessionId) return null;
  const query = new URLSearchParams();
  if (baseline.revision !== undefined) query.set("expectedRevision", String(baseline.revision));
  if (baseline.proposalVersion !== undefined) query.set("expectedProposalVersion", baseline.proposalVersion === null ? "none" : String(baseline.proposalVersion));
  return requestJson<unknown>(`/api/planning-sessions/${encodeURIComponent(baseline.sessionId)}/return-check?${query}`, { method: "GET", cache: "no-store", signal: AbortSignal.timeout(15000) }, "Unable to verify the saved planning session.");
}

/** Reads eligibility only. Generating still requires the explicit confirmation POST. */
export async function getPlanningGenerationAdmission(scope: { sessionId: string; revision: number; proposalVersion: number }): Promise<{ sessionId: string; revision: number; proposalVersion: number; ready: boolean; validUntil: number }> {
  const query = new URLSearchParams({ revision: String(scope.revision), proposalVersion: String(scope.proposalVersion) });
  return requestJson(`/api/planning-sessions/${encodeURIComponent(scope.sessionId)}/generation-admission?${query}`,
    { method: 'GET', cache: 'no-store', signal: AbortSignal.timeout(15000) }, 'Unable to check plan generation.');
}

export async function getPlanningRevision(sessionId: string): Promise<number> {
  return (await requestJson<{ revision: number }>(`/api/planning-sessions/${encodeURIComponent(sessionId)}/revision`, { cache: "no-store" }, "Unable to read the current requirements version.")).revision;
}

export async function getPlanningWorkStatus(sessionId: string, messageId: string): Promise<unknown> {
  return requestJson<unknown>(`/api/planning-sessions/${encodeURIComponent(sessionId)}/messages/${encodeURIComponent(messageId)}/status`,
    { method: 'GET', cache: 'no-store', signal: AbortSignal.timeout(15000) }, 'Unable to verify the saved planning task.');
}

/** 原文本只在浏览器求摘要；只读请求不携带旅行原文。 */
export async function getPlanningMessageSaveStatus(identity: { messageId: string; expectedRevision: number; sessionId?: string }, message: string): Promise<unknown> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({ text: message.trim() })));
  const inputSha256 = Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
  const query = new URLSearchParams({ expectedRevision: String(identity.expectedRevision), inputSha256 });
  if (identity.sessionId !== undefined) query.set('sessionId', identity.sessionId);
  const value = await requestJson<unknown>(`/api/planning-messages/${encodeURIComponent(identity.messageId)}/status?${query}`,
    { method: 'GET', cache: 'no-store', signal: AbortSignal.timeout(15000) }, 'Unable to verify the original save.');
  if (!value || typeof value !== 'object' || (value as { inputSha256?: unknown }).inputSha256 !== inputSha256) return null;
  return value;
}

export class PlanningRequirementsSaved extends Error {
  constructor(readonly saveReceipt: PlanningSaveReceipt) { super(savedProcessingUnverified); }
}

export class PlanningMessageRejected extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

export async function sendAgentChat(body: {
  messageId?: string;
  expectedRevision?: number;
  sessionId?: string;
  checkResultOnly?: boolean;
  mode: "new_plan" | "revise_plan";
  message: string;
  expectedPlanId?: string;
  expectedVersion?: number;
  impactConfirmed?: boolean;
  assistedReplanning?: DirectBlueprintAssistedReplanningHandoff;
}): Promise<AgentChatResponse> {
  if (body.mode === "revise_plan") return await requestJson<AgentChatResponse>("/api/agent/chat", jsonRequest("POST", body), "The itinerary could not be adjusted. Please check the result later.");
  const response = await fetch("/api/agent/chat", jsonRequest("POST", body));
  const payload = await readJson<AgentChatResponse & { code?: string }>(response);
  if (!response.ok) {
    const receipt = body.mode === 'new_plan' && payload.requirementsSaved === true ? checkedPlanningSaveReceipt(payload.saveReceipt, body) : null;
    if (receipt) throw new PlanningRequirementsSaved(receipt);
    if (body.mode === "new_plan" && response.status === 409 && payload.code) throw new PlanningMessageRejected(payload.code, "Refresh the workspace and review your request again.");
    throw new Error( "Landi is temporarily unavailable.");
  }
  const receipt = payload.requirementsSaved === true ? checkedPlanningSaveReceipt(payload.saveReceipt, body) : null;
  if (!receipt) throw new Error("The save acknowledgement could not be verified. Keep the original request to check again.");
  const sessions = [payload.planningSession, payload.workspace?.planningSession].filter((session): session is PlanningSession => session !== undefined);
  const contradictory = sessions.some(session => session.id !== receipt.sessionId || (Array.isArray(session.messages)
    && session.messages.some(message => message.id === receipt.messageId && (message.role !== 'user' || message.text !== body.message.trim()))))
    || (Number.isSafeInteger(payload.planningRevision) && payload.planningRevision! < receipt.savedRevision);
  if (contradictory) throw new Error("The original save evidence conflicts. Keep your text and original request to check again.");
  const matches = (session: PlanningSession | undefined) => session?.id === receipt.sessionId && Array.isArray(session.messages)
    && session.messages.some(message => message.id === receipt.messageId && message.role === 'user' && message.text === body.message.trim());
  if (!payload.workspace || !matches(payload.planningSession ?? payload.workspace.planningSession)
    || !Number.isSafeInteger(payload.planningRevision)) throw new PlanningRequirementsSaved(receipt);
  return payload;
}

export async function undoPlanReplacement(planId: string, expectedVersion: number): Promise<WorkspaceSnapshot> {
  return await requestWorkspaceJson(
    `/api/plans/${encodeURIComponent(planId)}/replacement/undo`,
    jsonRequest("POST", { expectedVersion }),
    "Unable to undo the latest plan replacement."
  );
}

export async function linkPlanAccommodation(planId: string, body: { expectedVersion: number; name: string; address: string; status: "confirmed" | "candidate" }): Promise<{ workspace: WorkspaceSnapshot; impact?: { affectedDays: number; verifiedDays: number; pendingDays: number }; error?: string }> {
  const payload = await requestJson<{ workspace: WorkspaceSnapshot; impact?: { affectedDays: number; verifiedDays: number; pendingDays: number }; error?: string }>(`/api/plans/${encodeURIComponent(planId)}/accommodation/linked`, jsonRequest("POST", body), "The accommodation could not be updated. Check the current itinerary.");
  if (!isMutationWorkspace(payload.workspace)) throw new ApiRequestError("The accommodation update result could not be verified.", 200, undefined);
  return payload;
}

export type BookingImportBaseline = { scope: BookingScope; expectedVersion?: number; expectedBlueprintVersion?: number; expectedSourceSetDigest?: string; expectedRevision?: number; expectedSessionId?: string | null; records: { bookingId: string; recordDigest: string }[]; bookings: TravelBooking[] };
export type BookingImportConfirmBody = Omit<BookingImportBaseline, "scope" | "records" | "bookings"> & { requestId: string; booking: TravelBooking; sourceContent: string; expectedRecordDigest?: string };
export type BookingImportResult = { workspace: WorkspaceSnapshot; planningSession?: PlanningSession; booking?: TravelBooking; requiresBlueprintRevision?: boolean };
export async function listBookings(scope: BookingScope): Promise<{ bookings?: TravelBooking[]; revision?: number; expectedVersion?: number; sourceSetDigest?: string; records?: { bookingId: string; recordDigest: string }[]; expectedSessionId?: string | null }> {
  return await requestJson(scope.type === "planning" && !scope.sessionId ? "/api/planning-sessions/bookings/context" : bookingBasePath(scope), { cache: "no-store" }, "Booking information could not be loaded. Please try again later.");
}
/** 基准只在预览前取得，确认时绝不补成服务端最新版本。 */
export async function getBookingImportBaseline(scope: BookingScope, expectedVersion?: number): Promise<BookingImportBaseline> {
  const listed = await listBookings(scope);
  if (!Array.isArray(listed.records) || !Array.isArray(listed.bookings)) throw new Error("The booking information is incomplete. Reopen the preview.");
  if (scope.type === "planning") {
    if (!Number.isSafeInteger(listed.revision) || listed.revision! < 0 || (!scope.sessionId && !("expectedSessionId" in listed))) throw new Error("The planning information has changed. Reopen the booking preview.");
    return { scope: structuredClone(scope), expectedRevision: listed.revision!, ...(!scope.sessionId ? { expectedSessionId: listed.expectedSessionId! } : {}), records: listed.records, bookings: listed.bookings };
  }
  const workspace = await getWorkspace({ cache: "no-store" });
  if (workspace.activePlan.id !== scope.planId || (expectedVersion !== undefined && workspace.activePlan.version !== expectedVersion) || listed.expectedVersion !== workspace.activePlan.version) throw new Error("The itinerary has changed. Refresh and reopen the booking preview.");
  if (!workspace.activeBlueprint) {
    if (typeof listed.sourceSetDigest !== "string" || !/^[a-f0-9]{64}$/.test(listed.sourceSetDigest)) throw new Error("The booking source information is incomplete. Open a new preview.");
    return { scope: structuredClone(scope), expectedVersion: workspace.activePlan.version, expectedSourceSetDigest: listed.sourceSetDigest, records: listed.records, bookings: listed.bookings };
  }
  const context = await getBookingRelationshipReview(workspace.activePlan, workspace.activeBlueprint);
  if (context.sourceRecords.some((record) => listed.records!.find((item) => item.bookingId === record.bookingId)?.recordDigest !== record.recordDigest)) throw new ApiRequestError("The booking information has changed. Open a new preview.", 409, { code: "version_conflict" });
  return { scope: structuredClone(scope), expectedVersion: context.expectedVersion, expectedBlueprintVersion: context.blueprintVersion, expectedSourceSetDigest: context.sourceSetDigest, records: context.sourceRecords.map((item) => ({ bookingId: item.bookingId, recordDigest: item.recordDigest })), bookings: listed.bookings };
}
export async function previewBookingImport(scope: BookingScope, source: { sourceLabel: string; content: string }): Promise<BookingImportPreview> {
  return await requestJson<BookingImportPreview>(`${bookingBasePath(scope)}/import-preview`, jsonRequest("POST", source), "This booking could not be previewed. Check its contents and try again.");
}
export async function confirmBookingImport(scope: BookingScope, body: BookingImportConfirmBody): Promise<BookingImportResult> {
  const payload = await requestJson<BookingImportResult>(`${bookingBasePath(scope)}/import-confirm`, jsonRequest("POST", body), "The booking save result is unverified. Check its acknowledgement first.");
  if (!isMutationWorkspace(payload.workspace)) throw new Error("The booking save result could not be verified. Check its acknowledgement first.");
  return payload;
}
export async function readBookingImportReceipt(record: import("./booking-import-recovery.js").BookingImportRecovery): Promise<import("./booking-import-recovery.js").BookingImportReceipt> {
  const query = new URLSearchParams({ requestDigest: record.requestDigest, identity: JSON.stringify(record.identity) });
  const value = await requestJson<unknown>(`/api/booking-mutations/receipts/${encodeURIComponent(record.requestId)}?${query}`, { cache: "no-store" }, "The booking save result could not be checked. Please check again later.");
  const checked = checkedBookingImportReceipt(value, record);
  if (!checked) throw new Error("The acknowledgement does not match the original booking operation. Your draft has been kept.");
  return checked;
}

export async function saveProfile(profile: Profile): Promise<WorkspaceSnapshot> {
  return await requestWorkspaceJson("/api/profile", jsonRequest("PUT", profile), "Unable to save profile details.");
}

export async function saveConfiguration(form: LocalConfigurationForm): Promise<LocalConfiguration> {
  return await requestJson<LocalConfiguration>("/api/configuration", jsonRequest("PUT", form), "Unable to save API configuration.");
}

export async function testConnector(kind: ConnectorTestKind): Promise<ConnectorTestResponse> {
  const path = kind === "google" ? "/api/connectors/google" : "/api/connectors/uber";
  const response = await fetch(path);
  const payload = await readJson<ConnectorTestResponse>(response);
  const status = kind === "google" ? payload.maps?.status : payload.status;
  if (!response.ok || status === "unavailable" || status === "misconfigured") throw new Error( "Connection failed");
  return payload;
}

export async function getPlanningGeneration(sessionId: string): Promise<PlanningGenerationResponse | undefined> {
  return await optionalJson<PlanningGenerationResponse>(`/api/planning-sessions/${encodeURIComponent(sessionId)}/generation`, { cache: "no-store" });
}

export function planningGenerationEventsUrl(sessionId: string): string {
  return `/api/planning-sessions/${encodeURIComponent(sessionId)}/generation/events`;
}

export async function confirmPlanningProposal(sessionId: string, proposalVersion: number, expectedRevision: number): Promise<AgentChatResponse> {
  return await requestJson<AgentChatResponse>(
    `/api/planning-sessions/${encodeURIComponent(sessionId)}/confirm`,
    jsonRequest("POST", { proposalVersion, expectedRevision }),
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
  return await requestWorkspaceJson(`/api/plans/${encodeURIComponent(planId)}/presentation`, jsonRequest("PATCH", patch), "The itinerary change result could not be verified.");
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
  if (!response.ok || payload.status !== "available" || !payload.data) throw new Error( "Weather is temporarily unavailable");
  return payload.data;
}

export async function undoDirectBlueprintRevision(planId: string, revisionId: string, body: VersionedPlanMutationRequest & { requestId: string }): Promise<WorkspaceSnapshot> {
  const result = await requestJson<WorkspaceSnapshot>(`/api/plans/${encodeURIComponent(planId)}/blueprint-revisions/${encodeURIComponent(revisionId)}/undo`, jsonRequest("POST", body), "Unable to undo the saved edit.");
  if (!isMutationWorkspace(result)) throw new ApiRequestError("The undo result could not be verified.", 200, undefined);
  return result;
}
