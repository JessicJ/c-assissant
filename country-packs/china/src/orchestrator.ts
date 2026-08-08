import { compilePlanProposal, type Plan, type PlanCompilationDecision, type Profile } from "@c-assistant/core";

import {
  createChinaPlanCompilationProposal,
  type ArrivalPreparationItemInput,
  type ArrivalPreparationScheduleInput,
  type ArrivalPreparationSkillResult,
  type ChinaArrivalPlanSkillResult,
  type ChinaArrivalPlanSupportingResult,
  type DigitalLifeSetupSkillResult,
  type HousingAreaSkillResult,
  type LocalFoodGuideSkillResult,
  type PolicyApplicabilitySkillResult,
  type TransportPlannerSkillResult,
  type WeatherAndPackingSkillResult,
  runDigitalLifeSetupSkill,
  runHousingAreaRecommendationSkill,
  runLocalFoodGuideSkill,
  runPolicyApplicabilitySkill,
  runTransportPlannerSkill,
  runWeatherAndPackingSkill
} from "./index.js";
import { chinaSkillRegistry } from "./registry.js";

type WeatherInput = Parameters<typeof runWeatherAndPackingSkill>[0];
type HousingInput = Parameters<typeof runHousingAreaRecommendationSkill>[0];
type TransportInput = Parameters<typeof runTransportPlannerSkill>[0];
type LocalFoodInput = Omit<Parameters<typeof runLocalFoodGuideSkill>[0], "locationName" | "now">;
type DigitalLifeInput = Omit<Parameters<typeof runDigitalLifeSetupSkill>[0], "now">;
type PolicyEvidenceInput = Parameters<typeof runPolicyApplicabilitySkill>[0]["evidence"];

export interface ChinaArrivalOrchestrationInput {
  plan: Plan;
  profile: Pick<Profile, "nationality" | "immigrationStatus">;
  now: string;
  policyEvidence: PolicyEvidenceInput;
  weather: WeatherInput;
  housing: HousingInput;
  transport: TransportInput;
  localFood: LocalFoodInput;
  digitalLife: DigitalLifeInput;
  schedule: ArrivalPreparationScheduleInput;
  additionalPreparationItems?: ArrivalPreparationItemInput[];
}

export type ChinaArrivalOrchestrationResult =
  | {
    status: "compiled";
    supportingResults: ChinaArrivalPlanSupportingResult[];
    preparation: ArrivalPreparationSkillResult;
    composite: ChinaArrivalPlanSkillResult;
    compilation: Extract<PlanCompilationDecision, { status: "compiled" }>;
  }
  | {
    status: "blocked";
    reasonCode: string;
    message: string;
    supportingResults: ChinaArrivalPlanSupportingResult[];
    preparation: ArrivalPreparationSkillResult;
    composite: ChinaArrivalPlanSkillResult;
  };

/** Runs only over normalized, credential-free facts. It never persists or executes actions. */
export async function orchestrateChinaArrivalPlan(input: ChinaArrivalOrchestrationInput): Promise<ChinaArrivalOrchestrationResult> {
  const supportingResults: ChinaArrivalPlanSupportingResult[] = [];
  const policy = await invokeSupporting("policy-applicability", {
    nationality: input.profile.nationality,
    immigrationStatus: input.profile.immigrationStatus,
    location: input.plan.location,
    dates: input.plan.dates,
    evidence: input.policyEvidence,
    now: input.now
  }) as PolicyApplicabilitySkillResult;
  supportingResults.push(policy);

  const weather = await invokeSupporting("weather-and-packing", input.weather) as WeatherAndPackingSkillResult;
  supportingResults.push(weather);
  const housing = await invokeSupporting("housing-area-recommendation", input.housing) as HousingAreaSkillResult;
  supportingResults.push(housing);
  const transport = await invokeSupporting("transport-planner", input.transport) as TransportPlannerSkillResult;
  supportingResults.push(transport);
  const localFood = await invokeSupporting("local-food-guide", { ...input.localFood, locationName: input.plan.location, now: input.now }) as LocalFoodGuideSkillResult;
  supportingResults.push(localFood);
  const digitalLife = await invokeSupporting("digital-life-setup", { ...input.digitalLife, now: input.now }) as DigitalLifeSetupSkillResult;
  supportingResults.push(digitalLife);

  const preparationItems = derivePreparationItems({ policy, weather, housing, transport, digitalLife });
  if (input.additionalPreparationItems) preparationItems.push(...input.additionalPreparationItems);
  const preparation = await invokeSupporting("arrival-preparation", { items: preparationItems, schedule: input.schedule }) as ArrivalPreparationSkillResult;
  supportingResults.push(preparation);

  const composite = await chinaSkillRegistry.invoke("china-arrival-plan", {
    planId: input.plan.id,
    planVersion: input.plan.version,
    supportingResults
  }) as unknown as ChinaArrivalPlanSkillResult;
  const proposal = createChinaPlanCompilationProposal({ composite, preparation, localFood });
  if (proposal.status === "blocked") return { status: "blocked", reasonCode: proposal.reasonCode, message: proposal.message, supportingResults, preparation, composite };
  const compilation = compilePlanProposal(input.plan, proposal.proposal, new Date(input.now));
  if (compilation.status === "blocked") return { status: "blocked", reasonCode: compilation.reasonCode, message: compilation.message, supportingResults, preparation, composite };
  return { status: "compiled", supportingResults, preparation, composite, compilation };
}

