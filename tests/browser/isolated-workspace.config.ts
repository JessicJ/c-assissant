import { defineConfig, devices } from "@playwright/test";
import { isAbsolute, resolve } from "node:path";

// 本配置只连接调用方明确声明的隔离实例，不启动或认领服务。
const value = process.env.LANDI_WORKSPACE_BASE_URL;
if (!value) throw new Error("必须通过 LANDI_WORKSPACE_BASE_URL 指定隔离的本机测试实例。");
const url = new URL(value);
if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.username || url.password) {
  throw new Error("LANDI_WORKSPACE_BASE_URL 必须是不含凭据的 HTTP 本机回环地址。");
}
const outputDir = process.env.LANDI_BROWSER_OUTPUT_DIR;
if (outputDir && !isAbsolute(outputDir)) throw new Error("LANDI_BROWSER_OUTPUT_DIR 必须是绝对路径。");

export default defineConfig({
  testDir: ".",
  testMatch: "isolated-workspace.spec.ts",
  outputDir: outputDir ?? resolve(__dirname, "../../test-results"),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: { baseURL: value, headless: process.env.LANDI_BROWSER_HEADFUL !== "1", trace: "retain-on-failure", screenshot: "only-on-failure", video: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }]
});
