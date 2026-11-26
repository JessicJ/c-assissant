import { test } from './evidence-test';
import { TRIP_BLUEPRINT_SCHEMA_VERSION, assertTripBlueprintIntegrity, compileTripBlueprint } from '../../packages/core/lib/index.js';
import { bookingRelationshipReviewContext, stampReviewedBookingRelationshipAssessment } from '../../packages/core/lib/booking-relationship.js';
import { expect } from "@playwright/test";

type EditableFixture = {
  activePlan: {
    id: string; version: number; title: string; createdAt: string;
    presentation: {
      summary: string; language: string; startDate: string; endDate: string; cities: string[];
      places: { id: string }[];
      days: { id: string; city: string; shortLabel: string; stops: unknown[]; candidates?: string[] }[];
      travelTips?: unknown[];
      routeSegments: { dayId: string; verification: string }[];
    };
  };
};

function editableWorkspace<T extends EditableFixture>(workspace: T, blueprintVersion = workspace.activePlan.version) {
  const { activePlan: plan } = workspace;
  const p = plan.presentation;
  return {
    ...workspace,
    destinationArrivals: [],
    sourceSnapshots: [],
    system: { core: "ready", storage: "local", runtime: "configured" },
    activeBlueprint: {
      schemaVersion: 1, id: `blueprint-${plan.id}`, version: blueprintVersion,
      generationKey: `generation-${plan.id}`,
      proposalRef: { sessionId: `session-${plan.id}`, proposalVersion: 1 },
      skillLineage: { skillId: "interactive-trip-planner", skillVersion: "0.2.0" },
      researchSetId: `research-${plan.id}`,
      title: plan.title, summary: p.summary, language: p.language, destinations: p.cities,
      startDate: p.startDate, endDate: p.endDate, createdAt: plan.createdAt,
      sources: [], events: [], actionRequirements: [], travelTips: p.travelTips ?? [],
      places: p.places.map((place) => ({ ...place, evidence: [] })),
      days: p.days.map((day) => ({ ...day, kind: "scheduled", date: `${p.startDate.slice(0, 4)}-${day.shortLabel.replace("/", "-")}`, candidatePlaceIds: day.candidates ?? [] })),
      movements: p.routeSegments.map((segment) => ({ ...segment, status: segment.verification === "verified" ? "verified" : "recheck", evidence: [] }))
    }
  };
}

// Simulate the public success receipt for the captured batch. The SQLite
// fixture tests separately establish the real transaction and undo behavior.
function revisionReceipt(
  before: EditableFixture,
  after: EditableFixture,
  body: { expectedBlueprintVersion: number; revisions: { kind: string; dayId: string; placeId: string }[] },
  routeRefresh: { dayIds: string[]; movementIds: string[]; reason: string }
) {
  const previous = editableWorkspace(before, body.expectedBlueprintVersion).activeBlueprint;
  const current = editableWorkspace(after).activeBlueprint;
  const affectedDayIds = [...new Set(body.revisions.map((edit) => edit.dayId))];
  const affectedPlaceIds = [...new Set(body.revisions.map((edit) => edit.placeId))];
  const createdAt = "2026-08-17T00:00:01.000Z";
  const id = `direct-revision-batch-${previous.id}-v${previous.version}-to-v${current.version}`;
  return {
    id, createdAt, baseBlueprintVersion: previous.version, appliedBlueprintVersion: current.version,
    kinds: [...new Set(body.revisions.map((edit) => edit.kind))],
    revisionCount: body.revisions.length, affectedDayIds, affectedPlaceIds, routeRefresh,
    undo: {
      previousBlueprintVersion: previous.version,
      previousDays: previous.days.filter((day) => affectedDayIds.includes(day.id)),
      previousMovements: previous.movements.filter((movement) => affectedDayIds.includes(movement.dayId)),
      previousPlaces: []
    },
    revisions: body.revisions.map((edit, index) => ({
      id: `${id}-${index + 1}`, kind: edit.kind, createdAt,
      baseBlueprintVersion: previous.version, appliedBlueprintVersion: current.version,
      affectedDayIds: [edit.dayId], affectedPlaceIds: [edit.placeId], routeRefresh,
      undo: { dayId: edit.dayId, previousDay: previous.days.find((day) => day.id === edit.dayId), previousMovements: previous.movements.filter((movement) => movement.dayId === edit.dayId) }
    }))
  };
}

const WORKSPACE_STARTUP_REQUESTS = 4;

test("current workspace opens when auxiliary workspace details fail to refresh", async ({ page }) => {
  const starter = {
    id: "incomplete-trip", version: 1, title: "Paris proposal trip", location: "Paris", dates: "2026-10-06 to 2026-10-17", status: "draft",
    knownInformation: ["Dates and flights confirmed"], assumptions: [], nextAction: "Generate the itinerary.", createdAt: "2026-08-19T00:00:00.000Z",
    configuration: { accommodation: { status: "not_set" }, arrival: {}, transport: { preference: "taxi" }, travelContext: { partySize: 2 } },
    stages: [{ id: "trip", title: "Trip", description: "Paris trip", status: "not_started", presentationKind: "itinerary", tasks: [] }], sources: [],
    presentation: { kind: "timeline", summary: "Paris trip", items: [] }
  };
  const workspace = { profile: { status: "ready", displayName: "Tester", preferredLanguage: "English", nationality: "United States", gender: "prefer_not_to_say", immigrationStatus: "short_term_visitor" }, runtime: { selectedKind: "codex" }, inbox: [], destinationArrivals: [], activePlan: starter };
  await page.route("**/api/workspace", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(workspace) }));
  await page.route("**/api/plans/history", (route) => route.abort("failed"));
  await page.route("**/api/configuration", (route) => route.abort("failed"));
  await page.route("**/api/runtimes", (route) => route.abort("failed"));

  await page.goto("/");

  await expect(page.getByRole("button", { name: "Create mapped itinerary" })).toBeVisible();
  await expect(page.locator(".loading-screen.error-screen")).toHaveCount(0);
  await expect(page.locator(".inline-alert")).toContainText("The operation could not be completed");
});

test("workspace load can recover from a temporary core service failure", async ({ page }) => {
  const starter = {
    id: "incomplete-trip", version: 1, title: "Paris proposal trip", location: "Paris", dates: "2026-10-06 to 2026-10-17", status: "draft",
    knownInformation: ["Dates and flights confirmed"], assumptions: [], nextAction: "Generate the itinerary.", createdAt: "2026-08-19T00:00:00.000Z",
    configuration: { accommodation: { status: "not_set" }, arrival: {}, transport: { preference: "taxi" }, travelContext: { partySize: 2 } },
    stages: [{ id: "trip", title: "Trip", description: "Paris trip", status: "not_started", presentationKind: "itinerary", tasks: [] }], sources: [],
    presentation: { kind: "timeline", summary: "Paris trip", items: [] }
  };
  const workspace = { profile: { status: "ready", displayName: "Tester", preferredLanguage: "English", nationality: "United States", gender: "prefer_not_to_say", immigrationStatus: "short_term_visitor" }, runtime: { selectedKind: "codex" }, inbox: [], destinationArrivals: [], activePlan: starter };
  let workspaceRequests = 0;
  await page.route("**/api/workspace", (route) => {
    workspaceRequests += 1;
    if (workspaceRequests === 1) return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "The local workspace is not initialized." }) });
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(workspace) });
  });
  await page.route("**/api/plans/history", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/api/configuration", (route) => route.fulfill({ contentType: "application/json", body: "{}" }));
  await page.route("**/api/runtimes", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));

  await page.goto("/");

  await expect(page.locator(".loading-screen.error-screen")).toContainText("The operation could not be completed");
  await expect(page.locator(".loading-screen.error-screen")).not.toContainText("The local workspace is not initialized.");
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("button", { name: "Create mapped itinerary" })).toBeVisible();
  await expect(page.locator(".loading-screen.error-screen")).toHaveCount(0);
});

test("workspace load explains and recovers when the core service is unreachable", async ({ page }) => {
  const starter = {
    id: "incomplete-trip", version: 1, title: "Paris proposal trip", location: "Paris", dates: "2026-10-06 to 2026-10-17", status: "draft",
    knownInformation: ["Dates and flights confirmed"], assumptions: [], nextAction: "Generate the itinerary.", createdAt: "2026-08-19T00:00:00.000Z",
    configuration: { accommodation: { status: "not_set" }, arrival: {}, transport: { preference: "taxi" }, travelContext: { partySize: 2 } },
    stages: [{ id: "trip", title: "Trip", description: "Paris trip", status: "not_started", presentationKind: "itinerary", tasks: [] }], sources: [],
    presentation: { kind: "timeline", summary: "Paris trip", items: [] }
  };
  const workspace = { profile: { status: "ready", displayName: "Tester", preferredLanguage: "English", nationality: "United States", gender: "prefer_not_to_say", immigrationStatus: "short_term_visitor" }, runtime: { selectedKind: "codex" }, inbox: [], destinationArrivals: [], activePlan: starter };
  let workspaceRequests = 0;
  await page.route("**/api/workspace", (route) => {
    workspaceRequests += 1;
    if (workspaceRequests === 1) return route.abort("failed");
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(workspace) });
  });
  await page.route("**/api/plans/history", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/api/configuration", (route) => route.fulfill({ contentType: "application/json", body: "{}" }));
  await page.route("**/api/runtimes", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));

  await page.goto("/");

  await expect(page.locator(".loading-screen.error-screen")).toContainText("The operation could not be completed");
  await expect(page.locator(".loading-screen.error-screen")).toContainText("Retrying automatically…");
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("button", { name: "Create mapped itinerary" })).toBeVisible();
  await expect(page.locator(".loading-screen.error-screen")).toHaveCount(0);
});

test("workspace load automatically recovers after a short core service startup delay", async ({ page }) => {
  const starter = {
    id: "incomplete-trip", version: 1, title: "Paris proposal trip", location: "Paris", dates: "2026-10-06 to 2026-10-17", status: "draft",
    knownInformation: ["Dates and flights confirmed"], assumptions: [], nextAction: "Generate the itinerary.", createdAt: "2026-08-19T00:00:00.000Z",
    configuration: { accommodation: { status: "not_set" }, arrival: {}, transport: { preference: "taxi" }, travelContext: { partySize: 2 } },
    stages: [{ id: "trip", title: "Trip", description: "Paris trip", status: "not_started", presentationKind: "itinerary", tasks: [] }], sources: [],
    presentation: { kind: "timeline", summary: "Paris trip", items: [] }
  };
  const workspace = { profile: { status: "ready", displayName: "Tester", preferredLanguage: "English", nationality: "United States", gender: "prefer_not_to_say", immigrationStatus: "short_term_visitor" }, runtime: { selectedKind: "codex" }, inbox: [], destinationArrivals: [], activePlan: starter };
  let workspaceRequests = 0;
  await page.route("**/api/workspace", (route) => {
    workspaceRequests += 1;
    if (workspaceRequests === 1) return route.abort("failed");
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(workspace) });
  });
  await page.route("**/api/plans/history", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/api/configuration", (route) => route.fulfill({ contentType: "application/json", body: "{}" }));
  await page.route("**/api/runtimes", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));

  await page.goto("/");

  await expect(page.locator(".loading-screen.error-screen")).toContainText("The operation could not be completed");
  await expect(page.locator(".loading-screen.error-screen")).toContainText("Retrying automatically…");
  await expect(page.getByRole("button", { name: "Create mapped itinerary" })).toBeVisible();
  expect(workspaceRequests).toBeGreaterThan(1);
});

test("workspace load stops automatic startup retries after a bounded window", async ({ page }) => {
  let workspaceRequests = 0;
  await page.route("**/api/workspace", (route) => {
    workspaceRequests += 1;
    return route.abort("failed");
  });

  await page.goto("/");

  await expect(page.locator(".loading-screen.error-screen")).toContainText("Retrying automatically…");
  await expect(page.locator(".loading-screen.error-screen")).toContainText("Automatic retry paused.", { timeout: 8_000 });
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  expect(workspaceRequests).toBe(WORKSPACE_STARTUP_REQUESTS);
});

