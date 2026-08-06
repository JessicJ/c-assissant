export type ConnectorStatus = "available" | "degraded" | "not_configured" | "unauthorized" | "rate_limited" | "unavailable" | "unsupported";
export type ConnectorProvider = "amap" | "qweather" | "telegram";

export interface ConnectorResult<T> {
  status: ConnectorStatus;
  data?: T;
  provider: ConnectorProvider;
  observedAt: string;
  failure?: {
    code: string;
    message: string;
    retryable: boolean;
  };
}

export interface AmapPlace {
  id: string;
  name: string;
  address: string;
  location: string;
  type: string;
  city: string;
  district: string;
}

/** A factual POI returned relative to a user-selected centre point. */
export interface AmapNearbyPlace extends AmapPlace {
  distanceMeters: number;
}

export interface AmapRoute {
  mode: "driving";
  origin: string;
  destination: string;
  distanceMeters: number;
  durationSeconds?: number;
  taxiCostYuan?: number;
  strategy: "amap_recommended";
}

export interface AmapGeocodedPlace {
  formattedAddress: string;
  location: string;
  province: string;
  city: string;
  district: string;
  level: string;
}

export interface AmapRouteHandoff {
  provider: "amap";
  action: "route_planning";
  transport: "driving";
  url: string;
  requiresUserAction: true;
}

export interface AmapConnectorOptions {
  apiKey?: string | undefined;
  fetcher?: typeof fetch;
}

interface AmapResponse {
  status?: string;
  info?: string;
  infocode?: string;
  pois?: Array<{
    id?: string;
    name?: string;
    address?: string;
    location?: string;
    type?: string;
    cityname?: string;
    adname?: string;
    distance?: string;
  }>;
  route?: {
    origin?: string;
    destination?: string;
    taxi_cost?: string;
    paths?: Array<{
      distance?: string;
      cost?: { duration?: string };
    }>;
  };
  geocodes?: Array<{
    formatted_address?: string;
    location?: string;
    province?: string | string[];
    city?: string | string[];
    district?: string | string[];
    level?: string;
  }>;
}

export class AmapConnector {
  private readonly apiKey: string | undefined;
  private readonly fetcher: typeof fetch;

  constructor({ apiKey, fetcher = fetch }: AmapConnectorOptions) {
    this.apiKey = apiKey?.trim() || undefined;
    this.fetcher = fetcher;
  }

  configurationStatus(): ConnectorResult<undefined> {
    if (!this.apiKey) return this.failure("not_configured", "AMAP_API_KEY is not configured.", "not_configured", false);
    return { status: "available", provider: "amap", observedAt: new Date().toISOString() };
  }

  async searchPlaces(input: { query: string; region?: string | undefined; limit?: number | undefined }): Promise<ConnectorResult<AmapPlace[]>> {
    const query = input.query.trim();
    if (!query) return this.failure("unsupported", "A place search needs a query.", "invalid_query", false);
    if (!this.apiKey) return this.failure("not_configured", "Amap is not configured on this instance.", "not_configured", false);

    const params = new URLSearchParams({
      key: this.apiKey,
      keywords: query.slice(0, 80),
      page_size: String(Math.min(Math.max(input.limit ?? 5, 1), 25)),
      show_fields: "business,navi"
    });
    if (input.region?.trim()) {
      params.set("region", input.region.trim());
      params.set("city_limit", "true");
    }

    const response = await this.request("/v5/place/text", params);
    if (!response.ok) return response.failure;
    const payload = response.payload;
    if (payload.status !== "1") return this.fromAmapFailure(payload);

    return {
      status: "available",
      provider: "amap",
      observedAt: new Date().toISOString(),
      data: (payload.pois ?? []).flatMap((poi) => {
        if (!poi.id || !poi.name || !poi.location) return [];
        return [{
          id: poi.id,
          name: poi.name,
          address: poi.address ?? "Address unavailable",
          location: poi.location,
          type: poi.type ?? "Unspecified",
          city: poi.cityname ?? "",
          district: poi.adname ?? ""
        }];
      })
    };
  }

