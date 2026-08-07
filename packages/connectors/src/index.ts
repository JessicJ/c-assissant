export type ConnectorStatus = "available" | "degraded" | "not_configured" | "unauthorized" | "rate_limited" | "unavailable" | "unsupported";
export type ConnectorProvider = "amap" | "qweather" | "telegram" | "official_source";

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

/** A Country Pack-owned allowlist entry, not a policy assertion. */
export interface OfficialSourceDefinition {
  id: string;
  authority: string;
  title: string;
  url: string;
  allowedDomains: string[];
  topics: string[];
  language: "en" | "zh" | "multilingual";
}

export interface OfficialSourceSnapshot {
  sourceId: string;
  authority: string;
  titleOriginal: string;
  url: string;
  retrievedAt: string;
  contentHash: string;
  excerpt: string;
}

export interface OfficialSourceConnectorOptions {
  sources: OfficialSourceDefinition[];
  fetcher?: typeof fetch;
}

/**
 * Fetches evidence only from a Country Pack's approved official-source
 * registry. It deliberately returns facts and a bounded excerpt, never an
 * applicability conclusion for a person's visa, residence, or legal status.
 */
export class OfficialSourceConnector {
  private readonly sources: OfficialSourceDefinition[];
  private readonly sourceById: Map<string, OfficialSourceDefinition>;
  private readonly fetcher: typeof fetch;

  constructor({ sources, fetcher = fetch }: OfficialSourceConnectorOptions) {
    this.sources = sources.filter(isOfficialSourceDefinition);
    this.sourceById = new Map(this.sources.map((source) => [source.id, source]));
    this.fetcher = fetcher;
  }

  discover(input: { topic?: string | undefined } = {}): ConnectorResult<OfficialSourceDefinition[]> {
    const topic = input.topic?.trim().toLowerCase();
    const data = topic ? this.sources.filter((source) => source.topics.some((candidate) => candidate.toLowerCase() === topic)) : this.sources;
    return { status: "available", provider: "official_source", observedAt: new Date().toISOString(), data };
  }

  async fetchSnapshot(input: { sourceId: string; url?: string | undefined }): Promise<ConnectorResult<OfficialSourceSnapshot>> {
    const source = this.sourceById.get(input.sourceId.trim());
    if (!source) return this.failure("unsupported", "This source is not in the active Country Pack registry.", "unknown_source", false);

    const requestedUrl = input.url?.trim() || source.url;
    const requested = parseApprovedUrl(requestedUrl, source.allowedDomains);
    if (!requested) return this.failure("unsupported", "Only approved HTTPS URLs from this official source may be fetched.", "unapproved_source_url", false);

    let response: Response;
    try {
      response = await this.fetcher(requested, { headers: { accept: "text/html,application/xhtml+xml" }, redirect: "follow" });
    } catch {
      return this.failure("unavailable", "The official source could not be reached right now.", "fetch_failed", true);
    }
    if (!response.ok) return this.failure("unavailable", `The official source returned HTTP ${response.status}.`, "source_http_error", response.status >= 500);

    const finalUrl = parseApprovedUrl(response.url || requested.toString(), source.allowedDomains);
    if (!finalUrl) return this.failure("unsupported", "The official source redirected outside its approved domains.", "unapproved_redirect", false);
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (contentType && !contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
      return this.failure("unsupported", "The official source did not return an HTML document.", "unsupported_content_type", false);
    }

    const html = (await response.text()).slice(0, 250_000);
    const extracted = extractOfficialPage(html);
    if (!extracted.excerpt) return this.failure("degraded", "The official source did not contain readable text.", "empty_source_text", true);
    const retrievedAt = new Date().toISOString();
    return {
      status: "available",
      provider: "official_source",
      observedAt: retrievedAt,
      data: {
        sourceId: source.id,
        authority: source.authority,
        titleOriginal: extracted.title || source.title,
        url: finalUrl.toString(),
        retrievedAt,
        contentHash: await sha256(html),
        excerpt: extracted.excerpt
      }
    };
  }

