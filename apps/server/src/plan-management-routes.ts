import { reviewSourceFacts } from "./review-source-facts.js";
import { reviewArrangement } from "./email-plan-review.js";
import { createTravelAdjustmentApplication, exactPlanConfirmation, type ExactPlanConfirmation } from "./travel-adjustment-application.js";
import { WorkspaceMutationError } from "@c-assistant/core";
import { planOperationError, planOperationRouteOptions, planOperationRejection } from "./plan-operation-error.js";
import { activateReviewedPlan } from "./plan-activation.js";
import { compileExecutionItinerary } from "./execution-itinerary.js";
import { readExecutionState } from "./execution-state.js";
import type { FastifyInstance } from "fastify";
import type { BlueprintPlacePriority, DirectBlueprintReplanRequirement, DirectBlueprintRevision, PlanAccommodationInput, PlanArrivalInput, PlanTransportPreferenceInput, PlanTravelContextInput } from "@c-assistant/core";
import { prepareDirectBlueprintAssistedReplanningHandoff, parseBookingSourceLegacyBindings, type BookingRelationshipAssessment } from "@c-assistant/core";
import type { SqliteWorkspaceStore } from "@c-assistant/storage";
import { prepareAccommodationDepartures } from "./accommodation-departure.js";
import { connectorResponseStatus } from "./connector-bundle.js";
import { previewPlanChange } from "./plan-change-impact.js";
import type { PlanRouteMaps } from "./plan-route-refresh.js";

const MAX_DIRECT_BLUEPRINT_REVISIONS = 36;

