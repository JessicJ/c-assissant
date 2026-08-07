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
