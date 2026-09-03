import { useEffect, useMemo, useState } from "react";
import type { DestinationArrivalEvent, PlanPresentation } from "@c-assistant/core";
import { resolveCurrentPlanDestination } from "@c-assistant/core/current-destination";
import type { WeatherSnapshot } from "@c-assistant/connectors";
import { getCurrentWeather } from "./api-client.js";

type WeatherState =
  | { status: "loading" }
  | { status: "available"; weather: WeatherSnapshot; cached: boolean }
  | { status: "unavailable" };

const refreshIntervalMs = 20 * 60 * 1000;
const cacheLifetimeMs = 3 * 60 * 60 * 1000;

export function CurrentDestinationWeather({ presentation, arrivals = [] }: { presentation: PlanPresentation; arrivals?: DestinationArrivalEvent[] }) {
  const [now, setNow] = useState(() => new Date());
  const destination = useMemo(() => resolveCurrentPlanDestination(presentation, { now, arrivals }), [now, presentation, arrivals]);
  const weatherCoordinates = useMemo(() => destination ? weatherCoordinatesForDestination(presentation, destination.dayId) : undefined, [destination?.dayId, presentation]);
  const [state, setState] = useState<WeatherState>({ status: "loading" });

  useEffect(() => {
    const clock = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(clock);
  }, []);

  useEffect(() => {
    if (!destination) return;
    let cancelled = false;
    let refreshTimer: number | undefined;
    const city = destination.city;
    const coordinates = weatherCoordinates;

    async function refresh() {
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
      const cached = readWeatherCache(city);
      if (cached && !cancelled) setState({ status: "available", weather: cached, cached: true });
      else if (!cancelled) setState({ status: "loading" });
      try {
        const weather = await getCurrentWeather(city, coordinates);
        writeWeatherCache(city, weather);
        if (!cancelled) setState({ status: "available", weather, cached: false });
      } catch {
        if (!cancelled && !cached) setState({ status: "unavailable" });
      } finally {
        if (!cancelled) refreshTimer = window.setTimeout(refresh, refreshIntervalMs);
      }
    }

    function refreshWhenVisible() {
      if (document.visibilityState === "visible") void refresh();
    }

    void refresh();
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      cancelled = true;
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [destination?.city, weatherCoordinates?.[0], weatherCoordinates?.[1]]);

  if (!destination) return null;
  const city = destination.city;
  if (state.status === "loading") return <aside className="destination-weather-card loading" aria-label={`Current weather in ${city}`}><WeatherMark condition="" /><div><span>{city} now</span><strong>Updating current weather…</strong></div></aside>;
  if (state.status === "unavailable") return null;

  const { weather } = state;
  const today = weather.daily[0];
  const localTime = formatLocalTime(now, weather.location.timezone);
  return <aside className="destination-weather-card" aria-label={`Current weather in ${city}`}>
    <WeatherMark condition={`${weather.current.conditionCode} ${weather.current.condition}`} />
    <div className="destination-weather-main"><span>{city} now</span><strong>{Math.round(weather.current.temperatureC)}°</strong><p>{weather.current.condition}</p></div>
    <div className="destination-weather-facts">
      <span>Feels like {Math.round(weather.current.feelsLikeC)}°</span>
      {today ? <span>Today {Math.round(today.lowC)}°–{Math.round(today.highC)}°</span> : null}
      {localTime ? <span>Local time {localTime}</span> : null}
    </div>
    {state.cached ? <small>Showing the latest saved weather</small> : null}
  </aside>;
}

function WeatherMark({ condition }: { condition: string }) {
  const normalized = condition.toLocaleLowerCase();
  const symbol = /thunder|storm/.test(normalized) ? "⛈" : /snow/.test(normalized) ? "❄" : /rain|drizzle|shower/.test(normalized) ? "🌧" : /fog|mist|haze/.test(normalized) ? "🌫" : /cloud|overcast/.test(normalized) ? "☁" : /sun|clear/.test(normalized) ? "☀" : "◌";
  return <span className="destination-weather-mark" aria-hidden="true">{symbol}</span>;
}

function weatherCoordinatesForDestination(presentation: PlanPresentation, dayId: string): [number, number] | undefined {
  const day = presentation.kind === "itinerary" ? presentation.days.find((candidate) => candidate.id === dayId) : undefined;
  if (!day) return undefined;
  for (const placeId of day.placeIds) {
    const place = presentation.places.find((candidate) => candidate.id === placeId);
    if (place?.coordinates && validLatitudeLongitude(place.coordinates) && !departureOnlyCategory(place.category)) return place.coordinates;
  }
  const fallback = presentation.places.find((place) => place.city === day.city && place.coordinates && validLatitudeLongitude(place.coordinates));
  return fallback?.coordinates;
}

function validLatitudeLongitude(coordinates: [number, number]): boolean {
  const [latitude, longitude] = coordinates;
  return Number.isFinite(latitude) && latitude >= -90 && latitude <= 90 && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180;
}

function departureOnlyCategory(category: string): boolean {
  return /(transport|airport|rail|station|flight|transfer)/i.test(category.trim());
}

function formatLocalTime(now: Date, timeZone: string): string {
  if (!timeZone) return "";
  try { return new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).format(now); }
  catch { return ""; }
}

function weatherCacheKey(city: string): string {
  return `landi:current-weather:${city.trim().toLocaleLowerCase()}`;
}

function readWeatherCache(city: string): WeatherSnapshot | undefined {
  try {
    const cached = JSON.parse(localStorage.getItem(weatherCacheKey(city)) ?? "null") as { savedAt?: number; weather?: WeatherSnapshot } | null;
    if (cached?.weather && cached.savedAt && Date.now() - cached.savedAt < cacheLifetimeMs) return cached.weather;
  } catch { /* A broken cache must never block the Plan. */ }
  return undefined;
}

function writeWeatherCache(city: string, weather: WeatherSnapshot): void {
  try { localStorage.setItem(weatherCacheKey(city), JSON.stringify({ savedAt: Date.now(), weather })); }
  catch { /* Current weather remains usable without local caching. */ }
}
