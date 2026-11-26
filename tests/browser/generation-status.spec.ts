import { planningSaveReceipt } from "./planning-save-fixture";
import { test } from './evidence-test';
import { expect } from "@playwright/test";

const generatedPlan = {
  id: "plan-generated-1", version: 1, title: "Kyoto autumn tea trip", location: "Kyoto", dates: "2026-11-03 to 2026-11-06", status: "draft",
  knownInformation: ["Generated from this planning session"], assumptions: [], nextAction: "Review the complete plan.", createdAt: "2026-08-24T00:10:00.000Z",
  configuration: { accommodation: { status: "not_set" }, arrival: {}, transport: { preference: "plan_recommended" }, travelContext: { partySize: 1 } },
  stages: [{ id: "itinerary", title: "Itinerary", description: "Generated itinerary.", status: "not_started", presentationKind: "itinerary", tasks: [] }],
  sources: [],
  presentation: { kind: "timeline", summary: "Kyoto autumn tea trip", items: [] }
};

const starterPlan = {
  id: "starter", version: 1, title: "Attend an exhibition in Shanghai", location: "Shanghai", dates: "To be confirmed", status: "draft",
  knownInformation: [], assumptions: [], nextAction: "Create a plan.", createdAt: "2026-08-24T00:00:00.000Z",
  configuration: { accommodation: { status: "not_set" }, arrival: {}, transport: { preference: "plan_recommended" }, travelContext: {} },
  stages: [], sources: []
};

const readyFacts = [
  ["destination", "Kyoto"], ["purpose", "Tea and temples"], ["travel_dates", "2026-11-03 to 2026-11-06"],
  ["arrival", "Arrive at Kansai Airport at 10:00"], ["departure", "Depart Kansai Airport at 18:00"],
  ["party_size", "2"], ["transport_preference", "public transport"]
].map(([key, value]) => ({ key, value, source: "user", confirmed: true, updatedAt: "2026-08-24T00:00:00.000Z" }));

function planningSession(status: string, outputPlanId?: string) {
  return {
    id: "generation-session",
    status,
    objectiveType: "travel",
    messages: [{ id: "message-1", role: "assistant", text: "Generating your complete plan.", createdAt: "2026-08-24T00:00:00.000Z" }],
    facts: readyFacts,
    unresolved: [],
    deferred: [],
    proposal: {
      version: 1,
      title: "Kyoto autumn tea trip",
      objective: "A Kyoto tea trip",
      theme: "Tea and temples",
      segments: ["Arrival", "Core itinerary", "Departure"],
      skeleton: ["Arrive", "Explore", "Depart"],
      tradeoffs: ["Keep a comfortable pace"],
      assumptions: ["Accommodation can be added later"],
      decisionPoints: ["Confirm the direction"]
    },
    confirmedProposalVersion: 1,
    ...(outputPlanId ? { outputPlanId } : {}),
    createdAt: "2026-08-24T00:00:00.000Z",
    updatedAt: "2026-08-24T00:00:00.000Z"
  };
}

function workspace(status: string, activePlan = starterPlan, outputPlanId?: string) {
  return {
    profile: { status: "ready", displayName: "Tester", preferredLanguage: "English", nationality: "United States", gender: "prefer_not_to_say", immigrationStatus: "short_term_visitor" },
    runtime: { selectedKind: "codex" },
    activePlan,
    planningSession: planningSession(status, outputPlanId),
    destinationArrivals: [],
    inbox: [],
    officialSources: [],
    system: { core: "ready", storage: "local", runtime: "configured", telegram: "not_configured", amap: "not_configured" }
  };
}

async function routeStableShell(page: import("@playwright/test").Page) {
  await page.route("**/api/plans/history", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/api/configuration", (route) => route.fulfill({ contentType: "application/json", body: "{}" }));
  await page.route("**/api/runtimes", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/api/planning-sessions/generation-session/revision", (route) => route.fulfill({ json: { revision: 1 } }));
}

test("incomplete proposal never exposes Generate plan", async ({ page }) => {
  await routeStableShell(page);
  const incomplete = { ...planningSession("proposal_ready"), facts: readyFacts.slice(0, 2), unresolved: [] };
  await page.route("**/api/workspace", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ ...workspace("proposal_ready"), planningSession: incomplete }) }));

  await page.goto("/");
  await expect(page.locator(".planning-session-panel")).toBeVisible();
  await expect(page.getByRole("button", { name: "Generate plan" })).toHaveCount(0);
});

