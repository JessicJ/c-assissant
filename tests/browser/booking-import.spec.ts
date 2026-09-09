import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

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

test("empty workspace exposes booking import before starting a conversation", async ({ page }) => {
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

  await page.goto("/");
  await expect(page.getByText("Import booking confirmations")).toBeVisible();
  const panel = page.locator(".empty-plan-booking-import .booking-import-panel");
  await panel.getByRole("button", { name: "Import" }).click();
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

    const confirmResponse = await request.post("/api/planning-sessions/bookings/import-confirm", { data: { booking, sourceContent: item.content } });
    expect(confirmResponse.ok()).toBe(true);
    const confirmed = await confirmResponse.json();
    expect(confirmed.booking.type).toBe(item.type);
    expect(JSON.stringify(confirmed.workspace)).not.toContain("paid with card");
    expect(JSON.stringify(confirmed.workspace)).not.toContain("ABC12345");
    expect(JSON.stringify(confirmed.workspace)).not.toContain("RT998877");
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
  const firstPreviewResponse = await request.post("/api/planning-sessions/bookings/import-preview", { data: { sourceLabel: "United confirmation.eml", content: samples.flight } });
  expect(firstPreviewResponse.ok()).toBe(true);
  const firstPreview = await firstPreviewResponse.json();
  const confirmResponse = await request.post("/api/planning-sessions/bookings/import-confirm", { data: { booking: firstPreview.bookings[0], sourceContent: samples.flight } });
  expect(confirmResponse.ok()).toBe(true);
  const confirmed = await confirmResponse.json();
  const sessionId = confirmed.planningSession.id;

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

  const previewResponse = await request.post(`/api/plans/${planId}/bookings/import-preview`, { data: { sourceLabel: "Shinjuku hotel confirmation.eml", content: samples.hotel } });
  expect(previewResponse.ok()).toBe(true);
  const preview = await previewResponse.json();
  const booking = preview.bookings[0];
  expect(booking.type).toBe("accommodation");

  const confirmResponse = await request.post(`/api/plans/${planId}/bookings/import-confirm`, { data: { booking, expectedVersion, sourceContent: samples.hotel } });
  expect(confirmResponse.ok()).toBe(true);
  const confirmed = await confirmResponse.json();
  expect(confirmed.requiresBlueprintRevision).toBe(false);
  expect(confirmed.workspace.activePlan.configuration.accommodation.status).toBe("confirmed");
  expect(confirmed.workspace.activePlan.configuration.accommodation.location).toBe("3-12-8 Shinjuku, Tokyo");
  expect(JSON.stringify(confirmed.workspace)).not.toContain("HTL-998877");
  expect(JSON.stringify(confirmed.workspace)).not.toContain("Example Traveler");
});

test("booking import panel previews and confirms a pasted flight confirmation", async ({ page }) => {
  const activePlan = {
    id: "empty-plan", version: 1, title: "No current plan", location: "Not set", dates: "Not set", status: "draft",
    knownInformation: [], assumptions: [], nextAction: "Create a plan.", createdAt: "2026-08-27T00:00:00.000Z",
    configuration: { accommodation: { status: "not_set" }, arrival: {}, transport: { preference: "plan_recommended" }, travelContext: { luggage: "unknown" } },
    stages: [], sources: []
  };
  const planningSession = {
    id: "booking-session", status: "proposal_ready", objectiveType: "travel", messages: [], facts: [], unresolved: [], deferred: [],
    proposal: { version: 1, title: "Tokyo trip", objective: "Tokyo architecture", theme: "Architecture", segments: [], skeleton: [], tradeoffs: [], assumptions: [], decisionPoints: [] },
    createdAt: "2026-08-27T00:00:00.000Z", updatedAt: "2026-08-27T00:00:00.000Z"
  };
  const workspace = { profile: { status: "ready", displayName: "Tester", preferredLanguage: "English", nationality: "United States", gender: "prefer_not_to_say", immigrationStatus: "short_term_visitor" }, runtime: { selectedKind: "codex" }, activePlan, planningSession, destinationArrivals: [], inbox: [], officialSources: [] };
  const previewBooking = {
    id: "booking-ui-flight", planningSessionId: planningSession.id, type: "flight", status: "confirmed", title: "United Meridian Flight booking", source: "imported_email", sourceHash: "a".repeat(64), sourceLabel: "Pasted flight confirmation", importedAt: "2026-08-27T00:00:00.000Z", updatedAt: "2026-08-27T00:00:00.000Z", constraintStrength: "hard",
    segments: [{ id: "segment-ui-flight", segmentType: "flight_leg", title: "Flight booking", status: "confirmed", startAtLocal: "2026-10-08T10:00", endAtLocal: "2026-10-09T14:30", origin: "SFO", destination: "HND", constraintStrength: "hard", fixedCommitment: true, needsReviewReasons: [] }]
  };
  let confirmPayload: unknown;

  await page.route("**/api/workspace", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(workspace) }));
  await page.route("**/api/plans/history", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/api/configuration", (route) => route.fulfill({ contentType: "application/json", body: "{}" }));
  await page.route("**/api/runtimes", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/api/planning-sessions/booking-session/bookings", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ bookings: [] }) }));
  await page.route("**/api/planning-sessions/booking-session/bookings/import-preview", async (route) => {
    const payload = route.request().postDataJSON() as { sourceLabel: string; content: string };
    expect(payload.content).toContain("Confirmation number: ABC12345");
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ sourceHash: previewBooking.sourceHash, sourceLabel: payload.sourceLabel, duplicate: false, possibleDuplicate: false, bookings: [previewBooking] }) });
  });
  await page.route("**/api/planning-sessions/booking-session/bookings/import-confirm", async (route) => {
    confirmPayload = route.request().postDataJSON();
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ workspace, planningSession, booking: previewBooking }) });
  });

  await page.goto("/");
  await expect(page.getByText("Import booking confirmations")).toBeVisible();
  const panel = page.locator(".booking-import-panel").first();
  await panel.getByRole("button", { name: "Import" }).click();
  await panel.getByLabel("Source label").fill("Pasted flight confirmation");
  await panel.getByLabel("Paste confirmation text").fill(samples.flight);
  await panel.getByRole("button", { name: "Preview import" }).click();
  await expect(panel.getByLabel("Booking title")).toHaveValue("United Meridian Flight booking");
  await expect(panel.getByLabel("Start")).toHaveValue("2026-10-08T10:00");
  await expect(panel.getByLabel("Destination")).toHaveValue("HND");
  await panel.getByRole("button", { name: "Accept booking" }).click();
  await expect(panel.getByText("United Meridian Flight booking")).toBeVisible();

  expect(JSON.stringify(confirmPayload)).toContain("sourceContent");
  expect(JSON.stringify(confirmPayload)).toContain("Confirmation number: ABC12345");
});

