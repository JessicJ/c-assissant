import type { SemanticValidationContext, ValidationFinding, ValidationReport } from "./semantic-validator.js";
import { validateSemanticTravelPlan } from "./semantic-validator.js";
import { parseSemanticTravelPlan, type SemanticTravelExperience, type SemanticTravelPlan } from "./index.js";

export type SemanticPlanRepairStatus = "not_required" | "repaired" | "repair_failed_validation";

export interface SemanticPlanRepairResult {
  status: SemanticPlanRepairStatus;
  originalReport: ValidationReport;
  repairFindings: ValidationFinding[];
  plannerInvoked: boolean;
  repairedPlan?: SemanticTravelPlan;
  repairedReport?: ValidationReport;
  decisionDiff?: SemanticPlanDecisionDiff;
}

export interface SemanticPlanRepairRequest {
  originalPlan: SemanticTravelPlan;
  originalReport: ValidationReport;
  repairFindings: ValidationFinding[];
  planningContext: string;
  prompt: string;
}

export type SemanticPlanRepairer = (request: SemanticPlanRepairRequest) => Promise<SemanticTravelPlan> | SemanticTravelPlan;
export type SemanticPlanValidator = (plan: SemanticTravelPlan, context: SemanticValidationContext) => ValidationReport;

export interface RunSemanticPlanRepairOptions {
  plan: SemanticTravelPlan;
  validationContext: SemanticValidationContext;
  planningContext: string;
  repairer: SemanticPlanRepairer;
  validate?: SemanticPlanValidator;
}

export interface SemanticPlanDecisionDiff {
  daysChanged: string[];
  experiencesAdded: Array<{ date: string; title: string; planRole: string }>;
  experiencesRemoved: Array<{ date: string; title: string; planRole: string }>;
  experiencesMoved: Array<{ title: string; fromDate: string; toDate: string }>;
  planRoleChanges: Array<{ date: string; title: string; from: string; to: string }>;
  startEndContextChanges: Array<{ date: string; field: "startContext" | "endContext"; from: string; to: string }>;
  baseStrategyChanged: boolean;
  meaningfulTravelDecisionDrift: boolean;
}

export async function runSemanticPlanRepairOnce(options: RunSemanticPlanRepairOptions): Promise<SemanticPlanRepairResult> {
  const validate = options.validate ?? validateSemanticTravelPlan;
  const originalReport = validate(options.plan, options.validationContext);
  const repairFindings = originalReport.findings.filter((finding) => finding.requiresPlannerRepair);
  if (originalReport.result !== "repair_required" || repairFindings.length === 0) {
    return { status: "not_required", originalReport, repairFindings, plannerInvoked: false };
  }

  const prompt = buildSemanticTravelPlanRepairPrompt({
    originalPlan: options.plan,
    originalReport,
    repairFindings,
    planningContext: options.planningContext
  });
  const repairedPlan = parseSemanticTravelPlan(JSON.stringify(await options.repairer({
    originalPlan: options.plan,
    originalReport,
    repairFindings,
    planningContext: options.planningContext,
    prompt
  })));
  const repairedReport = validate(repairedPlan, options.validationContext);
  const decisionDiff = diffSemanticTravelPlans(options.plan, repairedPlan);
  return {
    status: repairedReport.findings.some((finding) => finding.requiresPlannerRepair) ? "repair_failed_validation" : "repaired",
    originalReport,
    repairFindings,
    plannerInvoked: true,
    repairedPlan,
    repairedReport,
    decisionDiff
  };
}

export function buildSemanticTravelPlanRepairPrompt(input: Omit<SemanticPlanRepairRequest, "prompt">): string {
  return [
    "You are Planner V2.4 repairing one SemanticTravelPlan after deterministic validation.",
    "",
    "Return only JSON matching the existing SemanticTravelPlan schema. Do not return commentary.",
    "",
    "Repair objective:",
    "- Fix only the confirmed validation finding(s) marked requiresPlannerRepair=true.",
    "- PRESERVE EVERYTHING THAT IS NOT AFFECTED BY THE CONFIRMED CONFLICT.",
    "- Make the smallest coherent travel-planning change needed.",
    "",
    "Preserve where possible:",
    "- base strategy",
    "- unaffected days",
    "- confirmed bookings and hard commitments",
    "- user preferences",
    "- trip pace",
    "- accepted experiences",
    "- day start/end contexts",
    "- optional/replacement semantics",
    "- preparation, tips, exclusions, and research grounding",
    "",
    "Do not do these things:",
    "- Do not regenerate the whole vacation from scratch.",
    "- Do not change non-conflicting days just to improve style.",
    "- Do not use booking_requirement, access_recheck, unresolved_dependency, unknown weather, missing hotels, or stale future info as independent repair triggers.",
    "- Do not move confirmed hard commitments casually. If a hard commitment conflicts with another hard commitment, preserve the facts and make the least disruptive coherent adjustment, or leave the unresolved reality explicit.",
    "- Do not use destination-specific canned fixes or gold answers.",
    "",
    "Original planning context:",
    input.planningContext,
    "",
    "Repair-required validation findings:",
    JSON.stringify(input.repairFindings, null, 2),
    "",
    "Original SemanticTravelPlan:",
    JSON.stringify(input.originalPlan, null, 2)
  ].join("\n");
}