test("a saved budget without airfare coverage keeps the Generate plan card hidden until answered", async ({ page }) => {
  await routeStableShell(page);
  const budget = { key: "constraints", value: "Total budget around RMB 10,000", source: "user", confirmed: true, updatedAt: "2026-08-24T00:00:00.000Z" };
  let current = { ...workspace("proposal_ready"), planningSession: { ...planningSession("proposal_ready"), messages: [
    { id: "budget-message", role: "user", text: "We have a total budget around RMB 10,000.", createdAt: "2026-08-24T00:00:00.000Z" }
  ], facts: readyFacts } };
  await page.route("**/api/workspace", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(current) }));
  await page.route("**/api/agent/chat", (route) => {
    current = { ...current, planningSession: { ...current.planningSession, facts: [...readyFacts, budget, { key: "budget_scope", value: "excludes international flights", source: "user", confirmed: true, updatedAt: "2026-08-24T00:01:00.000Z" }], unresolved: [] } };
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ ...planningSaveReceipt(route, current.planningSession), reply: "All essential details are confirmed.", workspace: current, planningSession: current.planningSession, planningStatus: "proposal_ready", generated: false }) });
  });
  const revision = page.waitForResponse("**/api/planning-sessions/generation-session/revision");
  await page.goto("/");
  await revision;
  await expect(page.getByRole("button", { name: "Generate plan" })).toHaveCount(0);
  await page.locator("textarea").fill("不包含国际机票");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("button", { name: "Generate plan" })).toBeVisible();
});

test("a saved proposal awaiting another answer does not expose generation", async ({ page }) => {
  await routeStableShell(page);
  const question = "Please confirm your arrival airport and time.";
  const pending = {
    ...planningSession("proposal_confirmed"),
    messages: [{ id: "arrival-question", role: "assistant", text: question, createdAt: "2026-08-24T00:00:00.000Z" }],
    unresolved: [{ key: "arrival", question, impact: "high", status: "open" }]
  };
  await page.route("**/api/workspace", (route) => route.fulfill({ json: { ...workspace("proposal_confirmed"), planningSession: pending } }));
  await page.goto("/");
  await expect(page.locator(".chat-bubble.assistant").last()).toContainText(question);
  await expect(page.getByRole("button", { name: "Generate plan" })).toHaveCount(0);
});

test("an invalid date stays in chat for correction before generation becomes available", async ({ page }) => {
  await routeStableShell(page);
  let current: unknown = workspace("collecting");
  let turns = 0;
  const needsCorrection = {
    ...planningSession("proposal_ready"),
    facts: readyFacts.filter((fact) => fact.key !== "travel_dates"),
    unresolved: [{ key: "travel_dates", question: "Please correct the departure and return dates.", impact: "high", status: "open" }]
  };
  const correctedFacts = readyFacts.map((fact) => fact.key === "travel_dates" ? { ...fact, value: "2026-10-06 to 2026-10-16" } : fact);
  await page.route("**/api/workspace", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(current) }));
  await page.route("**/api/agent/chat", (route) => {
    turns += 1;
    const planningSession = turns === 1 ? needsCorrection : { ...needsCorrection, facts: correctedFacts, unresolved: [] };
    const reply = turns === 1
      ? "The return date is before departure. Please correct the dates."
      : "The corrected dates are clear. Review the details before generating.";
    current = { ...workspace("proposal_ready"), planningSession };
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ ...planningSaveReceipt(route, planningSession), reply, workspace: current, planningSession, planningStatus: "proposal_ready", generated: false }) });
  });

  await page.goto("/");
  const revision = page.waitForResponse("**/api/planning-sessions/generation-session/revision");
  await page.getByRole("button", { name: "Create Plan" }).click();
  await revision;
  await page.locator("textarea").fill("October 16 to October 6, 2026");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.locator(".chat-bubble.assistant").last()).toContainText("Please correct the dates");
  await expect(page.getByRole("button", { name: "Generate plan" })).toHaveCount(0);

  await page.locator("textarea").fill("October 6 to October 16, 2026");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("button", { name: "Generate plan" })).toBeVisible();
  await expect(page.locator(".generation-retry")).toContainText("2026-10-06 to 2026-10-16");
});

