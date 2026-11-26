import { planningSaveReceipt } from "./planning-save-fixture";
import { test } from './evidence-test';
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { bookingRelationshipDigest, bookingRelationshipSourceUnits } from "../../packages/core/lib/booking-relationship.js";
import { blueprintBookingConstraintsFromTravelBookings } from "../../packages/core/lib/booking-projection.js";
import type { TravelBooking, WorkspaceSnapshot } from "../../packages/core/lib/index.js";
import type { BookingImportConfirmBody } from "../../apps/web/src/api-client.js";

const fixtureRoot = join(process.cwd(), "tests", "fixtures", "booking-emails");

const samples = {
  flight: readFileSync(join(fixtureRoot, "flight-confirmation.eml"), "utf8"),
  flightForwardedCopy: readFileSync(join(fixtureRoot, "flight-confirmation-forwarded-copy.eml"), "utf8"),
  mimeBase64Flight: readFileSync(join(fixtureRoot, "mime-base64-flight.eml"), "utf8"),
  mimeQuotedPrintableHotel: readFileSync(join(fixtureRoot, "mime-quoted-printable-hotel.eml"), "utf8"),
  roundTripFlight: readFileSync(join(fixtureRoot, "round-trip-flight-confirmation.eml"), "utf8"),
  hotel: readFileSync(join(fixtureRoot, "hotel-confirmation.eml"), "utf8"),
  rentalCar: readFileSync(join(fixtureRoot, "rental-car-confirmation.eml"), "utf8")
};

async function currentSessionBaseline(request: APIRequestContext) {
  const response = await request.get("/api/planning-sessions/bookings/context");
  expect(response.ok()).toBe(true);
  const baseline = await response.json();
  expect(baseline).toHaveProperty("expectedSessionId");
  expect(Array.isArray(baseline.records)).toBe(true);
  expect(Number.isSafeInteger(baseline.revision)).toBe(true);
  return baseline;
}

function currentSessionBody(baseline: Awaited<ReturnType<typeof currentSessionBaseline>>, booking: TravelBooking, sourceContent: string): BookingImportConfirmBody {
  const record = baseline.records.find((item: { bookingId: string }) => item.bookingId === booking.id);
  return { requestId: randomUUID(), expectedSessionId: baseline.expectedSessionId, expectedRevision: baseline.revision, booking, sourceContent, ...(record ? { expectedRecordDigest: record.recordDigest } : {}) };
}

// 模拟服务保留真实请求身份、记录版本和回执，不能用任意成功工作区替代核对。
async function mockImportStore(page: Page, initialWorkspace: object, target: { sessionId: string } | { planId: string }, loseResponse = false) {
  let workspace = { ...initialWorkspace, sourceSnapshots: [], system: { core: "ready", storage: "local", runtime: "configured", amap: "not_configured" } } as WorkspaceSnapshot;
  let revision = 1;
  const bookings: TravelBooking[] = [];
  const payloads: BookingImportConfirmBody[] = [];
  const receipts = new Map<string, object>();
  const sourceSetDigest = () => bookingRelationshipDigest(bookings.map(booking => ({ id: booking.id, digest: bookingRelationshipDigest(bookingRelationshipSourceUnits(blueprintBookingConstraintsFromTravelBookings([booking]))) })).sort((a, b) => a.id.localeCompare(b.id)));
  const scopeId = "sessionId" in target ? target.sessionId : target.planId;
  const base = "sessionId" in target ? `/api/planning-sessions/${scopeId}` : `/api/plans/${scopeId}`;
  await page.route("**/api/workspace", route => route.fulfill({ json: workspace }));
  await page.route(`**${base}/revision`, route => route.fulfill({ json: { revision } }));
  await page.route(`**${base}/bookings`, route => route.fulfill({ json: {
    bookings, records: bookings.map(booking => ({ bookingId: booking.id, recordDigest: bookingRelationshipDigest(booking) })),
    ...("sessionId" in target ? { revision } : { expectedPlanId: scopeId, expectedVersion: workspace.activePlan.version, sourceSetDigest: sourceSetDigest() })
  } }));
  await page.route(`**${base}/bookings/import-confirm`, async route => {
    const body = route.request().postDataJSON() as BookingImportConfirmBody;
    expect(body.requestId).toBeTruthy();
    expect(payloads.some(previous => previous.requestId === body.requestId)).toBe(false);
    expect(body.booking.planningSessionId ?? body.booking.planId).toBe(scopeId);
    if ("sessionId" in target) expect(body.expectedRevision).toBe(revision);
    else {
      expect(body.expectedVersion).toBe(workspace.activePlan.version);
      expect(body.expectedSourceSetDigest).toBe(sourceSetDigest());
      expect(workspace.activePlan.status).toBe("draft");
    }
    payloads.push(body);
    bookings.push(body.booking);
    const { booking, sourceContent: _privateContent, requestId, ...versions } = body;
    const identity = { operation: "import_booking", targetKind: "sessionId" in target ? "session" : "plan", targetId: scopeId, ...versions, bookingId: booking.id };
    const resultIdentity = "sessionId" in target ? { sessionId: scopeId, revision: ++revision } : { planId: scopeId, planVersion: workspace.activePlan.version + 1 };
    if ("planId" in target) workspace = { ...workspace, activePlan: { ...workspace.activePlan, version: workspace.activePlan.version + 1 } };
    const receipt = { requestId, requestDigest: bookingRelationshipDigest({ scope: scopeId, body }), status: "committed", originalRequest: identity, originalResult: { originalRequest: identity, bookingId: booking.id, ...resultIdentity }, workspace };
    receipts.set(requestId, receipt);
    if (loseResponse) return route.abort("failed");
    return route.fulfill({ json: { workspace, booking, ...("sessionId" in target ? { planningSession: workspace.planningSession } : { requiresBlueprintRevision: false }) } });
  });
  await page.route("**/api/booking-mutations/receipts/**", route => {
    const url = new URL(route.request().url());
    const receipt = receipts.get(url.pathname.split("/").at(-1)!) as { requestDigest: string; originalRequest: object } | undefined;
    expect(receipt).toBeDefined();
    expect(url.searchParams.get("requestDigest")).toBe(receipt!.requestDigest);
    expect(JSON.parse(url.searchParams.get("identity")!)).toEqual(receipt!.originalRequest);
    return route.fulfill({ json: receipt });
  });
  return { payloads, bookings };
}

