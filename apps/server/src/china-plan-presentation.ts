import type { WorkspaceSnapshot } from "@c-assistant/core";
import type { ChinaPlanWorkflowResult } from "./china-plan-workflow.js";

export type ChinaPlanPreparationResponse =
  | {
    status: "saved";
    message: string;
    workspace: WorkspaceSnapshot;
    taskCount: number;
    reminderCount: number;
    sources: ChinaPlanWorkflowResult["sources"];
  }
  | {
    status: "blocked";
    stage: "source_preparation" | "compilation";
    reasonCode: string;
    message: string;
    actionItems: string[];
    sources: ChinaPlanWorkflowResult["sources"];
  };

/** Converts internal orchestration details into one safe response shared by Web and Telegram. */
export function presentChinaPlanPreparation(result: ChinaPlanWorkflowResult): ChinaPlanPreparationResponse {
  if (result.status === "saved") {
    return {
      status: "saved",
      message: "The China Pack prepared a new complete draft. Review every stage and reminder before confirming it.",
      workspace: result.compilation.workspace,
      taskCount: result.compilation.taskCount,
      reminderCount: result.compilation.reminderCount,
      sources: result.sources
    };
  }

  return {
    status: "blocked",
    stage: result.stage,
    reasonCode: result.reasonCode,
    message: result.message,
    actionItems: collectActionItems(result),
    sources: result.sources
  };
}

function collectActionItems(result: Extract<ChinaPlanWorkflowResult, { status: "blocked" }>): string[] {
  if (result.stage === "source_preparation") {
    if (result.reasonCode === "critical_source_unavailable") return ["Try again when the official National Immigration Administration source is reachable."];
    if (result.reasonCode === "plan_changed") return ["Review the current draft, then prepare it again."];
    return ["Open the current draft Plan and try the preparation again."];
  }

  const values: string[] = [];
  for (const supporting of result.compilation?.orchestration?.supportingResults ?? []) {
    const needsInput = (supporting as { needsInput?: unknown }).needsInput;
    const items = Array.isArray(needsInput) ? needsInput : needsInput && typeof needsInput === "object" ? [needsInput] : [];
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      const field = stringValue(item, "field");
      const reason = stringValue(item, "reason");
      const label = stringValue(item, "label") || friendlyField(field);
      const sentence = reason ? `${label}: ${reason}` : label;
      if (sentence && !values.includes(sentence)) values.push(sentence);
    }
  }
  if (values.length) return values.slice(0, 8);
  if (result.reasonCode === "fact_collection_failed") return ["Check the Amap and QWeather configuration, then try again."];
  if (result.reasonCode === "plan_changed") return ["Review the newest draft, then prepare it again."];
  return ["Review the current Profile and Plan details, correct anything missing, then try again."];
}

function stringValue(value: object, key: string): string {
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "string" ? candidate.trim() : "";
}

function friendlyField(field: string): string {
  const labels: Record<string, string> = {
    partySize: "Party size",
    centreName: "Main destination",
    routeFacts: "Accommodation and route",
    "profile.nationality": "Nationality",
    "profile.immigrationStatus": "China visa or residence status",
    "plan.location": "Plan destination",
    "plan.dates": "Plan dates",
    "schedule.departureAt": "Departure time",
    "schedule.arrivalAt": "Arrival time"
  };
  return labels[field] ?? (field || "Required detail");
}