test("booking import panel previews and confirms multiple uploaded confirmation files", async ({ page }) => {
  const activePlan = {
    id: "empty-plan", version: 1, title: "No current plan", location: "Not set", dates: "Not set", status: "draft",
    knownInformation: [], assumptions: [], nextAction: "Create a plan.", createdAt: "2026-08-27T00:00:00.000Z",
    configuration: { accommodation: { status: "not_set" }, arrival: {}, transport: { preference: "plan_recommended" }, travelContext: { luggage: "unknown" } },
    stages: [], sources: []
  };
  const planningSession = {
    id: "batch-booking-session", status: "proposal_ready", objectiveType: "travel", messages: [], facts: [], unresolved: [], deferred: [],
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
  const confirmedLabels: string[] = [];

  await page.route("**/api/workspace", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(workspace) }));
  await page.route("**/api/plans/history", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/api/configuration", (route) => route.fulfill({ contentType: "application/json", body: "{}" }));
  await page.route("**/api/runtimes", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/api/planning-sessions/batch-booking-session/bookings", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ bookings: [] }) }));
  await page.route("**/api/planning-sessions/batch-booking-session/bookings/import-preview", async (route) => {
    const payload = route.request().postDataJSON() as { sourceLabel: string; content: string };
    const booking = payload.sourceLabel.includes("hotel") ? hotelBooking : flightBooking;
    expect(payload.content).toContain(payload.sourceLabel.includes("hotel") ? "Reservation ID" : "Flight: UA 123");
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ sourceHash: booking.sourceHash, sourceLabel: payload.sourceLabel, duplicate: false, possibleDuplicate: false, bookings: [booking] }) });
  });
  await page.route("**/api/planning-sessions/batch-booking-session/bookings/import-confirm", async (route) => {
    const payload = route.request().postDataJSON() as { booking: { sourceLabel: string; type: string }; sourceContent: string };
    confirmedLabels.push(payload.booking.sourceLabel);
    expect(payload.sourceContent).toContain(payload.booking.type === "accommodation" ? "Reservation ID" : "Flight: UA 123");
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ workspace, planningSession, booking: payload.booking }) });
  });

  await page.goto("/");
  const panel = page.locator(".booking-import-panel").first();
  await panel.getByRole("button", { name: "Import" }).click();
  await panel.locator('input[type="file"]').setInputFiles([join(fixtureRoot, "flight-confirmation.eml"), join(fixtureRoot, "hotel-confirmation.eml")]);
  await expect(panel.getByLabel("Source label")).toHaveValue("2 booking files selected");
  await panel.getByRole("button", { name: "Preview import" }).click();
  await expect(panel.getByText("2 bookings ready for review")).toBeVisible();
  await expect(panel.locator(".booking-preview-item")).toHaveCount(2);
  await panel.getByRole("button", { name: "Accept all" }).click();
  await expect(panel.getByText("United Meridian Flight booking")).toBeVisible();
  await expect(panel.getByText("Shinjuku Garden Hotel Accommodation booking")).toBeVisible();
  expect(confirmedLabels.sort()).toEqual(["flight-confirmation.eml", "hotel-confirmation.eml"]);
});