async function invokeSupporting(id: string, input: unknown): Promise<ChinaArrivalPlanSupportingResult> {
  return await chinaSkillRegistry.invoke(id, input) as unknown as ChinaArrivalPlanSupportingResult;
}

function derivePreparationItems(input: {
  policy: PolicyApplicabilitySkillResult;
  weather: WeatherAndPackingSkillResult;
  housing: HousingAreaSkillResult;
  transport: TransportPlannerSkillResult;
  digitalLife: DigitalLifeSetupSkillResult;
}): ArrivalPreparationItemInput[] {
  const items: ArrivalPreparationItemInput[] = [];
  if (input.policy.status === "success") {
    items.push({
      key: "complete-source-backed-entry-review",
      titleEnglish: "Complete the source-backed entry requirement review",
      detailsEnglish: input.policy.nextAction,
      category: "documents",
      criticality: "critical",
      state: "needed",
      sourceSkill: input.policy.skill,
      timing: { anchor: "none", refreshFacts: [] }
    });
  }
  if (input.weather.recommendations.length) {
    items.push({
      key: "review-weather-sensitive-packing",
      titleEnglish: "Review weather-sensitive packing",
      detailsEnglish: input.weather.recommendations.map((item) => item.text).join(" "),
      category: "packing",
      criticality: "supporting",
      state: "needed",
      sourceSkill: input.weather.skill,
      timing: { anchor: "none", refreshFacts: [] }
    });
  }
  if (input.housing.recommendations.length) {
    items.push({
      key: "choose-plan-accommodation",
      titleEnglish: "Choose accommodation for this Plan",
      detailsEnglish: "Review the source-bound accommodation access comparison and complete any booking in the selected external service.",
      category: "accommodation",
      criticality: "critical",
      state: "needed",
      sourceSkill: input.housing.skill,
      timing: { anchor: "none", refreshFacts: [] }
    });
  }
  if (input.transport.recommendations.length) {
    items.push({
      key: "review-plan-transport",
      titleEnglish: "Review the planned transport option",
      detailsEnglish: input.transport.summary,
      category: "transport",
      criticality: "supporting",
      state: "needed",
      sourceSkill: input.transport.skill,
      timing: { anchor: "none", refreshFacts: [] }
    });
  }
  const digitalFacts = new Map(input.digitalLife.facts.map((fact) => [fact.id, fact]));
  for (const recommendation of input.digitalLife.recommendations) {
    const fact = digitalFacts.get(recommendation.itemId);
    if (!fact) continue;
    items.push({
      key: `digital-setup-${fact.id}`,
      titleEnglish: `Set up ${fact.nameEnglish} (${fact.nameOriginal})`,
      detailsEnglish: `${recommendation.text} ${recommendation.stepsEnglish.join(" ")}`,
      category: fact.category === "mobile_connectivity" ? "connectivity" : fact.category === "local_payments" ? "payments" : "apps",
      criticality: "supporting",
      state: "needed",
      sourceSkill: input.digitalLife.skill,
      timing: { anchor: "none", refreshFacts: [] }
    });
  }
  return items;
}