test("an incomplete travel draft has direct retry and inline discard recovery", async ({ page }) => {
  const starter = {
    id: "incomplete-trip", version: 1, title: "Paris proposal trip", location: "Paris", dates: "2026-10-06 to 2026-10-17", status: "draft",
    knownInformation: ["Dates and flights confirmed"], assumptions: [], nextAction: "Generate the itinerary.", createdAt: "2026-08-19T00:00:00.000Z",
    configuration: { accommodation: { status: "not_set" }, arrival: {}, transport: { preference: "taxi" }, travelContext: { partySize: 2 } },
    stages: [{ id: "trip", title: "Trip", description: "Paris trip", status: "not_started", presentationKind: "itinerary", tasks: [] }], sources: [],
    presentation: { kind: "timeline", summary: "Paris trip", items: [] }
  };
  const workspace = { profile: { status: "ready", displayName: "Tester", preferredLanguage: "简体中文", nationality: "United States", gender: "prefer_not_to_say", immigrationStatus: "short_term_visitor" }, runtime: { selectedKind: "codex" }, inbox: [], destinationArrivals: [], activePlan: starter };
  await page.route("**/api/workspace", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(workspace) }));
  await page.route("**/api/plans/history", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/api/configuration", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ amap: { configured: false }, qweather: { configured: false, host: "" }, telegram: { configured: false } }) }));
  await page.route("**/api/runtimes", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/api/agent/chat", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 120));
    await route.fulfill({ status: 504, contentType: "application/json", body: JSON.stringify({ error: "生成超时，请再次尝试。" }) });
  });

  await page.goto("/");
  await expect(page.getByRole("button", { name: "Create mapped itinerary" })).toBeVisible();
  await page.getByRole("button", { name: "Create mapped itinerary" }).click();
  await expect(page.getByRole("button", { name: "Creating itinerary…" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Create Plan" })).toBeDisabled();
  await expect(page.getByText("The operation could not be completed. Keep your draft and check the result before trying again.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Generate again" })).toBeEnabled();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.getByRole("button", { name: "Discard this plan" }).click();
  await expect(page.getByRole("button", { name: "Keep plan" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirm discard" })).toBeVisible();
  await page.getByRole("button", { name: "Keep plan" }).click();
  await expect(page.getByRole("button", { name: "Discard this plan" })).toBeVisible();
});

test("Plan History hides an open planning conversation and Plan restores it", async ({ page }) => {
  const starter = {
    id: "starter", version: 1, title: "Attend an exhibition in Shanghai", location: "Shanghai", dates: "To be confirmed", status: "draft",
    knownInformation: [], assumptions: [], nextAction: "Create a plan.", createdAt: "2026-08-25T00:00:00.000Z",
    configuration: { accommodation: { status: "not_set" } }, stages: [], sources: []
  };
  const planningSession = { id: "history-session", status: "collecting", objectiveType: "travel", messages: [{ id: "message-1", role: "user", text: "I want to visit Tokyo", createdAt: "2026-08-25T00:00:00.000Z" }], facts: [], unresolved: [], deferred: [], createdAt: "2026-08-25T00:00:00.000Z", updatedAt: "2026-08-25T00:00:00.000Z" };
  const workspace = { profile: { status: "ready", displayName: "Tester", preferredLanguage: "English", nationality: "United States", gender: "prefer_not_to_say", immigrationStatus: "no_visa" }, runtime: { selectedKind: "codex" }, inbox: [], destinationArrivals: [], activePlan: starter, planningSession };
  await page.route("**/api/workspace", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(workspace) }));
  await page.route("**/api/plans/history", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/api/configuration", (route) => route.fulfill({ contentType: "application/json", body: "{}" }));
  await page.route("**/api/runtimes", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));

  await page.goto("/");
  const conversation = page.locator(".planning-session-panel .conversation");
  await expect(conversation).toBeVisible();

  await page.getByRole("button", { name: "Plan History", exact: true }).click();
  await expect(page.getByRole("heading", { name: "No archived plans yet" })).toBeVisible();
  await expect(conversation).toHaveCount(0);

  await page.getByRole("button", { name: "Plan", exact: true }).click();
  await expect(conversation).toBeVisible();
});

test("current itinerary renders the linked Trip Blueprint over a stale Plan presentation", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const workspace = {
    profile: { status: "ready", displayName: "Trip tester", preferredLanguage: "English", nationality: "Singapore", gender: "prefer_not_to_say", immigrationStatus: "short_term_visitor" },
    runtime: { selectedKind: "codex" },
    inbox: [],
    activeBlueprint: {
      schemaVersion: 1,
      id: "blueprint-source",
      version: 2,
      generationKey: "generation-source",
      proposalRef: { sessionId: "session-source", proposalVersion: 1 },
      skillLineage: { skillId: "interactive-trip-planner", skillVersion: "0.2.0" },
      researchSetId: "research-source",
      title: "Blueprint Tokyo",
      summary: "Blueprint should win.",
      language: "en",
      destinations: ["Tokyo"],
      startDate: "2026-10-04",
      endDate: "2026-10-04",
      sources: [],
      places: [
        { id: "museum", name: "Blueprint Museum", locationLabel: "Tokyo", city: "Tokyo", category: "museum", priority: "must", coordinates: [35.681, 139.797], whyWorthIt: "Fresh Blueprint anchor.", plan: "Visit first.", durationMinutes: 60, evidence: [] },
        { id: "cafe", name: "Blueprint Cafe", locationLabel: "Tokyo", city: "Tokyo", category: "coffee cafe", priority: "preferred", coordinates: [35.683, 139.799], whyWorthIt: "Fresh Blueprint break.", plan: "Use as a pause.", durationMinutes: 45, evidence: [] }
      ],
      events: [],
      days: [{ id: "day-1", date: "2026-10-04", kind: "scheduled", city: "Tokyo", title: "Fresh day", summary: "Use the Blueprint schedule.", stops: [{ placeId: "museum", order: 1, time: "09:00" }, { placeId: "cafe", order: 2, time: "11:00" }], candidatePlaceIds: [] }],
      movements: [{ id: "movement-1", dayId: "day-1", originPlaceId: "museum", destinationPlaceId: "cafe", mode: "walking", status: "recheck", label: "Route needs refresh", detail: "Refresh this movement before execution.", evidence: [] }],
      actionRequirements: [],
      createdAt: "2026-08-26T00:00:00.000Z"
    },
    activePlan: {
      id: "plan-source", version: 3, title: "Plan with stale presentation", location: "Tokyo", dates: "2026-10-04", status: "draft", knownInformation: [], assumptions: [], nextAction: "Review.", createdAt: "2026-08-26T00:00:00.000Z",
      configuration: { accommodation: { status: "not_set" }, arrival: {}, transport: { preference: "plan_recommended" }, travelContext: { partySize: 2 } },
      stages: [{ id: "itinerary", title: "Itinerary", description: "Mapped day.", status: "not_started", presentationKind: "itinerary", tasks: [] }],
      sources: [],
      presentation: {
        kind: "itinerary",
        summary: "stale stored presentation",
        startDate: "2026-10-04",
        endDate: "2026-10-04",
        cities: ["Tokyo"],
        days: [{ id: "stale-day", label: "Stale day", shortLabel: "10/04", city: "Tokyo", title: "Stale day", summary: "Do not render this.", placeIds: ["stale"], stops: [{ placeId: "stale", order: 1, time: "08:00" }] }],
        places: [{ id: "stale", name: "Stale Museum", locationLabel: "Tokyo", city: "Tokyo", category: "museum", priority: "preferred", coordinates: [35.68, 139.76], whyWorthIt: "Old adapter data.", plan: "Do not show.", durationMinutes: 30, detailSections: [], sourceRefs: [] }],
        routeSegments: []
      }
    }
  };
  await page.route("**/api/workspace", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(workspace) }));
  await page.route("**/api/plans/history", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/api/configuration", (route) => route.fulfill({ contentType: "application/json", body: "{}" }));
  await page.route("**/api/runtimes", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/api/agent/chat", (route) => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Agent route should not be used." }) }));

  await page.goto("/");
  await expect(page.getByLabel("Landi Blueprint workspace")).toBeVisible();
  await expect(page.locator(".blueprint-timeline-list .blueprint-itinerary-block")).toHaveText([
    /09:00.*Blueprint Museum/s,
    /11:00.*Blueprint Cafe/s
  ]);
  await expect(page.getByText("Stale Museum")).toHaveCount(0);
  await expect(page.getByLabel("Itinerary map context").getByRole("button", { name: "Blueprint Museum" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh routes" })).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});

test("Blueprint workspace renders unlinked themes and fixed booking constraints deterministically", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const presentation = {
    kind: "itinerary",
    summary: "Kyoto trip",
    language: "en",
    startDate: "2026-10-01",
    endDate: "2026-10-01",
    sourceCatalog: [{ id: "guide", title: "Kyoto guide", authority: "Visitor bureau", url: "https://guide.example", retrievedAt: "2026-09-01", status: "verified" }],
    places: [
      { id: "temple", name: "Morning Temple", locationLabel: "Kyoto", city: "Kyoto", category: "temple", priority: "must", coordinates: [35.01, 135.77], whyWorthIt: "A calm architectural anchor.", plan: "Visit in the morning.", detailSections: [], sourceRefs: [] },
      { id: "fado", name: "Fado night", locationLabel: "Fado hall, Kyoto", city: "Kyoto", category: "evening experience", priority: "preferred", coordinates: [35.02, 135.78], whyWorthIt: "A booked evening cultural stop.", plan: "Use the fixed booking time.", detailSections: [], sourceRefs: [] }
    ],
    days: [{
      id: "day-1",
      label: "October 1",
      date: "2026-10-01",
      shortLabel: "10/01",
      city: "Kyoto",
      title: "Kyoto day",
      summary: "Morning temple and evening event.",
      placeIds: ["temple", "fado"],
      stops: [{ placeId: "temple", order: 1, time: "09:00" }, { placeId: "fado", order: 2, time: "20:00" }],
      blocks: [
        { id: "block-temple", kind: "stop", order: 1, placeId: "temple", startTime: "09:00", title: "Morning temple", evidence: [{ sourceId: "guide", status: "verified", supports: ["morning order"] }] },
        { id: "block-fado", kind: "event", order: 2, placeId: "fado", startTime: "20:00", title: "Fado night", evidence: [] }
      ]
    }],
    bookingConstraints: [{
      id: "booking-fado",
      type: "event",
      title: "Fado night",
      status: "confirmed",
      sourceLabel: "Email",
      importedAt: "2026-09-01T00:00:00.000Z",
      constraintStrength: "hard",
      segments: [{ id: "segment-fado", segmentType: "event_window", title: "Fado night", startAtLocal: "2026-10-01T20:00", startTimeZone: "Asia/Tokyo", location: "Fado hall, Kyoto", constraintStrength: "hard", fixedCommitment: true, needsReviewReasons: [] }]
    }],
    localFoods: [{ id: "food-seasonal", title: "Seasonal sweets", description: "Look for small seasonal sweets in neighborhood cafes.", context: "Use this as food background rather than a destination.", diningPlaceIds: [], evidence: [{ sourceId: "guide", status: "verified", supports: ["seasonal sweets"] }] }],
    localProducts: [],
    experienceThemes: [{ id: "experience-tea", title: "Tea practice", description: "Tea practice is worth understanding before choosing a concrete venue.", context: "Add a venue only after Landi has a specific place.", offeringPlaceIds: [], evidence: [] }],
    routeSegments: []
  };
  // 合成真实结构的预订来源与明确关系，验证保护不依赖同名猜测。
  const now = '2026-09-01T00:00:00.000Z';
  const blueprint: any = {
    schemaVersion: TRIP_BLUEPRINT_SCHEMA_VERSION, id: 'topics-blueprint', version: 1,
    generationKey: 'topics-generation', proposalRef: { sessionId: 'topics-session', proposalVersion: 1 },
    skillLineage: { skillId: 'landi', skillVersion: '1' }, researchSetId: 'topics-research',
    title: 'Kyoto Blueprint', summary: presentation.summary, language: presentation.language,
    destinations: ['Kyoto'], startDate: presentation.startDate, endDate: presentation.endDate, createdAt: now,
    places: presentation.places.map(place => ({ ...place, evidence: [] })),
    days: presentation.days.map(day => ({ ...day, kind: 'scheduled', candidatePlaceIds: [], blocks: day.blocks.map(block => block.id === 'block-fado' ? { ...block, display: { routeAnchor: true, reorderable: true } } : block) })),
    sources: presentation.sourceCatalog, events: [], actionRequirements: [],
    movements: [{ id: 'topics-movement', dayId: 'day-1', originPlaceId: 'temple', destinationPlaceId: 'fado', mode: 'unknown', status: 'recheck', evidence: [] }],
    localFoods: presentation.localFoods, localProducts: presentation.localProducts, experienceThemes: presentation.experienceThemes,
    bookingConstraints: [{ ...presentation.bookingConstraints[0], sourceBookingId: 'fictional-source', title: '虚构异名凭证', segments: [{ ...presentation.bookingConstraints[0].segments[0], sourceSegmentId: 'fictional-segment', status: 'confirmed', title: '虚构异名场次', location: '虚构异名地点' }] }]
  };
  assertTripBlueprintIntegrity(blueprint);
  const context = bookingRelationshipReviewContext(blueprint);
  blueprint.bookingRelationshipAssessment = stampReviewedBookingRelationshipAssessment(blueprint, {
    schemaVersion: 1, blueprintId: blueprint.id, blueprintVersion: blueprint.version, universeDigest: context.universeDigest, status: 'reviewed',
    units: context.units.map(unit => ({ ...unit, coverage: 'complete', relations: [{ id: 'topics-fixed-relation', scope: 'occurrence', targets: [{ kind: 'occurrence', dayId: 'day-1', blockId: 'block-fado', placeId: 'fado' }], role: 'direct_commitment', operations: ['remove', 'move', 'add', 'priority'], rationale: '旅客明确核对虚构凭证与具体安排', evidenceRefs: ['traveler-declaration'] }], rationale: '完整核对范围', evidenceRefs: ['traveler-declaration'] })),
    decision: { source: 'traveler', actorId: 'local-traveler', decidedAt: now, rationale: '已完整审阅虚构凭证', evidenceRefs: ['traveler-declaration'], obligations: ['核对全部直接间接依赖'] }
  });
  assertTripBlueprintIntegrity(blueprint);
  const compiled = compileTripBlueprint(blueprint, { createdAt: now }).plan;
  const workspace = {
    profile: { status: "ready", displayName: "Trip tester", preferredLanguage: "English", nationality: "Singapore", gender: "prefer_not_to_say", immigrationStatus: "short_term_visitor" },
    runtime: { selectedKind: "codex" },
    inbox: [],
    destinationArrivals: [],
    activeBlueprint: blueprint,
    activePlan: {
      id: "blueprint-topics",
      version: 1,
      title: "Kyoto Blueprint",
      location: "Kyoto",
      dates: "2026-10-01",
      status: "draft",
      knownInformation: [],
      assumptions: [],
      nextAction: "Review.",
      createdAt: "2026-09-01T00:00:00.000Z",
      configuration: { accommodation: { status: "not_set" }, arrival: {}, transport: { preference: "plan_recommended" }, travelContext: { partySize: 2, luggage: "light" } },
      stages: [],
      sources: [],
      ...compiled,
      presentation
    }
  };
  await page.route("**/api/workspace", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(workspace) }));
  await page.route("**/api/plans/history", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/api/configuration", (route) => route.fulfill({ contentType: "application/json", body: "{}" }));
  await page.route("**/api/runtimes", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));

  await page.goto("/");
  const sidePanel = page.getByLabel("Itinerary side panel");
  await expect(page.getByLabel("Landi Blueprint workspace")).toBeVisible();
  await sidePanel.getByRole("button", { name: "Dining" }).click();
  const seasonalCard = sidePanel.locator(".blueprint-guide-card").filter({ hasText: "Seasonal sweets" });
  await expect(seasonalCard).toBeVisible();
  await expect(seasonalCard).toContainText("Background");
  await expect(seasonalCard.getByRole("button", { name: "Add" })).toHaveCount(0);
  await expect(page.locator(".blueprint-map-bubble").filter({ hasText: "Seasonal sweets" })).toHaveCount(0);
  await seasonalCard.getByRole("button", { name: /Seasonal sweets/ }).click();
  await expect(sidePanel.getByRole("heading", { name: "Seasonal sweets" })).toBeVisible();
  await expect(sidePanel.locator(".blueprint-detail-panel").getByText("Use this as food background rather than a destination.").first()).toBeVisible();
  await expect(sidePanel.getByRole("button", { name: "Add to itinerary" })).toHaveCount(0);
  await sidePanel.getByText("Sources & verification").click();
  const source = sidePanel.getByRole("link", { name: /^Kyoto guide · Visitor bureau.*seasonal sweets$/ });
  await expect(source).toBeVisible();
  await expect(source).toHaveAttribute("href", "https://guide.example");

  await sidePanel.getByRole("button", { name: "Back to explore" }).click();
  await sidePanel.getByRole("button", { name: "Dining" }).click();
  await page.locator(".blueprint-timeline-list .blueprint-itinerary-card-main").filter({ hasText: "Fado night" }).click();
  await expect(page.getByRole('complementary', { name: 'Daily itinerary cards' }).getByRole('button', { name: 'Move Fado night', exact: true })).toHaveCount(0);
  const fixedRemove = sidePanel.getByRole("button", { name: "Fixed booking" });
  await expect(fixedRemove).toBeDisabled();
  for (const action of ['Must go', 'Prefer', 'Nearby', 'Keep for later']) {
    await expect(sidePanel.locator('.blueprint-detail-panel:not([hidden]) .blueprint-detail-priorities').getByRole('button', { name: action, exact: true })).toBeDisabled();
  }
  await expect(pageErrors).toEqual([]);
});

