import assert from "node:assert/strict";
import test from "node:test";

import { formatTransportPreferenceAcknowledgement, parseTelegramCommand, requestsCompletePlan, shouldGenerateCompletePlan } from "./telegram-commands.js";

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

test("local transport preferences do not create or render a complete Plan", () => {
  assert.deepEqual(parseTelegramCommand("i perfer taxi"), { type: "set_transport_preference", preference: "taxi" });
  assert.deepEqual(parseTelegramCommand("I prefer public transit"), { type: "set_transport_preference", preference: "public_transit" });
  assert.deepEqual(parseTelegramCommand("我想走路"), { type: "set_transport_preference", preference: "walking" });
  assert.deepEqual(parseTelegramCommand("我想打车"), { type: "set_transport_preference", preference: "taxi" });
  assert.match(formatTransportPreferenceAcknowledgement("taxi", true), /No new Plan was created/i);
  assert.match(formatTransportPreferenceAcknowledgement("taxi", true), /share your location/i);
});

test("explicit whole-Plan changes and /new still use the complete Plan path", () => {
  assert.equal(parseTelegramCommand("Change my whole plan to prefer taxi").type, "create_plan");
  assert.deepEqual(parseTelegramCommand("/new I prefer taxi for my China stay"), { type: "create_plan", request: "I prefer taxi for my China stay", explicit: true });
  assert.equal(parseTelegramCommand("I do not want a taxi").type, "create_plan");
  assert.equal(requestsCompletePlan("Create a new plan for another exhibition"), true);
  assert.equal(requestsCompletePlan("I need help with the current taxi"), false);
});

test("an active Plan needs explicit whole-Plan intent before complete generation", () => {
  assert.equal(shouldGenerateCompletePlan("active", "I need help with the current pickup", false), false);
  assert.equal(shouldGenerateCompletePlan("active", "Change my whole plan", false), true);
  assert.equal(shouldGenerateCompletePlan("active", "Anything", true), true);
  assert.equal(shouldGenerateCompletePlan("draft", "Correct the hotel", false), true);
});

test("control commands do not create a Plan", () => {
  assert.equal(parseTelegramCommand("/plan").type, "plan");
  assert.equal(parseTelegramCommand("/prepare@landi_life_bot").type, "prepare");
  assert.equal(parseTelegramCommand("/profile").type, "profile");
  assert.equal(parseTelegramCommand("/weather").type, "weather");
  assert.deepEqual(parseTelegramCommand("/food"), { type: "food" });
  assert.deepEqual(parseTelegramCommand("/food@landi_life_bot 12"), { type: "food", partySize: 12 });
  assert.equal(parseTelegramCommand("/help@landi_life_bot").type, "help");
  assert.equal(parseTelegramCommand("/other").type, "unknown_command");
});