test("planner exposes booking import when Landi asks for booking evidence", async ({ page }) => {
  const workspace = {
    profile: { status: "ready", displayName: "Tester", preferredLanguage: "English", nationality: "United States", gender: "prefer_not_to_say", immigrationStatus: "short_term_visitor" },
    runtime: { selectedKind: "codex" },
    activePlan: {
      id: "starter", version: 1, title: "Attend an exhibition in Shanghai", location: "Shanghai", dates: "To be confirmed", status: "draft",
      knownInformation: [], assumptions: [], nextAction: "Create a plan.", createdAt: "2026-08-27T00:00:00.000Z",
      configuration: { accommodation: { status: "not_set" }, arrival: {}, transport: { preference: "plan_recommended" }, travelContext: { luggage: "unknown" } },
      stages: [], sources: []
    },
    destinationArrivals: [], inbox: [], officialSources: []
  };

  await page.route("**/api/workspace", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(workspace) }));
  await page.route("**/api/plans/history", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/api/configuration", (route) => route.fulfill({ contentType: "application/json", body: "{}" }));
  await page.route("**/api/runtimes", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));

  const planningSession = {
    id: "booking-intake", status: "collecting", objectiveType: "travel",
    messages: [], facts: [], unresolved: [], deferred: [],
    createdAt: "2026-08-27T00:00:00.000Z", updatedAt: "2026-08-27T00:00:00.000Z"
  };
  await page.route("**/api/agent/chat", (route) => route.fulfill({ json: {
    ...planningSaveReceipt(route, planningSession),
    reply: "Do you have any flight or hotel bookings?",
    workspace: { ...workspace, planningSession }, planningSession, generated: false
  } }));
  await page.route("**/api/planning-sessions/booking-intake/revision", (route) => route.fulfill({ json: { revision: 1 } }));
  await page.route("**/api/planning-sessions/booking-intake/bookings", (route) => route.fulfill({ json: { bookings: [] } }));
  await page.goto("/");
  await page.getByRole("button", { name: "Start planning" }).click();
  const upload = page.getByRole("button", { name: "Upload booking" });
  await expect(upload).toHaveCount(0);
  await page.getByPlaceholder("Chat with Landi").fill("I'd like to visit Tokyo.");
  await page.getByRole("button", { name: "Send" }).click();
  await upload.click();
  const panel = page.locator(".booking-import-panel");
  await expect(panel.getByLabel("Upload .eml, .html, or .txt")).toBeVisible();
  await expect(panel.getByLabel("Paste confirmation text")).toBeVisible();
});