test("a new Plan collects critical facts before enabling generation", async ({ page, request }) => {
  test.skip(!process.env.LANDI_LIVE_AGENT_E2E, "requires an authenticated live Codex runtime");
  test.setTimeout(360_000);
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  const profile = await request.put("/api/profile", { data: { displayName: "Browser acceptance", preferredLanguage: "English", nationality: "China", gender: "prefer_not_to_say", immigrationStatus: "unknown" } });
  expect(profile.ok()).toBe(true);
  await page.addInitScript(() => localStorage.setItem("landi:first-run-tour:v1", "complete"));
  await page.goto("/");
  await page.getByRole("textbox", { name: "Where would you like to go?" }).fill("Hangzhou, China");
  await page.getByRole("button", { name: "Start planning", exact: true }).click({ timeout: 15_000 });
  const composer = page.getByRole("region", { name: "Tell Landi your goal" });
  const input = composer.getByPlaceholder("Chat with Landi");
  await input.fill("I want a relaxed three-day trip to Hangzhou, China, to enjoy West Lake, gardens, tea culture and local food. Please help me plan it.");
  await composer.getByRole("button", { name: "Send", exact: true }).click();
  await expect(input).toBeEnabled();
  await expect(composer.getByRole("button", { name: "Generate plan", exact: true })).toHaveCount(0);
  await input.fill("October 20–22, 2026. Two adults. We will take high-speed trains from Shanghai on October 20 and return to Shanghai in the afternoon or evening of October 22; no tickets are booked, so please recommend suitable stations and provisional arrival and departure times. Walking and public transport within Hangzhou, with taxis when needed; no driving. No hotel booked, please recommend a comfortable good-value hotel, not luxury. No fixed budget. These are my confirmed trip requirements.");
  await composer.getByRole("button", { name: "Send", exact: true }).click();
  await expect(input).toBeEnabled();
  await expect(composer.getByText("Review your trip details", { exact: true })).toBeVisible();
  await expect(composer.getByRole("button", { name: "Generate plan", exact: true })).toBeEnabled();
  await expect(composer.locator(".generation-retry")).toContainText("2026");
  expect(pageErrors).toEqual([]);
});