  /**
   * Finds restaurant POIs around a confirmed location. This is discovery
   * evidence only: it neither ranks places as recommendations nor starts an
   * order, reservation, or payment.
   */
  async nearbyRestaurants(input: { location: string; radiusMeters?: number | undefined; limit?: number | undefined }): Promise<ConnectorResult<AmapNearbyPlace[]>> {
    if (!isCoordinate(input.location)) {
      return this.failure("unsupported", "Nearby discovery needs a valid longitude,latitude centre point.", "invalid_coordinates", false);
    }
    if (!this.apiKey) return this.failure("not_configured", "Amap is not configured on this instance.", "not_configured", false);

    const radiusMeters = Math.min(Math.max(Math.round(input.radiusMeters ?? 1_500), 100), 5_000);
    const params = new URLSearchParams({
      key: this.apiKey,
      location: input.location,
      types: "050000",
      radius: String(radiusMeters),
      sortrule: "distance",
      page_size: String(Math.min(Math.max(input.limit ?? 8, 1), 25))
    });
    const response = await this.request("/v5/place/around", params);
    if (!response.ok) return response.failure;
    const payload = response.payload;
    if (payload.status !== "1") return this.fromAmapFailure(payload);

    return {
      status: "available",
      provider: "amap",
      observedAt: new Date().toISOString(),
      data: (payload.pois ?? []).flatMap((poi) => {
        const distanceMeters = Number(poi.distance);
        if (!poi.id || !poi.name || !poi.location || !Number.isFinite(distanceMeters) || distanceMeters < 0) return [];
        return [{
          id: poi.id,
          name: poi.name,
          address: poi.address ?? "Address unavailable",
          location: poi.location,
          type: poi.type ?? "Restaurant service",
          city: poi.cityname ?? "",
          district: poi.adname ?? "",
          distanceMeters
        }];
      })
    };
  }

  async drivingRoute(input: { origin: string; destination: string; originId?: string | undefined; destinationId?: string | undefined }): Promise<ConnectorResult<AmapRoute>> {
    if (!isCoordinate(input.origin) || !isCoordinate(input.destination)) {
      return this.failure("unsupported", "Amap route planning needs longitude,latitude coordinates for both places.", "invalid_coordinates", false);
    }
    if (!this.apiKey) return this.failure("not_configured", "Amap is not configured on this instance.", "not_configured", false);

    const params = new URLSearchParams({
      key: this.apiKey,
      origin: input.origin,
      destination: input.destination,
      strategy: "32",
      show_fields: "cost"
    });
    if (input.originId) params.set("origin_id", input.originId);
    if (input.destinationId) params.set("destination_id", input.destinationId);

    const response = await this.request("/v5/direction/driving", params);
    if (!response.ok) return response.failure;
    const payload = response.payload;
    if (payload.status !== "1") return this.fromAmapFailure(payload);
    const path = payload.route?.paths?.[0];
    if (!path?.distance) return this.failure("degraded", "Amap did not return a usable route.", "missing_route", true);

    return {
      status: "available",
      provider: "amap",
      observedAt: new Date().toISOString(),
      data: {
        mode: "driving",
        origin: payload.route?.origin ?? input.origin,
        destination: payload.route?.destination ?? input.destination,
        distanceMeters: Number(path.distance),
        ...(path.cost?.duration ? { durationSeconds: Number(path.cost.duration) } : {}),
        ...(payload.route?.taxi_cost ? { taxiCostYuan: Number(payload.route.taxi_cost) } : {}),
        strategy: "amap_recommended"
      }
    };
  }

  async geocodeAddress(input: { address: string; city?: string | undefined }): Promise<ConnectorResult<AmapGeocodedPlace>> {
    const address = input.address.trim();
    if (!address) return this.failure("unsupported", "An address lookup needs a city, region, or address.", "missing_address", false);
    if (!this.apiKey) return this.failure("not_configured", "Amap is not configured on this instance.", "not_configured", false);
    const params = new URLSearchParams({ key: this.apiKey, address: address.slice(0, 160) });
    if (input.city?.trim()) params.set("city", input.city.trim().slice(0, 80));
    const response = await this.request("/v3/geocode/geo", params);
    if (!response.ok) return response.failure;
    if (response.payload.status !== "1") return this.fromAmapFailure(response.payload);
    const place = response.payload.geocodes?.find((geocode) => geocode.formatted_address && geocode.location && isCoordinate(geocode.location));
    if (!place?.formatted_address || !place.location) return this.failure("degraded", "Amap could not resolve that city, region, or address.", "address_not_found", false);
    const city = firstText(place.city);
    return {
      status: "available",
      provider: "amap",
      observedAt: new Date().toISOString(),
      data: {
        formattedAddress: place.formatted_address,
        location: place.location,
        province: firstText(place.province),
        city,
        district: firstText(place.district),
        level: place.level ?? ""
      }
    };
  }