test("real booking import API parses realistic confirmation emails", async ({ request }) => {
  const expectations = [
    { label: "United confirmation.eml", content: samples.flight, type: "flight", start: "2026-10-08T10:00", end: "2026-10-09T14:30", endpoint: "HND", segmentCount: 1 },
    { label: "United round-trip confirmation.eml", content: samples.roundTripFlight, type: "flight", start: "2026-10-08T10:00", end: "2026-10-14T10:55", endpoint: "SFO", segmentCount: 2 },
    { label: "Shinjuku hotel confirmation.eml", content: samples.hotel, type: "accommodation", start: "2026-10-09T15:00", end: "2026-10-13T11:00", endpoint: "3-12-8 Shinjuku, Tokyo" },
    { label: "Northstar rental car confirmation.eml", content: samples.rentalCar, type: "rental_car", start: "2026-10-14T09:30", end: "2026-10-17T18:00", endpoint: "Los Angeles International Airport" }
  ];

  for (const item of expectations) {
    const baseline = await currentSessionBaseline(request);
    const previewResponse = await request.post("/api/planning-sessions/bookings/import-preview", { data: { sourceLabel: item.label, content: item.content } });
    expect(previewResponse.ok()).toBe(true);
    const preview = await previewResponse.json();
    const booking = preview.bookings[0];
    expect(booking.type).toBe(item.type);
    expect(booking.sourceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(booking)).not.toContain("ABC12345");
    expect(JSON.stringify(booking)).not.toContain("RT998877");
    expect(JSON.stringify(booking)).not.toContain("CAR-556677");
    expect(JSON.stringify(booking)).not.toContain("paid with card");
    if (item.segmentCount) expect(booking.segments).toHaveLength(item.segmentCount);
    expect(booking.segments.some((segment: { startAtLocal?: string }) => segment.startAtLocal === item.start)).toBe(true);
    expect(booking.segments.some((segment: { endAtLocal?: string; destination?: string; location?: string }) => segment.endAtLocal === item.end || segment.destination === item.endpoint || segment.location === item.endpoint)).toBe(true);

    const body = currentSessionBody(baseline, booking, item.content);
    const confirmResponse = await request.post("/api/planning-sessions/bookings/import-confirm", { data: body });
    expect(confirmResponse.ok()).toBe(true);
    const confirmed = await confirmResponse.json();
    expect(confirmed.booking.type).toBe(item.type);
    expect(JSON.stringify(confirmed.workspace)).not.toContain("paid with card");
    expect(JSON.stringify(confirmed.workspace)).not.toContain("ABC12345");
    expect(JSON.stringify(confirmed.workspace)).not.toContain("RT998877");
    const replayResponse = await request.post("/api/planning-sessions/bookings/import-confirm", { data: body });
    expect(replayResponse.ok()).toBe(true);
    const replay = await replayResponse.json();
    expect(replay.status).toBe("committed");
    expect(replay.requestId).toBe(body.requestId);
    expect(replay.requestDigest).toBe(bookingRelationshipDigest(body));
    expect(replay.originalResult.bookingId).toBe(confirmed.booking.id);
    expect(replay.originalResult.revision).toBe(baseline.revision + 1);
  }
});

test("real booking import API reads MIME encoded email bodies", async ({ request }) => {
  const flightResponse = await request.post("/api/planning-sessions/bookings/import-preview", { data: { sourceLabel: "mime-base64-flight.eml", content: samples.mimeBase64Flight } });
  expect(flightResponse.ok()).toBe(true);
  const flightPreview = await flightResponse.json();
  const flight = flightPreview.bookings[0];
  expect(flight.type).toBe("flight");
  expect(flight.segments[0].startAtLocal).toBe("2026-10-08T10:00");
  expect(flight.segments[0].destination).toBe("HND");

  const hotelResponse = await request.post("/api/planning-sessions/bookings/import-preview", { data: { sourceLabel: "mime-quoted-printable-hotel.eml", content: samples.mimeQuotedPrintableHotel } });
  expect(hotelResponse.ok()).toBe(true);
  const hotelPreview = await hotelResponse.json();
  const hotel = hotelPreview.bookings[0];
  expect(hotel.type).toBe("accommodation");
  expect(hotel.segments[0].startAtLocal).toBe("2026-10-09T15:00");
  expect(hotel.segments[0].endAtLocal).toBe("2026-10-13T11:00");
  expect(hotel.segments[0].location).toBe("3-12-8 Shinjuku, Tokyo");
  expect(JSON.stringify(hotel)).not.toContain("<html>");
});

