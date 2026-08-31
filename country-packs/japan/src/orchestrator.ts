import { compilePlanProposal, type Plan, type PlanCompilationDecision, type Profile, type SourceEvidenceRef } from "@c-assistant/core";
import {
  createJapanPlanCompilationProposal,
  type JapanArrivalPlanResult,
  type JapanDigitalResult,
  type JapanEvidenceInput,
  type JapanFoodFact,
  type JapanFoodResult,
  type JapanHousingResult,
  type JapanPolicyResult,
  type JapanPreparationResult,
  type JapanReferenceItem,
  type JapanSupportingResult,
  type JapanSupportingSkillId,
  type JapanTransportResult,
  type JapanWeatherResult
} from "./index.js";
import { japanSkillRegistry } from "./registry.js";

export interface JapanArrivalOrchestrationInput {
  plan: Plan;
  profile: Pick<Profile, "nationality">;
  now: string;
  policy: { travelPurpose?: string; stayDays?: number; departureDate?: string; arrivalDate?: string; passportConfirmed?: boolean; evidence: JapanEvidenceInput[] };
  weather: Parameters<typeof import("./index.js").runJapanWeatherAndPackingSkill>[0];
  housing: Parameters<typeof import("./index.js").runJapanHousingAreaRecommendationSkill>[0];
  transport: Parameters<typeof import("./index.js").runJapanTransportPlannerSkill>[0];
  catalog: { items: JapanReferenceItem[]; foodFacts: JapanFoodFact[]; sources: JapanEvidenceInput[] };
  schedule: { departureAt?: string; arrivalAt?: string; returnAt?: string; timeZone: string };
}

export type JapanArrivalOrchestrationResult =
  | { status: "compiled"; supportingResults: JapanSupportingResult[]; composite: JapanArrivalPlanResult; preparation: JapanPreparationResult; sourceEvidenceBySkill: Partial<Record<JapanSupportingSkillId, SourceEvidenceRef[]>>; compilation: Extract<PlanCompilationDecision, { status: "compiled" }> }
  | { status: "blocked"; reasonCode: string; message: string; supportingResults: JapanSupportingResult[]; composite: JapanArrivalPlanResult; preparation: JapanPreparationResult };

export async function orchestrateJapanArrivalPlan(input: JapanArrivalOrchestrationInput): Promise<JapanArrivalOrchestrationResult> {
  const invoke = async <T>(id: string, value: unknown) => await japanSkillRegistry.invoke(id, value) as unknown as T;
  const policy = await invoke<JapanPolicyResult>("japan-policy-applicability", { nationality: input.profile.nationality, ...input.policy, now: input.now });
  const weather = await invoke<JapanWeatherResult>("japan-weather-and-packing", input.weather);
  const housing = await invoke<JapanHousingResult>("japan-housing-area-recommendation", input.housing);
  const transport = await invoke<JapanTransportResult>("japan-transport-planner", input.transport);
  const food = await invoke<JapanFoodResult>("japan-local-food-guide", { locationName: input.plan.location, facts: input.catalog.foodFacts, sources: input.catalog.sources, now: input.now });
  const digital = await invoke<JapanDigitalResult>("japan-digital-life-setup", { items: input.catalog.items, sources: input.catalog.sources, now: input.now });
  const preparation = await invoke<JapanPreparationResult>("japan-arrival-preparation", { ...input.schedule, policy, references: digital, now: input.now });
  const supportingResults = [policy, weather, housing, transport, food, digital, preparation] as JapanSupportingResult[];
  const composite = await invoke<JapanArrivalPlanResult>("japan-arrival-plan", { planId: input.plan.id, planVersion: input.plan.version, supportingResults });
  const sourceEvidenceBySkill: Partial<Record<JapanSupportingSkillId, SourceEvidenceRef[]>> = {
    "japan-policy-applicability": evidence(policy.sources),
    "japan-local-food-guide": evidence(food.sources),
    "japan-digital-life-setup": evidence(digital.sources)
  };
  const proposal = createJapanPlanCompilationProposal({ composite, preparation, food, sourceEvidenceBySkill });
  if (proposal.status === "blocked") return { status: "blocked", reasonCode: proposal.reasonCode, message: proposal.message, supportingResults, composite, preparation };
  const compilation = compilePlanProposal(input.plan, proposal.proposal, new Date(input.now));
  if (compilation.status === "blocked") return { status: "blocked", reasonCode: compilation.reasonCode, message: compilation.message, supportingResults, composite, preparation };
  return { status: "compiled", supportingResults, composite, preparation, sourceEvidenceBySkill, compilation };
}
function evidence(sources: JapanEvidenceInput[]): SourceEvidenceRef[] { return sources.map((item) => ({ sourceSnapshotId: item.id, contentHash: item.contentHash })).filter((item, index, all) => all.findIndex((candidate) => candidate.sourceSnapshotId === item.sourceSnapshotId && candidate.contentHash === item.contentHash) === index); }
