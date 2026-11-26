import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import * as connectors from "@c-assistant/connectors";
import { SqliteWorkspaceStore } from "@c-assistant/storage";
import { createDestinationResearch, resolveDestinationCatalog } from "./destination-research.js";
import { planDraftForRevision, completedTasksForRevision } from "./plan-revision.js";
import { readExecutionState } from "./execution-state.js";

test("retired channel transports and mutation methods are absent", () => {
  assert.equal("TelegramConnector" in connectors, false);
  assert.equal("WhatsAppConnector" in connectors, false);
  assert.equal(Object.getOwnPropertyNames(SqliteWorkspaceStore.prototype).some(name => /Telegram|WhatsApp/.test(name)), false);
});

test("reviewed destination sources load through the installed travel module", async () => {
  const store = new SqliteWorkspaceStore(":memory:");
  try {
    const research = createDestinationResearch({ store, getConnectors: () => { throw new Error("Discovery must not contact providers"); } });
    const china = await research.officialSources.discover();
    const japan = await research.japanOfficialSources.discover();
    assert.equal(china.status, "available");
    assert.equal(japan.status, "available");
    assert.ok(china.data?.length);
    assert.ok(japan.data?.length);
    assert.deepEqual(resolveDestinationCatalog("Japan"), { status: "resolved", catalogId: "japan", normalizedCountry: "JP" });
    assert.equal(resolveDestinationCatalog("Tokyo").status, "needs_confirmation");
    assert.equal(resolveDestinationCatalog(undefined).status, "needs_confirmation");
  } finally { store.close(); }
});

test("shared revision helpers keep completion facts and independent draft content", () => {
  const store = new SqliteWorkspaceStore(":memory:");
  try {
    const workspace = store.createPlan({ request: "Visit a museum" });
    const plan = workspace.activePlan;
    const draft = planDraftForRevision(plan);
    assert.equal(draft.title, plan.title);
    assert.deepEqual(draft.stages.map(stage => stage.tasks.map(task => task.title)), plan.stages.map(stage => stage.tasks.map(task => task.title)));
    draft.knownInformation.push("draft-only");
    assert.equal(plan.knownInformation.includes("draft-only"), false);
    assert.deepEqual(completedTasksForRevision(plan), plan.stages.flatMap(stage => stage.tasks.filter(task => task.status === "completed").map(task => ({ stageTitle: stage.title, title: task.title, dueLabel: task.dueLabel }))));
    assert.deepEqual(readExecutionState(store, plan), { revision: 0, data: { steps: {}, deliveries: {} } });
  } finally { store.close(); }
});

test("reopening preserves historical chat rows, travel data and email settings", () => {
  const directory = mkdtempSync(join(tmpdir(), "landi-history-retention-"));
  const path = join(directory, "workspace.sqlite");
  try {
    const original = new SqliteWorkspaceStore(path);
    const plan = original.createPlan({ request: "Visit a museum" }).activePlan;
    original.email.updateSettings({ recipient: "traveler@example.test" });
    const email = original.email.settings();
    original.close();
    const database = new DatabaseSync(path);
    database.prepare("INSERT INTO telegram_binding (id, chat_id, user_id, first_name, paired_at) VALUES (1, ?, ?, ?, ?)").run("old-chat-fixture", "old-user-fixture", "Fixture", "2026-01-01T00:00:00.000Z");
    // SQLite may add its own planner statistics; compare application tables only.
    const schema = database.prepare("SELECT name, sql FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
    database.close();
    const reopened = new SqliteWorkspaceStore(path);
    assert.equal(reopened.getWorkspace().activePlan.id, plan.id);
    assert.equal(reopened.getWorkspace().activePlan.version, plan.version);
    assert.deepEqual(reopened.email.settings(), email);
    reopened.close();
    const readback = new DatabaseSync(path, { readOnly: true });
    assert.equal((readback.prepare("SELECT chat_id FROM telegram_binding WHERE id = 1").get() as { chat_id: string }).chat_id, "old-chat-fixture");
    assert.deepEqual(readback.prepare("SELECT name, sql FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all(), schema);
    assert.equal((readback.prepare("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check, "ok");
    readback.close();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
