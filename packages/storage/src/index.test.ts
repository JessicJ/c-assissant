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
    nationality: "Canada"
  });

  assert.equal(confirmed.activePlan.status, "active");
  assert.equal(updated.profile.nationality, "Canada");
  assert.equal(updated.system.storage, "local");
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
