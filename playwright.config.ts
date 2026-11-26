import { defineConfig, devices } from "@playwright/test";
import { isAbsolute, join } from "node:path";

const port = Number(process.env.LANDI_BROWSER_PORT ?? 8765);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid LANDI_BROWSER_PORT.");
const browserOutputDirectory = process.env.LANDI_BROWSER_OUTPUT_DIR;
if (browserOutputDirectory && !isAbsolute(browserOutputDirectory)) throw new Error("LANDI_BROWSER_OUTPUT_DIR must be absolute.");

export default defineConfig({
  testDir: "./tests/browser",
  testMatch: "**/*.spec.ts",
  ...(browserOutputDirectory ? { outputDir: join(browserOutputDirectory, "default-suite") } : {}),
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  expect: { timeout: process.env.LANDI_LIVE_AGENT_E2E ? 150_000 : 5_000 },
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure"
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "node scripts/browser-test-server.mjs",
    url: `http://127.0.0.1:${port}/health`,
    reuseExistingServer: false,
    timeout: 30_000
  }
});
