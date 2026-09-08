import type { DirectBlueprintRevisionBatchMetadata, ItineraryDay, WorkspaceSnapshot } from "@c-assistant/core";
import type { PlanRouteRefreshRequest, PlanRouteRefreshResponse } from "./api-client.js";
import type { ItineraryRouteRefreshDisplay } from "./landi-blueprint-workspace-display.js";
import type { AgentStatus } from "./ui-types.js";

export type AutomaticRouteRefreshRequest = {
  planId: string;
  dayLabel: string;
  body: PlanRouteRefreshRequest;
};

export type AutomaticRouteRefreshGateInput = {
  planId: string;
  planVersion: number;
  dayId: string;
  routeRefresh?: ItineraryRouteRefreshDisplay | undefined;
  pendingEditCount: number;
  routeRefreshBusy: boolean;
  canRequest: boolean;
};

export type AutomaticRouteRefreshGateResult = {
  key: string;
  refresh: ItineraryRouteRefreshDisplay;
};

export type MapRouteRefreshHeaderText = {
  title: string;
  actionLabel: string;
};

export function automaticRouteRefreshRequestForRevision(workspace: WorkspaceSnapshot, revision: DirectBlueprintRevisionBatchMetadata): AutomaticRouteRefreshRequest | undefined {
  const presentation = workspace.activePlan.presentation;
  if (!presentation || presentation.kind !== "itinerary") return undefined;
  const requestedIds = [...new Set(revision.routeRefresh.movementIds)].filter(Boolean);
  if (!requestedIds.length) return undefined;
  const segmentById = new Map(presentation.routeSegments.map((segment) => [segment.id, segment] as const));
  const segmentIds = requestedIds.filter((segmentId) => segmentById.get(segmentId)?.verification !== "verified");
  if (!segmentIds.length) return undefined;
  const dayIds = [...new Set(segmentIds.flatMap((segmentId) => {
    const dayId = segmentById.get(segmentId)?.dayId;
    return dayId ? [dayId] : [];
  }))];
  const dayLabel = routeRefreshDayLabel(dayIds, presentation.days);
  return {
    planId: workspace.activePlan.id,
    dayLabel,
    body: {
      expectedVersion: workspace.activePlan.version,
      ...(workspace.activeBlueprint ? { expectedBlueprintVersion: workspace.activeBlueprint.version } : {}),
      segmentIds
    }
  };
}

export function automaticRouteRefreshKey(planId: string, planVersion: number, dayId: string, segmentIds: string[]): string {
  return `${planId}:${planVersion}:${dayId}:${[...segmentIds].sort().join("|")}`;
}

export function automaticRouteRefreshGate(input: AutomaticRouteRefreshGateInput, attemptedKeys: ReadonlySet<string>): AutomaticRouteRefreshGateResult | undefined {
  const refresh = input.routeRefresh;
  if (!refresh || refresh.actionable === false || !refresh.segmentIds.length || input.pendingEditCount || input.routeRefreshBusy || !input.canRequest) return undefined;
  const key = automaticRouteRefreshKey(input.planId, input.planVersion, input.dayId, refresh.segmentIds);
  if (attemptedKeys.has(key)) return undefined;
  return { key, refresh };
}

export function mapRouteRefreshHeaderText(routeRefresh: ItineraryRouteRefreshDisplay, routeRefreshBusy = false): MapRouteRefreshHeaderText {
  const pendingConfirmation = routeRefresh.actionable === false;
  if (routeRefreshBusy) {
    return {
      title: `Checking travel times for ${routeRefresh.dayLabel}`,
      actionLabel: "Checking now"
    };
  }
  return {
    title: pendingConfirmation ? "Travel times will be checked" : `Travel times will be checked for ${routeRefresh.dayLabel}`,
    actionLabel: pendingConfirmation ? "After confirm" : "Automatic check"
  };
}

