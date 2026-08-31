import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import readline from "node:readline";
import { spawn } from "node:child_process";

const projectRoot = resolve(import.meta.dirname, "..");
const envPath = resolve(projectRoot, ".env");

export function updateEnvValue(content, key, value) {
  const clean = value.replaceAll(/\r?\n/g, "").trim();
  if (!clean) throw new Error(`${key} cannot be empty.`);
  const line = `${key}=${clean}`;
  const pattern = new RegExp(`^${key}=.*$`, "m");
  return pattern.test(content) ? content.replace(pattern, line) : `${content.trimEnd()}\n${line}\n`;
}

export async function verifyGoogleMapsKey(apiKey, fetcher = fetch) {
  const checks = [
    request(fetcher, "Places API (New)", "https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: { "content-type": "application/json", "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": "places.id" },
      body: JSON.stringify({ textQuery: "Tokyo Station", pageSize: 1 })
    }),
    request(fetcher, "Routes API", "https://routes.googleapis.com/directions/v2:computeRoutes", {
      method: "POST",
      headers: { "content-type": "application/json", "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": "routes.distanceMeters" },
      body: JSON.stringify({ origin: { location: { latLng: { latitude: 35.6812, longitude: 139.7671 } } }, destination: { location: { latLng: { latitude: 35.6895, longitude: 139.6917 } } }, travelMode: "DRIVE" })
    }),
    // Weather API currently excludes Japan and Korea, so use Google's supported
    // Mountain View documentation example rather than the Tokyo route fixture.
    request(fetcher, "Weather API", `https://weather.googleapis.com/v1/currentConditions:lookup?location.latitude=37.4220&location.longitude=-122.0841&key=${encodeURIComponent(apiKey)}`)
  ];
  return Promise.all(checks);
}

async function request(fetcher, name, url, init) {
  try {
    const response = await fetcher(url, init);
    return { name, ok: response.ok, status: response.status };
  } catch {
    const status = fetcher === fetch ? await curlStatus(url, init) : 0;
    return { name, ok: status >= 200 && status < 300, status };
  }
}

/** Uses curl only when Node networking fails; request material is passed over stdin, never argv. */
async function curlStatus(url, init) {
  return await new Promise((resolveStatus) => {
    const child = spawn("curl", ["--silent", "--show-error", "--output", "/dev/null", "--write-out", "%{http_code}", "--config", "-"], { stdio: ["pipe", "pipe", "ignore"] });
    let output = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.on("error", () => resolveStatus(0));
    child.on("close", () => resolveStatus(Number(output.trim()) || 0));
    const headers = Object.entries(init?.headers ?? {}).map(([key, value]) => `header = ${JSON.stringify(`${key}: ${value}`)}`).join("\n");
    const method = init?.method ? `request = ${JSON.stringify(init.method)}` : "";
    const body = typeof init?.body === "string" ? `data = ${JSON.stringify(init.body)}` : "";
    child.stdin.end(`url = ${JSON.stringify(url)}\n${method}\n${headers}\n${body}\n`);
  });
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

async function main() {
  const apiKey = await readSecret("Paste a NEW restricted Google Maps Platform key (input is hidden): ");
  if (!apiKey) throw new Error("No key was entered.");
  process.stdout.write("Checking Places API (New), Routes API, and Weather API...\n");
  const checks = await verifyGoogleMapsKey(apiKey);
  for (const check of checks) process.stdout.write(`${check.ok ? "✓" : "✗"} ${check.name}${check.ok ? "" : ` (HTTP ${check.status || "network error"})`}\n`);
  const failed = checks.filter((check) => !check.ok);
  if (failed.length) throw new Error("The key was not saved. Enable the failed APIs, billing, quota, and suitable server restrictions, then try again.");
  const current = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  writeFileSync(envPath, updateEnvValue(current, "GOOGLE_MAPS_API_KEY", apiKey), { encoding: "utf8", mode: 0o600 });
  chmodSync(envPath, 0o600);
  process.stdout.write("Google Maps Platform is verified and saved locally in .env. Restart Landi to load it.\n");
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Google configuration failed."}\n`);
    process.exitCode = 1;
  });
}