test("Plan Bookings tab imports a later hotel confirmation", async ({ page }) => {
  const activePlan = {
    id: "active-tokyo", version: 3, title: "Tokyo architecture trip", location: "Tokyo", dates: "2026-10-08 to 2026-10-14", status: "active",
    knownInformation: ["Travel dates confirmed"], assumptions: [], nextAction: "Follow the active trip plan.", createdAt: "2026-08-27T00:00:00.000Z",
    configuration: { accommodation: { status: "not_set" }, arrival: {}, transport: { preference: "plan_recommended" }, travelContext: { luggage: "unknown" } },
    stages: [], sources: []
  };
  const hotelBooking = {
    id: "booking-ui-hotel", planId: activePlan.id, planVersionCreated: activePlan.version, type: "accommodation", status: "confirmed", title: "Shinjuku Garden Hotel Accommodation booking", source: "imported_email", sourceHash: "b".repeat(64), sourceLabel: "Shinjuku hotel confirmation", importedAt: "2026-08-27T00:00:00.000Z", updatedAt: "2026-08-27T00:00:00.000Z", constraintStrength: "hard",
    segments: [{ id: "segment-ui-hotel", segmentType: "hotel_stay", title: "Accommodation booking", status: "confirmed", startAtLocal: "2026-10-09T15:00", endAtLocal: "2026-10-13T11:00", location: "3-12-8 Shinjuku, Tokyo", constraintStrength: "hard", fixedCommitment: true, needsReviewReasons: [] }]
  };
  const updatedWorkspace = {
    profile: { status: "ready", displayName: "Tester", preferredLanguage: "English", nationality: "United States", gender: "prefer_not_to_say", immigrationStatus: "short_term_visitor" },
    runtime: { selectedKind: "codex" },
    activePlan: { ...activePlan, version: 4, configuration: { ...activePlan.configuration, accommodation: { status: "confirmed", name: hotelBooking.title, location: "3-12-8 Shinjuku, Tokyo", address: "3-12-8 Shinjuku, Tokyo", source: "user", updatedAt: "2026-08-27T00:00:00.000Z" } }, knownInformation: [...activePlan.knownInformation, "Confirmed accommodation: Shinjuku Garden Hotel Accommodation booking starts 2026-10-09T15:00 ends 2026-10-13T11:00 at 3-12-8 Shinjuku, Tokyo"] },
    destinationArrivals: [], inbox: [], officialSources: []
  };
  let confirmPayload: { expectedVersion?: number; sourceContent?: string } | undefined;

  await page.route("**/api/workspace", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ ...updatedWorkspace, activePlan }) }));
  await page.route("**/api/plans/history", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/api/configuration", (route) => route.fulfill({ contentType: "application/json", body: "{}" }));
  await page.route("**/api/runtimes", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/api/plans/active-tokyo/bookings", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ bookings: [] }) }));
  await page.route("**/api/plans/active-tokyo/bookings/import-preview", async (route) => {
    const payload = route.request().postDataJSON() as { content: string };
    expect(payload.content).toContain("Reservation ID: HTL-998877");
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ sourceHash: hotelBooking.sourceHash, sourceLabel: hotelBooking.sourceLabel, duplicate: false, possibleDuplicate: false, bookings: [hotelBooking] }) });
  });
  await page.route("**/api/plans/active-tokyo/bookings/import-confirm", async (route) => {
    confirmPayload = route.request().postDataJSON();
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ workspace: updatedWorkspace, booking: hotelBooking, requiresBlueprintRevision: true }) });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Bookings" }).click();
  const panel = page.locator(".booking-import-panel").first();
  await expect(panel.getByText("Add booking details")).toBeVisible();
  await panel.getByRole("button", { name: "Import" }).click();
  await panel.getByLabel("Source label").fill("Shinjuku hotel confirmation");
  await panel.getByLabel("Paste confirmation text").fill(samples.hotel);
  await panel.getByRole("button", { name: "Preview import" }).click();
  await expect(panel.getByLabel("Booking title")).toHaveValue("Shinjuku Garden Hotel Accommodation booking");
  await expect(panel.getByLabel("Location")).toHaveValue("3-12-8 Shinjuku, Tokyo");
  await panel.getByRole("button", { name: "Accept booking" }).click();
  await expect(panel.getByText("Shinjuku Garden Hotel Accommodation booking")).toBeVisible();
  await expect(page.locator(".agent-status-float")).toHaveCount(0);
  expect(confirmPayload?.expectedVersion).toBe(3);
  expect(confirmPayload?.sourceContent).toContain("Reservation ID: HTL-998877");
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
  await expect(page.getByRole("region", { name: "Interactive trip plan" })).toBeVisible();
  await page.getByRole("button", { name: "Bookings" }).click();
  await expect(page.getByText("Add booking details")).toBeVisible();
  await expect(page.locator(".booking-import-panel")).toBeVisible();
});
