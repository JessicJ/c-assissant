import assert from "node:assert/strict";
import test from "node:test";
import { runtimeName } from "./runtime-display.js";

test("runtime display names stay stable for user-facing replies", () => {
  assert.equal(runtimeName("codex"), "Codex");
  assert.equal(runtimeName("claude-code"), "Claude Code");
});
