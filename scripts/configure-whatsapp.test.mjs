import assert from "node:assert/strict";
import test from "node:test";

import { normalizeWhatsAppNumber, updateEnvValues, verifyWhatsAppCredentials } from "./configure-whatsapp.mjs";

test("WhatsApp configuration updates only named local values", () => {
  const updated = updateEnvValues("TELEGRAM_BOT_TOKEN=kept\nWHATSAPP_ACCESS_TOKEN=old\n", { WHATSAPP_ACCESS_TOKEN: "new-token", WHATSAPP_PHONE_NUMBER_ID: "phone-1" });
  assert.equal(updated, "TELEGRAM_BOT_TOKEN=kept\nWHATSAPP_ACCESS_TOKEN=new-token\nWHATSAPP_PHONE_NUMBER_ID=phone-1\n");
});

test("WhatsApp configuration normalizes an international paired number", () => {
  assert.equal(normalizeWhatsAppNumber("+1 (555) 010-0200"), "15550100200");
  assert.throws(() => normalizeWhatsAppNumber("local-number"));
});

test("WhatsApp verification returns identity without returning its access token", async () => {
  let authorization = "";
  const result = await verifyWhatsAppCredentials({ accessToken: "secret-wa-token", phoneNumberId: "phone-1", graphApiVersion: "v25.0" }, async (_url, init) => {
    authorization = String(init?.headers?.authorization);
    return new Response(JSON.stringify({ id: "phone-1", display_phone_number: "+1 555 0100", verified_name: "Landi" }));
  });
  assert.equal(result.ok, true);
  assert.equal(result.verifiedName, "Landi");
  assert.equal(authorization, "Bearer secret-wa-token");
  assert.doesNotMatch(JSON.stringify(result), /secret-wa-token/);
});
