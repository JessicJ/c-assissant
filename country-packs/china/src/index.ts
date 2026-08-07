import { recommendPlanTransport } from "@c-assistant/core/transport";
import type { LuggageLevel, PlanCompilationProposal, TransportPreference } from "@c-assistant/core";
import type { TransportMode, TransportRouteFact, TransportWeatherFact } from "@c-assistant/core/transport";
import type { SkillStatus } from "@c-assistant/skill-runtime";

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
  proposedPlanChanges: [];
  proposedTasks: [];
  proposedReminders: [];
  actionCards: Array<{ kind: "external_handoff"; provider: "amap"; candidateId: string; completion: "unknown_until_user_confirms" }>;
  sources: Array<{ provider: "amap"; observedAt: string }>;
  warnings: string[];
  needsInput?: { field: "centreName"; reason: string };
}

/** First access-oriented slice; area-level judgment waits for multi-anchor route facts. */
export function runHousingAreaRecommendationSkill(input: { centreName?: string; candidates: FoodNearbyCandidateInput[]; observedAt: string }): HousingAreaSkillResult {
  const identity = { id: "housing-area-recommendation" as const, version: "0.1.0" as const };
  const noChanges = { proposedPlanChanges: [] as [], proposedTasks: [] as [], proposedReminders: [] as [] };
  const centreName = input.centreName?.trim();
  if (!centreName) {
    return { skill: identity, ...noChanges, status: "needs_input", summary: "Choose the Plan place that accommodation access should be compared with.", facts: [], assumptions: [], recommendations: [], actionCards: [], sources: [], warnings: [], needsInput: { field: "centreName", reason: "A stay location needs a venue, workplace, school, or other Plan anchor for an explainable comparison." } };
  }
  if (!Number.isFinite(Date.parse(input.observedAt))) {
    return { skill: identity, ...noChanges, status: "failed", summary: "The accommodation input did not pass the Skill contract.", facts: [], assumptions: [], recommendations: [], actionCards: [], sources: [], warnings: ["No accommodation conclusion was produced from malformed context."] };
  }
  const valid = input.candidates.filter(isValidCandidate);
  const facts = valid.slice(0, 5).map((candidate, index) => ({ ...candidate, position: index + 1 }));
  const warnings = [
    "Amap distance is a location fact, not a door-to-door commute or proof that this is the best area.",
    "Live price, inventory, booking, payment, and foreign-guest eligibility have not been verified."
  ];
  if (valid.length !== input.candidates.length) warnings.push("Malformed provider candidates were omitted.");
  if (facts.length === 0) return { skill: identity, ...noChanges, status: "degraded", summary: `Amap returned no usable accommodation candidates near ${centreName}.`, facts, assumptions: [], recommendations: [], actionCards: [], sources: [{ provider: "amap", observedAt: input.observedAt }], warnings };
  return {
    skill: identity,
    ...noChanges,
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

export interface PolicyEvidenceInput {
  id: string;
  sourceId: string;
  authority: string;
  titleOriginal: string;
  url: string;
  retrievedAt: string;
  contentHash: string;
}

export interface PolicyApplicabilitySkillResult {
  skill: { id: "policy-applicability"; version: "0.1.0" };
  status: "success" | "needs_input" | "blocked" | "failed";
  reasonCode?: "needs_evidence";
  summary: string;
  facts: string[];
  assumptions: string[];
  recommendations: [];
  proposedPlanChanges: [];
  proposedTasks: [];
  proposedReminders: [];
  actionCards: [];
  sources: PolicyEvidenceInput[];
  warnings: string[];
  needsInput: Array<{ field: "profile.nationality" | "profile.immigrationStatus" | "plan.location" | "plan.dates" | "official_source.nia-english"; label: string; reason: string }>;
  nextAction: string;
}

const POLICY_EVIDENCE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000;

/** Evidence gate only. It never reads policy text or decides personal eligibility. */
export function runPolicyApplicabilitySkill(input: {
  nationality?: string;
  immigrationStatus: "unknown" | "short_term_visitor" | "tourist_visa" | "student_visa" | "work_visa" | "residence_permit" | "other";
  location?: string;
  dates?: string;
  evidence: PolicyEvidenceInput[];
  now: string;
}): PolicyApplicabilitySkillResult {
  const identity = { id: "policy-applicability" as const, version: "0.1.0" as const };
  const noChanges = { recommendations: [] as [], proposedPlanChanges: [] as [], proposedTasks: [] as [], proposedReminders: [] as [], actionCards: [] as [] };
  const nowMs = Date.parse(input.now);
  const validContext = Number.isFinite(nowMs) && ["unknown", "short_term_visitor", "tourist_visa", "student_visa", "work_visa", "residence_permit", "other"].includes(input.immigrationStatus);
  if (!validContext) return { skill: identity, ...noChanges, status: "failed", summary: "The policy preparation input did not pass the Skill contract.", facts: [], assumptions: [], sources: [], warnings: ["No policy or eligibility conclusion was produced."], needsInput: [], nextAction: "Correct the malformed preparation context before continuing." };

  const facts: string[] = [];
  const needsInput: PolicyApplicabilitySkillResult["needsInput"] = [];
  if (isConfirmedPolicyValue(input.nationality)) facts.push(`Nationality: ${input.nationality!.trim()}`);
  else needsInput.push({ field: "profile.nationality", label: "Nationality", reason: "Official immigration guidance can depend on nationality." });
  if (input.immigrationStatus !== "unknown") facts.push("China visa or residence status is recorded.");
  else needsInput.push({ field: "profile.immigrationStatus", label: "China visa or residence status", reason: "Choose the status you know, or update it when it becomes clear." });
  if (isConfirmedPolicyValue(input.location)) facts.push(`Plan destination: ${input.location!.trim()}`);
  else needsInput.push({ field: "plan.location", label: "Plan destination", reason: "A location is needed to prepare local policy research." });
  if (isConfirmedPolicyValue(input.dates)) facts.push(`Plan dates: ${input.dates!.trim()}`);
  else needsInput.push({ field: "plan.dates", label: "Plan dates", reason: "Dates are needed to decide when current official evidence should be refreshed." });

  const approvedEvidence = input.evidence.filter(isValidNiaEvidence).sort((left, right) => Date.parse(right.retrievedAt) - Date.parse(left.retrievedAt));
  const latest = approvedEvidence[0];
  const retrievedAt = latest ? Date.parse(latest.retrievedAt) : Number.NaN;
  const fresh = latest !== undefined && retrievedAt <= nowMs + 5 * 60 * 1_000 && retrievedAt >= nowMs - POLICY_EVIDENCE_MAX_AGE_MS;
  if (!fresh) needsInput.push({ field: "official_source.nia-english", label: "Current National Immigration Administration evidence", reason: latest ? "The saved official snapshot is outside the seven-day freshness window. Refresh it before review." : "Refresh the approved National Immigration Administration source before review." });

  const missingUserFacts = needsInput.some((item) => item.field.startsWith("profile.") || item.field.startsWith("plan."));
  const status = missingUserFacts ? "needs_input" : fresh ? "success" : "blocked";
  const warnings = ["This evidence-preparation check does not determine visa, residence, entry, or policy eligibility."];
  if (approvedEvidence.length !== input.evidence.length) warnings.push("Malformed or unapproved evidence metadata was omitted.");
  return {
    skill: identity,
    ...noChanges,
    status,
    ...(status === "blocked" ? { reasonCode: "needs_evidence" as const } : {}),
    summary: status === "success" ? "Basic information and current official evidence are ready for a separate policy review." : status === "needs_input" ? "Confirmed Profile or Plan facts are still needed before policy review." : "Current approved official evidence is still needed before policy review.",
    facts,
    assumptions: [],
    sources: latest ? [latest] : [],
    warnings,
    needsInput,
    nextAction: status === "needs_input" ? "Save the missing Profile or Plan details, then refresh the approved official source." : status === "blocked" ? "Refresh the approved National Immigration Administration source in Settings before review." : "Continue to a separate source-backed policy review; do not treat this gate as an eligibility result."
  };
}

function isValidNiaEvidence(evidence: PolicyEvidenceInput): boolean {
  if (!evidence.id.trim() || evidence.sourceId !== "nia-english" || !evidence.authority.trim() || !evidence.titleOriginal.trim() || !/^[a-f0-9]{64}$/i.test(evidence.contentHash) || !Number.isFinite(Date.parse(evidence.retrievedAt))) return false;
  try {
    const url = new URL(evidence.url);
    return url.protocol === "https:" && (url.hostname === "nia.gov.cn" || url.hostname.endsWith(".nia.gov.cn"));
  } catch {
    return false;
  }
}

function isConfirmedPolicyValue(value: string | undefined): boolean {
  const normalized = value?.trim().toLocaleLowerCase() ?? "";
  return Boolean(normalized) && !normalized.includes("to be confirmed") && !normalized.includes("not sure");
}

export interface LocalFoodGuideSourceInput {
  id: string;
  authority: string;
  titleOriginal: string;
  url: string;
  retrievedAt: string;
  contentHash: string;
}

export interface LocalFoodGuideFactInput {
  id: string;
  nameOriginal: string;
  nameEnglish: string;
  descriptionEnglish: string;
  sourceId: string;
}

export interface LocalFoodGuideSkillResult {
  skill: { id: "local-food-guide"; version: "0.1.0" };
  status: "success" | "needs_input" | "degraded" | "failed";
  summary: string;
  facts: LocalFoodGuideFactInput[];
  assumptions: [];
  recommendations: Array<{ factId: string; text: string; sourceId: string }>;
  proposedPlanChanges: [];
  proposedTasks: [];
  proposedReminders: [];
  actionCards: [];
  sources: LocalFoodGuideSourceInput[];
  warnings: string[];
  needsInput?: { field: "plan.location"; reason: string };
}

const LOCAL_FOOD_SOURCE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1_000;

/**
 * Plan-time food orientation only. It preserves approved official-source facts
 * and never turns them into restaurant, ordering, booking, or payment actions.
 */
export function runLocalFoodGuideSkill(input: {
  locationName?: string;
  facts: LocalFoodGuideFactInput[];
  sources: LocalFoodGuideSourceInput[];
  approvedSourceIds: string[];
  now: string;
}): LocalFoodGuideSkillResult {
  const identity = { id: "local-food-guide" as const, version: "0.1.0" as const };
  const noActions = { assumptions: [] as [], proposedPlanChanges: [] as [], proposedTasks: [] as [], proposedReminders: [] as [], actionCards: [] as [] };
  const locationName = input.locationName?.trim();
  if (!locationName) {
    return {
      skill: identity,
      ...noActions,
      status: "needs_input",
      summary: "A confirmed Plan location is needed before adding local food guidance.",
      facts: [],
      recommendations: [],
      sources: [],
      warnings: [],
      needsInput: { field: "plan.location", reason: "Local food context must be tied to the destination in this Plan." }
    };
  }
  const nowMs = Date.parse(input.now);
  if (!Number.isFinite(nowMs) || !Array.isArray(input.facts) || !Array.isArray(input.sources) || !Array.isArray(input.approvedSourceIds) || !input.approvedSourceIds.every((id) => typeof id === "string" && id.trim())) {
    return { skill: identity, ...noActions, status: "failed", summary: "The local food input did not pass the Skill contract.", facts: [], recommendations: [], sources: [], warnings: ["No food guidance was produced from malformed context."] };
  }

  const approvedSourceIds = new Set(input.approvedSourceIds);
  const sourceById = new Map(input.sources.filter((source) => approvedSourceIds.has(source.id) && isValidLocalFoodSource(source, nowMs)).map((source) => [source.id, source]));
  const seenNames = new Set<string>();
  const facts = input.facts.filter((fact) => {
    if (!isValidLocalFoodFact(fact) || !sourceById.has(fact.sourceId)) return false;
    const key = `${fact.nameOriginal.trim().toLocaleLowerCase()}\u0000${fact.nameEnglish.trim().toLocaleLowerCase()}`;
    if (seenNames.has(key)) return false;
    seenNames.add(key);
    return true;
  }).slice(0, 5).map((fact) => ({
    id: fact.id.trim(),
    nameOriginal: fact.nameOriginal.trim(),
    nameEnglish: fact.nameEnglish.trim(),
    descriptionEnglish: fact.descriptionEnglish.trim(),
    sourceId: fact.sourceId
  }));
  const usedSourceIds = new Set(facts.map((fact) => fact.sourceId));
  const sources = [...usedSourceIds].flatMap((id) => {
    const source = sourceById.get(id);
    return source ? [source] : [];
  });
  const warnings = [
    "These are destination food references, not restaurant recommendations or proof of current availability.",
    "No restaurant, order, reservation, payment, or visit has been selected or started."
  ];
  if (facts.length !== input.facts.length || sourceById.size !== input.sources.length) warnings.push("Malformed, duplicate, or untraceable food facts and sources were omitted.");
  if (!facts.length) {
    return {
      skill: identity,
      ...noActions,
      status: "degraded",
      summary: `No source-backed local food guidance is currently available for ${locationName}.`,
      facts: [],
      recommendations: [],
      sources: [],
      warnings
    };
  }
  return {
    skill: identity,
    ...noActions,
    status: "success",
    summary: `${facts.length} source-backed local food references are available for ${locationName}; specific places can be considered after arrival or on request.`,
    facts,
    recommendations: facts.map((fact) => ({ factId: fact.id, sourceId: fact.sourceId, text: `Learn about ${fact.nameEnglish} (${fact.nameOriginal}): ${fact.descriptionEnglish}` })),
    sources,
    warnings
  };
}

function isValidLocalFoodSource(source: LocalFoodGuideSourceInput, nowMs: number): boolean {
  if (!source.id.trim() || !source.authority.trim() || !source.titleOriginal.trim() || !/^[a-f0-9]{64}$/i.test(source.contentHash) || !Number.isFinite(Date.parse(source.retrievedAt))) return false;
  const retrievedAt = Date.parse(source.retrievedAt);
  if (retrievedAt > nowMs + 5 * 60 * 1_000 || retrievedAt < nowMs - LOCAL_FOOD_SOURCE_MAX_AGE_MS) return false;
  try {
    return new URL(source.url).protocol === "https:";
  } catch {
    return false;
  }
}

function isValidLocalFoodFact(fact: LocalFoodGuideFactInput): boolean {
  return Boolean(fact.id.trim() && fact.nameOriginal.trim() && fact.nameEnglish.trim() && fact.descriptionEnglish.trim() && fact.sourceId.trim());
}

export type DigitalLifeCapability = "mobile_connectivity" | "communication" | "map_navigation" | "local_payments";

export interface DigitalLifeSetupSourceInput {
  id: string;
  authority: string;
  titleOriginal: string;
  url: string;
  retrievedAt: string;
  contentHash: string;
}

export interface DigitalLifeSetupItemInput {
  id: string;
  nameOriginal: string;
  nameEnglish: string;
  category: DigitalLifeCapability;
  reasonEnglish: string;
  stepsEnglish: string[];
  sourceId: string;
}

export interface DigitalLifeSetupSkillResult {
  skill: { id: "digital-life-setup"; version: "0.1.0" };
  status: "success" | "degraded" | "failed";
  summary: string;
  facts: Array<DigitalLifeSetupItemInput & { setupState: "needed" | "confirmed_completed" }>;
  assumptions: [];
  recommendations: Array<{ itemId: string; text: string; stepsEnglish: string[]; sourceId: string }>;
  proposedPlanChanges: [];
  proposedTasks: [];
  proposedReminders: [];
  actionCards: Array<{ kind: "official_setup_link"; itemId: string; url: string; completion: "unknown_until_user_confirms" }>;
  sources: DigitalLifeSetupSourceInput[];
  warnings: string[];
  unresolvedCapabilities: DigitalLifeCapability[];
}

const digitalLifeCapabilities: DigitalLifeCapability[] = ["mobile_connectivity", "communication", "map_navigation", "local_payments"];
const DIGITAL_LIFE_SOURCE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1_000;

/** Selects source-backed setup guidance for this Plan; it never installs or registers anything. */
export function runDigitalLifeSetupSkill(input: {
  requiredCapabilities: DigitalLifeCapability[];
  completedItemIds: string[];
  items: DigitalLifeSetupItemInput[];
  sources: DigitalLifeSetupSourceInput[];
  approvedSourceIds: string[];
  now: string;
}): DigitalLifeSetupSkillResult {
  const identity = { id: "digital-life-setup" as const, version: "0.1.0" as const };
  const noChanges = { assumptions: [] as [], proposedPlanChanges: [] as [], proposedTasks: [] as [], proposedReminders: [] as [] };
  const nowMs = Date.parse(input.now);
  const validArrays = [input.requiredCapabilities, input.completedItemIds, input.items, input.sources, input.approvedSourceIds].every(Array.isArray);
  const validCapabilities = validArrays && input.requiredCapabilities.every((capability) => digitalLifeCapabilities.includes(capability));
  const validIds = validArrays && [...input.completedItemIds, ...input.approvedSourceIds].every((id) => typeof id === "string" && Boolean(id.trim()));
  if (!Number.isFinite(nowMs) || !validArrays || !validCapabilities || !validIds) {
    return { skill: identity, ...noChanges, status: "failed", summary: "The digital-life setup input did not pass the Skill contract.", facts: [], recommendations: [], actionCards: [], sources: [], warnings: ["No setup guidance was produced from malformed context."], unresolvedCapabilities: [] };
  }

  const requiredCapabilities = [...new Set(input.requiredCapabilities)];
  if (!requiredCapabilities.length) {
    return { skill: identity, ...noChanges, status: "degraded", summary: "No digital capability requirement has been resolved from this Plan yet.", facts: [], recommendations: [], actionCards: [], sources: [], warnings: ["Core should derive digital needs from the Plan before asking the user to configure individual apps."], unresolvedCapabilities: [] };
  }
  const completedItemIds = new Set(input.completedItemIds);
  const approvedSourceIds = new Set(input.approvedSourceIds);
  const sourceById = new Map(input.sources.filter((source) => isValidDigitalLifeSource(source, nowMs) && approvedSourceIds.has(source.id)).map((source) => [source.id, source]));
  const seenItems = new Set<string>();
  const facts = input.items.filter((item) => {
    if (!isValidDigitalLifeItem(item) || !requiredCapabilities.includes(item.category) || !sourceById.has(item.sourceId) || seenItems.has(item.id)) return false;
    seenItems.add(item.id);
    return true;
  }).slice(0, 8).map((item) => ({
    id: item.id.trim(),
    nameOriginal: item.nameOriginal.trim(),
    nameEnglish: item.nameEnglish.trim(),
    category: item.category,
    reasonEnglish: item.reasonEnglish.trim(),
    stepsEnglish: item.stepsEnglish.map((step) => step.trim()),
    sourceId: item.sourceId,
    setupState: completedItemIds.has(item.id) ? "confirmed_completed" as const : "needed" as const
  }));
  const resolvedCapabilities = new Set(facts.map((fact) => fact.category));
  const unresolvedCapabilities = requiredCapabilities.filter((capability) => !resolvedCapabilities.has(capability));
  const recommendations = facts.filter((fact) => fact.setupState === "needed").map((fact) => ({ itemId: fact.id, sourceId: fact.sourceId, text: `${fact.nameEnglish} (${fact.nameOriginal}): ${fact.reasonEnglish}`, stepsEnglish: fact.stepsEnglish }));
  const usedSourceIds = new Set(facts.map((fact) => fact.sourceId));
  const sources = [...usedSourceIds].flatMap((id) => {
    const source = sourceById.get(id);
    return source ? [source] : [];
  });
  const actionCards = recommendations.flatMap((recommendation) => {
    const source = sourceById.get(recommendation.sourceId);
    return source ? [{ kind: "official_setup_link" as const, itemId: recommendation.itemId, url: source.url, completion: "unknown_until_user_confirms" as const }] : [];
  });
  const warnings = [
    "Opening an official link does not prove installation, registration, identity verification, payment readiness, or Task completion.",
    "C-assistant does not receive passwords, verification codes, payment credentials, or account sessions."
  ];
  if (facts.length !== input.items.length || sourceById.size !== input.sources.length) warnings.push("Malformed, duplicate, stale, unapproved, irrelevant, or untraceable setup material was omitted.");
  if (unresolvedCapabilities.length) warnings.push(`No current approved setup guidance is available for: ${unresolvedCapabilities.join(", ")}.`);
  const status = unresolvedCapabilities.length ? "degraded" : "success";
  const completedCount = facts.length - recommendations.length;
  return {
    skill: identity,
    ...noChanges,
    status,
    summary: `${recommendations.length} digital setup ${recommendations.length === 1 ? "item remains" : "items remain"} for this Plan; ${completedCount} ${completedCount === 1 ? "item is" : "items are"} already user-confirmed.`,
    facts,
    recommendations,
    actionCards,
    sources,
    warnings,
    unresolvedCapabilities
  };
}

function isValidDigitalLifeSource(source: unknown, nowMs: number): source is DigitalLifeSetupSourceInput {
  if (typeof source !== "object" || source === null) return false;
  const candidate = source as Partial<DigitalLifeSetupSourceInput>;
  if (typeof candidate.id !== "string" || !candidate.id.trim()
    || typeof candidate.authority !== "string" || !candidate.authority.trim()
    || typeof candidate.titleOriginal !== "string" || !candidate.titleOriginal.trim()
    || typeof candidate.url !== "string"
    || typeof candidate.retrievedAt !== "string"
    || typeof candidate.contentHash !== "string" || !/^[a-f0-9]{64}$/i.test(candidate.contentHash)) return false;
  const retrievedAt = Date.parse(candidate.retrievedAt);
  if (!Number.isFinite(retrievedAt) || retrievedAt > nowMs + 5 * 60 * 1_000 || retrievedAt < nowMs - DIGITAL_LIFE_SOURCE_MAX_AGE_MS) return false;
  try {
    return new URL(candidate.url).protocol === "https:";
  } catch {
    return false;
  }
}

function isValidDigitalLifeItem(item: unknown): item is DigitalLifeSetupItemInput {
  if (typeof item !== "object" || item === null) return false;
  const candidate = item as Partial<DigitalLifeSetupItemInput>;
  return typeof candidate.id === "string" && Boolean(candidate.id.trim())
    && typeof candidate.nameOriginal === "string" && Boolean(candidate.nameOriginal.trim())
    && typeof candidate.nameEnglish === "string" && Boolean(candidate.nameEnglish.trim())
    && typeof candidate.reasonEnglish === "string" && Boolean(candidate.reasonEnglish.trim())
    && typeof candidate.sourceId === "string" && Boolean(candidate.sourceId.trim())
    && typeof candidate.category === "string" && digitalLifeCapabilities.includes(candidate.category as DigitalLifeCapability)
    && Array.isArray(candidate.stepsEnglish) && candidate.stepsEnglish.length > 0 && candidate.stepsEnglish.length <= 8
    && candidate.stepsEnglish.every((step) => typeof step === "string" && Boolean(step.trim()));
}

export type ArrivalPreparationSourceSkillId = Exclude<ChinaArrivalPlanSupportingSkillId, "arrival-preparation">;
export type ArrivalPreparationCategory = "documents" | "connectivity" | "apps" | "payments" | "packing" | "accommodation" | "transport" | "arrival_logistics";
export type ArrivalPreparationAnchor = "departure" | "arrival" | "none";

export interface ArrivalPreparationItemInput {
  key: string;
  titleEnglish: string;
  titleOriginal?: string;
  detailsEnglish: string;
  category: ArrivalPreparationCategory;
  criticality: "critical" | "supporting";
  state: "needed" | "confirmed_completed";
  sourceSkill: { id: ArrivalPreparationSourceSkillId; version: string };
  timing: { anchor: ArrivalPreparationAnchor; leadMinutes?: number; refreshFacts: Array<"weather"> };
}

export interface ArrivalPreparationScheduleInput {
  departureAt?: string;
  arrivalAt?: string;
  timeZone: string;
}

export interface ArrivalPreparationFact {
  key: string;
  titleEnglish: string;
  titleOriginal?: string;
  detailsEnglish: string;
  category: ArrivalPreparationCategory;
  criticality: "critical" | "supporting";
  state: "needed" | "confirmed_completed";
  sourceSkills: Array<{ id: ArrivalPreparationSourceSkillId; version: string }>;
  timing: ArrivalPreparationItemInput["timing"];
}

export interface ArrivalPreparationSkillResult {
  skill: { id: "arrival-preparation"; version: "0.1.0" };
  status: "success" | "needs_input" | "degraded" | "failed";
  summary: string;
  facts: ArrivalPreparationFact[];
  assumptions: [];
  recommendations: Array<{ key: string; titleEnglish: string; detailsEnglish: string; criticality: "critical" | "supporting"; sourceSkills: ArrivalPreparationFact["sourceSkills"] }>;
  proposedPlanChanges: [];
  proposedTasks: Array<{ proposalId: string; title: string; details: string; category: ArrivalPreparationCategory; completion: "requires_user_confirmation"; sourceSkills: ArrivalPreparationFact["sourceSkills"] }>;
  proposedReminders: Array<{ taskProposalId: string; dueAt: string; timeZone: string; purpose: string; refreshFacts: Array<"weather"> }>;
  actionCards: [];
  sources: Array<{ skillId: ArrivalPreparationSourceSkillId; version: string }>;
  warnings: string[];
  needsInput: Array<{ field: "schedule.departureAt" | "schedule.arrivalAt"; reason: string }>;
}

const arrivalPreparationCategories: ArrivalPreparationCategory[] = ["documents", "connectivity", "apps", "payments", "packing", "accommodation", "transport", "arrival_logistics"];
const arrivalPreparationSourceSkillIds: ArrivalPreparationSourceSkillId[] = ["policy-applicability", "weather-and-packing", "housing-area-recommendation", "transport-planner", "local-food-guide", "digital-life-setup"];

/** Compiles bounded supporting proposals; Core still owns durable Plan mutation and authorization. */
export function runArrivalPreparationSkill(input: { items: ArrivalPreparationItemInput[]; schedule: ArrivalPreparationScheduleInput }): ArrivalPreparationSkillResult {
  const identity = { id: "arrival-preparation" as const, version: "0.1.0" as const };
  const empty = { assumptions: [] as [], proposedPlanChanges: [] as [], actionCards: [] as [] };
  if (!Array.isArray(input.items) || !isValidArrivalPreparationSchedule(input.schedule)) {
    return { skill: identity, ...empty, status: "failed", summary: "The arrival preparation input did not pass the Skill contract.", facts: [], recommendations: [], proposedTasks: [], proposedReminders: [], sources: [], warnings: ["No checklist or reminder proposal was produced from malformed context."], needsInput: [] };
  }

  const validItems = input.items.filter(isValidArrivalPreparationItem);
  const grouped = new Map<string, ArrivalPreparationFact>();
  let duplicateFound = false;
  let conflictingDuplicate = false;
  for (const item of validItems) {
    const key = item.key.trim().toLocaleLowerCase();
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, {
        key,
        titleEnglish: item.titleEnglish.trim(),
        ...(item.titleOriginal?.trim() ? { titleOriginal: item.titleOriginal.trim() } : {}),
        detailsEnglish: item.detailsEnglish.trim(),
        category: item.category,
        criticality: item.criticality,
        state: item.state,
        sourceSkills: [item.sourceSkill],
        timing: item.timing
      });
      continue;
    }
    duplicateFound = true;
    if (!existing.sourceSkills.some((source) => source.id === item.sourceSkill.id && source.version === item.sourceSkill.version)) existing.sourceSkills.push(item.sourceSkill);
    if (item.state === "confirmed_completed") existing.state = "confirmed_completed";
    if (existing.titleEnglish !== item.titleEnglish.trim() || existing.category !== item.category || existing.timing.anchor !== item.timing.anchor || existing.timing.leadMinutes !== item.timing.leadMinutes) conflictingDuplicate = true;
  }
  const facts = [...grouped.values()].sort((left, right) => Number(right.criticality === "critical") - Number(left.criticality === "critical")).slice(0, 20);
  const recommendations = facts.filter((fact) => fact.state === "needed").map((fact) => ({ key: fact.key, titleEnglish: fact.titleEnglish, detailsEnglish: fact.detailsEnglish, criticality: fact.criticality, sourceSkills: fact.sourceSkills }));
  const proposedTasks = recommendations.map((item) => ({ proposalId: `arrival-preparation:${item.key}`, title: item.titleEnglish, details: item.detailsEnglish, category: facts.find((fact) => fact.key === item.key)!.category, completion: "requires_user_confirmation" as const, sourceSkills: item.sourceSkills }));
  const needsInput: ArrivalPreparationSkillResult["needsInput"] = [];
  const proposedReminders: ArrivalPreparationSkillResult["proposedReminders"] = [];
  for (const fact of facts) {
    if (fact.state !== "needed" || fact.timing.anchor === "none") continue;
    const anchorAt = fact.timing.anchor === "departure" ? input.schedule.departureAt : input.schedule.arrivalAt;
    if (!anchorAt) {
      if (fact.criticality === "critical" && !needsInput.some((item) => item.field === `schedule.${fact.timing.anchor}At`)) {
        needsInput.push({ field: `schedule.${fact.timing.anchor}At`, reason: `${fact.titleEnglish} needs an exact ${fact.timing.anchor} time before its reminder can be calculated.` });
      }
      continue;
    }
    const leadMinutes = fact.timing.leadMinutes ?? 0;
    proposedReminders.push({
      taskProposalId: `arrival-preparation:${fact.key}`,
      dueAt: new Date(Date.parse(anchorAt) - leadMinutes * 60_000).toISOString(),
      timeZone: input.schedule.timeZone,
      purpose: fact.titleEnglish,
      refreshFacts: fact.timing.refreshFacts
    });
  }
  const sources = facts.flatMap((fact) => fact.sourceSkills).filter((source, index, all) => all.findIndex((candidate) => candidate.id === source.id && candidate.version === source.version) === index).map((source) => ({ skillId: source.id, version: source.version }));
  const warnings = [
    "Tasks and Reminders are proposals only; Core must bind them to the reviewed Plan version before activation.",
    "No external setup, booking, payment, navigation, entry procedure, or Task completion has been performed."
  ];
  if (validItems.length !== input.items.length || facts.length < grouped.size) warnings.push("Malformed or excess preparation items were omitted.");
  if (duplicateFound) warnings.push("Duplicate preparation items were merged by stable semantic key.");
  if (conflictingDuplicate) warnings.push("Conflicting duplicate items were merged using the first description and timing; a confirmed-completed state takes precedence.");
  if (!facts.length) return { skill: identity, ...empty, status: "degraded", summary: "No valid source-backed preparation item is available to compile.", facts, recommendations, proposedTasks, proposedReminders, sources, warnings, needsInput };
  const status = needsInput.length ? "needs_input" : "success";
  return {
    skill: identity,
    ...empty,
    status,
    summary: `${recommendations.length} preparation ${recommendations.length === 1 ? "item remains" : "items remain"}; ${proposedReminders.length} exact-time reminder ${proposedReminders.length === 1 ? "is" : "are"} ready for Plan review.`,
    facts,
    recommendations,
    proposedTasks,
    proposedReminders,
    sources,
    warnings,
    needsInput
  };
}

