import { GoogleMapsConnector, GoogleWeatherConnector, TelegramConnector, WhatsAppConnector, type ConnectorStatus } from "@c-assistant/connectors";
import { normalizeWhatsAppUserNumber } from "./whatsapp-number.js";

export type ConnectorBundle = {
  maps: GoogleMapsConnector;
  googleWeather: GoogleWeatherConnector;
  telegram: TelegramConnector;
  whatsapp: WhatsAppConnector;
};

export type LocalConfigurationSnapshot = {
  google: { configured: boolean };
  uber: { configured: boolean };
  amap: { configured: false };
  qweather: { configured: false; host: "" };
  telegram: { configured: boolean };
  whatsapp: {
    configured: boolean;
    state: string;
    paired: boolean;
  };
};

export function createWhatsAppConnectorFromEnvironment(): WhatsAppConnector {
  return new WhatsAppConnector({
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN,
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
    businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID,
    appSecret: process.env.WHATSAPP_APP_SECRET,
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN,
    reminderTemplateName: process.env.WHATSAPP_REMINDER_TEMPLATE_NAME,
    graphApiVersion: process.env.WHATSAPP_GRAPH_API_VERSION
  });
}

export function createConnectorBundleFromEnvironment(): ConnectorBundle {
  return {
    maps: new GoogleMapsConnector({ apiKey: process.env.GOOGLE_MAPS_API_KEY }),
    googleWeather: new GoogleWeatherConnector({ apiKey: process.env.GOOGLE_MAPS_API_KEY }),
    telegram: new TelegramConnector({ botToken: process.env.TELEGRAM_BOT_TOKEN }),
    whatsapp: createWhatsAppConnectorFromEnvironment()
  };
}

export function createLocalConfigurationSnapshot(whatsapp: WhatsAppConnector): LocalConfigurationSnapshot {
  const whatsappStatus = whatsapp.configurationStatus();
  return {
    google: { configured: Boolean(process.env.GOOGLE_MAPS_API_KEY) },
    uber: { configured: Boolean(process.env.UBER_CLIENT_ID) },
    amap: { configured: false },
    qweather: { configured: false, host: "" },
    telegram: { configured: Boolean(process.env.TELEGRAM_BOT_TOKEN) },
    whatsapp: {
      configured: whatsappStatus.status !== "not_configured",
      state: whatsappStatus.data?.state ?? "not_configured",
      paired: Boolean(normalizeWhatsAppUserNumber(process.env.WHATSAPP_ALLOWED_USER_NUMBER))
    }
  };
}

export function connectorResponseStatus(status: ConnectorStatus): number {
  if (status === "available") return 200;
  if (status === "not_configured" || status === "unavailable") return 503;
  if (status === "unauthorized") return 401;
  if (status === "rate_limited") return 429;
  return 400;
}
