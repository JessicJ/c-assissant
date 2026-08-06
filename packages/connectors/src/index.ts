export type ConnectorStatus = "available" | "degraded" | "not_configured" | "unauthorized" | "rate_limited" | "unavailable" | "unsupported";
export type ConnectorProvider = "amap" | "telegram";

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

export interface AmapRoute {
  mode: "driving";
  origin: string;
  destination: string;
  distanceMeters: number;
  durationSeconds?: number;
  taxiCostYuan?: number;
  strategy: "amap_recommended";
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

function isCoordinate(value: string): boolean {
  const [longitude, latitude, extra] = value.split(",");
  if (extra || longitude === undefined || latitude === undefined) return false;
  const lng = Number(longitude);
  const lat = Number(latitude);
  return Number.isFinite(lng) && Number.isFinite(lat) && lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90;
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
