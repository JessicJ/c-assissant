import assert from "node:assert/strict";
import test from "node:test";

import { normalizeWhatsAppUserNumber, whatsappActionFallback } from "./whatsapp-channel.js";

test("WhatsApp binds one normalized international user number", () => {
  assert.equal(normalizeWhatsAppUserNumber("+1 (555) 010-0200"), "15550100200");
  assert.equal(normalizeWhatsAppUserNumber("not-a-number"), undefined);
});

test("WhatsApp preserves URL handoffs and discloses unsupported callback actions", () => {
  const result = whatsappActionFallback({ inline_keyboard: [[
    { text: "Open route", url: "https://www.google.com/maps/dir/" },
    { text: "Confirm complete Plan", callback_data: "confirm:plan-1:2" }
  ]] }, false);
  assert.match(result ?? "", /Open route: https:\/\/www\.google\.com\/maps\/dir\//);
  assert.match(result ?? "", /Confirm complete Plan: open Landi Web or Telegram/i);
});

test("WhatsApp never implies that an unsupported location control is active", () => {
  const result = whatsappActionFallback({ keyboard: [[{ text: "Share current location", request_location: true }]], resize_keyboard: true, one_time_keyboard: true }, true);
  assert.match(result ?? "", /currently available through Telegram/i);
  assert.match(result ?? "", /will not be used or saved/i);
});
