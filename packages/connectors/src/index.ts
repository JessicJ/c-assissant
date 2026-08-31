import { createHmac, timingSafeEqual } from "node:crypto";

export type ConnectorStatus = "available" | "degraded" | "not_configured" | "unauthorized" | "rate_limited" | "unavailable" | "unsupported";
export type ConnectorProvider = "amap" | "qweather" | "google_maps" | "google_weather" | "telegram" | "whatsapp" | "official_source";

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

export interface MessagingConnector<TConfiguration, TTextInput, TReceipt> {
  readonly channel: "telegram" | "whatsapp";
  configurationStatus(): ConnectorResult<TConfiguration>;
  sendText(input: TTextInput): Promise<ConnectorResult<TReceipt>>;
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
  /** Country Pack-declared refresh interval. It is metadata, not a policy conclusion. */
  refreshHours?: number;
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

/** Provider-neutral place fact used by Core and Skills. */
export interface PlaceFact {
  provider?: "google_maps" | "amap";
  id: string;
  name: string;
  address: string;
  location: string;
  type: string;
  city: string;
  /** Normalized provider country name. Used for fail-closed Country Pack selection. */
  country?: string;
  /** Provider-specific administrative city code, when a route endpoint requires it. */
  cityCode?: string;
  district: string;
  /** Current provider venue status; ordinary closed hours are intentionally not represented here. */
  businessStatus?: "operational" | "temporarily_closed" | "permanently_closed" | "unknown";
}

/** A factual POI returned relative to a user-selected centre point. */
export interface NearbyPlaceFact extends PlaceFact {
  distanceMeters: number;
}

export interface RouteFact {
  provider?: "google_maps" | "amap";
  mode: "driving" | "walking" | "transit";
  origin: string;
  destination: string;
  distanceMeters: number;
  durationSeconds?: number;
  taxiCostYuan?: number;
  transitCostYuan?: number;
  /** GeoJSON coordinate order decoded from the provider route polyline. */
  geometry?: Array<[number, number]>;
  strategy: "amap_recommended" | "google_maps_recommended" | "public_transit_recommended";
}

export interface GeocodedPlaceFact {
  provider?: "google_maps" | "amap";
  formattedAddress: string;
  location: string;
  /** Provider-specific administrative code, when available. */
  adcode?: string;
  province: string;
  city: string;
  /** Normalized provider country name. Used for fail-closed Country Pack selection. */
  country?: string;
  district: string;
  level: string;
}

/** Administrative facts derived from a coordinate point for transit lookup. */
export interface ReverseGeocodedPlaceFact {
  provider?: "google_maps" | "amap";
  formattedAddress: string;
  city: string;
  cityCode: string;
  adcode?: string;
  district: string;
}

/** @deprecated Compatibility aliases for stored v1 data and the paused Amap connector. */
export type AmapPlace = PlaceFact;
export type AmapNearbyPlace = NearbyPlaceFact;
export type AmapRoute = RouteFact;
export type AmapGeocodedPlace = GeocodedPlaceFact;
export type AmapReverseGeocodedPlace = ReverseGeocodedPlaceFact;

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

export interface GoogleMapsHandoff {
  provider: "google_maps";
  action: "place_view" | "route_planning";
  url: string;
  requiresUserAction: true;
}

/** A user-confirmed handoff into Uber's rider experience. */
export interface UberRideHandoff {
  provider: "uber";
  action: "ride_request";
  url: string;
  requiresUserAction: true;
}

export interface AmapConnectorOptions {
  apiKey?: string | undefined;
  fetcher?: typeof fetch;
}

export interface GoogleMapsConnectorOptions {
  apiKey?: string | undefined;
  fetcher?: typeof fetch;
}

interface GooglePlaceResponse {
  places?: Array<{
    id?: string;
    displayName?: { text?: string };
    formattedAddress?: string;
    location?: { latitude?: number; longitude?: number };
    primaryType?: string;
    types?: string[];
    addressComponents?: Array<{ longText?: string; types?: string[] }>;
    businessStatus?: "OPERATIONAL" | "CLOSED_TEMPORARILY" | "CLOSED_PERMANENTLY";
  }>;
  error?: { code?: number; status?: string; message?: string };
}

interface GoogleRoutesResponse {
  routes?: Array<{
    distanceMeters?: number;
    duration?: string;
    polyline?: { encodedPolyline?: string };
    travelAdvisory?: { transitFare?: { units?: string; nanos?: number; currencyCode?: string } };
  }>;
  error?: { code?: number; status?: string; message?: string };
}

/**
 * Global location provider used by Landi. No Amap endpoint or credential is
 * used by this connector.
 */
export class GoogleMapsConnector {
  private readonly apiKey: string | undefined;
  private readonly fetcher: typeof fetch;

  constructor({ apiKey, fetcher = fetch }: GoogleMapsConnectorOptions) {
    this.apiKey = apiKey?.trim() || undefined;
    this.fetcher = fetcher;
  }

  configurationStatus(): ConnectorResult<undefined> {
    if (!this.apiKey) return this.failure("not_configured", "GOOGLE_MAPS_API_KEY is not configured.", "not_configured", false);
    return { status: "available", provider: "google_maps", observedAt: new Date().toISOString() };
  }

  async searchPlaces(input: { query: string; region?: string | undefined; limit?: number | undefined }): Promise<ConnectorResult<PlaceFact[]>> {
    const query = [input.query.trim(), input.region?.trim()].filter(Boolean).join(" in ");
    if (!query) return this.failure("unsupported", "Place search needs a query.", "missing_query", false);
    return this.textSearch({ textQuery: query, limit: input.limit });
  }

  async nearbyRestaurants(input: { location: string; limit?: number | undefined }): Promise<ConnectorResult<NearbyPlaceFact[]>> {
    return this.nearbyTextSearch({ location: input.location, query: "restaurants", type: "restaurant", limit: input.limit });
  }

  async nearbyAccommodation(input: { location: string; limit?: number | undefined }): Promise<ConnectorResult<NearbyPlaceFact[]>> {
    return this.nearbyTextSearch({ location: input.location, query: "hotels and accommodation", type: "lodging", limit: input.limit });
  }

  async geocodeAddress(input: { address: string; city?: string | undefined }): Promise<ConnectorResult<GeocodedPlaceFact>> {
    const result = await this.searchPlaces({ query: input.address, region: input.city, limit: 1 });
    const place = result.data?.[0];
    if (result.status !== "available" || !place) return result as ConnectorResult<never>;
    return {
      status: "available",
      provider: "google_maps",
      observedAt: result.observedAt,
      data: { provider: "google_maps", formattedAddress: place.address || place.name, location: place.location, province: "", city: place.city, ...(place.country ? { country: place.country } : {}), district: place.district, level: "place" }
    };
  }

