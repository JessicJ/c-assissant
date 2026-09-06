import type { FastifyInstance } from "fastify";
import type { DirectBlueprintRevision, PlanAccommodationInput, PlanArrivalInput, PlanTransportPreferenceInput, PlanTravelContextInput } from "@c-assistant/core";
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
}): void {
  const { store, getMaps, startActivePlanMonitoring, getGeneratingPlan = () => false } = dependencies;

  server.delete("/api/plans", async () => store.resetPlansToEmptyState());
  server.delete<{ Params: { planId: string } }>("/api/plans/:planId", async (request, reply) => {
    try {
      return store.discardCurrentDraft(request.params.planId);
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : "The current draft Plan could not be discarded." });
    }
  });
  server.post<{ Params: { planId: string } }>("/api/plans/:planId/abandon", async (request, reply) => {
    try {
      return store.abandonActivePlan(request.params.planId);
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : "The active Plan could not be abandoned." });
    }
  });
  server.get("/api/plans/history", async () => store.listHistoricalPlans());
  server.delete("/api/plans/history", async () => ({ deleted: store.clearHistoricalPlans() }));
  server.delete<{ Params: { planId: string } }>("/api/plans/:planId/history", async (request, reply) => {
    try {
      if (!store.deleteHistoricalPlan(request.params.planId)) return reply.code(404).send({ error: "The historical Plan was not found." });
      return { deleted: true };
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : "The historical Plan could not be deleted." });
    }
  });

  server.post<{ Params: { planId: string }; Body: { expectedVersion?: number } }>("/api/plans/:planId/replacement/undo", async (request, reply) => {
    if (typeof request.body?.expectedVersion !== "number") return reply.code(400).send({ error: "Undo needs the expected active Plan version." });
    try {
      return store.undoLatestPlanReplacement({ expectedPlanId: request.params.planId, expectedVersion: request.body.expectedVersion });
    } catch (error) {
      const message = error instanceof Error ? error.message : "The latest Plan replacement could not be undone.";
      return reply.code(/changed before|no latest|no longer available/i.test(message) ? 409 : 400).send({ error: message });
    }
  });
  server.patch<{ Params: { planId: string; taskId: string }; Body: { checked?: boolean } }>("/api/plans/:planId/tasks/:taskId/check", async (request, reply) => {
    if (typeof request.body?.checked !== "boolean") return reply.code(400).send({ error: "A checklist update requires checked=true or checked=false." });
    try {
      return store.setPlanTaskChecked(request.params.planId, request.params.taskId, request.body.checked);
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : "The checklist item could not be updated." });
    }
  });
  server.post<{ Params: { planId: string }; Body: { kind?: string; taskId?: string; direction?: string; expectedVersion?: number } }>("/api/plans/:planId/changes", async (request, reply) => {
    if (request.body?.kind !== "reorder_task" || typeof request.body.taskId !== "string" || (request.body.direction !== "up" && request.body.direction !== "down") || typeof request.body.expectedVersion !== "number") {
      return reply.code(400).send({ error: "A Plan reorder needs a task, direction, and expected Plan version." });
    }
    try {
      return store.reorderPlanTask({ planId: request.params.planId, taskId: request.body.taskId, direction: request.body.direction, expectedVersion: request.body.expectedVersion });
    } catch (error) {
      const message = error instanceof Error ? error.message : "The Plan change could not be applied.";
      return reply.code(/changed before/i.test(message) ? 409 : 400).send({ error: message });
    }
  });
  server.post<{ Params: { planId: string; changeId: string }; Body: { expectedVersion?: number } }>("/api/plans/:planId/changes/:changeId/undo", async (request, reply) => {
    if (typeof request.body?.expectedVersion !== "number") return reply.code(400).send({ error: "Undo needs the expected Plan version." });
    try {
      return store.undoPlanChange({ planId: request.params.planId, changeId: request.params.changeId, expectedVersion: request.body.expectedVersion });
    } catch (error) {
      const message = error instanceof Error ? error.message : "The Plan change could not be undone.";
      return reply.code(/changed before|latest Plan change/i.test(message) ? 409 : 400).send({ error: message });
    }
  });

  server.post<{ Params: { planId: string }; Body: unknown }>("/api/plans/:planId/blueprint-revisions/direct", async (request, reply) => {
    if (getGeneratingPlan()) return reply.code(409).send({ error: "Another Plan generation is already running." });
    let revisions: DirectBlueprintRevision[];
    let expectedVersion: number;
    try {
      const createdAt = new Date().toISOString();
      expectedVersion = expectedVersionFromBody(request.body);
      revisions = parseDirectBlueprintRevisions(request.body, createdAt);
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : "This Blueprint Revision is invalid." });
    }
    try {
      const result = store.applyDirectBlueprintRevisionBatch({
        expectedPlanId: request.params.planId,
        expectedVersion,
        revisions,
        runtime: store.getWorkspace().runtime.selectedKind
      });
      return { ...result.workspace, workspace: result.workspace, revision: result.revision };
    } catch (error) {
      const message = error instanceof Error ? error.message : "This Blueprint Revision could not be applied.";
      return reply.code(/changed before|already working|already scheduled/i.test(message) ? 409 : 400).send({ error: message });
    }
  });
  server.post<{ Params: { planId: string }; Body: { message?: string; expectedVersion?: number } }>("/api/plans/:planId/change-impact", async (request, reply) => {
    if (typeof request.body?.message !== "string" || typeof request.body.expectedVersion !== "number") return reply.code(400).send({ error: "A change-impact preview needs a message and expected Plan version." });
    const plan = store.getWorkspace().activePlan;
    if (plan.id !== request.params.planId || plan.version !== request.body.expectedVersion) return reply.code(409).send({ error: "The Plan changed before its impact could be reviewed." });
    try { return previewPlanChange(plan, request.body.message); }
    catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : "The Plan change could not be previewed." }); }
  });

  server.post<{ Params: { planId: string; snapshotId: string } }>("/api/plans/:planId/sources/:snapshotId", async (request, reply) => {
    try {
      return store.linkSourceSnapshotToPlan(request.params.planId, request.params.snapshotId);
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : "The official evidence could not be linked to this Plan." });
    }
  });

  server.post<{ Params: { planId: string } }>("/api/plans/:planId/confirm", async (request, reply) => {
    try {
      const confirmed = store.confirmPlan(request.params.planId);
      startActivePlanMonitoring();
      return confirmed;
    } catch (error) {
      return reply.code(404).send({
        error: error instanceof Error ? error.message : "Plan was not found."
      });
    }
  });

  server.post<{ Params: { planId: string; taskId: string } }>("/api/plans/:planId/tasks/:taskId/reminder/cancel", async (request, reply) => {
    try {
      return store.cancelTaskReminder(request.params.planId, request.params.taskId);
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : "The Task reminder could not be cancelled." });
    }
  });

  server.put<{ Params: { planId: string }; Body: PlanAccommodationInput }>("/api/plans/:planId/accommodation", async (request, reply) => {
    try {
      return store.updatePlanAccommodation(request.params.planId, request.body);
    } catch (error) {
      return reply.code(400).send({
        error: error instanceof Error ? error.message : "The accommodation candidate could not be saved."
      });
    }
  });

  server.post<{ Params: { planId: string }; Body: { name?: string; address?: string; status?: "candidate" | "confirmed" } }>("/api/plans/:planId/accommodation/manual", async (request, reply) => {
    const name = request.body?.name?.trim() ?? "";
    const address = request.body?.address?.trim() ?? "";
    if (!name || !address) return reply.code(400).send({ error: "Enter both the accommodation name and its address or area." });

    const resolved = await getMaps().geocodeAddress({ address });
    if (resolved.status !== "available") return reply.code(connectorResponseStatus(resolved.status)).send(resolved);
    if (!resolved.data) return reply.code(404).send({ error: "Google Maps could not resolve that accommodation address." });

    try {
      return store.updatePlanAccommodation(request.params.planId, {
        status: request.body.status === "confirmed" ? "confirmed" : "candidate",
        name,
        address: resolved.data.formattedAddress,
        location: resolved.data.location,
        source: "user"
      });
    } catch (error) {
      return reply.code(400).send({
        error: error instanceof Error ? error.message : "The accommodation could not be saved."
      });
    }
  });

  server.post<{ Params: { planId: string }; Body: { expectedVersion?: number; name?: string; address?: string; status?: "candidate" | "confirmed" } }>("/api/plans/:planId/accommodation/linked", async (request, reply) => {
    const expectedVersion = Number(request.body?.expectedVersion);
    const name = request.body?.name?.trim() ?? "";
    const address = request.body?.address?.trim() ?? "";
    if (!Number.isInteger(expectedVersion) || expectedVersion <= 0 || !name || !address) return reply.code(400).send({ error: "Saving accommodation needs the current Plan version, name, and address." });
    const current = store.getWorkspace().activePlan;
    if (current.id !== request.params.planId || current.version !== expectedVersion) return reply.code(409).send({ error: "The Plan changed before this accommodation update started." });
    if (current.status !== "draft") return reply.code(409).send({ error: "An active Plan must use a replacement draft before changing accommodation." });

    const maps = getMaps();
    const resolved = await maps.geocodeAddress({ address });
    if (resolved.status !== "available") return reply.code(connectorResponseStatus(resolved.status)).send(resolved);
    if (!resolved.data) return reply.code(404).send({ error: "Google Maps could not resolve that accommodation address." });
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
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : "Accommodation could not be linked to this Plan." });
    }
  });

  server.put<{ Params: { planId: string }; Body: PlanTransportPreferenceInput }>("/api/plans/:planId/transport-preference", async (request, reply) => {
    try {
      return store.updatePlanTransportPreference(request.params.planId, request.body);
    } catch (error) {
      return reply.code(400).send({
        error: error instanceof Error ? error.message : "The transport preference could not be saved."
      });
    }
  });

  server.put<{ Params: { planId: string }; Body: PlanTravelContextInput }>("/api/plans/:planId/travel-context", async (request, reply) => {
    try {
      return store.updatePlanTravelContext(request.params.planId, request.body);
    } catch (error) {
      return reply.code(400).send({
        error: error instanceof Error ? error.message : "The travel context could not be saved."
      });
    }
  });

  server.put<{ Params: { planId: string }; Body: PlanArrivalInput }>("/api/plans/:planId/arrival", async (request, reply) => {
    try {
      return store.updatePlanArrival(request.params.planId, request.body);
    } catch (error) {
      return reply.code(400).send({
        error: error instanceof Error ? error.message : "The expected arrival could not be saved."
      });
    }
  });
}

