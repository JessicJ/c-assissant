import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { TRIP_BLUEPRINT_SCHEMA_VERSION, compilePlanProposal, compileTripBlueprint, type PlanCompilationProposal, type ResearchSet, type TravelBooking, type TripBlueprint } from "@c-assistant/core";
import { SqliteWorkspaceStore } from "./index.js";

test("SQLite records its schema baseline and creates a verified private backup", () => {
  const directory = mkdtempSync(join(tmpdir(), "c-assistant-storage-"));
  try {
    const databasePath = join(directory, "workspace.sqlite");
    const store = new SqliteWorkspaceStore(databasePath);
    store.updateProfile({ displayName: "Backup owner", preferredLanguage: "English", nationality: "Canada", gender: "not_specified", immigrationStatus: "tourist_visa" });
    const maintenance = store.getDatabaseMaintenanceStatus();
    assert.deepEqual({ schemaVersion: maintenance.schemaVersion, latest: maintenance.latestSchemaVersion, integrity: maintenance.integrity }, { schemaVersion: 19, latest: 19, integrity: "ok" });
    assert.equal(maintenance.migrations[0]?.name, "v1-local-workspace-baseline");
    assert.equal(maintenance.migrations[1]?.name, "country-pack-source-evidence-links");
    assert.equal(maintenance.migrations[2]?.name, "telegram-one-route-transport-override");
    assert.equal(maintenance.migrations[3]?.name, "telegram-route-handoff-timeline");
    assert.equal(maintenance.migrations[4]?.name, "separate-plan-review-and-execution");
    assert.equal(maintenance.migrations[5]?.name, "optional-whatsapp-messaging");
    assert.equal(maintenance.migrations[6]?.name, "conversational-planning-sessions");
    assert.equal(maintenance.migrations[7]?.name, "version-bound-plan-change-sets");
    assert.equal(maintenance.migrations[8]?.name, "explicit-stage-presentation-kinds");
    assert.equal(maintenance.migrations[9]?.name, "plan-replacement-impact-audits");
    assert.equal(maintenance.migrations[10]?.name, "structured-plan-presentations");
    assert.equal(maintenance.migrations[11]?.name, "telegram-version-bound-plan-change-proposals");
    assert.equal(maintenance.migrations[12]?.name, "explicit-plan-destination-arrivals");

    const backup = store.createBackup(new Date("2026-08-07T12:34:56.000Z"));
    assert.equal(backup.integrity, "ok");
    assert.equal(statSync(backup.path).mode & 0o777, 0o600);
    const restoredReadOnly = new DatabaseSync(backup.path, { readOnly: true });
    assert.equal((restoredReadOnly.prepare("SELECT display_name FROM profiles WHERE id = 1").get() as { display_name: string }).display_name, "Backup owner");
    restoredReadOnly.close();
    assert.throws(() => store.createBackup(new Date("2026-08-07T12:34:56.000Z")), /already exists/i);
    store.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("SQLite refuses to open a workspace created by a newer schema", () => {
  const directory = mkdtempSync(join(tmpdir(), "c-assistant-future-schema-"));
  try {
    const databasePath = join(directory, "workspace.sqlite");
    const future = new DatabaseSync(databasePath);
    future.exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, applied_at TEXT NOT NULL); INSERT INTO schema_migrations VALUES (999, 'future', '2026-08-07T00:00:00.000Z');");
    future.close();
    assert.throws(() => new SqliteWorkspaceStore(databasePath), /supports schema 19.*schema 999/i);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("SQLite records one weather attention item per Plan, destination, day, and condition", () => {
  const directory = mkdtempSync(join(tmpdir(), "c-assistant-weather-attention-"));
  try {
    const store = new SqliteWorkspaceStore(join(directory, "workspace.sqlite"));
    const plan = store.getWorkspace().activePlan;
    store.confirmPlan(plan.id);
    const input = { planId: plan.id, destination: "Paris", kind: "storm" as const, observedAt: "2026-10-06T08:00:00Z", title: "Paris 当前天气需要注意", body: "当前有雷暴，请查看室内备选。" };
    assert.equal(store.recordPlanWeatherAttention(input), true);
    assert.equal(store.recordPlanWeatherAttention(input), false);
    assert.equal(store.getWorkspace().inbox.filter((item) => item.title === input.title).length, 1);
    store.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("SQLite deduplicates monitored venue closure attention", () => {
  const directory = mkdtempSync(join(tmpdir(), "c-assistant-venue-attention-"));
  try {
    const store = new SqliteWorkspaceStore(join(directory, "workspace.sqlite"));
    const plan = store.getWorkspace().activePlan;
    store.confirmPlan(plan.id);
    const input = { planId: plan.id, placeId: "museum", status: "temporarily_closed" as const, observedAt: "2026-10-06T08:00:00Z", title: "Museum 目前可能临时关闭", body: "请查看官方入口后再决定是否替换。" };
    assert.equal(store.recordPlanVenueAttention(input), true);
    assert.equal(store.recordPlanVenueAttention(input), false);
    assert.equal(store.getWorkspace().inbox.filter((item) => item.title === input.title).length, 1);
    store.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("SQLite persists and restores the current conversational planning session", () => {
  const directory = mkdtempSync(join(tmpdir(), "c-assistant-planning-session-"));
  try {
    const store = new SqliteWorkspaceStore(join(directory, "workspace.sqlite"));
    const session = store.createPlanningSession("travel", new Date("2026-08-17T00:00:00.000Z"));
    session.messages.push({ id: "message-1", role: "user", text: "我想去葡萄牙", createdAt: session.createdAt });
    session.facts.push({ key: "destination", value: "葡萄牙", source: "user", confirmed: true, updatedAt: session.createdAt });
    store.savePlanningSession(session);
    const restored = store.getWorkspace().planningSession;
    assert.equal(restored?.id, session.id);
    assert.equal(restored?.messages[0]?.text, "我想去葡萄牙");
    assert.equal(restored?.facts[0]?.value, "葡萄牙");
    assert.equal(store.abandonPlanningSession(session.id).status, "abandoned");
    assert.equal(store.getWorkspace().planningSession, undefined);
    store.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("SQLite persists booking imports for planning sessions and Plans", () => {
  const directory = mkdtempSync(join(tmpdir(), "c-assistant-booking-import-"));
  try {
    const store = new SqliteWorkspaceStore(join(directory, "workspace.sqlite"));
    const session = store.createPlanningSession("travel", new Date("2026-08-27T00:00:00.000Z"));
    const booking: TravelBooking = {
      id: "booking-1",
      planningSessionId: session.id,
      type: "flight",
      status: "confirmed",
      title: "UA123 flight booking",
      source: "imported_email",
      sourceHash: "hash-1",
      sourceLabel: "United confirmation.eml",
      importedAt: "2026-08-27T00:00:00.000Z",
      updatedAt: "2026-08-27T00:00:00.000Z",
      constraintStrength: "hard",
      segments: [{
        id: "segment-1",
        segmentType: "flight_leg",
        title: "Outbound flight",
        status: "confirmed",
        startAtLocal: "2026-10-08T10:00",
        origin: "SFO",
        destination: "HND",
        constraintStrength: "hard",
        fixedCommitment: true,
        needsReviewReasons: []
      }]
    };
    store.saveTravelBooking(booking);
    store.saveProtectedBookingAttachment({ bookingId: booking.id, sourceHash: booking.sourceHash, sourceLabel: booking.sourceLabel, contentText: "Full booking email body with private confirmation details.", createdAt: "2026-08-27T00:00:00.000Z" });
    assert.equal(store.hasTravelBookingSourceHash({ planningSessionId: session.id }, "hash-1"), true);
    assert.equal(store.listTravelBookingsForPlanningSession(session.id)[0]?.title, "UA123 flight booking");
    assert.equal(store.countProtectedBookingAttachments(booking.id), 1);
    const planId = store.getWorkspace().activePlan.id;
    const planBooking: TravelBooking = { ...booking, id: "booking-2", planId, planVersionCreated: 1, sourceHash: "hash-2" };
    delete planBooking.planningSessionId;
    store.saveTravelBooking(planBooking);
    assert.equal(store.listTravelBookingsForPlan(planId)[0]?.sourceHash, "hash-2");
    const updated = store.applyTravelBookingToCurrentPlan({
      ...planBooking,
      type: "accommodation",
      title: "Confirmed Shinjuku hotel",
      segments: [{
        id: "segment-hotel",
        segmentType: "hotel_stay",
        title: "Hotel stay",
        status: "confirmed",
        startAtLocal: "2026-10-08T15:00",
        endAtLocal: "2026-10-12T11:00",
        location: "Shinjuku, Tokyo",
        constraintStrength: "hard",
        fixedCommitment: true,
        needsReviewReasons: []
      }]
    }, store.getWorkspace().activePlan.version);
    assert.equal(updated.activePlan.configuration.accommodation.status, "confirmed");
    assert.equal(updated.activePlan.configuration.accommodation.location, "Shinjuku, Tokyo");
    assert.ok(updated.activePlan.knownInformation.some((item) => item.includes("Confirmed accommodation")));
    store.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("SQLite confirms only the latest proposal version", () => {
  const directory = mkdtempSync(join(tmpdir(), "c-assistant-planning-proposal-version-"));
  try {
    const store = new SqliteWorkspaceStore(join(directory, "workspace.sqlite"));
    const session = store.createPlanningSession("travel", new Date("2026-08-17T00:00:00.000Z"));
    session.status = "proposal_ready";
    session.proposal = {
      version: 2,
      title: "Portugal architecture trip",
      objective: "Spend seven days exploring architecture and local life.",
      theme: "Architecture and local life",
      segments: ["Prepare", "Travel", "Return"],
      skeleton: ["Arrival", "Core days", "Departure"],
      tradeoffs: ["Keep a comfortable pace"],
      assumptions: ["Bookings remain unconfirmed"],
      decisionPoints: ["Confirm scope"]
    };
    store.savePlanningSession(session);
    assert.throws(() => store.confirmPlanningSession(session.id, 1), /latest planning proposal/i);
    const confirmed = store.confirmPlanningSession(session.id, 2);
    assert.equal(confirmed.status, "proposal_confirmed");
    assert.equal(confirmed.confirmedProposalVersion, 2);
    store.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("SQLite recovers interrupted Plan generation without losing the proposal", () => {
  const directory = mkdtempSync(join(tmpdir(), "c-assistant-interrupted-plan-"));
  try {
    const store = new SqliteWorkspaceStore(join(directory, "workspace.sqlite"));
    const session = store.createPlanningSession("travel", new Date("2026-08-17T00:00:00.000Z"));
    session.status = "proposal_ready";
    session.proposal = {
      version: 1,
      title: "Tokyo holiday",
      objective: "Plan a Tokyo holiday.",
      theme: "Holiday",
      segments: ["Arrive", "Explore", "Depart"],
      skeleton: ["Arrival", "Core days", "Departure"],
      tradeoffs: ["Keep a comfortable pace"],
      assumptions: ["Bookings remain unconfirmed"],
      decisionPoints: ["Confirm scope"]
    };
    store.savePlanningSession(session);
    store.confirmPlanningSession(session.id, 1);
    store.updatePlanningSessionStatus(session.id, "generating");
    const run = store.startPlanGenerationRun({ runtimeKind: "codex", trigger: "web" });

    assert.equal(store.abandonPlanningSession(session.id).status, "abandoned");
    store.savePlanningSession({ ...store.getPlanningSessionById(session.id)!, status: "generating" });

    assert.deepEqual(store.recoverInterruptedPlanGenerations("2026-08-17T00:12:00.000Z"), { runs: 1, sessions: 1 });
    assert.equal(store.getPlanningSessionById(session.id)?.status, "proposal_ready");
    assert.equal(store.getPlanningSessionById(session.id)?.proposal?.title, "Tokyo holiday");
    assert.deepEqual(store.listRecentAgentRuns(1)[0], {
      ...run,
      status: "failed",
      finishedAt: "2026-08-17T00:12:00.000Z",
      failureCode: "service_interrupted"
    });
    assert.deepEqual(store.recoverInterruptedPlanGenerations("2026-08-17T00:13:00.000Z"), { runs: 0, sessions: 0 });
    store.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("SQLite persists one version-bound pending Telegram Plan change proposal", () => {
  const directory = mkdtempSync(join(tmpdir(), "c-assistant-telegram-plan-change-"));
  try {
    const store = new SqliteWorkspaceStore(join(directory, "workspace.sqlite"));
    const draft = store.createGeneratedPlan({
      title: "Paris trip",
      location: "Paris, France",
      dates: "October 12–18, 2026",
      knownInformation: ["Two travellers."],
      assumptions: [],
      nextAction: "Review the Plan.",
      stages: [{ title: "Daily itinerary", description: "A compact itinerary.", tasks: [{ title: "Explore Paris", owner: "assistant", dueLabel: "Day 1" }] }]
    });
    const active = store.confirmPlan(draft.activePlan.id).activePlan;
    const impact = {
      planId: active.id,
      baseVersion: active.version,
      impact: "low" as const,
      summary: "A meal preference changes itinerary choices.",
      reasons: [],
      affectedAreas: ["itinerary" as const],
      requiresConfirmation: false,
      createsReplacementDraft: true
    };
    const first = store.createTelegramPlanChangeProposal({ planId: active.id, baseVersion: active.version, request: "I want Italian food.", impact });
    assert.equal(store.getTelegramPlanChangeProposal(first.id)?.status, "pending");
    const second = store.createTelegramPlanChangeProposal({ planId: active.id, baseVersion: active.version, request: "Add one Italian dinner.", impact });
    assert.equal(store.getTelegramPlanChangeProposal(first.id)?.status, "cancelled");
    assert.equal(store.resolveTelegramPlanChangeProposal(second.id, "applied").status, "applied");
    assert.throws(() => store.resolveTelegramPlanChangeProposal(second.id, "applied"), /already resolved/i);
    store.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("SQLite records only an explicit arrival at a destination in the active Plan", () => {
  const directory = mkdtempSync(join(tmpdir(), "c-assistant-destination-arrival-"));
  try {
    const store = new SqliteWorkspaceStore(join(directory, "workspace.sqlite"));
    const draft = store.createGeneratedPlan({
      title: "Paris and London",
      location: "Paris and London",
      dates: "October 6–7, 2026",
      knownInformation: ["Two-city trip."],
      assumptions: [],
      nextAction: "Review.",
      stages: [{ title: "Daily itinerary", description: "Two cities.", tasks: [{ title: "Paris", owner: "assistant", dueLabel: "Day 1" }, { title: "London", owner: "assistant", dueLabel: "Day 2" }] }],
      presentation: {
        kind: "itinerary", summary: "Paris then London", startDate: "2026-10-06", endDate: "2026-10-07", cities: ["Paris", "London"],
        days: [
          { id: "day-paris", label: "Day 1", date: "2026-10-06", city: "Paris", title: "Paris orientation", summary: "Start with one central Paris anchor before the city change.", placeIds: ["paris-place"], stops: [{ placeId: "paris-place", order: 1, time: "10:00" }] },
          { id: "day-london", label: "Day 2", date: "2026-10-07", city: "London", title: "London orientation", summary: "Use one central London anchor after arrival.", placeIds: ["london-place"], stops: [{ placeId: "london-place", order: 1, time: "14:00" }] }
        ],
        places: [
          { id: "paris-place", name: "Paris place", locationLabel: "Paris", city: "Paris", coordinates: [48.86, 2.34], category: "sight", priority: "must", durationMinutes: 90, whyWorthIt: "Paris", plan: "Visit", detailSections: [], sourceRefs: [] },
          { id: "london-place", name: "London place", locationLabel: "London", city: "London", coordinates: [51.5, -0.12], category: "sight", priority: "must", durationMinutes: 90, whyWorthIt: "London", plan: "Visit", detailSections: [], sourceRefs: [] }
        ], routeSegments: []
      }
    });
    const active = store.confirmPlan(draft.activePlan.id).activePlan;
    assert.throws(() => store.recordPlanDestinationArrival({ planId: active.id, city: "Berlin" }), /not a destination/i);
    const arrival = store.recordPlanDestinationArrival({ planId: active.id, city: "伦敦", arrivedAt: "2026-10-07T12:00:00.000Z" });
    assert.deepEqual(arrival, { city: "London", arrivedAt: "2026-10-07T12:00:00.000Z", confirmed: true });
    assert.deepEqual(store.getWorkspace().destinationArrivals, [arrival]);
    store.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("SQLite persists a version-bound Plan task reorder and can undo it", () => {
  const directory = mkdtempSync(join(tmpdir(), "c-assistant-plan-change-"));
  try {
    const databasePath = join(directory, "workspace.sqlite");
    const store = new SqliteWorkspaceStore(databasePath);
    const workspace = store.createGeneratedPlan({
      title: "Lisbon working trip",
      location: "Lisbon, Portugal",
      dates: "October 1–5, 2026",
      knownInformation: ["Two fixed work sessions."],
      assumptions: [],
      nextAction: "Review the itinerary order.",
      stages: [{
        title: "Daily itinerary",
        description: "A draft itinerary.",
        tasks: [
          { title: "Check in", owner: "user", dueLabel: "Day 1 · 15:00" },
          { title: "Walk to dinner", owner: "user", dueLabel: "Day 1 · 18:00" },
          { title: "Attend workshop", owner: "user", dueLabel: "Day 2 · 09:00" }
        ]
      }]
    });
    const plan = workspace.activePlan;
    const firstTask = plan.stages[0]!.tasks[0]!;
    const reordered = store.reorderPlanTask({ planId: plan.id, taskId: firstTask.id, direction: "down", expectedVersion: plan.version });

    assert.deepEqual(reordered.workspace.activePlan.stages[0]!.tasks.map((task) => task.title), ["Walk to dinner", "Check in", "Attend workshop"]);
    assert.equal(reordered.workspace.activePlan.version, plan.version + 1);
    assert.equal(reordered.change.baseVersion, plan.version);
    assert.equal(reordered.change.appliedVersion, plan.version + 1);
    assert.deepEqual(reordered.change.affectedTaskIds, [firstTask.id, plan.stages[0]!.tasks[1]!.id]);
    assert.equal(reordered.workspace.latestPlanChange?.id, reordered.change.id);
    assert.throws(() => store.reorderPlanTask({ planId: plan.id, taskId: firstTask.id, direction: "down", expectedVersion: plan.version }), /changed/i);
    store.close();

    const reopened = new SqliteWorkspaceStore(databasePath);
    const persisted = reopened.getWorkspace();
    assert.deepEqual(persisted.activePlan.stages[0]!.tasks.map((task) => task.title), ["Walk to dinner", "Check in", "Attend workshop"]);
    assert.equal(persisted.latestPlanChange?.id, reordered.change.id);
    const undone = reopened.undoPlanChange({ planId: plan.id, changeId: reordered.change.id, expectedVersion: persisted.activePlan.version });
    assert.deepEqual(undone.activePlan.stages[0]!.tasks.map((task) => task.title), ["Check in", "Walk to dinner", "Attend workshop"]);
    assert.equal(undone.activePlan.version, plan.version + 2);
    assert.equal(undone.latestPlanChange, undefined);
    reopened.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("SQLite upgrades legacy stage titles to explicit presentation kinds", () => {
  const directory = mkdtempSync(join(tmpdir(), "c-assistant-stage-kind-"));
  try {
    const databasePath = join(directory, "workspace.sqlite");
    const store = new SqliteWorkspaceStore(databasePath);
    const workspace = store.createGeneratedPlan({
      title: "Legacy presentation",
      location: "Lisbon, Portugal",
      dates: "October 2026",
      knownInformation: ["A short trip."],
      assumptions: [],
      nextAction: "Review.",
      stages: [
        { title: "Trip overview", description: "Summary.", tasks: [{ title: "Trip shape", owner: "assistant", dueLabel: "Before departure" }] },
        { title: "每日行程", description: "Route.", tasks: [{ title: "Walk through Alfama", owner: "assistant", dueLabel: "Day 1" }] },
        { title: "预算表", description: "Costs.", tasks: [{ title: "Contingency", owner: "assistant", dueLabel: "Whole trip" }] }
      ]
    });
    const planId = workspace.activePlan.id;
    store.close();

    const legacy = new DatabaseSync(databasePath);
    legacy.prepare("UPDATE stages SET presentation_kind = 'details' WHERE plan_id = ?").run(planId);
    legacy.prepare("DELETE FROM schema_migrations WHERE version >= 9").run();
    legacy.close();

    const upgraded = new SqliteWorkspaceStore(databasePath);
    assert.deepEqual(upgraded.getWorkspace().activePlan.stages.map((stage) => stage.presentationKind), ["overview", "itinerary", "budget"]);
    assert.equal(upgraded.getDatabaseMaintenanceStatus().schemaVersion, 19);
    upgraded.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("SQLite upgrades a schema-one workspace with source-evidence link tables", () => {
  const directory = mkdtempSync(join(tmpdir(), "c-assistant-schema-upgrade-"));
  try {
    const databasePath = join(directory, "workspace.sqlite");
    const old = new DatabaseSync(databasePath);
    old.exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, applied_at TEXT NOT NULL); INSERT INTO schema_migrations VALUES (1, 'v1-local-workspace-baseline', '2026-08-07T00:00:00.000Z');");
    old.close();
    const store = new SqliteWorkspaceStore(databasePath);
    assert.equal(store.getDatabaseMaintenanceStatus().schemaVersion, 19);
    const tables = new DatabaseSync(databasePath, { readOnly: true });
    const names = tables.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '%run_sources' ORDER BY name").all().map((row) => (row as { name: string }).name);
    assert.deepEqual(names, ["country_pack_skill_run_sources", "plan_compilation_run_sources"]);
    tables.close();
    store.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

function storageCompilationProposal(planId: string, planVersion: number): PlanCompilationProposal {
  return {
    planRef: { id: planId, version: planVersion },
    countryPack: { id: "china", version: "0.0.0", name: "China Country Pack" },
    composition: { skillId: "china-arrival-plan", version: "0.1.0", status: "success" },
    compilationKey: "china-arrival-preparation",
    stage: { title: "China arrival preparation", description: "Review source-bound preparation." },
    tasks: [{
      proposalId: "arrival-preparation:carry-entry-documents",
      title: "Carry entry documents",
      description: "Keep the reviewed documents accessible.",
      owner: "user",
      dueLabel: "Before departure",
      sourceSkills: [{ id: "policy-applicability", version: "0.1.0" }, { id: "arrival-preparation", version: "0.1.0" }],
      reminder: { dueAt: "2026-08-31T21:00:00.000Z", timeZone: "Asia/Shanghai", purpose: "Carry entry documents", refreshFacts: [] }
    }],
    assumptions: [],
    limitations: ["No entry eligibility conclusion has been made."]
  };
}

test("SQLite persists a created Plan, a confirmation, and confirmed Profile data", () => {
  const store = new SqliteWorkspaceStore(":memory:");
  const created = store.createPlan({ request: "I am going to Shanghai in September 2026 for an exhibition." });
  const confirmed = store.confirmPlan(created.activePlan.id);
  const updated = store.updateProfile({
    displayName: "Avery",
    preferredLanguage: "English",
    nationality: "Canada",
    gender: "woman",
    immigrationStatus: "student_visa"
  });

  assert.equal(confirmed.activePlan.status, "active");
  assert.equal(updated.profile.nationality, "Canada");
  assert.equal(updated.profile.immigrationStatus, "student_visa");
  assert.equal(updated.system.storage, "local");
  store.close();
});

test("SQLite can clear every user Plan while preserving workspace configuration", () => {
  const store = new SqliteWorkspaceStore(":memory:");
  store.updateProfile({
    displayName: "Ricky",
    preferredLanguage: "简体中文",
    nationality: "United States",
    gender: "not_specified",
    immigrationStatus: "student_visa"
  });
  store.updateRuntimeSelection({ kind: "claude-code" });
  const first = store.createPlan({ request: "Study at Fudan University in Shanghai." });
  store.confirmPlan(first.activePlan.id);
  store.createPlan({ request: "Take a new trip to Tokyo." });

  const reset = store.resetPlansToEmptyState();

  assert.equal(reset.activePlan.title, "Attend an exhibition in Shanghai");
  assert.equal(reset.activePlan.version, 1);
  assert.equal(reset.executionPlan, undefined);
  assert.equal(store.listHistoricalPlans().length, 0);
  assert.equal(reset.profile.displayName, "Ricky");
  assert.equal(reset.runtime.selectedKind, "claude-code");
  store.close();
});

test("SQLite discards a standalone current draft and returns to the empty workspace", () => {
  const store = new SqliteWorkspaceStore(":memory:");
  store.createPlan({ request: "Study at Fudan University in Shanghai." });
  const draft = store.createPlan({ request: "Take a new trip to Paris." }).activePlan;

  const restored = store.discardCurrentDraft(draft.id);

  assert.equal(restored.activePlan.title, "Attend an exhibition in Shanghai");
  assert.equal(restored.activePlan.version, 1);
  assert.equal(store.listHistoricalPlans().some((plan) => plan.id === draft.id), false);
  store.close();
});

test("SQLite discards a replacement draft and restores the executing Plan", () => {
  const store = new SqliteWorkspaceStore(":memory:");
  const active = store.confirmPlan(store.createPlan({ request: "Take a trip to Lisbon." }).activePlan.id).activePlan;
  const replacement = store.createPlan({ request: "Replace Lisbon with Paris." }).activePlan;

  const restored = store.discardCurrentDraft(replacement.id);

  assert.equal(restored.activePlan.id, active.id);
  assert.equal(restored.activePlan.status, "active");
  assert.equal(restored.executionPlan, undefined);
  store.close();
});

test("SQLite does not discard an active Plan", () => {
  const store = new SqliteWorkspaceStore(":memory:");
  const active = store.confirmPlan(store.createPlan({ request: "Take a new trip to Paris." }).activePlan.id).activePlan;
  assert.throws(() => store.discardCurrentDraft(active.id), /Only an unconfirmed draft Plan/);
  store.close();
});

test("SQLite keeps partial Telegram Profile setup incomplete and expires pending text edits", () => {
  const store = new SqliteWorkspaceStore(":memory:");
  const initial = store.getWorkspace().profile;
  const nationalityOnly = store.updateProfile({ ...initial, nationality: "Canada" });
  assert.equal(nationalityOnly.profile.status, "incomplete");
  const ready = store.updateProfile({ ...nationalityOnly.profile, immigrationStatus: "student_visa" });
  assert.equal(ready.profile.status, "ready");
  const noVisaYet = store.updateProfile({ ...ready.profile, immigrationStatus: "no_visa" });
  assert.equal(noVisaYet.profile.status, "ready");
  assert.equal(noVisaYet.profile.immigrationStatus, "no_visa");

  store.startTelegramProfileTextEdit("nationality", "2026-08-07T00:00:00.000Z");
  assert.equal(store.getTelegramProfileTextEdit("2026-08-07T00:14:59.000Z"), "nationality");
  assert.equal(store.getTelegramProfileTextEdit("2026-08-07T00:15:01.000Z"), undefined);
  store.close();
});

test("SQLite binds temporary Telegram location use to a Plan and expires it", () => {
  const store = new SqliteWorkspaceStore(":memory:");
  const planId = store.getWorkspace().activePlan.id;
  store.startTelegramLocationIntent({ purpose: "nearby_food", planId, startedAt: "2026-08-07T00:00:00.000Z" });

  assert.deepEqual(store.getTelegramLocationIntent("2026-08-07T00:14:59.000Z"), { purpose: "nearby_food", planId });
  assert.equal(store.getTelegramLocationIntent("2026-08-07T00:15:01.000Z"), undefined);
  store.startTelegramLocationIntent({ purpose: "uber_test", planId, startedAt: "2026-08-07T00:16:00.000Z" });
  assert.deepEqual(store.getTelegramLocationIntent("2026-08-07T00:16:30.000Z"), { purpose: "uber_test", planId });
  store.startTelegramLocationIntent({ purpose: "movement_go", planId, startedAt: "2026-08-07T00:17:00.000Z" });
  assert.deepEqual(store.getTelegramLocationIntent("2026-08-07T00:17:30.000Z"), { purpose: "movement_go", planId });
  store.close();
});

test("SQLite keeps a one-route transport override temporary and purpose-bound", () => {
  const store = new SqliteWorkspaceStore(":memory:");
  const planId = store.getWorkspace().activePlan.id;
  store.startTelegramLocationIntent({ purpose: "arrival_route", planId, transportOverride: "taxi", startedAt: "2026-08-07T00:00:00.000Z" });

  assert.deepEqual(store.getTelegramLocationIntent("2026-08-07T00:14:59.000Z"), { purpose: "arrival_route", planId, transportOverride: "taxi" });
  assert.equal(store.getWorkspace().activePlan.configuration.transport.preference, "plan_recommended");
  assert.throws(() => store.startTelegramLocationIntent({ purpose: "nearby_food", planId, transportOverride: "taxi" }), /only valid for an arrival route/i);
  store.close();
});

test("SQLite persists the selected Plan runtime without storing any credentials", () => {
  const store = new SqliteWorkspaceStore(":memory:");
  assert.equal(store.getWorkspace().runtime.selectedKind, "codex");
  const updated = store.updateRuntimeSelection({ kind: "claude-code" });
  assert.equal(updated.runtime.selectedKind, "claude-code");
  assert.equal(updated.inbox[0]?.title, "Plan runtime selected");
  assert.match(updated.inbox[0]?.body ?? "", /never stored by Landi/i);
  store.close();
});

test("SQLite records a privacy-preserving Plan generation run", () => {
  const store = new SqliteWorkspaceStore(":memory:");
  const started = store.startPlanGenerationRun({ runtimeKind: "claude-code", trigger: "web" });
  const finished = store.finishPlanGenerationRun({ runId: started.id, status: "succeeded", outputPlanId: store.getWorkspace().activePlan.id });

  assert.equal(started.status, "running");
  assert.equal(finished.status, "succeeded");
  assert.equal(finished.outputPlanId, store.getWorkspace().activePlan.id);
  assert.equal(Object.hasOwn(finished, "prompt"), false);
  assert.equal(store.listRecentAgentRuns()[0]?.id, started.id);
  assert.throws(() => store.finishPlanGenerationRun({ runId: started.id, status: "failed", failureCode: "generation_failed" }));
  store.close();
});

test("SQLite persists official-source snapshots, deduplicates equal content, and reports later content changes", () => {
  const store = new SqliteWorkspaceStore(":memory:");
  const first = store.saveSourceSnapshot({
    sourceId: "nia-english",
    authority: "National Immigration Administration",
    titleOriginal: "Guidelines for Foreigners",
    url: "https://en.nia.gov.cn/guide",
    retrievedAt: "2026-08-07T08:00:00.000Z",
    contentHash: "a".repeat(64),
    excerpt: "First official evidence."
  });
  const duplicate = store.saveSourceSnapshot({ ...first.snapshot, contentHash: "a".repeat(64) });
  const changed = store.saveSourceSnapshot({
    sourceId: "nia-english",
    authority: "National Immigration Administration",
    titleOriginal: "Guidelines for Foreigners",
    url: "https://en.nia.gov.cn/guide",
    retrievedAt: "2026-08-08T08:00:00.000Z",
    contentHash: "b".repeat(64),
    excerpt: "Updated official evidence."
  });

  assert.equal(first.duplicate, false);
  assert.equal(first.contentChanged, false);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.snapshot.id, first.snapshot.id);
  assert.equal(changed.contentChanged, true);
  assert.equal(changed.previousSnapshot?.id, first.snapshot.id);
  assert.equal(store.getWorkspace().sourceSnapshots.length, 2);
  assert.equal(store.getWorkspace().sourceSnapshots[0]?.contentHash, "b".repeat(64));
  store.close();
});

test("SQLite refuses to mutate an active Plan when linking official evidence", () => {
  const store = new SqliteWorkspaceStore(":memory:");
  const plan = store.getWorkspace().activePlan;
  const snapshot = store.saveSourceSnapshot({ sourceId: "nia-english", authority: "National Immigration Administration", titleOriginal: "Guidance", url: "https://en.nia.gov.cn/guide", retrievedAt: "2026-08-07T08:00:00.000Z", contentHash: "a".repeat(64), excerpt: "Official evidence only." }).snapshot;
  store.confirmPlan(plan.id);
  assert.throws(() => store.linkSourceSnapshotToPlan(plan.id, snapshot.id), /only while.*draft/i);
  assert.equal(store.getWorkspace().activePlan.sources.length, 0);
  store.close();
});

test("SQLite links selected official evidence to the current Plan without making a policy conclusion", () => {
  const store = new SqliteWorkspaceStore(":memory:");
  const plan = store.getWorkspace().activePlan;
  const snapshot = store.saveSourceSnapshot({
    sourceId: "nia-english",
    authority: "National Immigration Administration",
    titleOriginal: "Guidelines for Foreigners",
    url: "https://en.nia.gov.cn/guide",
    retrievedAt: "2026-08-07T08:00:00.000Z",
    contentHash: "a".repeat(64),
    excerpt: "Official evidence only."
  }).snapshot;

  const linked = store.linkSourceSnapshotToPlan(plan.id, snapshot.id);
  const repeated = store.linkSourceSnapshotToPlan(plan.id, snapshot.id);

  assert.equal(linked.activePlan.sources.length, 1);
  assert.equal(linked.activePlan.sources[0]?.url, snapshot.url);
  assert.equal(linked.activePlan.sources[0]?.sourceSnapshotId, snapshot.id);
  assert.equal(linked.activePlan.sources[0]?.contentHash, snapshot.contentHash);
  assert.equal(linked.activePlan.version, plan.version + 1);
  assert.equal(repeated.activePlan.sources.length, 1);
  assert.match(linked.inbox[0]?.body ?? "", /does not determine/i);
  store.close();
});

test("SQLite persists a validated Agent-generated Plan", () => {
  const store = new SqliteWorkspaceStore(":memory:");
  const workspace = store.createGeneratedPlan({
    title: "Attend a Shanghai exhibition",
    location: "Shanghai, China",
    dates: "September 2026",
    knownInformation: ["Purpose: exhibition"],
    assumptions: ["Accommodation is unconfirmed."],
    nextAction: "Review the complete Plan.",
    presentation: {
      kind: "itinerary",
      summary: "One verified stop and one movement awaiting route facts.",
      startDate: "2026-09-01", endDate: "2026-09-01",
      days: [{ id: "day-1", label: "Arrival day", date: "2026-09-01", city: "Shanghai", title: "Exhibition arrival", summary: "Reach the exhibition venue after preserving arrival and check-in buffer.", placeIds: ["place-expo"], stops: [{ placeId: "place-expo", order: 1, time: "14:00" }] }],
      places: [{ id: "place-expo", name: "Exhibition venue", locationLabel: "Shanghai", city: "Shanghai", coordinates: [31.23, 121.47], category: "event", priority: "must", durationMinutes: 180, whyWorthIt: "It is the trip objective.", plan: "Arrive after check-in.", detailSections: [], sourceRefs: [] }],
      routeSegments: []
    },
    stages: [{ title: "Arrival", description: "Reach accommodation.", tasks: [{ title: "Open route", owner: "external", dueLabel: "At arrival", preparationCategory: "not_applicable", reminder: { scheduledAtLocal: "2026-09-01T05:00", timeZone: "Asia/Shanghai", purpose: "Prepare your passport and essential items." } }] }]
  });

  assert.equal(workspace.activePlan.title, "Attend a Shanghai exhibition");
  assert.equal(workspace.activePlan.stages[0]?.tasks[0]?.reminder?.scheduledAtLocal, "2026-09-01T05:00");
  assert.equal(workspace.activePlan.stages[0]?.tasks[0]?.preparationCategory, "not_applicable");
  assert.equal(workspace.activePlan.presentation?.places[0]?.id, "place-expo");
  assert.equal(store.listHistoricalPlans()[0]?.presentation, undefined);
  assert.equal(workspace.inbox[0]?.title, "Codex Plan draft saved locally");
  store.close();
});

test("SQLite seeds confirmed party size into a newly generated Plan", () => {
  const store = new SqliteWorkspaceStore(":memory:");
  const workspace = store.createGeneratedPlan({ title: "Party trip", location: "Paris", dates: "2026-10-12", knownInformation: [], assumptions: [], nextAction: "Review", stages: [{ title: "Plan", description: "Travel", presentationKind: "overview", tasks: [{ title: "Arrive", owner: "user", dueLabel: "Day 1" }] }] }, "codex", { partySize: 3, transportPreference: "public_transit", expectedArrivalAtLocal: "2026-10-12T14:30" });
  assert.equal(workspace.activePlan.configuration.travelContext.partySize, 3);
  assert.equal(workspace.activePlan.configuration.transport.preference, "public_transit");
  assert.equal(workspace.activePlan.configuration.arrival.expectedAtLocal, "2026-10-12T14:30");
  const zoned = store.saveGeneratedPlanArrivalTimeZone({ planId: workspace.activePlan.id, expectedVersion: workspace.activePlan.version, timeZone: "Europe/Paris" });
  assert.equal(zoned.activePlan.configuration.arrival.timeZone, "Europe/Paris");
  assert.throws(() => store.saveGeneratedPlanArrivalTimeZone({ planId: workspace.activePlan.id, expectedVersion: workspace.activePlan.version, timeZone: "Europe/Paris" }), /changed before/i);
  store.close();
});

test("SQLite refreshes exactly one version-bound route segment", () => {
  const store = new SqliteWorkspaceStore(":memory:");
  const plan = store.createGeneratedPlan({
    title: "Lisbon route",
    location: "Lisbon, Portugal",
    dates: "October 2026",
    knownInformation: ["Two named stops."],
    assumptions: [],
    nextAction: "Refresh the route.",
    presentation: {
      kind: "itinerary",
      summary: "A route awaiting facts.",
      startDate: "2026-10-12", endDate: "2026-10-12",
      days: [{ id: "day-1", label: "Day 1", date: "2026-10-12", city: "Lisbon", title: "Arrival and check-in", summary: "Protect a direct transfer from the airport to the hotel before any optional activity.", placeIds: ["airport", "hotel"], stops: [{ placeId: "airport", order: 1, time: "14:00" }, { placeId: "hotel", order: 2, time: "15:00" }], routeReview: { sequenceRationale: "Go directly from the arrival node to the accommodation with no sightseeing detour.", routingMethod: "Provisional transit plan pending Google Maps refresh." } }],
      places: [
        { id: "airport", name: "Airport", locationLabel: "Lisbon", city: "Lisbon", coordinates: [38.774, -9.135], category: "transport", priority: "must", whyWorthIt: "Arrival.", plan: "Continue to the hotel.", detailSections: [], sourceRefs: [] },
        { id: "hotel", name: "Hotel", locationLabel: "Lisbon", city: "Lisbon", coordinates: [38.711, -9.142], category: "accommodation", priority: "booked", whyWorthIt: "Base.", plan: "Check in.", detailSections: [], sourceRefs: [] }
      ],
      routeSegments: [{ id: "route-1", dayId: "day-1", originPlaceId: "airport", destinationPlaceId: "hotel", mode: "transit", verification: "needs_verification", durationMinutes: 40, label: "Airport transfer to the hotel", detail: "Allow a conservative 40-minute planning window and refresh the route before arrival.", sourceRefs: [] }]
    },
    stages: [{ title: "Itinerary", description: "Arrival.", presentationKind: "itinerary", tasks: [{ title: "Reach hotel", owner: "user", dueLabel: "Day 1" }] }]
  }).activePlan;
  const refreshed = store.savePlanRouteRefresh({ planId: plan.id, segmentId: "route-1", expectedVersion: plan.version, observedAt: "2026-08-17T10:00:00.000Z", distanceMeters: 8_400, durationSeconds: 1_620, originCoordinates: [-9.135, 38.774], destinationCoordinates: [-9.142, 38.711], provider: "google_maps" });
  const segment = refreshed.activePlan.presentation!.routeSegments[0]!;
  assert.equal(refreshed.activePlan.version, plan.version + 1);
  assert.deepEqual({ verification: segment.verification, distanceMeters: segment.distanceMeters, durationMinutes: segment.durationMinutes, checkedAt: segment.checkedAt, sourceRefs: segment.sourceRefs }, { verification: "verified", distanceMeters: 8_400, durationMinutes: 27, checkedAt: "2026-08-17T10:00:00.000Z", sourceRefs: ["google_maps"] });
  assert.deepEqual(refreshed.activePlan.presentation!.places.map((place) => place.coordinates), [[38.774, -9.135], [38.711, -9.142]]);
  const withoutDuration = store.savePlanRouteRefresh({ planId: plan.id, segmentId: "route-1", expectedVersion: refreshed.activePlan.version, observedAt: "2026-08-17T10:05:00.000Z", distanceMeters: 8_500, originCoordinates: [-9.135, 38.774], destinationCoordinates: [-9.142, 38.711], provider: "google_maps" });
  assert.equal(withoutDuration.activePlan.presentation!.routeSegments[0]!.durationMinutes, 27);
  assert.throws(() => store.savePlanRouteRefresh({ planId: plan.id, segmentId: "route-1", expectedVersion: plan.version, observedAt: "2026-08-17T10:00:00.000Z", distanceMeters: 1, originCoordinates: [0, 0], destinationCoordinates: [1, 1], provider: "google_maps" }), /changed before/i);
  store.close();
});

test("SQLite saves generated route facts and complete daily road geometry in one Plan version", () => {
  const store = new SqliteWorkspaceStore(":memory:");
  const plan = store.createGeneratedPlan({
    title: "Paris route", location: "Paris", dates: "October 2026", knownInformation: [], assumptions: [], nextAction: "Review.",
    presentation: { kind: "itinerary", summary: "One mapped day.", startDate: "2026-10-12", endDate: "2026-10-12", days: [{ id: "day-1", label: "Day 1", date: "2026-10-12", city: "Paris", title: "Art walk", summary: "Walk between two nearby anchors.", placeIds: ["a", "b"], stops: [{ placeId: "a", order: 1, time: "10:00" }, { placeId: "b", order: 2, time: "11:00" }], routeReview: { sequenceRationale: "Keep the two nearby stops together." } }], places: [
      { id: "a", name: "A", locationLabel: "Paris", city: "Paris", coordinates: [48.86, 2.33], category: "art", priority: "must", durationMinutes: 30, whyWorthIt: "A", plan: "Visit", detailSections: [], sourceRefs: [] },
      { id: "b", name: "B", locationLabel: "Paris", city: "Paris", coordinates: [48.865, 2.34], category: "art", priority: "preferred", durationMinutes: 60, whyWorthIt: "B", plan: "Visit", detailSections: [], sourceRefs: [] }
    ], routeSegments: [{ id: "r1", dayId: "day-1", originPlaceId: "a", destinationPlaceId: "b", mode: "walking", verification: "needs_verification", durationMinutes: 30, label: "Walk from A to B", detail: "Use a conservative 30-minute window until Google Maps verifies the route.", sourceRefs: [] }] },
    stages: [{ title: "Itinerary", description: "Art day.", presentationKind: "itinerary", tasks: [{ title: "Visit A", owner: "user", dueLabel: "Day 1" }] }]
  }).activePlan;
  const refresh = store.saveGeneratedPlanRouteRefresh({ planId: plan.id, expectedVersion: plan.version, provider: "google_maps", routes: [{ segmentId: "r1", observedAt: "2026-08-18T08:00:00.000Z", distanceMeters: 1_200, durationSeconds: 900, originCoordinates: [2.33, 48.86], destinationCoordinates: [2.34, 48.865], geometry: [[2.33, 48.86], [2.335, 48.862], [2.34, 48.865]] }] });
  const updated = refresh.workspace;
  assert.deepEqual(refresh.scheduleConflictDayIds, []);
  assert.equal(updated.activePlan.version, plan.version + 1);
  assert.deepEqual(updated.activePlan.presentation?.days[0]?.routeGeometry, [[2.33, 48.86], [2.335, 48.862], [2.34, 48.865]]);
  assert.equal(updated.activePlan.presentation?.days[0]?.routeGeometryMode, "walking");
  assert.equal(updated.activePlan.presentation?.days[0]?.routeReview?.routingMethod, "Google Maps Routes");
  assert.equal(updated.activePlan.presentation?.routeSegments[0]?.durationMinutes, 15);
  assert.match(updated.activePlan.presentation?.routeSegments[0]?.detail ?? "", /1\.2 km/);
  assert.deepEqual(updated.activePlan.presentation?.places.map((place) => place.coordinates), [[48.86, 2.33], [48.865, 2.34]]);
  const shifted = store.saveGeneratedPlanRouteRefresh({ planId: plan.id, expectedVersion: updated.activePlan.version, provider: "google_maps", routes: [{ segmentId: "r1", observedAt: "2026-08-18T08:10:00.000Z", distanceMeters: 4_500, durationSeconds: 5_400, originCoordinates: [2.33, 48.86], destinationCoordinates: [2.34, 48.865] }] });
  assert.deepEqual(shifted.scheduleConflictDayIds, []);
  assert.equal(shifted.workspace.activePlan.presentation?.days[0]?.stops?.[1]?.time, "12:00");
  store.close();
});

test("SQLite preserves fixed itinerary times and exposes a provider route conflict", () => {
  const store = new SqliteWorkspaceStore(":memory:");
  const plan = store.createGeneratedPlan({
    title: "Fixed Paris route", location: "Paris", dates: "2026-10-12", knownInformation: [], assumptions: [], nextAction: "Review",
    presentation: {
      kind: "itinerary", summary: "Two fixed visits", startDate: "2026-10-12", endDate: "2026-10-12",
      days: [{ id: "day-1", label: "Day 1", date: "2026-10-12", city: "Paris", title: "Two bookings", summary: "Keep both confirmed times visible.", placeIds: ["a", "b"], stops: [{ placeId: "a", order: 1, time: "10:00", role: "fixed" }, { placeId: "b", order: 2, time: "11:30", role: "fixed" }], routeReview: { sequenceRationale: "Move directly between two booked places." } }],
      places: [
        { id: "a", name: "A", locationLabel: "Paris", city: "Paris", coordinates: [48.85, 2.34], category: "museum", priority: "booked", durationMinutes: 60, whyWorthIt: "First booking", plan: "Visit", detailSections: [], sourceRefs: [] },
        { id: "b", name: "B", locationLabel: "Paris", city: "Paris", coordinates: [48.86, 2.35], category: "museum", priority: "booked", durationMinutes: 60, whyWorthIt: "Second booking", plan: "Visit", detailSections: [], sourceRefs: [] }
      ],
      routeSegments: [{ id: "r", dayId: "day-1", originPlaceId: "a", destinationPlaceId: "b", mode: "transit", verification: "needs_verification", durationMinutes: 30, label: "Transfer to B", detail: "Allow thirty minutes until refreshed.", sourceRefs: [] }]
    }, stages: []
  }).activePlan;
  const result = store.saveGeneratedPlanRouteRefresh({ planId: plan.id, expectedVersion: plan.version, provider: "google_maps", routes: [{ segmentId: "r", observedAt: "2026-08-18T08:00:00.000Z", distanceMeters: 5_000, durationSeconds: 3_600, originCoordinates: [2.34, 48.85], destinationCoordinates: [2.35, 48.86] }] });
  assert.deepEqual(result.scheduleConflictDayIds, ["day-1"]);
  assert.deepEqual(result.workspace.activePlan.presentation?.days[0]?.stops?.map((stop) => stop.time), ["10:00", "11:30"]);
  assert.equal(result.workspace.activePlan.presentation?.routeSegments[0]?.verification, "stale");
  assert.equal(result.workspace.activePlan.presentation?.routeSegments[0]?.durationMinutes, 30);
  assert.match(result.workspace.activePlan.presentation?.days[0]?.routeReview?.fixedConstraints?.at(-1) ?? "", /must be replanned/i);
  store.close();
});

test("SQLite atomically links draft accommodation to daily departure routes", () => {
  const store = new SqliteWorkspaceStore(":memory:");
  const plan = store.createGeneratedPlan({
    title: "Paris stay", location: "Paris", dates: "October 2026", knownInformation: [], assumptions: [], nextAction: "Add accommodation.",
    presentation: { kind: "itinerary", summary: "One day", startDate: "2026-10-06", endDate: "2026-10-06", days: [{ id: "day-1", label: "Day 1", date: "2026-10-06", city: "Paris", title: "Museum day", summary: "Use the museum as the day's single cultural anchor.", placeIds: ["museum"], stops: [{ placeId: "museum", order: 1, time: "10:00" }] }], places: [{ id: "museum", name: "Museum", locationLabel: "Paris", city: "Paris", coordinates: [48.86, 2.34], category: "museum", priority: "must", durationMinutes: 120, whyWorthIt: "Art", plan: "Visit", detailSections: [], sourceRefs: [] }], routeSegments: [] },
    stages: [{ title: "Itinerary", description: "Day", presentationKind: "itinerary", tasks: [{ title: "Visit", owner: "user", dueLabel: "Day 1" }] }]
  }).activePlan;
  const departure = { accommodationName: "Hotel", accommodationAddress: "1 Rue, Paris", destinationPlaceId: "museum", mode: "driving" as const, verification: "verified" as const, durationMinutes: 12, distanceMeters: 3_200, checkedAt: "2026-08-18T04:00:00Z" };
  const updated = store.saveDraftAccommodationLinkage({ planId: plan.id, expectedVersion: plan.version, accommodation: { status: "confirmed", name: "Hotel", address: "1 Rue, Paris", location: "2.33,48.85", source: "user" }, departures: [{ dayId: "day-1", departure }] });
  assert.equal(updated.activePlan.version, plan.version + 1);
  assert.equal(updated.activePlan.configuration.accommodation.name, "Hotel");
  assert.deepEqual(updated.activePlan.presentation?.days[0]?.accommodationDeparture, departure);
  const active = store.confirmPlan(plan.id).activePlan;
  assert.throws(() => store.saveDraftAccommodationLinkage({ planId: active.id, expectedVersion: active.version, accommodation: { status: "confirmed", name: "Other", address: "2 Rue", location: "2.34,48.86", source: "user" }, departures: [] }), /replacement draft/i);
  store.close();
});

test("SQLite saves itinerary map edits into the current Plan version", () => {
  const store = new SqliteWorkspaceStore(":memory:");
  const plan = store.createGeneratedPlan({
    title: "Paris map edits",
    location: "Paris",
    dates: "October",
    knownInformation: ["Two places."],
    assumptions: [],
    nextAction: "Review the map.",
    presentation: {
      kind: "itinerary",
      summary: "Two editable days.",
      startDate: "2026-10-12", endDate: "2026-10-13",
      days: [
        { id: "day-1", label: "Day 1", date: "2026-10-12", city: "Paris", title: "Museum and garden", summary: "Pair one museum anchor with a nearby outdoor rest stop.", placeIds: ["museum", "garden"], candidates: [], stops: [{ placeId: "museum", order: 1, time: "10:00" }, { placeId: "garden", order: 2, time: "14:00" }], routeGeometry: [[2.3, 48.8], [2.31, 48.81]], routeGeometryMode: "walking", routeGeometryReviewedAt: "2026-08-17T00:00:00Z", routeReview: { routingMethod: "Google Maps", sequenceRationale: "One short route." } },
        { id: "day-2", label: "Day 2", date: "2026-10-13", city: "Paris", title: "Quiet square", summary: "Keep one low-intensity neighborhood anchor on the second day.", placeIds: ["square"], stops: [{ placeId: "square", order: 1, time: "10:00" }] }
      ],
      places: [
        { id: "museum", name: "Museum", locationLabel: "Paris", city: "Paris", coordinates: [48.86, 2.34], category: "museum", priority: "must", durationMinutes: 120, whyWorthIt: "Art.", plan: "Visit.", detailSections: [], sourceRefs: [] },
        { id: "garden", name: "Garden", locationLabel: "Paris", city: "Paris", coordinates: [48.85, 2.33], category: "garden", priority: "nearby", durationMinutes: 60, whyWorthIt: "Rest.", plan: "Walk.", detailSections: [], sourceRefs: [] },
        { id: "square", name: "Neighborhood square", locationLabel: "Paris", city: "Paris", coordinates: [48.855, 2.335], category: "square", priority: "nearby", durationMinutes: 45, whyWorthIt: "A quiet local stop.", plan: "Pause.", detailSections: [], sourceRefs: [] }
      ],
      routeSegments: [{ id: "segment", originPlaceId: "museum", destinationPlaceId: "garden", dayId: "day-1", mode: "walking", verification: "verified", durationMinutes: 12, label: "Walk to the garden", detail: "Use the reviewed walking route after the museum visit.", checkedAt: "2026-08-17T00:00:00Z", sourceRefs: ["google_maps"] }]
    },
    stages: [{ title: "Itinerary", description: "Paris.", presentationKind: "itinerary", tasks: [{ title: "Visit Paris", owner: "user", dueLabel: "Day 1" }] }]
  }).activePlan;
  const saved = store.savePlanPresentationEdits({
    planId: plan.id,
    expectedVersion: plan.version,
    assignments: { museum: "day-2", garden: "day-1", square: "" },
    priorities: { museum: "preferred", garden: "must" },
    orders: { "day-1": ["garden"], "day-2": ["museum"] }
  });
  assert.equal(saved.activePlan.version, plan.version + 1);
  assert.deepEqual(saved.activePlan.presentation!.days.map((day) => day.placeIds), [["garden"], ["museum"]]);
  assert.deepEqual(saved.activePlan.presentation!.places.map((place) => place.priority), ["preferred", "must", "nearby"]);
  assert.equal(saved.activePlan.presentation!.days[0]!.candidates?.includes("garden"), false);
  assert.equal(saved.activePlan.presentation!.days[0]!.routeGeometry, undefined);
  assert.deepEqual(saved.activePlan.presentation!.routeSegments, []);
  assert.throws(() => store.savePlanPresentationEdits({ planId: plan.id, expectedVersion: plan.version, assignments: {}, priorities: {}, orders: {} }), /changed before/i);
  store.close();
});

test("SQLite applies active itinerary map edits without replacing unrelated days", () => {
  const store = new SqliteWorkspaceStore(":memory:");
  const draft = store.createGeneratedPlan({
    title: "Active Paris map", location: "Paris", dates: "2026-10-12 to 2026-10-13", knownInformation: [], assumptions: [], nextAction: "Follow the active plan.",
    presentation: {
      kind: "itinerary",
      summary: "Two active days.",
      startDate: "2026-10-12", endDate: "2026-10-13",
      days: [
        { id: "day-1", label: "Day 1", date: "2026-10-12", city: "Paris", title: "Museum and garden", summary: "Pair one museum anchor with a nearby outdoor stop.", placeIds: ["museum", "garden"], candidates: ["square"], stops: [{ placeId: "museum", order: 1, time: "10:00" }, { placeId: "garden", order: 2, time: "14:00" }], routeGeometry: [[2.3, 48.8], [2.31, 48.81]], routeGeometryMode: "walking", routeGeometryReviewedAt: "2026-08-17T00:00:00Z", routeReview: { routingMethod: "Google Maps", sequenceRationale: "One short route." } },
        { id: "day-2", label: "Day 2", date: "2026-10-13", city: "Paris", title: "Cafe and gallery", summary: "Keep a quiet second day.", placeIds: ["cafe", "gallery"], stops: [{ placeId: "cafe", order: 1, time: "10:00" }, { placeId: "gallery", order: 2, time: "12:00" }], routeGeometry: [[2.32, 48.82], [2.33, 48.83]], routeGeometryMode: "walking", routeGeometryReviewedAt: "2026-08-17T00:00:00Z", routeReview: { routingMethod: "Google Maps", sequenceRationale: "Keep the cafe before the gallery." } }
      ],
      places: [
        { id: "museum", name: "Museum", locationLabel: "Paris", city: "Paris", coordinates: [48.86, 2.34], category: "museum", priority: "must", durationMinutes: 120, whyWorthIt: "Art.", plan: "Visit.", detailSections: [], sourceRefs: [] },
        { id: "garden", name: "Garden", locationLabel: "Paris", city: "Paris", coordinates: [48.85, 2.33], category: "garden", priority: "nearby", durationMinutes: 60, whyWorthIt: "Rest.", plan: "Walk.", detailSections: [], sourceRefs: [] },
        { id: "square", name: "Neighborhood square", locationLabel: "Paris", city: "Paris", coordinates: [48.855, 2.335], category: "square", priority: "nearby", durationMinutes: 45, whyWorthIt: "A quiet local stop.", plan: "Pause.", detailSections: [], sourceRefs: [] },
        { id: "cafe", name: "Cafe", locationLabel: "Paris", city: "Paris", coordinates: [48.856, 2.336], category: "coffee", priority: "preferred", durationMinutes: 45, whyWorthIt: "Coffee.", plan: "Pause.", detailSections: [], sourceRefs: [] },
        { id: "gallery", name: "Gallery", locationLabel: "Paris", city: "Paris", coordinates: [48.857, 2.337], category: "gallery", priority: "preferred", durationMinutes: 60, whyWorthIt: "Art.", plan: "Visit.", detailSections: [], sourceRefs: [] }
      ],
      routeSegments: [
        { id: "museum-garden", originPlaceId: "museum", destinationPlaceId: "garden", dayId: "day-1", mode: "walking", verification: "verified", durationMinutes: 12, label: "Walk to the garden", detail: "Reviewed walk.", checkedAt: "2026-08-17T00:00:00Z", sourceRefs: ["google_maps"] },
        { id: "cafe-gallery", originPlaceId: "cafe", destinationPlaceId: "gallery", dayId: "day-2", mode: "walking", verification: "verified", durationMinutes: 8, label: "Walk to gallery", detail: "Reviewed walk.", checkedAt: "2026-08-17T00:00:00Z", sourceRefs: ["google_maps"] }
      ]
    },
    stages: [{ title: "Itinerary", description: "Paris.", presentationKind: "itinerary", tasks: [{ title: "Visit Paris", owner: "user", dueLabel: "Day 1" }] }]
  });
  const active = store.confirmPlan(draft.activePlan.id).activePlan;

  const saved = store.savePlanPresentationEdits({
    planId: active.id,
    expectedVersion: active.version,
    assignments: { museum: "day-1", garden: "", square: "day-1", cafe: "day-2", gallery: "day-2" },
    priorities: { square: "preferred" },
    orders: { "day-1": ["museum", "square"], "day-2": ["cafe", "gallery"] }
  });

  assert.equal(saved.activePlan.status, "active");
  assert.deepEqual(saved.activePlan.presentation!.days.map((day) => day.placeIds), [["museum", "square"], ["cafe", "gallery"]]);
  assert.equal(saved.activePlan.presentation!.days[0]!.routeGeometry, undefined);
  assert.deepEqual(saved.activePlan.presentation!.days[1]!.routeGeometry, [[2.32, 48.82], [2.33, 48.83]]);
  assert.equal(saved.activePlan.presentation!.routeSegments.find((segment) => segment.dayId === "day-1")?.verification, "needs_verification");
  assert.equal(saved.activePlan.presentation!.routeSegments.find((segment) => segment.id === "cafe-gallery")?.verification, "verified");
  assert.equal(saved.activePlan.stages[0]?.tasks[0]?.title, "Visit Paris");
  store.close();
});

test("SQLite keeps chronological time slots when a draft day is reordered", () => {
  const store = new SqliteWorkspaceStore(":memory:");
  const plan = store.createGeneratedPlan({
    title: "Reorder day", location: "Paris", dates: "2026-10-12", knownInformation: [], assumptions: [], nextAction: "Review",
    presentation: {
      kind: "itinerary", summary: "Two stops", startDate: "2026-10-12", endDate: "2026-10-12",
      days: [{ id: "d", label: "Day", date: "2026-10-12", city: "Paris", title: "Art day", summary: "Two nearby stops.", placeIds: ["a", "b"], stops: [{ placeId: "a", order: 1, time: "10:00" }, { placeId: "b", order: 2, time: "14:00" }], routeReview: { sequenceRationale: "Walk between two stops." } }],
      places: [
        { id: "a", name: "A", locationLabel: "Paris", city: "Paris", coordinates: [48.85, 2.34], category: "museum", priority: "must", durationMinutes: 90, whyWorthIt: "A", plan: "Visit", detailSections: [], sourceRefs: [] },
        { id: "b", name: "B", locationLabel: "Paris", city: "Paris", coordinates: [48.86, 2.35], category: "gallery", priority: "preferred", durationMinutes: 60, whyWorthIt: "B", plan: "Visit", detailSections: [], sourceRefs: [] }
      ],
      routeSegments: [{ id: "a-b", dayId: "d", originPlaceId: "a", destinationPlaceId: "b", mode: "walking", verification: "verified", durationMinutes: 20, label: "Walk", detail: "Verified walk", checkedAt: "2026-08-18", sourceRefs: ["google_maps"] }]
    }, stages: []
  }).activePlan;
  const saved = store.savePlanPresentationEdits({ planId: plan.id, expectedVersion: plan.version, assignments: { a: "d", b: "d" }, priorities: {}, orders: { d: ["b", "a"] } });
  const day = saved.activePlan.presentation!.days[0]!;
  assert.deepEqual(day.placeIds, ["b", "a"]);
  assert.deepEqual(day.stops?.map((stop) => [stop.placeId, stop.time]), [["b", "10:00"], ["a", "14:00"]]);
  assert.equal(saved.activePlan.presentation!.routeSegments[0]?.mode, "walking");
  assert.equal(saved.activePlan.presentation!.routeSegments[0]?.verification, "needs_verification");
  assert.equal(saved.activePlan.presentation!.routeSegments[0]?.durationMinutes, 20);
  store.close();
});

test("SQLite atomically persists a compiled draft with Skill provenance and audit", () => {
  const store = new SqliteWorkspaceStore(":memory:");
  const original = store.getWorkspace().activePlan;
  const snapshot = store.saveSourceSnapshot({ sourceId: "nia-english", authority: "National Immigration Administration", titleOriginal: "Guidance", url: "https://en.nia.gov.cn/", retrievedAt: "2026-08-07T00:00:00.000Z", contentHash: "a".repeat(64), excerpt: "Official guidance." }).snapshot;
  const evidence = [{ sourceSnapshotId: snapshot.id, contentHash: snapshot.contentHash }];
  const proposal = storageCompilationProposal(original.id, original.version);
  proposal.sourceEvidence = evidence;
  proposal.tasks[0]!.sourceEvidence = evidence;
  const decision = compilePlanProposal(original, proposal, new Date("2026-08-07T00:00:00.000Z"));
  assert.equal(decision.status, "compiled");
  if (decision.status !== "compiled") return;
  const saved = store.saveCompiledPlan({ plan: decision.plan, expectedPlanId: original.id, expectedVersion: original.version, audit: decision.audit, skillRuns: [{ skillId: "policy-applicability", skillVersion: "0.1.0", status: "success", sourceEvidence: evidence }], compiledAt: "2026-08-07T00:01:00.000Z" });
  const generatedStage = saved.activePlan.stages.find((stage) => stage.origin?.compilationKey === "china-arrival-preparation");
  assert.equal(saved.activePlan.version, original.version + 1);
  assert.equal(saved.activePlan.status, "draft");
  assert.equal(generatedStage?.tasks[0]?.description, "Keep the reviewed documents accessible.");
  assert.equal(generatedStage?.tasks[0]?.origin?.sourcePlanVersion, original.version);
  assert.deepEqual(generatedStage?.tasks[0]?.origin?.sourceEvidence, evidence);
  assert.equal(generatedStage?.tasks[0]?.reminder?.scheduledAtLocal, "2026-09-01T05:00");
  const run = store.listRecentPlanCompilationRuns()[0];
  assert.equal(run?.planId, original.id);
  assert.equal(run?.sourcePlanVersion, original.version);
  assert.equal(run?.compiledPlanVersion, original.version + 1);
  assert.equal(run?.taskCount, 1);
  assert.equal(run?.reminderCount, 1);
  assert.deepEqual(run?.sourceEvidence, evidence);
  assert.deepEqual(store.listRecentCountryPackSkillRuns()[0]?.sourceEvidence, evidence);
  assert.equal(Object.hasOwn(run ?? {}, "proposal"), false);
  assert.match(saved.inbox[0]?.body ?? "", /No Task, Reminder, or external action was activated/);

  assert.throws(() => store.saveCompiledPlan({ plan: decision.plan, expectedPlanId: original.id, expectedVersion: original.version, audit: decision.audit }), /changed before/i);
  assert.equal(store.getWorkspace().activePlan.version, original.version + 1);
  assert.equal(store.listRecentPlanCompilationRuns().length, 1);
  store.close();
});

test("SQLite rejects compilation metadata that does not match generated content", () => {
  const store = new SqliteWorkspaceStore(":memory:");
  const original = store.getWorkspace().activePlan;
  const decision = compilePlanProposal(original, storageCompilationProposal(original.id, original.version), new Date("2026-08-07T00:00:00.000Z"));
  assert.equal(decision.status, "compiled");
  if (decision.status !== "compiled") return;
  assert.throws(() => store.saveCompiledPlan({ plan: decision.plan, expectedPlanId: original.id, expectedVersion: original.version, audit: { ...decision.audit, taskCount: 99 } }), /counts do not match/i);
  assert.equal(store.getWorkspace().activePlan.version, original.version);
  assert.equal(store.listRecentPlanCompilationRuns().length, 0);
  store.close();
});

test("SQLite rejects compilation evidence that is not an exact stored snapshot", () => {
  const store = new SqliteWorkspaceStore(":memory:");
  const original = store.getWorkspace().activePlan;
  const evidence = [{ sourceSnapshotId: "source-missing", contentHash: "d".repeat(64) }];
  const proposal = storageCompilationProposal(original.id, original.version);
  proposal.sourceEvidence = evidence;
  proposal.tasks[0]!.sourceEvidence = evidence;
  const decision = compilePlanProposal(original, proposal, new Date("2026-08-07T00:00:00.000Z"));
  assert.equal(decision.status, "compiled");
  if (decision.status !== "compiled") return;
  assert.throws(() => store.saveCompiledPlan({ plan: decision.plan, expectedPlanId: original.id, expectedVersion: original.version, audit: decision.audit }), /stored immutable source snapshot/i);
  assert.equal(store.getWorkspace().activePlan.version, original.version);
  assert.equal(store.listRecentPlanCompilationRuns().length, 0);
  store.close();
});

test("SQLite refuses a compiled write when the targeted draft was activated first", () => {
  const store = new SqliteWorkspaceStore(":memory:");
  const original = store.getWorkspace().activePlan;
  const decision = compilePlanProposal(original, storageCompilationProposal(original.id, original.version), new Date("2026-08-07T00:00:00.000Z"));
  assert.equal(decision.status, "compiled");
  if (decision.status !== "compiled") return;
  store.confirmPlan(original.id);
  assert.throws(() => store.saveCompiledPlan({ plan: decision.plan, expectedPlanId: original.id, expectedVersion: original.version, audit: decision.audit }), /changed before/i);
  assert.equal(store.getWorkspace().activePlan.status, "active");
  assert.equal(store.listRecentPlanCompilationRuns().length, 0);
  store.close();
});

test("SQLite preserves a compiled UTC Reminder", () => {
  const store = new SqliteWorkspaceStore(":memory:");
  const original = store.getWorkspace().activePlan;
  const proposal = storageCompilationProposal(original.id, original.version);
  proposal.tasks[0]!.reminder = { dueAt: "2026-08-31T21:00:00.000Z", timeZone: "UTC", purpose: "Carry entry documents", refreshFacts: [] };
  const decision = compilePlanProposal(original, proposal, new Date("2026-08-07T00:00:00.000Z"));
  assert.equal(decision.status, "compiled");
  if (decision.status !== "compiled") return;
  const saved = store.saveCompiledPlan({ plan: decision.plan, expectedPlanId: original.id, expectedVersion: original.version, audit: decision.audit });
  const reminder = saved.activePlan.stages.find((stage) => stage.origin)?.tasks[0]?.reminder;
  assert.equal(reminder?.timeZone, "UTC");
  assert.equal(reminder?.scheduledAtLocal, "2026-08-31T21:00");
  store.close();
});

test("SQLite revises only the expected draft and preserves its Plan-scoped configuration", () => {
  const store = new SqliteWorkspaceStore(":memory:");
  const original = store.getWorkspace().activePlan;
  const configured = store.updatePlanTravelContext(original.id, { partySize: 2, luggage: "heavy" }).activePlan;
  const draft = {
    title: "Revised Shanghai arrival",
    location: "Shanghai, China",
    dates: "September 2, 2026",
    knownInformation: ["Arrival moved to September 2."],
    assumptions: [],
    nextAction: "Review the revised Plan.",
    stages: [{ title: "Arrival", description: "Arrive.", tasks: [{ title: "Reach accommodation", owner: "external" as const, dueLabel: "At arrival" }] }]
  };
  const revised = store.reviseGeneratedPlan({
    expectedPlanId: configured.id,
    expectedVersion: configured.version,
    runtime: "claude-code",
    draft
  });

  assert.notEqual(revised.activePlan.id, configured.id);
  assert.equal(revised.activePlan.status, "draft");
  assert.equal(revised.activePlan.dates, "September 2, 2026");
  assert.deepEqual(revised.activePlan.configuration.travelContext, { partySize: 2, luggage: "heavy" });
  const historical = store.listHistoricalPlans();
  assert.equal(historical[0]?.id, configured.id);
  assert.equal(historical[0]?.stages[0]?.tasks[0]?.title, original.stages[0]?.tasks[0]?.title);
  assert.equal(store.listHistoricalPlans(1).length, 1);
  assert.equal(revised.inbox[0]?.title, "Claude Code revised Plan draft saved locally");
  assert.throws(() => store.reviseGeneratedPlan({ expectedPlanId: configured.id, expectedVersion: configured.version, draft }), /changed while/i);
  store.close();
});

test("SQLite turns an active Plan revision into a replacement draft without interrupting execution", () => {
  const store = new SqliteWorkspaceStore(":memory:");
  const initial = store.getWorkspace().activePlan;
  const snapshot = store.saveSourceSnapshot({
    sourceId: "nia-english",
    authority: "National Immigration Administration",
    titleOriginal: "Guidelines for Foreigners",
    url: "https://en.nia.gov.cn/guide",
    retrievedAt: "2026-08-10T08:00:00.000Z",
    contentHash: "c".repeat(64),
    excerpt: "Official evidence only."
  }).snapshot;
  store.linkSourceSnapshotToPlan(initial.id, snapshot.id);
  const active = store.confirmPlan(initial.id).activePlan;
  const revised = store.reviseGeneratedPlan({
    expectedPlanId: active.id,
    expectedVersion: active.version,
    draft: {
      title: "Adjusted China Plan",
      location: active.location,
      dates: active.dates,
      knownInformation: ["The user requested a complete adjustment."],
      assumptions: [],
      nextAction: "Review the complete replacement.",
      stages: [{ title: "Adjusted stage", description: "Review it.", tasks: [{ title: "Adjusted task", owner: "user", dueLabel: "After confirmation" }] }]
    }
  });

  assert.equal(revised.activePlan.status, "draft");
  assert.deepEqual(revised.activePlan.sources, active.sources);
  assert.equal(revised.executionPlan?.id, active.id);
  assert.equal(store.getExecutionPlan()?.id, active.id);
  assert.equal(store.listHistoricalPlans().some((plan) => plan.id === active.id), false);
  const audit = revised.latestPlanReplacement;
  assert.equal(audit?.sourcePlanId, active.id);
  assert.equal(audit?.sourcePlanVersion, active.version);
  assert.equal(audit?.replacementPlanId, revised.activePlan.id);
  assert.deepEqual(audit?.affectedAreas, ["itinerary"]);
  assert.deepEqual(audit?.revalidationScopes, ["route_facts", "time_estimates"]);
  const activated = store.confirmPlan(revised.activePlan.id).activePlan;
  const restored = store.undoLatestPlanReplacement({ expectedPlanId: activated.id, expectedVersion: activated.version });
  assert.equal(restored.activePlan.id, active.id);
  assert.equal(restored.activePlan.status, "active");
  assert.equal(store.getExecutionPlan()?.id, active.id);
  assert.equal(store.listHistoricalPlans().some((plan) => plan.id === activated.id), true);
  assert.throws(() => store.undoLatestPlanReplacement({ expectedPlanId: active.id, expectedVersion: active.version }), /no latest replacement/i);
  store.close();
});

test("SQLite records high-impact revalidation scopes and preserved completion handover", () => {
  const store = new SqliteWorkspaceStore(":memory:");
  const original = store.createGeneratedPlan({
    title: "Lisbon Plan",
    location: "Lisbon, Portugal",
    dates: "October 1–5, 2026",
    knownInformation: [],
    assumptions: [],
    nextAction: "Prepare.",
    stages: [{ title: "Preparation", description: "Get ready.", tasks: [{ title: "Pack passport", owner: "user", dueLabel: "Before departure", preparationCategory: "documents" }] }]
  }).activePlan;
  const completed = store.setPlanTaskChecked(original.id, original.stages[0]!.tasks[0]!.id, true).activePlan;
  const revised = store.reviseGeneratedPlan({
    expectedPlanId: completed.id,
    expectedVersion: completed.version,
    changeImpact: {
      planId: completed.id,
      baseVersion: completed.version,
      impact: "high",
      summary: "Dates and accommodation changed.",
      reasons: ["Recheck timing and routes."],
      affectedAreas: ["dates", "accommodation"],
      requiresConfirmation: true,
      createsReplacementDraft: true
    },
    draft: {
      title: "Revised Lisbon Plan",
      location: "Lisbon, Portugal",
      dates: "October 2–6, 2026",
      knownInformation: [],
      assumptions: [],
      nextAction: "Review.",
      stages: [{ title: "Preparation", description: "Get ready.", tasks: [{ title: "Pack passport", owner: "user", dueLabel: "Before departure" }] }]
    }
  });
  const audit = revised.latestPlanReplacement!;
  assert.equal(audit.impact, "high");
  assert.deepEqual(audit.revalidationScopes, ["time_estimates", "official_sources", "reminders", "route_facts", "accommodation_options"]);
  assert.deepEqual(audit.preservedCompletedTasks.map((item) => item.title), ["Pack passport"]);
  assert.equal(revised.activePlan.stages[0]!.tasks[0]!.status, "completed");
  assert.deepEqual(store.getLatestPlanReplacementAudit(revised.activePlan.id), audit);
  store.close();
});

test("SQLite persists Web preparation checklist changes only for user-owned current tasks", () => {
  const store = new SqliteWorkspaceStore(":memory:");
  const workspace = store.createGeneratedPlan({
    title: "Preparation checklist",
    location: "Shanghai, China",
    dates: "October 2026",
    knownInformation: ["A preparation checklist is needed."],
    assumptions: [],
    nextAction: "Complete preparation.",
    stages: [{ title: "应急资料", description: "Prepare before travel.", tasks: [
      { title: "Passport", owner: "user", dueLabel: "Before departure", preparationCategory: "documents" },
      { title: "Open official app", owner: "external", dueLabel: "Before departure" },
      { title: "Choose airport transport", owner: "user", dueLabel: "Before leaving the airport" }
    ] }]
  }, "codex");
  const [userTask, externalTask, arrivalTask] = workspace.activePlan.stages[0]?.tasks ?? [];

  const checked = store.setPlanTaskChecked(workspace.activePlan.id, userTask?.id ?? "", true);
  assert.equal(checked.activePlan.stages[0]?.tasks[0]?.status, "completed");
  const unchecked = store.setPlanTaskChecked(workspace.activePlan.id, userTask?.id ?? "", false);
  assert.equal(unchecked.activePlan.stages[0]?.tasks[0]?.status, "waiting_user");
  assert.throws(() => store.setPlanTaskChecked(workspace.activePlan.id, externalTask?.id ?? "", true), /packing items and pre-departure tasks/i);
  assert.throws(() => store.setPlanTaskChecked(workspace.activePlan.id, arrivalTask?.id ?? "", true), /packing items and pre-departure tasks/i);
  store.close();
});

test("SQLite carries checked completion facts into a revised Plan without another reminder", () => {
  const store = new SqliteWorkspaceStore(":memory:");
  const workspace = store.createGeneratedPlan({
    title: "Trip preparation",
    location: "Shanghai, China",
    dates: "October 2026",
    knownInformation: [],
    assumptions: [],
    nextAction: "Prepare.",
    stages: [{ title: "应急资料", description: "Prepare before travel.", tasks: [{
      title: "Pack passport",
      owner: "user",
      dueLabel: "Before departure",
      reminder: { scheduledAtLocal: "2026-10-01T09:00", timeZone: "Asia/Shanghai", purpose: "Pack the passport." }
    }] }]
  });
  const originalTask = workspace.activePlan.stages[0]!.tasks[0]!;
  const checked = store.setPlanTaskChecked(workspace.activePlan.id, originalTask.id, true);
  const revised = store.reviseGeneratedPlan({
    expectedPlanId: checked.activePlan.id,
    expectedVersion: checked.activePlan.version,
    draft: {
      title: "Revised trip preparation",
      location: "Shanghai, China",
      dates: "October 2026",
      knownInformation: [],
      assumptions: [],
      nextAction: "Continue preparing.",
      stages: [{ title: "应急资料", description: "Prepare before travel.", tasks: [{
        title: "Pack passport",
        owner: "user",
        dueLabel: "Before departure",
        reminder: { scheduledAtLocal: "2026-10-01T09:00", timeZone: "Asia/Shanghai", purpose: "Pack the passport again." }
      }] }]
    }
  });
  const carried = revised.activePlan.stages[0]!.tasks[0]!;
  assert.equal(carried.status, "completed");
  assert.equal(carried.reminder, undefined);
  store.close();
});

test("SQLite deletes only archived history Plans", () => {
  const store = new SqliteWorkspaceStore(":memory:");
  const original = store.getWorkspace().activePlan;
  const replacement = store.createPlan({ request: "I am going to Beijing next month." }).activePlan;
  assert.equal(store.listHistoricalPlans().some((plan) => plan.id === original.id), true);
  assert.equal(store.deleteHistoricalPlan(original.id), true);
  assert.equal(store.listHistoricalPlans().some((plan) => plan.id === original.id), false);
  assert.throws(() => store.deleteHistoricalPlan(replacement.id), /cannot be deleted/i);
  store.close();
});

test("SQLite keeps an Amap accommodation candidate inside the current Plan", () => {
  const store = new SqliteWorkspaceStore(":memory:");
  const plan = store.getWorkspace().activePlan;
  const updated = store.updatePlanAccommodation(plan.id, {
    id: "stay-1",
    name: "Riverside Hotel",
    address: "1 River Road",
    location: "121.456,31.250",
    source: "amap",
    status: "candidate"
  });

  assert.equal(updated.activePlan.configuration.accommodation.status, "candidate");
  assert.equal(updated.activePlan.configuration.accommodation.name, "Riverside Hotel");
  assert.equal(updated.activePlan.version, plan.version + 1);
  const confirmed = store.updatePlanAccommodation(plan.id, {
    id: "stay-1",
    name: "Riverside Hotel",
    address: "1 River Road",
    location: "121.456,31.250",
    source: "amap",
    status: "confirmed"
  });
  assert.equal(confirmed.activePlan.configuration.accommodation.status, "confirmed");
  assert.equal(confirmed.activePlan.version, plan.version + 2);
  store.close();
});

test("SQLite keeps a user-entered accommodation inside the current Plan", () => {
  const store = new SqliteWorkspaceStore(":memory:");
  const plan = store.getWorkspace().activePlan;

  const updated = store.updatePlanAccommodation(plan.id, {
    name: "Harbour Hotel",
    address: "8 Riverside Road, Shanghai",
    location: "121.490,31.230",
    source: "user",
    status: "confirmed"
  });

  assert.equal(updated.activePlan.configuration.accommodation.status, "confirmed");
  assert.equal(updated.activePlan.configuration.accommodation.source, "user");
  assert.equal(updated.activePlan.configuration.accommodation.location, "121.490,31.230");
  store.close();
});

test("SQLite keeps a transport preference inside the current Plan", () => {
  const store = new SqliteWorkspaceStore(":memory:");
  const plan = store.getWorkspace().activePlan;
  const updated = store.updatePlanTransportPreference(plan.id, { preference: "public_transit" });

  assert.equal(updated.activePlan.configuration.transport.preference, "public_transit");
  assert.equal(updated.activePlan.version, plan.version + 1);
  store.close();
});

test("SQLite keeps travel party and luggage context inside the current Plan", () => {
  const store = new SqliteWorkspaceStore(":memory:");
  const plan = store.getWorkspace().activePlan;
  const updated = store.updatePlanTravelContext(plan.id, { partySize: 3, luggage: "heavy" });

  assert.equal(updated.activePlan.configuration.travelContext.partySize, 3);
  assert.equal(updated.activePlan.configuration.travelContext.luggage, "heavy");
  store.close();
});

test("SQLite keeps and clears expected arrival timing inside the current Plan", () => {
  const store = new SqliteWorkspaceStore(":memory:");
  const plan = store.getWorkspace().activePlan;
  const updated = store.updatePlanArrival(plan.id, { expectedAtLocal: "2026-09-01T07:00", timeZone: "Asia/Shanghai" });

  assert.equal(updated.activePlan.configuration.arrival.expectedAtLocal, "2026-09-01T07:00");
  assert.equal(updated.activePlan.configuration.arrival.timeZone, "Asia/Shanghai");
  const cleared = store.updatePlanArrival(plan.id, { timeZone: "Asia/Shanghai" });
  assert.equal(cleared.activePlan.configuration.arrival.expectedAtLocal, undefined);
  store.close();
});

test("SQLite stores one explicit Telegram pairing and records it in the Inbox", () => {
  const store = new SqliteWorkspaceStore(":memory:");
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
  const pending = store.createTelegramPairingRequest({ code: "pairing_code_123", expiresAt });

  assert.equal(pending.state, "waiting_for_start");
  const paired = store.claimTelegramPairing({ code: "pairing_code_123", chatId: "1001", userId: "1001", firstName: "Avery", username: "avery" });
  assert.equal(paired.state, "paired");
  assert.equal(paired.binding?.chatId, "1001");
  assert.equal(store.getWorkspace().inbox[0]?.title, "Telegram paired");
  store.close();
});

test("SQLite disconnects only the Telegram binding and preserves the workspace", () => {
  const store = new SqliteWorkspaceStore(":memory:");
  const planId = store.getWorkspace().activePlan.id;
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
  store.createTelegramPairingRequest({ code: "pairing_code_456", expiresAt });
  store.claimTelegramPairing({ code: "pairing_code_456", chatId: "1002", userId: "1002", firstName: "Avery" });

  store.startTelegramProfileTextEdit("nationality");
  store.startTelegramLocationIntent({ purpose: "nearby_food", planId });
  const disconnected = store.unpairTelegram();

  assert.equal(disconnected.state, "not_paired");
  assert.equal(store.getWorkspace().activePlan.id, planId);
  assert.equal(store.getTelegramProfileTextEdit(), undefined);
  assert.equal(store.getTelegramLocationIntent(), undefined);
  assert.equal(store.getWorkspace().inbox[0]?.title, "Telegram disconnected");
  assert.match(store.getWorkspace().inbox[0]?.body ?? "", /were not deleted/i);
  store.close();
});

test("SQLite keeps the Telegram update cursor across reads", () => {
  const store = new SqliteWorkspaceStore(":memory:");
  assert.equal(store.getTelegramUpdateOffset(), undefined);
  store.advanceTelegramUpdateOffset(41);
  store.advanceTelegramUpdateOffset(40);
  assert.equal(store.getTelegramUpdateOffset(), 41);
  store.close();
});

test("SQLite only claims one Telegram update once", () => {
  const store = new SqliteWorkspaceStore(":memory:");
  assert.equal(store.claimTelegramUpdate(41), true);
  assert.equal(store.claimTelegramUpdate(41), false);
  store.close();
});

test("SQLite only claims one signed WhatsApp message once", () => {
  const store = new SqliteWorkspaceStore(":memory:");
  assert.equal(store.claimWhatsAppMessage("wamid.message-41"), true);
  assert.equal(store.claimWhatsAppMessage("wamid.message-41"), false);
  assert.throws(() => store.claimWhatsAppMessage("invalid"));
  store.close();
});

test("SQLite records an arrival reminder delivery attempt only once per Plan", () => {
  const store = new SqliteWorkspaceStore(":memory:");
  const planId = store.getWorkspace().activePlan.id;
  const reminder = { planId, reminderKey: "arrival-check-in", dueAt: "2026-09-01T00:00:00.000Z" };
  assert.equal(store.claimTelegramReminder(reminder), true);
  assert.equal(store.claimTelegramReminder(reminder), false);
  store.close();
});

test("SQLite retries itinerary reminders and rejects them after the executing Plan changes", () => {
  const store = new SqliteWorkspaceStore(":memory:");
  const workspace = store.createGeneratedPlan({
    title: "Paris day", location: "Paris", dates: "August 18, 2026", knownInformation: [], assumptions: [], nextAction: "Review",
    presentation: {
      kind: "itinerary", summary: "One fixed visit", startDate: "2026-08-18", endDate: "2026-08-18",
      days: [{ id: "day-1", label: "Aug 18", date: "2026-08-18", city: "Paris", title: "Museum", summary: "A timed museum visit.", placeIds: ["museum"], stops: [{ placeId: "museum", order: 1, time: "10:00", role: "fixed anchor" }] }],
      places: [{ id: "museum", name: "Museum", locationLabel: "Paris", city: "Paris", coordinates: [48.86, 2.34], category: "museum", priority: "booked", durationMinutes: 120, whyWorthIt: "Visit", plan: "Arrive on time", detailSections: [], sourceRefs: [] }],
      routeSegments: []
    }, stages: []
  });
  const planId = workspace.activePlan.id;
  const reminder = { planId, reminderKey: "itinerary-departure:day-1:museum:2026-08-18T08:00:00.000Z", dayId: "day-1", placeId: "museum", scheduledTime: "10:00", dueAt: "2026-08-18T07:30:00.000Z" };
  store.confirmPlan(planId);

  assert.deepEqual(store.claimTelegramItineraryReminderAttempt({ ...reminder, now: reminder.dueAt }), { claimed: true, attemptNumber: 1 });
  assert.deepEqual(store.recordTelegramItineraryReminderFailure({ ...reminder, failureCode: "network_error", retryable: true, failedAt: "2026-08-18T07:30:01.000Z" }), { status: "retry_scheduled", nextAttemptAt: "2026-08-18T07:31:01.000Z" });
  assert.deepEqual(store.claimTelegramItineraryReminderAttempt({ ...reminder, now: "2026-08-18T07:31:01.000Z" }), { claimed: true, attemptNumber: 2 });
  store.recordTelegramItineraryReminderDelivered({ ...reminder, deliveredAt: "2026-08-18T07:31:02.000Z" });
  assert.equal(store.claimTelegramItineraryReminderAttempt({ ...reminder, now: "2026-08-18T07:32:00.000Z" }).claimed, false);

  const replacement = store.createPlan({ request: "Create a London Plan." });
  store.confirmPlan(replacement.activePlan.id);
  assert.equal(store.claimTelegramItineraryReminderAttempt({ ...reminder, reminderKey: `${reminder.reminderKey}:stale`, now: "2026-08-18T07:32:00.000Z" }).claimed, false);
  store.close();
});

test("SQLite mirrors a delivered Task reminder into the Web Inbox", () => {
  const store = new SqliteWorkspaceStore(":memory:");
  const workspace = store.createGeneratedPlan({
    title: "Prepare for departure",
    location: "Shanghai, China",
    dates: "September 1, 2026",
    knownInformation: ["Departure at 07:00."],
    assumptions: [],
    nextAction: "Review the reminder.",
    stages: [{ title: "Departure", description: "Prepare.", tasks: [{ title: "Check essentials", owner: "user", dueLabel: "Two hours before departure", reminder: { scheduledAtLocal: "2026-09-01T05:00", timeZone: "Asia/Shanghai", purpose: "Check passport and essential items.", refreshFacts: ["weather"] } }] }]
  });
  const task = workspace.activePlan.stages[0]!.tasks[0]!;
  const reminder = task.reminder!;
  const reminderKey = `task-reminder:${task.id}:2026-08-31T21:00:00.000Z`;
  assert.deepEqual(reminder.refreshFacts, ["weather"]);

  store.confirmPlan(workspace.activePlan.id);
  assert.deepEqual(store.claimTelegramTaskReminderAttempt({ planId: workspace.activePlan.id, reminderKey, taskId: task.id, dueAt: "2026-08-31T21:00:00.000Z", reminder, now: "2026-08-31T21:00:00.000Z" }), { claimed: true, attemptNumber: 1 });
  store.recordTelegramTaskReminderDelivered({ planId: workspace.activePlan.id, reminderKey, taskId: task.id, taskTitle: task.title, reminder, deliveredAt: "2026-08-31T21:00:01.000Z" });

  assert.equal(store.getWorkspace().inbox[0]?.title, "Reminder sent: Check essentials");
  assert.equal(store.getWorkspace().inbox[0]?.body, "Check passport and essential items.");
  assert.equal(store.claimTelegramTaskReminderAttempt({ planId: workspace.activePlan.id, reminderKey, taskId: task.id, dueAt: "2026-08-31T21:00:00.000Z", reminder, now: "2026-08-31T21:02:00.000Z" }).claimed, false);
  store.close();
});

test("SQLite rejects a stale Task reminder when its dynamic fact policy changed", () => {
  const store = new SqliteWorkspaceStore(":memory:");
  const workspace = store.createGeneratedPlan({
    title: "Prepare for departure",
    location: "Shanghai, China",
    dates: "September 1, 2026",
    knownInformation: [],
    assumptions: [],
    nextAction: "Review.",
    stages: [{ title: "Departure", description: "Prepare.", tasks: [{ title: "Pack", owner: "user", dueLabel: "Morning", reminder: { scheduledAtLocal: "2026-09-01T05:00", timeZone: "Asia/Shanghai", purpose: "Pack for departure.", refreshFacts: ["weather"] } }] }]
  });
  const task = workspace.activePlan.stages[0]!.tasks[0]!;
  const dueAt = "2026-08-31T21:00:00.000Z";
  store.confirmPlan(workspace.activePlan.id);

  assert.equal(store.claimTelegramTaskReminderAttempt({
    planId: workspace.activePlan.id,
    reminderKey: `task-reminder:${task.id}:${dueAt}`,
    taskId: task.id,
    dueAt,
    reminder: { ...task.reminder!, refreshFacts: [] },
    now: dueAt
  }).claimed, false);
  store.close();
});

test("SQLite cancels a Task reminder and rejects a stale in-memory delivery attempt", () => {
  const store = new SqliteWorkspaceStore(":memory:");
  const workspace = store.createGeneratedPlan({
    title: "Prepare for departure",
    location: "Shanghai, China",
    dates: "September 1, 2026",
    knownInformation: ["Departure at 07:00."],
    assumptions: [],
    nextAction: "Review the reminder.",
    stages: [{ title: "Departure", description: "Prepare.", tasks: [{ title: "Check essentials", owner: "user", dueLabel: "Two hours before departure", reminder: { scheduledAtLocal: "2026-09-01T05:00", timeZone: "Asia/Shanghai", purpose: "Check passport and essential items." } }] }]
  });
  const planId = workspace.activePlan.id;
  const task = workspace.activePlan.stages[0]!.tasks[0]!;
  const reminder = task.reminder!;
  const version = workspace.activePlan.version;
  const dueAt = "2026-08-31T21:00:00.000Z";
  const reminderKey = `task-reminder:${task.id}:${dueAt}`;
  store.confirmPlan(planId);

  const cancelled = store.cancelTaskReminder(planId, task.id);
  assert.equal(cancelled.activePlan.version, version + 1);
  assert.equal(cancelled.activePlan.stages[0]!.tasks[0]!.reminder, undefined);
  assert.equal(cancelled.inbox[0]?.title, "Reminder cancelled: Check essentials");
  assert.equal(store.claimTelegramTaskReminderAttempt({ planId, reminderKey, taskId: task.id, dueAt, reminder, now: dueAt }).claimed, false);
  store.close();
});

test("SQLite keeps the executing Plan alive while a replacement draft is reviewed, then switches atomically", () => {
  const store = new SqliteWorkspaceStore(":memory:");
  const oldWorkspace = store.createGeneratedPlan({
    title: "Old Plan",
    location: "Shanghai, China",
    dates: "September 1, 2026",
    knownInformation: ["Departure at 07:00."],
    assumptions: [],
    nextAction: "Review the reminder.",
    stages: [{ title: "Departure", description: "Prepare.", tasks: [{ title: "Old reminder", owner: "user", dueLabel: "Before departure", reminder: { scheduledAtLocal: "2026-09-01T05:00", timeZone: "Asia/Shanghai", purpose: "Check old details." } }] }]
  });
  const oldPlan = oldWorkspace.activePlan;
  const oldTask = oldPlan.stages[0]!.tasks[0]!;
  store.confirmPlan(oldPlan.id);
  const dueAt = "2026-08-31T21:00:00.000Z";
  const reminderKey = `task-reminder:${oldTask.id}:${dueAt}`;
  assert.equal(store.claimTelegramTaskReminderAttempt({ planId: oldPlan.id, reminderKey, taskId: oldTask.id, dueAt, reminder: oldTask.reminder!, now: dueAt }).claimed, true);
  const run = store.startTaskReminderRun({ planId: oldPlan.id, taskId: oldTask.id, reminderKey, dueAt, attemptNumber: 1, startedAt: dueAt });
  const replacement = store.createPlan({ request: "Create a newer Plan for Hangzhou." });

  assert.equal(replacement.activePlan.status, "draft");
  assert.equal(replacement.executionPlan?.id, oldPlan.id);
  assert.equal(store.getExecutionPlan()?.id, oldPlan.id);
  assert.equal(store.listHistoricalPlans().some((plan) => plan.id === oldPlan.id), false);
  assert.equal(store.listRecentTaskReminderRuns().find((candidate) => candidate.id === run.id)?.status, "running");

  const activatedReplacement = store.confirmPlan(replacement.activePlan.id);
  assert.equal(activatedReplacement.activePlan.status, "active");
  assert.equal(activatedReplacement.executionPlan, undefined);
  assert.equal(store.getExecutionPlan()?.id, replacement.activePlan.id);
  assert.equal(store.listHistoricalPlans().some((plan) => plan.id === oldPlan.id), true);
  assert.equal(store.listRecentTaskReminderRuns().find((candidate) => candidate.id === run.id)?.status, "cancelled");
  assert.equal(store.claimTelegramTaskReminderAttempt({ planId: oldPlan.id, reminderKey: `${reminderKey}:after-switch`, taskId: oldTask.id, dueAt, reminder: oldTask.reminder!, now: dueAt }).claimed, false);
  store.close();
});

test("SQLite records a Telegram success that raced with reminder cancellation", () => {
  const store = new SqliteWorkspaceStore(":memory:");
  const workspace = store.createGeneratedPlan({
    title: "Prepare for departure",
    location: "Shanghai, China",
    dates: "September 1, 2026",
    knownInformation: ["Departure at 07:00."],
    assumptions: [],
    nextAction: "Review the reminder.",
    stages: [{ title: "Departure", description: "Prepare.", tasks: [{ title: "Check essentials", owner: "user", dueLabel: "Two hours before departure", reminder: { scheduledAtLocal: "2026-09-01T05:00", timeZone: "Asia/Shanghai", purpose: "Check passport and essential items." } }] }]
  });
  const planId = workspace.activePlan.id;
  const task = workspace.activePlan.stages[0]!.tasks[0]!;
  const reminder = task.reminder!;
  const dueAt = "2026-08-31T21:00:00.000Z";
  const reminderKey = `task-reminder:${task.id}:${dueAt}`;
  store.confirmPlan(planId);
  assert.equal(store.claimTelegramTaskReminderAttempt({ planId, reminderKey, taskId: task.id, dueAt, reminder, now: dueAt }).claimed, true);
  const run = store.startTaskReminderRun({ planId, taskId: task.id, reminderKey, dueAt, attemptNumber: 1, startedAt: dueAt });

  store.cancelTaskReminder(planId, task.id);
  store.recordTelegramTaskReminderDelivered({ planId, reminderKey, taskId: task.id, taskTitle: task.title, reminder, deliveredAt: "2026-08-31T21:00:01.000Z" });
  store.recordTaskReminderRunDelivery({ runId: run.id, status: "succeeded", recordedAt: "2026-08-31T21:00:01.000Z" });

  assert.equal(store.getWorkspace().inbox[0]?.title, "Reminder sent before Plan change took effect: Check essentials");
  assert.match(store.getWorkspace().inbox[0]?.body ?? "", /before cancellation or Plan replacement/i);
  assert.equal(store.claimTelegramTaskReminderAttempt({ planId, reminderKey, taskId: task.id, dueAt, reminder, now: "2026-08-31T21:02:00.000Z" }).claimed, false);
  assert.equal(store.listRecentTaskReminderRuns()[0]?.status, "succeeded");
  store.close();
});

test("SQLite retries a transient Task reminder failure twice before recording a terminal failure", () => {
  const store = new SqliteWorkspaceStore(":memory:");
  const workspace = store.createGeneratedPlan({
    title: "Prepare for departure",
    location: "Shanghai, China",
    dates: "September 1, 2026",
    knownInformation: ["Departure at 07:00."],
    assumptions: [],
    nextAction: "Review the reminder.",
    stages: [{ title: "Departure", description: "Prepare.", tasks: [{ title: "Check essentials", owner: "user", dueLabel: "Two hours before departure", reminder: { scheduledAtLocal: "2026-09-01T05:00", timeZone: "Asia/Shanghai", purpose: "Check passport and essential items." } }] }]
  });
  const task = workspace.activePlan.stages[0]!.tasks[0]!;
  const reminder = task.reminder!;
  const planId = workspace.activePlan.id;
  const dueAt = "2026-08-31T21:00:00.000Z";
  const reminderKey = `task-reminder:${task.id}:${dueAt}`;
  store.confirmPlan(planId);

  assert.deepEqual(store.claimTelegramTaskReminderAttempt({ planId, reminderKey, taskId: task.id, dueAt, reminder, now: dueAt }), { claimed: true, attemptNumber: 1 });
  const run = store.startTaskReminderRun({ planId, taskId: task.id, reminderKey, dueAt, attemptNumber: 1, startedAt: dueAt });
  store.recordTaskReminderRunWeather({ runId: run.id, status: "unavailable", stage: "qweather", failureCode: "network_error", recordedAt: "2026-08-31T21:00:00.500Z" });
  assert.deepEqual(store.recordTelegramTaskReminderFailure({ planId, reminderKey, taskId: task.id, reminder, failureCode: "network_error", retryable: true, failedAt: "2026-08-31T21:00:01.000Z" }), { status: "retry_scheduled", nextAttemptAt: "2026-08-31T21:01:01.000Z" });
  store.recordTaskReminderRunDelivery({ runId: run.id, status: "retry_wait", failureCode: "network_error", recordedAt: "2026-08-31T21:00:01.000Z" });
  assert.equal(store.claimTelegramTaskReminderAttempt({ planId, reminderKey, taskId: task.id, dueAt, reminder, now: "2026-08-31T21:01:00.000Z" }).claimed, false);
  assert.deepEqual(store.claimTelegramTaskReminderAttempt({ planId, reminderKey, taskId: task.id, dueAt, reminder, now: "2026-08-31T21:01:01.000Z" }), { claimed: true, attemptNumber: 2 });
  assert.equal(store.startTaskReminderRun({ planId, taskId: task.id, reminderKey, dueAt, attemptNumber: 2, startedAt: "2026-08-31T21:01:01.000Z" }).id, run.id);
  store.recordTaskReminderRunWeather({ runId: run.id, status: "available", recordedAt: "2026-08-31T21:01:01.500Z" });
  assert.deepEqual(store.recordTelegramTaskReminderFailure({ planId, reminderKey, taskId: task.id, reminder, failureCode: "telegram_500", retryable: true, failedAt: "2026-08-31T21:01:02.000Z" }), { status: "retry_scheduled", nextAttemptAt: "2026-08-31T21:06:02.000Z" });
  store.recordTaskReminderRunDelivery({ runId: run.id, status: "retry_wait", failureCode: "telegram_500", recordedAt: "2026-08-31T21:01:02.000Z" });
  assert.deepEqual(store.claimTelegramTaskReminderAttempt({ planId, reminderKey, taskId: task.id, dueAt, reminder, now: "2026-08-31T21:06:02.000Z" }), { claimed: true, attemptNumber: 3 });
  store.startTaskReminderRun({ planId, taskId: task.id, reminderKey, dueAt, attemptNumber: 3, startedAt: "2026-08-31T21:06:02.000Z" });
  store.recordTaskReminderRunWeather({ runId: run.id, status: "available", recordedAt: "2026-08-31T21:06:02.500Z" });
  assert.deepEqual(store.recordTelegramTaskReminderFailure({ planId, reminderKey, taskId: task.id, reminder, failureCode: "timeout", retryable: true, failedAt: "2026-08-31T21:06:03.000Z" }), { status: "failed" });
  store.recordTaskReminderRunDelivery({ runId: run.id, status: "failed", failureCode: "timeout", recordedAt: "2026-08-31T21:06:03.000Z" });

  assert.equal(store.claimTelegramTaskReminderAttempt({ planId, reminderKey, taskId: task.id, dueAt, reminder, now: "2026-08-31T21:10:00.000Z" }).claimed, false);
  assert.equal(store.getWorkspace().inbox[0]?.title, "Reminder could not be sent: Check essentials");
  assert.match(store.getWorkspace().inbox[0]?.body ?? "", /stopped after 3 delivery attempts/i);
  assert.deepEqual(store.listRecentTaskReminderRuns()[0], {
    id: run.id,
    kind: "task_reminder",
    planId,
    taskId: task.id,
    reminderKey,
    dueAt,
    status: "failed",
    attemptCount: 3,
    weatherStatus: "available",
    telegramFailureCode: "timeout",
    startedAt: dueAt,
    finishedAt: "2026-08-31T21:06:03.000Z",
    updatedAt: "2026-08-31T21:06:03.000Z"
  });
  store.close();
});

test("SQLite advances an explicitly tagged arrival task to ready without completing it", () => {
  const store = new SqliteWorkspaceStore(":memory:");
  const planId = store.getWorkspace().activePlan.id;
  store.confirmPlan(planId);
  const task = store.activateArrivalTask(planId);
  assert.equal(task?.status, "ready");
  assert.equal(task?.activationTrigger, "arrival");
  assert.equal(store.activateArrivalTask(planId), undefined);
  const storedTask = store.getWorkspace().activePlan.stages.flatMap((stage) => stage.tasks).find((candidate) => candidate.id === task?.id);
  assert.equal(storedTask?.status, "ready");
  assert.match(store.getWorkspace().activePlan.nextAction, /Current arrival step/i);
  store.close();
});

test("SQLite advances an arrival Task saved by an older runtime as waiting_user", () => {
  const directory = mkdtempSync(join(tmpdir(), "c-assistant-arrival-legacy-"));
  try {
    const databasePath = join(directory, "workspace.sqlite");
    const store = new SqliteWorkspaceStore(databasePath);
    const workspace = store.createGeneratedPlan({
      title: "Arrive in Shanghai",
      location: "Shanghai, China",
      dates: "September 2026",
      knownInformation: ["Arrival airport: PVG"],
      assumptions: ["The terminal is unknown."],
      nextAction: "Review the complete Plan.",
      stages: [{ title: "Arrival", description: "Complete arrival steps.", tasks: [{ title: "Collect baggage", owner: "user", dueLabel: "At arrival", activationTrigger: "arrival" }] }]
    });
    store.confirmPlan(workspace.activePlan.id);

    const legacyWriter = new DatabaseSync(databasePath);
    legacyWriter.prepare("UPDATE tasks SET status = 'waiting_user' WHERE activation_trigger = 'arrival'").run();
    legacyWriter.close();

    const task = store.activateArrivalTask(workspace.activePlan.id);
    assert.equal(task?.status, "ready");
    assert.equal(task?.activationTrigger, "arrival");
    store.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("SQLite completes a ready task only after an explicit user confirmation", () => {
  const store = new SqliteWorkspaceStore(":memory:");
  const planId = store.getWorkspace().activePlan.id;
  store.confirmPlan(planId);
  const ready = store.activateArrivalTask(planId);
  assert.equal(store.completeReadyTask(planId, ready?.id ?? "" )?.status, "completed");
  assert.equal(store.completeReadyTask(planId, ready?.id ?? ""), undefined);
  assert.equal(store.getWorkspace().activePlan.stages.flatMap((stage) => stage.tasks).find((task) => task.id === ready?.id)?.status, "completed");
  assert.match(store.getWorkspace().inbox[0]?.title ?? "", /Task completed by you/);
  store.close();
});

test("SQLite stores arrival follow-up state without storing shared coordinates", () => {
  const store = new SqliteWorkspaceStore(":memory:");
  const planId = store.getWorkspace().activePlan.id;
  store.recordTelegramArrivalCheckin({ planId, checkInSentAt: "2026-09-01T00:00:00.000Z" });
  assert.equal(store.getTelegramArrivalCheckin(planId)?.locationRequestedAt, undefined);
  assert.equal(store.markTelegramArrivalLocationRequested(planId, "2026-09-01T00:05:00.000Z"), true);
  assert.equal(store.markTelegramArrivalLocationRequested(planId, "2026-09-01T00:05:01.000Z"), false);
  store.markTelegramArrivalLocationReceived(planId, "2026-09-01T00:05:30.000Z");
  const state = store.getTelegramArrivalCheckin(planId);
  assert.equal(state?.locationReceivedAt, "2026-09-01T00:05:30.000Z");
  assert.deepEqual(Object.keys(state ?? {}).sort(), ["checkInSentAt", "locationReceivedAt", "locationRequestedAt"]);
  store.close();
});

test("SQLite records a handoff offer and re-arms guidance after an explicit delay", () => {
  const store = new SqliteWorkspaceStore(":memory:");
  const planId = store.getWorkspace().activePlan.id;
  const offered = store.recordTelegramRouteHandoffOffered({
    planId,
    offeredAt: "2026-08-10T06:00:00.000Z",
    routeDurationSeconds: 2_100,
    waitBufferSeconds: 600,
    safetyMarginSeconds: 600,
    expectedArrivalAt: "2026-08-10T06:55:00.000Z"
  });
  assert.equal(offered.openedAt, undefined);
  assert.equal(store.claimTelegramRouteArrivalGuidance(planId, "2026-08-10T06:54:59.000Z"), undefined);
  assert.equal(store.claimTelegramRouteArrivalGuidance(planId, "2026-08-10T06:55:00.000Z")?.guidanceSentAt, "2026-08-10T06:55:00.000Z");
  assert.equal(store.claimTelegramRouteArrivalGuidance(planId, "2026-08-10T06:55:01.000Z"), undefined);
  const delayed = store.delayTelegramRouteArrivalGuidance(planId, "2026-08-10T06:56:00.000Z");
  assert.equal(delayed?.expectedArrivalAt, "2026-08-10T07:11:00.000Z");
  assert.equal(delayed?.delayCount, 1);
  assert.equal(delayed?.guidanceSentAt, undefined);
  assert.equal(store.delayTelegramRouteArrivalGuidance(planId, "2026-08-10T06:57:00.000Z"), undefined);
  assert.deepEqual(Object.keys(offered).sort(), ["delayCount", "expectedArrivalAt", "offeredAt", "planId", "routeDurationSeconds", "safetyMarginSeconds", "waitBufferSeconds"].sort());
  store.close();
});

test("SQLite persists recoverable Blueprint checkpoints, events, lineage, and expiring diagnostics", () => {
  const store = new SqliteWorkspaceStore(":memory:");
  const session = store.createPlanningSession("travel", new Date("2026-08-26T00:00:00.000Z"));
  const proposal = { version: 1, title: "Tokyo", objective: "Visit Tokyo", theme: "Culture", segments: ["Tokyo"], skeleton: ["2026-09-01 to 2026-09-02"], tradeoffs: [], assumptions: [], decisionPoints: [] };
  store.savePlanningSession({ ...session, status: "proposal_ready", proposal, updatedAt: "2026-08-26T00:00:01.000Z" });
  store.confirmPlanningSession(session.id, 1);
  const generationKey = `${session.id}:1:interactive-trip-planner@0.2.0`;
  store.saveBlueprintGeneration({
    generationKey,
    proposalRef: { sessionId: session.id, proposalVersion: 1 },
    skillLineage: { skillId: "interactive-trip-planner", skillVersion: "0.2.0" },
    status: "running",
    stage: "research",
    createdAt: "2026-08-26T00:00:02.000Z",
    updatedAt: "2026-08-26T00:00:02.000Z"
  });
  const research: ResearchSet = {
    schemaVersion: TRIP_BLUEPRINT_SCHEMA_VERSION,
    id: "research-tokyo",
    generationKey,
    proposalRef: { sessionId: session.id, proposalVersion: 1 },
    skillLineage: { skillId: "interactive-trip-planner", skillVersion: "0.2.0" },
    status: "completed",
    batches: [{ id: "tokyo", scopeLabel: "Tokyo", status: "completed", placeIds: ["a", "b", "c"], eventIds: [], sourceIds: [], completedAt: "2026-08-26T00:01:00.000Z" }],
    places: ["a", "b", "c"].map((id) => ({ id, name: id, locationLabel: "Tokyo", city: "Tokyo", category: "sight", priority: "preferred" as const, coordinates: [35.68, 139.76] as [number, number], whyWorthIt: `Why ${id}`, plan: `Visit ${id}`, evidence: [] })),
    events: [], sources: [], actionRequirements: [],
    createdAt: "2026-08-26T00:00:02.000Z", updatedAt: "2026-08-26T00:01:00.000Z", completedAt: "2026-08-26T00:01:00.000Z"
  };
  store.saveResearchSet(research);
  assert.equal(store.getResearchSetByGenerationKey(generationKey)?.places.length, 3);

  const blueprint: TripBlueprint = {
    schemaVersion: TRIP_BLUEPRINT_SCHEMA_VERSION,
    id: "blueprint-tokyo", version: 1, generationKey,
    proposalRef: research.proposalRef, skillLineage: research.skillLineage, researchSetId: research.id,
    title: "Tokyo", summary: "Tokyo plan", language: "en", destinations: ["Tokyo"], startDate: "2026-09-01", endDate: "2026-09-02",
    places: research.places, events: [], sources: [],
    days: [
      {
        id: "d1",
        date: "2026-09-01",
        kind: "scheduled",
        city: "Tokyo",
        title: "Day one",
        summary: "Two stops",
        stops: [{ placeId: "a", order: 1, time: "09:00" }, { placeId: "b", order: 2, time: "10:30" }],
        blocks: [
          { id: "block-a", kind: "stop", order: 1, placeId: "a", startTime: "09:00", title: "A anchor", evidence: [] },
          { id: "block-rest", kind: "rest", order: 2, title: "Short reset", summary: "Keep this rest block visible.", evidence: [] },
          { id: "block-b", kind: "stop", order: 3, placeId: "b", startTime: "10:30", title: "B anchor", evidence: [] }
        ],
        candidatePlaceIds: ["c"]
      },
      { id: "d2", date: "2026-09-02", kind: "rest", city: "Tokyo", title: "Rest", summary: "Unstructured day", stops: [], candidatePlaceIds: [] }
    ],
    movements: [{ id: "m1", dayId: "d1", originPlaceId: "a", destinationPlaceId: "b", mode: "unknown", status: "recheck", evidence: [] }],
    actionRequirements: [], createdAt: "2026-08-26T00:02:00.000Z"
  };
  store.saveTripBlueprint(blueprint);
  assert.equal(store.getTripBlueprintByGenerationKey(generationKey)?.places.length, 3);

  const compilation = compileTripBlueprint(blueprint, { createdAt: "2026-08-26T00:02:01.000Z" });
  const compiled = store.createCompiledBlueprintPlan(compilation).activePlan;
  assert.equal(compiled.id, compilation.plan.id);
  assert.equal(compiled.presentation?.kind, "itinerary");
  assert.equal(compiled.presentation?.routeSegments[0]?.mode, "unknown");
  assert.deepEqual(store.getPlanBlueprintLineage(compiled.id), compilation.lineage);
  assert.equal(store.createCompiledBlueprintPlan(compilation).activePlan.id, compiled.id);

  const revisedWorkspace = store.applyDirectBlueprintRevision({
    expectedPlanId: compiled.id,
    expectedVersion: compiled.version,
    revision: { kind: "add_place_to_day", placeId: "c", dayId: "d1", position: { kind: "after", afterPlaceId: "a" }, createdAt: "2026-08-26T00:03:00.000Z" }
  });
  assert.equal(revisedWorkspace.activeBlueprint?.version, 2);
  assert.deepEqual(revisedWorkspace.activeBlueprint?.days[0]?.stops.map((stop) => stop.placeId), ["a", "c", "b"]);
  assert.deepEqual(revisedWorkspace.activeBlueprint?.movements.map((movement) => movement.status), ["recheck", "recheck"]);
  assert.deepEqual(revisedWorkspace.activeBlueprint?.movements.map((movement) => movement.mode), ["walking", "walking"]);
  assert.deepEqual(revisedWorkspace.activePlan.presentation?.routeSegments.map((segment) => [segment.id, segment.mode, segment.verification]), [["movement-d1-1", "walking", "needs_verification"], ["movement-d1-2", "walking", "needs_verification"]]);
  assert.equal(store.getPlanBlueprintLineage(revisedWorkspace.activePlan.id)?.blueprintVersion, 2);

  const batchResult = store.applyDirectBlueprintRevisionBatch({
    expectedPlanId: revisedWorkspace.activePlan.id,
    expectedVersion: revisedWorkspace.activePlan.version,
    revisions: [
      { kind: "move_place_within_day", placeId: "b", dayId: "d1", position: { kind: "start" }, createdAt: "2026-08-26T00:04:00.000Z" },
      { kind: "move_place_within_day", placeId: "c", dayId: "d1", position: { kind: "after", afterPlaceId: "b" }, createdAt: "2026-08-26T00:04:00.000Z" }
    ]
  });
  const batchWorkspace = batchResult.workspace;
  assert.equal(batchWorkspace.activeBlueprint?.version, 4);
  assert.equal(batchResult.revision.revisionCount, 2);
  assert.deepEqual(batchResult.revision.affectedDayIds, ["d1"]);
  assert.deepEqual(batchWorkspace.activeBlueprint?.days[0]?.stops.map((stop) => stop.placeId), ["b", "c", "a"]);
  assert.equal(store.getPlanBlueprintLineage(batchWorkspace.activePlan.id)?.blueprintVersion, 4);

  assert.throws(() => store.applyDirectBlueprintRevisionBatch({
    expectedPlanId: batchWorkspace.activePlan.id,
    expectedVersion: batchWorkspace.activePlan.version,
    revisions: [
      { kind: "move_place_within_day", placeId: "a", dayId: "d1", position: { kind: "start" }, createdAt: "2026-08-26T00:05:00.000Z" },
      { kind: "move_place_within_day", placeId: "b", dayId: "d1", position: { kind: "after", afterPlaceId: "missing-place" }, createdAt: "2026-08-26T00:05:00.000Z" }
    ]
  }), /unknown place missing-place/i);
  const afterFailedBatch = store.getWorkspace();
  assert.equal(afterFailedBatch.activeBlueprint?.version, 4);
  assert.deepEqual(afterFailedBatch.activeBlueprint?.days[0]?.stops.map((stop) => stop.placeId), ["b", "c", "a"]);
  assert.equal(afterFailedBatch.activePlan.id, batchWorkspace.activePlan.id);

  const routeRefresh = store.saveGeneratedPlanRouteRefresh({
    planId: batchWorkspace.activePlan.id,
    expectedVersion: batchWorkspace.activePlan.version,
    provider: "google_maps",
    routes: [{
      segmentId: "movement-d1-1",
      observedAt: "2026-08-26T00:06:00.000Z",
      distanceMeters: 850,
      durationSeconds: 540,
      originCoordinates: [139.76, 35.68],
      destinationCoordinates: [139.761, 35.681],
      geometry: [[139.76, 35.68], [139.761, 35.681]]
    }]
  });
  assert.deepEqual(routeRefresh.scheduleConflictDayIds, []);
  assert.equal(routeRefresh.workspace.activePlan.id, batchWorkspace.activePlan.id);
  assert.equal(routeRefresh.workspace.activePlan.status, batchWorkspace.activePlan.status);
  assert.equal(routeRefresh.workspace.activePlan.version, batchWorkspace.activePlan.version + 1);
  assert.equal(routeRefresh.workspace.activeBlueprint?.version, 5);
  assert.deepEqual(routeRefresh.workspace.activeBlueprint?.movements.map((movement) => [movement.id, movement.status, movement.durationMinutes, movement.distanceMeters]), [["movement-d1-1", "verified", 9, 850], ["movement-d1-2", "recheck", undefined, undefined]]);
  assert.deepEqual(routeRefresh.workspace.activeBlueprint?.movements[0]?.evidence, [{ sourceId: "google_maps", status: "verified", checkedAt: "2026-08-26T00:06:00.000Z", supports: ["route duration", "route distance"] }]);
  assert.deepEqual(routeRefresh.workspace.activeBlueprint?.days[0]?.blocks?.map((block) => [block.id, block.kind, block.placeId ?? "", block.startTime ?? ""]), [
    ["block-b", "stop", "b", "09:00"],
    ["block-d1-c-direct", "stop", "c", ""],
    ["block-rest", "rest", "", ""],
    ["block-a", "stop", "a", "10:30"]
  ]);
  assert.equal(routeRefresh.workspace.activePlan.presentation?.routeSegments[0]?.verification, "verified");
  assert.equal(store.getPlanBlueprintLineage(routeRefresh.workspace.activePlan.id)?.blueprintVersion, 5);
  assert.equal(store.getPlanBlueprintLineage(routeRefresh.workspace.activePlan.id)?.planVersion, routeRefresh.workspace.activePlan.version);

  const first = store.appendBlueprintGenerationEvent({ generationKey, stage: "research", status: "running", scopeLabel: "Tokyo", savedPlaceCount: 2, detail: "Tokyo research saved", createdAt: "2026-08-26T00:01:00.000Z" });
  const second = store.appendBlueprintGenerationEvent({ generationKey, stage: "compile", status: "running", detail: "Compiling Draft Plan", createdAt: "2026-08-26T00:02:01.000Z" });
  assert.deepEqual([first.sequence, second.sequence], [1, 2]);
  assert.equal(store.getBlueprintGenerationEvents(generationKey, 1)[0]?.stage, "compile");

  store.saveDiagnosticArtifact({ generationKey, rawResponse: "{broken", createdAt: "2026-08-26T00:00:00.000Z", expiresAt: "2026-09-02T00:00:00.000Z" });
  assert.equal(store.deleteExpiredDiagnosticArtifacts(new Date("2026-09-01T23:59:59.000Z")), 0);
  assert.equal(store.deleteExpiredDiagnosticArtifacts(new Date("2026-09-02T00:00:00.000Z")), 1);
  store.close();
});

test("SQLite hydrates Blueprint presentation over stale stored Plan presentation", () => {
  const directory = mkdtempSync(join(tmpdir(), "c-assistant-blueprint-presentation-"));
  try {
    const databasePath = join(directory, "workspace.sqlite");
    const store = new SqliteWorkspaceStore(databasePath);
    const generationKey = "generation-stale-presentation";
    const session = store.createPlanningSession("travel", new Date("2026-08-26T00:00:00.000Z"));
    const proposal = { version: 1, title: "Tokyo", objective: "Plan Tokyo.", theme: "Source of truth", segments: ["Tokyo"], skeleton: ["2026-09-01"], tradeoffs: [], assumptions: [], decisionPoints: [] };
    store.savePlanningSession({ ...session, status: "proposal_ready", proposal, updatedAt: "2026-08-26T00:00:01.000Z" });
    store.confirmPlanningSession(session.id, 1);
    store.saveBlueprintGeneration({
      generationKey,
      proposalRef: { sessionId: session.id, proposalVersion: 1 },
      skillLineage: { skillId: "interactive-trip-planner", skillVersion: "0.2.0" },
      status: "running",
      stage: "research",
      createdAt: "2026-08-26T00:00:02.000Z",
      updatedAt: "2026-08-26T00:00:02.000Z"
    });
    const research: ResearchSet = {
      schemaVersion: TRIP_BLUEPRINT_SCHEMA_VERSION,
      id: "research-stale-presentation",
      generationKey,
      proposalRef: { sessionId: session.id, proposalVersion: 1 },
      skillLineage: { skillId: "interactive-trip-planner", skillVersion: "0.2.0" },
      status: "completed",
      batches: [{ id: "tokyo", scopeLabel: "Tokyo", status: "completed", placeIds: ["a", "b"], eventIds: [], sourceIds: [], completedAt: "2026-08-26T00:01:00.000Z" }],
      places: ["a", "b"].map((id) => ({ id, name: id, locationLabel: "Tokyo", city: "Tokyo", category: "sight", priority: "preferred" as const, coordinates: [35.68, 139.76] as [number, number], whyWorthIt: `Why ${id}`, plan: `Visit ${id}`, evidence: [] })),
      events: [],
      sources: [],
      actionRequirements: [],
      createdAt: "2026-08-26T00:00:02.000Z",
      updatedAt: "2026-08-26T00:01:00.000Z",
      completedAt: "2026-08-26T00:01:00.000Z"
    };
    store.saveResearchSet(research);
    const blueprint: TripBlueprint = {
      schemaVersion: TRIP_BLUEPRINT_SCHEMA_VERSION,
      id: "blueprint-stale-presentation",
      version: 1,
      generationKey,
      proposalRef: research.proposalRef,
      skillLineage: research.skillLineage,
      researchSetId: research.id,
      title: "Tokyo",
      summary: "Blueprint source presentation",
      language: "en",
      destinations: ["Tokyo"],
      startDate: "2026-09-01",
      endDate: "2026-09-01",
      places: research.places,
      events: [],
      sources: [],
      days: [{ id: "d1", date: "2026-09-01", kind: "scheduled", city: "Tokyo", title: "Day one", summary: "Two stops", stops: [{ placeId: "a", order: 1 }], candidatePlaceIds: ["b"] }],
      movements: [],
      actionRequirements: [],
      createdAt: "2026-08-26T00:02:00.000Z"
    };
    store.saveTripBlueprint(blueprint);
    const compiled = store.createCompiledBlueprintPlan(compileTripBlueprint(blueprint, { createdAt: "2026-08-26T00:02:01.000Z" })).activePlan;
    const revised = store.applyDirectBlueprintRevision({
      expectedPlanId: compiled.id,
      expectedVersion: compiled.version,
      revision: { kind: "add_place_to_day", placeId: "b", dayId: "d1", position: { kind: "end" }, createdAt: "2026-08-26T00:03:00.000Z" }
    });
    const planId = revised.activePlan.id;
    const stalePresentation = { ...revised.activePlan.presentation!, summary: "stale stored presentation", days: [{ ...revised.activePlan.presentation!.days[0]!, placeIds: ["a"], stops: [{ placeId: "a", order: 1 }] }], routeSegments: [] };
    store.close();

    const raw = new DatabaseSync(databasePath);
    raw.prepare("UPDATE plans SET presentation_json = ? WHERE id = ?").run(JSON.stringify(stalePresentation), planId);
    raw.close();

    const reopened = new SqliteWorkspaceStore(databasePath);
    const workspace = reopened.getWorkspace();
    assert.equal(workspace.activeBlueprint?.version, 2);
    assert.equal(workspace.activePlan.presentation?.summary, "Blueprint source presentation");
    assert.deepEqual(workspace.activePlan.presentation?.days[0]?.placeIds, ["a", "b"]);
    assert.deepEqual(workspace.activePlan.presentation?.routeSegments.map((segment) => segment.id), ["movement-d1-1"]);
    reopened.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("SQLite applies direct Blueprint Revision from active Blueprint despite stale Plan presentation", () => {
  const directory = mkdtempSync(join(tmpdir(), "c-assistant-blueprint-direct-source-"));
  try {
    const databasePath = join(directory, "workspace.sqlite");
    const store = new SqliteWorkspaceStore(databasePath);
    const generationKey = "generation-direct-source";
    const session = store.createPlanningSession("travel", new Date("2026-08-26T00:00:00.000Z"));
    const proposal = { version: 1, title: "Tokyo", objective: "Plan Tokyo.", theme: "Source of truth", segments: ["Tokyo"], skeleton: ["2026-09-01"], tradeoffs: [], assumptions: [], decisionPoints: [] };
    store.savePlanningSession({ ...session, status: "proposal_ready", proposal, updatedAt: "2026-08-26T00:00:01.000Z" });
    store.confirmPlanningSession(session.id, 1);
    store.saveBlueprintGeneration({
      generationKey,
      proposalRef: { sessionId: session.id, proposalVersion: 1 },
      skillLineage: { skillId: "interactive-trip-planner", skillVersion: "0.2.0" },
      status: "running",
      stage: "research",
      createdAt: "2026-08-26T00:00:02.000Z",
      updatedAt: "2026-08-26T00:00:02.000Z"
    });
    const research: ResearchSet = {
      schemaVersion: TRIP_BLUEPRINT_SCHEMA_VERSION,
      id: "research-direct-source",
      generationKey,
      proposalRef: { sessionId: session.id, proposalVersion: 1 },
      skillLineage: { skillId: "interactive-trip-planner", skillVersion: "0.2.0" },
      status: "completed",
      batches: [{ id: "tokyo", scopeLabel: "Tokyo", status: "completed", placeIds: ["a", "b"], eventIds: [], sourceIds: [], completedAt: "2026-08-26T00:01:00.000Z" }],
      places: ["a", "b"].map((id) => ({ id, name: id, locationLabel: "Tokyo", city: "Tokyo", category: "sight", priority: "preferred" as const, coordinates: [35.68, 139.76] as [number, number], whyWorthIt: `Why ${id}`, plan: `Visit ${id}`, evidence: [] })),
      events: [],
      sources: [],
      actionRequirements: [],
      createdAt: "2026-08-26T00:00:02.000Z",
      updatedAt: "2026-08-26T00:01:00.000Z",
      completedAt: "2026-08-26T00:01:00.000Z"
    };
    store.saveResearchSet(research);
    const blueprint: TripBlueprint = {
      schemaVersion: TRIP_BLUEPRINT_SCHEMA_VERSION,
      id: "blueprint-direct-source",
      version: 1,
      generationKey,
      proposalRef: research.proposalRef,
      skillLineage: research.skillLineage,
      researchSetId: research.id,
      title: "Tokyo",
      summary: "Blueprint source presentation",
      language: "en",
      destinations: ["Tokyo"],
      startDate: "2026-09-01",
      endDate: "2026-09-01",
      places: research.places,
      events: [],
      sources: [],
      days: [{ id: "d1", date: "2026-09-01", kind: "scheduled", city: "Tokyo", title: "Day one", summary: "Two stops", stops: [{ placeId: "a", order: 1 }], candidatePlaceIds: ["b"] }],
      movements: [],
      actionRequirements: [],
      createdAt: "2026-08-26T00:02:00.000Z"
    };
    store.saveTripBlueprint(blueprint);
    const compiled = store.createCompiledBlueprintPlan(compileTripBlueprint(blueprint, { createdAt: "2026-08-26T00:02:01.000Z" })).activePlan;
    store.close();

    const raw = new DatabaseSync(databasePath);
    raw.prepare("UPDATE plans SET presentation_json = ? WHERE id = ?").run(JSON.stringify({
      ...compiled.presentation!,
      summary: "stale stored presentation",
      places: compiled.presentation!.places.filter((place) => place.id === "a"),
      days: [{ ...compiled.presentation!.days[0]!, placeIds: ["a"], stops: [{ placeId: "a", order: 1 }], candidates: [] }],
      routeSegments: []
    }), compiled.id);
    raw.close();

    const reopened = new SqliteWorkspaceStore(databasePath);
    assert.throws(() => reopened.applyDirectBlueprintRevision({
      expectedPlanId: compiled.id,
      expectedVersion: compiled.version,
      expectedBlueprintVersion: 99,
      revision: { kind: "add_place_to_day", placeId: "b", dayId: "d1", position: { kind: "end" }, createdAt: "2026-08-26T00:03:00.000Z" }
    }), /Trip Blueprint changed/i);
    const revised = reopened.applyDirectBlueprintRevision({
      expectedPlanId: compiled.id,
      expectedVersion: compiled.version,
      expectedBlueprintVersion: 1,
      revision: { kind: "add_place_to_day", placeId: "b", dayId: "d1", position: { kind: "end" }, createdAt: "2026-08-26T00:03:00.000Z" }
    });
    assert.equal(revised.activeBlueprint?.version, 2);
    assert.deepEqual(revised.activeBlueprint?.days[0]?.stops.map((stop) => stop.placeId), ["a", "b"]);
    assert.deepEqual(revised.activePlan.presentation?.days[0]?.placeIds, ["a", "b"]);
    reopened.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("SQLite refreshes Blueprint routes from active Blueprint despite stale Plan presentation", () => {
  const directory = mkdtempSync(join(tmpdir(), "c-assistant-blueprint-route-source-"));
  try {
    const databasePath = join(directory, "workspace.sqlite");
    const store = new SqliteWorkspaceStore(databasePath);
    const generationKey = "generation-route-source";
    const session = store.createPlanningSession("travel", new Date("2026-08-26T00:00:00.000Z"));
    const proposal = { version: 1, title: "Tokyo", objective: "Plan Tokyo.", theme: "Source of truth", segments: ["Tokyo"], skeleton: ["2026-09-01"], tradeoffs: [], assumptions: [], decisionPoints: [] };
    store.savePlanningSession({ ...session, status: "proposal_ready", proposal, updatedAt: "2026-08-26T00:00:01.000Z" });
    store.confirmPlanningSession(session.id, 1);
    store.saveBlueprintGeneration({
      generationKey,
      proposalRef: { sessionId: session.id, proposalVersion: 1 },
      skillLineage: { skillId: "interactive-trip-planner", skillVersion: "0.2.0" },
      status: "running",
      stage: "research",
      createdAt: "2026-08-26T00:00:02.000Z",
      updatedAt: "2026-08-26T00:00:02.000Z"
    });
    const research: ResearchSet = {
      schemaVersion: TRIP_BLUEPRINT_SCHEMA_VERSION,
      id: "research-route-source",
      generationKey,
      proposalRef: { sessionId: session.id, proposalVersion: 1 },
      skillLineage: { skillId: "interactive-trip-planner", skillVersion: "0.2.0" },
      status: "completed",
      batches: [{ id: "tokyo", scopeLabel: "Tokyo", status: "completed", placeIds: ["a", "b"], eventIds: [], sourceIds: [], completedAt: "2026-08-26T00:01:00.000Z" }],
      places: ["a", "b"].map((id) => ({ id, name: id, locationLabel: "Tokyo", city: "Tokyo", category: "sight", priority: "preferred" as const, coordinates: [35.68, 139.76] as [number, number], whyWorthIt: `Why ${id}`, plan: `Visit ${id}`, evidence: [] })),
      events: [],
      sources: [],
      actionRequirements: [],
      createdAt: "2026-08-26T00:00:02.000Z",
      updatedAt: "2026-08-26T00:01:00.000Z",
      completedAt: "2026-08-26T00:01:00.000Z"
    };
    store.saveResearchSet(research);
    const blueprint: TripBlueprint = {
      schemaVersion: TRIP_BLUEPRINT_SCHEMA_VERSION,
      id: "blueprint-route-source",
      version: 1,
      generationKey,
      proposalRef: research.proposalRef,
      skillLineage: research.skillLineage,
      researchSetId: research.id,
      title: "Tokyo",
      summary: "Blueprint source presentation",
      language: "en",
      destinations: ["Tokyo"],
      startDate: "2026-09-01",
      endDate: "2026-09-01",
      places: research.places,
      events: [],
      sources: [],
      days: [{ id: "d1", date: "2026-09-01", kind: "scheduled", city: "Tokyo", title: "Day one", summary: "Two stops", stops: [{ placeId: "a", order: 1, time: "09:00" }, { placeId: "b", order: 2, time: "10:30" }], candidatePlaceIds: [] }],
      movements: [{ id: "move-a-b", dayId: "d1", originPlaceId: "a", destinationPlaceId: "b", mode: "walking", status: "recheck", evidence: [] }],
      actionRequirements: [],
      createdAt: "2026-08-26T00:02:00.000Z"
    };
    store.saveTripBlueprint(blueprint);
    const compiled = store.createCompiledBlueprintPlan(compileTripBlueprint(blueprint, { createdAt: "2026-08-26T00:02:01.000Z" })).activePlan;
    store.close();

    const raw = new DatabaseSync(databasePath);
    raw.prepare("UPDATE plans SET presentation_json = ? WHERE id = ?").run(JSON.stringify({
      ...compiled.presentation!,
      summary: "stale stored presentation",
      routeSegments: [{ id: "stale-route", dayId: "d1", originPlaceId: "a", destinationPlaceId: "b", mode: "walking", verification: "needs_verification", sourceRefs: [] }]
    }), compiled.id);
    raw.close();

    const reopened = new SqliteWorkspaceStore(databasePath);
    assert.throws(() => reopened.saveGeneratedPlanRouteRefresh({
      planId: compiled.id,
      expectedVersion: compiled.version,
      expectedBlueprintVersion: 99,
      provider: "google_maps",
      routes: [{
        segmentId: "move-a-b",
        observedAt: "2026-08-26T00:03:00.000Z",
        distanceMeters: 900,
        durationSeconds: 600,
        originCoordinates: [139.76, 35.68],
        destinationCoordinates: [139.77, 35.69]
      }]
    }), /Trip Blueprint changed/i);
    const refreshed = reopened.saveGeneratedPlanRouteRefresh({
      planId: compiled.id,
      expectedVersion: compiled.version,
      expectedBlueprintVersion: 1,
      provider: "google_maps",
      routes: [{
        segmentId: "move-a-b",
        observedAt: "2026-08-26T00:03:00.000Z",
        distanceMeters: 900,
        durationSeconds: 600,
        originCoordinates: [139.76, 35.68],
        destinationCoordinates: [139.77, 35.69]
      }]
    });
    assert.equal(refreshed.workspace.activeBlueprint?.version, 2);
    assert.deepEqual(refreshed.workspace.activeBlueprint?.movements.map((movement) => [movement.id, movement.status, movement.durationMinutes, movement.distanceMeters]), [["move-a-b", "verified", 10, 900]]);
    assert.deepEqual(refreshed.workspace.activePlan.presentation?.routeSegments.map((segment) => [segment.id, segment.verification]), [["move-a-b", "verified"]]);
    reopened.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
