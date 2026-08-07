import { recommendPlanTransport } from "@c-assistant/core/transport";
import type { LuggageLevel, TransportPreference } from "@c-assistant/core";
import type { TransportMode, TransportRouteFact, TransportWeatherFact } from "@c-assistant/core/transport";

export type FoodNearbySkillStatus = "success" | "needs_input" | "degraded" | "failed";

export interface FoodNearbyCandidateInput {
  id: string;
  name: string;
  address: string;
  location: string;
  type: string;
  distanceMeters: number;
}

export interface FoodNearbyFact extends FoodNearbyCandidateInput {
  position: number;
}

export interface FoodNearbySkillResult {
  skill: { id: "food-nearby"; version: "0.1.0" };
  status: FoodNearbySkillStatus;
  summary: string;
  facts: FoodNearbyFact[];
  assumptions: string[];
  recommendations: Array<{ candidateId: string; reason: string }>;
  proposedPlanChanges: [];
  proposedTasks: [];
  proposedReminders: [];
  actionCards: Array<{ kind: "external_handoff"; provider: "amap"; candidateId: string; completion: "unknown_until_user_confirms" }>;
  sources: Array<{ provider: "amap"; observedAt: string }>;
  warnings: string[];
  needsInput?: { field: "partySize"; reason: string };
}

/**
 * First deterministic China Pack Skill implementation. It converts approved
 * Amap facts into a bounded result; it deliberately makes no restaurant rank.
 */
export function runFoodNearbySkill(input: { partySize?: number; candidates: FoodNearbyCandidateInput[]; observedAt: string }): FoodNearbySkillResult {
  const base = {
    skill: { id: "food-nearby" as const, version: "0.1.0" as const },
    assumptions: [],
    recommendations: [],
    proposedPlanChanges: [] as [],
    proposedTasks: [] as [],
    proposedReminders: [] as [],
    sources: [{ provider: "amap" as const, observedAt: input.observedAt }]
  };
  if (input.partySize === undefined) {
    return {
      ...base,
      status: "needs_input",
      summary: "Party size is required before showing specific nearby food candidates.",
      facts: [],
      actionCards: [],
      warnings: [],
      needsInput: { field: "partySize", reason: "Party size can materially change whether a place is practical for this Plan." }
    };
  }
  if (!Number.isInteger(input.partySize) || input.partySize < 1 || input.partySize > 20 || !Number.isFinite(Date.parse(input.observedAt))) {
    return { ...base, status: "failed", summary: "The nearby food input did not pass the Skill contract.", facts: [], actionCards: [], sources: [], warnings: ["No candidate was shown from malformed context."] };
  }
  const valid = input.candidates.filter(isValidCandidate);
  const facts = valid.slice(0, 5).map((candidate, index) => ({ ...candidate, position: index + 1 }));
  const warnings = [
    "Provider order is preserved; C-assistant has not independently ranked these places.",
    "Opening Amap does not prove an order, reservation, payment, visit, or completion."
  ];
  if (valid.length !== input.candidates.length) warnings.push("Malformed provider candidates were omitted.");
  if (facts.length === 0) {
    return { ...base, status: "degraded", summary: `Amap returned no usable nearby food candidates for ${input.partySize} ${input.partySize === 1 ? "person" : "people"}.`, facts, actionCards: [], warnings };
  }
  return {
    ...base,
    status: "success",
    summary: `Amap returned ${facts.length} nearby food candidates for ${input.partySize} ${input.partySize === 1 ? "person" : "people"}.`,
    facts,
    actionCards: facts.map((fact) => ({ kind: "external_handoff", provider: "amap", candidateId: fact.id, completion: "unknown_until_user_confirms" })),
    warnings
  };
}

function isValidCandidate(candidate: FoodNearbyCandidateInput): boolean {
  return Boolean(candidate.id.trim() && candidate.name.trim() && candidate.address.trim() && candidate.location.trim() && candidate.type.trim())
    && Number.isFinite(candidate.distanceMeters) && candidate.distanceMeters >= 0;
}

export interface HousingAreaRecommendation {
  candidateId: string;
  reason: string;
  limitations: string[];
}

export interface HousingAreaSkillResult {
  skill: { id: "housing-area-recommendation"; version: "0.1.0" };
  status: "success" | "needs_input" | "degraded" | "failed";
  summary: string;
  facts: FoodNearbyFact[];
  assumptions: string[];
  recommendations: HousingAreaRecommendation[];
  actionCards: Array<{ kind: "external_handoff"; provider: "amap"; candidateId: string; completion: "unknown_until_user_confirms" }>;
  sources: Array<{ provider: "amap"; observedAt: string }>;
  warnings: string[];
  needsInput?: { field: "centreName"; reason: string };
}

