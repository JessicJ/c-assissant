import { GoogleMapsConnector, GoogleWeatherConnector, type ConnectorStatus } from "@c-assistant/connectors";

export type ConnectorBundle = {
  maps: GoogleMapsConnector;
  googleWeather: GoogleWeatherConnector;
};

export type LocalConfigurationSnapshot = {
  google: { configured: boolean };
  uber: { configured: boolean };
  amap: { configured: false };
  qweather: { configured: false; host: "" };
};

export function createConnectorBundleFromEnvironment(): ConnectorBundle {
  return {
    maps: new GoogleMapsConnector({ apiKey: process.env.GOOGLE_MAPS_API_KEY }),
    googleWeather: new GoogleWeatherConnector({ apiKey: process.env.GOOGLE_MAPS_API_KEY })
  };
}

export function createLocalConfigurationSnapshot(): LocalConfigurationSnapshot {
  return {
    google: { configured: Boolean(process.env.GOOGLE_MAPS_API_KEY) },
    uber: { configured: Boolean(process.env.UBER_CLIENT_ID) },
    amap: { configured: false },
    qweather: { configured: false, host: "" }
  };
}

export function connectorResponseStatus(status: ConnectorStatus): number {
  if (status === "available") return 200;
  if (status === "not_configured" || status === "unavailable") return 503;
  if (status === "unauthorized") return 401;
  if (status === "rate_limited") return 429;
  return 400;
}