test("an itinerary Plan renders the Skill-native interactive result inside Landi", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const initialWorkspace = {
    profile: { status: "ready", displayName: "Trip tester", preferredLanguage: "简体中文", nationality: "Singapore", gender: "prefer_not_to_say", immigrationStatus: "short_term_visitor" },
    runtime: { selectedKind: "codex" }, inbox: [],
    activePlan: {
      id: "native-trip", version: 1, title: "里斯本建筑与街区生活", location: "里斯本", dates: "2026-10-12 至 2026-10-13", status: "draft", knownInformation: ["两天建筑与当地生活"], assumptions: [], nextAction: "审阅并确认计划。", createdAt: "2026-08-17T00:00:00.000Z",
      configuration: { accommodation: { status: "not_set" }, arrival: {}, transport: { preference: "plan_recommended" }, travelContext: { partySize: 3, luggage: "light" } }, stages: [], sources: [],
      presentation: {
        kind: "itinerary", summary: "里斯本建筑与街区生活", language: "zh-CN", startDate: "2026-10-12", endDate: "2026-10-13", cities: ["里斯本"],
        days: [
          { id: "d1", label: "10 月 12 日", shortLabel: "10/12", city: "里斯本", title: "河岸建筑与旧城方向感", summary: "从河岸进入旧城，只保留一座重型主锚点。", anchors: ["belem"], candidates: ["market"], placeIds: ["belem", "alfama"], stops: [{ placeId: "belem", order: 1, time: "09:30" }, { placeId: "alfama", order: 2, time: "15:30" }], routeReview: { sequenceRationale: "上午先看需要集中精力的建筑，下午顺着同一方向进入旧城。", fixedConstraints: ["修道院上午入场"] } },
          { id: "d2", label: "10 月 13 日", shortLabel: "10/13", city: "里斯本", title: "街区生活与当代空间", summary: "用市场、咖啡和社区空间组成较轻的一天。", anchors: ["lx"], candidates: [], placeIds: ["lx"], stops: [{ placeId: "lx", order: 1, time: "10:00" }] }
        ],
        places: [
          { id: "belem", name: "Mosteiro dos Jerónimos", localizedName: "热罗尼莫斯修道院", city: "里斯本", area: "贝伦", locationLabel: "Belém", coordinates: [38.6979,-9.2065], category: "sight", priority: "must", contentTier: "deep", durationMinutes: 180, whyWorthIt: "从曼努埃尔式石雕理解里斯本如何把航海财富写进宗教建筑。", plan: "上午入场，之后沿河向东移动。", tip: "门票与开放时间需临近复核。", detailSections: [{ title: "到这里看什么", items: ["从南门辨认航海符号与石雕层次", "进入回廊比较光线和柱式变化"] }], sourceRefs: [] },
          { id: "alfama", name: "Alfama", localizedName: "阿尔法玛", city: "里斯本", area: "Alfama", locationLabel: "Alfama", coordinates: [38.711,-9.13], category: "local-life", priority: "preferred", durationMinutes: 120, whyWorthIt: "用坡道、晾衣阳台和小广场理解旧城仍在运转的生活结构。", plan: "下午从低处向上步行，控制爬坡强度。", detailSections: [], sourceRefs: [] },
          { id: "market", name: "Mercado de Campo de Ourique", localizedName: "坎波德欧里克市场", city: "里斯本", area: "Campo de Ourique", locationLabel: "Campo de Ourique", coordinates: [38.716,-9.166], category: "market", priority: "nearby", durationMinutes: 60, whyWorthIt: "市场兼顾居民采购与短暂停留，适合作为体力下降时的同方向替代。", plan: "有余力时加入第一天下午。", guideDisplay: { footerNote: "Confirm market hours before adding this stop." }, detailSections: [], sourceRefs: [] },
          { id: "lx", name: "LX Factory", city: "里斯本", area: "Alcântara", locationLabel: "Alcântara", coordinates: [38.703,-9.179], category: "art", priority: "preferred", durationMinutes: 180, whyWorthIt: "旧工业空间中的书店、工作室和餐饮适合观察城市更新的现实使用。", plan: "第二日上午慢走并在同区午餐。", detailSections: [], sourceRefs: [] },
          { id: "bookshop", name: "Livraria Bertrand", localizedName: "伯特兰书店", city: "里斯本", area: "Chiado", locationLabel: "Chiado", coordinates: [38.7102,-9.1421], category: "bookstore shopping", priority: "nearby", durationMinutes: 45, whyWorthIt: "作为轻量购物点，适合在市中心路线中补进一段书店与街区浏览。", plan: "如果当天还有余力，把它作为短购物停留加入。", detailSections: [], sourceRefs: [] }
        ],
        travelTips: [
          { id: "tip-alfama", title: "Alfama pacing", body: "Keep the climb relaxed and pause at small squares.", theme: "timing", context: "Alfama afternoon", placeId: "alfama", dayId: "d1", evidence: [] },
          { id: "tip-market", title: "Market pacing", body: "Use this as a flexible food and rest stop.", theme: "timing", context: "Market add-on", placeId: "market", dayId: "d2", evidence: [] }
        ],
        routeSegments: [{ id: "r1", dayId: "d1", originPlaceId: "belem", destinationPlaceId: "alfama", mode: "transit", verification: "verified", durationMinutes: 45, checkedAt: "2026-08-17T00:00:00Z", label: "沿河公共交通进入旧城", detail: "具体线路与耗时出发前复核。", sourceRefs: ["google_maps"] }]
      }
    }
  };
  let appliedWorkspace: any;
  await page.route("**/api/workspace", (route) => route.fulfill({ json: editableWorkspace(appliedWorkspace ?? initialWorkspace) }));
  const directRevisionRequests: unknown[] = [];
  let releaseSave!: () => void;
  const savePending = new Promise<void>((resolve) => { releaseSave = resolve; });
  await page.route("**/api/plans/native-trip/blueprint-revisions/direct", async (route) => {
    const requestBody = route.request().postDataJSON();
    directRevisionRequests.push(requestBody);
    await savePending;
    const updatedWorkspace = {
      profile: { status: "ready", displayName: "Trip tester", preferredLanguage: "简体中文", nationality: "Singapore", gender: "prefer_not_to_say", immigrationStatus: "short_term_visitor" },
      runtime: { selectedKind: "codex" },
      inbox: [],
      activePlan: {
        id: "native-trip", version: 2, title: "里斯本建筑与街区生活", location: "里斯本", dates: "2026-10-12 至 2026-10-13", status: "draft", knownInformation: ["两天建筑与当地生活"], assumptions: [], nextAction: "审阅并确认计划。", createdAt: "2026-08-17T00:00:00.000Z",
        configuration: { accommodation: { status: "not_set" }, arrival: {}, transport: { preference: "plan_recommended" }, travelContext: { partySize: 3, luggage: "light" } },
        stages: [],
        sources: [],
        presentation: {
          kind: "itinerary", summary: "里斯本建筑与街区生活", language: "zh-CN", startDate: "2026-10-12", endDate: "2026-10-13", cities: ["里斯本"],
          days: [
            { id: "d1", label: "10 月 12 日", shortLabel: "10/12", city: "里斯本", title: "河岸建筑与旧城方向感", summary: "从河岸进入旧城，只保留一座重型主锚点。", anchors: ["belem"], candidates: [], placeIds: ["belem", "alfama", "bookshop"], stops: [{ placeId: "belem", order: 1, time: "09:30" }, { placeId: "alfama", order: 2, time: "15:30" }, { placeId: "bookshop", order: 3, time: "16:30" }] },
            { id: "d2", label: "10 月 13 日", shortLabel: "10/13", city: "里斯本", title: "街区生活与当代空间", summary: "用市场、咖啡和社区空间组成较轻的一天。", anchors: ["lx"], candidates: [], placeIds: ["lx", "market"], stops: [{ placeId: "lx", order: 1, time: "10:00" }, { placeId: "market", order: 2, time: "15:00" }] }
          ],
          places: [
            { id: "belem", name: "Mosteiro dos Jerónimos", localizedName: "热罗尼莫斯修道院", city: "里斯本", area: "贝伦", locationLabel: "Belém", coordinates: [38.6979,-9.2065], category: "sight", priority: "must", durationMinutes: 180, whyWorthIt: "从曼努埃尔式石雕理解里斯本如何把航海财富写进宗教建筑。", plan: "上午入场，之后沿河向东移动。", detailSections: [], sourceRefs: [] },
            { id: "alfama", name: "Alfama", localizedName: "阿尔法玛", city: "里斯本", area: "Alfama", locationLabel: "Alfama", coordinates: [38.711,-9.13], category: "local-life", priority: "preferred", durationMinutes: 120, whyWorthIt: "用坡道、晾衣阳台和小广场理解旧城仍在运转的生活结构。", plan: "下午从低处向上步行，控制爬坡强度。", tip: "Keep the climb relaxed and pause at small squares.", detailSections: [], sourceRefs: [] },
            { id: "bookshop", name: "Livraria Bertrand", localizedName: "伯特兰书店", city: "里斯本", area: "Chiado", locationLabel: "Chiado", coordinates: [38.7102,-9.1421], category: "bookstore shopping", priority: "nearby", durationMinutes: 45, whyWorthIt: "作为轻量购物点，适合在市中心路线中补进一段书店与街区浏览。", plan: "如果当天还有余力，把它作为短购物停留加入。", detailSections: [], sourceRefs: [] },
            { id: "lx", name: "LX Factory", city: "里斯本", area: "Alcântara", locationLabel: "Alcântara", coordinates: [38.703,-9.179], category: "art", priority: "preferred", durationMinutes: 180, whyWorthIt: "旧工业空间中的书店、工作室和餐饮适合观察城市更新的现实使用。", plan: "第二日上午慢走并在同区午餐。", detailSections: [], sourceRefs: [] },
            { id: "market", name: "Mercado de Campo de Ourique", localizedName: "坎波德欧里克市场", city: "里斯本", area: "Campo de Ourique", locationLabel: "Campo de Ourique", coordinates: [38.716,-9.166], category: "market", priority: "nearby", durationMinutes: 60, whyWorthIt: "市场兼顾居民采购与短暂停留，适合作为体力下降时的同方向替代。", plan: "有余力时加入第一天下午。", tip: "Use this as a flexible food and rest stop.", guideDisplay: { footerNote: "Confirm market hours before adding this stop." }, detailSections: [], sourceRefs: [] }
          ],
          routeSegments: [
            { id: "r1", dayId: "d1", originPlaceId: "belem", destinationPlaceId: "alfama", mode: "transit", verification: "verified", durationMinutes: 45, checkedAt: "2026-08-17T00:00:00Z", label: "沿河公共交通进入旧城", detail: "具体线路与耗时出发前复核。", sourceRefs: [] },
            { id: "r2", dayId: "d1", originPlaceId: "alfama", destinationPlaceId: "bookshop", mode: "walking", verification: "needs_verification", label: "Route needs refresh", detail: "This day was edited directly. Refresh routing, timing, meals, and opening constraints before execution.", sourceRefs: [] },
            { id: "r3", dayId: "d2", originPlaceId: "lx", destinationPlaceId: "market", mode: "transit", verification: "needs_verification", label: "Route needs refresh", detail: "This day was edited directly. Refresh routing, timing, meals, and opening constraints before execution.", sourceRefs: [] }
          ]
        }
      }
    };
    appliedWorkspace = updatedWorkspace;
    const snapshot = editableWorkspace(updatedWorkspace);
    const revision = revisionReceipt(initialWorkspace, updatedWorkspace, requestBody, {
      dayIds: ["d2", "d1"], movementIds: ["r2", "r3"], reason: "These itinerary days were edited directly."
    });
    await route.fulfill({ json: {
      revision,
      workspace: {
        ...snapshot,
        latestDirectBlueprintRevision: {
          id: revision.id, planId: snapshot.activePlan.id, planVersion: snapshot.activePlan.version,
          blueprintId: snapshot.activeBlueprint.id, blueprintVersion: snapshot.activeBlueprint.version,
          baseBlueprintVersion: revision.baseBlueprintVersion, createdAt: revision.createdAt
        }
      }
    } });
  });
  const routeRefreshRequests: unknown[] = [];
  await page.route("**/api/plans/native-trip/presentation/routes/refresh", async (route) => {
    const requestBody = route.request().postDataJSON();
    routeRefreshRequests.push(requestBody);
    if (!appliedWorkspace) {
      await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "No applied workspace was available." }) });
      return;
    }
    const refreshedWorkspace = {
      ...appliedWorkspace,
      activePlan: {
        ...appliedWorkspace.activePlan,
        version: appliedWorkspace.activePlan.version + 1,
        presentation: {
          ...appliedWorkspace.activePlan.presentation,
          routeSegments: appliedWorkspace.activePlan.presentation.routeSegments.map((segment: any) => requestBody.segmentIds.includes(segment.id) ? {
            ...segment,
            verification: "verified",
            durationMinutes: 18,
            checkedAt: "2026-08-18T00:00:00Z",
            label: "Alfama to Chiado walk",
            detail: "Refreshed walking route from Alfama toward Chiado."
          } : segment)
        }
      }
    };
    appliedWorkspace = refreshedWorkspace;
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({
      workspace: editableWorkspace(refreshedWorkspace),
      routeRefresh: {
        segmentIds: requestBody.segmentIds,
        refreshedSegmentIds: requestBody.segmentIds,
        scheduleConflictDayIds: []
      }
    }) });
  });
  const agentRequests: unknown[] = [];
  await page.route("**/api/agent/chat", (route) => {
    agentRequests.push(route.request().postDataJSON());
    return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Agent route should not be used for direct itinerary edits." }) });
  });

  await page.goto("/");
  await expect(page.getByLabel("Landi Blueprint workspace")).toBeVisible();
  await expect(page.getByRole("button", { name: "Itinerary" })).toHaveClass(/active/);
  await expect(page.locator(".blueprint-map-stage")).toBeVisible();
  await expect(page.locator(".blueprint-map-stage.blueprint-google-map, .blueprint-map-stage.leaflet-container")).toBeVisible();
  await expect(page.locator(".blueprint-map-bubble")).toHaveCount(2, { timeout: 15000 });
  await expect(page.locator(".blueprint-map-dot")).toHaveCount(2);
  await expect.poll(async () => page.locator(".blueprint-map-dot").evaluateAll((dots) => dots.map((dot) => dot.textContent?.trim() ?? ""))).toEqual(["", ""]);
  await expect(page.getByLabel("Itinerary map context").getByRole("button", { name: "Mosteiro dos Jerónimos" }).locator(".blueprint-map-bubble")).toBeVisible();
  await expect(page.getByLabel("Itinerary map context").getByRole("button", { name: "Mercado de Campo de Ourique" }).locator(".blueprint-map-bubble")).toHaveCount(0);
  await expect(page.locator(".blueprint-timeline-list .blueprint-itinerary-block")).toHaveText([
    /09:30.*Mosteiro dos Jerónimos/s,
    /15:30.*Alfama/s
  ]);
  await expect(page.locator(".blueprint-timeline-list .blueprint-itinerary-card-main").filter({ hasText: "Alfama" })).toContainText("下午从低处向上步行");
  await page.locator(".blueprint-timeline-list .blueprint-itinerary-card-main").filter({ hasText: "Alfama" }).click();
  await expect(page.getByLabel("Itinerary map context").getByRole("button", { name: "Alfama" }).locator(".blueprint-map-bubble")).toHaveClass(/selected/);
  await expect(page.getByLabel("Itinerary map context").getByRole("button", { name: "Mosteiro dos Jerónimos" }).locator(".blueprint-map-bubble")).not.toHaveClass(/selected/);
  await page.getByLabel("Itinerary side panel").getByRole("button", { name: "Back to explore" }).click();

  await page.locator(".blueprint-day-strip button").filter({ hasText: "10-13" }).click();
  await expect(page.locator(".blueprint-map-bubble")).toHaveCount(1, { timeout: 15000 });
  await expect(page.getByLabel("Itinerary map context").getByRole("button", { name: "LX Factory" }).locator(".blueprint-map-bubble")).toBeVisible();
  await page.locator(".blueprint-day-strip button").filter({ hasText: "10-12" }).click();

  const sidePanel = page.getByLabel("Itinerary side panel");
  const explorePanel = sidePanel.locator(".blueprint-explore-panel");
  await expect(sidePanel.getByRole("heading", { name: "Explore" })).toBeVisible();
  await expect(sidePanel.getByRole("button", { name: "All", exact: true })).toHaveCount(0);
  await expect(sidePanel.locator(".blueprint-guide-filters button.active")).toHaveCount(0);
  await expect(explorePanel).toContainText("Mosteiro dos Jerónimos");
  await expect(explorePanel).toContainText("Alfama");
  await expect(explorePanel).toContainText("LX Factory");
  await expect(explorePanel).toContainText("Mercado de Campo de Ourique");
  await expect(explorePanel).toContainText("Livraria Bertrand");
  await expect(sidePanel.locator(".blueprint-source-marker")).toHaveCount(0);
  await expect(sidePanel.getByRole("button", { name: /^i$/ })).toHaveCount(0);

  await sidePanel.getByRole("button", { name: "Attractions", exact: true }).click();
  await expect(sidePanel.locator(".blueprint-guide-filters button.active")).toHaveText("Attractions");
  await expect(explorePanel).not.toContainText("Mercado de Campo de Ourique");
  await sidePanel.getByRole("button", { name: "Attractions", exact: true }).click();
  await expect(sidePanel.locator(".blueprint-guide-filters button.active")).toHaveCount(0);
  await expect(explorePanel).toContainText("Mercado de Campo de Ourique");

  await sidePanel.getByRole("button", { name: "Dining", exact: true }).click();
  await expect(sidePanel.locator(".blueprint-guide-filters button.active")).toHaveText("Dining");
  await expect(explorePanel).toContainText("Mercado de Campo de Ourique");
  await expect(explorePanel).not.toContainText("Confirm market hours before adding this stop.");
  await expect(explorePanel).not.toContainText("LX Factory");
  await expect(explorePanel).not.toContainText("Livraria Bertrand");

  await sidePanel.getByRole("button", { name: /Mercado de Campo de Ourique/ }).click();
  await expect(sidePanel.getByRole("heading", { name: /Mercado de Campo de Ourique/ })).toBeVisible();
  await expect(sidePanel).not.toContainText("Confirm market hours before adding this stop.");
  await expect(sidePanel.getByRole("button", { name: "Add to itinerary" })).toBeVisible();
  await expect(sidePanel.getByRole("button", { name: "Back to explore" })).toBeVisible();
  await expect(sidePanel.getByRole("button", { name: "Detail" })).toHaveCount(0);

  await sidePanel.getByRole("button", { name: "Add to itinerary" }).click();
  await expect(sidePanel.getByText("Placement", { exact: true })).toBeVisible();
  await expect(sidePanel.getByText("Confirm market hours before adding this stop.")).toBeVisible();
  await expect(sidePanel.getByText("Meaning", { exact: true })).toHaveCount(0);
  await expect(sidePanel.getByRole("button", { name: "Scheduled", exact: true })).toHaveCount(0);
  await expect(sidePanel.getByRole("button", { name: "Optional", exact: true })).toHaveCount(0);

  await sidePanel.getByRole("button", { name: "10-13" }).click();
  await sidePanel.getByRole("button", { name: "Add to draft" }).click();
  const editBar = page.getByRole("toolbar", { name: "Unsaved itinerary edits" });
  await expect(editBar.getByText("1 unsaved change")).toBeVisible();
  await expect(editBar.getByText("10-13", { exact: true })).toBeVisible();
  await expect(page.locator(".blueprint-map-status")).toHaveCount(0);
  await expect(page.locator(".blueprint-map-impact-notes")).toHaveCount(0);
  await expect(page.getByText("After confirm", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Travel time will be checked after confirm.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh routes" })).toHaveCount(0);
  expect(routeRefreshRequests).toEqual([]);
  await expect(sidePanel.getByRole("heading", { name: "Explore" })).toBeVisible();
  await expect(page.locator(".blueprint-timeline-list").getByRole("button", { name: /Pending itinerary edit for Mercado de Campo de Ourique/ })).toContainText("Not saved");
  await expect(page.locator(".blueprint-timeline-list").getByRole("button", { name: /Pending itinerary edit for Mercado de Campo de Ourique/ })).toContainText("At the end of the day");
  await expect(page.getByLabel("Itinerary map context").getByRole("button", { name: "Mercado de Campo de Ourique" }).locator(".blueprint-map-bubble")).toHaveClass(/selected/);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByText("unsaved change")).toHaveCount(0);
  await expect(page.getByText("After confirm", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Routes will be checked", { exact: true })).toHaveCount(0);
  await expect(page.locator(".blueprint-map-impact-notes")).toHaveCount(0);
  await expect(page.locator(".blueprint-timeline-list").getByRole("button", { name: /Pending itinerary edit for Mercado de Campo de Ourique/ })).toHaveCount(0);
  await expect(page.getByLabel("Itinerary map context").getByRole("button", { name: "Mercado de Campo de Ourique" }).locator(".blueprint-map-bubble")).toHaveCount(0);
  await expect(page.getByLabel("Itinerary map context").getByRole("button", { name: "LX Factory" }).locator(".blueprint-map-bubble")).toHaveClass(/selected/);

  await sidePanel.getByRole("button", { name: /Mercado de Campo de Ourique/ }).click();
  await sidePanel.getByRole("button", { name: "Add to itinerary" }).click();
  await sidePanel.getByRole("button", { name: "Add to draft" }).click();
  await expect(editBar.getByText("1 unsaved change")).toBeVisible();
  await sidePanel.getByRole("button", { name: "Dining", exact: true }).click();
  await sidePanel.getByRole("button", { name: "Shopping", exact: true }).click();
  await sidePanel.getByRole("button", { name: /Livraria Bertrand/ }).click();
  await sidePanel.getByRole("button", { name: "Add to itinerary" }).click();
  await sidePanel.getByRole("button", { name: "10-12" }).click();
  await sidePanel.getByRole("button", { name: "Add to draft" }).click();
  await expect(editBar.getByText("2 unsaved changes")).toBeVisible();
  await expect(editBar.getByText("10-13, 10-12")).toBeVisible();

  await page.getByRole("button", { name: "Apply", exact: true }).click();
  try {
    await expect(editBar.getByRole("button", { name: "Applying...", exact: true })).toBeDisabled();
    await expect.poll(() => directRevisionRequests.length).toBe(1);
  } finally { releaseSave(); }
  expect(directRevisionRequests[0]).toMatchObject({
    expectedVersion: 1,
    expectedBlueprintVersion: 1,
    revisions: [
      { kind: "add_place_to_day", placeId: "market", dayId: "d2", position: { kind: "end" } },
      { kind: "add_place_to_day", placeId: "bookshop", dayId: "d1", position: { kind: "end" } }
    ]
  });
  expect(agentRequests).toEqual([]);
  await expect(page.getByRole("region", { name: "Adjust your plan with Landi" })).toHaveCount(0);
  await expect(page.getByText("unsaved change")).toHaveCount(0);
  const routeReview = page.getByText("Travel times need checking", { exact: true });
  await expect(routeReview).toBeVisible();
  expect(routeRefreshRequests).toEqual([]);
  await routeReview.click();
  await expect(page.getByText("Checking travel times creates a new saved version and ends undo for the latest edit.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Check travel times and continue" }).click();
  await expect.poll(() => routeRefreshRequests.length).toBe(1);
  expect(routeRefreshRequests[0]).toMatchObject({ expectedVersion: 2, expectedBlueprintVersion: 2, segmentIds: ["r2"] });
  await expect(page.locator(".agent-status-float")).toHaveCount(0);
  await expect(page.getByText("After confirm", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Routes will be checked", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Route and timing will be rechecked after confirmation.")).toHaveCount(0);
  await expect(page.locator(".blueprint-map-status")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Refresh routes" })).toHaveCount(0);
  await page.locator(".blueprint-day-strip button").filter({ hasText: "10-13" }).click();
  await expect(page.locator(".blueprint-timeline-list .blueprint-itinerary-card-main").filter({ hasText: "Mercado de Campo de Ourique" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh routes" })).toHaveCount(0);
  await expect(sidePanel.getByRole("heading", { name: "Explore" })).toBeVisible();
  await expect.poll(() => routeRefreshRequests.length).toBe(2);
  expect(routeRefreshRequests[1]).toMatchObject({ expectedVersion: 3, expectedBlueprintVersion: 3, segmentIds: ["r3"] });
  expect(pageErrors).toEqual([]);
});

test("failed direct itinerary Apply keeps the local draft available", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const workspace = {
    profile: { status: "ready", displayName: "Trip tester", preferredLanguage: "English", nationality: "Singapore", gender: "prefer_not_to_say", immigrationStatus: "short_term_visitor" },
    runtime: { selectedKind: "codex" },
    inbox: [],
    activePlan: {
      id: "conflict-trip", version: 4, title: "Lisbon market day", location: "Lisbon", dates: "2026-10-12", status: "draft", knownInformation: [], assumptions: [], nextAction: "Review.", createdAt: "2026-08-17T00:00:00.000Z",
      configuration: { accommodation: { status: "not_set" }, arrival: {}, transport: { preference: "plan_recommended" }, travelContext: { partySize: 2 } },
      stages: [],
      sources: [],
      presentation: {
        kind: "itinerary", summary: "Lisbon market day", language: "en", startDate: "2026-10-12", endDate: "2026-10-12", cities: ["Lisbon"],
        days: [{ id: "d1", label: "October 12", shortLabel: "10/12", city: "Lisbon", title: "Neighborhood day", summary: "A compact day.", placeIds: ["anchor"], stops: [{ placeId: "anchor", order: 1, time: "09:00" }], candidates: ["market"] }],
        places: [
          { id: "anchor", name: "Morning Museum", city: "Lisbon", area: "Baixa", locationLabel: "Baixa", coordinates: [38.711, -9.14], category: "museum", priority: "preferred", durationMinutes: 90, whyWorthIt: "A compact morning anchor.", plan: "Visit first.", detailSections: [], sourceRefs: [] },
          { id: "market", name: "Neighborhood Market", city: "Lisbon", area: "Campo de Ourique", locationLabel: "Campo de Ourique", coordinates: [38.716, -9.166], category: "food market", priority: "nearby", durationMinutes: 60, whyWorthIt: "A flexible food stop.", plan: "Add if the day has room.", detailSections: [], sourceRefs: [] }
        ],
        routeSegments: []
      }
    }
  };
  await page.route("**/api/workspace", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(editableWorkspace(workspace, 7)) }));
  await page.route("**/api/plans/history", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/api/configuration", (route) => route.fulfill({ contentType: "application/json", body: "{}" }));
  await page.route("**/api/runtimes", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  const directRevisionRequests: unknown[] = [];
  await page.route("**/api/plans/conflict-trip/blueprint-revisions/direct", async (route) => {
    directRevisionRequests.push(route.request().postDataJSON());
    await route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({
        error: "Neighborhood Market changes the shape of 2026-10-12, so Landi needs to replan that day before saving it.",
        code: "assisted_replanning_required",
        replanRequirement: {
          status: "assisted_replanning_required",
          editKind: "add_place_to_day",
          placeId: "market",
          dayId: "d1",
          reasonCode: "high_impact_place",
          affectedDayIds: ["d1"],
          affectedPlaceIds: ["market", "anchor"],
          explanation: "Neighborhood Market changes the shape of 2026-10-12, so Landi needs to replan that day before saving it.",
          suggestedRequest: "Replan the affected itinerary day so it can add Neighborhood Market on 2026-10-12. Keep unaffected days and places unchanged. Recheck route order, timing, meal and rest spacing, opening constraints, and publish a new Trip Blueprint version only when the affected day is coherent."
        }
      })
    });
  });
  const assistedReplanningRequests: unknown[] = [];
  await page.route("**/api/plans/conflict-trip/blueprint-revisions/assisted-replanning", async (route) => {
    assistedReplanningRequests.push(route.request().postDataJSON());
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        workspace: editableWorkspace(workspace, 7),
        handoff: {
          status: "ready_for_assisted_replanning",
          baseBlueprintId: "blueprint-conflict-trip",
          baseBlueprintVersion: 7,
          replanRequirement: {
            status: "assisted_replanning_required",
            editKind: "add_place_to_day",
            placeId: "market",
            dayId: "d1",
            reasonCode: "high_impact_place",
            affectedDayIds: ["d1"],
            affectedPlaceIds: ["market", "anchor"],
            explanation: "Neighborhood Market changes the shape of 2026-10-12, so Landi needs to replan that day before saving it.",
            suggestedRequest: "Replan the affected itinerary day so it can add Neighborhood Market on 2026-10-12."
          },
          revisions: [{ kind: "add_place_to_day", placeId: "market", dayId: "d1", position: { kind: "end" }, createdAt: "2026-09-04T00:00:00.000Z" }],
          affectedDayIds: ["d1"],
          affectedPlaceIds: ["market", "anchor"],
          request: "Replan the affected itinerary day for Lisbon market day."
        }
      })
    });
  });
  const agentRequests: unknown[] = [];
  await page.route("**/api/agent/chat", (route) => {
    agentRequests.push(route.request().postDataJSON());
    if (agentRequests.length === 1) return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Landi could not replan the affected itinerary day." }) });
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        reply: "Landi updated the affected itinerary day.",
        workspace: {
          ...workspace,
          activePlan: {
            ...workspace.activePlan,
            version: 5,
            title: "Lisbon market day replanned",
            presentation: {
              ...workspace.activePlan.presentation,
              summary: "Lisbon market day replanned"
            }
          }
        }
      })
    });
  });

  await page.goto("/");
  const sidePanel = page.getByLabel("Itinerary side panel");
  await sidePanel.getByRole("button", { name: /Neighborhood Market/ }).click();
  await sidePanel.getByRole("button", { name: "Add to itinerary" }).click();
  await sidePanel.getByRole("button", { name: "Add to draft" }).click();
  const editBar = page.getByRole("toolbar", { name: "Unsaved itinerary edits" });
  await expect(editBar.getByText("1 unsaved change")).toBeVisible();
  await expect(page.locator(".blueprint-timeline-list").getByRole("button", { name: /Pending itinerary edit for Neighborhood Market/ })).toContainText("Not saved");
  await expect(page.locator(".blueprint-map-stage")).toBeVisible();
  await expect(page.locator(".blueprint-map-status")).toHaveCount(0);
  await expect(page.locator(".blueprint-map-impact-notes")).toHaveCount(0);
  await expect(page.getByText("After confirm", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Travel time will be checked after confirm.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh routes" })).toHaveCount(0);

  await editBar.getByRole("button", { name: "Apply", exact: true }).click();
  await expect.poll(() => directRevisionRequests.length).toBe(1);
  expect(directRevisionRequests[0]).toMatchObject({
    expectedVersion: 4,
    expectedBlueprintVersion: 7,
    revisions: [{ kind: "add_place_to_day", placeId: "market", dayId: "d1", position: { kind: "end" } }]
  });
  expect(assistedReplanningRequests).toEqual([]);
  expect(agentRequests).toEqual([]);
  await expect(page.locator(".inline-alert")).toBeVisible();
  await expect(editBar.getByText("1 unsaved change")).toBeVisible();
  await expect(editBar.getByRole("button", { name: "Apply", exact: true })).toBeEnabled();
  await expect(page.locator(".blueprint-timeline-list").getByRole("button", { name: /Pending itinerary edit for Neighborhood Market/ })).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test("one pending itinerary edit can be undone without clearing the other drafts", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const workspace = {
    profile: { status: "ready", displayName: "Trip tester", preferredLanguage: "English", nationality: "Singapore", gender: "prefer_not_to_say", immigrationStatus: "short_term_visitor" },
    runtime: { selectedKind: "codex" },
    inbox: [],
    activePlan: {
      id: "undo-trip", version: 1, title: "Lisbon undo drafts", location: "Lisbon", dates: "2026-10-12", status: "draft", knownInformation: [], assumptions: [], nextAction: "Review.", createdAt: "2026-08-17T00:00:00.000Z",
      configuration: { accommodation: { status: "not_set" }, arrival: {}, transport: { preference: "plan_recommended" }, travelContext: { partySize: 2 } },
      stages: [],
      sources: [],
      presentation: {
        kind: "itinerary", summary: "Lisbon undo drafts", language: "en", startDate: "2026-10-12", endDate: "2026-10-12", cities: ["Lisbon"],
        days: [{ id: "d1", label: "October 12", shortLabel: "10/12", city: "Lisbon", title: "Neighborhood day", summary: "A compact day.", placeIds: ["anchor"], stops: [{ placeId: "anchor", order: 1, time: "09:00" }], candidates: ["market", "bookshop"] }],
        places: [
          { id: "anchor", name: "Morning Museum", city: "Lisbon", area: "Baixa", locationLabel: "Baixa", coordinates: [38.711, -9.14], category: "museum", priority: "preferred", durationMinutes: 90, whyWorthIt: "A compact morning anchor.", plan: "Visit first.", detailSections: [], sourceRefs: [] },
          { id: "market", name: "Neighborhood Market", city: "Lisbon", area: "Campo de Ourique", locationLabel: "Campo de Ourique", coordinates: [38.716, -9.166], category: "food market", priority: "nearby", durationMinutes: 60, whyWorthIt: "A flexible food stop.", plan: "Add if the day has room.", detailSections: [], sourceRefs: [] },
          { id: "bookshop", name: "Neighborhood Bookshop", city: "Lisbon", area: "Chiado", locationLabel: "Chiado", coordinates: [38.7102, -9.1421], category: "bookstore shopping", priority: "nearby", durationMinutes: 45, whyWorthIt: "A compact shopping pause.", plan: "Use between the museum and market.", detailSections: [], sourceRefs: [] }
        ],
        routeSegments: []
      }
    }
  };
  let latestWorkspace = workspace;
  await page.route("**/api/workspace", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(editableWorkspace(latestWorkspace)) }));
  await page.route("**/api/plans/history", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/api/configuration", (route) => route.fulfill({ contentType: "application/json", body: "{}" }));
  await page.route("**/api/runtimes", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  const directRevisionRequests: unknown[] = [];
  await page.route("**/api/plans/undo-trip/blueprint-revisions/direct", async (route) => {
    const requestBody = route.request().postDataJSON();
    directRevisionRequests.push(requestBody);
    const updatedWorkspace = {
      ...workspace,
      activePlan: {
        ...workspace.activePlan,
        version: 2,
        presentation: {
          ...workspace.activePlan.presentation,
          days: [{ ...workspace.activePlan.presentation.days[0], placeIds: ["anchor", "market"], stops: [{ placeId: "anchor", order: 1, time: "09:00" }, { placeId: "market", order: 2, time: "13:00" }], candidates: ["bookshop"] }],
          routeSegments: [{ id: "r1", dayId: "d1", originPlaceId: "anchor", destinationPlaceId: "market", mode: "transit", verification: "needs_verification", label: "Route needs refresh", detail: "This day was edited directly. Refresh routing, timing, meals, and opening constraints before execution.", sourceRefs: [] }]
        }
      }
    };
    latestWorkspace = updatedWorkspace;
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({
      ...updatedWorkspace,
      workspace: editableWorkspace(updatedWorkspace),
      revision: {
        ...revisionReceipt(workspace, updatedWorkspace, requestBody, { dayIds: [], movementIds: [], reason: "No route refresh in this fixture." }),
        routeImpact: {
          days: [{
            dayId: "d1",
            addedPlaceIds: ["market"],
            removedPlaceIds: [],
            movedPlaceIds: [],
            movementIds: ["r1"],
            requiresRouteRefresh: true,
            requiresTimingReview: true,
            requiresMealRestSpacingReview: true,
            capacityRisk: false,
            backtrackingRisk: false,
            fixedTimeRisk: false,
            readiness: "ready_for_route_refresh",
            reasons: []
          }]
        },
        replanReadiness: {
          status: "ready_for_route_refresh",
          dayIds: ["d1"],
          reason: "These direct itinerary edits are saved, but affected routes and timing still need refresh before execution."
        }
      }
    }) });
  });
  const refreshRequests: unknown[] = [];
  await page.route("**/api/plans/undo-trip/presentation/routes/refresh", async (route) => {
    refreshRequests.push(route.request().postDataJSON());
    latestWorkspace = { ...latestWorkspace, activePlan: { ...latestWorkspace.activePlan, version: 3, presentation: { ...latestWorkspace.activePlan.presentation, routeSegments: latestWorkspace.activePlan.presentation.routeSegments.map(segment => ({ ...segment, verification: "verified" })) } } };
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ workspace: editableWorkspace(latestWorkspace), routeRefresh: { segmentIds: ["r1"], refreshedSegmentIds: ["r1"], scheduleConflictDayIds: [], failedSegmentIds: [] } }) });
  });
  const agentRequests: unknown[] = [];
  await page.route("**/api/agent/chat", (route) => {
    agentRequests.push(route.request().postDataJSON());
    return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Agent route should not be used for direct itinerary edits." }) });
  });

  await page.goto("/");
  const sidePanel = page.getByLabel("Itinerary side panel");
  await sidePanel.getByRole("button", { name: /Neighborhood Market/ }).click();
  await sidePanel.getByRole("button", { name: "Add to itinerary" }).click();
  await sidePanel.getByRole("button", { name: "Add to draft" }).click();
  await sidePanel.getByRole("button", { name: /Neighborhood Bookshop/ }).click();
  await sidePanel.getByRole("button", { name: "Add to itinerary" }).click();
  await sidePanel.getByRole("button", { name: "Add to draft" }).click();
  const editBar = page.getByRole("toolbar", { name: "Unsaved itinerary edits" });
  await expect(editBar.getByText("2 unsaved changes")).toBeVisible();
  const timeline = page.locator(".blueprint-timeline-list");
  await expect(timeline.getByRole("button", { name: /Pending itinerary edit for Neighborhood Market/ })).toBeVisible();
  await expect(timeline.getByRole("button", { name: /Pending itinerary edit for Neighborhood Bookshop/ })).toBeVisible();

  const bookshopCard = sidePanel.locator(".blueprint-guide-card").filter({ hasText: "Neighborhood Bookshop" });
  await expect(bookshopCard).toContainText("Added to 10-12 (not saved)");
  await timeline.locator(".blueprint-itinerary-block-pending").filter({ hasText: "Neighborhood Bookshop" }).getByRole("button", { name: "Undo draft" }).click();
  await expect(editBar.getByText("1 unsaved change")).toBeVisible();
  await expect(timeline.getByRole("button", { name: /Pending itinerary edit for Neighborhood Market/ })).toBeVisible();
  await expect(timeline.getByRole("button", { name: /Pending itinerary edit for Neighborhood Bookshop/ })).toHaveCount(0);
  await expect(bookshopCard).not.toContainText("not saved");
  await expect(bookshopCard.getByRole("button", { name: "Add", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect.poll(() => directRevisionRequests.length).toBe(1);
  expect(directRevisionRequests[0]).toMatchObject({
    expectedVersion: 1,
    expectedBlueprintVersion: 1,
    revisions: [{ kind: "add_place_to_day", placeId: "market", dayId: "d1", position: { kind: "end" } }]
  });
  await expect.poll(() => refreshRequests.length).toBe(1);
  expect(refreshRequests[0]).toMatchObject({ expectedVersion: 2, segmentIds: ["r1"] });
  expect(agentRequests).toEqual([]);
  await expect(timeline.locator(".blueprint-itinerary-card-main strong")).toHaveText(["Morning Museum", "Neighborhood Market"]);
  await expect(bookshopCard.getByRole("button", { name: "Add", exact: true })).toBeVisible();
  await expect(page.getByText("unsaved change")).toHaveCount(0);
  await expect(page.locator(".agent-status-float")).toHaveCount(0);
  await expect(page.locator(".inline-alert")).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});

test("automatic route refresh failures avoid agent status toasts", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const workspace = {
    profile: { status: "ready", displayName: "Trip tester", preferredLanguage: "English", nationality: "Singapore", gender: "prefer_not_to_say", immigrationStatus: "short_term_visitor" },
    runtime: { selectedKind: "codex" },
    inbox: [],
    activePlan: {
      id: "refresh-fail", version: 7, title: "Lisbon route check", location: "Lisbon", dates: "2026-10-12", status: "draft", knownInformation: [], assumptions: [], nextAction: "Review.", createdAt: "2026-08-17T00:00:00.000Z",
      configuration: { accommodation: { status: "not_set" }, arrival: {}, transport: { preference: "plan_recommended" }, travelContext: { partySize: 2 } },
      stages: [],
      sources: [],
      presentation: {
        kind: "itinerary", summary: "Lisbon route check", language: "en", startDate: "2026-10-12", endDate: "2026-10-12", cities: ["Lisbon"],
        days: [{ id: "d1", label: "October 12", shortLabel: "10/12", city: "Lisbon", title: "Neighborhood day", summary: "A compact day.", placeIds: ["anchor", "market"], stops: [{ placeId: "anchor", order: 1, time: "09:00" }, { placeId: "market", order: 2, time: "11:00" }] }],
        places: [
          { id: "anchor", name: "Morning Museum", city: "Lisbon", area: "Baixa", locationLabel: "Baixa", coordinates: [38.711, -9.14], category: "museum", priority: "preferred", durationMinutes: 90, whyWorthIt: "A compact morning anchor.", plan: "Visit first.", detailSections: [], sourceRefs: [] },
          { id: "market", name: "Neighborhood Market", city: "Lisbon", area: "Campo de Ourique", locationLabel: "Campo de Ourique", coordinates: [38.716, -9.166], category: "food market", priority: "nearby", durationMinutes: 60, whyWorthIt: "A flexible food stop.", plan: "Use after the museum.", detailSections: [], sourceRefs: [] }
        ],
        routeSegments: [{ id: "route-1", dayId: "d1", originPlaceId: "anchor", destinationPlaceId: "market", mode: "transit", verification: "needs_verification", label: "Route needs refresh", detail: "This day was edited directly. Refresh routing, timing, meals, and opening constraints before execution.", sourceRefs: [] }]
      }
    }
  };
  await page.route("**/api/workspace", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(workspace) }));
  await page.route("**/api/plans/history", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/api/configuration", (route) => route.fulfill({ contentType: "application/json", body: "{}" }));
  await page.route("**/api/runtimes", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  const routeRefreshRequests: unknown[] = [];
  await page.route("**/api/plans/refresh-fail/presentation/routes/refresh", async (route) => {
    routeRefreshRequests.push(route.request().postDataJSON());
    await route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ code: "unsupported_mode", error: "此交通方式暂不支持自动更新。 /private/internal-only" }) });
  });
  const agentRequests: unknown[] = [];
  await page.route("**/api/agent/chat", (route) => {
    agentRequests.push(route.request().postDataJSON());
    return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Agent route should not be used for route refresh." }) });
  });

  await page.goto("/");
  await expect(page.getByRole("button", { name: "Refresh routes" })).toHaveCount(0);
  await expect(page.locator(".blueprint-map-status")).toHaveCount(0);
  await expect(page.locator(".blueprint-map-impact-notes")).toHaveCount(0);
  await expect.poll(() => routeRefreshRequests.length).toBe(1);
  expect(routeRefreshRequests[0]).toMatchObject({
    expectedVersion: 7,
    segmentIds: ["route-1"]
  });
  expect(agentRequests).toEqual([]);
  await expect(page.locator(".agent-status-float")).toHaveCount(0);
  await expect(page.locator(".inline-alert")).not.toContainText("Routes changed before refresh could run.");
  await expect(page.locator(".inline-alert")).toContainText("Automatic route updates are not available for this transport mode. The latest plan is displayed. The original operation is still unconfirmed; it has not been submitted again.");
  await expect(page.locator(".inline-alert")).not.toContainText("/private/internal-only");
  await expect(page.locator(".inline-alert")).not.toContainText("此交通方式");
  expect(routeRefreshRequests).toHaveLength(1);
  await expect(page.locator(".blueprint-timeline-list .blueprint-itinerary-card-main strong")).toHaveText(["Morning Museum", "Neighborhood Market"]);
  expect(pageErrors).toEqual([]);
});