  private failure<T>(status: Exclude<ConnectorStatus, "available">, message: string, code: string, retryable: boolean): ConnectorResult<T> {
    return { status, provider: "official_source", observedAt: new Date().toISOString(), failure: { code, message, retryable } };
  }
}

function isOfficialSourceDefinition(value: OfficialSourceDefinition): boolean {
  return Boolean(value.id.trim() && value.authority.trim() && value.title.trim() && parseApprovedUrl(value.url, value.allowedDomains) && value.allowedDomains.length && value.topics.length);
}

function parseApprovedUrl(value: string, allowedDomains: string[]): URL | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !allowedDomains.some((domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`))) return undefined;
    return url;
  } catch {
    return undefined;
  }
}

function extractOfficialPage(html: string): { title: string; excerpt: string } {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = normalizeHtmlText(titleMatch?.[1] ?? "");
  const excerpt = normalizeHtmlText(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>|<style\b[^>]*>[\s\S]*?<\/style>/gi, "")).slice(0, 12_000);
  return { title, excerpt };
}

function normalizeHtmlText(value: string): string {
  return value.replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, "\"").replaceAll(/\s+/g, " ").trim();
}

async function sha256(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export interface AmapPlace {
  id: string;
  name: string;
  address: string;
  location: string;
  type: string;
  city: string;
  /** Amap administrative city code, used only where a route endpoint requires it. */
  cityCode?: string;
  district: string;
}

/** A factual POI returned relative to a user-selected centre point. */
export interface AmapNearbyPlace extends AmapPlace {
  distanceMeters: number;
}

export interface AmapRoute {
  mode: "driving" | "walking" | "transit";
  origin: string;
  destination: string;
  distanceMeters: number;
  durationSeconds?: number;
  taxiCostYuan?: number;
  transitCostYuan?: number;
  strategy: "amap_recommended" | "public_transit_recommended";
}

export interface AmapGeocodedPlace {
  formattedAddress: string;
  location: string;
  province: string;
  city: string;
  district: string;
  level: string;
}

/** Administrative facts derived from an Amap-coordinate point for transit lookup. */
export interface AmapReverseGeocodedPlace {
  formattedAddress: string;
  city: string;
  cityCode: string;
  district: string;
}

export interface AmapRouteHandoff {
  provider: "amap";
  action: "route_planning";
  transport: "driving";
  url: string;
  requiresUserAction: true;
}

export interface AmapPlaceHandoff {
  provider: "amap";
  action: "place_view";
  url: string;
  requiresUserAction: true;
}

/** A portable H5 route handoff that can be opened from Telegram or the Web workspace. */
export interface AmapNavigationHandoff {
  provider: "amap";
  action: "route_planning";
  transport: "driving" | "walking" | "transit";
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
    citycode?: string;
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
    transits?: Array<{
      distance?: string;
      cost?: { duration?: string; transit_fee?: string };
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
  regeocode?: {
    formatted_address?: string;
    addressComponent?: {
      city?: string | string[];
      citycode?: string;
      district?: string | string[];
    };
  };
  locations?: string;
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
          ...(poi.citycode ? { cityCode: poi.citycode } : {}),
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
  async nearbyRestaurants(input: { location: string; limit?: number | undefined }): Promise<ConnectorResult<AmapNearbyPlace[]>> {
    return this.nearbyPlaces({ ...input, type: "050000", label: "restaurant" });
  }

  /**
   * Finds accommodation POIs around a Plan-relevant location. Results are
   * location facts only; choosing or booking a stay remains with the user.
   */
  async nearbyAccommodation(input: { location: string; limit?: number | undefined }): Promise<ConnectorResult<AmapNearbyPlace[]>> {
    return this.nearbyPlaces({ ...input, type: "100000", label: "accommodation" });
  }

  private async nearbyPlaces(input: { location: string; limit?: number | undefined; type: string; label: string }): Promise<ConnectorResult<AmapNearbyPlace[]>> {
    if (!isCoordinate(input.location)) {
      return this.failure("unsupported", "Nearby discovery needs a valid longitude,latitude centre point.", "invalid_coordinates", false);
    }
    if (!this.apiKey) return this.failure("not_configured", "Amap is not configured on this instance.", "not_configured", false);

    const params = new URLSearchParams({
      key: this.apiKey,
      location: input.location,
      types: input.type,
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
          type: poi.type ?? `${input.label} service`,
          city: poi.cityname ?? "",
          ...(poi.citycode ? { cityCode: poi.citycode } : {}),
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

  async walkingRoute(input: { origin: string; destination: string; originId?: string | undefined; destinationId?: string | undefined }): Promise<ConnectorResult<AmapRoute>> {
    if (!isCoordinate(input.origin) || !isCoordinate(input.destination)) {
      return this.failure("unsupported", "Amap route planning needs longitude,latitude coordinates for both places.", "invalid_coordinates", false);
    }
    if (!this.apiKey) return this.failure("not_configured", "Amap is not configured on this instance.", "not_configured", false);

    const params = new URLSearchParams({
      key: this.apiKey,
      origin: input.origin,
      destination: input.destination,
      isindoor: "0",
      show_fields: "cost"
    });
    if (input.originId) params.set("origin_id", input.originId);
    if (input.destinationId) params.set("destination_id", input.destinationId);

    const response = await this.request("/v5/direction/walking", params);
    if (!response.ok) return response.failure;
    const payload = response.payload;
    if (payload.status !== "1") return this.fromAmapFailure(payload);
    const path = payload.route?.paths?.[0];
    if (!path?.distance) return this.failure("degraded", "Amap did not return a usable walking route.", "missing_route", true);

    return this.routeFact({
      mode: "walking",
      origin: payload.route?.origin ?? input.origin,
      destination: payload.route?.destination ?? input.destination,
      distance: path.distance,
      duration: path.cost?.duration,
      strategy: "amap_recommended"
    });
  }

  async transitRoute(input: { origin: string; destination: string; originCityCode?: string | undefined; destinationCityCode?: string | undefined }): Promise<ConnectorResult<AmapRoute>> {
    if (!isCoordinate(input.origin) || !isCoordinate(input.destination)) {
      return this.failure("unsupported", "Amap route planning needs longitude,latitude coordinates for both places.", "invalid_coordinates", false);
    }
    if (!input.originCityCode?.trim() || !input.destinationCityCode?.trim()) {
      return this.failure("unsupported", "Amap public transit needs city codes for both selected places.", "missing_city_code", false);
    }
    if (!this.apiKey) return this.failure("not_configured", "Amap is not configured on this instance.", "not_configured", false);

    const params = new URLSearchParams({
      key: this.apiKey,
      origin: input.origin,
      destination: input.destination,
      city1: input.originCityCode.trim(),
      city2: input.destinationCityCode.trim(),
      strategy: "0",
      show_fields: "cost"
    });
    const response = await this.request("/v5/direction/transit/integrated", params);
    if (!response.ok) return response.failure;
    const payload = response.payload;
    if (payload.status !== "1") return this.fromAmapFailure(payload);
    const transit = payload.route?.transits?.[0];
    if (!transit?.distance) return this.failure("degraded", "Amap did not return a usable public-transit route.", "missing_route", true);

    return this.routeFact({
      mode: "transit",
      origin: payload.route?.origin ?? input.origin,
      destination: payload.route?.destination ?? input.destination,
      distance: transit.distance,
      duration: transit.cost?.duration,
      transitCost: transit.cost?.transit_fee,
      strategy: "public_transit_recommended"
    });
  }

  private routeFact(input: { mode: AmapRoute["mode"]; origin: string; destination: string; distance: string; duration?: string | undefined; transitCost?: string | undefined; strategy: AmapRoute["strategy"] }): ConnectorResult<AmapRoute> {
    const distanceMeters = Number(input.distance);
    if (!Number.isFinite(distanceMeters) || distanceMeters < 0) return this.failure("degraded", "Amap returned an invalid route distance.", "invalid_route", true);
    const durationSeconds = optionalNonNegativeNumber(input.duration);
    const transitCostYuan = optionalNonNegativeNumber(input.transitCost);
    return {
      status: "available",
      provider: "amap",
      observedAt: new Date().toISOString(),
      data: {
        mode: input.mode,
        origin: input.origin,
        destination: input.destination,
        distanceMeters,
        ...(durationSeconds !== undefined ? { durationSeconds } : {}),
        ...(transitCostYuan !== undefined ? { transitCostYuan } : {}),
        strategy: input.strategy
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

  /** Converts a GPS/WGS-84 coordinate into the Amap coordinate system for one live interaction. */
  async convertGpsCoordinate(input: { location: string }): Promise<ConnectorResult<{ location: string }>> {
    if (!isCoordinate(input.location)) return this.failure("unsupported", "Coordinate conversion needs a valid longitude,latitude GPS point.", "invalid_coordinates", false);
    if (!this.apiKey) return this.failure("not_configured", "Amap is not configured on this instance.", "not_configured", false);
    const params = new URLSearchParams({ key: this.apiKey, locations: coordinateWithSixDecimals(input.location), coordsys: "gps" });
    const response = await this.request("/v3/assistant/coordinate/convert", params);
    if (!response.ok) return response.failure;
    if (response.payload.status !== "1") return this.fromAmapFailure(response.payload);
    const location = response.payload.locations?.split(";")[0]?.trim();
    if (!location || !isCoordinate(location)) return this.failure("degraded", "Amap did not return a usable converted coordinate.", "missing_converted_coordinate", true);
    return { status: "available", provider: "amap", observedAt: new Date().toISOString(), data: { location } };
  }

  /** Resolves only the administrative facts needed to request Amap public transit. */
  async reverseGeocode(input: { location: string }): Promise<ConnectorResult<AmapReverseGeocodedPlace>> {
    if (!isCoordinate(input.location)) return this.failure("unsupported", "Reverse geocoding needs valid longitude,latitude coordinates.", "invalid_coordinates", false);
    if (!this.apiKey) return this.failure("not_configured", "Amap is not configured on this instance.", "not_configured", false);
    const params = new URLSearchParams({ key: this.apiKey, location: coordinateWithSixDecimals(input.location) });
    const response = await this.request("/v3/geocode/regeo", params);
    if (!response.ok) return response.failure;
    if (response.payload.status !== "1") return this.fromAmapFailure(response.payload);
    const place = response.payload.regeocode;
    const addressComponent = place?.addressComponent;
    const cityCode = addressComponent?.citycode?.trim();
    const formattedAddress = place?.formatted_address?.trim();
    if (!formattedAddress || !cityCode) return this.failure("degraded", "Amap did not return the city code needed for public transit.", "missing_city_code", false);
    return {
      status: "available",
      provider: "amap",
      observedAt: new Date().toISOString(),
      data: {
        formattedAddress,
        city: firstText(addressComponent?.city),
        cityCode,
        district: firstText(addressComponent?.district)
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
    slat: originLatitude,
    slon: originLongitude,
    sname: input.origin.name.slice(0, 80),
    dlat: destinationLatitude,
    dlon: destinationLongitude,
    dname: input.destination.name.slice(0, 80),
    dev: "0",
    t: "0"
  });
  if (input.origin.id) parameters.set("sid", input.origin.id);
  if (input.destination.id) parameters.set("did", input.destination.id);
  return {
    provider: "amap",
    action: "route_planning",
    transport: "driving",
    url: `amapuri://route/plan/?${parameters.toString()}`,
    requiresUserAction: true
  };
}

