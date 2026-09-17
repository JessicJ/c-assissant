import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function loadServerConfig(entryModuleUrl: string) {
  const projectRoot = fileURLToPath(new URL("../../../", entryModuleUrl));
  const envPath = fileURLToPath(new URL("../../../.env", entryModuleUrl));
  const webDistPath = resolve(projectRoot, "apps", "web", "dist");
  if (existsSync(envPath)) process.loadEnvFile(envPath);
  const semanticShadowSampleRate = Number(process.env.LANDI_SEMANTIC_SHADOW_SAMPLE_RATE ?? 1);
  const semanticShadowTimeoutMs = Number(process.env.LANDI_SEMANTIC_SHADOW_TIMEOUT_MS ?? 10 * 60_000);
  return {
    projectRoot,
    envPath,
    databasePath: process.env.C_ASSISTANT_DATA_PATH || resolve(projectRoot, "data", "c-assistant.sqlite"),
    blueprintGenerationEnabled: process.env.LANDI_BLUEPRINT_GENERATION !== "0",
    semanticShadow: {
      enabled: process.env.LANDI_SEMANTIC_SHADOW === "1",
      sampleRate: Number.isFinite(semanticShadowSampleRate) ? Math.min(1, Math.max(0, semanticShadowSampleRate)) : 0,
      timeoutMs: Number.isFinite(semanticShadowTimeoutMs) && semanticShadowTimeoutMs > 0 ? semanticShadowTimeoutMs : 10 * 60_000
    },
    webAssetsPath: resolve(webDistPath, "assets"),
    webTripMapPath: resolve(webDistPath, "trip-map"),
    webIndexPath: resolve(webDistPath, "index.html"),
    port: Number(process.env.C_ASSISTANT_PORT ?? 8787),
    host: process.env.C_ASSISTANT_HOST ?? "127.0.0.1"
  };
}