  private async request(path: string, params: URLSearchParams): Promise<{ ok: true; payload: AmapResponse } | { ok: false; failure: ConnectorResult<never> }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await this.fetcher(`https://restapi.amap.com${path}?${params.toString()}`, { signal: controller.signal });
      if (!response.ok) return { ok: false, failure: this.failure("unavailable", "Amap did not accept the request.", `http_${response.status}`, response.status >= 500) };
      return { ok: true, payload: await response.json() as AmapResponse };
    } catch (error) {
      return { ok: false, failure: this.failure("unavailable", "Amap could not be reached right now.", error instanceof Error && error.name === "AbortError" ? "timeout" : "network_error", true) };
    } finally {
      clearTimeout(timeout);
    }
  }

  private fromAmapFailure(payload: AmapResponse): ConnectorResult<never> {
    const code = payload.infocode ?? "amap_error";
    const status = code === "10001" || code === "10002" || code === "10003" ? "unauthorized" : code === "10021" ? "rate_limited" : "degraded";
    return this.failure(status, "Amap returned an error. Check the configured Web Service API key and its enabled products.", code, status === "rate_limited");
  }

  private failure(status: Exclude<ConnectorStatus, "available">, message: string, code: string, retryable: boolean): ConnectorResult<never> {
    return { status, provider: "amap", observedAt: new Date().toISOString(), failure: { code, message, retryable } };
  }
}

/**
 * Creates a device-level handoff only. Opening it is the user's choice, and
 * neither C-assistant nor Amap is asked to hail a ride, pay, or book anything.
 * The source coordinates originate from Amap, so `dev=0` marks them as already
 * converted for use by the Amap client URI.
 */
export function createAmapDrivingHandoff(input: { origin: AmapPlace; destination: AmapPlace }): AmapRouteHandoff {
  const [originLongitude, originLatitude] = coordinateParts(input.origin.location);
  const [destinationLongitude, destinationLatitude] = coordinateParts(input.destination.location);
  const parameters = new URLSearchParams({
    sourceApplication: "C-assistant",
    sid: input.origin.id,
    slat: originLatitude,
    slon: originLongitude,
    sname: input.origin.name.slice(0, 80),
    did: input.destination.id,
    dlat: destinationLatitude,
    dlon: destinationLongitude,
    dname: input.destination.name.slice(0, 80),
    dev: "0",
    t: "0"
  });
  return {
    provider: "amap",
    action: "route_planning",
    transport: "driving",
    url: `amapuri://route/plan/?${parameters.toString()}`,
    requiresUserAction: true
  };
}

function isCoordinate(value: string): boolean {
  const [longitude, latitude, extra] = value.split(",");
  if (extra || longitude === undefined || latitude === undefined) return false;
  const lng = Number(longitude);
  const lat = Number(latitude);
  return Number.isFinite(lng) && Number.isFinite(lat) && lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90;
}

function coordinateParts(value: string): [string, string] {
  if (!isCoordinate(value)) throw new Error("Amap action handoff needs valid longitude,latitude coordinates.");
  const [longitude, latitude] = value.split(",");
  return [longitude!, latitude!];
}

export interface QWeatherLocation {
  id: string;
  name: string;
  adminArea: string;
  country: string;
  latitude: number;
  longitude: number;
  timezone: string;
}

export interface QWeatherCurrentWeather {
  observedAt: string;
  condition: string;
  conditionCode: string;
  temperatureC: number;
  feelsLikeC: number;
  humidityPercent: number;
  windDirection: string;
  windScale: string;
  precipitationMm: number;
}

export interface QWeatherDailyForecast {
  date: string;
  conditionDay: string;
  conditionNight: string;
  highC: number;
  lowC: number;
  precipitationMm: number;
  uvIndex: number;
}

export interface QWeatherWeatherSnapshot {
  location: QWeatherLocation;
  current: QWeatherCurrentWeather;
  daily: QWeatherDailyForecast[];
  retrievedAt: string;
  attributionUrl?: string | undefined;
}

export interface QWeatherConnectorOptions {
  apiKey?: string | undefined;
  apiHost?: string | undefined;
  fetcher?: typeof fetch;
}