export function registerPlanManagementRoutes(server: FastifyInstance, dependencies: {
  store: SqliteWorkspaceStore;
  getMaps: () => PlanRouteMaps;
  startActivePlanMonitoring: () => void;
  getGeneratingPlan?: () => boolean;
  travelAdjustmentCandidates?: {
    now?: ()=>Date;
    collect: (context:import("@c-assistant/core").TravelAdjustmentContext)=>Promise<Pick<import("@c-assistant/core").TravelAdjustmentInput,"observations"|"decision"|"replacement">>;
    verifyExecution?: (decision:NonNullable<import("@c-assistant/core").TravelAdjustmentInput["decision"]>,input:import("@c-assistant/core").TravelAdjustmentInput)=>boolean;
  };
}): void {
  const { store, getMaps, startActivePlanMonitoring, getGeneratingPlan = () => false } = dependencies;

  server.delete("/api/plans", planOperationRouteOptions, async () => store.resetPlansToEmptyState());
  server.delete<{ Params: { planId: string } }>("/api/plans/:planId", planOperationRouteOptions, async (request, reply) => {
    try {
      return store.discardCurrentDraft(request.params.planId);
    } catch (error) { const failure = planOperationError(error); return reply.code(failure.status).send(failure.body); }
  });
  server.post<{ Params: { planId: string } }>("/api/plans/:planId/abandon", planOperationRouteOptions, async (request, reply) => {
    try {
      return store.abandonActivePlan(request.params.planId);
    } catch (error) { const failure = planOperationError(error); return reply.code(failure.status).send(failure.body); }
  });
  server.get("/api/plans/history", planOperationRouteOptions, async () => store.listHistoricalPlans());
  server.delete("/api/plans/history", planOperationRouteOptions, async () => ({ deleted: store.clearHistoricalPlans() }));
  server.delete<{ Params: { planId: string } }>("/api/plans/:planId/history", planOperationRouteOptions, async (request, reply) => {
    try {
      if (!store.deleteHistoricalPlan(request.params.planId)) return reply.code(404).send( planOperationRejection("operation_not_found"));
      return { deleted: true };
    } catch (error) { const failure = planOperationError(error); return reply.code(failure.status).send(failure.body); }
  });

  server.post<{ Params: { planId: string }; Body: { expectedVersion?: number } }>("/api/plans/:planId/replacement/undo", planOperationRouteOptions, async (request, reply) => {
    if (typeof request.body?.expectedVersion !== "number") return reply.code(400).send( planOperationRejection("invalid_edit"));
    try {
      return store.undoLatestPlanReplacement({ expectedPlanId: request.params.planId, expectedVersion: request.body.expectedVersion });
    } catch (error) { const failure = planOperationError(error); return reply.code(failure.status).send(failure.body); }
  });
  server.patch<{ Params: { planId: string; taskId: string }; Body: { checked?: boolean } }>("/api/plans/:planId/tasks/:taskId/check", planOperationRouteOptions, async (request, reply) => {
    if (typeof request.body?.checked !== "boolean") return reply.code(400).send( planOperationRejection("invalid_edit"));
    try {
      return store.setPlanTaskChecked(request.params.planId, request.params.taskId, request.body.checked);
    } catch (error) { const failure = planOperationError(error); return reply.code(failure.status).send(failure.body); }
  });
  server.post<{ Params: { planId: string }; Body: { kind?: string; taskId?: string; direction?: string; expectedVersion?: number } }>("/api/plans/:planId/changes", planOperationRouteOptions, async (request, reply) => {
    if (request.body?.kind !== "reorder_task" || typeof request.body.taskId !== "string" || (request.body.direction !== "up" && request.body.direction !== "down") || typeof request.body.expectedVersion !== "number") {
      return reply.code(400).send( planOperationRejection("invalid_edit"));
    }
    try {
      return store.reorderPlanTask({ planId: request.params.planId, taskId: request.body.taskId, direction: request.body.direction, expectedVersion: request.body.expectedVersion });
    } catch (error) { const failure = planOperationError(error); return reply.code(failure.status).send(failure.body); }
  });
  server.post<{ Params: { planId: string; changeId: string }; Body: { expectedVersion?: number } }>("/api/plans/:planId/changes/:changeId/undo", planOperationRouteOptions, async (request, reply) => {
    if (typeof request.body?.expectedVersion !== "number") return reply.code(400).send( planOperationRejection("invalid_edit"));
    try {
      return store.undoPlanChange({ planId: request.params.planId, changeId: request.params.changeId, expectedVersion: request.body.expectedVersion });
    } catch (error) { const failure = planOperationError(error); return reply.code(failure.status).send(failure.body); }
  });

  server.get<{ Params: { planId: string; requestId: string }; Querystring: { operation?: string; requestDigest?: string; expectedVersion?: string; expectedBlueprintVersion?: string; revisionId?: string } }>("/api/plans/:planId/blueprint-revisions/receipts/:requestId", planOperationRouteOptions, async (request, reply) => {
    reply.header("cache-control", "no-store");
    const { operation, revisionId, requestDigest } = request.query;
    const expectedVersion = Number(request.query.expectedVersion);
    const expectedBlueprintVersion = Number(request.query.expectedBlueprintVersion);
    if (typeof requestDigest !== "string" || !/^[a-f0-9]{64}$/.test(requestDigest) || (operation !== "save" && operation !== "undo") || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1 || !Number.isSafeInteger(expectedBlueprintVersion) || expectedBlueprintVersion < 1 || (operation === "undo" && !revisionId)) {
      const failure = planOperationError(new WorkspaceMutationError("请提供原操作及精确版本。"));
      return reply.code(failure.status).send(failure.body);
    }
    try { return store.getDirectBlueprintMutationReceipt({ operation, requestDigest, requestId: request.params.requestId, expectedPlanId: request.params.planId, expectedVersion, expectedBlueprintVersion, ...(operation === "undo" ? { revisionId: revisionId! } : {}) }); }
    catch (error) { const failure = planOperationError(error); return reply.code(failure.status).send(failure.body); }
  });

  server.get<{ Params: { planId: string } }>("/api/plans/:planId/booking-relationship-review", planOperationRouteOptions, async (request, reply) => {
    const workspace = store.getWorkspace();
    if (workspace.activePlan.id !== request.params.planId) return reply.code(409).send(planOperationRejection("version_conflict"));
    if (!workspace.activeBlueprint) return reply.code(409).send(planOperationRejection("blueprint_required"));
    return store.getBookingRelationshipReviewContext(request.params.planId);
  });
  server.post<{ Params: { planId: string }; Body: unknown }>("/api/plans/:planId/blueprint-revisions/direct", planOperationRouteOptions, async (request, reply) => {
    if (getGeneratingPlan()) return reply.code(409).send( planOperationRejection("generation_busy"));
    let revisions: DirectBlueprintRevision[];
    let expectedVersion: number;
    let expectedBlueprintVersion: number | undefined;
    try {
      const createdAt = new Date().toISOString();
      expectedVersion = expectedVersionFromBody(request.body);
      expectedBlueprintVersion = expectedBlueprintVersionFromBody(request.body);
      if (expectedBlueprintVersion === undefined || !isRecord(request.body)) throw new WorkspaceMutationError("直接编辑需要当前蓝图版本及请求身份。");
      stringField(request.body, "requestId");
      revisions = parseDirectBlueprintRevisions(request.body, createdAt);
    } catch (error) { const failure = planOperationError(error); return reply.code(failure.status).send(failure.body); }
    try {
      const result = store.applyDirectBlueprintRevisionBatch({
        expectedPlanId: request.params.planId,
        expectedVersion,
        ...(expectedBlueprintVersion !== undefined ? { expectedBlueprintVersion } : {}),
        revisions,
        ...(isRecord(request.body) && typeof request.body.requestId === "string" ? {requestId: request.body.requestId} : {}),
        ...(isRecord(request.body) && typeof request.body.highImpactConfirmation === "string" ? {highImpactConfirmation: request.body.highImpactConfirmation} : {}),
        ...(isRecord(request.body) && request.body.recoveryBinding !== undefined ? {recoveryBinding:parseRecoveryBinding(request.body.recoveryBinding)} : {}),
        runtime: store.getWorkspace().runtime.selectedKind
      });
      return { ...result.workspace, ...result };
    } catch (error) { const failure = planOperationError(error); return reply.code(failure.status).send(failure.body); }
  });
  server.post<{ Params: { planId: string; revisionId: string }; Body: unknown }>("/api/plans/:planId/blueprint-revisions/:revisionId/undo", planOperationRouteOptions, async (request, reply) => {
    if (getGeneratingPlan()) return reply.code(409).send( planOperationRejection("generation_busy"));
    try {
      if (!isRecord(request.body)) throw new WorkspaceMutationError("撤销需要当前计划和蓝图版本。");
      const expectedVersion = expectedVersionFromBody(request.body);
      const expectedBlueprintVersion = expectedBlueprintVersionFromBody(request.body);
      if (expectedBlueprintVersion === undefined) throw new WorkspaceMutationError("撤销需要当前蓝图版本。");
      return store.undoDirectBlueprintRevision({ expectedPlanId: request.params.planId, expectedVersion, expectedBlueprintVersion, revisionId: request.params.revisionId, requestId: stringField(request.body, "requestId") });
    } catch (error) { const failure = planOperationError(error); return reply.code(failure.status).send(failure.body); }
  });
  server.post<{ Params: { planId: string }; Body: unknown }>("/api/plans/:planId/blueprint-revisions/assisted-replanning", planOperationRouteOptions, async (request, reply) => {
    if (getGeneratingPlan()) return reply.code(409).send( planOperationRejection("generation_busy"));
    let revisions: DirectBlueprintRevision[];
    let replanRequirement: DirectBlueprintReplanRequirement;
    let expectedVersion: number;
    let expectedBlueprintVersion: number | undefined;
    try {
      const createdAt = new Date().toISOString();
      expectedVersion = expectedVersionFromBody(request.body);
      expectedBlueprintVersion = expectedBlueprintVersionFromBody(request.body);
      revisions = parseDirectBlueprintRevisions(request.body, createdAt);
      replanRequirement = replanRequirementFromBody(request.body);
    } catch (error) { const failure = planOperationError(error); return reply.code(failure.status).send(failure.body); }
    try {
      const workspace = store.getWorkspace();
      if (workspace.activePlan.id !== request.params.planId || workspace.activePlan.version !== expectedVersion) {
        return reply.code(409).send( planOperationRejection("version_conflict"));
      }
      if (!workspace.activeBlueprint) return reply.code(409).send( planOperationRejection("blueprint_required"));
      if (expectedBlueprintVersion !== undefined && workspace.activeBlueprint.version !== expectedBlueprintVersion) {
        return reply.code(409).send( planOperationRejection("version_conflict"));
      }
      const handoff = prepareDirectBlueprintAssistedReplanningHandoff(workspace.activeBlueprint, { replanRequirement, revisions });
      return { workspace, handoff };
    } catch (error) { const failure = planOperationError(error); return reply.code(failure.status).send(failure.body); }
  });
  server.post<{ Params: { planId: string }; Body: { message?: string; expectedVersion?: number } }>("/api/plans/:planId/change-impact", planOperationRouteOptions, async (request, reply) => {
    if (typeof request.body?.message !== "string" || typeof request.body.expectedVersion !== "number") return reply.code(400).send( planOperationRejection("invalid_edit"));
    const plan = store.getWorkspace().activePlan;
    if (plan.id !== request.params.planId || plan.version !== request.body.expectedVersion) return reply.code(409).send( planOperationRejection("version_conflict"));
    try { return previewPlanChange(plan, request.body.message); }
    catch (error) { const failure = planOperationError(error); return reply.code(failure.status).send(failure.body); }
  });

  server.post<{ Params: { planId: string; snapshotId: string } }>("/api/plans/:planId/sources/:snapshotId", planOperationRouteOptions, async (request, reply) => {
    try {
      return store.linkSourceSnapshotToPlan(request.params.planId, request.params.snapshotId);
    } catch (error) { const failure = planOperationError(error); return reply.code(failure.status).send(failure.body); }
  });

  server.get<{ Params: { planId: string } }>("/api/plans/:planId/execution", planOperationRouteOptions, async (request, reply) => {
    const workspace = store.getWorkspace();
    const plan = workspace.activePlan.id === request.params.planId ? workspace.activePlan : store.getExecutionPlan();
    if (!plan || plan.id !== request.params.planId) return reply.code(404).send( planOperationRejection("operation_not_found"));
    return { compiled: compileExecutionItinerary(plan), active: plan.status === "active", progress: plan.status === "active" ? readExecutionState(store, plan).data : null };
  });

  server.get<{Params:{planId:string}}>("/api/plans/:planId/confirmation-review",planOperationRouteOptions,async(request,reply)=>{
    reply.header("cache-control","no-store");
    const workspace=store.getWorkspace();
    if(workspace.activePlan.id!==request.params.planId || workspace.activePlan.status!=="draft")return reply.code(409).send(planOperationRejection("version_conflict"));
    const exactConfirmation=exactPlanConfirmation(store);
    const rawObservations=exactConfirmation.context.execution?store.listTravelAdjustmentObservations(exactConfirmation.context.execution.id,exactConfirmation.context.execution.version).map(item=>item.observation):[];
    const execution=store.getExecutionPlan();
    const lineage=execution?store.getPlanBlueprintLineage(execution.id):undefined;
    const blueprint=lineage?store.getTripBlueprint(lineage.blueprintId,lineage.blueprintVersion):undefined;
    const activities=execution?compileExecutionItinerary(execution).activities:[];
    const safeObservations=rawObservations.map(fact=>{
      const matches=activities.filter(activity=>(!fact.targetDate || activity.date===fact.targetDate) && (fact.objectRef===`activity:${activity.id}` || fact.objectRef===activity.placeId || fact.objectRef===`place:${activity.placeId}`));
      const booking=blueprint?.bookingConstraints?.find(item=>fact.objectRef.startsWith(`booking:${item.sourceBookingId??item.id}:`));
      return {safeFacts:reviewSourceFacts(fact),impact:"The itinerary impact needs verification. Compare the complete arrangements to assess how these source facts affect your trip.",activities:matches.map(activity=>({title:activity.title,date:activity.date})),subject:booking?`${booking.title} (related activities need verification)`:(matches.length?null:"No specific activity is linked. Check which part of the trip this applies to."),targetDate:fact.targetDate,sourceKind:fact.sourceKind,status:fact.status,factObservedAt:fact.factObservedAt,retrievedAt:fact.retrievedAt,validUntil:fact.validUntil};
    });
    return {workspace,exactConfirmation,observations:safeObservations,arrangements:{original:blueprint?reviewArrangement(blueprint):null,replacement:workspace.activeBlueprint?reviewArrangement(workspace.activeBlueprint):null}};
  });
  server.post<{Params:{requestId:string}}>("/api/travel-adjustments/:requestId/evaluate",planOperationRouteOptions,async(request,reply)=>{
    const candidate=dependencies.travelAdjustmentCandidates;
    if(!candidate)return reply.code(409).send(planOperationRejection("activation_review_required"));
    try{return await createTravelAdjustmentApplication({store,...(candidate.now?{now:candidate.now}:{}),...(candidate.verifyExecution?{verifyExecution:candidate.verifyExecution}:{})}).run(request.params.requestId,candidate.collect);}
    catch(error){const failure=planOperationError(error);return reply.code(failure.status).send(failure.body);}
  });
  server.get("/api/travel-adjustments/context",planOperationRouteOptions,async(_request,reply)=>{
    reply.header("cache-control","no-store");return store.captureAdjustmentContext();
  });
  server.post<{Body:{context?:import("@c-assistant/core").TravelAdjustmentContext;value?:string;declaration?:boolean}}>("/api/travel-adjustments/phase",planOperationRouteOptions,async(request,reply)=>{
    const {context,value,declaration}=request.body??{};
    if(!context || declaration!==true || !["pre_departure","on_trip","ended"].includes(value??""))return reply.code(400).send(planOperationRejection("invalid_edit"));
    try{return store.recordTravelPhase({context,value:value as "pre_departure"|"on_trip"|"ended",basis:"traveler_statement",recordedAt:new Date().toISOString(),evidenceRefs:[`traveler-declaration:${value}`]});}
    catch(error){const failure=planOperationError(error);return reply.code(failure.status).send(failure.body);}
  });
  server.get<{Params:{requestId:string}}>("/api/travel-adjustments/receipts/:requestId",planOperationRouteOptions,async(request,reply)=>{
    reply.header("cache-control","no-store");
    const receipt=store.getTravelAdjustmentReceipt(request.params.requestId);
    return receipt ?? reply.code(404).send(planOperationRejection("operation_not_found"));
  });

  server.post<{ Params:{planId:string};Body:{expectedVersion?:number;expectedBlueprintVersion?:number;expectedBasePlanId?:string;expectedBaseVersion?:number;exactConfirmation?:ExactPlanConfirmation} }>("/api/plans/:planId/confirm", planOperationRouteOptions,async(request,reply)=>{
    if(!Number.isSafeInteger(request.body?.expectedVersion))return reply.code(400).send( planOperationRejection("invalid_edit"));
    const reviewed=store.getWorkspace();const executing=store.getExecutionPlan();
    if(reviewed.activeBlueprint && request.body.expectedBlueprintVersion!==reviewed.activeBlueprint.version)return reply.code(409).send( planOperationRejection("version_conflict"));
    if(executing && executing.id!==request.params.planId && (request.body.expectedBasePlanId!==executing.id || request.body.expectedBaseVersion!==executing.version))return reply.code(409).send( planOperationRejection("version_conflict"));
    if(getGeneratingPlan())return reply.code(409).send( planOperationRejection("generation_busy"));
    try{
      const confirmed=activateReviewedPlan(store,{planId:request.params.planId,expectedVersion:request.body.expectedVersion!,...(request.body.exactConfirmation?{exactConfirmation:request.body.exactConfirmation}:{}),...(reviewed.activeBlueprint?{expectedBlueprintVersion:reviewed.activeBlueprint.version}:{}),...(executing && executing.id!==request.params.planId?{expectedBase:{id:request.body.expectedBasePlanId!,version:request.body.expectedBaseVersion!}}:{})},new Date(),(details,message)=>request.log.warn(details,message));
      try { startActivePlanMonitoring(); }
      catch { request.log.warn({code:"plan_confirmation_monitoring_unavailable",planId:request.params.planId},"Plan activated, but monitoring could not start"); }
      return confirmed;
    }catch(error) { const failure = planOperationError(error); return reply.code(failure.status).send(failure.body); }
  });

  server.post<{ Params: { planId: string; taskId: string } }>("/api/plans/:planId/tasks/:taskId/reminder/cancel", planOperationRouteOptions, async (request, reply) => {
    try {
      return store.cancelTaskReminder(request.params.planId, request.params.taskId);
    } catch (error) { const failure = planOperationError(error); return reply.code(failure.status).send(failure.body); }
  });

  server.put<{ Params: { planId: string }; Body: PlanAccommodationInput }>("/api/plans/:planId/accommodation", planOperationRouteOptions, async (request, reply) => {
    try {
      return store.updatePlanAccommodation(request.params.planId, request.body);
    } catch (error) { const failure = planOperationError(error); return reply.code(failure.status).send(failure.body); }
  });

  server.post<{ Params: { planId: string }; Body: { name?: string; address?: string; status?: "candidate" | "confirmed" } }>("/api/plans/:planId/accommodation/manual", planOperationRouteOptions, async (request, reply) => {
    const name = request.body?.name?.trim() ?? "";
    const address = request.body?.address?.trim() ?? "";
    if (!name || !address) return reply.code(400).send( planOperationRejection("invalid_edit"));

    const resolved = await getMaps().geocodeAddress({ address });
    if (resolved.status !== "available") return reply.code(connectorResponseStatus(resolved.status)).send(planOperationRejection("route_refresh_unavailable"));
    if (!resolved.data) return reply.code(404).send( planOperationRejection("address_unresolved"));

    try {
      return store.updatePlanAccommodation(request.params.planId, {
        status: request.body.status === "confirmed" ? "confirmed" : "candidate",
        name,
        address: resolved.data.formattedAddress,
        location: resolved.data.location,
        source: "user"
      });
    } catch (error) { const failure = planOperationError(error); return reply.code(failure.status).send(failure.body); }
  });

  server.post<{ Params: { planId: string }; Body: { expectedVersion?: number; name?: string; address?: string; status?: "candidate" | "confirmed" } }>("/api/plans/:planId/accommodation/linked", planOperationRouteOptions, async (request, reply) => {
    const expectedVersion = Number(request.body?.expectedVersion);
    const name = request.body?.name?.trim() ?? "";
    const address = request.body?.address?.trim() ?? "";
    if (!Number.isInteger(expectedVersion) || expectedVersion <= 0 || !name || !address) return reply.code(400).send( planOperationRejection("invalid_edit"));
    const current = store.getWorkspace().activePlan;
    if (current.id !== request.params.planId || current.version !== expectedVersion) return reply.code(409).send( planOperationRejection("version_conflict"));
    if (current.status !== "draft") return reply.code(409).send( planOperationRejection("draft_required"));

    const maps = getMaps();
    const resolved = await maps.geocodeAddress({ address });
    if (resolved.status !== "available") return reply.code(connectorResponseStatus(resolved.status)).send(planOperationRejection("route_refresh_unavailable"));
    if (!resolved.data) return reply.code(404).send( planOperationRejection("address_unresolved"));
    const departures = await prepareAccommodationDepartures({
      plan: current,
      accommodationName: name,
      accommodationAddress: resolved.data.formattedAddress,
      accommodationLocation: resolved.data.location,
      maps: {
        geocodeAddress: (input) => maps.geocodeAddress(input),
        drivingRoute: (input) => maps.drivingRoute(input),
        walkingRoute: (input) => maps.walkingRoute(input),
        transitRoute: (input) => maps.transitRoute(input)
      }
    });
    try {
      const workspace = store.saveDraftAccommodationLinkage({
        planId: request.params.planId,
        expectedVersion,
        accommodation: { status: request.body.status === "candidate" ? "candidate" : "confirmed", name, address: resolved.data.formattedAddress, location: resolved.data.location, source: "user" },
        departures
      });
      const verified = departures.filter((item) => item.departure.verification === "verified").length;
      return { workspace, impact: { affectedDays: departures.length, verifiedDays: verified, pendingDays: departures.length - verified } };
    } catch (error) { const failure = planOperationError(error); return reply.code(failure.status).send(failure.body); }
  });

  server.put<{ Params: { planId: string }; Body: PlanTransportPreferenceInput }>("/api/plans/:planId/transport-preference", planOperationRouteOptions, async (request, reply) => {
    try {
      return store.updatePlanTransportPreference(request.params.planId, request.body);
    } catch (error) { const failure = planOperationError(error); return reply.code(failure.status).send(failure.body); }
  });

  server.put<{ Params: { planId: string }; Body: PlanTravelContextInput }>("/api/plans/:planId/travel-context", planOperationRouteOptions, async (request, reply) => {
    try {
      return store.updatePlanTravelContext(request.params.planId, request.body);
    } catch (error) { const failure = planOperationError(error); return reply.code(failure.status).send(failure.body); }
  });

  server.put<{ Params: { planId: string }; Body: PlanArrivalInput }>("/api/plans/:planId/arrival", planOperationRouteOptions, async (request, reply) => {
    try {
      return store.updatePlanArrival(request.params.planId, request.body);
    } catch (error) { const failure = planOperationError(error); return reply.code(failure.status).send(failure.body); }
  });
}

