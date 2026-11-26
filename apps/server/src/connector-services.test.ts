import assert from "node:assert/strict";
import test from "node:test";
import type { ConnectorBundle } from "./connector-bundle.js";
import { createConnectorServices } from "./connector-services.js";

test("connector services return the current bundle after replacement", () => {
  const previousAllowedNumber = process.env.WHATSAPP_ALLOWED_USER_NUMBER;
  try {
    process.env.WHATSAPP_ALLOWED_USER_NUMBER = "+14155552671";
    const services = createConnectorServices();
    const initial = services.getConnectors();
    const replacement = { ...initial } as ConnectorBundle;

    services.replaceConnectors(replacement);

    assert.equal(services.getConnectors(), replacement);
    const snapshot = services.getLocalConfiguration();
    assert.equal("whatsapp" in snapshot, false);
    assert.equal("telegram" in snapshot, false);
  } finally {
    if (previousAllowedNumber === undefined) {
      delete process.env.WHATSAPP_ALLOWED_USER_NUMBER;
    } else {
      process.env.WHATSAPP_ALLOWED_USER_NUMBER = previousAllowedNumber;
    }
  }
});
