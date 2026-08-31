import { expect, test } from "@playwright/test";

test("background Plan generation reports its stage and returns to a retryable proposal after failure", async ({ page }) => {
  let sessionStatus = "proposal_ready";
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
    facts: [{ key: "destination", value: "Tokyo", source: "user", confirmed: true, updatedAt: "2026-08-24T00:00:00.000Z" }],
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
    id: "empty-plan", version: 1, title: "No current plan", location: "Not set", dates: "Not set", status: "draft",
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
  await page.route("**/api/planning-sessions/generation-session/confirm", (route) => {
    sessionStatus = "generating";
    return route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({ workspace: workspace(), planningSession: { ...session, status: sessionStatus }, planningStatus: sessionStatus, generated: false, accepted: true, generation: { runId: "run-1", sessionId: session.id, stage: "queued", status: "running", startedAt: "2026-08-24T00:00:00.000Z", updatedAt: "2026-08-24T00:00:00.000Z" } })
    });
  });
  await page.route("**/api/planning-sessions/generation-session/generation", (route) => {
    if (!failGeneration) return route.fulfill({ contentType: "application/json", body: JSON.stringify({ sessionStatus: "generating", generation: { runId: "run-1", sessionId: session.id, stage: "research", status: "running", startedAt: "2026-08-24T00:00:00.000Z", updatedAt: "2026-08-24T00:00:01.000Z" } }) });
    sessionStatus = "proposal_ready";
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ sessionStatus, generation: { runId: "run-1", sessionId: session.id, stage: "failed", status: "failed", failureCode: "timed_out", message: "Generation timed out. Try again.", startedAt: "2026-08-24T00:00:00.000Z", updatedAt: "2026-08-24T00:00:02.000Z" } }) });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Generate plan" }).click();
  await expect(page.locator(".composer-status")).toContainText("Researching places by geographic area and saving each batch…");
  failGeneration = true;
  await page.evaluate(() => {
    (window as unknown as { __lastGenerationEventSource?: EventTarget }).__lastGenerationEventSource?.dispatchEvent(new Event("generation"));
  });
  await expect(page.locator(".composer-status")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Generate plan" })).toBeEnabled();
});