test("real booking import API marks likely duplicate confirmations", async ({ request }) => {
  const baseline = await currentSessionBaseline(request);
  const firstPreviewResponse = await request.post("/api/planning-sessions/bookings/import-preview", { data: { sourceLabel: "United confirmation.eml", content: samples.flight } });
  expect(firstPreviewResponse.ok()).toBe(true);
  const firstPreview = await firstPreviewResponse.json();
  const confirmResponse = await request.post("/api/planning-sessions/bookings/import-confirm", { data: currentSessionBody(baseline, firstPreview.bookings[0], samples.flight) });
  expect(confirmResponse.ok()).toBe(true);
  const confirmed = await confirmResponse.json();
  const sessionId = confirmed.planningSession.id;
  const sessionResponse = await request.get(`/api/planning-sessions/${sessionId}/bookings`);
  expect(sessionResponse.ok()).toBe(true);
  const sessionBaseline = await sessionResponse.json();
  expect(sessionBaseline.revision).toBe(baseline.revision + 1);
  expect(sessionBaseline.records).toContainEqual({ bookingId: confirmed.booking.id, recordDigest: bookingRelationshipDigest(confirmed.booking) });

  const exactDuplicateResponse = await request.post(`/api/planning-sessions/${sessionId}/bookings/import-preview`, { data: { sourceLabel: "United confirmation again.eml", content: samples.flight } });
  expect(exactDuplicateResponse.ok()).toBe(true);
  expect((await exactDuplicateResponse.json()).duplicate).toBe(true);

  const likelyDuplicateResponse = await request.post(`/api/planning-sessions/${sessionId}/bookings/import-preview`, { data: { sourceLabel: "Forwarded United confirmation.eml", content: samples.flightForwardedCopy } });
  expect(likelyDuplicateResponse.ok()).toBe(true);
  const likelyDuplicate = await likelyDuplicateResponse.json();
  expect(likelyDuplicate.duplicate).toBe(false);
  expect(likelyDuplicate.possibleDuplicate).toBe(true);
});

test("real Plan booking import updates Plan-linked logistics", async ({ request }) => {
  const workspaceResponse = await request.get("/api/workspace");
  expect(workspaceResponse.ok()).toBe(true);
  const workspace = await workspaceResponse.json();
  const planId = workspace.activePlan.id;
  const expectedVersion = workspace.activePlan.version;
  const bookingsResponse = await request.get(`/api/plans/${planId}/bookings`);
  expect(bookingsResponse.ok()).toBe(true);
  const baseline = await bookingsResponse.json();
  expect(baseline.expectedPlanId).toBe(planId);
  expect(baseline.expectedVersion).toBe(expectedVersion);
  expect(Array.isArray(baseline.records)).toBe(true);
  let expectedSourceSetDigest = baseline.sourceSetDigest;
  let expectedBlueprintVersion: number | undefined;
  let records = baseline.records as { bookingId: string; recordDigest: string }[];
  if (workspace.activeBlueprint) {
    const contextResponse = await request.get(`/api/plans/${planId}/booking-relationship-review`);
    expect(contextResponse.ok()).toBe(true);
    const context = await contextResponse.json();
    expect(context.expectedVersion).toBe(expectedVersion);
    expect(context.blueprintVersion).toBe(workspace.activeBlueprint.version);
    expectedBlueprintVersion = context.blueprintVersion;
    expectedSourceSetDigest = context.sourceSetDigest;
    records = context.sourceRecords;
    for (const record of records) expect(baseline.records).toContainEqual({ bookingId: record.bookingId, recordDigest: record.recordDigest });
  }
  expect(expectedSourceSetDigest).toMatch(/^[a-f0-9]{64}$/);

  const previewResponse = await request.post(`/api/plans/${planId}/bookings/import-preview`, { data: { sourceLabel: "Shinjuku hotel confirmation.eml", content: samples.hotel } });
  expect(previewResponse.ok()).toBe(true);
  const preview = await previewResponse.json();
  const booking = preview.bookings[0];
  expect(booking.type).toBe("accommodation");

  const record = records.find(item => item.bookingId === booking.id);
  const body = { requestId: randomUUID(), booking, expectedVersion, expectedSourceSetDigest, ...(expectedBlueprintVersion !== undefined ? { expectedBlueprintVersion } : {}), ...(record ? { expectedRecordDigest: record.recordDigest } : {}), sourceContent: samples.hotel };
  const confirmResponse = await request.post(`/api/plans/${planId}/bookings/import-confirm`, { data: body });
  expect(confirmResponse.ok()).toBe(true);
  const confirmed = await confirmResponse.json();
  expect(confirmed.requiresBlueprintRevision).toBe(false);
  expect(confirmed.workspace.activePlan.configuration.accommodation.status).toBe("confirmed");
  expect(confirmed.workspace.activePlan.configuration.accommodation.location).toBe("3-12-8 Shinjuku, Tokyo");
  expect(JSON.stringify(confirmed.workspace)).not.toContain("HTL-998877");
  expect(JSON.stringify(confirmed.workspace)).not.toContain("Example Traveler");
  const replayResponse = await request.post(`/api/plans/${planId}/bookings/import-confirm`, { data: body });
  expect(replayResponse.ok()).toBe(true);
  const replay = await replayResponse.json();
  expect(replay.status).toBe("committed");
  expect(replay.requestDigest).toBe(bookingRelationshipDigest({ scope: planId, body }));
  expect(replay.originalResult.bookingId).toBe(confirmed.booking.id);
  expect(replay.originalResult.planId).toBe(confirmed.workspace.activePlan.id);
});