export function diffSemanticTravelPlans(original: SemanticTravelPlan, repaired: SemanticTravelPlan): SemanticPlanDecisionDiff {
  const originalDays = new Map(original.dailyItinerary.map((day) => [day.date, day] as const));
  const repairedDays = new Map(repaired.dailyItinerary.map((day) => [day.date, day] as const));
  const originalExperienceDates = experienceDateMap(original);
  const repairedExperienceDates = experienceDateMap(repaired);
  const daysChanged = new Set<string>();
  const experiencesAdded: SemanticPlanDecisionDiff["experiencesAdded"] = [];
  const experiencesRemoved: SemanticPlanDecisionDiff["experiencesRemoved"] = [];
  const experiencesMoved: SemanticPlanDecisionDiff["experiencesMoved"] = [];
  const planRoleChanges: SemanticPlanDecisionDiff["planRoleChanges"] = [];
  const startEndContextChanges: SemanticPlanDecisionDiff["startEndContextChanges"] = [];

  for (const [date, day] of originalDays) {
    const repairedDay = repairedDays.get(date);
    if (!repairedDay) {
      daysChanged.add(date);
      continue;
    }
    for (const field of ["startContext", "endContext"] as const) {
      const before = contextSignature(day[field]);
      const after = contextSignature(repairedDay[field]);
      if (before !== after) {
        daysChanged.add(date);
        startEndContextChanges.push({ date, field, from: before, to: after });
      }
    }
    const originalExperiences = new Map((day.experiences ?? []).map((experience) => [experience.title, experience] as const));
    const repairedExperiences = new Map((repairedDay.experiences ?? []).map((experience) => [experience.title, experience] as const));
    for (const [title, experience] of originalExperiences) {
      const repairedExperience = repairedExperiences.get(title);
      if (!repairedExperience) {
        daysChanged.add(date);
        experiencesRemoved.push({ date, title, planRole: experience.planRole });
        continue;
      }
      if (experience.planRole !== repairedExperience.planRole) {
        daysChanged.add(date);
        planRoleChanges.push({ date, title, from: experience.planRole, to: repairedExperience.planRole });
      }
    }
    for (const [title, experience] of repairedExperiences) {
      if (!originalExperiences.has(title)) {
        daysChanged.add(date);
        experiencesAdded.push({ date, title, planRole: experience.planRole });
      }
    }
  }
  for (const [date] of repairedDays) if (!originalDays.has(date)) daysChanged.add(date);
  for (const [title, fromDate] of originalExperienceDates) {
    const toDate = repairedExperienceDates.get(title);
    if (toDate && toDate !== fromDate) {
      daysChanged.add(fromDate);
      daysChanged.add(toDate);
      experiencesMoved.push({ title, fromDate, toDate });
    }
  }

  const baseStrategyChanged = baseStrategySignature(original) !== baseStrategySignature(repaired);
  return {
    daysChanged: [...daysChanged].sort(),
    experiencesAdded,
    experiencesRemoved,
    experiencesMoved,
    planRoleChanges,
    startEndContextChanges,
    baseStrategyChanged,
    meaningfulTravelDecisionDrift: daysChanged.size > 0 || baseStrategyChanged
  };
}

function experienceDateMap(plan: SemanticTravelPlan): Map<string, string> {
  const map = new Map<string, string>();
  for (const day of plan.dailyItinerary) {
    for (const experience of day.experiences ?? []) map.set(experience.title, day.date);
  }
  return map;
}

function baseStrategySignature(plan: SemanticTravelPlan): string {
  return plan.dailyItinerary.map((day) => `${day.date}:${contextSignature(day.startContext)}>${contextSignature(day.endContext)}`).join("|");
}

function contextSignature(context: SemanticTravelPlan["dailyItinerary"][number]["startContext"]): string {
  return `${context.label} (${context.status})`;
}

export function semanticExperience(title: string, planRole: SemanticTravelExperience["planRole"], summary: string, rest: Omit<SemanticTravelExperience, "title" | "planRole" | "summary"> = {}): SemanticTravelExperience {
  return { title, planRole, summary, ...rest };
}
