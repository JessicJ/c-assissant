import assert from "node:assert/strict";
import test from "node:test";

import { SqliteWorkspaceStore } from "./index.js";

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

test("SQLite keeps partial Telegram Profile setup incomplete and expires pending text edits", () => {
  const store = new SqliteWorkspaceStore(":memory:");
  const initial = store.getWorkspace().profile;
  const nationalityOnly = store.updateProfile({ ...initial, nationality: "Canada" });
  assert.equal(nationalityOnly.profile.status, "incomplete");
  const ready = store.updateProfile({ ...nationalityOnly.profile, immigrationStatus: "student_visa" });
  assert.equal(ready.profile.status, "ready");

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
  store.close();
});

test("SQLite persists the selected Plan runtime without storing any credentials", () => {
  const store = new SqliteWorkspaceStore(":memory:");
  assert.equal(store.getWorkspace().runtime.selectedKind, "codex");
  const updated = store.updateRuntimeSelection({ kind: "claude-code" });
  assert.equal(updated.runtime.selectedKind, "claude-code");
  assert.equal(updated.inbox[0]?.title, "Plan runtime selected");
  assert.match(updated.inbox[0]?.body ?? "", /never stored by C-assistant/i);
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
    stages: [{ title: "Arrival", description: "Reach accommodation.", tasks: [{ title: "Open route", owner: "external", dueLabel: "At arrival", reminder: { scheduledAtLocal: "2026-09-01T05:00", timeZone: "Asia/Shanghai", purpose: "Prepare your passport and essential items." } }] }]
  });

  assert.equal(workspace.activePlan.title, "Attend a Shanghai exhibition");
  assert.equal(workspace.activePlan.stages[0]?.tasks[0]?.reminder?.scheduledAtLocal, "2026-09-01T05:00");
  assert.equal(workspace.inbox[0]?.title, "Codex Plan draft saved locally");
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
  assert.equal(revised.inbox[0]?.title, "Claude Code revised Plan draft saved locally");
  assert.throws(() => store.reviseGeneratedPlan({ expectedPlanId: configured.id, expectedVersion: configured.version, draft }), /changed while/i);
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

test("SQLite records an arrival reminder delivery attempt only once per Plan", () => {
  const store = new SqliteWorkspaceStore(":memory:");
  const planId = store.getWorkspace().activePlan.id;
  const reminder = { planId, reminderKey: "arrival-check-in", dueAt: "2026-09-01T00:00:00.000Z" };
  assert.equal(store.claimTelegramReminder(reminder), true);
  assert.equal(store.claimTelegramReminder(reminder), false);
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

test("SQLite rejects a reminder attempt from a Plan that is no longer current", () => {
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
  store.createPlan({ request: "Create a newer Plan for Hangzhou." });

  assert.equal(store.claimTelegramTaskReminderAttempt({ planId: oldPlan.id, reminderKey, taskId: oldTask.id, dueAt, reminder: oldTask.reminder!, now: dueAt }).claimed, false);
  assert.equal(store.listRecentTaskReminderRuns().find((candidate) => candidate.id === run.id)?.status, "cancelled");
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
