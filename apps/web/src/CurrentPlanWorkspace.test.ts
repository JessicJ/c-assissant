import assert from "node:assert/strict";
import test from "node:test";
import type { DirectBlueprintRevisionBatchMetadata, Plan, WorkspaceSnapshot } from "@c-assistant/core";
import { automaticRouteRefreshGate, automaticRouteRefreshKey, automaticRouteRefreshRequestForRevision, mapRouteRefreshHeaderText, routeRefreshCompletedStatus, routeRefreshSavedButUncheckedStatus, routeRefreshSavedButUncheckedText, routeRefreshStatusText, routeRefreshUncheckedStatus, routeRefreshWorkingStatus, routeRefreshWorkingText } from "./current-plan-route-refresh.js";
import type { ItineraryRouteRefreshDisplay } from "./landi-blueprint-workspace-display.js";

function workspace(): WorkspaceSnapshot {
  return {
    activePlan: ({
      id: "plan-1",
      version: 4,
      presentation: {
        kind: "itinerary",
        summary: "Tokyo day",
        days: [
          { id: "day-1", label: "October 4", date: "2026-10-04", shortLabel: "10/04", placeIds: ["a", "b", "c"] },
          { id: "day-2", label: "October 5", date: "2026-10-05", shortLabel: "10/05", placeIds: ["d", "e"] }
        ],
        places: [],
        routeSegments: [
          { id: "move-1", dayId: "day-1", originPlaceId: "a", destinationPlaceId: "b", mode: "walking", verification: "needs_verification", sourceRefs: [] },
          { id: "move-2", dayId: "day-1", originPlaceId: "b", destinationPlaceId: "c", mode: "walking", verification: "verified", sourceRefs: ["google_maps"] },
          { id: "move-3", dayId: "day-2", originPlaceId: "d", destinationPlaceId: "e", mode: "walking", verification: "needs_verification", sourceRefs: [] }
        ]
      }
    } as unknown as Plan),
    activeBlueprint: { version: 7 }
  } as unknown as WorkspaceSnapshot;
}

function revision(movementIds: string[]): DirectBlueprintRevisionBatchMetadata {
  return {
    routeRefresh: {
      dayIds: ["day-1"],
      movementIds,
      reason: "Affected routes need checking."
    }
  } as DirectBlueprintRevisionBatchMetadata;
}

const routeRefresh = {
  segmentCount: 2,
  segmentIds: ["move-3", "move-1"],
  dayLabel: "10/04",
  summary: "2 travel legs on 10/04 need checking.",
  request: "Check travel times for 10/04."
} satisfies ItineraryRouteRefreshDisplay;

test("automatic route refresh request follows direct edit metadata and current workspace versions", () => {
  assert.deepEqual(automaticRouteRefreshRequestForRevision(workspace(), revision(["move-1", "move-2", "move-1"])), {
    planId: "plan-1",
    dayLabel: "10/04",
    body: {
      expectedVersion: 4,
      expectedBlueprintVersion: 7,
      segmentIds: ["move-1"]
    }
  });
});

test("automatic route refresh request labels multi-day route checks with concrete days", () => {
  assert.deepEqual(automaticRouteRefreshRequestForRevision(workspace(), revision(["move-3", "move-1", "move-2", "move-3"])), {
    planId: "plan-1",
    dayLabel: "10/04 and 10/05",
    body: {
      expectedVersion: 4,
      expectedBlueprintVersion: 7,
      segmentIds: ["move-3", "move-1"]
    }
  });
});

test("automatic route refresh request is skipped when direct edits do not leave route legs to refresh", () => {
  assert.equal(automaticRouteRefreshRequestForRevision(workspace(), revision(["move-2"])), undefined);
  assert.equal(automaticRouteRefreshRequestForRevision(workspace(), revision([])), undefined);
});

test("automatic route refresh gate triggers once per plan version and route set", () => {
  const attempted = new Set<string>();
  const first = automaticRouteRefreshGate({
    planId: "plan-1",
    planVersion: 4,
    dayId: "day-1",
    routeRefresh,
    pendingEditCount: 0,
    routeRefreshBusy: false,
    canRequest: true
  }, attempted);
  assert.deepEqual(first, {
    key: automaticRouteRefreshKey("plan-1", 4, "day-1", ["move-3", "move-1"]),
    refresh: routeRefresh
  });
  attempted.add(first!.key);

  assert.equal(automaticRouteRefreshGate({
    planId: "plan-1",
    planVersion: 4,
    dayId: "day-1",
    routeRefresh,
    pendingEditCount: 0,
    routeRefreshBusy: false,
    canRequest: true
  }, attempted), undefined);

  assert.equal(automaticRouteRefreshGate({
    planId: "plan-1",
    planVersion: 5,
    dayId: "day-1",
    routeRefresh,
    pendingEditCount: 0,
    routeRefreshBusy: false,
    canRequest: true
  }, attempted)?.key, automaticRouteRefreshKey("plan-1", 5, "day-1", ["move-3", "move-1"]));
});

test("automatic route refresh gate waits for saved actionable route checks", () => {
  const attempted = new Set<string>();
  const base = {
    planId: "plan-1",
    planVersion: 4,
    dayId: "day-1",
    routeRefresh,
    pendingEditCount: 0,
    routeRefreshBusy: false,
    canRequest: true
  };

  assert.equal(automaticRouteRefreshGate({ ...base, routeRefresh: { ...routeRefresh, actionable: false } }, attempted), undefined);
  assert.equal(automaticRouteRefreshGate({ ...base, routeRefresh: { ...routeRefresh, segmentIds: [] } }, attempted), undefined);
  assert.equal(automaticRouteRefreshGate({ ...base, pendingEditCount: 1 }, attempted), undefined);
  assert.equal(automaticRouteRefreshGate({ ...base, routeRefreshBusy: true }, attempted), undefined);
  assert.equal(automaticRouteRefreshGate({ ...base, canRequest: false }, attempted), undefined);
});

