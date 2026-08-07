import type { LuggageLevel, TransportPreference } from "./index.js";

export type TransportMode = "driving" | "transit" | "walking";

/** Provider-normalized route facts used for an explainable, Plan-scoped suggestion. */
export interface TransportRouteFact {
  mode: TransportMode;
  distanceMeters: number;
  durationSeconds?: number;
}

export interface TransportRecommendation {
  mode?: TransportMode;
  reasons: string[];
  limitations: string[];
}

/**
 * Produces a conservative, explainable suggestion from facts already available
 * in the Plan. It never starts a journey and intentionally excludes live
 * weather, disruption, and precise device-location signals.
 */
export function recommendPlanTransport(input: { preference: TransportPreference; partySize?: number; luggage: LuggageLevel; routeFacts: TransportRouteFact[] }): TransportRecommendation {
  const byMode = new Map(input.routeFacts.map((fact) => [fact.mode, fact]));
  const limitations = ["Live weather, service disruptions, and exact device location are not considered in this preliminary choice."];
  if (!input.routeFacts.length) return { reasons: ["Compare at least one available route before choosing transport."], limitations };

  const preferredMode = input.preference === "taxi" ? "driving" : input.preference === "public_transit" ? "transit" : input.preference === "walking" ? "walking" : undefined;
  if (preferredMode) {
    if (byMode.has(preferredMode)) return { mode: preferredMode, reasons: [`This Plan explicitly prefers ${transportModeLabel(preferredMode)}.`], limitations };
    return { reasons: [`This Plan prefers ${transportModeLabel(preferredMode)}, but no usable route fact was returned for it.`], limitations };
  }

  if ((input.luggage === "heavy" || (input.partySize ?? 0) >= 3) && byMode.has("driving")) {
    return { mode: "driving", reasons: [input.luggage === "heavy" ? "Heavy or multiple bags are recorded for this Plan." : "Three or more people are recorded for this Plan.", "A driving route fact is available."], limitations };
  }

  const walking = byMode.get("walking");
  if (walking && walking.distanceMeters <= 1_500 && (walking.durationSeconds === undefined || walking.durationSeconds <= 25 * 60) && input.luggage !== "heavy") {
    return { mode: "walking", reasons: ["The walking route is within 1.5 km and about 25 minutes when a duration is available.", "This Plan does not record heavy luggage."], limitations };
  }

  if (byMode.has("transit")) return { mode: "transit", reasons: ["Public-transit route facts are available and no stronger Plan preference is recorded."], limitations };
  if (byMode.has("driving")) return { mode: "driving", reasons: ["A driving route fact is available after other practical route facts were unavailable."], limitations };
  if (walking) return { mode: "walking", reasons: ["A walking route fact is the available option."], limitations };
  return { reasons: ["No usable route fact is available yet."], limitations };
}

function transportModeLabel(mode: TransportMode): string {
  return mode === "driving" ? "driving / taxi" : mode === "transit" ? "public transit" : "walking";
}
