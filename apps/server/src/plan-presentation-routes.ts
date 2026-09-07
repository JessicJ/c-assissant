import type { FastifyInstance } from "fastify";
import { blueprintPresentation, type Plan, type PlanPresentation, type WorkspaceSnapshot } from "@c-assistant/core";
import type { SqliteWorkspaceStore } from "@c-assistant/storage";
import { connectorResponseStatus } from "./connector-bundle.js";
import { PlanRouteRefreshError, refreshGeneratedPlanRoutes, refreshPlanRouteFacts, type PlanRouteMaps } from "./plan-route-refresh.js";

type PlanPresentationMaps = PlanRouteMaps & {
  configurationStatus(): { status: string };
};

export function registerPlanPresentationRoutes(server: FastifyInstance, dependencies: {
  store: SqliteWorkspaceStore;
  getMaps: () => PlanPresentationMaps;
}): void {
  const { store, getMaps } = dependencies;

  server.post<{ Params: { planId: string; segmentId: string }; Body: { expectedVersion?: number; expectedBlueprintVersion?: number } }>("/api/plans/:planId/presentation/routes/:segmentId/refresh", async (request, reply) => {
    const expectedVersion = Number(request.body?.expectedVersion);
    if (!Number.isInteger(expectedVersion) || expectedVersion <= 0) return reply.code(400).send({ error: "A route refresh needs the current Plan version." });
    const expectedBlueprintVersion = routeRefreshExpectedBlueprintVersion(request.body?.expectedBlueprintVersion);
    if (expectedBlueprintVersion === false) return reply.code(400).send({ error: "A route refresh needs a valid Trip Blueprint version." });
    const workspace = store.getWorkspace();
    if (workspace.activePlan.id !== request.params.planId || workspace.activePlan.version !== expectedVersion) return reply.code(409).send({ error: "The Plan changed before this route refresh started. Review the latest version and try again." });
    if (expectedBlueprintVersion !== undefined && workspace.activeBlueprint && workspace.activeBlueprint.version !== expectedBlueprintVersion) return reply.code(409).send({ error: "The Trip Blueprint changed before this route refresh started. Review the latest version and try again." });
    try {
      const maps = getMaps();
      const facts = await refreshPlanRouteFacts(routeRefreshPlanForWorkspace(workspace), request.params.segmentId, routeRefreshMaps(maps));
      const { segmentId: _segmentId, geometry: _geometry, ...routeFacts } = facts;
      const updated = store.savePlanRouteRefresh({ planId: request.params.planId, segmentId: request.params.segmentId, expectedVersion, ...(expectedBlueprintVersion !== undefined ? { expectedBlueprintVersion } : {}), provider: "google_maps", ...routeFacts });
      return { workspace: updated, segment: updated.activePlan.presentation?.routeSegments.find((segment) => segment.id === request.params.segmentId) };
    } catch (error) {
      if (!(error instanceof PlanRouteRefreshError)) return reply.code(409).send({ error: error instanceof Error ? error.message : "The route refresh could not be saved." });
      return reply.code(routeRefreshStatus(error)).send({ error: error.message, code: error.code });
    }
  });

  server.post<{ Params: { planId: string }; Body: { expectedVersion?: number; expectedBlueprintVersion?: number; segmentIds?: unknown } }>("/api/plans/:planId/presentation/routes/refresh", async (request, reply) => {
    const expectedVersion = Number(request.body?.expectedVersion);
    const expectedBlueprintVersion = routeRefreshExpectedBlueprintVersion(request.body?.expectedBlueprintVersion);
    const segmentIds = routeRefreshSegmentIds(request.body?.segmentIds);
    if (!Number.isInteger(expectedVersion) || expectedVersion <= 0) return reply.code(400).send({ error: "A route refresh needs the current Plan version." });
    if (expectedBlueprintVersion === false) return reply.code(400).send({ error: "A route refresh needs a valid Trip Blueprint version." });
    if (!segmentIds.length) return reply.code(400).send({ error: "Choose at least one route leg to refresh." });
    if (segmentIds.length > 36) return reply.code(400).send({ error: "Refresh 36 route legs or fewer at once." });
    const workspace = store.getWorkspace();
    if (workspace.activePlan.id !== request.params.planId || workspace.activePlan.version !== expectedVersion) return reply.code(409).send({ error: "The Plan changed before this route refresh started. Review the latest version and try again." });
    if (expectedBlueprintVersion !== undefined && workspace.activeBlueprint && workspace.activeBlueprint.version !== expectedBlueprintVersion) return reply.code(409).send({ error: "The Trip Blueprint changed before this route refresh started. Review the latest version and try again." });
    try {
      const plan = routeRefreshPlanForWorkspace(workspace);
      const validationError = batchRouteRefreshValidationError(plan, segmentIds);
      if (validationError) return reply.code(routeRefreshStatus(validationError)).send({ error: validationError.message, code: validationError.code });
      const refreshed = await refreshGeneratedPlanRoutes(plan, routeRefreshMaps(getMaps()), { segmentIds });
      const refreshedIds = new Set(refreshed.refreshed.map((route) => route.segmentId));
      const failedSegmentIds = [...new Set([...refreshed.failedSegmentIds, ...segmentIds.filter((segmentId) => !refreshedIds.has(segmentId))])];
      if (failedSegmentIds.length) {
        return reply.code(424).send({ error: "Some route legs could not be refreshed. The itinerary was not changed.", failedSegmentIds });
      }
      const saved = store.saveGeneratedPlanRouteRefresh({ planId: request.params.planId, expectedVersion, ...(expectedBlueprintVersion !== undefined ? { expectedBlueprintVersion } : {}), provider: "google_maps", routes: refreshed.refreshed });
      return {
        workspace: saved.workspace,
        routeRefresh: {
          segmentIds,
          refreshedSegmentIds: refreshed.refreshed.map((route) => route.segmentId),
          scheduleConflictDayIds: saved.scheduleConflictDayIds
        }
      };
    } catch (error) {
      if (!(error instanceof PlanRouteRefreshError)) return reply.code(409).send({ error: error instanceof Error ? error.message : "The route refresh could not be saved." });
      return reply.code(routeRefreshStatus(error)).send({ error: error.message, code: error.code });
    }
  });

  server.patch<{ Params: { planId: string }; Body: { expectedVersion?: number; assignments?: Record<string, string>; priorities?: Record<string, string>; orders?: Record<string, string[]> } }>("/api/plans/:planId/presentation", async (request, reply) => {
    const expectedVersion = Number(request.body?.expectedVersion);
    if (!Number.isInteger(expectedVersion) || expectedVersion <= 0 || !request.body?.assignments || !request.body?.priorities || !request.body?.orders) return reply.code(400).send({ error: "Itinerary edits need the current Plan version and complete map state." });
    const before = store.getWorkspace().activePlan;
    const affectedDayIds = before.id === request.params.planId && before.version === expectedVersion && before.presentation?.kind === "itinerary"
      ? itineraryEditAffectedDayIds(before.presentation, request.body.assignments, request.body.orders)
      : new Set<string>();
    try {
      const saved = store.savePlanPresentationEdits({ planId: request.params.planId, expectedVersion, assignments: request.body.assignments, priorities: request.body.priorities, orders: request.body.orders });
      const plan = saved.activePlan;
      const maps = getMaps();
      const pendingRoutes = plan.presentation?.kind === "itinerary" ? plan.presentation.routeSegments.filter((segment) => affectedDayIds.has(segment.dayId ?? "") && segment.verification === "needs_verification" && ["driving", "walking", "transit"].includes(segment.mode)) : [];
      if (!pendingRoutes.length || maps.configurationStatus().status !== "available") return saved;
      try {
        const refreshed = await refreshGeneratedPlanRoutes(plan, routeRefreshMaps(maps), { segmentIds: pendingRoutes.map((segment) => segment.id) });
        if (!refreshed.refreshed.length) return saved;
        return store.saveGeneratedPlanRouteRefresh({ planId: plan.id, expectedVersion: plan.version, provider: "google_maps", routes: refreshed.refreshed }).workspace;
      } catch (error) {
        server.log.warn({ error, planId: plan.id }, "Edited itinerary routes could not be refreshed automatically");
        return saved;
      }
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : "The itinerary edits could not be saved." });
    }
  });
}

