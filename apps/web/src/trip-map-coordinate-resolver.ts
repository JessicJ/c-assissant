import type { PlanPresentation } from "@c-assistant/core";
import { parseProviderLocation, validCoords } from "./trip-map-adapter.js";

type MapPlaceSearchResponse = {
  status?: string;
  data?: Array<{ location?: string }>;
};

export interface MapCoordinateCache {
  read(query: string): [number, number] | undefined;
  write(query: string, coordinates: [number, number]): void;
}

export async function resolveMissingCoordinates(
  presentation: PlanPresentation,
  dependencies: {
    searchMapPlaces: (query: string, region?: string) => Promise<MapPlaceSearchResponse | undefined>;
    cache?: MapCoordinateCache;
  }
): Promise<PlanPresentation> {
  const missing = presentation.places.filter((place) => !validCoords(place.coordinates));
  if (!missing.length) return presentation;
  const cache = dependencies.cache ?? localStorageCoordinateCache();
  const resolved = new Map<string, [number, number]>();
  const queue = [...missing];
  await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => {
    while (queue.length) {
      const place = queue.shift();
      if (!place) return;
      const query = [place.name, place.localizedName, place.locationLabel, place.city].filter(Boolean).join(" ");
      const cached = cache.read(query);
      if (cached) { resolved.set(place.id, cached); continue; }
      try {
        const payload = await dependencies.searchMapPlaces(query, place.city);
        if (!payload) continue;
        const coordinates = parseProviderLocation(payload.status === "available" ? payload.data?.[0]?.location : undefined);
        if (coordinates) {
          resolved.set(place.id, coordinates);
          cache.write(query, coordinates);
        }
      } catch {
        // An unresolved place remains visible in the written Plan but is omitted from the map.
      }
    }
  }));
  return {
    ...presentation,
    places: presentation.places.map((place) => resolved.has(place.id) ? { ...place, coordinates: resolved.get(place.id)! } : place)
  };
}

export function localStorageCoordinateCache(now = () => Date.now()): MapCoordinateCache {
  return {
    read(query) {
      try {
        const value = JSON.parse(localStorage.getItem(cacheKey(query)) ?? "null") as { coordinates?: [number, number]; savedAt?: number } | null;
        if (value?.coordinates && validCoords(value.coordinates) && value.savedAt && now() - value.savedAt < 30 * 24 * 60 * 60 * 1000) return value.coordinates;
      } catch {
        // Ignore an invalid local cache entry.
      }
      return undefined;
    },
    write(query, coordinates) {
      try { localStorage.setItem(cacheKey(query), JSON.stringify({ coordinates, savedAt: now() })); } catch { /* The map still works without a cache. */ }
    }
  };
}

function cacheKey(query: string): string {
  return `landi:map-coordinate:${query}`;
}
