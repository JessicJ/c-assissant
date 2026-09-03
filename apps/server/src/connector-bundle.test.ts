import assert from "node:assert/strict";
import test from "node:test";
import { connectorResponseStatus, createLocalConfigurationSnapshot } from "./connector-bundle.js";

test("connector response status maps provider states to HTTP status codes", () => {
  assert.equal(connectorResponseStatus("available"), 200);
  assert.equal(connectorResponseStatus("not_configured"), 503);
  assert.equal(connectorResponseStatus("unavailable"), 503);
  assert.equal(connectorResponseStatus("unauthorized"), 401);
  assert.equal(connectorResponseStatus("rate_limited"), 429);
  assert.equal(connectorResponseStatus("unsupported"), 400);
});

test("local configuration snapshot is based on environment and connector state", () => {
  const previousMapsKey = process.env.GOOGLE_MAPS_API_KEY;
  const previousAllowedNumber = process.env.WHATSAPP_ALLOWED_USER_NUMBER;
  try {
    process.env.GOOGLE_MAPS_API_KEY = "maps-key";
    process.env.WHATSAPP_ALLOWED_USER_NUMBER = "+14155552671";
    const snapshot = createLocalConfigurationSnapshot({
      configurationStatus: () => ({ status: "available", data: { state: "verified" } })
    } as never);

    assert.equal(snapshot.google.configured, true);
    assert.equal(snapshot.whatsapp.configured, true);
    assert.equal(snapshot.whatsapp.state, "verified");
    assert.equal(snapshot.whatsapp.paired, true);
  } finally {
    restoreEnv("GOOGLE_MAPS_API_KEY", previousMapsKey);
    restoreEnv("WHATSAPP_ALLOWED_USER_NUMBER", previousAllowedNumber);
  }
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
