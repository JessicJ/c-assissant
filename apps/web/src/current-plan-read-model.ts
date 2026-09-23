import type { Plan, PlanPresentation, TripBlueprint } from "@c-assistant/core";
import { blueprintPresentation } from "./blueprint-presentation.js";

export type CurrentPlanPresentationSource = "blueprint" | "plan" | "none";

export type CurrentPlanReadModel = {
  plan: Plan;
  presentation?: PlanPresentation;
  presentationSource: CurrentPlanPresentationSource;
  presentationVersion: number;
  presentationKey: string;
  workspaceKey: string;
  mutationVersion: CurrentPlanMutationVersion;
};

export type CurrentPlanMutationVersion = {
  expectedVersion: number;
  expectedBlueprintVersion?: number;
};

export function currentPlanReadModel(plan: Plan, blueprint?: TripBlueprint): CurrentPlanReadModel {
  if (blueprint) {
    const presentation = blueprintPresentation(blueprint);
    return {
      plan: { ...plan, presentation },
      presentation,
      presentationSource: "blueprint",
      presentationVersion: blueprint.version,
      presentationKey: `blueprint:${blueprint.id}:${blueprint.version}`,
      workspaceKey: `plan:${plan.id}`,
      mutationVersion: { expectedVersion: plan.version, expectedBlueprintVersion: blueprint.version }
    };
  }
  if (plan.presentation) {
    return {
      plan,
      presentation: plan.presentation,
      presentationSource: "plan",
      presentationVersion: plan.version,
      presentationKey: `plan:${plan.id}:${plan.version}`,
      workspaceKey: `plan:${plan.id}`,
      mutationVersion: { expectedVersion: plan.version }
    };
  }
  return {
    plan,
    presentationSource: "none",
    presentationVersion: plan.version,
    presentationKey: `none:${plan.id}:${plan.version}`,
    workspaceKey: `plan:${plan.id}`,
    mutationVersion: { expectedVersion: plan.version }
  };
}
