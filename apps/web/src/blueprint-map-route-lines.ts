import type { BlueprintMapPointDisplay, BlueprintRouteSegmentDisplay, ItineraryRouteRefreshDisplay } from "./landi-blueprint-workspace-display.js";

export type MapRouteLineState = BlueprintRouteSegmentDisplay["mapLineState"];
export type MapRouteLineRenderState = MapRouteLineState | "checking";

export type BlueprintMapRouteLine = {
  id: string;
  mapLineState: MapRouteLineState;
  points: [BlueprintMapPointDisplay, BlueprintMapPointDisplay];
};

export function routeLinesForMap(routePlaces: BlueprintMapPointDisplay[], routeSegments: BlueprintRouteSegmentDisplay[]): BlueprintMapRouteLine[] {
  const placeById = new Map(routePlaces.filter((place) => validRouteCoordinates(place.coordinates)).map((place) => [place.placeId, place] as const));
  return routeSegments.flatMap((segment) => {
    const origin = placeById.get(segment.originPlaceId);
    const destination = placeById.get(segment.destinationPlaceId);
    return origin && destination ? [{ id: segment.id, mapLineState: segment.mapLineState, points: [origin, destination] as [BlueprintMapPointDisplay, BlueprintMapPointDisplay] }] : [];
  });
}

export function fallbackRouteLineState(routeSegments: BlueprintRouteSegmentDisplay[], routeRefresh?: ItineraryRouteRefreshDisplay): MapRouteLineState | undefined {
  if (routeSegments.length || routeRefresh) return undefined;
  return "formal";
}

export function routeLineRenderState(state: MapRouteLineState, routeRefreshBusy: boolean): MapRouteLineRenderState {
  return routeRefreshBusy && state === "needs_refresh" ? "checking" : state;
}

function validRouteCoordinates(coordinates: BlueprintMapPointDisplay["coordinates"]): boolean {
  if (!coordinates || coordinates.length !== 2) return false;
  const [latitude, longitude] = coordinates;
  return Number.isFinite(latitude) && latitude >= -90 && latitude <= 90 && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180;
}