function parseDirectBlueprintRevisions(value: unknown, createdAt: string): DirectBlueprintRevision[] {
  if (!isRecord(value)) throw new WorkspaceMutationError("Direct itinerary edits need a structured request.");
  if ("revisions" in value) {
    if (!Array.isArray(value.revisions)) throw new WorkspaceMutationError("Direct itinerary edits need revisions as a list.");
    if (!value.revisions.length) throw new WorkspaceMutationError("Direct itinerary edits need at least one edit.", "empty_edits");
    if (value.revisions.length > MAX_DIRECT_BLUEPRINT_REVISIONS) throw new WorkspaceMutationError(`Apply ${MAX_DIRECT_BLUEPRINT_REVISIONS} itinerary edits or fewer at once.`, "too_many_edits");
    return value.revisions.map((revision) => parseDirectBlueprintRevision(revision, createdAt));
  }
  return [parseDirectBlueprintRevision(value, createdAt)];
}

function parseDirectBlueprintRevision(value: unknown, createdAt: string): DirectBlueprintRevision {
  if (!isRecord(value)) throw new WorkspaceMutationError("Direct itinerary edits need a structured request.");
  if (value.kind === "review_booking_relationships") {
    if (!isRecord(value.assessment) || !isRecord(value.assessment.decision) || (value.assessment.decision.source !== "traveler" || value.assessment.decision.actorId !== "local-traveler" || "model" in value.assessment.decision) || !Number.isFinite(Date.parse(String(value.assessment.decision.decidedAt)))) throw new WorkspaceMutationError("请由旅行者明确审阅预订关联。", "invalid_edit");
    const assessment = structuredClone(value.assessment) as unknown as BookingRelationshipAssessment;
    assessment.decision = { ...assessment.decision, source: "traveler", actorId: "local-traveler" };
    delete assessment.decision.model;
    return { kind: "review_booking_relationships", assessment, expectedSourceSetDigest: stringField(value, "expectedSourceSetDigest"), createdAt };
  }
  if (value.kind === "select_booking_sources") {
    if (!Array.isArray(value.sourceBookingIds) || value.sourceBookingIds.some(id => typeof id !== "string" || !id.trim()) || new Set(value.sourceBookingIds).size !== value.sourceBookingIds.length) throw new WorkspaceMutationError("请明确选择真实预订来源。", "invalid_edit");
    if("decision" in value||"sourceSelectionDecision" in value||"sourceSelectionAudit" in value)throw new WorkspaceMutationError("来源选择责任由本地旅行者确认边界绑定。","invalid_edit");
    return { kind: "select_booking_sources", sourceBookingIds: value.sourceBookingIds as string[], expectedSourceSetDigest: stringField(value, "expectedSourceSetDigest"),...("legacyBindings" in value?{legacyBindings:parseBookingSourceLegacyBindings(value.legacyBindings)}:{}), createdAt };
  }
  if (value.kind === "set_tip_state") {
    if ((value.pinned !== undefined && typeof value.pinned !== "boolean") || (value.hidden !== undefined && typeof value.hidden !== "boolean") || (value.pinned === undefined && value.hidden === undefined)) throw new WorkspaceMutationError("请提供有效提示状态。");
    return { kind: "set_tip_state", tipId: stringField(value, "tipId"), ...(typeof value.pinned === "boolean" ? {pinned:value.pinned} : {}), ...(typeof value.hidden === "boolean" ? {hidden:value.hidden} : {}), createdAt };
  }
  if (value.kind === "set_preparation_completed") {
    if (typeof value.completed !== "boolean") throw new WorkspaceMutationError("请提供有效准备项完成状态。");
    return { kind: "set_preparation_completed", preparationId:stringField(value,"preparationId"),completed:value.completed,createdAt };
  }
  if (value.kind === "create_preparation") {
    if (!isRecord(value.origin) || !["tip","place","local_food","local_product","experience_theme"].includes(String(value.origin.kind)) || !Number.isInteger(value.origin.blueprintVersion) || Number(value.origin.blueprintVersion)<1) throw new WorkspaceMutationError("请提供有效准备项来源及版本。");
    return {kind:"create_preparation",origin:{kind:value.origin.kind as "tip"|"place"|"local_food"|"local_product"|"experience_theme",id:stringField(value.origin,"id"),blueprintId:stringField(value.origin,"blueprintId"),blueprintVersion:Number(value.origin.blueprintVersion)},createdAt};
  }
  if (value.kind === "update_place_priority") {
    return { kind: "update_place_priority", placeId: stringField(value, "placeId"), priority: directRevisionPlacePriority(value.priority), createdAt };
  }
  if (value.kind === "remove_place_from_day") {
    return { kind: "remove_place_from_day", placeId: stringField(value, "placeId"), dayId: stringField(value, "dayId"), createdAt };
  }
  if (value.kind !== "add_place_to_day" && value.kind !== "move_place_within_day") throw new WorkspaceMutationError("Direct itinerary edits currently support adding, moving, or removing a place within a day, or updating a place status.");
  const placeId = stringField(value, "placeId");
  const dayId = stringField(value, "dayId");
  const position = directRevisionPosition(value.position);
  if (value.kind === "move_place_within_day") return { kind: "move_place_within_day", placeId, dayId, position, createdAt };
  return { kind: "add_place_to_day", placeId, dayId, position, createdAt };
}