interface QWeatherApiResponse<T> {
  code?: string;
  updateTime?: string;
  now?: {
    obsTime?: string;
    temp?: string;
    feelsLike?: string;
    icon?: string;
    text?: string;
    windDir?: string;
    windScale?: string;
    humidity?: string;
    precip?: string;
  };
  daily?: Array<{
    fxDate?: string;
    textDay?: string;
    textNight?: string;
    tempMax?: string;
    tempMin?: string;
    precip?: string;
    uvIndex?: string;
  }>;
  fxLink?: string;
}

/**
 * QWeather is the preferred weather provider for this country pack. It only
 * exposes normalised facts and a provider attribution; any user-facing advice
 * remains deliberately conservative and is generated by Core later.
 */
export class QWeatherConnector {
  private readonly apiKey: string | undefined;
  private readonly apiHost: string | undefined;
  private readonly fetcher: typeof fetch;

  constructor({ apiKey, apiHost, fetcher = fetch }: QWeatherConnectorOptions) {
    this.apiKey = apiKey?.trim() || undefined;
    this.apiHost = normalizeQWeatherHost(apiHost);
    this.fetcher = fetcher;
  }

  configurationStatus(): ConnectorResult<undefined> {
    if (!this.apiKey || !this.apiHost) return this.failure("not_configured", "QWeather needs both QWEATHER_API_KEY and QWEATHER_API_HOST.", "not_configured", false);
    return { status: "available", provider: "qweather", observedAt: new Date().toISOString() };
  }

  async weather(input: { coordinates: string; locationName: string; adminArea?: string | undefined; country?: string | undefined; language?: "en" | "zh" | undefined }): Promise<ConnectorResult<QWeatherWeatherSnapshot>> {
    if (!isCoordinate(input.coordinates)) return this.failure("unsupported", "A weather check needs valid longitude,latitude coordinates.", "invalid_coordinates", false);
    const locationName = input.locationName.trim();
    if (!locationName) return this.failure("unsupported", "A weather check needs a location name.", "missing_location_name", false);
    if (!this.apiKey || !this.apiHost) return this.failure("not_configured", "QWeather is not configured on this instance.", "not_configured", false);

    const language = input.language === "zh" ? "zh" : "en";
    const coordinates = toQWeatherCoordinates(input.coordinates);

    const [now, daily] = await Promise.all([
      this.request<QWeatherApiResponse<never>>(`/v7/weather/now?${new URLSearchParams({ location: coordinates, lang: language })}`),
      this.request<QWeatherApiResponse<never>>(`/v7/weather/3d?${new URLSearchParams({ location: coordinates, lang: language })}`)
    ]);
    if (!now.ok) return now.failure;
    if (!daily.ok) return daily.failure;
    if (now.payload.code !== "200") return this.fromQWeatherFailure(now.payload);
    if (daily.payload.code !== "200") return this.fromQWeatherFailure(daily.payload);
    const current = now.payload.now;
    if (!current?.obsTime || !current.text || !current.icon || !isNumericString(current.temp) || !isNumericString(current.feelsLike) || !isNumericString(current.humidity) || !isNumericString(current.precip)) {
      return this.failure("degraded", "QWeather did not return usable current weather facts.", "invalid_current_weather", true);
    }
    const forecasts = (daily.payload.daily ?? []).flatMap((forecast) => {
      if (!forecast.fxDate || !forecast.textDay || !forecast.textNight || !isNumericString(forecast.tempMax) || !isNumericString(forecast.tempMin) || !isNumericString(forecast.precip) || !isNumericString(forecast.uvIndex)) return [];
      return [{
        date: forecast.fxDate,
        conditionDay: forecast.textDay,
        conditionNight: forecast.textNight,
        highC: Number(forecast.tempMax),
        lowC: Number(forecast.tempMin),
        precipitationMm: Number(forecast.precip),
        uvIndex: Number(forecast.uvIndex)
      }];
    });
    if (!forecasts.length) return this.failure("degraded", "QWeather did not return a usable daily forecast.", "invalid_daily_forecast", true);

    return {
      status: "available",
      provider: "qweather",
      observedAt: new Date().toISOString(),
      data: {
        location: {
          id: coordinates,
          name: locationName,
          adminArea: cleanText(input.adminArea),
          country: cleanText(input.country),
          latitude: Number(coordinates.split(",")[1]),
          longitude: Number(coordinates.split(",")[0]),
          timezone: ""
        },
        current: {
          observedAt: current.obsTime,
          condition: current.text,
          conditionCode: current.icon,
          temperatureC: Number(current.temp),
          feelsLikeC: Number(current.feelsLike),
          humidityPercent: Number(current.humidity),
          windDirection: current.windDir ?? "",
          windScale: current.windScale ?? "",
          precipitationMm: Number(current.precip)
        },
        daily: forecasts,
        retrievedAt: new Date().toISOString(),
        ...(daily.payload.fxLink ? { attributionUrl: daily.payload.fxLink } : {})
      }
    };
  }