test("background Plan generation reports its stage and returns to a retryable proposal after failure", async ({ page }) => {
  let sessionStatus = "generating";
  let failGeneration = false;
  await page.addInitScript(() => {
    class MockEventSource extends EventTarget {
      url: string;
      constructor(url: string) {
        super();
        this.url = url;
        (window as unknown as { __lastGenerationEventSource?: EventTarget }).__lastGenerationEventSource = this;
      }
      close() {}
    }
    (window as unknown as { EventSource: typeof EventSource }).EventSource = MockEventSource as typeof EventSource;
  });
  const session = {
    id: "generation-session",
    status: sessionStatus,
    objectiveType: "travel",
    messages: [{ id: "message-1", role: "assistant", text: "Your trip details are ready.", createdAt: "2026-08-24T00:00:00.000Z" }],
    facts: readyFacts,
    unresolved: [],
    deferred: [],
    proposal: {
      version: 1,
      title: "Tokyo city trip",
      objective: "A Tokyo city trip",
      theme: "City exploration",
      segments: ["Arrival", "Core itinerary", "Departure"],
      skeleton: ["Arrive", "Explore", "Depart"],
      tradeoffs: ["Keep a comfortable pace"],
      assumptions: ["Accommodation can be added later"],
      decisionPoints: ["Confirm the direction"]
    },
    confirmedProposalVersion: 1,
    createdAt: "2026-08-24T00:00:00.000Z",
    updatedAt: "2026-08-24T00:00:00.000Z"
  };
  const activePlan = {
    id: "empty-plan", version: 1, title: "Attend an exhibition in Shanghai", location: "Not set", dates: "Not set", status: "draft",
    knownInformation: [], assumptions: [], nextAction: "Create a plan.", createdAt: "2026-08-24T00:00:00.000Z",
    configuration: { accommodation: { status: "not_set" }, arrival: {}, transport: { preference: "plan_recommended" }, travelContext: {} },
    stages: [], sources: []
  };
  const workspace = () => ({
    profile: { status: "ready", displayName: "Tester", preferredLanguage: "English", nationality: "United States", gender: "prefer_not_to_say", immigrationStatus: "short_term_visitor" },
    runtime: { selectedKind: "codex" },
    activePlan,
    planningSession: { ...session, status: sessionStatus },
    destinationArrivals: [],
    inbox: [],
    officialSources: [],
    system: { core: "ready", storage: "local", runtime: "configured", telegram: "not_configured", amap: "not_configured" }
  });

  await page.route("**/api/workspace", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(workspace()) }));
  await page.route("**/api/plans/history", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/api/configuration", (route) => route.fulfill({ contentType: "application/json", body: "{}" }));
  await page.route("**/api/runtimes", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/api/planning-sessions/generation-session/generation", (route) => {
    if (!failGeneration) return route.fulfill({ contentType: "application/json", body: JSON.stringify({ sessionStatus: "generating", generation: { runId: "run-1", sessionId: session.id, stage: "research", status: "running", startedAt: "2026-08-24T00:00:00.000Z", updatedAt: "2026-08-24T00:00:01.000Z" } }) });
    sessionStatus = "proposal_ready";
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ sessionStatus, generation: { runId: "run-1", sessionId: session.id, stage: "failed", status: "failed", failureCode: "timed_out", message: "Generation timed out. Try again.", startedAt: "2026-08-24T00:00:00.000Z", updatedAt: "2026-08-24T00:00:02.000Z" } }) });
  });

  await page.goto("/");
  await expect(page.locator(".chat-bubble.thinking")).toHaveCount(0);
  await expect(page.locator(".composer-status")).toContainText("Researching places by geographic area and saving each batch…");
  failGeneration = true;
  await page.evaluate(() => {
    (window as unknown as { __lastGenerationEventSource?: EventTarget }).__lastGenerationEventSource?.dispatchEvent(new Event("generation"));
  });
  await expect(page.locator(".composer-status")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Generate plan" })).toBeDisabled();
});