function routeRefreshMaps(maps: PlanPresentationMaps): PlanRouteMaps {
  return {
    geocodeAddress: (input) => maps.geocodeAddress(input),
    drivingRoute: (input) => maps.drivingRoute(input),
    walkingRoute: (input) => maps.walkingRoute(input),
    transitRoute: (input) => maps.transitRoute(input)
  };
}

function routeRefreshPlanForWorkspace(workspace: WorkspaceSnapshot): Plan {
  if (workspace.activeBlueprint) return { ...workspace.activePlan, presentation: blueprintPresentation(workspace.activeBlueprint) };
  if (workspace.activePlan.presentation?.kind === "itinerary") return workspace.activePlan;
  return workspace.activePlan;
}

function routeRefreshSegmentIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))];
}

function routeRefreshExpectedBlueprintVersion(value: unknown): number | undefined | false {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) return false;
  return value;
}

function batchRouteRefreshValidationError(plan: Plan, segmentIds: string[]): PlanRouteRefreshError | undefined {
  const presentation = plan.presentation;
  if (!presentation || presentation.kind !== "itinerary") return new PlanRouteRefreshError("missing_presentation", "This Plan does not contain a structured itinerary presentation.");
  const segmentById = new Map(presentation.routeSegments.map((segment) => [segment.id, segment]));
  const placeIds = new Set(presentation.places.map((place) => place.id));
  for (const segmentId of segmentIds) {
    const segment = segmentById.get(segmentId);
    if (!segment) return new PlanRouteRefreshError("missing_segment", "The Plan route segment was not found.");
    if (segment.mode !== "driving" && segment.mode !== "walking" && segment.mode !== "transit") return new PlanRouteRefreshError("unsupported_mode", "Automatic refresh currently supports driving, walking, and public-transit segments only.");
    if (!placeIds.has(segment.originPlaceId) || !placeIds.has(segment.destinationPlaceId)) return new PlanRouteRefreshError("missing_place", "The route references a place that is no longer in this Plan.");
  }
  return undefined;
}

