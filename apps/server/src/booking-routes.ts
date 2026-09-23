import type { FastifyInstance } from "fastify";
import type { BookingImportInput, TravelBooking } from "@c-assistant/core";
import type { SqliteWorkspaceStore } from "@c-assistant/storage";
import { normalizeAcceptedBooking, normalizeImportedBookingText, planningFactsFromBooking, previewBookingImport } from "./booking-import.js";
import { applyExternalPlanningFacts } from "./planning-session-external-facts.js";
import { planningAccommodationDestinationConflicts } from "./planning-session-generation.js";

type BookingScope = { planningSessionId?: string; planId?: string };

export function registerBookingRoutes(server: FastifyInstance, dependencies: {
  store: SqliteWorkspaceStore;
}): void {
  const { store } = dependencies;
  const importerDependencies = {
    hasTravelBookingSourceHash: (scope: BookingScope, sourceHash: string) => store.hasTravelBookingSourceHash(scope, sourceHash),
    listExistingBookings: (scope: BookingScope) => [
      ...(scope.planningSessionId ? store.listTravelBookingsForPlanningSession(scope.planningSessionId) : []),
      ...(scope.planId ? store.listTravelBookingsForPlan(scope.planId) : [])
    ]
  };

  server.get<{ Params: { sessionId: string } }>("/api/planning-sessions/:sessionId/bookings", async (request, reply) => {
    const session = store.getPlanningSessionById(request.params.sessionId);
    if (!session) return reply.code(404).send({ error: "The planning session was not found." });
    return { bookings: store.listTravelBookingsForPlanningSession(session.id) };
  });

  server.post<{ Body: BookingImportInput }>("/api/planning-sessions/bookings/import-preview", async (request, reply) => {
    try {
      return previewBookingImport(request.body, {}, importerDependencies);
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : "The booking import could not be previewed." });
    }
  });

  server.post<{ Body: { booking?: TravelBooking; sourceContent?: string } }>("/api/planning-sessions/bookings/import-confirm", async (request, reply) => {
    try {
      const session = store.getPlanningSession() ?? store.createPlanningSession("travel");
      const booking = normalizeAcceptedBooking(request.body.booking, { planningSessionId: session.id });
      store.saveTravelBooking(booking);
      saveProtectedBookingAttachment(store, booking, request.body.sourceContent);
      applyBookingFactsToPlanningSession(store, session.id, booking);
      return { workspace: store.getWorkspace(), planningSession: store.getPlanningSessionById(session.id), booking };
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : "The booking import could not be saved." });
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

  server.post<{ Params: { sessionId: string }; Body: { booking?: TravelBooking; sourceContent?: string } }>("/api/planning-sessions/:sessionId/bookings/import-confirm", async (request, reply) => {
    const session = store.getPlanningSessionById(request.params.sessionId);
    if (!session) return reply.code(404).send({ error: "The planning session was not found." });
    try {
      const booking = normalizeAcceptedBooking(request.body.booking, { planningSessionId: session.id });
      store.saveTravelBooking(booking);
      saveProtectedBookingAttachment(store, booking, request.body.sourceContent);
      applyBookingFactsToPlanningSession(store, session.id, booking);
      return { workspace: store.getWorkspace(), planningSession: store.getPlanningSessionById(session.id), booking };
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : "The booking import could not be saved." });
    }
  });

  server.get<{ Params: { planId: string } }>("/api/plans/:planId/bookings", async (request, reply) => {
    const workspace = store.getWorkspace();
    const plan = workspace.activePlan.id === request.params.planId ? workspace.activePlan : undefined;
    if (!plan && !store.listHistoricalPlans().some((item) => item.id === request.params.planId)) return reply.code(404).send({ error: "The Plan was not found." });
    return { bookings: store.listTravelBookingsForPlan(request.params.planId) };
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

  server.post<{ Params: { planId: string }; Body: { booking?: TravelBooking; expectedVersion?: number; sourceContent?: string } }>("/api/plans/:planId/bookings/import-confirm", async (request, reply) => {
    const workspace = store.getWorkspace();
    const plan = workspace.activePlan.id === request.params.planId ? workspace.activePlan : workspace.executionPlan?.id === request.params.planId ? workspace.executionPlan : undefined;
    if (!plan) return reply.code(404).send({ error: "The Plan was not found." });
    if (request.body.expectedVersion !== undefined && request.body.expectedVersion !== plan.version) return reply.code(409).send({ error: "The Plan changed while the booking was being reviewed. Reopen the import preview." });
    try {
      const booking = normalizeAcceptedBooking(request.body.booking, { planId: plan.id, planVersionCreated: plan.version });
      store.saveTravelBooking(booking);
      saveProtectedBookingAttachment(store, booking, request.body.sourceContent);
      const requiresBlueprintRevision = plan.status === "active" && booking.segments.some((segment) => segment.constraintStrength === "hard");
      const savedWorkspace = store.applyTravelBookingToCurrentPlan(booking, plan.version);
      return { workspace: savedWorkspace, booking, requiresBlueprintRevision };
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : "The booking import could not be saved." });
    }
  });
}

function saveProtectedBookingAttachment(store: SqliteWorkspaceStore, booking: TravelBooking, sourceContent: string | undefined): void {
  const contentText = normalizeImportedBookingText(sourceContent ?? "");
  if (!contentText) return;
  if (contentText.length > 80_000) throw new Error("Booking confirmation text is too large for protected attachment storage.");
  store.saveProtectedBookingAttachment({
    bookingId: booking.id,
    sourceHash: booking.sourceHash,
    sourceLabel: booking.sourceLabel,
    contentText,
    createdAt: booking.importedAt
  });
}

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