  async drivingRoute(input: { origin: string; destination: string; originId?: string | undefined; destinationId?: string | undefined }): Promise<ConnectorResult<RouteFact>> {
    return this.route({ origin: input.origin, destination: input.destination, mode: "driving" });
  }

  async walkingRoute(input: { origin: string; destination: string; originId?: string | undefined; destinationId?: string | undefined }): Promise<ConnectorResult<RouteFact>> {
    return this.route({ origin: input.origin, destination: input.destination, mode: "walking" });
  }

  async transitRoute(input: { origin: string; destination: string; originCityCode?: string | undefined; destinationCityCode?: string | undefined }): Promise<ConnectorResult<RouteFact>> {
    return this.route({ origin: input.origin, destination: input.destination, mode: "transit" });
  }

  async convertGpsCoordinate(input: { location: string }): Promise<ConnectorResult<{ location: string }>> {
    if (!isCoordinate(input.location)) return this.failure("unsupported", "Location use needs a valid longitude,latitude GPS point.", "invalid_coordinates", false);
    return { status: "available", provider: "google_maps", observedAt: new Date().toISOString(), data: { location: coordinateWithSixDecimals(input.location) } };
  }

  async reverseGeocode(input: { location: string }): Promise<ConnectorResult<ReverseGeocodedPlaceFact>> {
    if (!isCoordinate(input.location)) return this.failure("unsupported", "Reverse geocoding needs valid longitude,latitude coordinates.", "invalid_coordinates", false);
    return { status: "available", provider: "google_maps", observedAt: new Date().toISOString(), data: { provider: "google_maps", formattedAddress: input.location, city: "", cityCode: "google", district: "" } };
  }

  private async nearbyTextSearch(input: { location: string; query: string; type: string; limit?: number | undefined }): Promise<ConnectorResult<NearbyPlaceFact[]>> {
    if (!isCoordinate(input.location)) return this.failure("unsupported", "Nearby search needs valid longitude,latitude coordinates.", "invalid_coordinates", false);
    const [longitude, latitude] = coordinateNumbers(input.location);
    const result = await this.textSearch({ textQuery: input.query, includedType: input.type, limit: input.limit, locationBias: { latitude, longitude } });
    if (result.status !== "available" || !result.data) return result as ConnectorResult<never>;
    return {
      ...result,
      data: result.data.map((place) => ({ ...place, distanceMeters: Math.round(haversineMeters({ latitude, longitude }, coordinateObject(place.location))) }))
    };
  }

  private async textSearch(input: { textQuery: string; includedType?: string; limit?: number | undefined; locationBias?: { latitude: number; longitude: number } }): Promise<ConnectorResult<PlaceFact[]>> {
    if (!this.apiKey) return this.failure("not_configured", "Google Maps Platform is not configured on this instance.", "not_configured", false);
    const body = {
      textQuery: input.textQuery,
      pageSize: Math.max(1, Math.min(input.limit ?? 10, 20)),
      ...(input.includedType ? { includedType: input.includedType } : {}),
      ...(input.locationBias ? { locationBias: { circle: { center: input.locationBias, radius: 50_000 } } } : {})
    };
    const response = await this.request<GooglePlaceResponse>("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: { "content-type": "application/json", "X-Goog-Api-Key": this.apiKey, "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.location,places.primaryType,places.types,places.addressComponents,places.businessStatus" },
      body: JSON.stringify(body)
    });
    if (!response.ok) return response.failure;
    const places = (response.payload.places ?? []).flatMap((place) => normalizeGooglePlace(place));
    if (!places.length) return this.failure("degraded", "Google Places did not return a usable place.", "place_not_found", false);
    return { status: "available", provider: "google_maps", observedAt: new Date().toISOString(), data: places };
  }

  private async route(input: { origin: string; destination: string; mode: RouteFact["mode"] }): Promise<ConnectorResult<RouteFact>> {
    if (!isCoordinate(input.origin) || !isCoordinate(input.destination)) return this.failure("unsupported", "Route planning needs longitude,latitude coordinates for both places.", "invalid_coordinates", false);
    if (!this.apiKey) return this.failure("not_configured", "Google Maps Platform is not configured on this instance.", "not_configured", false);
    const origin = coordinateObject(input.origin);
    const destination = coordinateObject(input.destination);
    const travelMode = input.mode === "driving" ? "DRIVE" : input.mode === "walking" ? "WALK" : "TRANSIT";
    const response = await this.request<GoogleRoutesResponse>("https://routes.googleapis.com/directions/v2:computeRoutes", {
      method: "POST",
      headers: { "content-type": "application/json", "X-Goog-Api-Key": this.apiKey, "X-Goog-FieldMask": "routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline,routes.travelAdvisory.transitFare" },
      body: JSON.stringify({ origin: { location: { latLng: origin } }, destination: { location: { latLng: destination } }, travelMode, ...(input.mode === "driving" ? { routingPreference: "TRAFFIC_AWARE" } : {}), languageCode: "en-US", units: "METRIC" })
    });
    if (!response.ok) return response.failure;
    const route = response.payload.routes?.[0];
    if (!route || !Number.isFinite(route.distanceMeters)) return this.failure("degraded", "Google Routes did not return a usable route.", "missing_route", true);
    const durationSeconds = parseGoogleDuration(route.duration);
    const transitFare = route.travelAdvisory?.transitFare;
    return {
      status: "available",
      provider: "google_maps",
      observedAt: new Date().toISOString(),
      data: {
        provider: "google_maps",
        mode: input.mode,
        origin: input.origin,
        destination: input.destination,
        distanceMeters: route.distanceMeters!,
        ...(durationSeconds !== undefined ? { durationSeconds } : {}),
        ...(route.polyline?.encodedPolyline ? { geometry: decodeGooglePolyline(route.polyline.encodedPolyline) } : {}),
        ...(input.mode === "transit" && transitFare?.currencyCode === "CNY" ? { transitCostYuan: Number(transitFare.units ?? 0) + Number(transitFare.nanos ?? 0) / 1_000_000_000 } : {}),
        strategy: input.mode === "transit" ? "public_transit_recommended" : "google_maps_recommended"
      }
    };
  }

