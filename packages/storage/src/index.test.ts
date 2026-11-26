import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { TRIP_BLUEPRINT_SCHEMA_VERSION, compilePlanProposal, compileTripBlueprint, bookingTaskRequirementId, bookingRelationshipDigest, type PlanCompilationProposal, type ResearchSet, type TravelBooking, type TripBlueprint } from "@c-assistant/core";
import { SqliteWorkspaceStore } from "./index.js";

test("execution Blueprint repair preserves the approved Plan and rejects stale versions", () => {
  const store = new SqliteWorkspaceStore(":memory:");
  const session = store.createPlanningSession("travel");
  const proposal = { version: 1, title: "Trip", objective: "Travel", theme: "Travel", segments: ["Los Angeles"], skeleton: ["2026-11-02"], tradeoffs: [], assumptions: [], decisionPoints: [] };
  store.savePlanningSession({ ...session, status: "proposal_ready", proposal });
  store.confirmPlanningSession(session.id, 1);
  const blueprint: TripBlueprint = { schemaVersion: TRIP_BLUEPRINT_SCHEMA_VERSION, id: "b-repair", version: 1, generationKey: "g-repair", proposalRef: { sessionId: session.id, proposalVersion: 1 }, skillLineage: { skillId: "interactive-trip-planner", skillVersion: "0.2.0" }, researchSetId: "r-repair", title: "Departure", summary: "Travel", language: "en", destinations: ["Los Angeles"], startDate: "2026-11-02", endDate: "2026-11-02", places: [], events: [], sources: [], days: [{ id: "departure", date: "2026-11-02", kind: "transit", city: "Los Angeles", title: "Departure", summary: "Travel", stops: [], blocks: [{ id: "initial-prep", kind: "rest", order: 1, title: "Check departure details", evidence: [] }], candidatePlaceIds: [] }], movements: [], actionRequirements: [], createdAt: "2026-10-08T00:00:00Z" };
  store.saveBlueprintGeneration({ generationKey: blueprint.generationKey, proposalRef: blueprint.proposalRef, skillLineage: blueprint.skillLineage, stage: "ready", status: "completed", createdAt: blueprint.createdAt, updatedAt: blueprint.createdAt });
  const research: ResearchSet = { schemaVersion: TRIP_BLUEPRINT_SCHEMA_VERSION, id: blueprint.researchSetId, generationKey: blueprint.generationKey, proposalRef: blueprint.proposalRef, skillLineage: blueprint.skillLineage, status: "completed", batches: [], places: [], events: [], sources: [], actionRequirements: [], createdAt: blueprint.createdAt, updatedAt: blueprint.createdAt };
  store.saveResearchSet(research);
  store.saveTripBlueprint(blueprint);
  const draft = store.createCompiledBlueprintPlan(compileTripBlueprint(blueprint, { createdAt: blueprint.createdAt })).activePlan;
  store.confirmPlan(draft.id);
  const plan = store.getExecutionPlan()!;
  const repaired = structuredClone(blueprint);
  repaired.version = 2;
  repaired.days[0]!.blocks = [{ id: "prep", kind: "rest", order: 1, title: "Prepare for departure", evidence: [] }];
  store.saveTripBlueprint(repaired);
  const updated = store.saveExecutionBlueprintRepair({ planId: plan.id, expectedVersion: plan.version, expectedBlueprintVersion: 1, blueprint: repaired });
  assert.equal(updated.activePlan.id, plan.id);
  assert.equal(updated.activePlan.status, "active");
  assert.equal(updated.activePlan.version, plan.version + 1);
  assert.deepEqual(updated.activePlan.configuration, plan.configuration);
  assert.equal(store.getExecutionPlan()!.presentation!.days[0]!.blocks![0]!.title, "Prepare for departure");
  assert.equal(updated.activeBlueprint!.version, 2);
  assert.throws(() => store.saveExecutionBlueprintRepair({ planId: plan.id, expectedVersion: plan.version, expectedBlueprintVersion: 1, blueprint: repaired }), /changed/);
  store.close();
});

