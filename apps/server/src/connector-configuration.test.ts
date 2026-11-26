import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { saveLocalConfiguration } from "./connector-configuration.js";

test("local configuration save updates existing keys and appends new sanitized values", () => {
  const envPath = join(mkdtempSync(join(tmpdir(), "landi-config-")), ".env");
  const previousMapsKey = process.env.GOOGLE_MAPS_API_KEY;
  const previousUber = process.env.UBER_CLIENT_ID;
  try {
    saveLocalConfiguration(envPath, { googleMapsApiKey: "old-key" });
    saveLocalConfiguration(envPath, {
      googleMapsApiKey: "new-key",
      uberClientId: "public-id\ntrimmed"
    });

    const content = readFileSync(envPath, "utf8");
    assert.match(content, /^GOOGLE_MAPS_API_KEY=new-key$/m);
    assert.match(content, /^UBER_CLIENT_ID=public-idtrimmed$/m);
    assert.equal(process.env.GOOGLE_MAPS_API_KEY, "new-key");

  } finally {
    restoreEnv("GOOGLE_MAPS_API_KEY", previousMapsKey);
    restoreEnv("UBER_CLIENT_ID", previousUber);
  }
});

test("retired chat configuration is rejected before any settings are saved", () => {
  const envPath = join(mkdtempSync(join(tmpdir(), "landi-config-")), ".env");

  assert.throws(() => saveLocalConfiguration(envPath, { googleMapsApiKey: "must-not-save", ...({ whatsappAllowedUserNumber: "old-binding" } as object) }), /Chat channels are retired/);
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
