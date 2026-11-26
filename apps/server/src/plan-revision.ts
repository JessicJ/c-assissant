import type { GeneratedPlanDraft, Plan } from "@c-assistant/core";

export function planDraftForRevision(plan: Plan): GeneratedPlanDraft {
  return {
    title: plan.title,
    location: plan.location,
    dates: plan.dates,
    knownInformation: [...plan.knownInformation],
    assumptions: [...plan.assumptions],
    nextAction: plan.nextAction,
    ...(plan.presentation ? { presentation: structuredClone(plan.presentation) } : {}),
    stages: plan.stages.map((stage) => ({
      title: stage.title,
      description: stage.description,
      tasks: stage.tasks.map((task) => ({
        title: task.title,
        ...(task.description ? { description: task.description } : {}),
        owner: task.owner,
        dueLabel: task.dueLabel,
        ...(task.activationTrigger ? { activationTrigger: task.activationTrigger } : {}),
        ...(task.reminder ? { reminder: task.reminder } : {})
      }))
    }))
  };
}

export function completedTasksForRevision(plan: Plan): Array<{ stageTitle: string; title: string; dueLabel: string }> {
  return plan.stages.flatMap((stage) => stage.tasks
    .filter((task) => task.status === "completed")
    .map((task) => ({ stageTitle: stage.title, title: task.title, dueLabel: task.dueLabel })));
}