/** First access-oriented slice; area-level judgment waits for multi-anchor route facts. */
export function runHousingAreaRecommendationSkill(input: { centreName?: string; candidates: FoodNearbyCandidateInput[]; observedAt: string }): HousingAreaSkillResult {
  const identity = { id: "housing-area-recommendation" as const, version: "0.1.0" as const };
  const centreName = input.centreName?.trim();
  if (!centreName) {
    return { skill: identity, status: "needs_input", summary: "Choose the Plan place that accommodation access should be compared with.", facts: [], assumptions: [], recommendations: [], actionCards: [], sources: [], warnings: [], needsInput: { field: "centreName", reason: "A stay location needs a venue, workplace, school, or other Plan anchor for an explainable comparison." } };
  }
  if (!Number.isFinite(Date.parse(input.observedAt))) {
    return { skill: identity, status: "failed", summary: "The accommodation input did not pass the Skill contract.", facts: [], assumptions: [], recommendations: [], actionCards: [], sources: [], warnings: ["No accommodation conclusion was produced from malformed context."] };
  }
  const valid = input.candidates.filter(isValidCandidate);
  const facts = valid.slice(0, 5).map((candidate, index) => ({ ...candidate, position: index + 1 }));
  const warnings = [
    "Amap distance is a location fact, not a door-to-door commute or proof that this is the best area.",
    "Live price, inventory, booking, payment, and foreign-guest eligibility have not been verified."
  ];
  if (valid.length !== input.candidates.length) warnings.push("Malformed provider candidates were omitted.");
  if (facts.length === 0) return { skill: identity, status: "degraded", summary: `Amap returned no usable accommodation candidates near ${centreName}.`, facts, assumptions: [], recommendations: [], actionCards: [], sources: [{ provider: "amap", observedAt: input.observedAt }], warnings };
  return {
    skill: identity,
    status: "success",
    summary: `Preliminary access comparison for accommodation near ${centreName}.`,
    facts,
    assumptions: ["The selected centre is a useful access anchor for this Plan."],
    recommendations: facts.slice(0, 3).map((fact) => ({
      candidateId: fact.id,
      reason: `${formatSkillDistance(fact.distanceMeters)} from ${centreName} by Amap nearby-place distance. Compare an actual route before choosing.`,
      limitations: [...warnings]
    })),
    actionCards: facts.map((fact) => ({ kind: "external_handoff", provider: "amap", candidateId: fact.id, completion: "unknown_until_user_confirms" })),
    sources: [{ provider: "amap", observedAt: input.observedAt }],
    warnings
  };
}

function formatSkillDistance(distanceMeters: number): string {
  return distanceMeters < 1_000 ? `${Math.round(distanceMeters)} m` : `${(distanceMeters / 1_000).toFixed(1)} km`;
}

export interface TransportPlannerSkillResult {
  skill: { id: "transport-planner"; version: "0.1.0" };
  status: "success" | "needs_input" | "failed";
  summary: string;
  facts: TransportRouteFact[];
  assumptions: string[];
  recommendations: Array<{ mode: TransportMode; reasons: string[] }>;
  proposedPlanChanges: [];
  proposedTasks: [];
  proposedReminders: [];
  actionCards: Array<{ kind: "external_handoff"; provider: "amap"; mode: TransportMode; completion: "unknown_until_user_confirms" }>;
  sources: Array<{ provider: "amap" | "qweather"; observedAt: string }>;
  warnings: string[];
  needsInput?: { field: "routeFacts"; reason: string };
}

