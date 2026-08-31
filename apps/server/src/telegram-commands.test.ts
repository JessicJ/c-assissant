import assert from "node:assert/strict";
import test from "node:test";

import { formatTransportChoiceAcknowledgement, parseTelegramCommand, requestsCompletePlan, shouldGenerateCompletePlan } from "./telegram-commands.js";

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
  assert.deepEqual(parseTelegramCommand("i perfer taxi"), { type: "transport_choice", preference: "taxi", scope: "unspecified" });
  assert.deepEqual(parseTelegramCommand("I prefer public transit"), { type: "transport_choice", preference: "public_transit", scope: "unspecified" });
  assert.deepEqual(parseTelegramCommand("我想走路"), { type: "transport_choice", preference: "walking", scope: "unspecified" });
  assert.deepEqual(parseTelegramCommand("我这次想打车"), { type: "transport_choice", preference: "taxi", scope: "current_action" });
  assert.deepEqual(parseTelegramCommand("I always prefer taxi for this trip"), { type: "transport_choice", preference: "taxi", scope: "plan" });
  assert.match(formatTransportChoiceAcknowledgement("taxi", "current_action", true), /saved Plan preference is unchanged/i);
  assert.match(formatTransportChoiceAcknowledgement("taxi", "current_action", true), /share your location/i);
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
  assert.equal(parseTelegramCommand("/go").type, "go");
  assert.equal(parseTelegramCommand("/uber").type, "unknown_command");
  assert.deepEqual(parseTelegramCommand("/food"), { type: "food" });
  assert.deepEqual(parseTelegramCommand("/food@landi_life_bot 12"), { type: "food", partySize: 12 });
  assert.equal(parseTelegramCommand("/help@landi_life_bot").type, "help");
  assert.equal(parseTelegramCommand("/other").type, "unknown_command");
});

test("natural assistant questions do not become Plan change proposals", () => {
  assert.equal(parseTelegramCommand("What's the weather now?").type, "weather");
  assert.equal(parseTelegramCommand("今天会下雨吗？").type, "weather");
  assert.equal(parseTelegramCommand("Where should we eat nearby?").type, "food");
  assert.equal(parseTelegramCommand("附近有什么餐厅？").type, "food");
  assert.equal(parseTelegramCommand("Show me my current plan").type, "plan");
  assert.equal(parseTelegramCommand("查看当前旅行计划").type, "plan");
});

test("future food preferences still enter the Plan change flow", () => {
  assert.equal(parseTelegramCommand("I want Italian food").type, "create_plan");
  assert.equal(parseTelegramCommand("Please add an Italian dinner near the Louvre").type, "create_plan");
});

test("explicit natural-language arrivals become current-destination updates", () => {
  assert.deepEqual(parseTelegramCommand("I arrived in London"), { type: "arrival_update", city: "London" });
  assert.deepEqual(parseTelegramCommand("We've just arrived at Paris."), { type: "arrival_update", city: "Paris" });
  assert.deepEqual(parseTelegramCommand("我们刚到伦敦了"), { type: "arrival_update", city: "伦敦" });
});