test("未配置 MAH 时工作台可打开，生成入口只引导并核对连接", async ({ page }) => {
  await routeStableShell(page);
  await page.route("**/api/workspace", (route) => route.fulfill({ json: workspace("proposal_ready") }));
  const mutations: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/") && request.method() !== "GET") mutations.push(request.method());
  });
  await page.route("**/api/agent-readiness", (route) => route.fulfill({ status: 503, json: {} }));
  await page.route("**/api/planning-sessions/generation-session/return-check*", (route) => route.fulfill({ status: 503, json: {} }));

  await page.goto("/");
  await expect(page.locator(".planning-session-panel")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const generate = page.getByRole("button", { name: "Generate plan" });
  await expect(generate).toBeDisabled();
  const guide = page.getByRole("region", { name: "MAH planning connection" });
  await expect(guide).toBeVisible();
  await expect(guide).toContainText("MAH configuration");
  await expect(guide).toContainText("Planning execution");
  await expect(guide).toContainText("Saved session");
  await guide.getByRole("button", { name: "Check again" }).click();
  await expect(guide).toContainText("Public execution is unverified");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(mutations).toEqual([]);
});

test("完整对话保留审阅并以三态内联指引核对", async ({ page }) => {
  await routeStableShell(page);
  let workspaceState = workspace("collecting");
  let confirmRequests = 0;
  const confirmedSession = { ...planningSession("proposal_ready"), confirmedProposalVersion: undefined };
  await page.route("**/api/workspace", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(workspaceState) }));
  await page.route("**/api/agent/chat", (route) => {
    workspaceState = { ...workspace("proposal_ready"), planningSession: confirmedSession };
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({
      ...planningSaveReceipt(route, confirmedSession),
      reply: "Thanks. Review the details, then generate your plan.",
      workspace: workspaceState,
      planningSession: confirmedSession,
      planningStatus: "proposal_ready",
      generated: false
    }) });
  });
  await page.route("**/api/planning-sessions/generation-session/confirm", (route) => {
    confirmRequests += 1;
    return route.abort("failed");
  });

  await page.goto("/");
  const revision = page.waitForResponse("**/api/planning-sessions/generation-session/revision");
  await page.getByRole("button", { name: "Create Plan" }).click();
  await revision;
  await page.locator("textarea").fill("Plan Mexico City with complete flights, dates, transport, and hotel-area preferences.");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.getByText("Review your trip details")).toBeVisible();
  await expect(page.getByRole("button", { name: "Generate plan" })).toBeVisible();
  expect(confirmRequests).toBe(0);
  await expect(page.getByRole("button", { name: "Generate plan" })).toBeDisabled();
  await expect(page.getByRole("region", { name: "MAH planning connection" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(confirmRequests).toBe(0);
});

test("current generation success automatically loads and opens its output Plan without an event", async ({ page }) => {
  await routeStableShell(page);
  let workspaceRequests = 0;
  await page.route("**/api/workspace", (route) => {
    workspaceRequests += 1;
    const body = workspaceRequests === 1
      ? workspace("generating")
      : workspace("draft_ready", generatedPlan, generatedPlan.id);
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.route("**/api/planning-sessions/generation-session/generation*", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ sessionStatus: "draft_ready", outputPlanId: generatedPlan.id, generation: { runId: "run-1", sessionId: "generation-session", generationKey: "generation-key-1", stage: "ready", status: "succeeded", startedAt: "2026-08-24T00:00:00.000Z", updatedAt: "2026-08-24T00:00:02.000Z" } }) }));

  await page.goto("/");

  await expect(page.getByRole("heading", { name: generatedPlan.title })).toBeVisible();
  await expect(page.getByRole("region", { name: "Tell Landi your goal" })).toHaveCount(0);
  expect(workspaceRequests).toBeGreaterThan(1);
});

test("saved draft opens when the workspace no longer includes the finished planning session", async ({ page }) => {
  await routeStableShell(page);
  let workspaceRequests = 0;
  await page.route("**/api/workspace", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify(++workspaceRequests === 1
      ? workspace("generating")
      : { ...workspace("draft_ready", generatedPlan, generatedPlan.id), planningSession: null })
  }));
  await page.route("**/api/planning-sessions/generation-session/generation*", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ sessionStatus: "draft_ready", outputPlanId: generatedPlan.id, generation: { runId: "run-1", sessionId: "generation-session", generationKey: "generation-key-1", stage: "ready", status: "succeeded", startedAt: "2026-08-24T00:00:00.000Z", updatedAt: "2026-08-24T00:00:02.000Z" } }) }));

  await page.goto("/");
  await expect(page.getByRole("heading", { name: generatedPlan.title })).toBeVisible();
  await expect(page.getByRole("region", { name: "Tell Landi your goal" })).toHaveCount(0);
});