function routeRefreshDayLabel(dayIds: string[], days: ItineraryDay[]): string {
  const orderedDayIds = new Set(dayIds);
  const labels = days
    .filter((day) => orderedDayIds.has(day.id))
    .map((day) => day.shortLabel ?? day.date ?? day.label)
    .filter((label): label is string => Boolean(label));
  if (labels.length === 1) return labels[0] ?? "this day";
  if (labels.length > 1) return naturalList(labels);
  if (dayIds.length === 1) return "this day";
  return `${dayIds.length} days`;
}

function naturalList(labels: string[]): string {
  if (labels.length <= 2) return labels.join(" and ");
  const last = labels[labels.length - 1];
  return `${labels.slice(0, -1).join(", ")}, and ${last ?? ""}`;
}

export function routeRefreshStatusText(dayLabel: string, payload: PlanRouteRefreshResponse): string {
  const refreshedCount = payload.routeRefresh.refreshedSegmentIds.length;
  const failedCount = routeRefreshFailedCount(payload);
  const conflictCount = payload.routeRefresh.scheduleConflictDayIds.length;
  if (conflictCount) {
    const routeCheckNote = failedCount ? ` ${travelLegCount(failedCount)} still ${failedCount === 1 ? "needs" : "need"} checking.` : "";
    return `Travel times checked for ${dayLabel}, but ${conflictCount === 1 ? "one day's timing still needs" : `${conflictCount} days still need`} review.${routeCheckNote}`;
  }
  if (!refreshedCount && failedCount) {
    return `Travel times checked for ${dayLabel}, but no travel times were updated. ${travelLegCount(failedCount)} still ${failedCount === 1 ? "needs" : "need"} checking.`;
  }
  if (failedCount) {
    return `Travel times checked for ${dayLabel}. The itinerary now shows updated travel times for ${travelLegCount(refreshedCount)}; ${travelLegCount(failedCount)} still ${failedCount === 1 ? "needs" : "need"} checking.`;
  }
  return `Travel times checked for ${dayLabel}. The itinerary now shows updated travel times${refreshedCount ? ` for ${travelLegCount(refreshedCount)}` : ""}.`;
}

function routeRefreshFailedCount(payload: PlanRouteRefreshResponse): number {
  if (payload.routeRefresh.failedSegmentIds) return new Set(payload.routeRefresh.failedSegmentIds).size;
  const requested = new Set(payload.routeRefresh.segmentIds);
  for (const segmentId of payload.routeRefresh.refreshedSegmentIds) requested.delete(segmentId);
  return requested.size;
}

function travelLegCount(count: number): string {
  return `${count} travel leg${count === 1 ? "" : "s"}`;
}

export function routeRefreshWorkingText(dayLabel: string): string {
  return `Checking travel times for ${dayLabel}...`;
}

export function routeRefreshWorkingStatus(dayLabel: string): AgentStatus {
  return { tone: "working", text: routeRefreshWorkingText(dayLabel) };
}

export function routeRefreshCompletedStatus(dayLabel: string, payload: PlanRouteRefreshResponse): AgentStatus {
  return { tone: "success", text: routeRefreshStatusText(dayLabel, payload) };
}

export function routeRefreshSavedButUncheckedText(dayLabel?: string): string {
  return dayLabel
    ? `The itinerary change was saved. Travel times for ${dayLabel} could not be checked right now, so those legs will stay marked for checking.`
    : "The itinerary change was saved. Travel times could not be checked right now, so those legs will stay marked for checking.";
}

export function routeRefreshSavedButUncheckedStatus(dayLabel?: string): AgentStatus {
  return { tone: "success", text: routeRefreshSavedButUncheckedText(dayLabel) };
}

export function routeRefreshUncheckedStatus(dayLabel?: string): AgentStatus {
  const dayText = dayLabel ? ` for ${dayLabel}` : "";
  return {
    tone: "success",
    text: `Travel times${dayText} could not be checked right now. The itinerary stays saved, and those legs will stay marked for checking.`
  };
}