test("粘贴航班确认后丢失响应，刷新仅查询原回执且不重发私密正文", async ({ page }) => {
  const activePlan = {
    id: "empty-plan", version: 1, title: "Attend an exhibition in Shanghai", location: "Not set", dates: "Not set", status: "draft",
    knownInformation: [], assumptions: [], nextAction: "Create a plan.", createdAt: "2026-08-27T00:00:00.000Z",
    configuration: { accommodation: { status: "not_set" }, arrival: {}, transport: { preference: "plan_recommended" }, travelContext: { luggage: "unknown" } },
    stages: [], sources: []
  };
  const planningSession = {
    id: "booking-session", status: "proposal_ready", objectiveType: "travel", messages: [{ id: "ask-booking", role: "assistant", text: "Do you have any flight or hotel bookings?", createdAt: "2026-08-27T00:00:00.000Z" }], facts: [], unresolved: [], deferred: [],
    proposal: { version: 1, title: "Tokyo trip", objective: "Tokyo architecture", theme: "Architecture", segments: [], skeleton: [], tradeoffs: [], assumptions: [], decisionPoints: [] },
    createdAt: "2026-08-27T00:00:00.000Z", updatedAt: "2026-08-27T00:00:00.000Z"
  };
  const workspace = { profile: { status: "ready", displayName: "Tester", preferredLanguage: "English", nationality: "United States", gender: "prefer_not_to_say", immigrationStatus: "short_term_visitor" }, runtime: { selectedKind: "codex" }, activePlan, planningSession, destinationArrivals: [], inbox: [], officialSources: [] };
  const previewBooking = {
    id: "booking-ui-flight", planningSessionId: planningSession.id, type: "flight", status: "confirmed", title: "United Meridian Flight booking", source: "imported_email", sourceHash: "a".repeat(64), sourceLabel: "Pasted flight confirmation", importedAt: "2026-08-27T00:00:00.000Z", updatedAt: "2026-08-27T00:00:00.000Z", constraintStrength: "hard",
    segments: [{ id: "segment-ui-flight", segmentType: "flight_leg", title: "Flight booking", status: "confirmed", startAtLocal: "2026-10-08T10:00", endAtLocal: "2026-10-09T14:30", origin: "SFO", destination: "HND", constraintStrength: "hard", fixedCommitment: true, needsReviewReasons: [] }]
  };
  const store = await mockImportStore(page, workspace, { sessionId: planningSession.id }, true);
  await page.route("**/api/plans/history", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/api/configuration", (route) => route.fulfill({ contentType: "application/json", body: "{}" }));
  await page.route("**/api/runtimes", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/api/planning-sessions/booking-session/bookings/import-preview", async (route) => {
    const payload = route.request().postDataJSON() as { sourceLabel: string; content: string };
    expect(payload.content).toContain("Confirmation number: ABC12345");
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ sourceHash: previewBooking.sourceHash, sourceLabel: payload.sourceLabel, duplicate: false, possibleDuplicate: false, bookings: [previewBooking] }) });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Upload booking" }).click();
  const panel = page.locator(".booking-import-panel");
  await expect(panel).toHaveCount(1);
  await panel.getByLabel("Source label").fill("Pasted flight confirmation");
  await panel.getByLabel("Paste confirmation text").fill(samples.flight);
  await panel.getByRole("button", { name: "Preview import" }).click();
  await expect(panel.getByLabel("Booking title")).toHaveValue("United Meridian Flight booking");
  await expect(panel.getByLabel("Start")).toHaveValue("2026-10-08T10:00");
  await expect(panel.getByLabel("Destination")).toHaveValue("HND");
  await panel.getByRole("button", { name: "确认本项预订", exact: true }).click();
  await expect(panel.getByRole("region", { name: "Check previous booking import" })).toBeVisible();
  const savedRecovery = await page.evaluate(() => sessionStorage.getItem("landi:pending-booking-import"));
  expect(savedRecovery).toBeTruthy();
  expect(savedRecovery).not.toContain("ABC12345");
  expect(savedRecovery).not.toContain("sourceContent");
  expect(savedRecovery).not.toContain(samples.flight.trim());
  expect(store.payloads).toHaveLength(1);
  expect(store.payloads[0]!.sourceContent).toContain("Confirmation number: ABC12345");
  await page.reload();
  await expect(page.getByRole("button", { name: "Check original booking receipt", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry unchanged original request", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Check original booking receipt", exact: true }).click();
  await expect(page.getByRole("button", { name: "Check original booking receipt", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Upload booking" }).click();
  await expect(panel.getByText("United Meridian Flight booking", { exact: true })).toBeVisible();
  expect(store.payloads).toHaveLength(1);
  expect(await page.evaluate(() => sessionStorage.getItem("landi:pending-booking-import"))).toBeNull();
});

test("多文件预订逐项确认，保存后清除旧预览并重新冻结剩余项基准", async ({ page }) => {
  const activePlan = {
    id: "empty-plan", version: 1, title: "Attend an exhibition in Shanghai", location: "Not set", dates: "Not set", status: "draft",
    knownInformation: [], assumptions: [], nextAction: "Create a plan.", createdAt: "2026-08-27T00:00:00.000Z",
    configuration: { accommodation: { status: "not_set" }, arrival: {}, transport: { preference: "plan_recommended" }, travelContext: { luggage: "unknown" } },
    stages: [], sources: []
  };
  const planningSession = {
    id: "batch-booking-session", status: "proposal_ready", objectiveType: "travel", messages: [{ id: "ask-booking", role: "assistant", text: "Do you have any flight or hotel bookings?", createdAt: "2026-08-27T00:00:00.000Z" }], facts: [], unresolved: [], deferred: [],
    proposal: { version: 1, title: "Tokyo trip", objective: "Tokyo architecture", theme: "Architecture", segments: [], skeleton: [], tradeoffs: [], assumptions: [], decisionPoints: [] },
    createdAt: "2026-08-27T00:00:00.000Z", updatedAt: "2026-08-27T00:00:00.000Z"
  };
  const workspace = { profile: { status: "ready", displayName: "Tester", preferredLanguage: "English", nationality: "United States", gender: "prefer_not_to_say", immigrationStatus: "short_term_visitor" }, runtime: { selectedKind: "codex" }, activePlan, planningSession, destinationArrivals: [], inbox: [], officialSources: [] };
  const flightBooking = {
    id: "batch-flight", planningSessionId: planningSession.id, type: "flight", status: "confirmed", title: "United Meridian Flight booking", source: "imported_email", sourceHash: "c".repeat(64), sourceLabel: "flight-confirmation.eml", importedAt: "2026-08-27T00:00:00.000Z", updatedAt: "2026-08-27T00:00:00.000Z", constraintStrength: "hard",
    segments: [{ id: "batch-flight-segment", segmentType: "flight_leg", title: "Flight booking", status: "confirmed", startAtLocal: "2026-10-08T10:00", endAtLocal: "2026-10-09T14:30", origin: "SFO", destination: "HND", constraintStrength: "hard", fixedCommitment: true, needsReviewReasons: [] }]
  };
  const hotelBooking = {
    id: "batch-hotel", planningSessionId: planningSession.id, type: "accommodation", status: "confirmed", title: "Shinjuku Garden Hotel Accommodation booking", source: "imported_email", sourceHash: "d".repeat(64), sourceLabel: "hotel-confirmation.eml", importedAt: "2026-08-27T00:00:00.000Z", updatedAt: "2026-08-27T00:00:00.000Z", constraintStrength: "hard",
    segments: [{ id: "batch-hotel-segment", segmentType: "hotel_stay", title: "Accommodation booking", status: "confirmed", startAtLocal: "2026-10-09T15:00", endAtLocal: "2026-10-13T11:00", location: "3-12-8 Shinjuku, Tokyo", constraintStrength: "hard", fixedCommitment: true, needsReviewReasons: [] }]
  };
  const store = await mockImportStore(page, workspace, { sessionId: planningSession.id });
  await page.route("**/api/plans/history", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/api/configuration", (route) => route.fulfill({ contentType: "application/json", body: "{}" }));
  await page.route("**/api/runtimes", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/api/planning-sessions/batch-booking-session/bookings/import-preview", async (route) => {
    const payload = route.request().postDataJSON() as { sourceLabel: string; content: string };
    const booking = payload.sourceLabel.includes("hotel") ? hotelBooking : flightBooking;
    expect(payload.content).toContain(payload.sourceLabel.includes("hotel") ? "Reservation ID" : "Flight: UA 123");
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ sourceHash: booking.sourceHash, sourceLabel: payload.sourceLabel, duplicate: false, possibleDuplicate: false, bookings: [booking] }) });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Upload booking" }).click();
  const panel = page.locator(".booking-import-panel");
  await expect(panel).toHaveCount(1);
  await panel.locator('input[type="file"]').setInputFiles([join(fixtureRoot, "flight-confirmation.eml"), join(fixtureRoot, "hotel-confirmation.eml")]);
  await expect(panel.getByLabel("Source label")).toHaveValue("2 booking files selected");
  await panel.getByRole("button", { name: "Preview import" }).click();
  await expect(panel.getByText("2 bookings to review", { exact: true })).toBeVisible();
  await expect(panel.locator(".booking-preview-item")).toHaveCount(2);
  const flightPreview = panel.locator(".booking-preview-item").filter({ hasText: "flight-confirmation.eml" });
  await expect(flightPreview).toHaveCount(1);
  await flightPreview.getByRole("button", { name: "确认本项预订", exact: true }).click();
  await expect(panel.locator(".booking-preview-item")).toHaveCount(0);
  expect(store.payloads).toHaveLength(1);
  expect(store.payloads[0]!.expectedRevision).toBe(1);
  await panel.locator('input[type="file"]').setInputFiles([join(fixtureRoot, "hotel-confirmation.eml")]);
  await panel.getByRole("button", { name: "Preview import", exact: true }).click();
  await expect(panel.locator(".booking-preview-item")).toHaveCount(1);
  expect(store.payloads).toHaveLength(1);
  await panel.getByRole("button", { name: "确认本项预订", exact: true }).click();
  await expect(panel.locator(".booking-preview-item")).toHaveCount(0);
  await expect(panel.getByText("United Meridian Flight booking")).toBeVisible();
  await expect(panel.getByText("Shinjuku Garden Hotel Accommodation booking")).toBeVisible();
  expect(store.payloads.map(body => body.booking.sourceLabel)).toEqual(["flight-confirmation.eml", "hotel-confirmation.eml"]);
  expect(store.payloads.map(body => body.expectedRevision)).toEqual([1, 2]);
  expect(store.payloads[0]!.requestId).not.toBe(store.payloads[1]!.requestId);
  for (const body of store.payloads) expect(body.sourceContent).toContain(body.booking.type === "accommodation" ? "Reservation ID" : "Flight: UA 123");
});

