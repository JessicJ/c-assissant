import type { FastifyInstance } from "fastify";
import { runHousingAreaRecommendationSkill } from "@c-assistant/china-country-pack";
import { connectorResponseStatus, type ConnectorBundle } from "./connector-bundle.js";

export function registerMapConnectorRoutes(server: FastifyInstance, getConnectors: () => ConnectorBundle): void {
  server.get<{ Querystring: { query?: string; region?: string } }>("/api/maps/places", async (request, reply) => {
    const result = await getConnectors().maps.searchPlaces({ query: request.query.query ?? "", region: request.query.region });
    return reply.code(result.status === "available" ? 200 : result.status === "not_configured" ? 503 : 400).send(result);
  });

  server.get<{ Querystring: { location?: string } }>("/api/maps/nearby/restaurants", async (request, reply) => {
    const result = await getConnectors().maps.nearbyRestaurants({ location: request.query.location ?? "" });
    return reply.code(connectorResponseStatus(result.status)).send(result);
  });

  server.get<{ Querystring: { location?: string; name?: string } }>("/api/maps/nearby/accommodation", async (request, reply) => {
    const result = await getConnectors().maps.nearbyAccommodation({ location: request.query.location ?? "" });
    if (result.status !== "available" || !result.data) return reply.code(connectorResponseStatus(result.status)).send(result);
    const skill = runHousingAreaRecommendationSkill({ ...(request.query.name ? { centreName: request.query.name } : {}), candidates: result.data, observedAt: result.observedAt, provider: "google_maps" });
    return reply.send({ ...result, skill });
  });

  server.get<{ Querystring: { origin?: string; destination?: string; originId?: string; destinationId?: string } }>("/api/maps/routes/driving", async (request, reply) => {
    const result = await getConnectors().maps.drivingRoute({
      origin: request.query.origin ?? "",
      destination: request.query.destination ?? "",
      originId: request.query.originId,
      destinationId: request.query.destinationId
    });
    return reply.code(result.status === "available" ? 200 : result.status === "not_configured" ? 503 : 400).send(result);
  });

  server.get<{ Querystring: { origin?: string; destination?: string; originId?: string; destinationId?: string } }>("/api/maps/routes/walking", async (request, reply) => {
    const result = await getConnectors().maps.walkingRoute({
      origin: request.query.origin ?? "",
      destination: request.query.destination ?? "",
      originId: request.query.originId,
      destinationId: request.query.destinationId
    });
    return reply.code(connectorResponseStatus(result.status)).send(result);
  });

  server.get<{ Querystring: { origin?: string; destination?: string; originCityCode?: string; destinationCityCode?: string } }>("/api/maps/routes/transit", async (request, reply) => {
    const result = await getConnectors().maps.transitRoute({
      origin: request.query.origin ?? "",
      destination: request.query.destination ?? "",
      originCityCode: request.query.originCityCode,
      destinationCityCode: request.query.destinationCityCode
    });
    return reply.code(connectorResponseStatus(result.status)).send(result);
  });

  // Temporary aliases for the separately migrated Web workspace. Remove after it uses /api/maps/*.
  server.get<{ Querystring: { query?: string; region?: string } }>("/api/amap/places", async (request, reply) => {
    const result = await getConnectors().maps.searchPlaces({ query: request.query.query ?? "", region: request.query.region });
    return reply.code(connectorResponseStatus(result.status)).send(result);
  });
  server.get<{ Querystring: { location?: string } }>("/api/amap/nearby/restaurants", async (request, reply) => {
    const result = await getConnectors().maps.nearbyRestaurants({ location: request.query.location ?? "" });
    return reply.code(connectorResponseStatus(result.status)).send(result);
  });
  server.get<{ Querystring: { location?: string; name?: string } }>("/api/amap/nearby/accommodation", async (request, reply) => {
    const result = await getConnectors().maps.nearbyAccommodation({ location: request.query.location ?? "" });
    if (result.status !== "available" || !result.data) return reply.code(connectorResponseStatus(result.status)).send(result);
    const skill = runHousingAreaRecommendationSkill({ ...(request.query.name ? { centreName: request.query.name } : {}), candidates: result.data, observedAt: result.observedAt, provider: "google_maps" });
    return reply.send({ ...result, skill });
  });
  server.get<{ Querystring: { origin?: string; destination?: string; originId?: string; destinationId?: string } }>("/api/amap/routes/driving", async (request, reply) => {
    const result = await getConnectors().maps.drivingRoute({ origin: request.query.origin ?? "", destination: request.query.destination ?? "", originId: request.query.originId, destinationId: request.query.destinationId });
    return reply.code(connectorResponseStatus(result.status)).send(result);
  });
  server.get<{ Querystring: { origin?: string; destination?: string; originId?: string; destinationId?: string } }>("/api/amap/routes/walking", async (request, reply) => {
    const result = await getConnectors().maps.walkingRoute({ origin: request.query.origin ?? "", destination: request.query.destination ?? "", originId: request.query.originId, destinationId: request.query.destinationId });
    return reply.code(connectorResponseStatus(result.status)).send(result);
  });
  server.get<{ Querystring: { origin?: string; destination?: string; originCityCode?: string; destinationCityCode?: string } }>("/api/amap/routes/transit", async (request, reply) => {
    const result = await getConnectors().maps.transitRoute({ origin: request.query.origin ?? "", destination: request.query.destination ?? "", originCityCode: request.query.originCityCode, destinationCityCode: request.query.destinationCityCode });
    return reply.code(connectorResponseStatus(result.status)).send(result);
  });
}
