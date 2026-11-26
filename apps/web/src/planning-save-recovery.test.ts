import assert from "node:assert/strict";
import test from "node:test";
import { preparePlanningMessage, settlePlanningMessage, forgetRejectedPlanningMessage, migratePlanningDraft, refreshAfterPlanningSave, pendingPlanningMessage } from "./planning-message-identity.js";

function fixture() {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  return { values, storage };
}

test("acknowledged save is settled once even when history refresh fails", async () => {
  const { values, storage } = fixture();
  const identity = preparePlanningMessage(storage, "pending", "Fictional trip", { revision: 0 }, () => "message-a");
  const receipts = new Set<string>();
  const save = (id: string) => { receipts.add(id); return { sessionId: "session", revision: 1 }; };
  const saved = save(identity.messageId);
  settlePlanningMessage(storage, "pending", identity.messageId);
  const refresh = await refreshAfterPlanningSave(saved, async () => { throw new Error("Fictional history query failed"); });
  assert.equal(refresh.ok, false);
  assert.deepEqual([...receipts], ["message-a"]);
  assert.equal(values.has("pending"), false);
  assert.equal(pendingPlanningMessage(storage, "pending"), undefined);
});

test("ambiguous message survives another message, acknowledgement and a simulated reload", () => {
  const { values, storage } = fixture();
  const a = preparePlanningMessage(storage, "pending", "First trip detail", { revision: 0 }, () => "a");
  const b = preparePlanningMessage(storage, "pending", "Another detail", { revision: 1, sessionId: "session" }, () => "b");
  settlePlanningMessage(storage, "pending", b.messageId);
  const reloaded = { ...storage, getItem: (key: string) => values.get(key) ?? null };
  assert.equal(pendingPlanningMessage(reloaded, "pending", "session")?.message, "First trip detail");
  const retry = preparePlanningMessage(reloaded, "pending", "First trip detail", { revision: 2, sessionId: "session" }, () => "must-not-create");
  assert.deepEqual(retry, a);
  settlePlanningMessage(reloaded, "pending", a.messageId);
  assert.equal(values.has("pending"), false);
});

test("rejecting one message does not discard other unresolved receipts", () => {
  const { storage } = fixture();
  const a = preparePlanningMessage(storage, "pending", "A", { revision: 0 }, () => "a");
  preparePlanningMessage(storage, "pending", "B", { revision: 0 }, () => "b");
  forgetRejectedPlanningMessage(storage, "pending", "planning_revision_conflict", "b");
  assert.deepEqual(preparePlanningMessage(storage, "pending", "A", { revision: 3 }, () => "wrong"), a);
  forgetRejectedPlanningMessage(storage, "pending", "planning_save_failed", "a");
  assert.equal(pendingPlanningMessage(storage, "pending")?.identity.messageId, "a");
});

test("legacy single-message receipts remain reusable without changing their identity", () => {
  const { storage } = fixture();
  const identity = { messageId: "legacy", expectedRevision: 4, sessionId: "session" };
  storage.setItem("pending", JSON.stringify({ message: "Legacy text", identity }));
  preparePlanningMessage(storage, "pending", "New text", { revision: 5, sessionId: "session" }, () => "new");
  assert.deepEqual(preparePlanningMessage(storage, "pending", "Legacy text", { revision: 6, sessionId: "session" }, () => "wrong"), identity);
  assert.notEqual(preparePlanningMessage(storage, "pending", "Legacy text", { revision: 0, sessionId: "other" }, () => "other").messageId, identity.messageId);
});

test("session creation migrates unsent draft before refresh without overwriting an existing draft", () => {
  const { values, storage } = fixture();
  storage.setItem("input:new", "Unsent trip details");
  assert.equal(migratePlanningDraft(storage, "input:new", "input:session"), "Unsent trip details");
  assert.equal(storage.getItem("input:session"), "Unsent trip details");
  assert.equal(values.has("input:new"), false);
  storage.setItem("input:new", "Another unsent draft");
  assert.equal(migratePlanningDraft(storage, "input:new", "input:session"), "Unsent trip details");
  assert.equal(storage.getItem("input:new"), "Another unsent draft");
  assert.equal(storage.getItem("input:session"), "Unsent trip details");
});

test("failed draft copy or pending write preserves existing bytes", () => {
  const { storage } = fixture();
  storage.setItem("input:new", "Preserve this text");
  const broken = { ...storage, setItem: () => { throw new Error("Fictional quota limit"); } };
  assert.throws(() => migratePlanningDraft(broken, "input:new", "input:session"));
  assert.equal(storage.getItem("input:new"), "Preserve this text");
  const a = preparePlanningMessage(storage, "pending", "A", { revision: 0 }, () => "a");
  assert.throws(() => preparePlanningMessage(broken, "pending", "B", { revision: 0 }, () => "b"));
  assert.deepEqual(pendingPlanningMessage(storage, "pending")?.identity, a);
});