test("合法草稿行程的预订页签导入后续酒店确认", async ({ page }) => {
  const activePlan = {
    id: "draft-tokyo", version: 3, title: "东京建筑旅行草稿", location: "东京", dates: "2026-10-08 to 2026-10-14", status: "draft",
    knownInformation: ["旅行日期已确认"], assumptions: [], nextAction: "审阅草稿安排。", createdAt: "2026-08-27T00:00:00.000Z",
    configuration: { accommodation: { status: "not_set" }, arrival: {}, transport: { preference: "plan_recommended" }, travelContext: { luggage: "unknown" } },
    stages: [], sources: []
  };
  const hotelBooking = {
    id: "booking-ui-hotel", planId: activePlan.id, planVersionCreated: activePlan.version, type: "accommodation", status: "confirmed", title: "Shinjuku Garden Hotel Accommodation booking", source: "imported_email", sourceHash: "b".repeat(64), sourceLabel: "Shinjuku hotel confirmation", importedAt: "2026-08-27T00:00:00.000Z", updatedAt: "2026-08-27T00:00:00.000Z", constraintStrength: "hard",
    segments: [{ id: "segment-ui-hotel", segmentType: "hotel_stay", title: "Accommodation booking", status: "confirmed", startAtLocal: "2026-10-09T15:00", endAtLocal: "2026-10-13T11:00", location: "3-12-8 Shinjuku, Tokyo", constraintStrength: "hard", fixedCommitment: true, needsReviewReasons: [] }]
  };
  const workspace = {
    profile: { status: "ready", displayName: "Tester", preferredLanguage: "English", nationality: "United States", gender: "prefer_not_to_say", immigrationStatus: "short_term_visitor" },
    runtime: { selectedKind: "codex" },
    activePlan,
    destinationArrivals: [], inbox: [], officialSources: []
  };
  const store = await mockImportStore(page, workspace, { planId: activePlan.id });
  await page.route("**/api/plans/history", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/api/configuration", (route) => route.fulfill({ contentType: "application/json", body: "{}" }));
  await page.route("**/api/runtimes", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/api/plans/draft-tokyo/bookings/import-preview", async (route) => {
    const payload = route.request().postDataJSON() as { content: string };
    expect(payload.content).toContain("Reservation ID: HTL-998877");
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ sourceHash: hotelBooking.sourceHash, sourceLabel: hotelBooking.sourceLabel, duplicate: false, possibleDuplicate: false, bookings: [hotelBooking] }) });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Bookings" }).click();
  const panel = page.locator(".booking-import-panel");
  await expect(panel).toHaveCount(1);
  await expect(panel.getByText("Add booking details")).toBeVisible();
  await panel.getByRole("button", { name: "Import" }).click();
  await panel.getByLabel("Source label").fill("Shinjuku hotel confirmation");
  await panel.getByLabel("Paste confirmation text").fill(samples.hotel);
  await panel.getByRole("button", { name: "Preview import" }).click();
  await expect(panel.getByLabel("Booking title")).toHaveValue("Shinjuku Garden Hotel Accommodation booking");
  await expect(panel.getByLabel("Location")).toHaveValue("3-12-8 Shinjuku, Tokyo");
  await panel.getByRole("button", { name: "确认本项预订", exact: true }).click();
  await expect(panel.locator(".booking-preview-item")).toHaveCount(0);
  await expect(panel.getByText("Shinjuku Garden Hotel Accommodation booking")).toBeVisible();
  await expect(page.locator(".agent-status-float")).toHaveCount(0);
  expect(store.payloads).toHaveLength(1);
  expect(store.payloads[0]!.expectedVersion).toBe(3);
  expect(store.payloads[0]!.expectedSourceSetDigest).toBe(bookingRelationshipDigest([]));
  expect(store.payloads[0]!.sourceContent).toContain("Reservation ID: HTL-998877");
});