test("map route refresh header text shows automatic progress without a manual button label", () => {
  assert.deepEqual(mapRouteRefreshHeaderText(routeRefresh, false), {
    title: "Travel times will be checked for 10/04",
    actionLabel: "Automatic check"
  });
  assert.deepEqual(mapRouteRefreshHeaderText(routeRefresh, true), {
    title: "Checking travel times for 10/04",
    actionLabel: "Checking now"
  });
  assert.deepEqual(mapRouteRefreshHeaderText({ ...routeRefresh, actionable: false }, false), {
    title: "Travel times will be checked",
    actionLabel: "After confirm"
  });
  assert.equal(/button|click|refresh|execution|replan/i.test(JSON.stringify([
    mapRouteRefreshHeaderText(routeRefresh, false),
    mapRouteRefreshHeaderText(routeRefresh, true),
    mapRouteRefreshHeaderText({ ...routeRefresh, actionable: false }, false)
  ])), false);
});

test("route checking feedback stays traveler-facing", () => {
  const messages = [
    routeRefreshWorkingText("10/04"),
    routeRefreshStatusText("10/04", {
      workspace: workspace(),
      routeRefresh: {
        segmentIds: ["move-1"],
        refreshedSegmentIds: ["move-1"],
        scheduleConflictDayIds: []
      }
    }),
    routeRefreshStatusText("10/04", {
      workspace: workspace(),
      routeRefresh: {
        segmentIds: ["move-1"],
        refreshedSegmentIds: ["move-1"],
        scheduleConflictDayIds: ["day-1"]
      }
    }),
    routeRefreshStatusText("10/04 and 10/05", {
      workspace: workspace(),
      routeRefresh: {
        segmentIds: ["move-1", "move-3"],
        refreshedSegmentIds: ["move-1"],
        scheduleConflictDayIds: []
      }
    }),
    routeRefreshStatusText("10/04 and 10/05", {
      workspace: workspace(),
      routeRefresh: {
        segmentIds: ["move-1", "move-2", "move-3"],
        refreshedSegmentIds: ["move-1"],
        failedSegmentIds: ["move-3", "move-3"],
        scheduleConflictDayIds: []
      }
    }),
    routeRefreshStatusText("10/04", {
      workspace: workspace(),
      routeRefresh: {
        segmentIds: ["move-1", "move-3"],
        refreshedSegmentIds: ["move-1"],
        failedSegmentIds: ["move-3"],
        scheduleConflictDayIds: ["day-1"]
      }
    }),
    routeRefreshStatusText("10/04", {
      workspace: workspace(),
      routeRefresh: {
        segmentIds: ["move-1", "move-3"],
        refreshedSegmentIds: [],
        failedSegmentIds: ["move-1", "move-3"],
        scheduleConflictDayIds: []
      }
    }),
    routeRefreshSavedButUncheckedText(),
    routeRefreshSavedButUncheckedText("10/04 and 10/05")
  ];

  assert.deepEqual(messages, [
    "Checking travel times for 10/04...",
    "Travel times checked for 10/04. The itinerary now shows updated travel times for 1 travel leg.",
    "Travel times checked for 10/04, but one day's timing still needs review.",
    "Travel times checked for 10/04 and 10/05. The itinerary now shows updated travel times for 1 travel leg; 1 travel leg still needs checking.",
    "Travel times checked for 10/04 and 10/05. The itinerary now shows updated travel times for 1 travel leg; 1 travel leg still needs checking.",
    "Travel times checked for 10/04, but one day's timing still needs review. 1 travel leg still needs checking.",
    "Travel times checked for 10/04, but no travel times were updated. 2 travel legs still need checking.",
    "The itinerary change was saved. Travel times could not be checked right now, so those legs will stay marked for checking.",
    "The itinerary change was saved. Travel times for 10/04 and 10/05 could not be checked right now, so those legs will stay marked for checking."
  ]);
  assert.equal(/\broute refresh\b|\bexecution\b|\breplan/i.test(messages.join("\n")), false);
});

test("route checking status feedback keeps saved plans out of the error path", () => {
  const completedPayload = {
    workspace: workspace(),
    routeRefresh: {
      segmentIds: ["move-1", "move-3"],
      refreshedSegmentIds: ["move-1"],
      failedSegmentIds: ["move-3"],
      scheduleConflictDayIds: []
    }
  };

  const statuses = [
    routeRefreshWorkingStatus("10/04"),
    routeRefreshCompletedStatus("10/04", completedPayload),
    routeRefreshSavedButUncheckedStatus("10/04"),
    routeRefreshUncheckedStatus("10/04")
  ];

  assert.deepEqual(statuses, [
    { tone: "working", text: "Checking travel times for 10/04..." },
    { tone: "success", text: "Travel times checked for 10/04. The itinerary now shows updated travel times for 1 travel leg; 1 travel leg still needs checking." },
    { tone: "success", text: "The itinerary change was saved. Travel times for 10/04 could not be checked right now, so those legs will stay marked for checking." },
    { tone: "success", text: "Travel times for 10/04 could not be checked right now. The itinerary stays saved, and those legs will stay marked for checking." }
  ]);
  assert.equal(statuses.some((status) => status.tone === "error"), false);
  assert.equal(/\broute refresh\b|\bexecution\b|\breplan/i.test(statuses.map((status) => status.text).join("\n")), false);
});