  private async request<T>(path: string): Promise<{ ok: true; payload: T } | { ok: false; failure: ConnectorResult<never> }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await this.fetcher(new URL(path, this.apiHost).toString(), {
        headers: { "X-QW-Api-Key": this.apiKey! },
        signal: controller.signal
      });
      const payload = await response.json().catch(() => undefined) as T | undefined;
      if (!response.ok) return { ok: false, failure: this.fromHttpFailure(response.status) };
      if (!payload) return { ok: false, failure: this.failure("degraded", "QWeather returned an unreadable response.", "invalid_response", true) };
      return { ok: true, payload };
    } catch (error) {
      return { ok: false, failure: this.failure("unavailable", "QWeather could not be reached right now.", error instanceof Error && error.name === "AbortError" ? "timeout" : "network_error", true) };
    } finally {
      clearTimeout(timeout);
    }
  }

  private fromQWeatherFailure(payload: QWeatherApiResponse<unknown>): ConnectorResult<never> {
    const code = payload.code ?? "unknown";
    const status = code === "401" || code === "403" ? "unauthorized" : code === "402" || code === "429" ? "rate_limited" : code === "204" ? "degraded" : "unavailable";
    return this.failure(status, status === "unauthorized" ? "QWeather rejected the configured API key." : "QWeather could not provide weather facts for this request.", `qweather_${code}`, status === "rate_limited" || status === "unavailable");
  }

  private fromHttpFailure(statusCode: number): ConnectorResult<never> {
    const status = statusCode === 401 || statusCode === 403 ? "unauthorized" : statusCode === 429 ? "rate_limited" : statusCode >= 500 ? "unavailable" : "degraded";
    return this.failure(status, status === "unauthorized" ? "QWeather rejected the configured API key." : "QWeather did not accept the request.", `http_${statusCode}`, status === "rate_limited" || status === "unavailable");
  }

  private failure(status: Exclude<ConnectorStatus, "available">, message: string, code: string, retryable: boolean): ConnectorResult<never> {
    return { status, provider: "qweather", observedAt: new Date().toISOString(), failure: { code, message, retryable } };
  }
}