  private async request<T>(url: string, init: RequestInit): Promise<{ ok: true; payload: T } | { ok: false; failure: ConnectorResult<never> }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await this.fetcher(url, { ...init, signal: controller.signal });
      const payload = await response.json().catch(() => undefined) as T | undefined;
      if (!response.ok || !payload) return { ok: false, failure: this.httpFailure(response.status) };
      return { ok: true, payload };
    } catch (error) {
      return { ok: false, failure: this.failure("unavailable", "Google Maps Platform could not be reached right now.", error instanceof Error && error.name === "AbortError" ? "timeout" : "network_error", true) };
    } finally {
      clearTimeout(timeout);
    }
  }

  private httpFailure(statusCode: number): ConnectorResult<never> {
    const status = statusCode === 401 || statusCode === 403 ? "unauthorized" : statusCode === 429 ? "rate_limited" : statusCode >= 500 ? "unavailable" : "degraded";
    return this.failure(status, status === "unauthorized" ? "Google Maps Platform rejected the configured key or API restrictions." : "Google Maps Platform did not accept the request.", `http_${statusCode}`, status === "rate_limited" || status === "unavailable");
  }

  private failure(status: Exclude<ConnectorStatus, "available">, message: string, code: string, retryable: boolean): ConnectorResult<never> {
    return { status, provider: "google_maps", observedAt: new Date().toISOString(), failure: { code, message, retryable } };
  }
}

function decodeGooglePolyline(encoded: string): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  let latitude = 0;
  let longitude = 0;
  let index = 0;
  while (index < encoded.length) {
    const latitudeResult = decodePolylineValue(encoded, index);
    index = latitudeResult.index;
    const longitudeResult = decodePolylineValue(encoded, index);
    index = longitudeResult.index;
    latitude += latitudeResult.value;
    longitude += longitudeResult.value;
    points.push([longitude / 100_000, latitude / 100_000]);
  }
  return points;
}

function decodePolylineValue(encoded: string, start: number): { value: number; index: number } {
  let result = 0;
  let shift = 0;
  let index = start;
  let byte = 0;
  do {
    if (index >= encoded.length) return { value: 0, index: encoded.length };
    byte = encoded.charCodeAt(index++) - 63;
    result |= (byte & 0x1f) << shift;
    shift += 5;
  } while (byte >= 0x20);
  return { value: (result & 1) ? ~(result >> 1) : result >> 1, index };
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
    adcode?: string;
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
      adcode?: string;
      district?: string | string[];
    };
  };
  locations?: string;
  lives?: Array<{
    province?: string;
    city?: string;
    adcode?: string;
    weather?: string;
    temperature?: string;
    winddirection?: string;
    windpower?: string;
    humidity?: string;
    reporttime?: string;
  }>;
  forecasts?: Array<{
    province?: string;
    city?: string;
    adcode?: string;
    reporttime?: string;
    casts?: Array<{
      date?: string;
      dayweather?: string;
      nightweather?: string;
      daytemp?: string;
      nighttemp?: string;
      daywind?: string;
      nightwind?: string;
      daypower?: string;
      nightpower?: string;
    }>;
  }>;
}

