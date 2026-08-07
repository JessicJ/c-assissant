import assert from "node:assert/strict";
import test from "node:test";

import { formatTelegramNearbyFood, parseTelegramFoodPartyCallback, telegramFoodPartyMarkup } from "./telegram-food.js";

const planId = "plan-123e4567-e89b-12d3-a456-426614174000";

test("food party callbacks stay bound to an exact Plan version", () => {
  assert.deepEqual(parseTelegramFoodPartyCallback(`food_party:${planId}:3:6`), { planId, version: 3, partySize: 6 });
  assert.equal(parseTelegramFoodPartyCallback(`food_party:${planId}:3:21`), undefined);
  const markup = telegramFoodPartyMarkup(planId, 3);
  assert.ok("inline_keyboard" in markup);
  assert.equal(markup.inline_keyboard.flat().length, 6);
});

test("nearby food is presented as Amap facts with user handoff", () => {
  const result = formatTelegramNearbyFood({
    partySize: 2,
    places: [{ id: "poi-1", name: "Example Noodles", address: "88 Example Road", location: "121.47,31.23", type: "Chinese food", city: "Shanghai", district: "Huangpu", distanceMeters: 860 }]
  });
  assert.match(result.text, /Amap returned these candidates in provider distance order/);
  assert.match(result.text, /has not ranked them/);
  assert.match(result.text, /No order, reservation, or payment was started/);
  assert.match(result.text, /shared coordinates were not saved/);
  assert.ok(result.replyMarkup && "inline_keyboard" in result.replyMarkup);
  const button = result.replyMarkup.inline_keyboard[0]?.[0];
  assert.ok(button && "url" in button);
  assert.match(button.url, /^https:\/\/uri\.amap\.com\/marker\?/);
});

test("empty nearby food does not imply a fixed search radius", () => {
  const result = formatTelegramNearbyFood({ partySize: 1, places: [] });
  assert.match(result.text, /No distance limit was imposed by C-assistant/);
});
