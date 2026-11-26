import test from "node:test";
import assert from "node:assert/strict";
import { workspaceMutationDigestInput } from "./workspace-mutation-error.js";

test("回执业务投影忽略对象键顺序和运行时间，保留编辑顺序及确认身份", () => {
  const original = { expectedVersion: 1, expectedBlueprintVersion: 2, requestId: "原请求", revisions: [{ kind: "set_tip_state", tipId: "虚构提示", pinned: true, createdAt: "2026-11-05T00:00:00Z" }], highImpactConfirmation: "原确认" };
  const canonical = workspaceMutationDigestInput("save", "虚构计划", original);
  assert.equal(canonical, workspaceMutationDigestInput("save", "虚构计划", { revisions: [{ pinned: true, tipId: "虚构提示", kind: "set_tip_state", createdAt: "另一个时间" }], requestId: "别的请求", highImpactConfirmation: "原确认", runtime: "codex", expectedBlueprintVersion: 2, expectedVersion: 1 }));
  assert.notEqual(canonical, workspaceMutationDigestInput("save", "虚构计划", { ...original, revisions: [{ ...original.revisions[0], pinned: false }] }));
  assert.notEqual(canonical, workspaceMutationDigestInput("save", "虚构计划", { ...original, highImpactConfirmation: "别的确认" }));
  const first = { kind: "set_tip_state", tipId: "甲", pinned: true };
  const second = { kind: "set_tip_state", tipId: "乙", hidden: true };
  assert.notEqual(workspaceMutationDigestInput("save", "虚构计划", { ...original, revisions: [first, second] }), workspaceMutationDigestInput("save", "虚构计划", { ...original, revisions: [second, first] }));
  assert.notEqual(workspaceMutationDigestInput("undo", "虚构计划", { ...original, revisionId: "原编辑" }), workspaceMutationDigestInput("undo", "虚构计划", { ...original, revisionId: "别的编辑" }));
});