/** Plan-scoped transport decision over normalized facts; it never starts travel. */
export function runTransportPlannerSkill(input: {
  preference: TransportPreference;
  partySize?: number;
  luggage: LuggageLevel;
  routeFacts: TransportRouteFact[];
  routeObservedAt: string;
  weather?: TransportWeatherFact;
  weatherObservedAt?: string;
}): TransportPlannerSkillResult {
  const identity = { id: "transport-planner" as const, version: "0.1.0" as const };
  const noChanges = { proposedPlanChanges: [] as [], proposedTasks: [] as [], proposedReminders: [] as [] };
  if (!input.routeFacts.length) {
    return { skill: identity, ...noChanges, status: "needs_input", summary: "Compare current routes before choosing transport for this Plan.", facts: [], assumptions: [], recommendations: [], actionCards: [], sources: [], warnings: [], needsInput: { field: "routeFacts", reason: "A transport choice needs at least one current route fact." } };
  }
  const validContext = ["plan_recommended", "taxi", "public_transit", "walking"].includes(input.preference)
    && ["unknown", "light", "standard", "heavy"].includes(input.luggage)
    && Number.isFinite(Date.parse(input.routeObservedAt))
    && (input.partySize === undefined || (Number.isInteger(input.partySize) && input.partySize >= 1 && input.partySize <= 20))
    && ((input.weather === undefined && input.weatherObservedAt === undefined)
      || (input.weather !== undefined && input.weatherObservedAt !== undefined
        && input.weather.condition.trim().length > 0
        && Number.isFinite(input.weather.precipitationMm) && input.weather.precipitationMm >= 0
        && Number.isFinite(Date.parse(input.weatherObservedAt))));
  const validFacts = input.routeFacts.every((fact) => ["driving", "transit", "walking"].includes(fact.mode)
    && Number.isFinite(fact.distanceMeters) && fact.distanceMeters >= 0
    && (fact.durationSeconds === undefined || (Number.isFinite(fact.durationSeconds) && fact.durationSeconds >= 0)));
  if (!validContext || !validFacts) {
    return { skill: identity, ...noChanges, status: "failed", summary: "The transport input did not pass the Skill contract.", facts: [], assumptions: [], recommendations: [], actionCards: [], sources: [], warnings: ["No transport conclusion was produced from malformed context."] };
  }
  const recommendation = recommendPlanTransport({
    preference: input.preference,
    ...(input.partySize !== undefined ? { partySize: input.partySize } : {}),
    luggage: input.luggage,
    routeFacts: input.routeFacts,
    ...(input.weather ? { weather: input.weather } : {})
  });
  const recommendations = recommendation.mode ? [{ mode: recommendation.mode, reasons: recommendation.reasons }] : [];
  const sources: TransportPlannerSkillResult["sources"] = [{ provider: "amap", observedAt: input.routeObservedAt }];
  if (input.weather && input.weatherObservedAt) sources.push({ provider: "qweather", observedAt: input.weatherObservedAt });
  return {
    skill: identity,
    status: "success",
    summary: recommendation.mode ? `Preliminary Plan transport choice: ${transportModeName(recommendation.mode)}.` : "No preliminary transport mode can be selected from the available facts.",
    facts: input.routeFacts,
    assumptions: input.weather ? ["The supplied weather fact was already matched to the expected arrival date."] : [],
    recommendations,
    ...noChanges,
    actionCards: recommendation.mode ? [{ kind: "external_handoff", provider: "amap", mode: recommendation.mode, completion: "unknown_until_user_confirms" }] : [],
    sources,
    warnings: [...recommendation.limitations, "No ride, booking, navigation session, or payment has been started."]
  };
}

function transportModeName(mode: TransportMode): string {
  return mode === "driving" ? "driving / taxi" : mode === "transit" ? "public transit" : "walking";
}

export interface WeatherPackingCurrentFact {
  condition: string;
  temperatureC: number;
  feelsLikeC: number;
  precipitationMm: number;
  observedAt: string;
}

export interface WeatherPackingDailyFact {
  date: string;
  conditionDay: string;
  conditionNight: string;
  highC: number;
  lowC: number;
  precipitationMm: number;
  uvIndex: number;
}

export interface WeatherAndPackingSkillResult {
  skill: { id: "weather-and-packing"; version: "0.1.0" };
  status: "success" | "degraded" | "failed";
  summary: string;
  facts: Array<{ kind: "current" | "forecast"; date?: string; condition: string; lowC: number; highC: number; precipitationMm: number; uvIndex?: number }>;
  assumptions: string[];
  recommendations: Array<{ kind: "rain_protection" | "warm_layer" | "heat_hydration" | "sun_protection"; text: string; basis: string }>;
  proposedPlanChanges: [];
  proposedTasks: [];
  proposedReminders: [];
  actionCards: [];
  sources: Array<{ provider: "qweather"; observedAt: string; url?: string }>;
  warnings: string[];
}

