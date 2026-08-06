import assert from "node:assert/strict";
import test from "node:test";

import { confirmPlan, createDemoWorkspace } from "./index.js";

test("a confirmed demo Plan becomes active and leaves an inbox receipt", () => {
  const workspace = createDemoWorkspace();
  const confirmed = confirmPlan(workspace, workspace.activePlan.id);

  assert.equal(confirmed.activePlan.status, "active");
  assert.equal(confirmed.inbox[0]?.tone, "ready");
});
