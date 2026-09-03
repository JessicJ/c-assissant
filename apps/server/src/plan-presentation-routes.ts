import type { FastifyInstance } from "fastify";
import type { PlanPresentation } from "@c-assistant/core";
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

  server.post<{ Params: { planId: string; segmentId: string }; Body: { expectedVersion?: number } }>("/api/plans/:planId/presentation/routes/:segmentId/refresh", async (request, reply) => {
    const expectedVersion = Number(request.body?.expectedVersion);
    if (!Number.isInteger(expectedVersion) || expectedVersion <= 0) return reply.code(400).send({ error: "A route refresh needs the current Plan version." });
    const workspace = store.getWorkspace();
    if (workspace.activePlan.id !== request.params.planId || workspace.activePlan.version !== expectedVersion) return reply.code(409).send({ error: "The Plan changed before this route refresh started. Review the latest version and try again." });
    try {
      const maps = getMaps();
      const facts = await refreshPlanRouteFacts(workspace.activePlan, request.params.segmentId, {
        geocodeAddress: (input) => maps.geocodeAddress(input),
        drivingRoute: (input) => maps.drivingRoute(input),
        walkingRoute: (input) => maps.walkingRoute(input),
        transitRoute: (input) => maps.transitRoute(input)
      });
      const { segmentId: _segmentId, geometry: _geometry, ...routeFacts } = facts;
      const updated = store.savePlanRouteRefresh({ planId: request.params.planId, segmentId: request.params.segmentId, expectedVersion, provider: "google_maps", ...routeFacts });
      return { workspace: updated, segment: updated.activePlan.presentation?.routeSegments.find((segment) => segment.id === request.params.segmentId) };
    } catch (error) {
      if (!(error instanceof PlanRouteRefreshError)) return reply.code(409).send({ error: error instanceof Error ? error.message : "The route refresh could not be saved." });
      const status = error.connectorStatus ? connectorResponseStatus(error.connectorStatus) : error.code === "unsupported_mode" ? 422 : error.code === "missing_segment" ? 404 : 400;
      return reply.code(status).send({ error: error.message, code: error.code });
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
        const refreshed = await refreshGeneratedPlanRoutes(plan, {
          geocodeAddress: (input) => maps.geocodeAddress(input),
          drivingRoute: (input) => maps.drivingRoute(input),
          walkingRoute: (input) => maps.walkingRoute(input),
          transitRoute: (input) => maps.transitRoute(input)
        }, { segmentIds: pendingRoutes.map((segment) => segment.id) });
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
