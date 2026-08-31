import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import readline from "node:readline";
import { randomBytes } from "node:crypto";

const projectRoot = resolve(import.meta.dirname, "..");
const envPath = resolve(projectRoot, ".env");

export function updateEnvValues(content, values) {
  let updated = content;
  for (const [key, rawValue] of Object.entries(values)) {
    const value = String(rawValue).replaceAll(/\r?\n/g, "").trim();
    if (!value) throw new Error(`${key} cannot be empty.`);
    const line = `${key}=${value}`;
    const pattern = new RegExp(`^${key}=.*$`, "m");
    updated = pattern.test(updated) ? updated.replace(pattern, line) : `${updated.trimEnd()}\n${line}\n`;
  }
  return updated;
}

export function normalizeWhatsAppNumber(value) {
  const normalized = String(value).trim().replace(/^\+/, "").replace(/[\s()-]/g, "");
  if (!/^\d{7,15}$/.test(normalized)) throw new Error("Use an international WhatsApp number with country code.");
  return normalized;
}

export async function verifyWhatsAppCredentials({ accessToken, phoneNumberId, graphApiVersion }, fetcher = fetch) {
  const url = new URL(`https://graph.facebook.com/${graphApiVersion}/${encodeURIComponent(phoneNumberId)}`);
  url.searchParams.set("fields", "id,display_phone_number,verified_name,quality_rating");
  try {
    const response = await fetcher(url, { headers: { authorization: `Bearer ${accessToken}` } });
    const payload = await response.json().catch(() => undefined);
    if (!response.ok || !payload?.id || !payload?.display_phone_number || !payload?.verified_name) return { ok: false, status: response.status };
    return { ok: true, status: response.status, phoneNumberId: payload.id, displayPhoneNumber: payload.display_phone_number, verifiedName: payload.verified_name };
  } catch {
    return { ok: false, status: 0 };
  }
}

async function readSecret(prompt) {
  if (!process.stdin.isTTY || !process.stdin.setRawMode) throw new Error("Run this command in an interactive terminal.");
  process.stdout.write(prompt);
  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  let value = "";
  try {
    return await new Promise((resolveValue, reject) => {
      const onKeypress = (text, key) => {
        if (key?.ctrl && key.name === "c") {
          cleanup();
          reject(new Error("Configuration cancelled."));
          return;
        }
        if (key?.name === "return" || key?.name === "enter") {
          cleanup();
          process.stdout.write("\n");
          resolveValue(value.trim());
          return;
        }
        if (key?.name === "backspace") value = value.slice(0, -1);
        else if (text && !key?.ctrl && !key?.meta) value += text;
      };
      const cleanup = () => process.stdin.off("keypress", onKeypress);
      process.stdin.on("keypress", onKeypress);
    });
  } finally {
    process.stdin.setRawMode(false);
    process.stdin.pause();
  }
}

async function readLine(prompt, defaultValue) {
  const terminal = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const value = await new Promise((resolveValue) => terminal.question(`${prompt}${defaultValue ? ` [${defaultValue}]` : ""}: `, resolveValue));
    return value.trim() || defaultValue || "";
  } finally {
    terminal.close();
  }
}

async function main() {
  const accessToken = await readSecret("Paste a NEW WhatsApp access token (input is hidden): ");
  const phoneNumberId = await readLine("Phone Number ID");
  const businessAccountId = await readLine("WhatsApp Business Account ID");
  const appSecret = await readSecret("Paste the Meta App Secret (input is hidden): ");
  const allowedUserNumber = normalizeWhatsAppNumber(await readLine("Your paired WhatsApp number with country code"));
  const reminderTemplateName = await readLine("Approved reminder template name", "landi_plan_reminder");
  const graphApiVersion = await readLine("Graph API version", "v25.0");
  if (!accessToken || !phoneNumberId || !businessAccountId || !appSecret) throw new Error("WhatsApp access token, Phone Number ID, WABA ID, and App Secret are required.");
  if (!/^v\d+\.\d+$/.test(graphApiVersion)) throw new Error("Graph API version must look like v25.0.");
  if (!/^[a-z0-9_]{1,512}$/.test(reminderTemplateName)) throw new Error("Template name must contain only lowercase letters, numbers, and underscores.");
  process.stdout.write("Checking the WhatsApp phone identity...\n");
  const check = await verifyWhatsAppCredentials({ accessToken, phoneNumberId, graphApiVersion });
  if (!check.ok) throw new Error(`WhatsApp credentials were not saved (HTTP ${check.status || "network error"}). Generate a current token and check its permissions.`);
  const verifyToken = randomBytes(32).toString("hex");
  const current = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  const updated = updateEnvValues(current, {
    WHATSAPP_ACCESS_TOKEN: accessToken,
    WHATSAPP_PHONE_NUMBER_ID: phoneNumberId,
    WHATSAPP_BUSINESS_ACCOUNT_ID: businessAccountId,
    WHATSAPP_APP_SECRET: appSecret,
    WHATSAPP_VERIFY_TOKEN: verifyToken,
    WHATSAPP_ALLOWED_USER_NUMBER: allowedUserNumber,
    WHATSAPP_REMINDER_TEMPLATE_NAME: reminderTemplateName,
    WHATSAPP_GRAPH_API_VERSION: graphApiVersion
  });
  writeFileSync(envPath, updated, { encoding: "utf8", mode: 0o600 });
  chmodSync(envPath, 0o600);
  process.stdout.write(`✓ Verified ${check.verifiedName} (${check.displayPhoneNumber}).\nWhatsApp was saved only in the local .env. Restart Landi after configuration.\nWebhook verify token (copy it into Meta later; do not share it): ${verifyToken}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "WhatsApp configuration failed."}\n`);
    process.exitCode = 1;
  });
}