test("place details show separate priority actions and keep itinerary actions", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const workspace = {
    profile: { status: "ready", displayName: "Trip tester", preferredLanguage: "English", nationality: "Singapore", gender: "prefer_not_to_say", immigrationStatus: "short_term_visitor" },
    runtime: { selectedKind: "codex" },
    inbox: [],
    activePlan: {
      id: "priority-trip", version: 1, title: "Lisbon status day", location: "Lisbon", dates: "2026-10-12", status: "draft", knownInformation: [], assumptions: [], nextAction: "Review.", createdAt: "2026-08-17T00:00:00.000Z",
      configuration: { accommodation: { status: "not_set" }, arrival: {}, transport: { preference: "plan_recommended" }, travelContext: { partySize: 2 } },
      stages: [],
      sources: [],
      presentation: {
        kind: "itinerary", summary: "Lisbon status day", language: "en", startDate: "2026-10-12", endDate: "2026-10-12", cities: ["Lisbon"],
        days: [{ id: "d1", label: "October 12", shortLabel: "10/12", city: "Lisbon", title: "Neighborhood day", summary: "A compact day.", placeIds: ["anchor"], stops: [{ placeId: "anchor", order: 1, time: "09:00" }], candidates: ["market"] }],
        places: [
          { id: "anchor", name: "Morning Museum", city: "Lisbon", area: "Baixa", locationLabel: "Baixa", coordinates: [38.711, -9.14], category: "museum", priority: "preferred", durationMinutes: 90, whyWorthIt: "A compact morning anchor.", plan: "Visit first.", detailSections: [], sourceRefs: [] },
          { id: "market", name: "Neighborhood Market", city: "Lisbon", area: "Campo de Ourique", locationLabel: "Campo de Ourique", coordinates: [38.716, -9.166], category: "food market", priority: "nearby", durationMinutes: 60, whyWorthIt: "A flexible food stop.", plan: "Add if the day has room.", detailSections: [], sourceRefs: [] }
        ],
        routeSegments: []
      }
    }
  };
  await page.route("**/api/workspace", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(workspace) }));
  await page.route("**/api/plans/history", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/api/configuration", (route) => route.fulfill({ contentType: "application/json", body: "{}" }));
  await page.route("**/api/runtimes", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  const directRevisionRequests: unknown[] = [];
  await page.route("**/api/plans/priority-trip/blueprint-revisions/direct", async (route) => {
    const requestBody = route.request().postDataJSON();
    directRevisionRequests.push(requestBody);
    const updatedWorkspace = {
      ...workspace,
      activePlan: {
        ...workspace.activePlan,
        version: 2,
        presentation: {
          ...workspace.activePlan.presentation,
          places: workspace.activePlan.presentation.places.map((place) => place.id === "market" ? { ...place, priority: "must" } : place)
        }
      }
    };
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({
      ...updatedWorkspace,
      workspace: updatedWorkspace,
      revision: {
        id: "direct-revision-batch-blueprint-priority-v1-to-v2",
        baseBlueprintVersion: 1,
        appliedBlueprintVersion: 2,
        createdAt: "2026-08-17T00:00:01.000Z",
        revisionCount: 1,
        kinds: ["update_place_priority"],
        affectedDayIds: [],
        affectedPlaceIds: ["market"],
        routeRefresh: { dayIds: [], movementIds: [], reason: "These place status updates do not change route order." },
        undo: { previousBlueprintVersion: 1, previousDays: [], previousMovements: [], previousPlaces: [workspace.activePlan.presentation.places[1]] },
        revisions: []
      }
    }) });
  });
  const agentRequests: unknown[] = [];
  await page.route("**/api/agent/chat", (route) => {
    agentRequests.push(route.request().postDataJSON());
    return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Agent route should not be used for direct place status updates." }) });
  });

  await page.goto("/");
  const sidePanel = page.getByLabel("Itinerary side panel");
  await expect(sidePanel.getByRole("button", { name: /Neighborhood Market/ })).toContainText("Fits your Lisbon day");
  await sidePanel.getByRole("button", { name: /Neighborhood Market/ }).click();
  await expect(sidePanel.getByRole("region", { name: "Place status" })).toHaveCount(0);
  await expect(sidePanel.getByRole("button", { name: "Must go", exact: true })).toBeVisible();
  await expect(sidePanel.getByRole("button", { name: "Prefer", exact: true })).toBeVisible();
  await expect(sidePanel.getByRole("button", { name: "Nearby", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(sidePanel.getByRole("button", { name: "Add to itinerary" })).toBeVisible();
  expect(directRevisionRequests).toEqual([]);
  expect(agentRequests).toEqual([]);
  await expect(page.getByRole("button", { name: "Refresh routes" })).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});

test("scheduled places can be removed through the direct Blueprint edit bar", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const workspace = {
    profile: { status: "ready", displayName: "Trip tester", preferredLanguage: "English", nationality: "Singapore", gender: "prefer_not_to_say", immigrationStatus: "short_term_visitor" },
    runtime: { selectedKind: "codex" },
    inbox: [],
    activePlan: {
      id: "remove-trip", version: 1, title: "Lisbon remove day", location: "Lisbon", dates: "2026-10-12", status: "draft", knownInformation: [], assumptions: [], nextAction: "Review.", createdAt: "2026-08-17T00:00:00.000Z",
      configuration: { accommodation: { status: "not_set" }, arrival: {}, transport: { preference: "plan_recommended" }, travelContext: { partySize: 2 } },
      stages: [],
      sources: [],
      presentation: {
        kind: "itinerary", summary: "Lisbon remove day", language: "en", startDate: "2026-10-12", endDate: "2026-10-12", cities: ["Lisbon"],
        days: [{ id: "d1", label: "October 12", shortLabel: "10/12", city: "Lisbon", title: "Neighborhood day", summary: "A compact day.", placeIds: ["anchor", "bookshop", "market"], stops: [{ placeId: "anchor", order: 1, time: "09:00" }, { placeId: "bookshop", order: 2, time: "11:00" }, { placeId: "market", order: 3, time: "13:00" }], candidates: [] }],
        places: [
          { id: "anchor", name: "Morning Museum", city: "Lisbon", area: "Baixa", locationLabel: "Baixa", coordinates: [38.711, -9.14], category: "museum", priority: "preferred", durationMinutes: 90, whyWorthIt: "A compact morning anchor.", plan: "Visit first.", detailSections: [], sourceRefs: [] },
          { id: "bookshop", name: "Neighborhood Bookshop", city: "Lisbon", area: "Chiado", locationLabel: "Chiado", coordinates: [38.7102, -9.1421], category: "bookstore shopping", priority: "preferred", durationMinutes: 45, whyWorthIt: "A compact shopping pause.", plan: "Use between the museum and market.", detailSections: [], sourceRefs: [] },
          { id: "market", name: "Neighborhood Market", city: "Lisbon", area: "Campo de Ourique", locationLabel: "Campo de Ourique", coordinates: [38.716, -9.166], category: "food market", display: { type: "dining", markerKind: "dining" }, priority: "nearby", durationMinutes: 60, whyWorthIt: "A flexible food stop.", plan: "Use after the bookshop.", detailSections: [], sourceRefs: [] }
        ],
        routeSegments: [
          { id: "route-1", dayId: "d1", originPlaceId: "anchor", destinationPlaceId: "bookshop", mode: "walking", verification: "verified", label: "Short walk", detail: "Verified walk.", sourceRefs: [] },
          { id: "route-2", dayId: "d1", originPlaceId: "bookshop", destinationPlaceId: "market", mode: "transit", verification: "verified", label: "Transit", detail: "Verified transit.", sourceRefs: [] }
        ]
      }
    }
  };
  let latestWorkspace = workspace;
  await page.route("**/api/workspace", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(editableWorkspace(latestWorkspace)) }));
  await page.route("**/api/plans/history", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/api/configuration", (route) => route.fulfill({ contentType: "application/json", body: "{}" }));
  await page.route("**/api/runtimes", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  const directRevisionRequests: unknown[] = [];
  await page.route("**/api/plans/remove-trip/blueprint-revisions/direct", async (route) => {
    const requestBody = route.request().postDataJSON();
    directRevisionRequests.push(requestBody);
    const updatedWorkspace = {
      ...workspace,
      activePlan: {
        ...workspace.activePlan,
        version: 2,
        presentation: {
          ...workspace.activePlan.presentation,
          days: [{ ...workspace.activePlan.presentation.days[0], placeIds: ["anchor", "market"], stops: [{ placeId: "anchor", order: 1, time: "09:00" }, { placeId: "market", order: 2, time: "13:00" }], candidates: ["bookshop"] }],
          routeSegments: [{ id: "route-1", dayId: "d1", originPlaceId: "anchor", destinationPlaceId: "market", mode: "transit", verification: "needs_verification", label: "Route needs refresh", detail: "This day was edited directly. Refresh routing, timing, meals, and opening constraints before execution.", sourceRefs: [] }]
        }
      }
    };
    latestWorkspace = updatedWorkspace;
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({
      ...updatedWorkspace,
      workspace: editableWorkspace(updatedWorkspace),
      revision: {
        ...revisionReceipt(workspace, updatedWorkspace, requestBody, { dayIds: ["d1"], movementIds: ["route-1"], reason: "These itinerary days were edited directly." })
      }
    }) });
  });
  const agentRequests: unknown[] = [];
  await page.route("**/api/agent/chat", (route) => {
    agentRequests.push(route.request().postDataJSON());
    return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Agent route should not be used for direct place removal." }) });
  });

  await page.goto("/");
  const timeline = page.locator(".blueprint-timeline-list");
  await expect(timeline.locator(".blueprint-itinerary-card-main strong")).toHaveText(["Morning Museum", "Neighborhood Bookshop", "Neighborhood Market"]);
  await timeline.locator(".blueprint-itinerary-card-main").filter({ hasText: "Neighborhood Market" }).click();
  const sidePanel = page.getByLabel("Itinerary side panel");
  await sidePanel.getByRole("button", { name: "Remove from day" }).click();
  await expect(page.getByText("1 unsaved change")).toBeVisible();
  await expect(timeline.locator(".blueprint-itinerary-card-main strong")).toHaveText(["Morning Museum", "Neighborhood Bookshop"]);
  await expect(page.locator(".blueprint-map-impact-notes")).toHaveCount(0);
  await sidePanel.getByRole("button", { name: "Undo draft" }).click();
  await expect(page.getByText("unsaved change")).toHaveCount(0);
  await expect(page.locator(".blueprint-map-impact-notes")).toHaveCount(0);
  await expect(timeline.locator(".blueprint-itinerary-card-main strong")).toHaveText(["Morning Museum", "Neighborhood Bookshop", "Neighborhood Market"]);

  await timeline.locator(".blueprint-itinerary-card-main").filter({ hasText: "Neighborhood Bookshop" }).click();
  await sidePanel.getByRole("button", { name: "Remove from day" }).click();
  await expect(page.getByText("1 unsaved change")).toBeVisible();
  await expect(timeline.locator(".blueprint-itinerary-card-main strong")).toHaveText(["Morning Museum", "Neighborhood Market"]);
  await expect(page.locator(".blueprint-map-impact-notes")).toHaveCount(0);
  const bookshopCard = sidePanel.locator(".blueprint-guide-card").filter({ hasText: "Neighborhood Bookshop" });
  await expect(bookshopCard).toContainText("Removed from 10-12 (not saved)");
  await expect(bookshopCard.getByRole("button", { name: "Add", exact: true })).toBeVisible();
  await bookshopCard.getByRole("button", { name: /Neighborhood Bookshop/ }).click();
  await expect(sidePanel.getByRole("heading", { name: "Neighborhood Bookshop" })).toBeVisible();
  await expect(sidePanel.getByText("Removed from 10-12 (not saved).")).toBeVisible();
  await expect(sidePanel.getByRole("button", { name: "Add to itinerary" })).toBeVisible();
  await expect(sidePanel.getByRole("button", { name: "Remove from day" })).toHaveCount(0);
  await sidePanel.getByRole("button", { name: "Undo draft" }).click();
  await expect(page.getByText("unsaved change")).toHaveCount(0);
  await expect(page.locator(".blueprint-map-impact-notes")).toHaveCount(0);
  await expect(timeline.locator(".blueprint-itinerary-card-main strong")).toHaveText(["Morning Museum", "Neighborhood Bookshop", "Neighborhood Market"]);
  await expect(bookshopCard).not.toContainText("not saved");
  await expect(bookshopCard.getByRole("button", { name: "Add", exact: true })).toHaveCount(0);

  await timeline.locator(".blueprint-itinerary-card-main").filter({ hasText: "Neighborhood Bookshop" }).click();
  await sidePanel.getByRole("button", { name: "Remove from day" }).click();
  await expect(page.getByText("1 unsaved change")).toBeVisible();
  await expect(timeline.locator(".blueprint-itinerary-card-main strong")).toHaveText(["Morning Museum", "Neighborhood Market"]);
  await page.getByRole("button", { name: "Apply" }).click();
  await expect.poll(() => directRevisionRequests.length).toBe(1);
  expect(directRevisionRequests[0]).toMatchObject({
    expectedVersion: 1,
    expectedBlueprintVersion: 1,
    revisions: [{ kind: "remove_place_from_day", placeId: "bookshop", dayId: "d1" }]
  });
  expect(agentRequests).toEqual([]);
  await expect(page.locator(".agent-status-float")).toHaveCount(0);
  await expect(page.locator(".inline-alert")).toHaveCount(0);
  await expect(timeline.locator(".blueprint-itinerary-card-main strong")).toHaveText(["Morning Museum", "Neighborhood Market"]);
  await expect(timeline.locator(".blueprint-itinerary-block > .blueprint-itinerary-time")).toHaveText(["09:00", "13:00"]);
  await expect(page.getByRole("button", { name: "Refresh routes" })).toHaveCount(0);
  await expect(page.getByText("Route and timing will be rechecked after confirmation.")).toHaveCount(0);
  await expect(bookshopCard).not.toContainText("not saved");
  await expect(bookshopCard.getByRole("button", { name: "Add", exact: true })).toBeVisible();
  await bookshopCard.getByRole("button", { name: /Neighborhood Bookshop/ }).click();
  await sidePanel.getByRole("button", { name: "Add to itinerary" }).click();
  await sidePanel.getByRole("button", { name: "Add to draft" }).click();
  await expect(page.getByText("1 unsaved change")).toBeVisible();
  await expect(timeline.getByRole("button", { name: /Pending itinerary edit for Neighborhood Bookshop/ })).toContainText("Not saved");
  await expect(page.locator(".blueprint-map-impact-notes")).toHaveCount(0);
  await expect(directRevisionRequests).toHaveLength(1);
  expect(pageErrors).toEqual([]);
});

