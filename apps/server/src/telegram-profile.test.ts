import assert from "node:assert/strict";
import test from "node:test";

import { createInitialWorkspace } from "@c-assistant/core";
import { formatTelegramProfile, parseTelegramProfileCallback, telegramProfileChoiceMarkup, telegramProfileMarkup, updateProfileText } from "./telegram-profile.js";

test("Telegram Profile card exposes editable basics without Plan-scoped fields", () => {
  const profile = createInitialWorkspace().profile;
  const text = formatTelegramProfile(profile);
  assert.match(text, /Nationality: To be confirmed/);
  assert.match(text, /Status: incomplete/);
  assert.match(text, /accommodation, and precise location stay inside each Plan/i);
  assert.doesNotMatch(text, /Shanghai|hotel|GPS/i);
  assert.equal(telegramProfileMarkup().inline_keyboard.length, 3);
});

test("Telegram Profile callbacks accept only supported fields and enum values", () => {
  assert.deepEqual(parseTelegramProfileCallback("profile_edit:nationality"), { type: "edit_text", field: "nationality" });
  assert.deepEqual(parseTelegramProfileCallback("profile_set:gender:prefer_not_to_say"), { type: "set_gender", value: "prefer_not_to_say" });
  assert.deepEqual(parseTelegramProfileCallback("profile_set:immigrationStatus:student_visa"), { type: "set_immigration_status", value: "student_visa" });
  assert.deepEqual(parseTelegramProfileCallback("profile_set:immigrationStatus:no_visa"), { type: "set_immigration_status", value: "no_visa" });
  assert.deepEqual(parseTelegramProfileCallback("profile_set:immigrationStatus:admin"), { type: "unknown" });
  assert.ok(telegramProfileChoiceMarkup("immigrationStatus").inline_keyboard.flat().every((button) => button.callback_data.length <= 64));
});

test("Telegram Profile text updates one field and normalizes whitespace", () => {
  const profile = createInitialWorkspace().profile;
  const update = updateProfileText(profile, "nationality", "  New   Zealand  ");
  assert.equal(update.nationality, "New Zealand");
  assert.equal(update.preferredLanguage, profile.preferredLanguage);
});