test("history refresh failure does not block opening the saved output Plan", async ({ page }) => {
  let workspaceRequests = 0;
  let historyRequests = 0;
  await page.route("**/api/plans/history", (route) => {
    historyRequests += 1;
    if (historyRequests === 1) return route.fulfill({ contentType: "application/json", body: "[]" });
    return route.abort("failed");
  });
  await page.route("**/api/configuration", (route) => route.fulfill({ contentType: "application/json", body: "{}" }));
  await page.route("**/api/runtimes", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/api/workspace", (route) => {
    workspaceRequests += 1;
    const body = workspaceRequests === 1
      ? workspace("generating")
      : workspace("draft_ready", generatedPlan, generatedPlan.id);
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.route("**/api/planning-sessions/generation-session/generation*", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ sessionStatus: "draft_ready", outputPlanId: generatedPlan.id, generation: { runId: "run-1", sessionId: "generation-session", generationKey: "generation-key-1", stage: "ready", status: "succeeded", startedAt: "2026-08-24T00:00:00.000Z", updatedAt: "2026-08-24T00:00:02.000Z" } }) }));

  await page.goto("/");

  await expect(page.getByRole("heading", { name: generatedPlan.title })).toBeVisible();
  await expect(page.getByRole("region", { name: "Tell Landi your goal" })).toHaveCount(0);
  expect(historyRequests).toBeGreaterThan(1);
});

test("duplicate generation success does not repeatedly reload history or reopen navigation", async ({ page }) => {
  await routeStableShell(page);
  let workspaceRequests = 0;
  let historyRequests = 0;
  await page.route("**/api/plans/history", (route) => {
    historyRequests += 1;
    return route.fulfill({ contentType: "application/json", body: "[]" });
  });
  await page.route("**/api/workspace", (route) => {
    workspaceRequests += 1;
    const body = workspaceRequests === 1
      ? workspace("generating")
      : workspace("draft_ready", generatedPlan, generatedPlan.id);
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.route("**/api/planning-sessions/generation-session/generation*", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ sessionStatus: "draft_ready", outputPlanId: generatedPlan.id, generation: { runId: "run-1", sessionId: "generation-session", generationKey: "generation-key-1", stage: "ready", status: "succeeded", startedAt: "2026-08-24T00:00:00.000Z", updatedAt: "2026-08-24T00:00:02.000Z" } }) }));

  await page.goto("/");
  await expect(page.getByRole("heading", { name: generatedPlan.title })).toBeVisible();
  const afterOpenHistoryRequests = historyRequests;
  await page.waitForTimeout(200);

  expect(historyRequests).toBe(afterOpenHistoryRequests);
});

test("late success for an old generation does not override the current waiting session", async ({ page }) => {
  await routeStableShell(page);
  const newSessionWorkspace = { ...workspace("generating"), planningSession: { ...planningSession("generating"), id: "new-generation-session" } };
  await page.route("**/api/workspace", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(newSessionWorkspace) }));
  await page.route("**/api/planning-sessions/new-generation-session/generation", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ sessionStatus: "generating", generation: { runId: "run-new", sessionId: "new-generation-session", generationKey: "generation-key-new", stage: "research", status: "running", startedAt: "2026-08-24T00:00:00.000Z", updatedAt: "2026-08-24T00:00:01.000Z" } }) }));
  await page.route("**/api/planning-sessions/generation-session/generation", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ sessionStatus: "draft_ready", outputPlanId: generatedPlan.id, generation: { runId: "run-old", sessionId: "generation-session", generationKey: "generation-key-old", stage: "ready", status: "succeeded", startedAt: "2026-08-24T00:00:00.000Z", updatedAt: "2026-08-24T00:00:02.000Z" } }) }));

  await page.goto("/");

  await expect(page.locator(".planning-session-panel")).toBeVisible();
  await expect(page.getByRole("heading", { name: generatedPlan.title })).toHaveCount(0);
});

test("research-stage progress does not open the plan early", async ({ page }) => {
  await routeStableShell(page);
  await page.route("**/api/workspace", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(workspace("generating")) }));
  await page.route("**/api/planning-sessions/generation-session/generation", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ sessionStatus: "generating", generation: { runId: "run-1", sessionId: "generation-session", generationKey: "generation-key-1", stage: "research", status: "running", startedAt: "2026-08-24T00:00:00.000Z", updatedAt: "2026-08-24T00:00:01.000Z" } }) }));

  await page.goto("/");

  await expect(page.locator(".composer-status")).toContainText("Researching places by geographic area and saving each batch…");
  await expect(page.getByRole("heading", { name: generatedPlan.title })).toHaveCount(0);
});

