import assert from "node:assert/strict";
import test from "node:test";

import { updateEnvValue, verifyGoogleMapsKey } from "./configure-google.mjs";

test("Google configuration replaces only the requested local environment value", () => {
  const updated = updateEnvValue("TELEGRAM_BOT_TOKEN=kept\nGOOGLE_MAPS_API_KEY=old\n", "GOOGLE_MAPS_API_KEY", "new-key\n");
  assert.equal(updated, "TELEGRAM_BOT_TOKEN=kept\nGOOGLE_MAPS_API_KEY=new-key\n");
});

test("Google configuration verifies all three required APIs without returning the key", async () => {
  const requests = [];
  const checks = await verifyGoogleMapsKey("secret-test-key", async (url, init) => {
    requests.push({ url: String(url), headers: init?.headers });
    return new Response("{}", { status: String(url).includes("weather.googleapis.com") ? 403 : 200 });
  });
  assert.deepEqual(checks, [
    { name: "Places API (New)", ok: true, status: 200 },
    { name: "Routes API", ok: true, status: 200 },
    { name: "Weather API", ok: false, status: 403 }
  ]);
  assert.doesNotMatch(JSON.stringify(checks), /secret-test-key/);
  assert.equal(requests.length, 3);
});