test("same-day itinerary drag reorder stages and confirms a direct Blueprint move", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const workspace = {
    profile: { status: "ready", displayName: "Trip tester", preferredLanguage: "简体中文", nationality: "Singapore", gender: "prefer_not_to_say", immigrationStatus: "short_term_visitor" },
    runtime: { selectedKind: "codex" },
    inbox: [],
    activePlan: {
      id: "drag-trip", version: 1, title: "Tokyo route", location: "Tokyo", dates: "2026-10-12", status: "draft", knownInformation: [], assumptions: [], nextAction: "Review.", createdAt: "2026-08-17T00:00:00.000Z",
      configuration: { accommodation: { status: "not_set" }, arrival: {}, transport: { preference: "plan_recommended" }, travelContext: { partySize: 2 } },
      stages: [],
      sources: [],
      presentation: {
        kind: "itinerary", summary: "Tokyo route", language: "en", startDate: "2026-10-12", endDate: "2026-10-12", cities: ["Tokyo"],
        days: [{ id: "d1", label: "October 12", shortLabel: "10/12", city: "Tokyo", title: "Neighborhood day", summary: "A compact same-day route.", placeIds: ["a", "b", "c"], stops: [{ placeId: "a", order: 1, time: "09:00" }, { placeId: "b", order: 2 }, { placeId: "c", order: 3 }] }],
        places: [
          { id: "a", name: "Fixed Museum", city: "Tokyo", area: "Ueno", locationLabel: "Ueno", coordinates: [35.714, 139.774], category: "museum", priority: "preferred", durationMinutes: 90, whyWorthIt: "A timed morning anchor.", plan: "Visit at opening.", detailSections: [], sourceRefs: [] },
          { id: "b", name: "Book Street", city: "Tokyo", area: "Jimbocho", locationLabel: "Jimbocho", coordinates: [35.695, 139.758], category: "shopping street", priority: "preferred", durationMinutes: 60, whyWorthIt: "A flexible browsing stop.", plan: "Use after the anchor.", detailSections: [], sourceRefs: [] },
          { id: "c", name: "Coffee Stop", city: "Tokyo", area: "Kanda", locationLabel: "Kanda", coordinates: [35.691, 139.77], category: "coffee cafe", priority: "preferred", durationMinutes: 45, whyWorthIt: "A flexible rest stop.", plan: "Use when energy dips.", detailSections: [], sourceRefs: [] }
        ],
        routeSegments: []
      }
    }
  };
  await page.route("**/api/workspace", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(editableWorkspace(workspace)) }));
  await page.route("**/api/plans/history", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/api/configuration", (route) => route.fulfill({ contentType: "application/json", body: "{}" }));
  await page.route("**/api/runtimes", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  const directRevisionRequests: unknown[] = [];
  await page.route("**/api/plans/drag-trip/blueprint-revisions/direct", async (route) => {
    const requestBody = route.request().postDataJSON();
    directRevisionRequests.push(requestBody);
    const updatedWorkspace = {
      ...workspace,
      activePlan: {
        ...workspace.activePlan,
        version: 2,
        presentation: {
          ...workspace.activePlan.presentation,
          days: [{ ...workspace.activePlan.presentation.days[0], placeIds: ["a", "c", "b"], stops: [{ placeId: "a", order: 1, time: "09:00" }, { placeId: "c", order: 2 }, { placeId: "b", order: 3 }] }],
          routeSegments: [
            { id: "r1", dayId: "d1", originPlaceId: "a", destinationPlaceId: "c", mode: "walking", verification: "needs_verification", label: "Route needs refresh", detail: "This day was edited directly. Refresh routing, timing, meals, and opening constraints before execution.", sourceRefs: [] },
            { id: "r2", dayId: "d1", originPlaceId: "c", destinationPlaceId: "b", mode: "walking", verification: "needs_verification", label: "Route needs refresh", detail: "This day was edited directly. Refresh routing, timing, meals, and opening constraints before execution.", sourceRefs: [] }
          ]
        }
      }
    };
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({
      ...updatedWorkspace,
      workspace: editableWorkspace(updatedWorkspace),
      revision: {
        ...revisionReceipt(workspace, updatedWorkspace, requestBody, { dayIds: ["d1"], movementIds: ["r1", "r2"], reason: "This itinerary day was edited directly." })
      }
    }) });
  });

  await page.goto("/");
  const timeline = page.locator(".blueprint-timeline-list");
  await expect(timeline.getByRole("button", { name: /Move Fixed Museum/ })).toBeEnabled();
  await expect(timeline.getByRole("button", { name: /Move Coffee Stop/ })).toBeEnabled();
  const coffeeHandleBox = await timeline.getByRole("button", { name: /Move Coffee Stop/ }).boundingBox();
  const targetDropBox = await timeline.locator(".blueprint-itinerary-drop-zone").nth(1).boundingBox();
  if (!coffeeHandleBox || !targetDropBox) throw new Error("Drag handle or target drop zone is not visible.");
  await page.mouse.move(coffeeHandleBox.x + coffeeHandleBox.width / 2, coffeeHandleBox.y + coffeeHandleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetDropBox.x + targetDropBox.width / 2, targetDropBox.y + targetDropBox.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect(page.getByText("1 unsaved change")).toBeVisible();
  await expect(timeline.locator(".blueprint-itinerary-block.moved")).toHaveCount(0);
  await expect(timeline.locator(".blueprint-itinerary-card-main strong")).toHaveText(["Fixed Museum", "Coffee Stop", "Book Street"]);
  await expect(timeline.locator(".blueprint-itinerary-block > .blueprint-itinerary-time")).toHaveText(["09:00", "Flexible time", "Time to confirm"]);
  await expect(page.locator(".blueprint-map-impact-notes")).toHaveCount(0);

  const restoreDropZone = timeline.locator(".blueprint-itinerary-drop-zone").last();
  await restoreDropZone.scrollIntoViewIfNeeded();
  const movedCoffeeHandleBox = await timeline.getByRole("button", { name: /Move Coffee Stop/ }).boundingBox();
  const restoreDropBox = await restoreDropZone.boundingBox();
  if (!movedCoffeeHandleBox || !restoreDropBox) throw new Error("Restoring drag handle or drop zone is not visible.");
  await page.mouse.move(movedCoffeeHandleBox.x + movedCoffeeHandleBox.width / 2, movedCoffeeHandleBox.y + movedCoffeeHandleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(restoreDropBox.x + restoreDropBox.width / 2, restoreDropBox.y + restoreDropBox.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect(page.getByText("unsaved change")).toHaveCount(0);
  await expect(page.locator(".blueprint-map-impact-notes")).toHaveCount(0);
  await expect(timeline.locator(".blueprint-itinerary-card-main strong")).toHaveText(["Fixed Museum", "Book Street", "Coffee Stop"]);
  await expect(timeline.locator(".blueprint-itinerary-block > .blueprint-itinerary-time")).toHaveText(["09:00", "Flexible time", "Time to confirm"]);

  const secondCoffeeHandleBox = await timeline.getByRole("button", { name: /Move Coffee Stop/ }).boundingBox();
  const secondTargetDropBox = await timeline.locator(".blueprint-itinerary-drop-zone").nth(1).boundingBox();
  if (!secondCoffeeHandleBox || !secondTargetDropBox) throw new Error("Second drag handle or target drop zone is not visible.");
  await page.mouse.move(secondCoffeeHandleBox.x + secondCoffeeHandleBox.width / 2, secondCoffeeHandleBox.y + secondCoffeeHandleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(secondTargetDropBox.x + secondTargetDropBox.width / 2, secondTargetDropBox.y + secondTargetDropBox.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect(page.getByText("1 unsaved change")).toBeVisible();
  await expect(timeline.locator(".blueprint-itinerary-card-main strong")).toHaveText(["Fixed Museum", "Coffee Stop", "Book Street"]);
  await expect(timeline.locator(".blueprint-itinerary-block > .blueprint-itinerary-time")).toHaveText(["09:00", "Flexible time", "Time to confirm"]);
  await expect(page.locator(".blueprint-map-status")).toHaveCount(0);
  await expect(page.locator(".blueprint-map-impact-notes")).toHaveCount(0);
  await expect(page.getByText("After confirm", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Refresh routes" })).toHaveCount(0);

  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect.poll(() => directRevisionRequests.length).toBe(1);
  expect(directRevisionRequests[0]).toMatchObject({
    expectedVersion: 1,
    expectedBlueprintVersion: 1,
    revisions: [{ kind: "move_place_within_day", placeId: "c", dayId: "d1", position: { kind: "after", afterPlaceId: "a" } }]
  });
  await expect(page.getByText("unsaved change")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Refresh routes" })).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});