test("failed and cancelled generation do not navigate to an old draft", async ({ page }) => {
  await routeStableShell(page);
  await page.route("**/api/workspace", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(workspace("proposal_ready")) }));
  await page.route("**/api/planning-sessions/generation-session/generation", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ sessionStatus: "proposal_ready", generation: { runId: "run-1", sessionId: "generation-session", generationKey: "generation-key-1", stage: "failed", status: "failed", failureCode: "timed_out", message: "Generation timed out. Try again.", startedAt: "2026-08-24T00:00:00.000Z", updatedAt: "2026-08-24T00:00:02.000Z" } }) }));

  await page.goto("/");

  await expect(page.getByRole("button", { name: "Generate plan" })).toBeDisabled();
  await expect(page.getByRole("heading", { name: generatedPlan.title })).toHaveCount(0);
});

test("generation success does not steal navigation after the user leaves the waiting page", async ({ page }) => {
  await routeStableShell(page);
  let workspaceRequests = 0;
  await page.route("**/api/workspace", (route) => {
    workspaceRequests += 1;
    const body = workspaceRequests < 3
      ? workspace("generating")
      : workspace("draft_ready", generatedPlan, generatedPlan.id);
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.route("**/api/planning-sessions/generation-session/generation", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ sessionStatus: "draft_ready", outputPlanId: generatedPlan.id, generation: { runId: "run-1", sessionId: "generation-session", generationKey: "generation-key-1", stage: "ready", status: "succeeded", startedAt: "2026-08-24T00:00:00.000Z", updatedAt: "2026-08-24T00:00:02.000Z" } }) }));

  await page.goto("/");
  await expect(page.locator(".planning-session-panel")).toBeVisible();
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Profile" })).toBeVisible();
  await expect.poll(() => workspaceRequests, { timeout: 8_000 }).toBeGreaterThanOrEqual(3);

  await expect(page.getByRole("heading", { name: "Profile" })).toBeVisible();
  await expect(page.getByRole("heading", { name: generatedPlan.title })).toHaveCount(0);
});

test("saved generation result survives a temporary workspace reload failure", async ({ page }) => {
  await page.addInitScript(() => {
    class MockEventSource extends EventTarget {
      url: string;
      constructor(url: string) {
        super();
        this.url = url;
        (window as unknown as { __lastGenerationEventSource?: EventTarget }).__lastGenerationEventSource = this;
      }
      close() {}
    }
    (window as unknown as { EventSource: typeof EventSource }).EventSource = MockEventSource as typeof EventSource;
  });
  await routeStableShell(page);
  let workspaceRequests = 0;
  let generationRequests = 0;
  await page.route("**/api/workspace", (route) => {
    workspaceRequests += 1;
    if (workspaceRequests === 1) return route.fulfill({ contentType: "application/json", body: JSON.stringify(workspace("generating")) });
    return route.abort("failed");
  });
  await page.route("**/api/planning-sessions/generation-session/generation", (route) => {
    generationRequests += 1;
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ sessionStatus: "draft_ready", outputPlanId: generatedPlan.id, generation: { runId: "run-1", sessionId: "generation-session", generationKey: "generation-key-1", stage: "ready", status: "succeeded", startedAt: "2026-08-24T00:00:00.000Z", updatedAt: "2026-08-24T00:00:02.000Z" } }) });
  });

  await page.goto("/");
  await expect.poll(async () => await page.evaluate(() => Boolean((window as unknown as { __lastGenerationEventSource?: EventTarget }).__lastGenerationEventSource))).toBe(true);
  await page.evaluate(() => {
    (window as unknown as { __lastGenerationEventSource?: EventTarget }).__lastGenerationEventSource?.dispatchEvent(new Event("generation"));
  });
  await expect.poll(() => generationRequests).toBeGreaterThan(0);

  await expect(page.locator(".composer-status")).toContainText(`Plan saved. Loading draft ${generatedPlan.id}`);
  await expect(page.locator(".inline-alert")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: generatedPlan.title })).toHaveCount(0);
});