export interface AmapBasicWeatherSnapshot {
  source: "amap";
  location: { name: string; province: string; adcode: string };
  current: { observedAt: string; condition: string; temperatureC: number; humidityPercent: number; windDirection: string; windScale: string };
  daily: Array<{ date: string; conditionDay: string; conditionNight: string; highC: number; lowC: number; windDirectionDay: string; windDirectionNight: string; windScaleDay: string; windScaleNight: string }>;
  retrievedAt: string;
  attributionUrl: "https://lbs.amap.com/api/webservice/guide/api/weatherinfo";
  limitations: string[];
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
        ...(place.adcode?.trim() ? { adcode: place.adcode.trim() } : {}),
        province: firstText(place.province),
        city,
        district: firstText(place.district),
        level: place.level ?? ""
      }
    };
  }

  /**
   * Returns Amap's lower-detail city weather as a user-visible fallback only.
   * Missing precipitation, UV, and feels-like facts are never synthesized.
   */
  async basicWeather(input: { adcode: string; locationName: string }): Promise<ConnectorResult<AmapBasicWeatherSnapshot>> {
    const adcode = input.adcode.trim();
    const locationName = input.locationName.trim();
    if (!/^\d{6}$/.test(adcode) || !locationName) return this.failure("unsupported", "Amap basic weather needs a resolved six-digit administrative code and location name.", "invalid_weather_location", false);
    if (!this.apiKey) return this.failure("not_configured", "Amap is not configured on this instance.", "not_configured", false);
    const baseParams = new URLSearchParams({ key: this.apiKey, city: adcode, extensions: "base", output: "JSON" });
    const forecastParams = new URLSearchParams({ key: this.apiKey, city: adcode, extensions: "all", output: "JSON" });
    const [baseResponse, forecastResponse] = await Promise.all([
      this.request("/v3/weather/weatherInfo", baseParams),
      this.request("/v3/weather/weatherInfo", forecastParams)
    ]);
    if (!baseResponse.ok) return baseResponse.failure;
    if (!forecastResponse.ok) return forecastResponse.failure;
    if (baseResponse.payload.status !== "1") return this.fromAmapFailure(baseResponse.payload);
    if (forecastResponse.payload.status !== "1") return this.fromAmapFailure(forecastResponse.payload);
    const current = baseResponse.payload.lives?.[0];
    const forecast = forecastResponse.payload.forecasts?.[0];
    if (!current?.weather || !current.reporttime || !isNumericString(current.temperature) || !isNumericString(current.humidity)) {
      return this.failure("degraded", "Amap did not return usable current weather facts.", "invalid_basic_weather", true);
    }
    const daily = (forecast?.casts ?? []).flatMap((day) => {
      if (!day.date || !day.dayweather || !day.nightweather || !isNumericString(day.daytemp) || !isNumericString(day.nighttemp)) return [];
      return [{
        date: day.date,
        conditionDay: day.dayweather,
        conditionNight: day.nightweather,
        highC: Number(day.daytemp),
        lowC: Number(day.nighttemp),
        windDirectionDay: day.daywind ?? "",
        windDirectionNight: day.nightwind ?? "",
        windScaleDay: day.daypower ?? "",
        windScaleNight: day.nightpower ?? ""
      }];
    });
    if (!daily.length) return this.failure("degraded", "Amap did not return a usable basic forecast.", "invalid_basic_forecast", true);
    const retrievedAt = new Date().toISOString();
    return {
      status: "available",
      provider: "amap",
      observedAt: retrievedAt,
      data: {
        source: "amap",
        location: { name: current.city?.trim() || locationName, province: current.province?.trim() ?? "", adcode },
        current: {
          observedAt: current.reporttime,
          condition: current.weather,
          temperatureC: Number(current.temperature),
          humidityPercent: Number(current.humidity),
          windDirection: current.winddirection ?? "",
          windScale: current.windpower ?? ""
        },
        daily,
        retrievedAt,
        attributionUrl: "https://lbs.amap.com/api/webservice/guide/api/weatherinfo",
        limitations: ["Amap basic weather does not provide precipitation amount, UV index, or feels-like temperature here.", "This fallback is display-only and is not used for packing or transport decisions."]
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
        ...(addressComponent?.adcode?.trim() ? { adcode: addressComponent.adcode.trim() } : {}),
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
    const status = code === "10001" || code === "10002" ? "unauthorized" : code === "10003" || code === "10004" || code === "10021" ? "rate_limited" : "degraded";
    return this.failure(status, "Amap returned an error. Check the configured Web Service API key and its enabled products.", code, status === "rate_limited");
  }

  private failure(status: Exclude<ConnectorStatus, "available">, message: string, code: string, retryable: boolean): ConnectorResult<never> {
    return { status, provider: "amap", observedAt: new Date().toISOString(), failure: { code, message, retryable } };
  }
}

/**
 * Creates a device-level handoff only. Opening it is the user's choice, and
 * neither Landi nor Amap is asked to hail a ride, pay, or book anything.
 * The source coordinates originate from Amap, so `dev=0` marks them as already
 * converted for use by the Amap client URI.
 */
export function createAmapDrivingHandoff(input: { origin: AmapPlace; destination: AmapPlace }): AmapRouteHandoff {
  const [originLongitude, originLatitude] = coordinateParts(input.origin.location);
  const [destinationLongitude, destinationLatitude] = coordinateParts(input.destination.location);
  const parameters = new URLSearchParams({
    sourceApplication: "Landi",
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
    src: "Landi",
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
    src: "Landi",
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

export function createGoogleMapsPlaceHandoff(input: { place: PlaceFact }): GoogleMapsHandoff {
  const parameters = new URLSearchParams({ api: "1", query: input.place.location });
  if (input.place.provider === "google_maps" && input.place.id) parameters.set("query_place_id", input.place.id);
  return { provider: "google_maps", action: "place_view", url: `https://www.google.com/maps/search/?${parameters.toString()}`, requiresUserAction: true };
}

export function createGoogleMapsNavigationHandoff(input: { origin: PlaceFact; destination: PlaceFact; transport: AmapNavigationHandoff["transport"] }): GoogleMapsHandoff {
  const parameters = new URLSearchParams({
    api: "1",
    origin: input.origin.location,
    destination: input.destination.location,
    travelmode: input.transport === "driving" ? "driving" : input.transport === "walking" ? "walking" : "transit"
  });
  if (input.origin.provider === "google_maps" && input.origin.id) parameters.set("origin_place_id", input.origin.id);
  if (input.destination.provider === "google_maps" && input.destination.id) parameters.set("destination_place_id", input.destination.id);
  return { provider: "google_maps", action: "route_planning", url: `https://www.google.com/maps/dir/?${parameters.toString()}`, requiresUserAction: true };
}

/**
 * Opens Uber's mobile rider experience with the current GPS point and the
 * destination address prefilled. It does not request, book, or pay for a ride.
 * Pickup coordinates must be the original WGS-84 values supplied by the device,
 * never the GCJ-02 values converted for Amap route calculations.
 */
export function createUberRideHandoff(input: {
  pickup: { latitude: number; longitude: number };
  destination: Pick<AmapPlace, "name" | "address">;
  clientId?: string | undefined;
}): UberRideHandoff {
  assertLatitudeLongitude(input.pickup);
  const pickup = {
    latitude: input.pickup.latitude,
    longitude: input.pickup.longitude,
    addressLine1: "Current location"
  };
  const dropoff = {
    addressLine1: input.destination.name.slice(0, 80),
    addressLine2: input.destination.address.slice(0, 180)
  };
  const parameters = new URLSearchParams({
    pickup: JSON.stringify(pickup),
    "drop[0]": JSON.stringify(dropoff)
  });
  if (input.clientId?.trim()) parameters.set("client_id", input.clientId.trim());
  return {
    provider: "uber",
    action: "ride_request",
    url: `https://m.uber.com/looking?${parameters.toString()}`,
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

function coordinateNumbers(value: string): [number, number] {
  const [longitude, latitude] = coordinateParts(value);
  return [Number(longitude), Number(latitude)];
}

function coordinateObject(value: string): { latitude: number; longitude: number } {
  const [longitude, latitude] = coordinateNumbers(value);
  return { latitude, longitude };
}

function normalizeGooglePlace(place: NonNullable<GooglePlaceResponse["places"]>[number]): PlaceFact[] {
  const latitude = place.location?.latitude;
  const longitude = place.location?.longitude;
  const name = place.displayName?.text?.trim();
  if (!name || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return [];
  const component = (type: string) => place.addressComponents?.find((item) => item.types?.includes(type))?.longText?.trim() ?? "";
  return [{
    provider: "google_maps",
    id: place.id?.trim() ?? "",
    name,
    address: place.formattedAddress?.trim() ?? name,
    location: `${longitude},${latitude}`,
    type: place.primaryType ?? place.types?.[0] ?? "place",
    city: component("locality") || component("administrative_area_level_2"),
    country: component("country"),
    district: component("sublocality") || component("administrative_area_level_3"),
    businessStatus: place.businessStatus === "OPERATIONAL" ? "operational" : place.businessStatus === "CLOSED_TEMPORARILY" ? "temporarily_closed" : place.businessStatus === "CLOSED_PERMANENTLY" ? "permanently_closed" : "unknown"
  }];
}

function haversineMeters(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const latitudeDelta = radians(b.latitude - a.latitude);
  const longitudeDelta = radians(b.longitude - a.longitude);
  const value = Math.sin(latitudeDelta / 2) ** 2 + Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(longitudeDelta / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function parseGoogleDuration(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const match = /^(\d+(?:\.\d+)?)s$/.exec(value);
  return match ? Math.round(Number(match[1])) : undefined;
}

function assertLatitudeLongitude(value: { latitude: number; longitude: number }): void {
  if (!Number.isFinite(value.latitude) || !Number.isFinite(value.longitude) || value.latitude < -90 || value.latitude > 90 || value.longitude < -180 || value.longitude > 180) {
    throw new Error("Uber ride handoff needs valid WGS-84 pickup coordinates.");
  }
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

export interface WeatherLocation {
  id: string;
  name: string;
  adminArea: string;
  country: string;
  latitude: number;
  longitude: number;
  timezone: string;
}

export interface CurrentWeatherFact {
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

export interface DailyWeatherForecast {
  date: string;
  conditionDay: string;
  conditionNight: string;
  highC: number;
  lowC: number;
  precipitationMm: number;
  uvIndex: number;
}

export interface WeatherSnapshot {
  provider?: "qweather" | "google_weather";
  location: WeatherLocation;
  current: CurrentWeatherFact;
  daily: DailyWeatherForecast[];
  retrievedAt: string;
  attributionUrl?: string | undefined;
}

/** @deprecated Compatibility aliases for the paused QWeather connector. */
export type QWeatherLocation = WeatherLocation;
export type QWeatherCurrentWeather = CurrentWeatherFact;
export type QWeatherDailyForecast = DailyWeatherForecast;
export type QWeatherWeatherSnapshot = WeatherSnapshot;

export interface GoogleWeatherConnectorOptions {
  apiKey?: string | undefined;
  fetcher?: typeof fetch;
}

interface GoogleWeatherCondition {
  currentTime?: string;
  timeZone?: { id?: string };
  weatherCondition?: { type?: string; description?: { text?: string } };
  temperature?: { degrees?: number };
  feelsLikeTemperature?: { degrees?: number };
  relativeHumidity?: number;
  precipitation?: { qpf?: { quantity?: number } };
  wind?: { direction?: { cardinal?: string }; speed?: { value?: number; unit?: string } };
}

interface GoogleDailyWeatherResponse {
  timeZone?: { id?: string };
  forecastDays?: Array<{
    displayDate?: { year?: number; month?: number; day?: number };
    daytimeForecast?: { weatherCondition?: { description?: { text?: string } }; precipitation?: { qpf?: { quantity?: number } }; uvIndex?: number };
    nighttimeForecast?: { weatherCondition?: { description?: { text?: string } }; precipitation?: { qpf?: { quantity?: number } } };
    maxTemperature?: { degrees?: number };
    minTemperature?: { degrees?: number };
  }>;
}

export class GoogleWeatherConnector {
  private readonly apiKey: string | undefined;
  private readonly fetcher: typeof fetch;

  constructor({ apiKey, fetcher = fetch }: GoogleWeatherConnectorOptions) {
    this.apiKey = apiKey?.trim() || undefined;
    this.fetcher = fetcher;
  }

  configurationStatus(): ConnectorResult<undefined> {
    if (!this.apiKey) return this.failure("not_configured", "GOOGLE_MAPS_API_KEY is not configured for Weather API.", "not_configured", false);
    return { status: "available", provider: "google_weather", observedAt: new Date().toISOString() };
  }

  async weather(input: { coordinates: string; locationName: string; adminArea?: string | undefined; country?: string | undefined; language?: "en" | "zh" | undefined }): Promise<ConnectorResult<QWeatherWeatherSnapshot>> {
    if (!isCoordinate(input.coordinates)) return this.failure("unsupported", "A weather check needs valid longitude,latitude coordinates.", "invalid_coordinates", false);
    if (!this.apiKey) return this.failure("not_configured", "Google Weather API is not configured on this instance.", "not_configured", false);
    const [longitude, latitude] = coordinateNumbers(input.coordinates);
    const common = { key: this.apiKey, "location.latitude": String(latitude), "location.longitude": String(longitude), unitsSystem: "METRIC", languageCode: input.language === "zh" ? "zh-CN" : "en" };
    const [current, daily] = await Promise.all([
      this.get<GoogleWeatherCondition>("https://weather.googleapis.com/v1/currentConditions:lookup", common),
      this.get<GoogleDailyWeatherResponse>("https://weather.googleapis.com/v1/forecast/days:lookup", { ...common, days: "3", pageSize: "3" })
    ]);
    if (!current.ok) return current.failure;
    if (!daily.ok) return daily.failure;
    const condition = current.payload.weatherCondition?.description?.text?.trim();
    const observedAt = current.payload.currentTime;
    const temperatureC = current.payload.temperature?.degrees;
    const feelsLikeC = current.payload.feelsLikeTemperature?.degrees;
    if (!condition || !observedAt || !Number.isFinite(temperatureC) || !Number.isFinite(feelsLikeC)) return this.failure("degraded", "Google Weather did not return usable current conditions.", "invalid_current_weather", true);
    const forecasts = (daily.payload.forecastDays ?? []).flatMap((forecast) => {
      const date = googleDisplayDate(forecast.displayDate);
      const conditionDay = forecast.daytimeForecast?.weatherCondition?.description?.text?.trim();
      const conditionNight = forecast.nighttimeForecast?.weatherCondition?.description?.text?.trim();
      const highC = forecast.maxTemperature?.degrees;
      const lowC = forecast.minTemperature?.degrees;
      if (!date || !conditionDay || !conditionNight || !Number.isFinite(highC) || !Number.isFinite(lowC)) return [];
      return [{
        date,
        conditionDay,
        conditionNight,
        highC: highC!,
        lowC: lowC!,
        precipitationMm: Number(forecast.daytimeForecast?.precipitation?.qpf?.quantity ?? 0) + Number(forecast.nighttimeForecast?.precipitation?.qpf?.quantity ?? 0),
        uvIndex: Number(forecast.daytimeForecast?.uvIndex ?? 0)
      }];
    });
    if (!forecasts.length) return this.failure("degraded", "Google Weather did not return a usable daily forecast.", "invalid_daily_forecast", true);
    return {
      status: "available",
      provider: "google_weather",
      observedAt: new Date().toISOString(),
      data: {
        provider: "google_weather",
        location: { id: input.coordinates, name: input.locationName.trim(), adminArea: cleanText(input.adminArea), country: cleanText(input.country), latitude, longitude, timezone: daily.payload.timeZone?.id ?? current.payload.timeZone?.id ?? "" },
        current: {
          observedAt,
          condition,
          conditionCode: current.payload.weatherCondition?.type ?? "",
          temperatureC: temperatureC!,
          feelsLikeC: feelsLikeC!,
          humidityPercent: Number(current.payload.relativeHumidity ?? 0),
          windDirection: current.payload.wind?.direction?.cardinal ?? "",
          windScale: current.payload.wind?.speed?.value === undefined ? "" : `${current.payload.wind.speed.value} ${current.payload.wind.speed.unit ?? ""}`.trim(),
          precipitationMm: Number(current.payload.precipitation?.qpf?.quantity ?? 0)
        },
        daily: forecasts,
        retrievedAt: new Date().toISOString(),
        attributionUrl: "https://weather.google.com/"
      }
    };
  }

  private async get<T>(baseUrl: string, parameters: Record<string, string>): Promise<{ ok: true; payload: T } | { ok: false; failure: ConnectorResult<never> }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await this.fetcher(`${baseUrl}?${new URLSearchParams(parameters)}`, { signal: controller.signal });
      const payload = await response.json().catch(() => undefined) as T | undefined;
      if (!response.ok || !payload) return { ok: false, failure: this.httpFailure(response.status) };
      return { ok: true, payload };
    } catch (error) {
      return { ok: false, failure: this.failure("unavailable", "Google Weather could not be reached right now.", error instanceof Error && error.name === "AbortError" ? "timeout" : "network_error", true) };
    } finally {
      clearTimeout(timeout);
    }
  }

  private httpFailure(statusCode: number): ConnectorResult<never> {
    const status = statusCode === 404 ? "unsupported" : statusCode === 401 || statusCode === 403 ? "unauthorized" : statusCode === 429 ? "rate_limited" : statusCode >= 500 ? "unavailable" : "degraded";
    const message = status === "unsupported"
      ? "Google Weather does not provide weather facts for this location."
      : status === "unauthorized"
        ? "Google Weather rejected the configured key or API restrictions."
        : "Google Weather did not accept the request.";
    return this.failure(status, message, `http_${statusCode}`, status === "rate_limited" || status === "unavailable");
  }

  private failure(status: Exclude<ConnectorStatus, "available">, message: string, code: string, retryable: boolean): ConnectorResult<never> {
    return { status, provider: "google_weather", observedAt: new Date().toISOString(), failure: { code, message, retryable } };
  }
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

function googleDisplayDate(value: { year?: number; month?: number; day?: number } | undefined): string | undefined {
  if (!value || !Number.isInteger(value.year) || !Number.isInteger(value.month) || !Number.isInteger(value.day)) return undefined;
  return `${String(value.year).padStart(4, "0")}-${String(value.month).padStart(2, "0")}-${String(value.day).padStart(2, "0")}`;
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
export class TelegramConnector implements MessagingConnector<TelegramConfiguration, { chatId: string; text: string; replyMarkup?: TelegramReplyMarkup }, TelegramMessageReceipt> {
  readonly channel = "telegram" as const;
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

  async sendText(input: { chatId: string; text: string; replyMarkup?: TelegramReplyMarkup }): Promise<ConnectorResult<TelegramMessageReceipt>> {
    return this.sendMessage(input);
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

export type WhatsAppReadinessState = "webhook_pending" | "template_pending" | "available";

export interface WhatsAppConfiguration {
  state: WhatsAppReadinessState;
  outboundConfigured: boolean;
  webhookConfigured: boolean;
  reminderTemplateConfigured: boolean;
}

export interface WhatsAppPhoneIdentity {
  phoneNumberId: string;
  displayPhoneNumber: string;
  verifiedName: string;
  qualityRating?: string;
}

export interface WhatsAppMessageReceipt {
  recipientId: string;
  messageId: string;
}

export interface WhatsAppTextInput {
  to: string;
  text: string;
  /** Free-form messages are allowed only while the user-opened service window is active. */
  serviceWindowExpiresAt: string;
}

export interface WhatsAppTemplateInput {
  to: string;
  templateName: string;
  languageCode: string;
  bodyParameters?: string[];
}

export interface WhatsAppIncomingMessage {
  messageId: string;
  from: string;
  profileName?: string;
  receivedAt: string;
  serviceWindowExpiresAt: string;
  kind: "text" | "button" | "list" | "location" | "unsupported";
  text?: string;
  actionId?: string;
  location?: { latitude: number; longitude: number };
}

export interface WhatsAppDeliveryStatus {
  messageId: string;
  recipientId: string;
  status: "sent" | "delivered" | "read" | "failed" | "unknown";
  observedAt: string;
}

export interface WhatsAppWebhookBatch {
  messages: WhatsAppIncomingMessage[];
  deliveryStatuses: WhatsAppDeliveryStatus[];
}

export interface WhatsAppConnectorOptions {
  accessToken?: string | undefined;
  phoneNumberId?: string | undefined;
  businessAccountId?: string | undefined;
  appSecret?: string | undefined;
  verifyToken?: string | undefined;
  reminderTemplateName?: string | undefined;
  graphApiVersion?: string | undefined;
  fetcher?: typeof fetch | undefined;
}

interface WhatsAppApiErrorPayload {
  error?: { code?: number; message?: string };
}

interface WhatsAppSendPayload extends WhatsAppApiErrorPayload {
  contacts?: Array<{ wa_id?: string }>;
  messages?: Array<{ id?: string }>;
}

interface WhatsAppPhonePayload extends WhatsAppApiErrorPayload {
  id?: string;
  display_phone_number?: string;
  verified_name?: string;
  quality_rating?: string;
}

interface WhatsAppWebhookMessagePayload {
  id?: string;
  from?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  location?: { latitude?: number; longitude?: number };
  interactive?: {
    type?: string;
    button_reply?: { id?: string; title?: string };
    list_reply?: { id?: string; title?: string };
  };
  button?: { payload?: string; text?: string };
}

interface WhatsAppWebhookPayload {
  object?: string;
  entry?: Array<{
    changes?: Array<{
      field?: string;
      value?: {
        contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>;
        messages?: WhatsAppWebhookMessagePayload[];
        statuses?: Array<{ id?: string; recipient_id?: string; status?: string; timestamp?: string }>;
      };
    }>;
  }>;
}

/**
 * Optional WhatsApp Business Platform adapter. Credentials stay in the local
 * server process. Free-form outbound text is refused outside a user-opened
 * 24-hour service window; proactive reminders must use an approved template.
 */
export class WhatsAppConnector implements MessagingConnector<WhatsAppConfiguration, WhatsAppTextInput, WhatsAppMessageReceipt> {
  readonly channel = "whatsapp" as const;
  private readonly accessToken: string | undefined;
  private readonly phoneNumberId: string | undefined;
  private readonly businessAccountId: string | undefined;
  private readonly appSecret: string | undefined;
  private readonly verifyToken: string | undefined;
  private readonly reminderTemplateName: string | undefined;
  private readonly graphApiVersion: string;
  private readonly fetcher: typeof fetch;

  constructor({ accessToken, phoneNumberId, businessAccountId, appSecret, verifyToken, reminderTemplateName, graphApiVersion = "v25.0", fetcher = fetch }: WhatsAppConnectorOptions) {
    this.accessToken = accessToken?.trim() || undefined;
    this.phoneNumberId = phoneNumberId?.trim() || undefined;
    this.businessAccountId = businessAccountId?.trim() || undefined;
    this.appSecret = appSecret?.trim() || undefined;
    this.verifyToken = verifyToken?.trim() || undefined;
    this.reminderTemplateName = reminderTemplateName?.trim() || undefined;
    this.graphApiVersion = /^v\d+\.\d+$/.test(graphApiVersion.trim()) ? graphApiVersion.trim() : "v25.0";
    this.fetcher = fetcher;
  }

  configurationStatus(): ConnectorResult<WhatsAppConfiguration> {
    const outboundConfigured = Boolean(this.accessToken && this.phoneNumberId);
    const webhookConfigured = Boolean(this.appSecret && this.verifyToken);
    const reminderTemplateConfigured = Boolean(this.reminderTemplateName);
    if (!this.accessToken && !this.phoneNumberId && !this.appSecret && !this.verifyToken && !this.reminderTemplateName) {
      return this.failure("not_configured", "WhatsApp is not configured on this instance.", "not_configured", false);
    }
    if (!outboundConfigured) {
      return this.failure("degraded", "WhatsApp needs both an access token and phone number ID.", "incomplete_configuration", false);
    }
    const state: WhatsAppReadinessState = !webhookConfigured ? "webhook_pending" : !reminderTemplateConfigured ? "template_pending" : "available";
    return {
      status: state === "available" ? "available" : "degraded",
      provider: "whatsapp",
      observedAt: new Date().toISOString(),
      data: { state, outboundConfigured, webhookConfigured, reminderTemplateConfigured },
      ...(state === "available" ? {} : { failure: { code: state, message: state === "webhook_pending" ? "WhatsApp outbound messaging is configured; add webhook verification secrets to receive messages." : "WhatsApp messaging is configured; approve and configure a utility template for proactive reminders.", retryable: false } })
    };
  }

  async verifyPhoneNumber(): Promise<ConnectorResult<WhatsAppPhoneIdentity>> {
    if (!this.accessToken || !this.phoneNumberId) return this.failure("not_configured", "WhatsApp outbound messaging is not configured on this instance.", "not_configured", false);
    const result = await this.request<WhatsAppPhonePayload>(this.phoneNumberId, { method: "GET", query: { fields: "id,display_phone_number,verified_name,quality_rating" } });
    if (!result.ok) return result.failure;
    const payload = result.payload;
    if (!payload.id || !payload.display_phone_number || !payload.verified_name) return this.failure("degraded", "WhatsApp did not return a usable phone identity.", "invalid_identity", false);
    return {
      status: "available",
      provider: "whatsapp",
      observedAt: new Date().toISOString(),
      data: { phoneNumberId: payload.id, displayPhoneNumber: payload.display_phone_number, verifiedName: payload.verified_name, ...(payload.quality_rating ? { qualityRating: payload.quality_rating } : {}) }
    };
  }

  async sendText(input: WhatsAppTextInput): Promise<ConnectorResult<WhatsAppMessageReceipt>> {
    const recipient = normalizeWhatsAppRecipient(input.to);
    const text = input.text.trim();
    const expiresAt = Date.parse(input.serviceWindowExpiresAt);
    if (!recipient) return this.failure("unsupported", "A WhatsApp message needs a valid international recipient number.", "invalid_recipient", false);
    if (!text || text.length > 4096) return this.failure("unsupported", "A WhatsApp text message must contain 1 to 4096 characters.", "invalid_message", false);
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return this.failure("unsupported", "Free-form WhatsApp text requires an active user-opened service window; use an approved template instead.", "template_required", false);
    return this.sendMessagePayload(recipient, { messaging_product: "whatsapp", recipient_type: "individual", to: recipient, type: "text", text: { preview_url: false, body: text } });
  }

  async sendTemplate(input: WhatsAppTemplateInput): Promise<ConnectorResult<WhatsAppMessageReceipt>> {
    const recipient = normalizeWhatsAppRecipient(input.to);
    const templateName = input.templateName.trim();
    const languageCode = input.languageCode.trim();
    if (!recipient) return this.failure("unsupported", "A WhatsApp template needs a valid international recipient number.", "invalid_recipient", false);
    if (!/^[a-z0-9_]{1,512}$/.test(templateName) || !/^[A-Za-z]{2,3}(?:_[A-Za-z]{2})?$/.test(languageCode)) return this.failure("unsupported", "WhatsApp template name or language code is invalid.", "invalid_template", false);
    const parameters = (input.bodyParameters ?? []).map((value) => value.trim()).filter(Boolean);
    if (parameters.some((value) => value.length > 1024)) return this.failure("unsupported", "A WhatsApp template parameter is too long.", "invalid_template_parameter", false);
    return this.sendMessagePayload(recipient, {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: recipient,
      type: "template",
      template: {
        name: templateName,
        language: { code: languageCode },
        ...(parameters.length ? { components: [{ type: "body", parameters: parameters.map((text) => ({ type: "text", text })) }] } : {})
      }
    });
  }

  defaultReminderTemplate(): string | undefined {
    return this.reminderTemplateName;
  }

  verifyWebhookChallenge(input: { mode?: string | undefined; verifyToken?: string | undefined; challenge?: string | undefined }): ConnectorResult<string> {
    if (!this.verifyToken) return this.failure("not_configured", "WhatsApp webhook verification is not configured.", "webhook_not_configured", false);
    if (input.mode !== "subscribe" || input.verifyToken !== this.verifyToken || !input.challenge) return this.failure("unauthorized", "WhatsApp webhook verification failed.", "webhook_verification_failed", false);
    return { status: "available", provider: "whatsapp", observedAt: new Date().toISOString(), data: input.challenge };
  }

  receiveWebhook(input: { rawBody: string | Uint8Array; signature?: string | undefined }): ConnectorResult<WhatsAppWebhookBatch> {
    if (!this.appSecret) return this.failure("not_configured", "WhatsApp webhook signature verification is not configured.", "webhook_not_configured", false);
    const rawBody = typeof input.rawBody === "string" ? Buffer.from(input.rawBody, "utf8") : Buffer.from(input.rawBody);
    if (!verifyWhatsAppSignature(rawBody, input.signature, this.appSecret)) return this.failure("unauthorized", "WhatsApp webhook signature verification failed.", "invalid_webhook_signature", false);
    let payload: WhatsAppWebhookPayload;
    try {
      payload = JSON.parse(rawBody.toString("utf8")) as WhatsAppWebhookPayload;
    } catch {
      return this.failure("degraded", "WhatsApp sent an unreadable webhook payload.", "invalid_webhook_payload", false);
    }
    if (payload.object !== "whatsapp_business_account") return this.failure("unsupported", "The webhook payload is not a WhatsApp Business Account event.", "unsupported_webhook_object", false);
    const messages: WhatsAppIncomingMessage[] = [];
    const deliveryStatuses: WhatsAppDeliveryStatus[] = [];
    for (const entry of payload.entry ?? []) for (const change of entry.changes ?? []) {
      if (change.field !== "messages") continue;
      const value = change.value;
      const profileNames = new Map((value?.contacts ?? []).flatMap((contact) => contact.wa_id ? [[contact.wa_id, contact.profile?.name?.trim()]] : []));
      for (const message of value?.messages ?? []) {
        const normalized = normalizeWhatsAppIncoming(message, profileNames.get(message.from ?? ""));
        if (normalized) messages.push(normalized);
      }
      for (const status of value?.statuses ?? []) {
        if (!status.id || !status.recipient_id) continue;
        deliveryStatuses.push({ messageId: status.id, recipientId: status.recipient_id, status: normalizeWhatsAppDeliveryStatus(status.status), observedAt: whatsAppTimestamp(status.timestamp) });
      }
    }
    return { status: "available", provider: "whatsapp", observedAt: new Date().toISOString(), data: { messages, deliveryStatuses } };
  }

  private async sendMessagePayload(recipient: string, payload: Record<string, unknown>): Promise<ConnectorResult<WhatsAppMessageReceipt>> {
    if (!this.accessToken || !this.phoneNumberId) return this.failure("not_configured", "WhatsApp outbound messaging is not configured on this instance.", "not_configured", false);
    const result = await this.request<WhatsAppSendPayload>(`${this.phoneNumberId}/messages`, { method: "POST", body: payload });
    if (!result.ok) return result.failure;
    const messageId = result.payload.messages?.[0]?.id;
    if (!messageId) return this.failure("degraded", "WhatsApp did not return a usable message receipt.", "invalid_receipt", true);
    return { status: "available", provider: "whatsapp", observedAt: new Date().toISOString(), data: { recipientId: result.payload.contacts?.[0]?.wa_id ?? recipient, messageId } };
  }

  private async request<T extends WhatsAppApiErrorPayload>(path: string, input: { method: "GET" | "POST"; query?: Record<string, string>; body?: Record<string, unknown> }): Promise<{ ok: true; payload: T } | { ok: false; failure: ConnectorResult<never> }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const url = new URL(`https://graph.facebook.com/${this.graphApiVersion}/${path}`);
      for (const [key, value] of Object.entries(input.query ?? {})) url.searchParams.set(key, value);
      const response = await this.fetcher(url, {
        method: input.method,
        headers: { authorization: `Bearer ${this.accessToken}`, ...(input.body ? { "content-type": "application/json" } : {}) },
        ...(input.body ? { body: JSON.stringify(input.body) } : {}),
        signal: controller.signal
      });
      const payload = await response.json().catch(() => undefined) as T | undefined;
      if (!response.ok || !payload) return { ok: false, failure: this.fromWhatsAppFailure(payload, response.status) };
      return { ok: true, payload };
    } catch (error) {
      return { ok: false, failure: this.failure("unavailable", "WhatsApp could not be reached right now.", error instanceof Error && error.name === "AbortError" ? "timeout" : "network_error", true) };
    } finally {
      clearTimeout(timeout);
    }
  }

  private fromWhatsAppFailure(payload: WhatsAppApiErrorPayload | undefined, httpStatus: number): ConnectorResult<never> {
    const code = payload?.error?.code ?? httpStatus;
    const status: Exclude<ConnectorStatus, "available"> = httpStatus === 401 || httpStatus === 403 || code === 190
      ? "unauthorized"
      : httpStatus === 429 || code === 4 || code === 80007
        ? "rate_limited"
        : httpStatus >= 500
          ? "unavailable"
          : "degraded";
    const message = status === "unauthorized" ? "WhatsApp rejected the configured access token or permissions." : status === "rate_limited" ? "WhatsApp rate-limited this instance." : "WhatsApp did not accept the request.";
    return this.failure(status, message, `whatsapp_${code}`, status === "rate_limited" || status === "unavailable");
  }

  private failure(status: Exclude<ConnectorStatus, "available">, message: string, code: string, retryable: boolean): ConnectorResult<never> {
    return { status, provider: "whatsapp", observedAt: new Date().toISOString(), failure: { code, message, retryable } };
  }
}

function normalizeWhatsAppRecipient(value: string): string | undefined {
  const normalized = value.trim().replace(/^\+/, "").replace(/[\s()-]/g, "");
  return /^\d{7,15}$/.test(normalized) ? normalized : undefined;
}

function verifyWhatsAppSignature(rawBody: Uint8Array, signature: string | undefined, appSecret: string): boolean {
  if (!signature?.startsWith("sha256=")) return false;
  const supplied = signature.slice(7);
  if (!/^[a-f0-9]{64}$/i.test(supplied)) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest();
  const actual = Buffer.from(supplied, "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function normalizeWhatsAppIncoming(message: WhatsAppWebhookMessagePayload, profileName: string | undefined): WhatsAppIncomingMessage | undefined {
  if (!message.id || !message.from) return undefined;
  const receivedAt = whatsAppTimestamp(message.timestamp);
  const base = { messageId: message.id, from: message.from, ...(profileName ? { profileName } : {}), receivedAt, serviceWindowExpiresAt: new Date(Date.parse(receivedAt) + 24 * 60 * 60_000).toISOString() };
  if (message.type === "text" && message.text?.body?.trim()) return { ...base, kind: "text", text: message.text.body.trim() };
  if (message.type === "location" && typeof message.location?.latitude === "number" && typeof message.location.longitude === "number") return { ...base, kind: "location", location: { latitude: message.location.latitude, longitude: message.location.longitude } };
  const button = message.interactive?.button_reply;
  if (message.type === "interactive" && button?.id) return { ...base, kind: "button", actionId: button.id, ...(button.title?.trim() ? { text: button.title.trim() } : {}) };
  const list = message.interactive?.list_reply;
  if (message.type === "interactive" && list?.id) return { ...base, kind: "list", actionId: list.id, ...(list.title?.trim() ? { text: list.title.trim() } : {}) };
  if (message.type === "button" && message.button?.payload) return { ...base, kind: "button", actionId: message.button.payload, ...(message.button.text?.trim() ? { text: message.button.text.trim() } : {}) };
  return { ...base, kind: "unsupported" };
}

function normalizeWhatsAppDeliveryStatus(value: string | undefined): WhatsAppDeliveryStatus["status"] {
  return value === "sent" || value === "delivered" || value === "read" || value === "failed" ? value : "unknown";
}

function whatsAppTimestamp(value: string | undefined): string {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000).toISOString() : new Date().toISOString();
}