/**
 * Creates a cross-device Amap place handoff. On a phone, Amap may open its
 * native place view; on a desktop, the H5 map shows the same place. This is a
 * view-only handoff and never begins a booking, order, payment, or trip.
 */
export function createAmapPlaceHandoff(input: { place: AmapPlace }): AmapPlaceHandoff {
  const parameters = new URLSearchParams({
    src: "C-assistant",
    callnative: "1"
  });
  if (input.place.id) {
    parameters.set("poiid", input.place.id);
  } else {
    const [longitude, latitude] = coordinateParts(input.place.location);
    parameters.set("position", `${longitude},${latitude}`);
    parameters.set("name", input.place.name.slice(0, 80));
    parameters.set("coordinate", "gaode");
  }
  return {
    provider: "amap",
    action: "place_view",
    url: `https://uri.amap.com/marker?${parameters.toString()}`,
    requiresUserAction: true
  };
}

/**
 * Creates an HTTPS Amap navigation handoff suitable for Telegram. Coordinates
 * passed here must already be in Amap/GCJ-02 form.
 */
export function createAmapNavigationHandoff(input: { origin: AmapPlace; destination: AmapPlace; transport: AmapNavigationHandoff["transport"] }): AmapNavigationHandoff {
  const mode = input.transport === "driving" ? "car" : input.transport === "walking" ? "walk" : "bus";
  const parameters = new URLSearchParams({
    from: `${input.origin.location},${input.origin.name.slice(0, 80)}`,
    to: `${input.destination.location},${input.destination.name.slice(0, 80)}`,
    mode,
    policy: input.transport === "driving" ? "1" : "0",
    src: "C-assistant",
    callnative: "1"
  });
  return {
    provider: "amap",
    action: "route_planning",
    transport: input.transport,
    url: `https://uri.amap.com/navigation?${parameters.toString()}`,
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

function coordinateWithSixDecimals(value: string): string {
  const [longitude, latitude] = coordinateParts(value);
  return `${Number(longitude).toFixed(6)},${Number(latitude).toFixed(6)}`;
}

function optionalNonNegativeNumber(value: string | undefined): number | undefined {
  if (value === undefined || value === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
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

export type TelegramReplyMarkup =
  | { inline_keyboard: Array<Array<{ text: string; callback_data: string } | { text: string; url: string }>> }
  | { keyboard: Array<Array<{ text: string; request_location: true }>>; resize_keyboard: true; one_time_keyboard: true };

/** A deliberately small, normalized subset of a Telegram update. */
export interface TelegramIncomingUpdate {
  updateId: number;
  kind: "message" | "callback";
  chatId: string;
  chatType: string;
  userId: string;
  firstName: string;
  username?: string;
  text?: string;
  callbackId?: string;
  callbackData?: string;
  location?: { latitude: number; longitude: number };
}

export interface TelegramUpdateBatch {
  updates: TelegramIncomingUpdate[];
  nextOffset?: number;
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

interface TelegramUpdatePayload {
  update_id?: number;
  message?: {
    text?: string;
    location?: { latitude?: number; longitude?: number };
    chat?: { id?: number | string; type?: string };
    from?: { id?: number | string; first_name?: string; username?: string };
  };
  callback_query?: {
    id?: string;
    data?: string;
    from?: { id?: number | string; first_name?: string; username?: string };
    message?: { chat?: { id?: number | string; type?: string } };
  };
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

  async sendMessage(input: { chatId: string; text: string; replyMarkup?: TelegramReplyMarkup }): Promise<ConnectorResult<TelegramMessageReceipt>> {
    const chatId = input.chatId.trim();
    const text = input.text.trim();
    if (!chatId) return this.failure("unsupported", "A Telegram message needs a paired chat.", "missing_chat", false);
    if (!text || text.length > 4096) return this.failure("unsupported", "A Telegram message must contain 1 to 4096 characters.", "invalid_message", false);
    if (!this.botToken) return this.failure("not_configured", "Telegram is not configured on this instance.", "not_configured", false);

    const response = await this.request<TelegramMessagePayload>("sendMessage", { chat_id: chatId, text, ...(input.replyMarkup ? { reply_markup: input.replyMarkup } : {}) });
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

  async answerCallbackQuery(input: { callbackId: string; text?: string }): Promise<ConnectorResult<true>> {
    const callbackId = input.callbackId.trim();
    if (!callbackId) return this.failure("unsupported", "Telegram callback acknowledgement needs an id.", "missing_callback", false);
    if (!this.botToken) return this.failure("not_configured", "Telegram is not configured on this instance.", "not_configured", false);
    const response = await this.request<true>("answerCallbackQuery", { callback_query_id: callbackId, ...(input.text?.trim() ? { text: input.text.trim().slice(0, 200) } : {}) });
    if (!response.ok) return response.failure;
    return { status: "available", provider: "telegram", observedAt: new Date().toISOString(), data: true };
  }

  async getUpdates(input: { offset?: number; timeoutSeconds?: number } = {}): Promise<ConnectorResult<TelegramUpdateBatch>> {
    if (!this.botToken) return this.failure("not_configured", "Telegram is not configured on this instance.", "not_configured", false);
    if (input.offset !== undefined && (!Number.isInteger(input.offset) || input.offset < 0)) return this.failure("unsupported", "Telegram update offset must be a non-negative whole number.", "invalid_offset", false);
    const timeoutSeconds = input.timeoutSeconds ?? 0;
    if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 0 || timeoutSeconds > 8) return this.failure("unsupported", "Telegram update polling timeout must be between 0 and 8 seconds.", "invalid_timeout", false);
    const response = await this.request<TelegramUpdatePayload[]>("getUpdates", { timeout: timeoutSeconds, ...(input.offset === undefined ? {} : { offset: input.offset }), allowed_updates: ["message", "callback_query"] });
    if (!response.ok) return response.failure;
    const rawUpdates = response.payload.result ?? [];
    const updates = rawUpdates.flatMap((update): TelegramIncomingUpdate[] => {
      const updateId = update.update_id;
      const message = update.message;
      const callback = update.callback_query;
      if (callback) {
        const chatId = callback.message?.chat?.id;
        const chatType = callback.message?.chat?.type?.trim();
        const from = callback.from;
        if (typeof updateId !== "number" || !Number.isInteger(updateId) || !callback.id?.trim() || !chatType || chatId === undefined || from?.id === undefined || !from.first_name?.trim()) return [];
        return [{ updateId, kind: "callback", chatId: String(chatId), chatType, userId: String(from.id), firstName: from.first_name.trim(), callbackId: callback.id.trim(), ...(from.username?.trim() ? { username: from.username.trim() } : {}), ...(callback.data?.trim() ? { callbackData: callback.data.trim() } : {}) }];
      }
      const chatId = message?.chat?.id;
      const from = message?.from;
      const chatType = message?.chat?.type?.trim();
      if (typeof updateId !== "number" || !Number.isInteger(updateId) || !chatType || chatId === undefined || from?.id === undefined || !from.first_name?.trim()) return [];
      return [{
        updateId,
        kind: "message",
        chatId: String(chatId),
        chatType,
        userId: String(from.id),
        firstName: from.first_name.trim(),
        ...(from.username?.trim() ? { username: from.username.trim() } : {}),
        ...(message?.text?.trim() ? { text: message.text.trim() } : {}),
        ...(typeof message?.location?.latitude === "number" && typeof message.location.longitude === "number" ? { location: { latitude: message.location.latitude, longitude: message.location.longitude } } : {})
      }];
    });
    const updateIds = rawUpdates.flatMap((update) => typeof update.update_id === "number" && Number.isInteger(update.update_id) ? [update.update_id] : []);
    const latestUpdateId = updateIds.length ? Math.max(...updateIds) : undefined;
    return { status: "available", provider: "telegram", observedAt: new Date().toISOString(), data: { updates, ...(latestUpdateId === undefined ? {} : { nextOffset: latestUpdateId + 1 }) } };
  }

  private async request<T>(method: "getMe" | "sendMessage" | "getUpdates" | "answerCallbackQuery", body?: Record<string, unknown>): Promise<{ ok: true; payload: TelegramApiResponse<T> } | { ok: false; failure: ConnectorResult<never> }> {
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
