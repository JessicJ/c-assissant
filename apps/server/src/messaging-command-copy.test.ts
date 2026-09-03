import assert from "node:assert/strict";
import test from "node:test";
import {
  messagingHelpText,
  messagingStartText,
  unknownCommandText,
  webWorkbenchPlanGenerationText
} from "./messaging-command-copy.js";

test("messaging help copy keeps supported controls and external-action boundaries visible", () => {
  const text = messagingHelpText();

  assert.match(text, /\/plan/);
  assert.match(text, /\/prepare/);
  assert.match(text, /\/food/);
  assert.match(text, /does not book, pay, order, call a ride, or start navigation/i);
});

test("messaging start copy names the triggering channel", () => {
  assert.match(messagingStartText("telegram"), /Telegram account/);
  assert.match(messagingStartText("whatsapp"), /WhatsApp number/);
});

test("fallback command copy points users back to help", () => {
  assert.match(unknownCommandText(), /\/help/);
});

test("complete plan generation copy keeps Telegram on the Web workbench path", () => {
  const text = webWorkbenchPlanGenerationText();

  assert.match(text, /Web workbench/);
  assert.match(text, /will not use the older one-shot Plan generator/i);
});
