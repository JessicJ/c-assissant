import type { FastifyInstance } from "fastify";
import type { SqliteWorkspaceStore } from "@c-assistant/storage";
import {
  connectorResponseStatus,
  createConnectorBundleFromEnvironment,
  createLocalConfigurationSnapshot,
  type ConnectorBundle
} from "./connector-bundle.js";
import { saveLocalConfiguration, type LocalConfigurationUpdate } from "./connector-configuration.js";
import { validLongitudeLatitude } from "./geo-coordinates.js";
import { registerMapConnectorRoutes } from "./map-connector-routes.js";
import { fetchUserWeather } from "./user-weather.js";
import { registerEmailExecutionRoutes } from "./email-execution-routes.js";

export async function registerConnectorRoutes(server: FastifyInstance, dependencies: {
  store: SqliteWorkspaceStore;
  envPath: string;
  getConnectors: () => ConnectorBundle;
  replaceConnectors: (connectors: ConnectorBundle) => void;
  startActivePlanMonitoring?:()=>void;
  getGeneratingPlan?:()=>boolean;
}): Promise<void> {
  const { store, envPath, getConnectors, replaceConnectors } = dependencies;
  registerEmailExecutionRoutes(server, { store, envPath, ...(dependencies.startActivePlanMonitoring?{startActivePlanMonitoring:dependencies.startActivePlanMonitoring}:{}), ...(dependencies.getGeneratingPlan?{getGeneratingPlan:dependencies.getGeneratingPlan}:{}) });
  const localConfigurationSnapshot = () => createLocalConfigurationSnapshot();

  server.get("/api/configuration", async () => localConfigurationSnapshot());

  server.put<{ Body: LocalConfigurationUpdate }>("/api/configuration", async (request, reply) => {
    if (Object.keys(request.body ?? {}).some(key => key.startsWith("telegram") || key.startsWith("whatsapp"))) {
      return reply.code(400).send({ error: "Chat channels are retired. Configure email assistance instead." });
    }
    try {
      saveLocalConfiguration(envPath, request.body ?? {});
      replaceConnectors(createConnectorBundleFromEnvironment());
      return localConfigurationSnapshot();
    } catch (error) {
      return reply.code(500).send({ error: error instanceof Error ? error.message : "Local configuration could not be saved." });
    }
  });

  server.get("/api/connectors/google", async () => {
    const { maps, googleWeather } = getConnectors();
    return { maps: maps.configurationStatus(), weather: googleWeather.configurationStatus() };
  });
  server.get("/api/connectors/uber", async () => ({ status: "available", provider: "uber", observedAt: new Date().toISOString(), configured: Boolean(process.env.UBER_CLIENT_ID) }));
  server.get("/api/connectors/amap", async () => ({ status: "unsupported", provider: "amap", observedAt: new Date().toISOString(), failure: { code: "disabled", message: "Amap is paused; Landi uses Google Maps Platform.", retryable: false } }));
  server.get("/api/connectors/qweather", async () => ({ status: "unsupported", provider: "qweather", observedAt: new Date().toISOString(), failure: { code: "disabled", message: "QWeather is paused; Landi uses Google Weather.", retryable: false } }));

  server.get<{ Querystring: { location?: string; coordinates?: string; language?: string } }>("/api/weather", async (request, reply) => {
    const { maps, googleWeather } = getConnectors();
    const requestedLocation = request.query.location?.trim() ?? "";
    const requestedCoordinates = request.query.coordinates?.trim() ?? "";
    if (!requestedLocation && !requestedCoordinates) return reply.code(400).send({ error: "A weather check needs a city, region, or coordinates." });
    const place = requestedCoordinates ? undefined : await maps.geocodeAddress({ address: requestedLocation });
    if (place && place.status !== "available") return reply.code(connectorResponseStatus(place.status)).send(place);
    if (place && !place.data) return reply.code(404).send({ error: "Google Maps could not resolve that city or region." });
    const coordinates = requestedCoordinates || place?.data?.location;
    if (!coordinates || !validLongitudeLatitude(coordinates)) return reply.code(400).send({ error: "A weather check needs valid longitude,latitude coordinates." });
    const result = await fetchUserWeather({
      coordinates,
      locationName: place?.data?.formattedAddress ?? requestedLocation,
      adminArea: place?.data ? place.data.district || place.data.city || place.data.province : requestedLocation,
      country: "",
      language: "en",
      dependencies: { weather: (input) => googleWeather.weather(input) }
    });
    return reply.code(connectorResponseStatus(result.status)).send(result);
  });

  registerMapConnectorRoutes(server, getConnectors);
}
