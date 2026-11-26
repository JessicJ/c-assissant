import assert from "node:assert/strict";
import test from "node:test";
import { assessSetupReadiness } from "./setup-readiness.js";

test("reports a fully ready Codex instance without requiring Claude Code", () => {
  const result = assessSetupReadiness({
    profileStatus: "ready",
    selectedRuntime: "codex",
    runtimeChecks: [
      { kind: "codex", installed: true, authenticated: true },
      { kind: "claude-code", installed: true, authenticated: false }
    ],
    googleConfigured: true,
    emailConfigured: true,
    emailVerified: true
  });

  assert.equal(result.status, "ready");
  assert.equal(result.readyCount, 4);
  assert.match(result.nextAction, /Create a Plan/);
});

test("explains that the selected installed runtime needs login", () => {
  const result = assessSetupReadiness({
    profileStatus: "ready",
    selectedRuntime: "claude-code",
    runtimeChecks: [{ kind: "claude-code", installed: true, authenticated: false }],
    googleConfigured: true,
    emailConfigured: true,
    emailVerified: true
  });

  assert.equal(result.status, "needs_attention");
  assert.equal(result.items.find((item) => item.id === "runtime")?.status, "needs_attention");
  assert.equal(result.nextAction, "Claude Code is installed but needs login on this computer.");
});

test("guides a configured sender to recipient verification", () => {
  const result = assessSetupReadiness({
    profileStatus: "ready",
    selectedRuntime: "codex",
    runtimeChecks: [{ kind: "codex", installed: true, authenticated: true }],
    googleConfigured: true,
    emailConfigured: true,
    emailVerified: false
  });

  assert.equal(result.readyCount, 3);
  assert.equal(result.nextAction, "Save and verify your recipient address in Travel emails.");
});