function parseDirectBlueprintRevisions(value: unknown, createdAt: string): DirectBlueprintRevision[] {
  if (!isRecord(value)) throw new Error("Direct itinerary edits need a structured request.");
  if ("revisions" in value) {
    if (!Array.isArray(value.revisions)) throw new Error("Direct itinerary edits need revisions as a list.");
    if (!value.revisions.length) throw new Error("Direct itinerary edits need at least one edit.");
    if (value.revisions.length > MAX_DIRECT_BLUEPRINT_REVISIONS) throw new Error(`Apply ${MAX_DIRECT_BLUEPRINT_REVISIONS} itinerary edits or fewer at once.`);
    return value.revisions.map((revision) => parseDirectBlueprintRevision(revision, createdAt));
  }
  return [parseDirectBlueprintRevision(value, createdAt)];
}

function parseDirectBlueprintRevision(value: unknown, createdAt: string): DirectBlueprintRevision {
  if (!isRecord(value)) throw new Error("Direct itinerary edits need a structured request.");
  if (value.kind !== "add_place_to_day" && value.kind !== "move_place_within_day") throw new Error("Direct itinerary edits currently support adding or moving a place within a day.");
  const placeId = stringField(value, "placeId");
  const dayId = stringField(value, "dayId");
  const position = directRevisionPosition(value.position);
  if (value.kind === "move_place_within_day") return { kind: "move_place_within_day", placeId, dayId, position, createdAt };
  return { kind: "add_place_to_day", placeId, dayId, position, createdAt };
}

function expectedVersionFromBody(value: unknown): number {
  if (!isRecord(value) || typeof value.expectedVersion !== "number" || !Number.isInteger(value.expectedVersion) || value.expectedVersion <= 0) {
    throw new Error("Direct itinerary edits need the current Plan version.");
  }
  return value.expectedVersion;
}

function directRevisionPosition(value: unknown): DirectBlueprintRevision["position"] {
  if (!isRecord(value)) throw new Error("Direct itinerary edits need a placement position.");
  if (value.kind === "start") return { kind: "start" };
  if (value.kind === "end") return { kind: "end" };
  if (value.kind === "after") return { kind: "after", afterPlaceId: stringField(value, "afterPlaceId") };
  throw new Error("Direct itinerary edits need a supported placement position.");
}

function stringField(value: Record<string, unknown>, key: string): string {
  const field = value[key];
  if (typeof field !== "string" || !field.trim()) throw new Error(`Direct itinerary edits need ${key}.`);
  return field.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
