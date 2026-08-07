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
    stages: [{ title: "Arrival", description: "Reach accommodation.", tasks: [{ title: "Open route", owner: "external", dueLabel: "At arrival" }] }]
  });

  assert.equal(workspace.activePlan.title, "Attend a Shanghai exhibition");
  assert.equal(workspace.inbox[0]?.title, "Codex Plan draft saved locally");
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

  const disconnected = store.unpairTelegram();

  assert.equal(disconnected.state, "not_paired");
  assert.equal(store.getWorkspace().activePlan.id, planId);
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
