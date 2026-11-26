import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SqliteWorkspaceStore } from "../packages/storage/src/index.js";

const root = resolve(import.meta.dirname, "..");
if (existsSync(resolve(root, ".env"))) process.loadEnvFile(resolve(root, ".env"));
const manifestPath = resolve(root, "data/reminder-acceptance/device-session.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const path = process.env.C_ASSISTANT_DATA_PATH || resolve(root, "data/c-assistant.sqlite");
let store = new SqliteWorkspaceStore(path);
try {
  const current = store.getWorkspace().activePlan;
  if (current.id !== manifest.testPlanId || current.version !== manifest.testVersion || !current.title.startsWith("TEST — ")) throw new Error("Current Plan differs from the designated test. Nothing restored.");
  store.createBackup();
} finally { store.close(); }
const database = new DatabaseSync(path);
try {
  database.exec("BEGIN IMMEDIATE");
  const current = database.prepare("SELECT id FROM plans WHERE id = ? AND version = ? AND is_current = 1 AND is_execution = 1").get(manifest.testPlanId, manifest.testVersion);
  const original = database.prepare("SELECT id FROM plans WHERE id = ? AND version = ? AND status = 'active' AND is_current = 0 AND is_execution = 0").get(manifest.originalPlanId, manifest.originalVersion);
  if (!current || !original) throw new Error("Test or original Plan changed. Nothing restored.");
  const now = new Date().toISOString();
  database.prepare("UPDATE task_reminder_runs SET status = 'cancelled', finished_at = ?, updated_at = ? WHERE plan_id = ? AND status IN ('running', 'retry_wait')").run(now, now, manifest.testPlanId);
  database.prepare("UPDATE telegram_plan_change_proposals SET status = 'cancelled', resolved_at = ? WHERE plan_id = ? AND status = 'pending'").run(now, manifest.testPlanId);
  database.prepare("UPDATE plans SET is_current = 0, is_execution = 0 WHERE id = ?").run(manifest.testPlanId);
  if (database.prepare("UPDATE plans SET is_current = 1, is_execution = 1 WHERE id = ? AND version = ?").run(manifest.originalPlanId, manifest.originalVersion).changes !== 1) throw new Error("Original Plan restoration failed.");
  database.exec("COMMIT");
} catch (error) { database.exec("ROLLBACK"); throw error; }
finally { database.close(); }
store = new SqliteWorkspaceStore(path);
try {
  const plan = store.getExecutionPlan();
  if (plan?.id !== manifest.originalPlanId || plan.version !== manifest.originalVersion || store.getWorkspace().activePlan.id !== plan.id) throw new Error("Restored Plan verification failed.");
  store.clearTelegramLocationIntent();
  manifest.state = "restored_original_plan";
  manifest.simulation.enabled = false;
  manifest.simulation.pinLocalDate = false;
  manifest.restoredAt = new Date().toISOString();
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(JSON.stringify({ restored: true, id: plan.id, version: plan.version, status: plan.status, title: plan.title, dates: plan.dates, testSimulationDisabled: true }));
} finally { store.close(); }