function isValidArrivalPreparationSchedule(schedule: unknown): schedule is ArrivalPreparationScheduleInput {
  if (typeof schedule !== "object" || schedule === null) return false;
  const candidate = schedule as Partial<ArrivalPreparationScheduleInput>;
  if (typeof candidate.timeZone !== "string" || !candidate.timeZone.trim() || !isIanaTimeZone(candidate.timeZone)) return false;
  return [candidate.departureAt, candidate.arrivalAt].every((value) => value === undefined || (typeof value === "string" && isTimestampConsistentWithTimeZone(value, candidate.timeZone!)));
}

function isValidArrivalPreparationItem(item: unknown): item is ArrivalPreparationItemInput {
  if (typeof item !== "object" || item === null) return false;
  const candidate = item as Partial<ArrivalPreparationItemInput>;
  const timing = candidate.timing;
  const sourceSkill = candidate.sourceSkill;
  if (typeof timing !== "object" || timing === null || typeof sourceSkill !== "object" || sourceSkill === null) return false;
  const validLead = timing.leadMinutes === undefined || (Number.isInteger(timing.leadMinutes) && timing.leadMinutes >= 0 && timing.leadMinutes <= 43_200);
  const validRefresh = Array.isArray(timing.refreshFacts) && timing.refreshFacts.every((fact) => fact === "weather")
    && (timing.refreshFacts.length === 0 || candidate.category === "packing" || candidate.category === "transport");
  return typeof candidate.key === "string" && Boolean(candidate.key.trim())
    && typeof candidate.titleEnglish === "string" && Boolean(candidate.titleEnglish.trim())
    && (candidate.titleOriginal === undefined || typeof candidate.titleOriginal === "string")
    && typeof candidate.detailsEnglish === "string" && Boolean(candidate.detailsEnglish.trim())
    && typeof candidate.category === "string" && arrivalPreparationCategories.includes(candidate.category as ArrivalPreparationCategory)
    && (candidate.criticality === "critical" || candidate.criticality === "supporting")
    && (candidate.state === "needed" || candidate.state === "confirmed_completed")
    && typeof sourceSkill.id === "string" && arrivalPreparationSourceSkillIds.includes(sourceSkill.id as ArrivalPreparationSourceSkillId)
    && typeof sourceSkill.version === "string" && /^\d+\.\d+\.\d+$/.test(sourceSkill.version)
    && typeof timing.anchor === "string" && ["departure", "arrival", "none"].includes(timing.anchor)
    && validLead && validRefresh
    && (timing.anchor !== "none" || (timing.leadMinutes === undefined && timing.refreshFacts.length === 0));
}

function isIanaTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return value.includes("/") || value === "UTC";
  } catch {
    return false;
  }
}

function isTimestampConsistentWithTimeZone(value: string, timeZone: string): boolean {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/i.exec(value);
  const instant = Date.parse(value);
  if (!match || !Number.isFinite(instant)) return false;
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(instant).map((part) => [part.type, part.value]));
  return match[1] === `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}

export const chinaArrivalPlanSupportingSkillOrder = [
  "policy-applicability",
  "weather-and-packing",
  "housing-area-recommendation",
  "transport-planner",
  "local-food-guide",
  "digital-life-setup",
  "arrival-preparation"
] as const;

export type ChinaArrivalPlanSupportingSkillId = typeof chinaArrivalPlanSupportingSkillOrder[number];

export interface ChinaArrivalPlanSupportingResult {
  skill: { id: ChinaArrivalPlanSupportingSkillId; version: string };
  status: SkillStatus;
  summary: string;
  facts: unknown[];
  assumptions: unknown[];
  recommendations: unknown[];
  proposedPlanChanges: unknown[];
  proposedTasks: unknown[];
  proposedReminders: unknown[];
  actionCards: unknown[];
  sources: unknown[];
  warnings: unknown[];
}

export interface ChinaArrivalPlanSkillResult {
  skill: { id: "china-arrival-plan"; version: "0.1.0" };
  status: SkillStatus;
  reasonCode?: "composition_incomplete" | "supporting_skill_blocked";
  summary: string;
  facts: Array<{ skillId: ChinaArrivalPlanSupportingSkillId; version: string; status: SkillStatus; summary: string }>;
  assumptions: Array<{ skillId: ChinaArrivalPlanSupportingSkillId; value: unknown }>;
  recommendations: Array<{ skillId: ChinaArrivalPlanSupportingSkillId; value: unknown }>;
  proposedPlanChanges: [];
  proposedTasks: [];
  proposedReminders: [];
  actionCards: [];
  sources: Array<{ skillId: ChinaArrivalPlanSupportingSkillId; value: unknown }>;
  warnings: string[];
  planRef: { id: string; version: number };
  missingSkills: ChinaArrivalPlanSupportingSkillId[];
}

/**
 * First composite gate. It orders validated supporting results but deliberately
 * does not promote state changes or action cards until Core authorization and
 * a real Plan compiler are connected.
 */
export function runChinaArrivalPlanSkill(input: { planId: string; planVersion: number; supportingResults: ChinaArrivalPlanSupportingResult[] }): ChinaArrivalPlanSkillResult {
  const identity = { id: "china-arrival-plan" as const, version: "0.1.0" as const };
  const planRef = { id: input.planId, version: input.planVersion };
  const empty = { proposedPlanChanges: [] as [], proposedTasks: [] as [], proposedReminders: [] as [], actionCards: [] as [] };
  const malformed = !input.planId.trim() || !Number.isInteger(input.planVersion) || input.planVersion < 1
    || input.supportingResults.some((result) => !isValidSupportingResult(result));
  const ids = input.supportingResults.map((result) => result.skill.id);
  if (malformed || new Set(ids).size !== ids.length) {
    return { skill: identity, ...empty, status: "failed", summary: "The China arrival composition input did not pass the Skill contract.", facts: [], assumptions: [], recommendations: [], sources: [], warnings: ["No Plan proposal was produced from malformed, duplicate, or unknown supporting results."], planRef, missingSkills: [...chinaArrivalPlanSupportingSkillOrder] };
  }

  const byId = new Map(input.supportingResults.map((result) => [result.skill.id, result]));
  const ordered = chinaArrivalPlanSupportingSkillOrder.flatMap((id) => {
    const result = byId.get(id);
    return result ? [result] : [];
  });
  const missingSkills = chinaArrivalPlanSupportingSkillOrder.filter((id) => !byId.has(id));
  const facts = ordered.map((result) => ({ skillId: result.skill.id, version: result.skill.version, status: result.status, summary: result.summary }));
  const assumptions = ordered.flatMap((result) => result.assumptions.map((value) => ({ skillId: result.skill.id, value })));
  const recommendations = ordered.flatMap((result) => result.recommendations.map((value) => ({ skillId: result.skill.id, value })));
  const sources = ordered.flatMap((result) => result.sources.map((value) => ({ skillId: result.skill.id, value })));
  const supportingWarnings = ordered.flatMap((result) => result.warnings.filter((warning): warning is string => typeof warning === "string"));
  const boundaryWarning = "Supporting Plan changes, Tasks, Reminders, and action cards are not promoted until the Core compiler and authorization layer are connected.";
  if (missingSkills.length) {
    return { skill: identity, ...empty, status: "blocked", reasonCode: "composition_incomplete", summary: `China arrival composition is incomplete; ${missingSkills.length} required supporting Skills are not available.`, facts, assumptions, recommendations, sources, warnings: [...supportingWarnings, boundaryWarning], planRef, missingSkills };
  }
  const blocked = ordered.some((result) => result.status === "blocked" || result.status === "failed");
  const needsInput = ordered.some((result) => result.status === "needs_input");
  const degraded = ordered.some((result) => result.status === "degraded" || result.status === "not_supported");
  const status: SkillStatus = blocked ? "blocked" : needsInput ? "needs_input" : degraded ? "degraded" : "success";
  return {
    skill: identity,
    ...empty,
    status,
    ...(blocked ? { reasonCode: "supporting_skill_blocked" as const } : {}),
    summary: status === "success" ? "All required China arrival supporting results are ready for a future Core Plan compiler." : status === "needs_input" ? "A supporting Skill needs critical user input before composition can continue." : status === "degraded" ? "Composition is available with explicit supporting limitations." : "A supporting Skill blocked the China arrival composition.",
    facts,
    assumptions,
    recommendations,
    sources,
    warnings: [...supportingWarnings, boundaryWarning],
    planRef,
    missingSkills
  };
}

function isValidSupportingResult(result: ChinaArrivalPlanSupportingResult): boolean {
  return chinaArrivalPlanSupportingSkillOrder.includes(result.skill.id)
    && /^\d+\.\d+\.\d+$/.test(result.skill.version)
    && ["success", "needs_input", "degraded", "not_supported", "blocked", "failed"].includes(result.status)
    && Boolean(result.summary.trim())
    && [result.facts, result.assumptions, result.recommendations, result.proposedPlanChanges, result.proposedTasks, result.proposedReminders, result.actionCards, result.sources, result.warnings].every(Array.isArray);
}

export type ChinaPlanCompilationProposalDecision =
  | { status: "ready"; proposal: PlanCompilationProposal }
  | { status: "blocked"; reasonCode: "composition_not_ready" | "preparation_not_composed" | "invalid_preparation"; message: string };

/** Converts already composed China results into the country-neutral Core proposal contract. */
export function createChinaPlanCompilationProposal(input: { composite: ChinaArrivalPlanSkillResult; preparation: ArrivalPreparationSkillResult }): ChinaPlanCompilationProposalDecision {
  const { composite, preparation } = input;
  if ((composite.status !== "success" && composite.status !== "degraded") || composite.missingSkills.length) {
    return { status: "blocked", reasonCode: "composition_not_ready", message: "All required China supporting results must be composed before Core compilation." };
  }
  const preparationFact = composite.facts.find((fact) => fact.skillId === "arrival-preparation");
  if (!preparationFact || preparationFact.version !== preparation.skill.version || preparationFact.status !== preparation.status) {
    return { status: "blocked", reasonCode: "preparation_not_composed", message: "The arrival-preparation result does not match the version and status recorded by the composite." };
  }
  if ((preparation.status !== "success" && preparation.status !== "degraded") || preparation.needsInput.length) {
    return { status: "blocked", reasonCode: "invalid_preparation", message: "Arrival preparation still needs input or failed before Core compilation." };
  }
  const taskIds = preparation.proposedTasks.map((task) => task.proposalId);
  const reminderTaskIds = preparation.proposedReminders.map((reminder) => reminder.taskProposalId);
  if (new Set(taskIds).size !== taskIds.length || new Set(reminderTaskIds).size !== reminderTaskIds.length || reminderTaskIds.some((taskId) => !taskIds.includes(taskId))) {
    return { status: "blocked", reasonCode: "invalid_preparation", message: "Arrival preparation contains duplicate or orphan Reminder proposals." };
  }
  const reminders = new Map(preparation.proposedReminders.map((reminder) => [reminder.taskProposalId, reminder]));
  const limitations = [...new Set([...composite.warnings, ...preparation.warnings].filter((warning) => warning.trim()))];
  const assumptions = composite.assumptions.flatMap((assumption) => typeof assumption.value === "string" && assumption.value.trim() ? [assumption.value.trim()] : []);
  return {
    status: "ready",
    proposal: {
      planRef: { ...composite.planRef },
      countryPack: { id: "china", version: "0.0.0", name: "China Country Pack" },
      composition: { skillId: composite.skill.id, version: composite.skill.version, status: composite.status },
      compilationKey: "china-arrival-preparation",
      stage: { title: "China arrival preparation", description: "Source-bound preparation compiled from the reviewed China Country Pack results." },
      tasks: preparation.proposedTasks.map((task) => {
        const reminder = reminders.get(task.proposalId);
        const sourceSkills = [...task.sourceSkills, { id: preparation.skill.id, version: preparation.skill.version }].filter((source, index, all) => all.findIndex((candidate) => candidate.id === source.id && candidate.version === source.version) === index);
        return {
          proposalId: task.proposalId,
          title: task.title,
          description: task.details,
          owner: "user" as const,
          dueLabel: reminder ? "At the proposed reminder time" : "Before arrival",
          sourceSkills,
          ...(reminder ? { reminder: { dueAt: reminder.dueAt, timeZone: reminder.timeZone, purpose: reminder.purpose, refreshFacts: reminder.refreshFacts } } : {})
        };
      }),
      assumptions,
      limitations
    }
  };
}
