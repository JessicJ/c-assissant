import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import type { WhatsAppIncomingMessage } from "@c-assistant/connectors";
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

export async function registerConnectorRoutes(server: FastifyInstance, dependencies: {
  store: SqliteWorkspaceStore;
  envPath: string;
  getConnectors: () => ConnectorBundle;
  replaceConnectors: (connectors: ConnectorBundle) => void;
  processWhatsAppWebhook: (messages: WhatsAppIncomingMessage[]) => Promise<void>;
}): Promise<void> {
  const { store, envPath, getConnectors, replaceConnectors, processWhatsAppWebhook } = dependencies;
  const localConfigurationSnapshot = () => createLocalConfigurationSnapshot(getConnectors().whatsapp);

  server.get("/api/configuration", async () => localConfigurationSnapshot());

  server.put<{ Body: LocalConfigurationUpdate }>("/api/configuration", async (request, reply) => {
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

  server.get("/api/connectors/telegram", async () => getConnectors().telegram.configurationStatus());
  server.get("/api/connectors/whatsapp", async () => getConnectors().whatsapp.configurationStatus());

  server.post("/api/connectors/whatsapp/verify", async (_request, reply) => {
    const result = await getConnectors().whatsapp.verifyPhoneNumber();
    return reply.code(connectorResponseStatus(result.status)).send(result);
  });

  server.get<{ Querystring: Record<string, string | undefined> }>("/api/connectors/whatsapp/webhook", async (request, reply) => {
    const result = getConnectors().whatsapp.verifyWebhookChallenge({ mode: request.query["hub.mode"], verifyToken: request.query["hub.verify_token"], challenge: request.query["hub.challenge"] });
    if (result.status !== "available" || !result.data) return reply.code(connectorResponseStatus(result.status)).send(result);
    return reply.type("text/plain; charset=utf-8").send(result.data);
  });

  await server.register(async (whatsappWebhookServer) => {
    whatsappWebhookServer.removeContentTypeParser("application/json");
    whatsappWebhookServer.addContentTypeParser("application/json", { parseAs: "buffer" }, (_request, body, done) => done(null, body));
    whatsappWebhookServer.post<{ Body: Buffer }>("/api/connectors/whatsapp/webhook", async (request, reply) => {
      const signatureHeader = request.headers["x-hub-signature-256"];
      const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
      const result = getConnectors().whatsapp.receiveWebhook({ rawBody: request.body, signature });
      if (result.status !== "available" || !result.data) return reply.code(connectorResponseStatus(result.status)).send(result);
      try {
        await processWhatsAppWebhook(result.data.messages);
      } catch (error) {
        server.log.error({ error }, "WhatsApp webhook processing failed");
      }
      return reply.code(200).send({ received: true });
    });
  });

  server.post("/api/connectors/telegram/verify", async (_request, reply) => {
    const result = await getConnectors().telegram.getMe();
    return reply.code(connectorResponseStatus(result.status)).send(result);
  });

  server.get("/api/connectors/telegram/pairing", async () => store.getTelegramPairingStatus());
  server.delete("/api/connectors/telegram/pairing", async () => store.unpairTelegram());

  server.post("/api/connectors/telegram/pairing/start", async (_request, reply) => {
    const identity = await getConnectors().telegram.getMe();
    if (identity.status !== "available" || !identity.data?.username) return reply.code(connectorResponseStatus(identity.status)).send(identity);
    const pairing = store.getTelegramPairingStatus();
    if (pairing.state === "paired") return pairing;
    const code = `pair_${randomUUID().replaceAll("-", "")}`;
    const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
    const pending = store.createTelegramPairingRequest({ code, expiresAt });
    return {
      state: pending.state,
      code,
      expiresAt,
      botUsername: identity.data.username,
      deepLink: `https://t.me/${identity.data.username}?start=${code}`
    };
  });

  server.post<{ Body: { code?: string } }>("/api/connectors/telegram/pairing/complete", async (request, reply) => {
    const code = request.body?.code?.trim() ?? "";
    if (!code) return reply.code(400).send({ error: "A Telegram pairing code is required." });
    const pending = store.getTelegramPairingStatus();
    if (pending.state === "paired") return pending;
    if (pending.state !== "waiting_for_start") return reply.code(400).send({ error: "Start a new Telegram pairing from the Web workspace." });
    const telegram = getConnectors().telegram;
    const updates = await telegram.getUpdates();
    if (updates.status !== "available") return reply.code(connectorResponseStatus(updates.status)).send(updates);
    const startUpdate = updates.data?.updates.find((update) => update.chatType === "private" && pairingCodeFromStart(update.text) === code);
    if (!startUpdate) return { state: "waiting_for_start", expiresAt: pending.expiresAt, foundStart: false };
    try {
      const paired = store.claimTelegramPairing({
        code,
        chatId: startUpdate.chatId,
        userId: startUpdate.userId,
        firstName: startUpdate.firstName,
        ...(startUpdate.username ? { username: startUpdate.username } : {})
      });
      store.advanceTelegramUpdateOffset(startUpdate.updateId + 1);
      const receipt = await telegram.sendMessage({ chatId: startUpdate.chatId, text: "Landi is connected to this Telegram account. You will control future reminders and actions from your Plan. Send /profile whenever you want to complete or change your basic long-term settings." });
      return { ...paired, confirmationMessageSent: receipt.status === "available" };
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : "Telegram could not be paired." });
    }
  });

  registerMapConnectorRoutes(server, getConnectors);
}

function pairingCodeFromStart(value: string | undefined): string | undefined {
  const match = value?.trim().match(/^\/start(?:@[-_A-Za-z0-9]+)?\s+([A-Za-z0-9_-]{12,96})$/);
  return match?.[1];
}
