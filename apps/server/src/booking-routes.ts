import type { FastifyInstance } from "fastify";
import { bookingRelationshipDigest, WorkspaceMutationError, type BookingImportInput, type TravelBooking } from "@c-assistant/core";
import type { SqliteWorkspaceStore } from "@c-assistant/storage";
import { normalizeAcceptedBooking, normalizeImportedBookingText, planningFactsFromBooking, previewBookingImport } from "./booking-import.js";
import { applyExternalPlanningFacts } from "./planning-session-external-facts.js";
import { planningAccommodationDestinationConflicts } from "./planning-session-generation.js";
import { planOperationError } from "./plan-operation-error.js";

type BookingScope = { planningSessionId?: string; planId?: string };
type BookingConfirmationBody = { booking?: TravelBooking; sourceContent?: string; requestId?: string; expectedVersion?: number; expectedBlueprintVersion?: number; expectedSourceSetDigest?: string; expectedRecordDigest?: string; expectedRevision?: number; expectedSessionId?:string|null };

export function registerBookingRoutes(server: FastifyInstance, dependencies: {
  store: SqliteWorkspaceStore;
}): void {
  const { store } = dependencies;
  server.get("/api/planning-sessions/bookings/context",async()=>{const session=store.getPlanningSession();const bookings=session?store.listTravelBookingsForPlanningSession(session.id):[];return {expectedSessionId:session?.id??null,revision:session?store.getPlanningRevision(session.id):0,bookings,records:bookings.map(booking=>({bookingId:booking.id,recordDigest:bookingRelationshipDigest(booking)}))};});
  server.get<{Params:{requestId:string};Querystring:{requestDigest?:string;identity?:string}}>("/api/booking-mutations/receipts/:requestId",async(request,reply)=>{
    try {if(!/^[a-f0-9]{64}$/.test(request.query.requestDigest??""))throw new WorkspaceMutationError("请提供原预订请求摘要。","invalid_edit");const identity=JSON.parse(request.query.identity??"null") as Record<string,unknown>|null;if(!identity||typeof identity!=="object"||Array.isArray(identity)||identity.operation!=="import_booking"||!["plan","session","current_session"].includes(String(identity.targetKind))||typeof identity.targetId!=="string")throw new WorkspaceMutationError("请提供原预订目标和版本身份。","invalid_edit");return store.getBookingMutationReceipt(request.params.requestId,request.query.requestDigest!,identity);}catch(error){const failure=planOperationError(error instanceof SyntaxError?new WorkspaceMutationError("原预订回执身份无效。","invalid_edit"):error);return reply.code(failure.status).send(failure.body);}
  });
  const importerDependencies = {
    hasTravelBookingSourceHash: (scope: BookingScope, sourceHash: string) => store.hasTravelBookingSourceHash(scope, sourceHash),
    listExistingBookings: (scope: BookingScope) => [
      ...(scope.planningSessionId ? store.listTravelBookingsForPlanningSession(scope.planningSessionId) : []),
      ...(scope.planId ? store.listCurrentTravelBookingSourcesForPlan(scope.planId,{includePending:true}) : [])
    ]
  };

  server.get<{ Params: { sessionId: string } }>("/api/planning-sessions/:sessionId/bookings", async (request, reply) => {
    const session = store.getPlanningSessionById(request.params.sessionId);
    if (!session) return reply.code(404).send({ error: "The planning session was not found." });
    return { bookings: store.listTravelBookingsForPlanningSession(session.id), revision: store.getPlanningRevision(session.id), records: store.listTravelBookingsForPlanningSession(session.id).map(booking=>({bookingId:booking.id,recordDigest:bookingRelationshipDigest(booking)})) };
  });

  server.post<{ Body: BookingImportInput }>("/api/planning-sessions/bookings/import-preview", async (request, reply) => {
    try {
      return previewBookingImport(request.body, {}, importerDependencies);
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : "The booking import could not be previewed." });
    }
  });

  server.post<{ Body: BookingConfirmationBody }>("/api/planning-sessions/bookings/import-confirm", async (request, reply) => {
    try {
      const replay = readBookingReplay(store,request.body); if (replay) return replay;
      return store.atomicBookingImport(()=>{
        const existingSession=store.getPlanningSession();
        if(!("expectedSessionId" in request.body)||(existingSession?.id??null)!==request.body.expectedSessionId)throw new WorkspaceMutationError("规划会话已变化，请重新打开预订预览。","version_conflict");
        const session = existingSession ?? store.createPlanningSession("travel");
        const booking = normalizeAcceptedBooking(request.body.booking, { planningSessionId: session.id });
        store.savePlanningTravelBooking({booking,expectedRevision:requiredRevision(request.body.expectedRevision),requestId:requiredRequestId(request.body),requestDigest:bookingRelationshipDigest(request.body),requestIdentity:bookingRequestIdentity(request.body),...(request.body.expectedRecordDigest?{expectedRecordDigest:request.body.expectedRecordDigest}:{}),...(request.body.sourceContent?{sourceContent:normalizeImportedBookingText(request.body.sourceContent)}:{})},()=>applyBookingFactsToPlanningSession(store,session.id,booking));
        return { workspace: store.getWorkspace(), planningSession: store.getPlanningSessionById(session.id), booking };
      });
    } catch (error) {
      const failure=planOperationError(error);return reply.code(failure.status).send(failure.body);
    }
  });

  server.post<{ Params: { sessionId: string }; Body: BookingImportInput }>("/api/planning-sessions/:sessionId/bookings/import-preview", async (request, reply) => {
    const session = store.getPlanningSessionById(request.params.sessionId);
    if (!session) return reply.code(404).send({ error: "The planning session was not found." });
    try {
      return previewBookingImport(request.body, { planningSessionId: session.id }, importerDependencies);
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : "The booking import could not be previewed." });
    }
  });

  server.post<{ Params: { sessionId: string }; Body: BookingConfirmationBody }>("/api/planning-sessions/:sessionId/bookings/import-confirm", async (request, reply) => {
    const session = store.getPlanningSessionById(request.params.sessionId);
    if (!session) return reply.code(404).send({ error: "The planning session was not found." });
    try {
      const replay=readBookingReplay(store,request.body,{kind:"session",id:session.id});if(replay)return replay;
      const booking = normalizeAcceptedBooking(request.body.booking, { planningSessionId: session.id });
      store.savePlanningTravelBooking({booking,expectedRevision:requiredRevision(request.body.expectedRevision),requestId:requiredRequestId(request.body),requestDigest:bookingRelationshipDigest({scope:session.id,body:request.body}),requestIdentity:bookingRequestIdentity(request.body,{kind:"session",id:session.id}),...(request.body.expectedRecordDigest?{expectedRecordDigest:request.body.expectedRecordDigest}:{}),...(request.body.sourceContent?{sourceContent:normalizeImportedBookingText(request.body.sourceContent)}:{})},()=>applyBookingFactsToPlanningSession(store,session.id,booking));
      return { workspace: store.getWorkspace(), planningSession: store.getPlanningSessionById(session.id), booking };
    } catch (error) {
      const failure=planOperationError(error);return reply.code(failure.status).send(failure.body);
    }
  });

  server.get<{ Params: { planId: string } }>("/api/plans/:planId/bookings", async (request, reply) => {
    const workspace = store.getWorkspace();
    const plan = workspace.activePlan.id === request.params.planId ? workspace.activePlan : workspace.executionPlan?.id===request.params.planId?workspace.executionPlan:store.listHistoricalPlans().find(item=>item.id===request.params.planId);
    if (!plan) return reply.code(404).send({ error: "The Plan was not found." });
    const bookings=store.listCurrentTravelBookingSourcesForPlan(request.params.planId,{includePending:true});
    return { expectedPlanId:plan.id,expectedVersion:plan.version,sourceSetDigest:store.getCurrentTravelBookingSourceSetDigest(plan.id),bookings,records:bookings.map(booking=>({bookingId:booking.id,recordDigest:bookingRelationshipDigest(booking)})),constraints: store.listApprovedBookingConstraintsForPlan(request.params.planId) };
  });

  server.post<{ Params: { planId: string }; Body: BookingImportInput }>("/api/plans/:planId/bookings/import-preview", async (request, reply) => {
    const workspace = store.getWorkspace();
    if (workspace.activePlan.id !== request.params.planId && workspace.executionPlan?.id !== request.params.planId) return reply.code(404).send({ error: "The Plan was not found." });
    try {
      return previewBookingImport(request.body, { planId: request.params.planId }, importerDependencies);
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : "The booking import could not be previewed." });
    }
  });

  server.post<{ Params: { planId: string }; Body: BookingConfirmationBody }>("/api/plans/:planId/bookings/import-confirm", async (request, reply) => {
    try { const replay=readBookingReplay(store,request.body,{kind:"plan",id:request.params.planId});if(replay)return replay; } catch(error) {const failure=planOperationError(error);return reply.code(failure.status).send(failure.body);}
    const workspace = store.getWorkspace();
    const plan = workspace.activePlan.id === request.params.planId ? workspace.activePlan : workspace.executionPlan?.id === request.params.planId ? workspace.executionPlan : undefined;
    if (!plan) return reply.code(404).send({ error: "The Plan was not found." });
    if (!Number.isSafeInteger(request.body.expectedVersion) || request.body.expectedVersion !== plan.version) return reply.code(409).send({ error: "预订审阅期间行程已变化，请重新打开预览。",code:"version_conflict" });
    try {
      const booking = normalizeAcceptedBooking(request.body.booking, { planId: plan.id, planVersionCreated: plan.version });
      const requiresBlueprintRevision = plan.status === "active" && booking.segments.some((segment) => segment.constraintStrength === "hard");
      const savedWorkspace = store.savePlanTravelBooking({ targetPlanId:plan.id,booking, expectedVersion: request.body.expectedVersion!,requestId:requiredRequestId(request.body),requestDigest:bookingRelationshipDigest({scope:plan.id,body:request.body}),requestIdentity:bookingRequestIdentity(request.body,{kind:"plan",id:plan.id}),...(request.body.expectedBlueprintVersion!==undefined?{expectedBlueprintVersion:request.body.expectedBlueprintVersion}:{}),...(request.body.expectedSourceSetDigest?{expectedSourceSetDigest:request.body.expectedSourceSetDigest}:{}),...(request.body.expectedRecordDigest?{expectedRecordDigest:request.body.expectedRecordDigest}:{}), ...(request.body.sourceContent ? { sourceContent: normalizeImportedBookingText(request.body.sourceContent) } : {}) });
      return { workspace: savedWorkspace, booking: store.listCurrentTravelBookingSourcesForPlan(savedWorkspace.activePlan.id).find(value=>value.id===booking.id) ?? booking, requiresBlueprintRevision };
    } catch (error) {
      const failure=planOperationError(error);return reply.code(failure.status).send(failure.body);
    }
  });
}