test("SQLite records its schema baseline and creates a verified private backup", () => {
  const directory = mkdtempSync(join(tmpdir(), "c-assistant-storage-"));
  try {
    const databasePath = join(directory, "workspace.sqlite");
    const store = new SqliteWorkspaceStore(databasePath);
    store.updateProfile({ displayName: "Backup owner", preferredLanguage: "English", nationality: "Canada", gender: "not_specified", immigrationStatus: "tourist_visa" });
    const maintenance = store.getDatabaseMaintenanceStatus();
    assert.deepEqual({ schemaVersion: maintenance.schemaVersion, latest: maintenance.latestSchemaVersion, integrity: maintenance.integrity }, { schemaVersion: 32, latest: 32, integrity: "ok" });
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
    assert.throws(() => new SqliteWorkspaceStore(databasePath), /supports schema 32.*schema 999/i);
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
    assert.equal(store.listCurrentTravelBookingSourcesForPlan(planId)[0]?.sourceHash, "hash-2");
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
    assert.equal(upgraded.getDatabaseMaintenanceStatus().schemaVersion, 32);
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
    assert.equal(store.getDatabaseMaintenanceStatus().schemaVersion, 32);
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
  assert.equal(updated.activePlan.presentation?.routeSegments[0]?.label, "15 min walk");
  assert.equal(updated.activePlan.presentation?.routeSegments[0]?.detail, "Walk from A to B; allow about 15 minutes, about 1.2 km.");
  assert.equal(updated.activePlan.presentation?.routeSegments[0]?.display?.mapLineState, "formal");
  assert.equal(updated.activePlan.presentation?.routeSegments[0]?.display?.refreshReason, undefined);
  assert.equal(/Google Maps|route refresh|before execution/i.test(updated.activePlan.presentation?.routeSegments[0]?.detail ?? ""), false);
  assert.deepEqual(updated.activePlan.presentation?.places.map((place) => place.coordinates), [[48.86, 2.33], [48.865, 2.34]]);
  const shifted = store.saveGeneratedPlanRouteRefresh({ planId: plan.id, expectedVersion: updated.activePlan.version, provider: "google_maps", routes: [{ segmentId: "r1", observedAt: "2026-08-18T08:10:00.000Z", distanceMeters: 4_500, durationSeconds: 5_400, originCoordinates: [2.33, 48.86], destinationCoordinates: [2.34, 48.865] }] });
  assert.deepEqual(shifted.scheduleConflictDayIds, ["day-1"]);
  assert.equal(shifted.workspace.activePlan.presentation?.days[0]?.stops?.[1]?.time, "11:00");
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

test("SQLite route refresh preserves Blueprint block identity when logistics blocks reference destination places", () => {
  const store = new SqliteWorkspaceStore(":memory:");
  const blueprint: TripBlueprint = {
    schemaVersion: TRIP_BLUEPRINT_SCHEMA_VERSION,
    id: "blueprint-bali-rendering",
    version: 1,
    generationKey: "generation-bali-rendering",
    proposalRef: { sessionId: "session-bali-rendering", proposalVersion: 1 },
    skillLineage: { skillId: "interactive-trip-planner", skillVersion: "0.2.0" },
    researchSetId: "research-bali-rendering",
    title: "Bali",
    summary: "South Bali day",
    language: "en",
    destinations: ["Bali"],
    startDate: "2026-10-10",
    endDate: "2026-10-10",
    places: [
      { id: "museum", name: "Museum Pasifika", locationLabel: "Nusa Dua, Bali", city: "Bali", category: "museum", priority: "must", coordinates: [-8.8001, 115.2299], whyWorthIt: "Art context.", plan: "Visit.", evidence: [] },
      { id: "jenggala", name: "Jenggala Jimbaran", locationLabel: "Jimbaran, Bali", city: "Bali", category: "ceramics", priority: "preferred", coordinates: [-8.7802, 115.1771], whyWorthIt: "Ceramics.", plan: "Visit.", evidence: [] }
    ],
    events: [],
    sources: [],
    days: [{
      id: "d1",
      date: "2026-10-10",
      kind: "scheduled",
      city: "Bali",
      title: "Nusa Dua and Jimbaran",
      summary: "Keep logistics, meal, and formal stops distinct.",
      stops: [{ placeId: "museum", order: 1, time: "10:00" }, { placeId: "jenggala", order: 2, time: "14:15" }],
      blocks: [
        { id: "transfer-to-museum", kind: "transfer", order: 1, placeId: "museum", title: "Breakfast and transfer to Nusa Dua", startTime: "09:15", endTime: "10:00", durationMinutes: 45, display: { routeAnchor: false, timeLabel: "09:15–10:00" }, evidence: [] },
        { id: "museum-stop", kind: "stop", order: 2, placeId: "museum", title: "Museum Pasifika", startTime: "10:00", evidence: [] },
        { id: "lunch", kind: "meal", order: 3, title: "Nusa Dua lunch", startTime: "12:15", evidence: [] },
        { id: "jenggala-stop", kind: "stop", order: 4, placeId: "jenggala", title: "Jenggala ceramics experience", startTime: "14:15", evidence: [] }
      ],
      candidatePlaceIds: []
    }],
    movements: [{ id: "movement-d1-1", dayId: "d1", originPlaceId: "museum", destinationPlaceId: "jenggala", mode: "driving", status: "recheck", evidence: [] }],
    actionRequirements: [],
    createdAt: "2026-08-26T00:00:00.000Z"
  };
  const session = store.createPlanningSession("travel", new Date("2026-08-26T00:00:00.000Z"));
  const proposal = { version: 1, title: "Bali", objective: "Visit South Bali", theme: "Culture", segments: ["Bali"], skeleton: ["2026-10-10"], tradeoffs: [], assumptions: [], decisionPoints: [] };
  store.savePlanningSession({ ...session, id: blueprint.proposalRef.sessionId, status: "proposal_ready", proposal, updatedAt: "2026-08-26T00:00:00.000Z" });
  store.confirmPlanningSession(blueprint.proposalRef.sessionId, 1);
  const research: ResearchSet = {
    schemaVersion: TRIP_BLUEPRINT_SCHEMA_VERSION,
    id: "research-bali-rendering",
    generationKey: "generation-bali-rendering",
    proposalRef: blueprint.proposalRef,
    skillLineage: blueprint.skillLineage,
    status: "completed",
    batches: [{ id: "bali", scopeLabel: "Bali", status: "completed", placeIds: ["museum", "jenggala"], eventIds: [], sourceIds: [], completedAt: "2026-08-26T00:00:00.000Z" }],
    places: blueprint.places,
    events: [],
    sources: [],
    actionRequirements: [],
    createdAt: "2026-08-26T00:00:00.000Z",
    updatedAt: "2026-08-26T00:00:00.000Z",
    completedAt: "2026-08-26T00:00:00.000Z"
  };
  store.saveBlueprintGeneration({
    generationKey: blueprint.generationKey,
    proposalRef: blueprint.proposalRef,
    skillLineage: blueprint.skillLineage,
    status: "completed",
    stage: "ready",
    createdAt: "2026-08-26T00:00:00.000Z",
    updatedAt: "2026-08-26T00:00:00.000Z"
  });
  store.saveResearchSet(research);
  store.saveTripBlueprint(blueprint);
  const compiled = store.createCompiledBlueprintPlan(compileTripBlueprint(blueprint, { createdAt: "2026-08-26T00:00:01.000Z" })).activePlan;
  const refreshed = store.saveGeneratedPlanRouteRefresh({
    planId: compiled.id,
    expectedVersion: compiled.version,
    provider: "google_maps",
    routes: [{
      segmentId: "movement-d1-1",
      observedAt: "2026-08-26T00:01:00.000Z",
      distanceMeters: 4_200,
      durationSeconds: 1_440,
      originCoordinates: [115.2299, -8.8001],
      destinationCoordinates: [115.1771, -8.7802],
      geometry: [[115.2299, -8.8001], [115.1771, -8.7802]]
    }]
  });

  assert.deepEqual(refreshed.workspace.activeBlueprint?.days[0]?.blocks?.map((block) => [block.id, block.kind, block.placeId ?? "", block.startTime ?? "", block.order]), [
    ["transfer-to-museum", "transfer", "museum", "09:15", 1],
    ["museum-stop", "stop", "museum", "10:00", 2],
    ["lunch", "meal", "", "12:15", 3],
    ["jenggala-stop", "stop", "jenggala", "14:15", 4]
  ]);
  assert.deepEqual(refreshed.workspace.activePlan.presentation?.days[0]?.blocks?.map((block) => [block.id, block.kind, block.placeId ?? "", block.title]), [
    ["transfer-to-museum", "transfer", "museum", "Breakfast and transfer to Nusa Dua"],
    ["museum-stop", "stop", "museum", "Museum Pasifika"],
    ["lunch", "meal", "", "Nusa Dua lunch"],
    ["jenggala-stop", "stop", "jenggala", "Jenggala ceramics experience"]
  ]);
  assert.equal(refreshed.workspace.activePlan.presentation?.routeSegments[0]?.verification, "verified");
  assert.equal(refreshed.workspace.activePlan.presentation?.routeSegments[0]?.durationMinutes, 24);
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
  assert.deepEqual(store.listRecentPreparationEvidenceRuns()[0]?.sourceEvidence, evidence);
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
  const directory = mkdtempSync(join(tmpdir(), "c-assistant-preparation-checklist-"));
  try {
    const databasePath = join(directory, "workspace.sqlite");
    const store = new SqliteWorkspaceStore(databasePath);
    const source = store.saveSourceSnapshot({ sourceId: "official-entry", authority: "Official", titleOriginal: "Entry guidance", url: "https://example.com/entry", retrievedAt: "2026-09-01T00:00:00.000Z", contentHash: "e".repeat(64), excerpt: "Official entry guidance." }).snapshot;
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
    const planId = workspace.activePlan.id;
    const [userTask, externalTask, arrivalTask] = workspace.activePlan.stages[0]?.tasks ?? [];
    const booking: TravelBooking = {
      id: "prep-booking",
      planId,
      planVersionCreated: workspace.activePlan.version,
      status: "needs_review",
      type: "ticket",
      title: "Museum ticket",
      source: "imported_email",
      sourceHash: "prep-booking-hash",
      sourceLabel: "Booking email",
      importedAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
      constraintStrength: "soft",
      segments: [{
        id: "prep-ticket-segment",
        segmentType: "event_window",
        title: "Museum ticket",
        status: "needs_review",
        startAtLocal: "2026-10-01T10:00",
        location: "Museum",
        constraintStrength: "soft",
        fixedCommitment: false,
        needsReviewReasons: ["Imported for reference only."]
      }]
    };
    store.saveTravelBooking(booking);
    store.linkSourceSnapshotToPlan(planId, source.id);
    const versionBeforeCheck = store.getWorkspace().activePlan.version;

    const checked = store.setPlanTaskChecked(planId, userTask?.id ?? "", true);
    assert.equal(checked.activePlan.stages[0]?.tasks[0]?.status, "completed");
    assert.equal(checked.activePlan.status, "draft");
    assert.equal(checked.executionPlan, undefined);
    assert.equal(checked.activePlan.sources.length, 1);
    assert.equal(store.listCurrentTravelBookingSourcesForPlan(planId).length, 1);
    assert.equal(store.getWorkspace().activePlan.stages[0]?.tasks[0]?.status, "completed");
    const checkedAgain = store.setPlanTaskChecked(planId, userTask?.id ?? "", true);
    assert.equal(checkedAgain.activePlan.version, checked.activePlan.version);

    const unchecked = store.setPlanTaskChecked(planId, userTask?.id ?? "", false);
    assert.equal(unchecked.activePlan.stages[0]?.tasks[0]?.status, "waiting_user");
    const uncheckedAgain = store.setPlanTaskChecked(planId, userTask?.id ?? "", false);
    assert.equal(uncheckedAgain.activePlan.version, unchecked.activePlan.version);
    assert.equal(unchecked.activePlan.version, versionBeforeCheck + 2);
    assert.throws(() => store.setPlanTaskChecked(planId, externalTask?.id ?? "", true), /packing items and pre-departure tasks/i);
    assert.throws(() => store.setPlanTaskChecked(planId, arrivalTask?.id ?? "", true), /packing items and pre-departure tasks/i);
    assert.equal(store.getWorkspace().activePlan.stages[0]?.tasks[0]?.status, "waiting_user");

    const rechecked = store.setPlanTaskChecked(planId, userTask?.id ?? "", true);
    assert.equal(rechecked.activePlan.stages[0]?.tasks[0]?.status, "completed");
    assert.equal(store.listCurrentTravelBookingSourcesForPlan(planId)[0]?.status, "needs_review");
    store.close();

    const reopened = new SqliteWorkspaceStore(databasePath);
    const persisted = reopened.getWorkspace();
    assert.equal(persisted.activePlan.id, planId);
    assert.equal(persisted.activePlan.status, "draft");
    assert.equal(persisted.executionPlan, undefined);
    assert.equal(persisted.activePlan.stages[0]?.tasks[0]?.status, "completed");
    assert.equal(persisted.activePlan.sources.length, 1);
    assert.equal(reopened.listCurrentTravelBookingSourcesForPlan(planId).length, 1);
    reopened.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
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
  assert.equal(store.getBlueprintGeneration(generationKey)?.stage, "research");

  const compilation = compileTripBlueprint(blueprint, { createdAt: "2026-08-26T00:02:01.000Z" });
  const compiled = store.createCompiledBlueprintPlan(compilation).activePlan;
  assert.equal(compiled.id, compilation.plan.id);
  assert.equal(store.getBlueprintGeneration(generationKey)?.stage, "ready");
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
  assert.equal(batchWorkspace.activeBlueprint?.version, 3);
  assert.equal(batchResult.revision.revisionCount, 2);
  assert.deepEqual(batchResult.revision.affectedDayIds, ["d1"]);
  assert.deepEqual(batchWorkspace.activeBlueprint?.days[0]?.stops.map((stop) => stop.placeId), ["b", "c", "a"]);
  assert.equal(store.getPlanBlueprintLineage(batchWorkspace.activePlan.id)?.blueprintVersion, 3);

  assert.throws(() => store.applyDirectBlueprintRevisionBatch({
    expectedPlanId: batchWorkspace.activePlan.id,
    expectedVersion: batchWorkspace.activePlan.version,
    revisions: [
      { kind: "move_place_within_day", placeId: "a", dayId: "d1", position: { kind: "start" }, createdAt: "2026-08-26T00:05:00.000Z" },
      { kind: "move_place_within_day", placeId: "b", dayId: "d1", position: { kind: "after", afterPlaceId: "missing-place" }, createdAt: "2026-08-26T00:05:00.000Z" }
    ]
  }), /unknown place missing-place/i);
  const afterFailedBatch = store.getWorkspace();
  assert.equal(afterFailedBatch.activeBlueprint?.version, 3);
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
  assert.equal(store.getBlueprintGeneration(generationKey)?.stage, "ready");
  assert.equal(routeRefresh.workspace.activeBlueprint?.version, 4);
  assert.deepEqual(routeRefresh.workspace.activeBlueprint?.movements.map((movement) => [movement.id, movement.status, movement.durationMinutes, movement.distanceMeters]), [["movement-d1-1", "verified", 9, 850], ["movement-d1-2", "recheck", undefined, undefined]]);
  assert.deepEqual(routeRefresh.workspace.activeBlueprint?.movements.map((movement) => [movement.id, movement.display?.mapLineState, movement.display?.refreshReason ?? ""]), [
    ["movement-d1-1", "formal", ""],
    ["movement-d1-2", "needs_refresh", "Refresh this route leg after direct itinerary edits."]
  ]);
  assert.deepEqual(routeRefresh.workspace.activeBlueprint?.movements[0]?.evidence, [{ sourceId: "google_maps", status: "verified", checkedAt: "2026-08-26T00:06:00.000Z", supports: ["route duration", "route distance"] }]);
  assert.deepEqual(routeRefresh.workspace.activeBlueprint?.days[0]?.blocks?.map((block) => [block.id, block.kind, block.placeId ?? "", block.startTime ?? ""]), [
    ["block-b", "stop", "b", "09:00"],
    ["block-d1-c-direct", "stop", "c", ""],
    ["block-rest", "rest", "", ""],
    ["block-a", "stop", "a", "10:30"]
  ]);
  assert.equal(routeRefresh.workspace.activePlan.presentation?.routeSegments[0]?.verification, "verified");
  assert.equal(routeRefresh.workspace.activePlan.presentation?.routeSegments[0]?.display?.mapLineState, "formal");
  assert.equal(store.getPlanBlueprintLineage(routeRefresh.workspace.activePlan.id)?.blueprintVersion, 4);
  assert.equal(store.getPlanBlueprintLineage(routeRefresh.workspace.activePlan.id)?.planVersion, routeRefresh.workspace.activePlan.version);

  const executingA = store.confirmPlan(routeRefresh.workspace.activePlan.id).activePlan;
  const executionA = store.getExecutionPlan();
  const executionAOrder = executionA?.presentation?.kind === "itinerary" ? executionA.presentation.days[0]?.placeIds : undefined;
  const replacementB = store.applyDirectBlueprintRevision({
    expectedPlanId: executingA.id,
    expectedVersion: executingA.version,
    expectedBlueprintVersion: 4,
    revision: { kind: "move_place_within_day", placeId: "a", dayId: "d1", position: { kind: "start" }, createdAt: "2026-08-26T00:07:00.000Z" }
  });
  assert.notEqual(replacementB.activePlan.id, executingA.id);
  assert.equal(replacementB.activePlan.status, "draft");
  assert.equal(replacementB.activeBlueprint?.version, 5);
  assert.deepEqual(replacementB.activeBlueprint?.days[0]?.stops.map((stop) => stop.placeId), ["a", "b", "c"]);
  const executionWhileBIsDraft = store.getExecutionPlan();
  assert.equal(executionWhileBIsDraft?.id, executingA.id);
  assert.deepEqual(executionWhileBIsDraft?.presentation?.kind === "itinerary" ? executionWhileBIsDraft.presentation.days[0]?.placeIds : undefined, executionAOrder);
  assert.equal(store.getPlanBlueprintLineage(executionWhileBIsDraft!.id)?.blueprintVersion, 4);

  const executingB = store.confirmPlan(replacementB.activePlan.id).activePlan;
  const executionB = store.getExecutionPlan();
  assert.equal(executionB?.id, executingB.id);
  assert.deepEqual(executionB?.presentation?.kind === "itinerary" ? executionB.presentation.days[0]?.placeIds : undefined, ["a", "b", "c"]);
  assert.equal(store.getPlanBlueprintLineage(executingB.id)?.blueprintVersion, 5);
  assert.equal(store.listHistoricalPlans().some((plan) => plan.id === executingA.id), true);

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
    reopened.confirmPlan(planId);
    assert.equal(reopened.getExecutionPlan()?.presentation?.summary, "Blueprint source presentation");
    assert.deepEqual(reopened.getExecutionPlan()?.presentation?.days[0]?.placeIds, ["a", "b"]);
    assert.deepEqual(reopened.getExecutionPlan()?.presentation?.routeSegments.map((segment) => segment.id), ["movement-d1-1"]);
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

test("checking preparation on an approved itinerary preserves execution version and progress", () => {
  const store = new SqliteWorkspaceStore(":memory:");
  const plan = store.createGeneratedPlan({ title: "Approved trip", location: "Auckland", dates: "2026-11-04", knownInformation: [], assumptions: [], nextAction: "Review", stages: [{ title: "Packing", description: "Prepare", tasks: [{ title: "Passport", owner: "user", dueLabel: "Before departure", preparationCategory: "documents" }] }] }).activePlan;
  store.confirmPlan(plan.id);
  const progress = { steps: { museum: { phase: "done" } }, deliveries: { reminder: { status: "sent" } }, timeZones: { auckland: "Pacific/Auckland" } };
  assert.equal(store.saveExecutionAssistantState(plan.id, plan.version, 0, progress), true);
  store.setPlanTaskChecked(plan.id, plan.stages[0]!.tasks[0]!.id, true);
  assert.equal(store.getExecutionPlan()!.version, plan.version);
  assert.deepEqual(store.getExecutionAssistantState(plan.id, plan.version)?.data, progress);
  store.setPlanTaskChecked(plan.id, plan.stages[0]!.tasks[0]!.id, false);
  assert.equal(store.getExecutionPlan()!.version, plan.version);
  assert.deepEqual(store.getExecutionAssistantState(plan.id, plan.version)?.data, progress);
  store.close();
});

function 准备直接编辑存储(store: SqliteWorkspaceStore, configure?: (blueprint:TripBlueprint)=>void, compilation?: ReturnType<typeof compileTripBlueprint>): TripBlueprint {
  const session=store.createPlanningSession("travel");
  store.savePlanningSession({...session,status:"proposal_ready",proposal:{version:1,title:"虚构旅行",objective:"旅行",theme:"旅行",segments:["东京"],skeleton:["2026-09-01"],tradeoffs:[],assumptions:[],decisionPoints:[]}});
  store.confirmPlanningSession(session.id,1);
  const blueprint:TripBlueprint={schemaVersion:1,id:"持久蓝图",version:1,generationKey:"持久生成",proposalRef:{sessionId:session.id,proposalVersion:1},skillLineage:{skillId:"landi-trip-blueprint",skillVersion:"1.0.0"},researchSetId:"持久研究",title:"虚构旅行",summary:"隔离测试",language:"zh",destinations:["东京"],startDate:"2026-09-01",endDate:"2026-09-01",places:[{id:"a",name:"虚构景点",locationLabel:"东京",category:"sight",priority:"must",coordinates:[35.68,139.76],whyWorthIt:"测试",plan:"游览",evidence:[]}],events:[],sources:[],days:[{id:"d",date:"2026-09-01",kind:"scheduled",city:"东京",title:"第一天",summary:"测试",stops:[{placeId:"a",order:1}],candidatePlaceIds:[]}],movements:[],actionRequirements:[],travelTips:[{id:"t",title:"雨具",body:"随身携带雨具",theme:"weather",context:"雨天",evidence:[]}],createdAt:"2026-08-26T00:00:00Z"};
  configure?.(blueprint);
  store.saveBlueprintGeneration({generationKey:blueprint.generationKey,proposalRef:blueprint.proposalRef,skillLineage:blueprint.skillLineage,stage:"ready",status:"completed",createdAt:blueprint.createdAt,updatedAt:blueprint.createdAt});
  store.saveResearchSet({schemaVersion:1,id:blueprint.researchSetId,generationKey:blueprint.generationKey,proposalRef:blueprint.proposalRef,skillLineage:blueprint.skillLineage,status:"completed",batches:[],places:blueprint.places,events:[],sources:[],actionRequirements:[],createdAt:blueprint.createdAt,updatedAt:blueprint.createdAt});
  store.saveTripBlueprint(blueprint);store.createCompiledBlueprintPlan(compilation ?? compileTripBlueprint(blueprint,{createdAt:blueprint.createdAt}));return blueprint;
}

test("保存后直接编辑与撤销跨重启回读并幂等保留执行指针和配置", () => {
  const directory=mkdtempSync(join(tmpdir(),"landi-direct-"));const file=join(directory,"test.sqlite");let store=new SqliteWorkspaceStore(file);
  try {
    const original=准备直接编辑存储(store);store.confirmPlan(store.getWorkspace().activePlan.id);
    const before=store.getWorkspace();const execution=store.getExecutionPlan()!;
    const input={expectedPlanId:before.activePlan.id,expectedVersion:before.activePlan.version,expectedBlueprintVersion:1,requestId:"保存请求",revisions:[{kind:"set_tip_state" as const,tipId:"t",pinned:true,createdAt:"2026-08-27T00:00:00Z"}]};
    const saved=store.applyDirectBlueprintRevisionBatch(input);
    assert.equal(saved.workspace.activeBlueprint!.version,2);assert.equal(saved.workspace.activePlan.status,"draft");
    assert.deepEqual(saved.workspace.activePlan.configuration,before.activePlan.configuration);assert.equal(store.getExecutionPlan()!.id,execution.id);
    assert.deepEqual(store.applyDirectBlueprintRevisionBatch(input),saved);
    assert.throws(()=>store.applyDirectBlueprintRevisionBatch({...input,revisions:[{...input.revisions[0]!,pinned:false}]}),/请求身份/);
    assert.throws(()=>store.saveTripBlueprint({...original,title:"不允许同版本覆盖"}),/同一旅行蓝图版本/);
    store.close();store=new SqliteWorkspaceStore(file);
    assert.equal(store.getWorkspace().latestDirectBlueprintRevision!.id,saved.revision.id);
    const undo={expectedPlanId:saved.workspace.activePlan.id,expectedVersion:saved.workspace.activePlan.version,expectedBlueprintVersion:2,revisionId:saved.revision.id,requestId:"撤销请求"};
    const undone=store.undoDirectBlueprintRevision(undo);
    assert.equal(undone.activeBlueprint!.version,3);assert.equal(undone.activeBlueprint!.travelTips![0]!.pinned,undefined);assert.equal(undone.latestDirectBlueprintRevision,undefined);
    assert.equal(store.getExecutionPlan()!.id,execution.id);assert.deepEqual(undone.activePlan.configuration,before.activePlan.configuration);
    store.close();store=new SqliteWorkspaceStore(file);assert.deepEqual(store.undoDirectBlueprintRevision(undo),undone);
    assert.throws(()=>store.undoDirectBlueprintRevision({...undo,requestId:"另一撤销"}),/已变化/);
  } finally {store.close();rmSync(directory,{recursive:true,force:true});}
});

// 比较所有业务表，覆盖当前/执行指针、生成状态、Plan 子表、lineage 与审计回执。
function isolatedDatabaseRows(database: DatabaseSync) {
  const tables = database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[];
  return tables.map(({ name }) => ({ name, rows: database.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}" ORDER BY rowid`).all() }));
}

const directTransactionFailures = [
  ["Blueprint 保存", "INSERT ON trip_blueprints"],
  ["Generation 版本关联", "UPDATE ON blueprint_generations"],
  ["旧草稿指针", "UPDATE ON plans"],
  ["替代草稿保存", "INSERT ON plans"],
  ["草稿阶段保存", "INSERT ON stages"],
  ["草稿任务保存", "INSERT ON tasks"],
  ["Compilation lineage", "INSERT ON plan_blueprint_lineage"],
  ["编译通知", "INSERT ON inbox_items"],
] as const;

for (const operation of ["save", "undo"] as const) {
  const auditFailures = operation === "save"
    ? [["修订审计", "INSERT ON direct_blueprint_edits"], ["修订结果回执", "UPDATE OF result_json ON direct_blueprint_edits"]] as const
    : [["撤销标记", "UPDATE OF undone ON direct_blueprint_edits"], ["撤销回执", "INSERT ON direct_blueprint_undos"]] as const;
  for (const [label, statement] of [...directTransactionFailures, ...auditFailures]) {
    test(`直接编辑 ${operation} 在${label}失败时完整回滚并跨重启重试`, () => {
      const directory = mkdtempSync(join(tmpdir(), "landi-atomic-step-"));
      const file = join(directory, "test.sqlite");
      let store = new SqliteWorkspaceStore(file);
      const fault = new DatabaseSync(file);
      try {
        准备直接编辑存储(store, blueprint => {
          blueprint.bookingConstraints = [{id:"fictional-booking",type:"ticket",title:"虚构门票",status:"needs_review",sourceLabel:"虚构测试",importedAt:"2026-08-26T00:00:00Z",constraintStrength:"soft",segments:[{id:"fictional-segment",segmentType:"event_window",title:"核对虚构门票",constraintStrength:"soft",fixedCommitment:false,needsReviewReasons:[]}]}];
        });
        store.confirmPlan(store.getWorkspace().activePlan.id);
        const original = store.getWorkspace();
        const input = { expectedPlanId: original.activePlan.id, expectedVersion: original.activePlan.version, expectedBlueprintVersion: 1, requestId: "隔离保存", revisions: [{ kind: "set_tip_state" as const, tipId: "t", hidden: true, createdAt: "2026-08-27T00:00:00Z" }] };
        const saved = operation === "undo" ? store.applyDirectBlueprintRevisionBatch(input) : undefined;
        const undo = saved && { expectedPlanId: saved.workspace.activePlan.id, expectedVersion: saved.workspace.activePlan.version, expectedBlueprintVersion: 2, revisionId: saved.revision.id, requestId: "隔离撤销" };
        const before = isolatedDatabaseRows(fault);
        fault.exec(`CREATE TRIGGER isolated_failure BEFORE ${statement} BEGIN SELECT RAISE(ABORT,'隔离事务注入失败'); END`);
        assert.throws(() => undo ? store.undoDirectBlueprintRevision(undo) : store.applyDirectBlueprintRevisionBatch(input), /隔离事务注入失败/);
        assert.deepEqual(isolatedDatabaseRows(fault), before);
        store.close();
        store = new SqliteWorkspaceStore(file);
        assert.deepEqual(isolatedDatabaseRows(fault), before);
        fault.exec("DROP TRIGGER isolated_failure");
        const workspace = undo ? store.undoDirectBlueprintRevision(undo) : store.applyDirectBlueprintRevisionBatch(input).workspace;
        assert.equal(workspace.activeBlueprint!.version, undo ? 3 : 2);
        assert.equal(store.getExecutionPlan()!.id, original.activePlan.id);
      } finally {
        fault.close();
        store.close();
        rmSync(directory, { recursive: true, force: true });
      }
    });
  }
}

test("独立 Schema 27 数据迁移到 28 后保留历史编译关联和执行状态并可重开", () => {
  const directory = mkdtempSync(join(tmpdir(), "landi-schema27-"));
  const file = join(directory, "test.sqlite");
  let store = new SqliteWorkspaceStore(file);
  try {
    const historical = JSON.parse(readFileSync(new URL("../../../tests/fixtures/blueprint-compiler-v1.json", import.meta.url), "utf8")) as {blueprint:TripBlueprint;compilation:ReturnType<typeof compileTripBlueprint>};
    assert.equal(historical.compilation.lineage.compilerVersion, "1.0.0");
    assert.equal(historical.compilation.lineage.compilationKey, `${historical.blueprint.id}:1:1.0.0`);
    准备直接编辑存储(store, blueprint => {
      const proposalRef = blueprint.proposalRef;
      Object.assign(blueprint, structuredClone(historical.blueprint), {proposalRef});
    }, historical.compilation);
    store.confirmPlan(store.getWorkspace().activePlan.id);
    const execution = store.getExecutionPlan()!;
    const progress = { steps: { fictional: { phase: "done" } }, deliveries: {}, timeZones: {} };
    assert.equal(store.saveExecutionAssistantState(execution.id, execution.version, 0, progress), true);
    store.close();
    const legacy = new DatabaseSync(file);
    let before;
    try {
      // 28 仅增加这两张表与版本标记；其余结构就是独立虚构的 27 数据库。
      legacy.exec("DROP TABLE travel_adjustment_drafts; DROP TABLE travel_adjustment_handoffs; DROP TABLE travel_adjustment_receipts; DROP TABLE travel_episodes; DROP TABLE travel_observations; DROP TABLE travel_phases; DROP TABLE booking_mutation_receipts; DROP TABLE direct_blueprint_undos; DROP TABLE direct_blueprint_edits; DELETE FROM schema_migrations WHERE version>=28");
      assert.equal((legacy.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as {version:number}).version, 27);
      before = isolatedDatabaseRows(legacy);
    } finally { legacy.close(); }
    store = new SqliteWorkspaceStore(file);
    assert.equal(store.getDatabaseMaintenanceStatus().schemaVersion, 32);
    const migrated = new DatabaseSync(file);
    try {
      const existingTables = new Set(before.map(table => table.name));
      const after = isolatedDatabaseRows(migrated).filter(table => existingTables.has(table.name)).map(table => table.name === "schema_migrations" ? {...table, rows: table.rows.filter(row => Number(row.version) < 28)} : table);
      assert.deepEqual(after, before);
    } finally { migrated.close(); }
    const oldLineage = store.getPlanBlueprintLineage(execution.id)!;
    assert.deepEqual(oldLineage, historical.compilation.lineage);
    assert.equal(execution.id, historical.compilation.plan.id);
    const historicalTask = execution.stages.flatMap(stage => stage.tasks).find(task => task.requirementId === "historical-preparation")!;
    assert.equal(historicalTask.status, "completed");
    const beforeEdit = store.getWorkspace();
    const saved = store.applyDirectBlueprintRevisionBatch({ expectedPlanId: beforeEdit.activePlan.id, expectedVersion: beforeEdit.activePlan.version, expectedBlueprintVersion: 1, requestId: "迁移后保存", revisions: [{kind:"set_tip_state",tipId:"t",pinned:true,createdAt:"2026-08-27T00:00:00Z"}] });
    assert.equal(saved.workspace.activePlan.stages.flatMap(stage => stage.tasks).find(task => task.requirementId === "historical-preparation")!.status, "completed");
    assert.deepEqual(store.getPlanBlueprintLineage(execution.id), historical.compilation.lineage);
    assert.deepEqual(store.getExecutionPlan(), execution);
    const undone = store.undoDirectBlueprintRevision({expectedPlanId:saved.workspace.activePlan.id,expectedVersion:saved.workspace.activePlan.version,expectedBlueprintVersion:2,revisionId:saved.revision.id,requestId:"迁移后撤销"});
    const newLineage = store.getPlanBlueprintLineage(undone.activePlan.id)!;
    assert.equal(newLineage.blueprintVersion, 3);
    assert.equal(newLineage.compilerVersion, "2.1.0");
    assert.equal(newLineage.compilationKey, `${historical.blueprint.id}:3:2.1.0`);
    assert.equal(undone.activePlan.stages.flatMap(stage => stage.tasks).find(task => task.requirementId === "historical-preparation")!.status, "completed");
    store.close();
    store = new SqliteWorkspaceStore(file);
    assert.deepEqual(store.getPlanBlueprintLineage(execution.id), oldLineage);
    assert.deepEqual(store.getPlanBlueprintLineage(undone.activePlan.id), newLineage);
    assert.deepEqual(store.getExecutionPlan(), execution);
    assert.equal(store.getWorkspace().activePlan.stages.flatMap(stage => stage.tasks).find(task => task.requirementId === "historical-preparation")!.status, "completed");
    assert.deepEqual(store.getExecutionAssistantState(execution.id, execution.version)?.data, progress);
    assert.equal(store.getWorkspace().activeBlueprint!.version, 3);
    assert.equal(store.getDatabaseMaintenanceStatus().migrations.filter(migration => migration.version === 28).length, 1);
  } finally { store.close(); rmSync(directory, {recursive:true,force:true}); }
});

test("必访先降级另存再删除仍需精确影响确认", async()=>{
  const {DirectBlueprintHighImpactError}=await import("@c-assistant/core");const store=new SqliteWorkspaceStore(":memory:");
  try {准备直接编辑存储(store);let workspace=store.getWorkspace();workspace=store.applyDirectBlueprintRevision({expectedPlanId:workspace.activePlan.id,expectedVersion:workspace.activePlan.version,revision:{kind:"update_place_priority",placeId:"a",priority:"preferred",createdAt:"2026-08-27T00:00:00Z"}});
    const input={expectedPlanId:workspace.activePlan.id,expectedVersion:workspace.activePlan.version,expectedBlueprintVersion:2,revisions:[{kind:"remove_place_from_day" as const,placeId:"a",dayId:"d",createdAt:"2026-08-27T00:01:00Z"}]};
    let confirmation="";assert.throws(()=>store.applyDirectBlueprintRevisionBatch(input),(error:unknown)=>{assert.ok(error instanceof DirectBlueprintHighImpactError);confirmation=error.impact.id;return true;});
    const saved=store.applyDirectBlueprintRevisionBatch({...input,highImpactConfirmation:confirmation});assert.equal(saved.workspace.activeBlueprint!.places[0]!.priority,"preferred");assert.deepEqual(saved.workspace.activeBlueprint!.days[0]!.stops,[]);
  } finally {store.close();}
});

test("受控打开精确支持新审计表版本并拒绝历史版本伪装",async()=>{
  const {guardedSchemaSha256}=await import("./guarded-schema.js");const directory=mkdtempSync(join(tmpdir(),"landi-guarded-"));const file=join(directory,"test.sqlite");
  try {const initial=new SqliteWorkspaceStore(file);准备直接编辑存储(initial);initial.close();
    let database=new DatabaseSync(file);const digest=guardedSchemaSha256(database);database.close();
    const guarded=new SqliteWorkspaceStore(file,{guardedSchemaSha256:digest});assert.equal(guarded.getDatabaseMaintenanceStatus().schemaVersion,32);assert.equal(guarded.getWorkspace().activeBlueprint!.version,1);guarded.close();
    database=new DatabaseSync(file);database.exec("ALTER TABLE direct_blueprint_undos DROP COLUMN fingerprint");const incompleteDigest=guardedSchemaSha256(database);database.close();
    assert.throws(()=>new SqliteWorkspaceStore(file,{guardedSchemaSha256:incompleteDigest}),/guarded_schema_incomplete/);
    database=new DatabaseSync(file);database.exec("DELETE FROM schema_migrations WHERE version>=28");const oldDigest=guardedSchemaSha256(database);database.close();
    assert.throws(()=>new SqliteWorkspaceStore(file,{guardedSchemaSha256:oldDigest}),/guarded_schema_version_unsupported/);
  }finally{rmSync(directory,{recursive:true,force:true});}
});

test("后续编辑后的早先保存与撤销重放保留原回执且不回退当前工作区",()=>{
  const store=new SqliteWorkspaceStore(":memory:");
  try{准备直接编辑存储(store);const before=store.getWorkspace();
    const firstInput={expectedPlanId:before.activePlan.id,expectedVersion:before.activePlan.version,expectedBlueprintVersion:1,requestId:"首次保存",revisions:[{kind:"set_tip_state" as const,tipId:"t",pinned:true,createdAt:"2026-08-27T00:00:00Z"}]};
    const first=store.applyDirectBlueprintRevisionBatch(firstInput);
    const second=store.applyDirectBlueprintRevisionBatch({expectedPlanId:first.workspace.activePlan.id,expectedVersion:first.workspace.activePlan.version,expectedBlueprintVersion:2,requestId:"第二次保存",revisions:[{kind:"set_tip_state",tipId:"t",hidden:true,createdAt:"2026-08-27T00:01:00Z"}]});
    const replay=store.applyDirectBlueprintRevisionBatch(firstInput);assert.deepEqual(replay.revision,first.revision);assert.equal(replay.workspace.activeBlueprint!.version,3);assert.equal(replay.workspace.activePlan.id,second.workspace.activePlan.id);
    const undo={expectedPlanId:second.workspace.activePlan.id,expectedVersion:second.workspace.activePlan.version,expectedBlueprintVersion:3,revisionId:second.revision.id,requestId:"撤销第二次"};
    const undone=store.undoDirectBlueprintRevision(undo);const third=store.applyDirectBlueprintRevisionBatch({expectedPlanId:undone.activePlan.id,expectedVersion:undone.activePlan.version,expectedBlueprintVersion:4,requestId:"第三次保存",revisions:[{kind:"set_tip_state",tipId:"t",pinned:false,createdAt:"2026-08-27T00:02:00Z"}]});
    assert.equal(store.undoDirectBlueprintRevision(undo).activePlan.id,third.workspace.activePlan.id);assert.equal(store.getWorkspace().activeBlueprint!.version,5);assert.equal(store.getTripBlueprint("持久蓝图",6),undefined);
  }finally{store.close();}
});

test("未编译生成候选可修正但已编译版本保持不可覆盖",()=>{
  const store=new SqliteWorkspaceStore(":memory:");
  try{const published=准备直接编辑存储(store);assert.throws(()=>store.saveTripBlueprint({...published,summary:"覆盖已发布内容"}),/同一旅行蓝图版本/);
    const candidate={...structuredClone(published),version:2,summary:"生成中的候选"};store.saveTripBlueprint(candidate);
    const corrected={...candidate,summary:"同一未编译候选的修正"};assert.equal(store.saveTripBlueprint(corrected).summary,corrected.summary);
    store.createCompiledBlueprintPlan(compileTripBlueprint(corrected,{createdAt:"2026-08-27T00:00:00Z"}));assert.throws(()=>store.saveTripBlueprint({...corrected,summary:"编译后覆盖"}),/同一旅行蓝图版本/);
  }finally{store.close();}
});

test("联合检查点不能覆盖已编译或直接编辑审计引用的前后版本",()=>{
  const directory=mkdtempSync(join(tmpdir(),"landi-protected-"));const file=join(directory,"test.sqlite");const store=new SqliteWorkspaceStore(file);const database=new DatabaseSync(file);
  try{const original=准备直接编辑存储(store);const research=store.getResearchSet(original.researchSetId)!;
    assert.throws(()=>store.saveResearchSetAndTripBlueprint(research,{...original,summary:"联合写入绕过"}),/同一旅行蓝图版本/);
    const before=store.getWorkspace();store.applyDirectBlueprintRevisionBatch({expectedPlanId:before.activePlan.id,expectedVersion:before.activePlan.version,expectedBlueprintVersion:1,requestId:"审计保护",revisions:[{kind:"set_tip_state",tipId:"t",pinned:true,createdAt:"2026-08-27T00:00:00Z"}]});
    database.prepare("DELETE FROM plan_blueprint_lineage WHERE blueprint_id=?").run(original.id);
    assert.throws(()=>store.saveTripBlueprint({...original,summary:"改写审计前版本"}),/同一旅行蓝图版本/);
    assert.throws(()=>store.saveResearchSetAndTripBlueprint(research,{...original,summary:"联合改写审计前版本"}),/同一旅行蓝图版本/);
    const after=store.getTripBlueprint(original.id,2)!;assert.throws(()=>store.saveResearchSetAndTripBlueprint(research,{...after,summary:"改写审计后版本"}),/同一旅行蓝图版本/);
  }finally{database.close();store.close();rmSync(directory,{recursive:true,force:true});}
});

test("已完成结构化预订经直接编辑撤销与重启保持完成",()=>{
 const directory=mkdtempSync(join(tmpdir(),"landi-booking-completion-"));const file=join(directory,"test.sqlite");let store=new SqliteWorkspaceStore(file);
 try{准备直接编辑存储(store,blueprint=>{blueprint.bookingConstraints=[{id:"booking",type:"ticket",title:"虚构门票",status:"needs_review",sourceLabel:"旅客导入",importedAt:"2026-08-26T00:00:00Z",constraintStrength:"soft",segments:[{id:"segment",segmentType:"event_window",title:"确认门票",constraintStrength:"soft",fixedCommitment:false,needsReviewReasons:[]}]}];});
  let workspace=store.getWorkspace();const requirementId=bookingTaskRequirementId(workspace.activeBlueprint!.bookingConstraints![0]!,"segment");const task=workspace.activePlan.stages.flatMap(stage=>stage.tasks).find(task=>task.requirementId===requirementId)!;assert.equal(task.owner,"user");
  store.setPlanTaskChecked(workspace.activePlan.id,task.id,true);workspace=store.getWorkspace();
  const saved=store.applyDirectBlueprintRevisionBatch({expectedPlanId:workspace.activePlan.id,expectedVersion:workspace.activePlan.version,expectedBlueprintVersion:1,requestId:"保留完成预订",revisions:[{kind:"set_tip_state",tipId:"t",pinned:true,createdAt:"2026-08-27T00:00:00Z"}]});
  const completed=(value:typeof workspace)=>value.activePlan.stages.flatMap(stage=>stage.tasks).find(task=>task.requirementId===requirementId)!;
  assert.equal(completed(saved.workspace).status,"completed");
  const undone=store.undoDirectBlueprintRevision({expectedPlanId:saved.workspace.activePlan.id,expectedVersion:saved.workspace.activePlan.version,expectedBlueprintVersion:2,revisionId:saved.revision.id,requestId:"撤销并保留完成预订"});assert.equal(completed(undone).status,"completed");assert.equal(completed(undone).reminder,undefined);
  store.close();store=new SqliteWorkspaceStore(file);assert.equal(completed(store.getWorkspace()).status,"completed");
 }finally{store.close();rmSync(directory,{recursive:true,force:true});}
});


test("Schema 28 迁移标记失败原子回滚新增表且保留虚构 27 数据", () => {
  const directory = mkdtempSync(join(tmpdir(), "landi-schema28-atomic-"));
  const file = join(directory, "test.sqlite");
  const initial = new SqliteWorkspaceStore(file);
  准备直接编辑存储(initial);
  initial.close();
  const database = new DatabaseSync(file);
  try {
    database.exec("DROP TABLE travel_adjustment_drafts; DROP TABLE travel_adjustment_handoffs; DROP TABLE travel_adjustment_receipts; DROP TABLE travel_episodes; DROP TABLE travel_observations; DROP TABLE travel_phases; DROP TABLE booking_mutation_receipts; DROP TABLE direct_blueprint_undos; DROP TABLE direct_blueprint_edits; DELETE FROM schema_migrations WHERE version>=28");
    const before = isolatedDatabaseRows(database);
    const tablesBefore = database.prepare("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
    database.exec("CREATE TRIGGER isolated_migration_failure BEFORE INSERT ON schema_migrations WHEN NEW.version=28 BEGIN SELECT RAISE(ABORT,'隔离迁移标记失败'); END");
    assert.throws(() => new SqliteWorkspaceStore(file), /隔离迁移标记失败/);
    assert.deepEqual(isolatedDatabaseRows(database), before);
    assert.deepEqual(database.prepare("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all(), tablesBefore);
    assert.equal((database.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as {version:number}).version, 27);
    database.exec("DROP TRIGGER isolated_migration_failure");
    const recovered = new SqliteWorkspaceStore(file);
    try {
      assert.equal(recovered.getDatabaseMaintenanceStatus().schemaVersion, 32);
      assert.equal(recovered.getWorkspace().activeBlueprint!.version, 1);
      const existingTables = new Set(before.map(table => table.name));
      const after = isolatedDatabaseRows(database).filter(table => existingTables.has(table.name)).map(table => table.name === "schema_migrations" ? {...table, rows:table.rows.filter(row => Number(row.version) < 28)} : table);
      assert.deepEqual(after, before);
      assert.equal((database.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name IN ('direct_blueprint_edits','direct_blueprint_undos')").get() as {count:number}).count, 2);
    } finally { recovered.close(); }
  } finally { database.close(); rmSync(directory, {recursive:true,force:true}); }
});

test("独立 Schema 29 升级预订回执 Schema 30 保留历史，编号失败回滚新表",()=>{
  const directory=mkdtempSync(join(tmpdir(),"landi-booking-schema30-"));const file=join(directory,"isolated.sqlite");
  try{
    const initial=new SqliteWorkspaceStore(file);准备直接编辑存储(initial);const before=initial.getWorkspace();const lineage=initial.getPlanBlueprintLineage(before.activePlan.id);initial.close();
    let database=new DatabaseSync(file);database.exec("DROP TABLE travel_adjustment_drafts; DROP TABLE travel_adjustment_handoffs; DROP TABLE travel_adjustment_receipts; DROP TABLE travel_episodes; DROP TABLE travel_observations; DROP TABLE travel_phases; DROP TABLE booking_mutation_receipts; DELETE FROM schema_migrations WHERE version>=30; CREATE TRIGGER isolated_schema30_failure BEFORE INSERT ON schema_migrations WHEN NEW.version=30 BEGIN SELECT RAISE(ABORT,'隔离预订回执迁移失败'); END");database.close();
    assert.throws(()=>new SqliteWorkspaceStore(file),/隔离预订回执迁移失败/);
    database=new DatabaseSync(file);assert.equal(database.prepare("SELECT MAX(version) AS value FROM schema_migrations").get()!.value,29);assert.equal(database.prepare("SELECT name FROM sqlite_master WHERE name='booking_mutation_receipts'").get(),undefined);database.exec("DROP TRIGGER isolated_schema30_failure");database.close();
    const upgraded=new SqliteWorkspaceStore(file);assert.equal(upgraded.getDatabaseMaintenanceStatus().schemaVersion,32);assert.deepEqual(upgraded.getWorkspace(),before);assert.deepEqual(upgraded.getPlanBlueprintLineage(before.activePlan.id),lineage);upgraded.close();
    const reopened=new SqliteWorkspaceStore(file);assert.deepEqual(reopened.getWorkspace(),before);assert.equal(reopened.getDatabaseMaintenanceStatus().migrations.filter(item=>item.version===30).length,1);reopened.close();
  }finally{rmSync(directory,{recursive:true,force:true});}
});

test("真实旧 2.0 产物经持久勾选、重启及普通编辑或关系审阅精确继承完成",()=>{
  const fixture=JSON.parse(readFileSync(new URL("../test-fixtures/blueprint-compiler-v2.json",import.meta.url),"utf8")) as {provenance:{compilerVersion:string;sourceHead:string};cases:Array<{name:string;blueprint:TripBlueprint;compilation:ReturnType<typeof compileTripBlueprint>}>};
  assert.equal(fixture.provenance.compilerVersion,"2.0.0");assert.equal(fixture.provenance.sourceHead,"7bda1fccc6c694215631c9367d5065c2014ebc77");
  for(const item of fixture.cases) for(const mode of item.blueprint.bookingConstraints![0]!.sourceBookingId?["普通编辑","关联审阅"]:["普通编辑"]) {
    const directory=mkdtempSync(join(tmpdir(),"landi-real-v2-"));const file=join(directory,"isolated.sqlite");let store=new SqliteWorkspaceStore(file);
    try{
      准备真实旧编译存储(store,item);
      let workspace=store.getWorkspace();const originalPlanId=workspace.activePlan.id;const lineage=store.getPlanBlueprintLineage(originalPlanId)!;assert.equal(lineage.compilerVersion,"2.0.0");
      const legacyTask=workspace.activePlan.stages.flatMap(stage=>stage.tasks).find(task=>task.requirementId==="booking:booking-旧原始预订:segment-旧分段")!;assert.ok(legacyTask);
      store.setPlanTaskChecked(originalPlanId,legacyTask.id,true);workspace=store.getWorkspace();assert.equal(workspace.activePlan.version,2);assert.equal(store.getPlanBlueprintLineage(originalPlanId)!.planVersion,1);
      store.close();store=new SqliteWorkspaceStore(file);workspace=store.getWorkspace();
      let revisions:import("@c-assistant/core").DirectBlueprintRevision[];
      if(mode==="普通编辑")revisions=[{kind:"set_tip_state",tipId:"旧提示",pinned:true,createdAt:"2026-11-02T00:00:00Z"}];
      else {const context=store.getBookingRelationshipReviewContext(workspace.activePlan.id);revisions=[{kind:"review_booking_relationships",expectedSourceSetDigest:context.sourceSetDigest,assessment:{schemaVersion:1,blueprintId:context.blueprintId,blueprintVersion:context.blueprintVersion,universeDigest:context.universeDigest,status:"reviewed",units:context.units.map(unit=>({...unit,coverage:"complete",relations:[],rationale:"核对全量直接、间接及跨日依赖后明确无关联",evidenceRefs:["traveler-declaration"]})),decision:{source:"traveler",actorId:"local-traveler",decidedAt:"2026-11-02T00:00:00Z",rationale:"逐项审阅所有来源与目标",evidenceRefs:["traveler-declaration"],obligations:["考虑直接、间接和跨日依赖"]}},createdAt:"2026-11-02T00:00:00Z"}];}
      const saved=store.applyDirectBlueprintRevisionBatch({expectedPlanId:workspace.activePlan.id,expectedVersion:workspace.activePlan.version,expectedBlueprintVersion:1,requestId:`旧版${item.name}${mode}`,revisions});
      const constraint=saved.workspace.activeBlueprint!.bookingConstraints![0]!;const identity=bookingTaskRequirementId(constraint,constraint.segments[0]!.id);
      assert.equal(saved.workspace.activePlan.stages.flatMap(stage=>stage.tasks).find(task=>task.requirementId===identity)!.status,"completed",`${item.name}/${mode}`);
      assert.equal(store.getPlanBlueprintLineage(saved.workspace.activePlan.id)!.compilerVersion,"2.1.0");assert.deepEqual(store.getPlanBlueprintLineage(originalPlanId),lineage);
      store.close();store=new SqliteWorkspaceStore(file);assert.equal(store.getWorkspace().activePlan.stages.flatMap(stage=>stage.tasks).find(task=>task.requirementId===identity)!.status,"completed");
    }finally{store.close();rmSync(directory,{recursive:true,force:true});}
  }
});

test("真实旧 2.0 完成不跨源语义变化或任务字段篡改继承",()=>{
  const fixture=JSON.parse(readFileSync(new URL("../test-fixtures/blueprint-compiler-v2.json",import.meta.url),"utf8")) as {cases:Array<{name:string;blueprint:TripBlueprint;compilation:ReturnType<typeof compileTripBlueprint>}>};const item=fixture.cases.find(value=>value.blueprint.bookingConstraints![0]!.sourceBookingId)!;
  for(const mode of ["源结构变化","任务字段篡改"]) {
    const directory=mkdtempSync(join(tmpdir(),"landi-real-v2-rejection-"));const file=join(directory,"isolated.sqlite");let store=new SqliteWorkspaceStore(file);
    try{
      准备真实旧编译存储(store,item);let workspace=store.getWorkspace();const legacy=workspace.activePlan.stages.flatMap(stage=>stage.tasks).find(task=>task.requirementId==="booking:booking-旧原始预订:segment-旧分段")!;store.setPlanTaskChecked(workspace.activePlan.id,legacy.id,true);
      if(mode==="任务字段篡改") {store.close();const database=new DatabaseSync(file);database.prepare("UPDATE tasks SET due_label=? WHERE id=?").run("虚构篡改完成条件",legacy.id);database.close();store=new SqliteWorkspaceStore(file);workspace=store.getWorkspace();store.applyDirectBlueprintRevisionBatch({expectedPlanId:workspace.activePlan.id,expectedVersion:workspace.activePlan.version,expectedBlueprintVersion:1,requestId:"拒绝篡改继承",revisions:[{kind:"set_tip_state",tipId:"旧提示",pinned:true,createdAt:"2026-11-02T00:00:00Z"}]});}
      else {workspace=store.getWorkspace();const context=store.getBookingRelationshipReviewContext(workspace.activePlan.id);const source=store.listCurrentTravelBookingSourcesForPlan(workspace.activePlan.id)[0]!;store.savePlanTravelBooking({targetPlanId:workspace.activePlan.id,booking:{...source,segments:source.segments.map(segment=>({...segment,startAtLocal:"2026-12-01T12:00"})),updatedAt:"2026-11-02T00:00:00Z"},expectedVersion:workspace.activePlan.version,expectedBlueprintVersion:1,expectedSourceSetDigest:context.sourceSetDigest,expectedRecordDigest:bookingRelationshipDigest(source),requestId:"拒绝源变化继承",requestDigest:bookingRelationshipDigest({mode})});}
      workspace=store.getWorkspace();const constraint=workspace.activeBlueprint!.bookingConstraints![0]!;const identity=bookingTaskRequirementId(constraint,constraint.segments[0]!.id);assert.equal(workspace.activePlan.stages.flatMap(stage=>stage.tasks).find(task=>task.requirementId===identity)!.status,"waiting_user",mode);
    }finally{store.close();rmSync(directory,{recursive:true,force:true});}
  }
});

function 准备真实旧编译存储(store:SqliteWorkspaceStore,item:{blueprint:TripBlueprint;compilation:ReturnType<typeof compileTripBlueprint>}):void {
  准备直接编辑存储(store,blueprint=>{
    const proposalRef=blueprint.proposalRef;Object.assign(blueprint,structuredClone(item.blueprint),{proposalRef});
    const constraint=blueprint.bookingConstraints![0]!;
    if(constraint.sourceBookingId)store.saveTravelBooking({id:constraint.sourceBookingId,planningSessionId:proposalRef.sessionId,type:constraint.type,status:constraint.status,title:constraint.title,source:"user",sourceHash:"虚构旧版来源摘要",sourceLabel:constraint.sourceLabel,importedAt:constraint.importedAt,updatedAt:constraint.importedAt,constraintStrength:constraint.constraintStrength,segments:constraint.segments.map(segment=>{const {sourceSegmentId,...fields}=segment;return {...fields,id:sourceSegmentId!,status:segment.status??"needs_review"};})});
  },structuredClone(item.compilation));
}


test("关联准备项的直接保存拒绝且无任何持久化副作用，规范任务勾选仍成功", () => {
  const directory = mkdtempSync(join(tmpdir(), "landi-linked-preparation-"));
  const file = join(directory, "test.sqlite");
  const store = new SqliteWorkspaceStore(file);
  const database = new DatabaseSync(file);
  try {
    准备直接编辑存储(store, blueprint => {
      blueprint.actionRequirements = [{id:"linked-preparation",kind:"preparation",title:"核对虚构材料",description:"隔离测试",accountableParty:"traveler",completionCondition:"旅行者确认",evidence:[]}];
      blueprint.preparationChecklist = [{id:"linked",title:"核对虚构材料",group:"documents",completionCondition:"旅行者确认",requirementId:"linked-preparation",evidence:[]}];
    });
    const workspace = store.getWorkspace();
    const input = {expectedPlanId:workspace.activePlan.id,expectedVersion:workspace.activePlan.version,expectedBlueprintVersion:1,requestId:"关联准备项拒绝",revisions:[
      {kind:"set_tip_state" as const,tipId:"t",pinned:true,createdAt:"2026-08-27T00:00:00Z"},
      {kind:"set_preparation_completed" as const,preparationId:"linked",completed:true,createdAt:"2026-08-27T00:00:00Z"}
    ]};
    const before = isolatedDatabaseRows(database);
    assert.throws(() => store.applyDirectBlueprintRevisionBatch(input), (error:unknown) => {
      assert.ok(error instanceof Error && "code" in error);
      assert.equal(error.code, "invalid_edit");
      return true;
    });
    assert.deepEqual(isolatedDatabaseRows(database), before);
    const task = workspace.activePlan.stages.flatMap(stage => stage.tasks).find(task => task.requirementId === "linked-preparation")!;
    assert.ok(task);
    const checked = store.setPlanTaskChecked(workspace.activePlan.id, task.id, true);
    assert.equal(checked.activePlan.stages.flatMap(stage => stage.tasks).find(candidate => candidate.id === task.id)!.status, "completed");
    assert.equal(checked.activeBlueprint!.version, 1);
    assert.equal(checked.activeBlueprint!.preparationChecklist![0]!.completed, undefined);
    assert.equal((database.prepare("SELECT COUNT(*) AS count FROM direct_blueprint_edits").get() as {count:number}).count, 0);
  } finally {database.close();store.close();rmSync(directory,{recursive:true,force:true});}
});

test("Blueprint 精确检查点仅导入被消费的 carrier，空检查点及取消不吸收其它候选", () => {
  const directory = mkdtempSync(join(tmpdir(), "landi-parent-content-"));
  const databasePath = join(directory, "isolated.sqlite");
  const store = new SqliteWorkspaceStore(databasePath);
  try {
    const session = store.createPlanningSession("travel");
    store.savePlanningSession({ ...session, status: "proposal_ready", proposal: { version: 1, title: "虚构行程", objective: "旅行", theme: "城市", segments: ["测试市"], skeleton: ["2026-11-20"], tradeoffs: [], assumptions: [], decisionPoints: [] } });
    store.confirmPlanningSession(session.id, 1);
    const identity = { generationKey: "exact-carrier-generation", proposalRef: { sessionId: session.id, proposalVersion: 1 }, skillLineage: { skillId: "fixture", skillVersion: "1" } };
    const createdAt = "2026-11-09T00:00:00Z";
    store.saveBlueprintGeneration({ ...identity, status: "running", stage: "itinerary", createdAt, updatedAt: createdAt });
    const research: ResearchSet = { ...identity, id: "exact-research", schemaVersion: TRIP_BLUEPRINT_SCHEMA_VERSION, status: "completed", batches: [], places: [], events: [], sources: [], actionRequirements: [], createdAt, updatedAt: createdAt };
    store.saveResearchSet(research);
    const hash = (value: string) => createHash("sha256").update(value).digest("hex");
    const canonical = (value: unknown): string => Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : value && typeof value === "object" ? `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(",")}}` : JSON.stringify(value);
    const prepare = (batchId: string) => store.generationCarriers.prepare({ ...identity, operation: "itinerary_draft", batchId, protocol: "mah_task_queue_v1", inputSha256: hash(canonical({ text: batchId })), expectedSubpath: "artifacts/landi-stage-result.json", projectRoot: "/tmp/fictional", preparedStatus: "prepared", retryableTerminalStatuses: [], serializeRequest: canonical, hashRequest: hash, createRequest: requestIdentity => ({ ...identity, ...requestIdentity, batchId, operation: "itinerary_draft", schemaVersion: 3, protocol: "mah_task_queue_v1", projectRoot: "/tmp/fictional", kind: "landi_generation_stage_request", parentCheckpoint: store.getGenerationCarrierCheckpoint(identity.generationKey), input: { businessContract: "landi.skill-itinerary-input.v1", sha256: hash(canonical({ text: batchId })), businessInput: { text: batchId } }, output: { subpath: "artifacts/landi-stage-result.json", envelopeContract: "landi.mah-generation-stage-result.v2" }, execution: { preferredLanguage: "zh-CN", webSearch: false, maxRuntimeSeconds: 60, capabilityRequirements: ["structured_output"] }, createdAt }) });
    const used = prepare("used"), unused = prepare("unused");
    for (const carrier of [used, unused]) store.generationCarriers.recordValidated({ carrierTaskId: carrier.carrierTaskId, resultJson: "{}", resultSha256: hash("{}"), validatedStatus: "validated", importedStatus: "imported", changedStatus: "artifact_changed", cancelledStatuses: [] });
    const blueprint: TripBlueprint = { ...identity, schemaVersion: TRIP_BLUEPRINT_SCHEMA_VERSION, id: "exact-blueprint", version: 1, researchSetId: research.id, title: "虚构离境日", summary: "旅行", language: "zh-CN", destinations: ["测试市"], startDate: "2026-11-20", endDate: "2026-11-20", places: [], events: [], sources: [], days: [{ id: "departure", date: "2026-11-20", kind: "transit", city: "测试市", title: "离境", summary: "旅行", stops: [], blocks: [{ id: "rest", kind: "rest", order: 1, title: "准备", evidence: [] }], candidatePlaceIds: [] }], movements: [], actionRequirements: [], createdAt };
    const event = { id: "exact-checkpoint", generationKey: identity.generationKey, stage: "itinerary" as const, status: "running" as const, detail: "保存精确候选", savedPlaceCount: 0, createdAt };
    const peer = new DatabaseSync(databasePath);
    try {
      peer.prepare("UPDATE research_sets SET content_json=? WHERE id=?").run(JSON.stringify({ ...research, updatedAt: "2026-11-09T00:01:00Z" }), research.id);
      assert.throws(() => prepare("used"), /冻结请求/);
      assert.throws(() => store.generationCarriers.claimSubmission(used.carrierTaskId, used.requestSha256), /父检查点内容摘要/);
      assert.throws(() => store.generationCarriers.recordValidated({ carrierTaskId: used.carrierTaskId, resultJson: "{}", resultSha256: hash("{}"), validatedStatus: "validated", importedStatus: "imported", changedStatus: "artifact_changed", cancelledStatuses: [] }), /父检查点内容摘要/);
      assert.throws(() => store.saveTripBlueprint(blueprint, { carrierTaskIds: [used.carrierTaskId], expectedCarriers: [{ carrierTaskId: used.carrierTaskId, requestSha256: used.requestSha256, resultSha256: hash("{}") }], generationEvent: event }), /父检查点内容摘要/);
      assert.equal(store.getTripBlueprint(blueprint.id, blueprint.version), undefined);
      assert.equal(store.generationCarriers.getByTaskId(used.carrierTaskId)?.status, "validated");
      peer.prepare("UPDATE research_sets SET content_json=? WHERE id=?").run(JSON.stringify(research), research.id);
    } finally { peer.close(); }
    store.saveTripBlueprint(blueprint, { carrierTaskIds: [used.carrierTaskId], expectedCarriers: [{ carrierTaskId: used.carrierTaskId, requestSha256: used.requestSha256, resultSha256: hash("{}") }], generationEvent: event });
    assert.equal(store.generationCarriers.getByTaskId(used.carrierTaskId)?.status, "imported");
    assert.equal(store.generationCarriers.getByTaskId(unused.carrierTaskId)?.status, "validated");
    store.saveTripBlueprint(blueprint, { carrierTaskIds: [], expectedCarriers: [], generationEvent: { ...event, id: "deterministic-checkpoint" } });
    assert.equal(store.generationCarriers.getByTaskId(unused.carrierTaskId)?.status, "validated");
    store.requestBlueprintGenerationCancellation(identity.generationKey, "取消虚构测试");
    assert.throws(() => store.saveTripBlueprint(blueprint, { carrierTaskIds: [], expectedCarriers: [], generationEvent: { ...event, id: "cancelled-checkpoint" } }), /取消/);
    assert.equal(store.generationCarriers.getByTaskId(used.carrierTaskId)?.status, "imported");
    assert.equal(store.generationCarriers.getByTaskId(unused.carrierTaskId)?.status, "cancel_requested");
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("完成后停止图片工作持久阻断后续批次，同时保留 Plan、lineage 与直接编辑", () => {
  const directory = mkdtempSync(join(tmpdir(), "landi-completed-carrier-cancel-"));
  const path = join(directory, "isolated.sqlite");
  const store = new SqliteWorkspaceStore(path);
  let peer: SqliteWorkspaceStore | undefined;
  try {
    const blueprint = 准备直接编辑存储(store);
    peer = new SqliteWorkspaceStore(path);
    const plan = structuredClone(store.getWorkspace().activePlan);
    const lineage = store.getPlanBlueprintLineage(plan.id);
    const hash = (value: string) => createHash("sha256").update(value).digest("hex");
    const canonical = (value: unknown): string => Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : value && typeof value === "object" ? `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(",")}}` : JSON.stringify(value);
    const prepare = (target: SqliteWorkspaceStore, batchId: string) => target.generationCarriers.prepare({ generationKey: blueprint.generationKey, operation: "planned_place_image_enrichment", batchId, protocol: "mah_task_queue_v1", inputSha256: hash(canonical({ batchId })), expectedSubpath: "artifacts/landi-stage-result.json", projectRoot: "/tmp/fictional", preparedStatus: "prepared", retryableTerminalStatuses: [], serializeRequest: canonical, hashRequest: hash, createRequest: identity => ({ ...identity, generationKey: blueprint.generationKey, proposalRef: blueprint.proposalRef, skillLineage: blueprint.skillLineage, operation: "planned_place_image_enrichment", batchId, schemaVersion: 3, protocol: "mah_task_queue_v1", projectRoot: "/tmp/fictional", kind: "landi_generation_stage_request", parentCheckpoint: target.getGenerationCarrierCheckpoint(blueprint.generationKey), input: { businessContract: "landi.planned-place-image-enrichment-input.v1", sha256: hash(canonical({ batchId })), businessInput: { batchId } }, output: { subpath: "artifacts/landi-stage-result.json", envelopeContract: "landi.mah-generation-stage-result.v2" }, execution: { preferredLanguage: "zh-CN", webSearch: true, maxRuntimeSeconds: 60, capabilityRequirements: ["structured_output"] }, createdAt: "2026-11-09T00:00:00Z" }) });
    const existing = prepare(peer, "before-cancel");
    store.requestBlueprintGenerationCancellation(blueprint.generationKey, "停止后续图片工作");
    assert.throws(() => prepare(peer!, "after-cancel"), /取消/);
    assert.throws(() => peer!.generationCarriers.recordValidated({ carrierTaskId: existing.carrierTaskId, resultJson: "{}", resultSha256: hash("{}"), validatedStatus: "validated", importedStatus: "imported", changedStatus: "artifact_changed", cancelledStatuses: [] }), /取消/);
    assert.equal(peer.getBlueprintGeneration(blueprint.generationKey)?.status, "completed");
    assert.deepEqual(peer.getWorkspace().activePlan, plan);
    assert.deepEqual(peer.getPlanBlueprintLineage(plan.id), lineage);
    assert.equal(peer.generationCarriers.listForGeneration(blueprint.generationKey).length, 1);
    assert.throws(() => peer!.saveResearchSetAndTripBlueprint(peer!.getResearchSet(blueprint.researchSetId)!, blueprint), /取消/);
    const raw = new DatabaseSync(path);
    try { raw.prepare("DELETE FROM mah_generation_carriers WHERE generation_key=?").run(blueprint.generationKey); } finally { raw.close(); }
    assert.throws(() => peer!.saveResearchSetAndTripBlueprint(peer!.getResearchSet(blueprint.researchSetId)!, blueprint), /取消/);
    const edited = store.applyDirectBlueprintRevisionBatch({ expectedPlanId: plan.id, expectedVersion: plan.version, expectedBlueprintVersion: 1, requestId: "stopped-image-direct-edit", revisions: [{ kind: "set_tip_state", tipId: "t", pinned: true, createdAt: "2026-11-09T00:01:00Z" }] });
    assert.equal(edited.workspace.activeBlueprint?.version, 2);
    assert.equal(edited.workspace.activeBlueprint?.travelTips?.[0]?.pinned, true);
  } finally { peer?.close(); store.close(); rmSync(directory, { recursive: true, force: true }); }
});
