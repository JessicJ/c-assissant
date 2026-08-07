import type { LuggageLevel, TransportPreference } from "./index.js";

export type TransportMode = "driving" | "transit" | "walking";

/** Provider-normalized route facts used for an explainable, Plan-scoped suggestion. */
export interface TransportRouteFact {
  mode: TransportMode;
  distanceMeters: number;
  durationSeconds?: number;
}

/** A short forecast that has already been matched to the Plan's expected arrival date. */
export interface TransportWeatherFact {
  condition: string;
  precipitationMm: number;
}

export interface TransportRecommendation {
  mode?: TransportMode;
  reasons: string[];
  limitations: string[];
}

/**
 * Produces a conservative, explainable suggestion from facts already available
 * in the Plan. It never starts a journey. Weather is considered only when a
 * caller has already matched a short forecast to the expected arrival date.
 */
export function recommendPlanTransport(input: { preference: TransportPreference; partySize?: number; luggage: LuggageLevel; routeFacts: TransportRouteFact[]; weather?: TransportWeatherFact }): TransportRecommendation {
  const byMode = new Map(input.routeFacts.map((fact) => [fact.mode, fact]));
  const rainExpected = input.weather ? input.weather.precipitationMm > 0 || /rain|storm|shower|snow/i.test(input.weather.condition) : false;
  const limitations = [input.weather ? "Weather is a short forecast matched to the expected arrival date; check it again before departure." : "No weather fact matched the expected arrival date, so weather is not considered in this preliminary choice.", "Service disruptions and exact device location are not considered in this preliminary choice."];
  if (!input.routeFacts.length) return { reasons: ["Compare at least one available route before choosing transport."], limitations };

  const preferredMode = input.preference === "taxi" ? "driving" : input.preference === "public_transit" ? "transit" : input.preference === "walking" ? "walking" : undefined;
  if (preferredMode) {
    if (byMode.has(preferredMode)) return { mode: preferredMode, reasons: [`This Plan explicitly prefers ${transportModeLabel(preferredMode)}.`, ...(rainExpected && preferredMode === "walking" ? ["Rain or snow is forecast for the expected arrival date, but the explicit Plan preference is retained."] : [])], limitations };
    return { reasons: [`This Plan prefers ${transportModeLabel(preferredMode)}, but no usable route fact was returned for it.`], limitations };
  }

  if ((input.luggage === "heavy" || (input.partySize ?? 0) >= 3) && byMode.has("driving")) {
    return { mode: "driving", reasons: [input.luggage === "heavy" ? "Heavy or multiple bags are recorded for this Plan." : "Three or more people are recorded for this Plan.", "A driving route fact is available.", ...(rainExpected ? ["Rain or snow is forecast for the expected arrival date."] : [])], limitations };
  }

  const walking = byMode.get("walking");
  if (walking && walking.distanceMeters <= 1_500 && (walking.durationSeconds === undefined || walking.durationSeconds <= 25 * 60) && input.luggage !== "heavy" && !rainExpected) {
    return { mode: "walking", reasons: ["The walking route is within 1.5 km and about 25 minutes when a duration is available.", "This Plan does not record heavy luggage."], limitations };
  }

  if (byMode.has("transit")) return { mode: "transit", reasons: ["Public-transit route facts are available and no stronger Plan preference is recorded.", ...(rainExpected ? ["Rain or snow is forecast for the expected arrival date, so walking is not selected automatically."] : [])], limitations };
  if (byMode.has("driving")) return { mode: "driving", reasons: ["A driving route fact is available after other practical route facts were unavailable.", ...(rainExpected ? ["Rain or snow is forecast for the expected arrival date."] : [])], limitations };
  if (walking) return { mode: "walking", reasons: ["A walking route fact is the available option.", ...(rainExpected ? ["Rain or snow is forecast for the expected arrival date, but no non-walking route fact is available."] : [])], limitations };
  return { reasons: ["No usable route fact is available yet."], limitations };
}

function transportModeLabel(mode: TransportMode): string {
  return mode === "driving" ? "driving / taxi" : mode === "transit" ? "public transit" : "walking";
}