function normalizeQWeatherHost(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  try {
    const url = new URL(value.includes("://") ? value : `https://${value.trim()}`);
    if (url.protocol !== "https:" || !url.hostname.endsWith(".qweatherapi.com")) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

function isNumericString(value: string | undefined): value is string {
  return value !== undefined && value.trim() !== "" && Number.isFinite(Number(value));
}

function firstText(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value.find((item) => typeof item === "string")?.trim() ?? "" : typeof value === "string" ? value.trim() : "";
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function toQWeatherCoordinates(value: string): string {
  const [longitude, latitude] = coordinateParts(value);
  return `${Number(longitude).toFixed(2)},${Number(latitude).toFixed(2)}`;
}

export interface TelegramConfiguration {
  configured: true;
}

export interface TelegramBotIdentity {
  id: number;
  firstName: string;
  username?: string | undefined;
  canJoinGroups: boolean;
  canReadAllGroupMessages: boolean;
  supportsInlineQueries: boolean;
}

export interface TelegramMessageReceipt {
  chatId: string;
  messageId: number;
}

export interface TelegramConnectorOptions {
  botToken?: string | undefined;
  fetcher?: typeof fetch;
}

interface TelegramApiResponse<T> {
  ok?: boolean;
  result?: T;
  error_code?: number;
}

interface TelegramBotPayload {
  id?: number;
  first_name?: string;
  username?: string;
  can_join_groups?: boolean;
  can_read_all_group_messages?: boolean;
  supports_inline_queries?: boolean;
}

interface TelegramMessagePayload {
  message_id?: number;
  chat?: { id?: number | string };
}

/**
 * Telegram is deliberately configured separately from the agent runtime. The
 * token stays in the local server process and never appears in Connector
 * results, the browser API response, or an agent prompt.
 */
export class TelegramConnector {
  private readonly botToken: string | undefined;
  private readonly fetcher: typeof fetch;

  constructor({ botToken, fetcher = fetch }: TelegramConnectorOptions) {
    this.botToken = botToken?.trim() || undefined;
    this.fetcher = fetcher;
  }

  configurationStatus(): ConnectorResult<TelegramConfiguration> {
    if (!this.botToken) return this.failure("not_configured", "Telegram is not configured on this instance.", "not_configured", false);
    return {
      status: "available",
      provider: "telegram",
      observedAt: new Date().toISOString(),
      data: { configured: true }
    };
  }

  async getMe(): Promise<ConnectorResult<TelegramBotIdentity>> {
    if (!this.botToken) return this.failure("not_configured", "Telegram is not configured on this instance.", "not_configured", false);
    const response = await this.request<TelegramBotPayload>("getMe");
    if (!response.ok) return response.failure;
    const bot = response.payload.result;
    if (!bot || typeof bot.id !== "number" || !bot.first_name) {
      return this.failure("degraded", "Telegram did not return a usable bot identity.", "invalid_identity", false);
    }
    return {
      status: "available",
      provider: "telegram",
      observedAt: new Date().toISOString(),
      data: {
        id: bot.id,
        firstName: bot.first_name,
        ...(bot.username ? { username: bot.username } : {}),
        canJoinGroups: Boolean(bot.can_join_groups),
        canReadAllGroupMessages: Boolean(bot.can_read_all_group_messages),
        supportsInlineQueries: Boolean(bot.supports_inline_queries)
      }
    };
  }

  async sendMessage(input: { chatId: string; text: string }): Promise<ConnectorResult<TelegramMessageReceipt>> {
    const chatId = input.chatId.trim();
    const text = input.text.trim();
    if (!chatId) return this.failure("unsupported", "A Telegram message needs a paired chat.", "missing_chat", false);
    if (!text || text.length > 4096) return this.failure("unsupported", "A Telegram message must contain 1 to 4096 characters.", "invalid_message", false);
    if (!this.botToken) return this.failure("not_configured", "Telegram is not configured on this instance.", "not_configured", false);

    const response = await this.request<TelegramMessagePayload>("sendMessage", { chat_id: chatId, text });
    if (!response.ok) return response.failure;
    const message = response.payload.result;
    if (!message || typeof message.message_id !== "number") {
      return this.failure("degraded", "Telegram did not return a usable message receipt.", "invalid_receipt", true);
    }
    return {
      status: "available",
      provider: "telegram",
      observedAt: new Date().toISOString(),
      data: { chatId: String(message.chat?.id ?? chatId), messageId: message.message_id }
    };
  }

  private async request<T>(method: "getMe" | "sendMessage", body?: Record<string, string>): Promise<{ ok: true; payload: TelegramApiResponse<T> } | { ok: false; failure: ConnectorResult<never> }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await this.fetcher(`https://api.telegram.org/bot${this.botToken}/${method}`, {
        method: "POST",
        ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}),
        signal: controller.signal
      });
      const payload = await response.json().catch(() => undefined) as TelegramApiResponse<T> | undefined;
      if (!response.ok) return { ok: false, failure: this.fromTelegramFailure(payload, response.status) };
      if (!payload || payload.ok !== true) return { ok: false, failure: this.fromTelegramFailure(payload, payload?.error_code) };
      return { ok: true, payload };
    } catch (error) {
      return { ok: false, failure: this.failure("unavailable", "Telegram could not be reached right now.", error instanceof Error && error.name === "AbortError" ? "timeout" : "network_error", true) };
    } finally {
      clearTimeout(timeout);
    }
  }

  private fromTelegramFailure(payload: TelegramApiResponse<unknown> | undefined, httpStatus: number | undefined): ConnectorResult<never> {
    const code = payload?.error_code ?? httpStatus;
    const status = code === 401 || code === 403 ? "unauthorized" : code === 429 ? "rate_limited" : code && code >= 500 ? "unavailable" : "degraded";
    return this.failure(status, status === "unauthorized" ? "Telegram rejected the configured bot token." : "Telegram did not accept the request.", `telegram_${code ?? "error"}`, status === "rate_limited" || status === "unavailable");
  }

  private failure(status: Exclude<ConnectorStatus, "available">, message: string, code: string, retryable: boolean): ConnectorResult<never> {
    return { status, provider: "telegram", observedAt: new Date().toISOString(), failure: { code, message, retryable } };
  }
}