function directRevisionPlacePriority(value: unknown): BlueprintPlacePriority {
  if (
    value === "must" ||
    value === "preferred" ||
    value === "nearby" ||
    value === "archive" ||
    value === "pending" ||
    value === "recheck" ||
    value === "booked"
  ) return value;
  throw new WorkspaceMutationError("Direct place status updates need a supported place status.");
}

function expectedVersionFromBody(value: unknown): number {
  if (!isRecord(value) || typeof value.expectedVersion !== "number" || !Number.isInteger(value.expectedVersion) || value.expectedVersion <= 0) {
    throw new WorkspaceMutationError("Direct itinerary edits need the current Plan version.");
  }
  return value.expectedVersion;
}

function expectedBlueprintVersionFromBody(value: unknown): number | undefined {
  if (!isRecord(value) || value.expectedBlueprintVersion === undefined) return undefined;
  if (typeof value.expectedBlueprintVersion !== "number" || !Number.isInteger(value.expectedBlueprintVersion) || value.expectedBlueprintVersion <= 0) {
    throw new WorkspaceMutationError("Direct itinerary edits need a valid Trip Blueprint version.");
  }
  return value.expectedBlueprintVersion;
}

function directRevisionPosition(value: unknown): Extract<DirectBlueprintRevision, { kind: "add_place_to_day" | "move_place_within_day" }>["position"] {
  if (!isRecord(value)) throw new WorkspaceMutationError("Direct itinerary edits need a placement position.", "invalid_placement");
  if (value.kind === "start") return { kind: "start" };
  if (value.kind === "end") return { kind: "end" };
  if (value.kind === "after") return { kind: "after", afterPlaceId: stringField(value, "afterPlaceId") };
  throw new WorkspaceMutationError("Direct itinerary edits need a supported placement position.", "invalid_placement");
}

function replanRequirementFromBody(value: unknown): DirectBlueprintReplanRequirement {
  if (!isRecord(value) || !isRecord(value.replanRequirement)) throw new WorkspaceMutationError("Assisted replanning needs the replanning requirement from the failed direct edit.");
  return value.replanRequirement as unknown as DirectBlueprintReplanRequirement;
}

function stringField(value: Record<string, unknown>, key: string): string {
  const field = value[key];
  if (typeof field !== "string" || !field.trim()) throw new WorkspaceMutationError(`Direct itinerary edits need ${key}.`);
  return field.trim();
}

function parseRecoveryBinding(value:unknown):{schemaVersion:1;draftDigest:string;seedDigest:string} {
  if(!isRecord(value)||value.schemaVersion!==1||typeof value.draftDigest!=="string"||typeof value.seedDigest!=="string"||!/^[a-f0-9]{64}$/.test(value.draftDigest)||!/^[a-f0-9]{64}$/.test(value.seedDigest)||Object.keys(value).some(key=>!["schemaVersion","draftDigest","seedDigest"].includes(key))) throw new WorkspaceMutationError("关联审阅恢复身份无效。","invalid_edit");
  return {schemaVersion:1,draftDigest:value.draftDigest,seedDigest:value.seedDigest};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