function requiredRequestId(body:BookingConfirmationBody):string {if(typeof body.requestId!=="string"||!body.requestId.trim())throw new WorkspaceMutationError("预订保存需要请求身份。","invalid_edit");return body.requestId;}
function requiredRevision(value:unknown):number {if(typeof value!=="number"||!Number.isSafeInteger(value)||value<0)throw new WorkspaceMutationError("预订保存需要当前规划版本。","invalid_edit");return value;}
function bookingRequestIdentity(body:BookingConfirmationBody,scope?:{kind:"plan"|"session";id:string}) {return {operation:"import_booking",targetKind:scope?.kind??"current_session",targetId:scope?.id??"current",expectedVersion:body.expectedVersion,expectedBlueprintVersion:body.expectedBlueprintVersion,expectedRevision:body.expectedRevision,expectedSessionId:body.expectedSessionId,expectedSourceSetDigest:body.expectedSourceSetDigest,expectedRecordDigest:body.expectedRecordDigest,bookingId:body.booking?.id};}
function readBookingReplay(store:SqliteWorkspaceStore,body:BookingConfirmationBody,scope?:{kind:"plan"|"session";id:string}) {const requestId=requiredRequestId(body);const receipt=store.getBookingMutationReceipt(requestId,bookingRelationshipDigest(scope?{scope:scope.id,body}:body),bookingRequestIdentity(body,scope));return receipt.status==="committed"?receipt:undefined;}

function applyBookingFactsToPlanningSession(store: SqliteWorkspaceStore, sessionId: string, booking: TravelBooking): void {
  const session = store.getPlanningSessionById(sessionId);
  if (!session) throw new Error("The planning session was not found.");
  const facts = planningFactsFromBooking(booking);
  let next = facts.length ? applyExternalPlanningFacts(session, facts) : session;
  const conflicts = planningAccommodationDestinationConflicts(next, store.listTravelBookingsForPlanningSession(sessionId));
  next = {
    ...next,
    deferred: [
      ...next.deferred.filter((item) => item.key !== "accommodation_destination_conflict"),
      ...(conflicts.length ? [{
        key: "accommodation_destination_conflict",
        question: `The confirmed accommodation location (${conflicts[0]}) does not match the confirmed trip destination. Confirm which location belongs to this trip.`,
        impact: "dependent" as const,
        status: "deferred" as const
      }] : [])
    ]
  };
  store.savePlanningSession(next);
}