test("itinerary workspace exposes a top-level Bookings tab", async ({ page }) => {
  const activePlan = {
    id: "native-tokyo", version: 2, title: "Tokyo food and design", location: "Tokyo", dates: "2026-10-08 to 2026-10-10", status: "draft",
    knownInformation: ["Tokyo trip"], assumptions: [], nextAction: "Review the itinerary.", createdAt: "2026-08-27T00:00:00.000Z",
    configuration: { accommodation: { status: "not_set" }, arrival: {}, transport: { preference: "plan_recommended" }, travelContext: { partySize: 2, luggage: "light" } },
    stages: [], sources: [],
    presentation: {
      kind: "itinerary", summary: "Tokyo food and design", language: "en", startDate: "2026-10-08", endDate: "2026-10-10", cities: ["Tokyo"],
      days: [{ id: "day-1", label: "Oct 8", shortLabel: "10/8", city: "Tokyo", title: "Arrival day", summary: "Easy first day.", anchors: ["coffee"], candidates: [], placeIds: ["coffee"], stops: [{ placeId: "coffee", order: 1, time: "15:00" }] }],
      places: [{ id: "coffee", name: "Koffee Mameya", city: "Tokyo", area: "Omotesando", locationLabel: "Omotesando", coordinates: [35.665, 139.711], category: "coffee", priority: "preferred", durationMinutes: 60, whyWorthIt: "Design-focused coffee stop.", plan: "Visit after arrival.", detailSections: [], sourceRefs: [] }],
      routeSegments: []
    }
  };
  const workspace = {
    profile: { status: "ready", displayName: "Tester", preferredLanguage: "English", nationality: "United States", gender: "prefer_not_to_say", immigrationStatus: "short_term_visitor" },
    runtime: { selectedKind: "codex" }, activePlan, destinationArrivals: [], inbox: [], officialSources: []
  };

  await page.route("**/api/workspace", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(workspace) }));
  await page.route("**/api/plans/history", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/api/configuration", (route) => route.fulfill({ contentType: "application/json", body: "{}" }));
  await page.route("**/api/runtimes", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/api/plans/native-tokyo/bookings", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ bookings: [] }) }));

  await page.goto("/");
  await expect(page.getByRole("region", { name: "Landi Blueprint workspace" })).toBeVisible();
  await page.getByRole("button", { name: "Bookings" }).click();
  await expect(page.getByText("Add booking details")).toBeVisible();
  await expect(page.locator(".booking-import-panel")).toBeVisible();
});
