import assert from "node:assert/strict";
import test from "node:test";

import { parseTelegramCommand } from "./telegram-commands.js";

test("plain Telegram text becomes an implicit Plan request", () => {
  assert.deepEqual(parseTelegramCommand("I will attend an exhibition in Shanghai in September."), {
    type: "create_plan",
    request: "I will attend an exhibition in Shanghai in September.",
    explicit: false
  });
});

test("new Plan command remains available for an explicit request", () => {
  assert.deepEqual(parseTelegramCommand("/new I need to settle into Shanghai"), {
    type: "create_plan",
    request: "I need to settle into Shanghai",
    explicit: true
  });
});

test("control commands do not create a Plan", () => {
  assert.equal(parseTelegramCommand("/plan").type, "plan");
  assert.equal(parseTelegramCommand("/profile").type, "profile");
  assert.equal(parseTelegramCommand("/weather").type, "weather");
  assert.deepEqual(parseTelegramCommand("/food"), { type: "food" });
  assert.deepEqual(parseTelegramCommand("/food@landi_life_bot 12"), { type: "food", partySize: 12 });
  assert.equal(parseTelegramCommand("/help@landi_life_bot").type, "help");
  assert.equal(parseTelegramCommand("/other").type, "unknown_command");
});