function routeRefreshStatus(error: PlanRouteRefreshError): number {
  if (error.connectorStatus) return connectorResponseStatus(error.connectorStatus);
  if (error.code === "unsupported_mode") return 422;
  if (error.code === "missing_segment") return 404;
  return 400;
}

function itineraryEditAffectedDayIds(presentation: PlanPresentation, assignments: Record<string, string>, orders: Record<string, string[]>): Set<string> {
  if (presentation.kind !== "itinerary") return new Set();
  const affected = new Set<string>();
  const originalDayByPlace = new Map(presentation.days.flatMap((day) => day.placeIds.map((placeId) => [placeId, day.id] as const)));
  for (const day of presentation.days) {
    const requested = (orders[day.id] ?? []).filter((placeId) => assignments[placeId] === day.id);
    const unordered = presentation.places.map((place) => place.id).filter((placeId) => assignments[placeId] === day.id && !requested.includes(placeId));
    const nextPlaceIds = [...requested, ...unordered];
    if (nextPlaceIds.join("\0") !== day.placeIds.join("\0")) affected.add(day.id);
  }
  for (const [placeId, previousDayId] of originalDayByPlace) {
    const nextDayId = assignments[placeId] || "";
    if (previousDayId !== nextDayId) {
      affected.add(previousDayId);
      if (nextDayId) affected.add(nextDayId);
    }
  }
  return affected;
}
