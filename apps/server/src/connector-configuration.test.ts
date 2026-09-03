import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { saveLocalConfiguration } from "./connector-configuration.js";

test("local configuration save updates existing keys and appends new sanitized values", () => {
  const envPath = join(mkdtempSync(join(tmpdir(), "landi-config-")), ".env");
  const previousMapsKey = process.env.GOOGLE_MAPS_API_KEY;
  const previousWhatsappUser = process.env.WHATSAPP_ALLOWED_USER_NUMBER;
  try {
    saveLocalConfiguration(envPath, { googleMapsApiKey: "old-key" });
    saveLocalConfiguration(envPath, {
      googleMapsApiKey: "new-key",
      whatsappAllowedUserNumber: "+1 (415) 555-2671",
      telegramBotToken: "token\nignored"
    });

    const content = readFileSync(envPath, "utf8");
    assert.match(content, /^GOOGLE_MAPS_API_KEY=new-key$/m);
    assert.match(content, /^WHATSAPP_ALLOWED_USER_NUMBER=14155552671$/m);
    assert.match(content, /^TELEGRAM_BOT_TOKEN=tokenignored$/m);
    assert.equal(process.env.GOOGLE_MAPS_API_KEY, "new-key");
    assert.equal(process.env.WHATSAPP_ALLOWED_USER_NUMBER, "14155552671");
  } finally {
    restoreEnv("GOOGLE_MAPS_API_KEY", previousMapsKey);
    restoreEnv("WHATSAPP_ALLOWED_USER_NUMBER", previousWhatsappUser);
  }
});

test("local configuration save rejects invalid WhatsApp user numbers", () => {
  const envPath = join(mkdtempSync(join(tmpdir(), "landi-config-")), ".env");

  assert.throws(() => saveLocalConfiguration(envPath, { whatsappAllowedUserNumber: "not-a-number" }), /valid international country code/);
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