/** Converts QWeather-normalized facts into cautious, source-bound packing prompts. */
export function runWeatherAndPackingSkill(input: {
  locationName: string;
  current: WeatherPackingCurrentFact;
  daily: WeatherPackingDailyFact[];
  retrievedAt: string;
  attributionUrl?: string;
  targetDate?: string;
}): WeatherAndPackingSkillResult {
  const identity = { id: "weather-and-packing" as const, version: "0.1.0" as const };
  const noChanges = { proposedPlanChanges: [] as [], proposedTasks: [] as [], proposedReminders: [] as [], actionCards: [] as [] };
  const sourceUrl = approvedQWeatherUrl(input.attributionUrl);
  if (!validWeatherPackingInput(input)) {
    return { skill: identity, ...noChanges, status: "failed", summary: "The weather input did not pass the Skill contract.", facts: [], assumptions: [], recommendations: [], sources: [], warnings: ["No packing guidance was produced from malformed or untraceable weather context."] };
  }

  const matched = input.targetDate ? input.daily.find((day) => day.date === input.targetDate) : undefined;
  const selectedDays = input.targetDate ? (matched ? [matched] : []) : input.daily.slice(0, 3);
  const facts: WeatherAndPackingSkillResult["facts"] = input.targetDate && !matched
    ? [{ kind: "current", condition: input.current.condition, lowC: input.current.temperatureC, highC: input.current.temperatureC, precipitationMm: input.current.precipitationMm }]
    : selectedDays.length
      ? selectedDays.map((day) => ({ kind: "forecast", date: day.date, condition: `${day.conditionDay} / ${day.conditionNight}`, lowC: day.lowC, highC: day.highC, precipitationMm: day.precipitationMm, uvIndex: day.uvIndex }))
      : [{ kind: "current", condition: input.current.condition, lowC: input.current.temperatureC, highC: input.current.temperatureC, precipitationMm: input.current.precipitationMm }];
  const recommendations = packingRecommendations(facts);
  const warnings = ["Weather changes; refresh these facts near the relevant Task before relying on them."];
  if (input.attributionUrl && !sourceUrl) warnings.push("An unapproved attribution URL was omitted.");
  if (input.targetDate && !matched) warnings.push(`No forecast exactly matched ${input.targetDate}; current conditions are shown only as an observation, not as that date's forecast.`);
  const summary = matched
    ? `${input.locationName}: ${matched.conditionDay}, ${matched.lowC}–${matched.highC}°C, forecast precipitation ${matched.precipitationMm} mm.${recommendations.length ? ` ${recommendations.map((item) => item.text).join(" ")}` : ""} Forecast for ${matched.date}; conditions may change.`
    : input.targetDate
      ? `${input.locationName}: currently ${input.current.condition}, ${input.current.temperatureC}°C (feels like ${input.current.feelsLikeC}°C), precipitation ${input.current.precipitationMm} mm.${recommendations.length ? ` ${recommendations.map((item) => item.text).join(" ")}` : ""} This is a current observation, not a forecast for ${input.targetDate}.`
      : `Weather and packing check for ${input.locationName}: ${facts.length} current or forecast ${facts.length === 1 ? "fact" : "facts"} reviewed.${recommendations.length ? ` ${recommendations.map((item) => item.text).join(" ")}` : " No rain, cold, heat, or high-UV packing prompt is indicated by these returned facts."}`;
  return {
    skill: identity,
    ...noChanges,
    status: input.targetDate && !matched ? "degraded" : "success",
    summary,
    facts,
    assumptions: [],
    recommendations,
    sources: [{ provider: "qweather", observedAt: input.retrievedAt, ...(sourceUrl ? { url: sourceUrl } : {}) }],
    warnings
  };
}

function packingRecommendations(facts: WeatherAndPackingSkillResult["facts"]): WeatherAndPackingSkillResult["recommendations"] {
  const result: WeatherAndPackingSkillResult["recommendations"] = [];
  if (facts.some((fact) => fact.precipitationMm > 0 || /rain|storm|shower|snow|雨|雪|雷/i.test(fact.condition))) result.push({ kind: "rain_protection", text: "Consider rain or snow protection.", basis: "Returned conditions or precipitation indicate rain or snow." });
  if (facts.some((fact) => fact.lowC <= 10)) result.push({ kind: "warm_layer", text: "Consider a warmer layer.", basis: "A returned low or current temperature is 10°C or below." });
  if (facts.some((fact) => fact.highC >= 30)) result.push({ kind: "heat_hydration", text: "Consider water and heat protection.", basis: "A returned high or current temperature is 30°C or above." });
  if (facts.some((fact) => (fact.uvIndex ?? 0) >= 6)) result.push({ kind: "sun_protection", text: "Consider sun protection.", basis: "A returned UV index is 6 or above." });
  return result;
}

function validWeatherPackingInput(input: { locationName: string; current: WeatherPackingCurrentFact; daily: WeatherPackingDailyFact[]; retrievedAt: string; targetDate?: string }): boolean {
  const current = input.current;
  return input.locationName.trim().length > 0
    && Number.isFinite(Date.parse(input.retrievedAt)) && Number.isFinite(Date.parse(current.observedAt))
    && current.condition.trim().length > 0
    && [current.temperatureC, current.feelsLikeC, current.precipitationMm].every(Number.isFinite)
    && current.precipitationMm >= 0
    && (input.targetDate === undefined || /^\d{4}-\d{2}-\d{2}$/.test(input.targetDate))
    && input.daily.every((day) => /^\d{4}-\d{2}-\d{2}$/.test(day.date) && day.conditionDay.trim().length > 0 && day.conditionNight.trim().length > 0
      && [day.highC, day.lowC, day.precipitationMm, day.uvIndex].every(Number.isFinite) && day.precipitationMm >= 0 && day.uvIndex >= 0);
}

function approvedQWeatherUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "qweather.com" || url.hostname.endsWith(".qweather.com")) ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}
