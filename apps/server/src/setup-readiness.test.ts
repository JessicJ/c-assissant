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
    amapConfigured: true,
    qweatherConfigured: true,
    telegramConfigured: true,
    telegramPaired: true
  });

  assert.equal(result.status, "ready");
  assert.equal(result.readyCount, 5);
  assert.match(result.nextAction, /Create a Plan/);
});

test("explains that the selected installed runtime needs login", () => {
  const result = assessSetupReadiness({
    profileStatus: "ready",
    selectedRuntime: "claude-code",
    runtimeChecks: [{ kind: "claude-code", installed: true, authenticated: false }],
    amapConfigured: true,
    qweatherConfigured: true,
    telegramConfigured: true,
    telegramPaired: true
  });

  assert.equal(result.status, "needs_attention");
  assert.equal(result.items.find((item) => item.id === "runtime")?.status, "needs_attention");
  assert.equal(result.nextAction, "Claude Code is installed but needs login on this computer.");
});

test("guides a configured Telegram bot to the pairing step", () => {
  const result = assessSetupReadiness({
    profileStatus: "ready",
    selectedRuntime: "codex",
    runtimeChecks: [{ kind: "codex", installed: true, authenticated: true }],
    amapConfigured: true,
    qweatherConfigured: true,
    telegramConfigured: true,
    telegramPaired: false
  });

  assert.equal(result.readyCount, 4);
  assert.equal(result.nextAction, "The bot is configured; pair your private Telegram account.");
});
